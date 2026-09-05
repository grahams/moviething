# Letterboxd Auto-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Films added through `POST /api/newEntry` are pushed to Letterboxd automatically, via a queue that makes breakage visible instead of silent.

**Architecture:** New rows are born `pending` via a column default, so the write path is untouched and a Letterboxd outage can never affect a database write. A background worker drains the queue on an interval. All Letterboxd wire-format knowledge is isolated in `client.js` behind one function; the retry and backoff logic lives in `queue.js`, which never touches the network and is therefore fully unit-testable.

**Tech Stack:** Node 24 (native `fetch`, no new dependencies), Express 4, MariaDB 10.11, zod, Jest + Supertest.

**Spec:** `docs/superpowers/specs/2026-09-05-letterboxd-sync-design.md`

## Global Constraints

- **No new npm dependencies.** Node 24 provides `fetch`. (`Dockerfile:1` = `node:24-bookworm-slim`.)
- **Default off.** `MOVIETHING_LETTERBOXD_ENABLED` defaults to `false`. Tests, CI, and dev containers must never post to the real diary.
- **No live network in tests.** `global.fetch` is mocked in client tests. The worker interval never starts when `NODE_ENV=test`.
- **New env vars are all optional.** The required-vars list in `server/index.js:20-24` must not gain entries, or existing deployments break on restart.
- **`server/routes/entries.js` must not change.** Rows enqueue via the column default. If a task wants to edit it, the design has been misread.
- **Migrations must be idempotent.** Files in `mariadb/docker-entrypoint-initdb.d/` run only on an empty data dir, so the live DB gets them applied by hand. Use `IF NOT EXISTS`.
- **Existing history is never pushed.** Pre-existing rows must end up `skipped`.
- **Validated endpoints use the `{json: "<stringified>"}` body convention** (`server/middleware/validate.js`) and read `req.validatedBody`.
- Style: `'use strict';` at the top of every server file; CommonJS `require`; 2-space indent.

## Deviation from the spec (deliberate, recorded here)

**Rows with no IMDb ID become `skipped`, not `failed`.** Spec §5 says a row with
no IMDb ID in `movieURL` fails permanently as `no imdb id`. In practice many
shorts are logged with festival URLs rather than IMDb ones (see
`server/__tests__/batch.test.js:15`), so `failed` would fill the failure list
with dozens of entries that no retry can ever fix, and the list would stop being
a useful signal that something is wrong.

These rows are therefore marked `skipped` with `letterboxdError = 'no imdb id'`,
so the reason is preserved and queryable, but they stay out of the failure
count. `POST /api/letterboxd/retry` resets only `failed` rows, so a corrected
URL is re-queued by editing the entry, not by a bulk retry.

---

### Task 1: Spike — capture the diary endpoint's real shape

Throwaway. The only deliverable is a findings section appended to the spec.
**No production code is committed by this task.**

**Files:**
- Modify: `docs/superpowers/specs/2026-09-05-letterboxd-sync-design.md` (append "Spike findings")
- Scratch (never committed): `/tmp/lbx-spike.js`

**Interfaces:**
- Consumes: nothing.
- Produces: the documented facts Task 6 needs — resolve-URL, log-endpoint URL, HTTP method, exact field names, CSRF acquisition and submission, and the success/failure response shapes.

**Prerequisite (human, manual):** log into Letterboxd in a browser, open
DevTools → Application → Cookies, and copy the value of the session cookie
(`letterboxd.signed.in.as`) and the CSRF cookie (`com.xk72.webparts.csrf`).
Export them to the shell as `LBX_COOKIE` and `LBX_CSRF`. **Do not commit them.**

**Starting hypothesis to confirm or correct** — this is what the web app has
historically done, and is the thing the spike exists to verify:

1. IMDb ID → Letterboxd film ID: `GET https://letterboxd.com/imdb/<imdbId>/`
   redirects to the film page; the numeric film ID appears in the markup as
   `data-film-id="NNNNN"`.
2. Log the entry: `POST https://letterboxd.com/s/save-diary-entry` as
   `application/x-www-form-urlencoded`, with roughly:
   `__csrf`, `filmId`, `specifiedDate=true`, `viewingDateStr=YYYY-MM-DD`,
   `rewatch=true|false`, `review`, `tags`, `rating`, `liked=false`.
3. The CSRF token value equals the `com.xk72.webparts.csrf` cookie value and is
   echoed back in the form body.
4. Success returns JSON containing `result: true` and a link to the entry.

- [ ] **Step 1: Confirm the session cookie is accepted**

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Cookie: letterboxd.signed.in.as=$LBX_COOKIE" \
  -H 'User-Agent: Mozilla/5.0' \
  https://letterboxd.com/settings/
```

Expected: `200`. A `302` means the cookie is wrong or expired — re-copy it.
Record whether a browser-like `User-Agent` was required, and whether any
Cloudflare/bot-protection interstitial appeared. **If a challenge blocks plain
`fetch`, stop here and report** — escalating to a headless browser is out of
scope and was explicitly declined.

- [ ] **Step 2: Resolve an IMDb ID to a Letterboxd film ID**

```bash
curl -sL -H "Cookie: letterboxd.signed.in.as=$LBX_COOKIE" \
  -H 'User-Agent: Mozilla/5.0' \
  https://letterboxd.com/imdb/tt0113277/ | grep -o 'data-film-id="[0-9]*"' | head -3
```

Record: the final redirect URL, the attribute that actually carries the ID, and
whether it appears more than once with different values.

- [ ] **Step 3: Log one film and capture the exact request**

Use a film you have genuinely not logged, so the result is unambiguous. Record
the full request and the full response body.

```bash
curl -s -D /tmp/lbx-headers.txt \
  -H "Cookie: letterboxd.signed.in.as=$LBX_COOKIE; com.xk72.webparts.csrf=$LBX_CSRF" \
  -H 'User-Agent: Mozilla/5.0' \
  -H 'X-Requested-With: XMLHttpRequest' \
  --data-urlencode "__csrf=$LBX_CSRF" \
  --data-urlencode "filmId=<ID FROM STEP 2>" \
  --data-urlencode "specifiedDate=true" \
  --data-urlencode "viewingDateStr=2026-09-05" \
  --data-urlencode "rewatch=false" \
  --data-urlencode "review=spike test, will be deleted" \
  https://letterboxd.com/s/save-diary-entry
```

- [ ] **Step 4: Capture the failure shapes**

Repeat Step 3 three times, changing one thing each time, and record the status
code and body of each. These determine the error mapping in Task 6:

1. Omit `__csrf` → expected: CSRF rejection.
2. Send `Cookie:` with a garbage session value → expected: auth rejection.
3. Send `filmId=999999999` → expected: not-found / validation rejection.

- [ ] **Step 5: Delete the test diary entry**

Delete it in the browser. Confirm it is gone from your diary before continuing.

- [ ] **Step 6: Append findings to the spec**

Add a `## Spike findings` section recording, with no hedging: resolve URL and
where the film ID lives; log endpoint URL and method; the exact field name list;
required headers; how CSRF is obtained and submitted; the success response
shape; and a table mapping each observed failure to `AuthError` /
`TransientError` / `PermanentError`. Note explicitly anywhere reality differed
from the hypothesis above.

- [ ] **Step 7: Commit the findings only**

```bash
rm -f /tmp/lbx-spike.js /tmp/lbx-headers.txt
git add docs/superpowers/specs/2026-09-05-letterboxd-sync-design.md
git commit -m "docs: record Letterboxd diary endpoint spike findings"
```

Verify no credentials were committed:

```bash
git show --stat HEAD && git show HEAD | grep -i -E 'csrf=|signed\.in\.as=[A-Za-z0-9]' && echo "LEAK — amend before continuing" || echo "clean"
```

---

### Task 2: Migration and sync-state queries

**Files:**
- Create: `mariadb/docker-entrypoint-initdb.d/002-letterboxd-sync.sql`
- Create: `server/letterboxd/queries.js`
- Test: `server/__tests__/letterboxd-queries.test.js`

**Interfaces:**
- Consumes: `query` from `server/db/index.js`.
- Produces, all `async`:
  - `getPendingCount() → number`
  - `getEligibleRows(limit: number) → Array<{id, movieTitle, viewingDate: Date, movieURL, firstViewing, movieReview, letterboxdAttempts}>`
  - `markSynced(id: number, uri: string) → void`
  - `markFailed(id: number, message: string) → void`
  - `markSkipped(id: number, message: string) → void`
  - `recordAttempt(id: number, message: string) → void`
  - `getCounts() → {pending, synced, failed, skipped}`
  - `getRecentFailures(limit: number) → Array<{id, movieTitle, letterboxdError, letterboxdAttempts, letterboxdLastAttempt}>`
  - `resetFailed() → number` (rows affected)

Note: these live in `server/letterboxd/` rather than `server/db/queries.js` so
that all Letterboxd code changes together in one directory.

- [ ] **Step 1: Write the migration**

Create `mariadb/docker-entrypoint-initdb.d/002-letterboxd-sync.sql`:

```sql
-- Letterboxd sync state.
-- Safe to re-run: this file runs automatically only on an empty data
-- directory, so an existing database gets it applied by hand.

-- Added with DEFAULT 'skipped' so that every pre-existing row is born
-- 'skipped' and is never pushed to Letterboxd.
ALTER TABLE movies
  ADD COLUMN IF NOT EXISTS letterboxdStatus
    ENUM('pending','synced','failed','skipped') NOT NULL DEFAULT 'skipped';

-- New rows must queue, so flip the default now that existing rows are set.
-- Do NOT replace this pair with an UPDATE ... WHERE letterboxdStatus='pending':
-- that is not safe to re-run, as a second run would skip genuine pending work.
ALTER TABLE movies ALTER COLUMN letterboxdStatus SET DEFAULT 'pending';

ALTER TABLE movies
  ADD COLUMN IF NOT EXISTS letterboxdUri VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS letterboxdAttempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS letterboxdLastAttempt DATETIME NULL,
  ADD COLUMN IF NOT EXISTS letterboxdError VARCHAR(512) NULL;

CREATE INDEX IF NOT EXISTS idx_movies_lbstatus
  ON movies (letterboxdStatus, letterboxdLastAttempt);
```

- [ ] **Step 2: Verify the migration against a real MariaDB**

This is the one piece unit tests cannot cover, and the ordering trick is the
whole basis of "existing history is never pushed" — so prove it:

```bash
docker compose up -d mariadb
sleep 15
docker compose exec -T mariadb mariadb -uroot -p"$MOVIETHING_SQL_PASS" "$MOVIETHING_SQL_DB" <<'SQL'
CREATE TABLE IF NOT EXISTS movies (
  id INT AUTO_INCREMENT PRIMARY KEY, movieTitle VARCHAR(255), viewingDate DATE,
  movieURL VARCHAR(255), viewFormat VARCHAR(64), viewLocation VARCHAR(128),
  firstViewing TINYINT(1), movieGenre VARCHAR(64), movieReview TEXT);
INSERT INTO movies (movieTitle) VALUES ('Old Film');
SQL
docker compose exec -T mariadb mariadb -uroot -p"$MOVIETHING_SQL_PASS" "$MOVIETHING_SQL_DB" \
  < mariadb/docker-entrypoint-initdb.d/002-letterboxd-sync.sql
# Run it a SECOND time — must succeed and change nothing.
docker compose exec -T mariadb mariadb -uroot -p"$MOVIETHING_SQL_PASS" "$MOVIETHING_SQL_DB" \
  < mariadb/docker-entrypoint-initdb.d/002-letterboxd-sync.sql
docker compose exec -T mariadb mariadb -uroot -p"$MOVIETHING_SQL_PASS" "$MOVIETHING_SQL_DB" <<'SQL'
INSERT INTO movies (movieTitle) VALUES ('New Film');
SELECT movieTitle, letterboxdStatus FROM movies;
SQL
```

Expected, and the task fails if not exactly this:

```
Old Film   skipped
New Film   pending
```

- [ ] **Step 3: Write the failing tests**

Create `server/__tests__/letterboxd-queries.test.js`:

```js
'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
const { query } = require('../db');
const q = require('../letterboxd/queries');

describe('letterboxd queries', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getPendingCount returns a Number, not a BigInt', async () => {
    // mariadb returns BigInt for COUNT(*); arithmetic against Number throws.
    query.mockResolvedValue([{ n: 7n }]);
    const n = await q.getPendingCount();
    expect(n).toBe(7);
    expect(typeof n).toBe('number');
  });

  it('getEligibleRows only selects pending rows and honours the limit', async () => {
    query.mockResolvedValue([]);
    await q.getEligibleRows(10);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/letterboxdStatus = 'pending'/);
    expect(sql).toMatch(/ORDER BY viewingDate ASC/);
    expect(params).toEqual([10]);
  });

  it('getEligibleRows applies exponential backoff by attempt count', async () => {
    query.mockResolvedValue([]);
    await q.getEligibleRows(10);
    const [sql] = query.mock.calls[0];
    // Never attempted -> always eligible.
    expect(sql).toMatch(/letterboxdLastAttempt IS NULL/);
    // Otherwise 60 * 5^attempts seconds must have elapsed.
    expect(sql).toMatch(/POW\(5, letterboxdAttempts\)/);
  });

  it('markSynced stores the uri and clears the error', async () => {
    query.mockResolvedValue({});
    await q.markSynced(3, 'https://letterboxd.com/x/1/');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/letterboxdStatus = 'synced'/);
    expect(sql).toMatch(/letterboxdError = NULL/);
    expect(params).toEqual(['https://letterboxd.com/x/1/', 3]);
  });

  it('recordAttempt increments attempts and leaves the row pending', async () => {
    query.mockResolvedValue({});
    await q.recordAttempt(4, 'boom');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/letterboxdAttempts = letterboxdAttempts \+ 1/);
    expect(sql).not.toMatch(/letterboxdStatus/);
    expect(params).toEqual(['boom', 4]);
  });

  it('markSkipped records the reason without counting as a failure', async () => {
    query.mockResolvedValue({});
    await q.markSkipped(5, 'no imdb id');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/letterboxdStatus = 'skipped'/);
    expect(params).toEqual(['no imdb id', 5]);
  });

  it('getCounts returns every status, defaulting absent ones to 0', async () => {
    query.mockResolvedValue([
      { letterboxdStatus: 'pending', n: 2n },
      { letterboxdStatus: 'synced', n: 5n }
    ]);
    expect(await q.getCounts()).toEqual({ pending: 2, synced: 5, failed: 0, skipped: 0 });
  });

  it('resetFailed only touches failed rows and zeroes attempts', async () => {
    query.mockResolvedValue({ affectedRows: 3 });
    const n = await q.resetFailed();
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE letterboxdStatus = 'failed'/);
    expect(sql).toMatch(/letterboxdAttempts = 0/);
    expect(n).toBe(3);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx jest server/__tests__/letterboxd-queries.test.js`
Expected: FAIL — `Cannot find module '../letterboxd/queries'`.

- [ ] **Step 5: Implement `server/letterboxd/queries.js`**

```js
'use strict';

const { query } = require('../db');

const ROW_FIELDS =
  'id, movieTitle, viewingDate, movieURL, firstViewing, movieReview, letterboxdAttempts';

async function getPendingCount() {
  const rows = await query(
    "SELECT COUNT(*) AS n FROM movies WHERE letterboxdStatus = 'pending'", []
  );
  return Number(rows[0].n);
}

// Eligible = pending, and either never attempted or past its backoff window.
// Backoff is 60 * 5^attempts seconds: 1m, 5m, 25m, ~2h, ~10h.
async function getEligibleRows(limit) {
  return query(
    `SELECT ${ROW_FIELDS} FROM movies ` +
    "WHERE letterboxdStatus = 'pending' " +
    'AND (letterboxdLastAttempt IS NULL OR letterboxdLastAttempt < ' +
    'DATE_SUB(NOW(), INTERVAL (60 * POW(5, letterboxdAttempts)) SECOND)) ' +
    'ORDER BY viewingDate ASC, id ASC LIMIT ?',
    [limit]
  );
}

async function markSynced(id, uri) {
  await query(
    "UPDATE movies SET letterboxdStatus = 'synced', letterboxdUri = ?, " +
    'letterboxdError = NULL, letterboxdLastAttempt = NOW() WHERE id = ?',
    [uri, id]
  );
}

async function markFailed(id, message) {
  await query(
    "UPDATE movies SET letterboxdStatus = 'failed', letterboxdError = ?, " +
    'letterboxdLastAttempt = NOW() WHERE id = ?',
    [truncate(message), id]
  );
}

async function markSkipped(id, message) {
  await query(
    "UPDATE movies SET letterboxdStatus = 'skipped', letterboxdError = ?, " +
    'letterboxdLastAttempt = NOW() WHERE id = ?',
    [truncate(message), id]
  );
}

// Leaves letterboxdStatus alone: the row stays 'pending' for a later retry.
async function recordAttempt(id, message) {
  await query(
    'UPDATE movies SET letterboxdAttempts = letterboxdAttempts + 1, ' +
    'letterboxdError = ?, letterboxdLastAttempt = NOW() WHERE id = ?',
    [truncate(message), id]
  );
}

async function getCounts() {
  const rows = await query(
    'SELECT letterboxdStatus, COUNT(*) AS n FROM movies GROUP BY letterboxdStatus', []
  );
  const counts = { pending: 0, synced: 0, failed: 0, skipped: 0 };
  rows.forEach(r => { counts[r.letterboxdStatus] = Number(r.n); });
  return counts;
}

async function getRecentFailures(limit) {
  return query(
    'SELECT id, movieTitle, letterboxdError, letterboxdAttempts, letterboxdLastAttempt ' +
    "FROM movies WHERE letterboxdStatus = 'failed' " +
    'ORDER BY letterboxdLastAttempt DESC LIMIT ?',
    [limit]
  );
}

async function resetFailed() {
  const result = await query(
    "UPDATE movies SET letterboxdStatus = 'pending', letterboxdAttempts = 0, " +
    "letterboxdError = NULL WHERE letterboxdStatus = 'failed'", []
  );
  return Number(result.affectedRows || 0);
}

// letterboxdError is VARCHAR(512); an over-long message would abort the UPDATE
// and lose the status change along with it.
function truncate(message) {
  return String(message == null ? '' : message).slice(0, 512);
}

module.exports = {
  getPendingCount, getEligibleRows, markSynced, markFailed, markSkipped,
  recordAttempt, getCounts, getRecentFailures, resetFailed
};
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest server/__tests__/letterboxd-queries.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add mariadb/docker-entrypoint-initdb.d/002-letterboxd-sync.sql \
        server/letterboxd/queries.js server/__tests__/letterboxd-queries.test.js
git commit -m "feat: add Letterboxd sync state schema and queries"
```

---

### Task 3: Error taxonomy and configuration

**Files:**
- Create: `server/letterboxd/errors.js`
- Create: `server/letterboxd/config.js`
- Modify: `.env.example`
- Test: `server/__tests__/letterboxd-config.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `errors.js`: `LetterboxdError`, `AuthError`, `TransientError`, `PermanentError` (all `class ... extends Error`).
  - `config.js`: `loadConfig(env = process.env) → {enabled: false} | {enabled: true, cookie, csrf, intervalSeconds, batchLimit, pauseThreshold}`. Throws `Error` on an enabled-but-invalid configuration.

- [ ] **Step 1: Write `server/letterboxd/errors.js`**

No test file of its own — the taxonomy is exercised throughout Tasks 4 and 6,
which is where its behaviour actually matters.

```js
'use strict';

class LetterboxdError extends Error {
  constructor(message, options) {
    super(message);
    this.name = this.constructor.name;
    if (options && options.cause) this.cause = options.cause;
  }
}

// Session rejected. Halts the whole run; never consumes a retry attempt.
class AuthError extends LetterboxdError {}

// Network blip or 5xx. Worth retrying with backoff.
class TransientError extends LetterboxdError {}

// Letterboxd understood the request and refused it. Retrying cannot help.
class PermanentError extends LetterboxdError {}

module.exports = { LetterboxdError, AuthError, TransientError, PermanentError };
```

- [ ] **Step 2: Write the failing config tests**

Create `server/__tests__/letterboxd-config.test.js`:

```js
'use strict';

const { loadConfig } = require('../letterboxd/config');

describe('loadConfig', () => {
  it('is disabled when the flag is absent', () => {
    expect(loadConfig({})).toEqual({ enabled: false });
  });

  it('is disabled for any value other than the string "true"', () => {
    expect(loadConfig({ MOVIETHING_LETTERBOXD_ENABLED: '1' })).toEqual({ enabled: false });
    expect(loadConfig({ MOVIETHING_LETTERBOXD_ENABLED: 'yes' })).toEqual({ enabled: false });
    expect(loadConfig({ MOVIETHING_LETTERBOXD_ENABLED: 'false' })).toEqual({ enabled: false });
  });

  it('does not require a cookie while disabled', () => {
    expect(() => loadConfig({})).not.toThrow();
  });

  it('throws when enabled without a cookie', () => {
    expect(() => loadConfig({ MOVIETHING_LETTERBOXD_ENABLED: 'true' }))
      .toThrow(/MOVIETHING_LETTERBOXD_COOKIE/);
  });

  it('applies documented defaults when enabled', () => {
    const c = loadConfig({
      MOVIETHING_LETTERBOXD_ENABLED: 'true',
      MOVIETHING_LETTERBOXD_COOKIE: 'sess=abc'
    });
    expect(c).toEqual({
      enabled: true, cookie: 'sess=abc', csrf: '',
      intervalSeconds: 300, batchLimit: 10, pauseThreshold: 25
    });
  });

  it('parses numeric overrides', () => {
    const c = loadConfig({
      MOVIETHING_LETTERBOXD_ENABLED: 'true',
      MOVIETHING_LETTERBOXD_COOKIE: 'sess=abc',
      MOVIETHING_LETTERBOXD_INTERVAL: '60',
      MOVIETHING_LETTERBOXD_BATCH_LIMIT: '3',
      MOVIETHING_LETTERBOXD_PAUSE_THRESHOLD: '50'
    });
    expect(c.intervalSeconds).toBe(60);
    expect(c.batchLimit).toBe(3);
    expect(c.pauseThreshold).toBe(50);
  });

  it('rejects a non-numeric override rather than silently defaulting', () => {
    expect(() => loadConfig({
      MOVIETHING_LETTERBOXD_ENABLED: 'true',
      MOVIETHING_LETTERBOXD_COOKIE: 'sess=abc',
      MOVIETHING_LETTERBOXD_BATCH_LIMIT: 'ten'
    })).toThrow(/MOVIETHING_LETTERBOXD_BATCH_LIMIT/);
  });

  it('rejects a zero or negative override', () => {
    expect(() => loadConfig({
      MOVIETHING_LETTERBOXD_ENABLED: 'true',
      MOVIETHING_LETTERBOXD_COOKIE: 'sess=abc',
      MOVIETHING_LETTERBOXD_INTERVAL: '0'
    })).toThrow(/MOVIETHING_LETTERBOXD_INTERVAL/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest server/__tests__/letterboxd-config.test.js`
Expected: FAIL — `Cannot find module '../letterboxd/config'`.

- [ ] **Step 4: Implement `server/letterboxd/config.js`**

```js
'use strict';

// Parsed once at startup. Returns {enabled:false} rather than throwing when the
// feature is off, so that the vast majority of deployments need no new config
// at all and server/index.js's required-vars list stays untouched.
function loadConfig(env = process.env) {
  if (env.MOVIETHING_LETTERBOXD_ENABLED !== 'true') return { enabled: false };

  const cookie = env.MOVIETHING_LETTERBOXD_COOKIE;
  if (!cookie) {
    throw new Error(
      'MOVIETHING_LETTERBOXD_ENABLED is true but MOVIETHING_LETTERBOXD_COOKIE is not set'
    );
  }

  return {
    enabled: true,
    cookie,
    csrf: env.MOVIETHING_LETTERBOXD_CSRF || '',
    intervalSeconds: positiveInt(env, 'MOVIETHING_LETTERBOXD_INTERVAL', 300),
    batchLimit: positiveInt(env, 'MOVIETHING_LETTERBOXD_BATCH_LIMIT', 10),
    pauseThreshold: positiveInt(env, 'MOVIETHING_LETTERBOXD_PAUSE_THRESHOLD', 25)
  };
}

// A typo'd number must fail loudly at startup. Silently falling back to the
// default would leave the operator believing a setting had taken effect.
function positiveInt(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`);
  }
  return n;
}

module.exports = { loadConfig };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest server/__tests__/letterboxd-config.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 6: Document the variables in `.env.example`**

Append:

```bash
# --- Letterboxd auto-sync (all optional; disabled unless ENABLED is "true") ---
# Pushes newly added films to your Letterboxd diary. Existing history is
# never pushed. See docs/superpowers/specs/2026-09-05-letterboxd-sync-design.md
#MOVIETHING_LETTERBOXD_ENABLED=true
# Session cookie value copied from a browser logged into Letterboxd
# (DevTools > Application > Cookies > letterboxd.signed.in.as).
# Expires roughly annually; /api/letterboxd/status reports authOk:false.
#MOVIETHING_LETTERBOXD_COOKIE=
# CSRF cookie value (com.xk72.webparts.csrf). Optional: fetched automatically
# when blank.
#MOVIETHING_LETTERBOXD_CSRF=
# Seconds between sync runs. Default 300.
#MOVIETHING_LETTERBOXD_INTERVAL=300
# Entries pushed per run. Default 10.
#MOVIETHING_LETTERBOXD_BATCH_LIMIT=10
# Pending entries that trip the safety pause (guards against a bulk import
# mass-posting to your diary). Default 25.
#MOVIETHING_LETTERBOXD_PAUSE_THRESHOLD=25
```

- [ ] **Step 7: Commit**

```bash
git add server/letterboxd/errors.js server/letterboxd/config.js \
        server/__tests__/letterboxd-config.test.js .env.example
git commit -m "feat: add Letterboxd error taxonomy and configuration"
```

---

### Task 4: Queue logic

The heart of the feature, and the reason `client` and `db` are injected: this
runs entirely against fakes, with no network and no database.

**Files:**
- Create: `server/letterboxd/queue.js`
- Test: `server/__tests__/letterboxd-queue.test.js`

**Interfaces:**
- Consumes: `errors.js` (Task 3); the `queries.js` shape (Task 2) via the injected `db`.
- Produces:
  - `runOnce({client, db, limit, pauseThreshold}) → {pushed, failed, skipped, paused, authFailed, pending}`
  - `imdbIdFrom(movieURL: string|null) → string|null`
  - `MAX_ATTEMPTS` (= 5)
  - Expects `client.logEntry({imdbId, watchedDate, rewatch, review}) → {uri}`.

- [ ] **Step 1: Write the failing tests**

Create `server/__tests__/letterboxd-queue.test.js`:

```js
'use strict';

const { runOnce, imdbIdFrom, MAX_ATTEMPTS } = require('../letterboxd/queue');
const { AuthError, TransientError, PermanentError } = require('../letterboxd/errors');

function makeDb(overrides = {}) {
  return {
    getPendingCount: jest.fn().mockResolvedValue(1),
    getEligibleRows: jest.fn().mockResolvedValue([]),
    markSynced: jest.fn().mockResolvedValue(),
    markFailed: jest.fn().mockResolvedValue(),
    markSkipped: jest.fn().mockResolvedValue(),
    recordAttempt: jest.fn().mockResolvedValue(),
    ...overrides
  };
}

function row(over = {}) {
  return {
    id: 1,
    movieTitle: 'Heat',
    viewingDate: new Date('1995-12-15T00:00:00Z'),
    movieURL: 'https://www.imdb.com/title/tt0113277/',
    firstViewing: 1,
    movieReview: 'Great',
    letterboxdAttempts: 0,
    ...over
  };
}

describe('imdbIdFrom', () => {
  it('extracts 7- and 8-digit ids', () => {
    expect(imdbIdFrom('https://www.imdb.com/title/tt0113277/')).toBe('tt0113277');
    expect(imdbIdFrom('https://www.imdb.com/title/tt12345678/')).toBe('tt12345678');
  });

  it('returns null for a festival url with no imdb id', () => {
    expect(imdbIdFrom('https://iffboston.org/events/test-short/')).toBeNull();
  });

  it('returns null for null or empty input', () => {
    expect(imdbIdFrom(null)).toBeNull();
    expect(imdbIdFrom('')).toBeNull();
  });
});

describe('runOnce', () => {
  it('pushes a pending row and marks it synced', async () => {
    const db = makeDb({ getEligibleRows: jest.fn().mockResolvedValue([row()]) });
    const client = { logEntry: jest.fn().mockResolvedValue({ uri: 'https://lb/x/1/' }) };

    const result = await runOnce({ client, db, limit: 10, pauseThreshold: 25 });

    expect(client.logEntry).toHaveBeenCalledWith({
      imdbId: 'tt0113277',
      watchedDate: '1995-12-15',
      rewatch: false,        // firstViewing === 1 means NOT a rewatch
      review: 'Great'
    });
    expect(db.markSynced).toHaveBeenCalledWith(1, 'https://lb/x/1/');
    expect(result.pushed).toBe(1);
  });

  it('sends rewatch:true when firstViewing is 0', async () => {
    const db = makeDb({ getEligibleRows: jest.fn().mockResolvedValue([row({ firstViewing: 0 })]) });
    const client = { logEntry: jest.fn().mockResolvedValue({ uri: 'u' }) };
    await runOnce({ client, db, limit: 10, pauseThreshold: 25 });
    expect(client.logEntry.mock.calls[0][0].rewatch).toBe(true);
  });

  it('sends an empty review when movieReview is null', async () => {
    const db = makeDb({ getEligibleRows: jest.fn().mockResolvedValue([row({ movieReview: null })]) });
    const client = { logEntry: jest.fn().mockResolvedValue({ uri: 'u' }) };
    await runOnce({ client, db, limit: 10, pauseThreshold: 25 });
    expect(client.logEntry.mock.calls[0][0].review).toBe('');
  });

  it('pauses without pushing when pending exceeds the threshold', async () => {
    const db = makeDb({ getPendingCount: jest.fn().mockResolvedValue(200) });
    const client = { logEntry: jest.fn() };

    const result = await runOnce({ client, db, limit: 10, pauseThreshold: 25 });

    expect(result.paused).toBe(true);
    expect(result.pending).toBe(200);
    expect(client.logEntry).not.toHaveBeenCalled();
    expect(db.getEligibleRows).not.toHaveBeenCalled();  // pause precedes selection
  });

  it('does not pause when pending exactly equals the threshold', async () => {
    const db = makeDb({ getPendingCount: jest.fn().mockResolvedValue(25) });
    const client = { logEntry: jest.fn().mockResolvedValue({ uri: 'u' }) };
    const result = await runOnce({ client, db, limit: 10, pauseThreshold: 25 });
    expect(result.paused).toBe(false);
  });

  it('skips (does not fail) a row with no imdb id', async () => {
    const db = makeDb({
      getEligibleRows: jest.fn().mockResolvedValue([row({ movieURL: 'https://iffboston.org/x/' })])
    });
    const client = { logEntry: jest.fn() };

    const result = await runOnce({ client, db, limit: 10, pauseThreshold: 25 });

    expect(db.markSkipped).toHaveBeenCalledWith(1, 'no imdb id');
    expect(db.markFailed).not.toHaveBeenCalled();
    expect(client.logEntry).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('halts the whole run on AuthError without consuming an attempt', async () => {
    const db = makeDb({ getEligibleRows: jest.fn().mockResolvedValue([row({ id: 1 }), row({ id: 2 })]) });
    const client = { logEntry: jest.fn().mockRejectedValue(new AuthError('session expired')) };

    const result = await runOnce({ client, db, limit: 10, pauseThreshold: 25 });

    expect(result.authFailed).toBe(true);
    expect(client.logEntry).toHaveBeenCalledTimes(1);   // stopped, did not try row 2
    expect(db.recordAttempt).not.toHaveBeenCalled();    // retry budget untouched
    expect(db.markFailed).not.toHaveBeenCalled();       // backlog stays pending
  });

  it('fails a row permanently on PermanentError and continues', async () => {
    const db = makeDb({ getEligibleRows: jest.fn().mockResolvedValue([row({ id: 1 }), row({ id: 2 })]) });
    const client = {
      logEntry: jest.fn()
        .mockRejectedValueOnce(new PermanentError('film not found'))
        .mockResolvedValueOnce({ uri: 'u' })
    };

    const result = await runOnce({ client, db, limit: 10, pauseThreshold: 25 });

    expect(db.markFailed).toHaveBeenCalledWith(1, 'film not found');
    expect(db.markSynced).toHaveBeenCalledWith(2, 'u');
    expect(result.failed).toBe(1);
    expect(result.pushed).toBe(1);
  });

  it('records an attempt and stays pending on TransientError', async () => {
    const db = makeDb({ getEligibleRows: jest.fn().mockResolvedValue([row({ letterboxdAttempts: 0 })]) });
    const client = { logEntry: jest.fn().mockRejectedValue(new TransientError('503')) };

    await runOnce({ client, db, limit: 10, pauseThreshold: 25 });

    expect(db.recordAttempt).toHaveBeenCalledWith(1, '503');
    expect(db.markFailed).not.toHaveBeenCalled();
  });

  it('gives up on a transient error at the attempt cap', async () => {
    const db = makeDb({
      getEligibleRows: jest.fn().mockResolvedValue([row({ letterboxdAttempts: MAX_ATTEMPTS - 1 })])
    });
    const client = { logEntry: jest.fn().mockRejectedValue(new TransientError('503')) };

    await runOnce({ client, db, limit: 10, pauseThreshold: 25 });

    expect(db.markFailed).toHaveBeenCalledWith(1, '503');
    expect(db.recordAttempt).not.toHaveBeenCalled();
  });

  it('treats an unrecognised error as transient rather than crashing the run', async () => {
    const db = makeDb({ getEligibleRows: jest.fn().mockResolvedValue([row()]) });
    const client = { logEntry: jest.fn().mockRejectedValue(new TypeError('undefined is not a function')) };

    await expect(runOnce({ client, db, limit: 10, pauseThreshold: 25 })).resolves.toBeDefined();
    expect(db.recordAttempt).toHaveBeenCalled();
  });

  it('passes the batch limit through to the query', async () => {
    const db = makeDb();
    await runOnce({ client: { logEntry: jest.fn() }, db, limit: 3, pauseThreshold: 25 });
    expect(db.getEligibleRows).toHaveBeenCalledWith(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest server/__tests__/letterboxd-queue.test.js`
Expected: FAIL — `Cannot find module '../letterboxd/queue'`.

- [ ] **Step 3: Implement `server/letterboxd/queue.js`**

```js
'use strict';

const { AuthError, PermanentError } = require('./errors');
const { formatViewingDate } = require('../helpers/dates');

const MAX_ATTEMPTS = 5;

function imdbIdFrom(movieURL) {
  const match = movieURL && movieURL.match(/tt\d{7,8}/);
  return match ? match[0] : null;
}

/**
 * Drain up to `limit` pending entries to Letterboxd.
 *
 * `client` and `db` are injected so this runs against fakes in tests: the
 * retry policy is the part worth testing, and it must not need a network or
 * a database to exercise.
 */
async function runOnce({ client, db, limit, pauseThreshold }) {
  const pending = await db.getPendingCount();

  // Checked before selection: a bulk import must not get its first batch
  // through before the guard notices.
  if (pending > pauseThreshold) {
    return { pushed: 0, failed: 0, skipped: 0, paused: true, authFailed: false, pending };
  }

  const rows = await db.getEligibleRows(limit);
  let pushed = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const imdbId = imdbIdFrom(row.movieURL);

    // Not a failure: plenty of festival shorts have no IMDb entry at all, and
    // no retry could ever help. Recorded as skipped so the failure list stays
    // a meaningful signal.
    if (!imdbId) {
      await db.markSkipped(row.id, 'no imdb id');
      skipped++;
      continue;
    }

    let uri;
    try {
      ({ uri } = await client.logEntry({
        imdbId,
        watchedDate: formatViewingDate(row.viewingDate),
        rewatch: row.firstViewing !== 1,
        review: row.movieReview || ''
      }));
    } catch (err) {
      // Abandon the run entirely. Every remaining row would fail identically,
      // and burning their attempt counts would mass-fail the backlog over a
      // problem fixed by pasting one new cookie.
      if (err instanceof AuthError) {
        return { pushed, failed, skipped, paused: false, authFailed: true, pending };
      }
      try {
        // PermanentError, or a transient one that has run out of attempts.
        if (err instanceof PermanentError || row.letterboxdAttempts + 1 >= MAX_ATTEMPTS) {
          await db.markFailed(row.id, err.message);
          failed++;
        } else {
          await db.recordAttempt(row.id, err.message);
        }
      } catch (dbErr) {
        // One row's bookkeeping failure must not abandon the rest of the batch.
        // The row stays pending and is retried next run.
        console.error(`letterboxd: could not record outcome for row ${row.id}: ${dbErr.message}`);
      }
      continue;
    }

    // The entry now EXISTS on Letterboxd. Whatever happens below, this row must
    // never be pushed again: a second push puts a duplicate in a public diary,
    // and Letterboxd cannot tell a duplicate from a genuine rewatch. This is why
    // the network call and the bookkeeping write are separate try blocks.
    try {
      await db.markSynced(row.id, uri);
      pushed++;
    } catch (err) {
      console.error(`letterboxd: posted row ${row.id} to ${uri} but could not record it: ${err.message}`);
      // 'skipped', not 'failed': POST /api/letterboxd/retry re-queues failed rows,
      // which would duplicate this entry. Skipped rows are never pushed again by
      // any path. The uri is preserved so the row can be reconciled by hand.
      try {
        await db.markSkipped(row.id, `posted to letterboxd (${uri}) but recording failed: ${err.message}`);
      } catch (dbErr) {
        console.error(`letterboxd: could not mark row ${row.id} skipped: ${dbErr.message}`);
      }
      // Counted as failed even though the row is 'skipped': the row status
      // protects against duplicates, this counter reports the run had a problem.
      failed++;
    }
  }

  return { pushed, failed, skipped, paused: false, authFailed: false, pending };
}

module.exports = { runOnce, imdbIdFrom, MAX_ATTEMPTS };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest server/__tests__/letterboxd-queue.test.js`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add server/letterboxd/queue.js server/__tests__/letterboxd-queue.test.js
git commit -m "feat: add Letterboxd sync queue with backoff and pause guard"
```

---

### Task 5: Worker

**Files:**
- Create: `server/letterboxd/worker.js`
- Test: `server/__tests__/letterboxd-worker.test.js`

**Interfaces:**
- Consumes: `runOnce` from Task 4 (injected).
- Produces: `createWorker({config, db, client, runOnce}) → {start(), stop(), runNow({confirm}), getState()}`.
  `getState() → {enabled, running, paused, authOk, lastRun, lastResult, lastError}`.

- [ ] **Step 1: Write the failing tests**

Create `server/__tests__/letterboxd-worker.test.js`:

```js
'use strict';

const { createWorker } = require('../letterboxd/worker');

const config = { enabled: true, intervalSeconds: 300, batchLimit: 10, pauseThreshold: 25 };
const ok = { pushed: 1, failed: 0, skipped: 0, paused: false, authFailed: false, pending: 1 };

function makeWorker(runOnce, cfg = config) {
  return createWorker({ config: cfg, db: {}, client: {}, runOnce });
}

describe('createWorker', () => {
  afterEach(() => jest.useRealTimers());

  it('does not schedule anything when disabled', () => {
    jest.useFakeTimers();
    const runOnce = jest.fn();
    const w = makeWorker(runOnce, { enabled: false });
    w.start();
    jest.advanceTimersByTime(10 * 60 * 1000);
    expect(runOnce).not.toHaveBeenCalled();
    expect(w.getState().enabled).toBe(false);
  });

  it('runs on the configured interval once started', async () => {
    jest.useFakeTimers();
    const runOnce = jest.fn().mockResolvedValue(ok);
    const w = makeWorker(runOnce);
    w.start();
    expect(runOnce).not.toHaveBeenCalled();       // no immediate run on boot
    await jest.advanceTimersByTimeAsync(300 * 1000);
    expect(runOnce).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(300 * 1000);
    expect(runOnce).toHaveBeenCalledTimes(2);
    w.stop();
  });

  it('stop() prevents further runs', async () => {
    jest.useFakeTimers();
    const runOnce = jest.fn().mockResolvedValue(ok);
    const w = makeWorker(runOnce);
    w.start();
    w.stop();
    await jest.advanceTimersByTimeAsync(900 * 1000);
    expect(runOnce).not.toHaveBeenCalled();
  });

  it('never overlaps runs', async () => {
    jest.useFakeTimers();
    let release;
    const runOnce = jest.fn(() => new Promise(r => { release = () => r(ok); }));
    const w = makeWorker(runOnce);
    w.start();
    await jest.advanceTimersByTimeAsync(300 * 1000);
    await jest.advanceTimersByTimeAsync(300 * 1000);
    expect(runOnce).toHaveBeenCalledTimes(1);   // second tick skipped while busy
    release();
    w.stop();
  });

  it('records authOk:false after an auth failure and stops the timer', async () => {
    jest.useFakeTimers();
    const runOnce = jest.fn().mockResolvedValue({ ...ok, authFailed: true });
    const w = makeWorker(runOnce);
    w.start();
    await jest.advanceTimersByTimeAsync(300 * 1000);
    expect(w.getState().authOk).toBe(false);
    // Hammering a dead session helps nobody; a new cookie needs a restart or
    // an explicit runNow().
    await jest.advanceTimersByTimeAsync(300 * 1000);
    expect(runOnce).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it('surfaces the paused flag in state', async () => {
    const runOnce = jest.fn().mockResolvedValue({ ...ok, paused: true, pending: 200 });
    const w = makeWorker(runOnce);
    await w.runNow();
    expect(w.getState().paused).toBe(true);
  });

  it('runNow({confirm:true}) overrides the pause threshold for one run', async () => {
    const runOnce = jest.fn().mockResolvedValue(ok);
    const w = makeWorker(runOnce);
    await w.runNow({ confirm: true });
    expect(runOnce.mock.calls[0][0].pauseThreshold).toBe(Infinity);
  });

  it('runNow() without confirm uses the configured threshold', async () => {
    const runOnce = jest.fn().mockResolvedValue(ok);
    const w = makeWorker(runOnce);
    await w.runNow();
    expect(runOnce.mock.calls[0][0].pauseThreshold).toBe(25);
  });

  it('runNow() clears a prior auth failure so a new cookie takes effect', async () => {
    const runOnce = jest.fn()
      .mockResolvedValueOnce({ ...ok, authFailed: true })
      .mockResolvedValueOnce(ok);
    const w = makeWorker(runOnce);
    await w.runNow();
    expect(w.getState().authOk).toBe(false);
    await w.runNow();
    expect(w.getState().authOk).toBe(true);
  });

  it('survives a thrown error and records it', async () => {
    const runOnce = jest.fn().mockRejectedValue(new Error('db down'));
    const w = makeWorker(runOnce);
    await expect(w.runNow()).resolves.toBeDefined();
    expect(w.getState().lastError).toMatch(/db down/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest server/__tests__/letterboxd-worker.test.js`
Expected: FAIL — `Cannot find module '../letterboxd/worker'`.

- [ ] **Step 3: Implement `server/letterboxd/worker.js`**

```js
'use strict';

/**
 * Interval-driven queue drainer.
 *
 * `runOnce` is injected so the scheduling behaviour (overlap, pause, auth
 * halt) can be tested with fake timers and no network.
 */
function createWorker({ config, db, client, runOnce }) {
  let timer = null;
  let running = false;
  const state = {
    paused: false,
    authOk: true,
    lastRun: null,
    lastResult: null,
    lastError: null
  };

  async function execute({ confirm = false } = {}) {
    // Discriminated outcome: the caller must be able to tell "busy" from
    // "errored", or an HTTP route reports a database failure as "try again".
    if (running) return { ok: false, reason: 'busy' };
    running = true;
    try {
      const result = await runOnce({
        client,
        db,
        limit: config.batchLimit,
        // A confirmed manual run is the operator saying "yes, push the backlog".
        pauseThreshold: confirm ? Infinity : config.pauseThreshold
      });
      state.lastResult = result;
      state.paused = result.paused;
      state.authOk = !result.authFailed;
      state.lastError = null;
      if (result.authFailed) stop();
      return { ok: true, result };
    } catch (err) {
      state.lastError = err.message;
      return { ok: false, reason: 'error', error: err.message };
    } finally {
      state.lastRun = new Date().toISOString();
      running = false;
    }
  }

  function start() {
    if (!config.enabled || timer) return;
    timer = setInterval(() => { execute(); }, config.intervalSeconds * 1000);
    // Do not hold the event loop open; the HTTP server governs process life.
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  // A manual run always executes, even after start() halted on an auth
  // failure — that is how a freshly pasted cookie gets tried.
  async function runNow(options = {}) {
    const outcome = await execute(options);
    if (outcome.ok && !outcome.result.authFailed && !timer && config.enabled) start();
    return outcome;
  }

  function getState() {
    return { enabled: config.enabled, running, ...state };
  }

  return { start, stop, runNow, getState };
}

module.exports = { createWorker };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest server/__tests__/letterboxd-worker.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add server/letterboxd/worker.js server/__tests__/letterboxd-worker.test.js
git commit -m "feat: add Letterboxd sync worker"
```

---

### Task 6: HTTP client

**Depends on Task 1.** The constants below are the hypothesis; replace them with
the spike's recorded findings wherever they differ. The module structure and the
error mapping do not change.

**Files:**
- Create: `server/letterboxd/client.js`
- Test: `server/__tests__/letterboxd-client.test.js`

**Interfaces:**
- Consumes: `errors.js` (Task 3); `config` (Task 3).
- Produces: `createClient(config) → {logEntry({imdbId, watchedDate, rewatch, review}) → {uri}}`, throwing `AuthError`/`TransientError`/`PermanentError`.

- [ ] **Step 1: Write the failing tests**

Create `server/__tests__/letterboxd-client.test.js`:

```js
'use strict';

const { createClient } = require('../letterboxd/client');
const { AuthError, TransientError, PermanentError } = require('../letterboxd/errors');

const config = { enabled: true, cookie: 'sess=abc', csrf: 'tok123' };

// Native fetch, not the node-fetch mock in __tests__/setup.js.
function mockFetch(...responses) {
  const fn = jest.fn();
  responses.forEach(r => fn.mockResolvedValueOnce(r));
  global.fetch = fn;
  return fn;
}

function filmPage(id = '51234') {
  return {
    ok: true, status: 200, url: 'https://letterboxd.com/film/heat/',
    text: async () => `<div data-film-id="${id}"></div>`,
    headers: new Map()
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300, status,
    url: 'https://letterboxd.com/s/save-diary-entry',
    text: async () => JSON.stringify(body),
    headers: new Map()
  };
}

const entry = { imdbId: 'tt0113277', watchedDate: '1995-12-15', rewatch: false, review: 'Great' };

afterEach(() => { delete global.fetch; jest.clearAllMocks(); });

describe('logEntry', () => {
  it('resolves the film id then posts the diary entry', async () => {
    const fetchMock = mockFetch(
      filmPage('51234'),
      jsonResponse(200, { result: true, url: '/user/film/heat/' })
    );

    const result = await createClient(config).logEntry(entry);

    expect(fetchMock.mock.calls[0][0]).toContain('/imdb/tt0113277');
    const [url, opts] = fetchMock.mock.calls[1];
    expect(url).toContain('/s/save-diary-entry');
    expect(opts.method).toBe('POST');
    const body = new URLSearchParams(opts.body);
    expect(body.get('filmId')).toBe('51234');
    expect(body.get('viewingDateStr')).toBe('1995-12-15');
    expect(body.get('rewatch')).toBe('false');
    expect(body.get('review')).toBe('Great');
    expect(body.get('__csrf')).toBe('tok123');
    expect(result.uri).toContain('/user/film/heat/');
  });

  it('sends the session cookie on both requests', async () => {
    const fetchMock = mockFetch(filmPage(), jsonResponse(200, { result: true, url: '/x/' }));
    await createClient(config).logEntry(entry);
    fetchMock.mock.calls.forEach(([, opts]) => {
      expect(opts.headers.Cookie).toContain('sess=abc');
    });
  });

  it('throws AuthError when redirected to sign-in', async () => {
    mockFetch({
      ok: true, status: 200, url: 'https://letterboxd.com/sign-in/',
      text: async () => '<html>sign in</html>', headers: new Map()
    });
    await expect(createClient(config).logEntry(entry)).rejects.toThrow(AuthError);
  });

  it('throws AuthError on a 403 from the log endpoint', async () => {
    mockFetch(filmPage(), jsonResponse(403, { result: false, messages: ['Not signed in'] }));
    await expect(createClient(config).logEntry(entry)).rejects.toThrow(AuthError);
  });

  it('throws PermanentError when the imdb id resolves to no film', async () => {
    mockFetch({
      ok: false, status: 404, url: 'https://letterboxd.com/imdb/tt9999999/',
      text: async () => 'Not found', headers: new Map()
    });
    await expect(createClient(config).logEntry(entry)).rejects.toThrow(PermanentError);
  });

  it('throws PermanentError when the film page carries no film id', async () => {
    mockFetch({
      ok: true, status: 200, url: 'https://letterboxd.com/film/heat/',
      text: async () => '<html>no id here</html>', headers: new Map()
    });
    await expect(createClient(config).logEntry(entry)).rejects.toThrow(PermanentError);
  });

  it('throws PermanentError when the endpoint reports result:false', async () => {
    mockFetch(filmPage(), jsonResponse(200, { result: false, messages: ['Invalid date'] }));
    await expect(createClient(config).logEntry(entry)).rejects.toThrow(PermanentError);
  });

  it('throws TransientError on a 5xx', async () => {
    mockFetch(filmPage(), jsonResponse(503, {}));
    await expect(createClient(config).logEntry(entry)).rejects.toThrow(TransientError);
  });

  it('throws TransientError on a network failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(createClient(config).logEntry(entry)).rejects.toThrow(TransientError);
  });

  it('throws TransientError when the response is not JSON', async () => {
    mockFetch(filmPage(), {
      ok: true, status: 200, url: 'https://letterboxd.com/s/save-diary-entry',
      text: async () => '<html>maintenance</html>', headers: new Map()
    });
    await expect(createClient(config).logEntry(entry)).rejects.toThrow(TransientError);
  });

  it('sends rewatch=true when rewatch is set', async () => {
    const fetchMock = mockFetch(filmPage(), jsonResponse(200, { result: true, url: '/x/' }));
    await createClient(config).logEntry({ ...entry, rewatch: true });
    expect(new URLSearchParams(fetchMock.mock.calls[1][1].body).get('rewatch')).toBe('true');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest server/__tests__/letterboxd-client.test.js`
Expected: FAIL — `Cannot find module '../letterboxd/client'`.

- [ ] **Step 3: Implement `server/letterboxd/client.js`**

Reconcile `BASE`, `LOG_PATH`, and the `URLSearchParams` field names against the
spike findings before running the tests.

```js
'use strict';

const { AuthError, TransientError, PermanentError } = require('./errors');

const BASE = 'https://letterboxd.com';
const LOG_PATH = '/s/save-diary-entry';
// Letterboxd serves a different response to obvious bots.
const USER_AGENT = 'Mozilla/5.0 (compatible; moviething/1.0)';

function createClient(config) {
  function headers(extra) {
    return {
      Cookie: config.csrf
        ? `${config.cookie}; com.xk72.webparts.csrf=${config.csrf}`
        : config.cookie,
      'User-Agent': USER_AGENT,
      'X-Requested-With': 'XMLHttpRequest',
      ...extra
    };
  }

  // Any transport-level failure is retryable; only Letterboxd's own answers
  // are permanent.
  async function request(url, options) {
    try {
      return await fetch(url, options);
    } catch (err) {
      throw new TransientError(`request to ${url} failed: ${err.message}`, { cause: err });
    }
  }

  async function resolveFilmId(imdbId) {
    const res = await request(`${BASE}/imdb/${imdbId}/`, {
      headers: headers(), redirect: 'follow'
    });

    if (res.url && res.url.includes('/sign-in')) {
      throw new AuthError('session rejected: redirected to sign-in');
    }
    if (res.status === 404) {
      throw new PermanentError(`no letterboxd film for ${imdbId}`);
    }
    if (res.status >= 500) {
      throw new TransientError(`film lookup returned ${res.status}`);
    }
    if (!res.ok) {
      throw new PermanentError(`film lookup returned ${res.status}`);
    }

    const html = await res.text();
    const match = html.match(/data-film-id="(\d+)"/);
    if (!match) {
      // Either the markup changed or the page is not a film page. Not
      // retryable either way; a human needs to look.
      throw new PermanentError(`could not find film id for ${imdbId}`);
    }
    return match[1];
  }

  async function logEntry({ imdbId, watchedDate, rewatch, review }) {
    const filmId = await resolveFilmId(imdbId);

    const body = new URLSearchParams({
      __csrf: config.csrf || '',
      filmId,
      specifiedDate: 'true',
      viewingDateStr: watchedDate,
      rewatch: String(rewatch),
      review: review || '',
      tags: '',
      rating: '',
      liked: 'false'
    });

    const res = await request(`${BASE}${LOG_PATH}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: body.toString()
    });

    if (res.status === 401 || res.status === 403) {
      throw new AuthError(`log entry rejected with ${res.status}`);
    }
    if (res.status >= 500) {
      throw new TransientError(`log entry returned ${res.status}`);
    }

    const text = await res.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      // An HTML body here means a maintenance or challenge page, not a
      // rejection of this entry. Retrying is reasonable.
      throw new TransientError('log entry returned a non-JSON response');
    }

    if (!payload.result) {
      const detail = (payload.messages || []).join('; ') || 'unknown error';
      throw new PermanentError(`letterboxd rejected the entry: ${detail}`);
    }

    // The endpoint may return either an absolute URL or a site-root path.
    const uri = payload.url
      ? (payload.url.startsWith('http') ? payload.url : `${BASE}${payload.url}`)
      : BASE;
    return { uri };
  }

  return { logEntry };
}

module.exports = { createClient };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest server/__tests__/letterboxd-client.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add server/letterboxd/client.js server/__tests__/letterboxd-client.test.js
git commit -m "feat: add Letterboxd HTTP client"
```

---

### Task 7: Routes and wiring

**Files:**
- Create: `server/letterboxd/index.js`
- Create: `server/routes/letterboxd.js`
- Modify: `server/index.js` (add require near lines 8-14; mount near line 42; start the worker inside `createServer`)
- Test: `server/__tests__/letterboxd-routes.test.js`

**Interfaces:**
- Consumes: `loadConfig` (Task 3), `queries` (Task 2), `createClient` (Task 6), `createWorker` (Task 5), `runOnce` (Task 4).
- Produces: `server/letterboxd/index.js` exports `{ worker, config }` — a lazily built singleton. Routes: `GET /api/letterboxd/status`, `POST /api/letterboxd/sync[?confirm=true]`, `POST /api/letterboxd/retry`.

Note: `confirm` is a **query parameter**, not a body field. The spec sketched it
as a JSON body, but validated bodies here use the `{json: "<stringified>"}`
convention (`server/middleware/validate.js`), which is awkward for an
operational endpoint you reach for with `curl`. No zod schema is needed.

- [ ] **Step 1: Write the failing tests**

Create `server/__tests__/letterboxd-routes.test.js`:

```js
'use strict';

const request = require('supertest');

const mockWorker = {
  getState: jest.fn(),
  runNow: jest.fn(),
  start: jest.fn(),
  stop: jest.fn()
};
const mockQueries = {
  getCounts: jest.fn(),
  getRecentFailures: jest.fn(),
  resetFailed: jest.fn()
};

jest.mock('../letterboxd', () => ({ worker: mockWorker, config: { enabled: true } }));
jest.mock('../letterboxd/queries', () => mockQueries);

const { app } = require('../index');

const AUTH = ['X-Authentik-Username', 'testuser'];

describe('letterboxd routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWorker.getState.mockReturnValue({
      enabled: true, running: false, paused: false, authOk: true,
      lastRun: '2026-09-05T00:00:00.000Z', lastResult: null, lastError: null
    });
    mockQueries.getCounts.mockResolvedValue({ pending: 2, synced: 10, failed: 1, skipped: 400 });
    mockQueries.getRecentFailures.mockResolvedValue([
      { id: 7, movieTitle: 'Heat', letterboxdError: 'boom', letterboxdAttempts: 5, letterboxdLastAttempt: null }
    ]);
  });

  describe('GET /api/letterboxd/status', () => {
    it('returns worker state, counts and recent failures', async () => {
      const res = await request(app).get('/api/letterboxd/status').set(...AUTH).expect(200);
      expect(res.body.data.enabled).toBe(true);
      expect(res.body.data.authOk).toBe(true);
      expect(res.body.data.counts).toEqual({ pending: 2, synced: 10, failed: 1, skipped: 400 });
      expect(res.body.data.recentFailures).toHaveLength(1);
    });

    it('requires auth', async () => {
      await request(app).get('/api/letterboxd/status').expect(401);
    });
  });

  describe('POST /api/letterboxd/sync', () => {
    it('triggers a run and returns the result', async () => {
      mockWorker.runNow.mockResolvedValue({ ok: true, result: { pushed: 2, failed: 0, skipped: 0, paused: false } });
      const res = await request(app).post('/api/letterboxd/sync').set(...AUTH).expect(200);
      expect(mockWorker.runNow).toHaveBeenCalledWith({ confirm: false });
      expect(res.body.data.pushed).toBe(2);
    });

    it('passes confirm=true through from the query string', async () => {
      mockWorker.runNow.mockResolvedValue({ ok: true, result: { pushed: 200, failed: 0, skipped: 0, paused: false } });
      await request(app).post('/api/letterboxd/sync?confirm=true').set(...AUTH).expect(200);
      expect(mockWorker.runNow).toHaveBeenCalledWith({ confirm: true });
    });

    it('reports 409 when the run paused on the threshold', async () => {
      mockWorker.runNow.mockResolvedValue({ ok: true, result: { pushed: 0, failed: 0, skipped: 0, paused: true, pending: 200 } });
      const res = await request(app).post('/api/letterboxd/sync').set(...AUTH).expect(409);
      expect(res.body.error).toMatch(/confirm=true/);
    });

    it('returns 409 when a run is already in progress', async () => {
      mockWorker.runNow.mockResolvedValue({ ok: false, reason: 'busy' });
      const res = await request(app).post('/api/letterboxd/sync').set(...AUTH).expect(409);
      expect(res.body.error).toMatch(/already in progress/);
    });

    it('returns 500, not 409, when the run itself errored', async () => {
      // A database failure must not be reported to the user as "try again".
      mockWorker.runNow.mockResolvedValue({ ok: false, reason: 'error', error: 'db down' });
      const res = await request(app).post('/api/letterboxd/sync').set(...AUTH).expect(500);
      expect(res.body.error).toMatch(/db down/);
    });

    it('requires auth', async () => {
      await request(app).post('/api/letterboxd/sync').expect(401);
      expect(mockWorker.runNow).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/letterboxd/retry', () => {
    it('resets failed rows and reports the count', async () => {
      mockQueries.resetFailed.mockResolvedValue(3);
      const res = await request(app).post('/api/letterboxd/retry').set(...AUTH).expect(200);
      expect(res.body.data).toEqual({ ok: true, requeued: 3 });
    });

    it('requires auth', async () => {
      await request(app).post('/api/letterboxd/retry').expect(401);
      expect(mockQueries.resetFailed).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest server/__tests__/letterboxd-routes.test.js`
Expected: FAIL — `Cannot find module '../letterboxd'`.

- [ ] **Step 3: Create the singleton `server/letterboxd/index.js`**

```js
'use strict';

const { loadConfig } = require('./config');
const { createClient } = require('./client');
const { createWorker } = require('./worker');
const { runOnce } = require('./queue');
const queries = require('./queries');

// Built once at require time. loadConfig throws on an enabled-but-invalid
// configuration, which surfaces at startup rather than on the first sync.
const config = loadConfig();

const worker = createWorker({
  config,
  db: queries,
  client: config.enabled ? createClient(config) : null,
  runOnce
});

module.exports = { config, worker };
```

- [ ] **Step 4: Create `server/routes/letterboxd.js`**

```js
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { worker } = require('../letterboxd');
const queries = require('../letterboxd/queries');

const router = express.Router();

router.get('/letterboxd/status', requireAuth, async (req, res, next) => {
  try {
    const [counts, recentFailures] = await Promise.all([
      queries.getCounts(),
      queries.getRecentFailures(10)
    ]);
    res.json({ data: { ...worker.getState(), counts, recentFailures } });
  } catch (err) {
    next(err);
  }
});

router.post('/letterboxd/sync', requireAuth, async (req, res, next) => {
  try {
    const confirm = req.query.confirm === 'true';
    const outcome = await worker.runNow({ confirm });

    // 'busy' is a real 409 (retry later); 'error' is a 500. Collapsing both to
    // one message would tell a user with a broken database to just try again.
    if (!outcome.ok) {
      if (outcome.reason === 'busy') {
        return res.status(409).json({ error: 'A sync run is already in progress.' });
      }
      return res.status(500).json({ error: outcome.error });
    }

    const result = outcome.result;
    if (result.paused) {
      return res.status(409).json({
        error: `${result.pending} entries pending, above the pause threshold. ` +
               'Re-send with ?confirm=true to push them all.'
      });
    }
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/letterboxd/retry', requireAuth, async (req, res, next) => {
  try {
    const requeued = await queries.resetFailed();
    res.json({ data: { ok: true, requeued } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 5: Wire into `server/index.js`**

Add the require alongside the other routers (after line 14):

```js
const letterboxdRouter = require('./routes/letterboxd');
```

Mount it with the others (after line 41, `apiRouter.use('/', healthRouter);`):

```js
apiRouter.use('/', letterboxdRouter);
```

Start the worker inside `createServer`, immediately after the `app.listen(...)`
call completes — never at module scope, or Supertest would start a real timer:

```js
    const { config: lbxConfig, worker: lbxWorker } = require('./letterboxd');
    if (lbxConfig.enabled && process.env.NODE_ENV !== 'test') {
      lbxWorker.start();
      console.log(`✅ Letterboxd sync enabled (every ${lbxConfig.intervalSeconds}s)`);
    }
```

And stop it in `gracefulShutdown`, as the first statement inside the handler:

```js
      lbxWorker.stop();
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest server/__tests__/letterboxd-routes.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 7: Run the whole suite — nothing existing may regress**

Run: `npm test`
Expected: all suites pass. `server/routes/entries.js` must appear in
`git status` as unmodified.

- [ ] **Step 8: Commit**

```bash
git add server/letterboxd/index.js server/routes/letterboxd.js \
        server/index.js server/__tests__/letterboxd-routes.test.js
git commit -m "feat: add Letterboxd status and sync endpoints"
```

---

### Task 8: Documentation and live verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-05-letterboxd-sync-design.md` (record the two deviations)

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Document the feature in `CLAUDE.md`**

Add to the endpoints table:

```markdown
| GET | `/api/letterboxd/status` | **yes** | sync queue state and recent failures |
| POST | `/api/letterboxd/sync` | **yes** | run a sync now; `?confirm=true` overrides the pause guard |
| POST | `/api/letterboxd/retry` | **yes** | re-queue `failed` rows |
```

Add a subsection after "Database":

```markdown
#### Letterboxd sync

Optional, **off by default**. New rows are born `letterboxdStatus = 'pending'`
via a column default, and a background worker pushes them to Letterboxd. The
write path is untouched: `routes/entries.js` knows nothing about any of this, so
a Letterboxd outage can never affect a database write.

- `letterboxd/client.js` — the only module that knows Letterboxd's wire format.
  It is undocumented and unversioned, so this is the file that breaks when
  Letterboxd changes; fix it here and nothing else needs to move.
- `letterboxd/queue.js` — retry and backoff policy. Client and DB are injected,
  so it is tested with no network and no database.
- `letterboxd/worker.js` — interval loop. Never starts under `NODE_ENV=test`.

Statuses: `pending` → `synced`, or `failed` (actionable; `retry` re-queues these),
or `skipped`. `skipped` covers pre-existing history and entries with no IMDb ID
in `movieURL` — common for festival shorts, and not a failure, since no retry
can help.

An expired session cookie halts the run without consuming any entry's retry
budget, and shows as `authOk: false`. Paste a fresh cookie and `POST
/api/letterboxd/sync`.
```

- [ ] **Step 2: Record the deviations in the spec**

Append a `## Deviations from this design` section covering (a) `skipped` rather
than `failed` for missing IMDb IDs, with the festival-shorts reasoning, and
(b) `confirm` as a query parameter rather than a body field.

- [ ] **Step 3: Verify against the real account**

With `MOVIETHING_LETTERBOXD_ENABLED=true` and a valid cookie:

```bash
curl -s -H "X-Api-Key: $MOVIETHING_VALID_API_KEY" \
  localhost:3000/api/letterboxd/status | jq .
```

Expected: `enabled: true`, `authOk: true`, and a `skipped` count equal to your
entire existing history. **If `pending` is anything other than 0 before you add
a new film, stop** — the migration did not mark history as skipped, and running
a sync would post duplicates to your diary.

Then add one film through the normal add form, and:

```bash
curl -s -X POST -H "X-Api-Key: $MOVIETHING_VALID_API_KEY" \
  localhost:3000/api/letterboxd/sync | jq .
```

Expected: `{"data":{"pushed":1,...}}`, and the film appears in your Letterboxd
diary with the right date and review.

- [ ] **Step 4: Run the full suite one final time**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-05-letterboxd-sync-design.md
git commit -m "docs: document Letterboxd sync"
```

---

## Self-review notes

**Spec coverage:** §1 schema → Task 2. §2 modules → Tasks 2-7 (plus
`letterboxd/index.js` and `letterboxd/queries.js`, not named in the spec).
§3 flow → Task 4. §4 auth → Task 3 config + Task 6 client. §5 errors → Tasks 3,
4, 6. §6 pause → Tasks 4, 5, 7. §7 endpoints → Task 7. §8 config → Task 3.
§9 mapping → Task 4. Testing → every task. Sequencing → Task 1 first.

**Deviations, both recorded above and in Task 8 Step 2:** missing IMDb ID →
`skipped` rather than `failed`; `confirm` as a query parameter rather than a
body field.

**Type consistency:** `getPendingCount`/`getEligibleRows`/`markSynced`/
`markFailed`/`markSkipped`/`recordAttempt`/`getCounts`/`getRecentFailures`/
`resetFailed` are named identically in Task 2's implementation, Task 4's fake
`makeDb`, and Task 7's route calls. `runOnce` returns
`{pushed, failed, skipped, paused, authFailed, pending}` in Task 4 and is
consumed with those exact keys in Tasks 5 and 7. `logEntry` takes
`{imdbId, watchedDate, rewatch, review}` and returns `{uri}` in Tasks 4 and 6.
