# Letterboxd Auto-Sync — Design

Date: 2026-09-05

## Problem

Films logged in moviething must be re-entered by hand on Letterboxd. The data
needed is already in the database, and `GET /api/exportLetterboxd`
(`server/routes/exports.js:11`) already maps it into Letterboxd's import
format — but that export ends in a manual file download and a manual upload
through Letterboxd's importer.

The gap is transport, not data. In particular, film identification is already
solved: `movieURL` holds an IMDb URL, and the export extracts the ID with
`/tt\d{7,8}/`. IMDb ID is exactly the key Letterboxd matches films on.

### Why not the official API

Letterboxd's API is partner-gated; they do not issue keys for personal
projects. The remaining automated path is the web application's own
diary-logging endpoint, driven with an authenticated session cookie.

That endpoint is undocumented and unversioned, and automated access is
contrary to Letterboxd's terms of service. This is a deliberate, accepted
trade-off for this project: it is the owner's own account, the owner's own
data, and a volume of a few entries per week. The design assumes the endpoint
**will** break at some point and is built so that a breakage is visible and
contained rather than silent.

## Goals

- A film added through `POST /api/newEntry` reaches Letterboxd with no further
  action.
- A failure to reach Letterboxd can never fail, slow, or roll back the
  database write.
- When the integration breaks, it is visible as a backlog with error detail —
  not a silent gap in the diary.
- Existing viewing history is never pushed.

## Non-goals

- **No backfill of existing history.** Those films are assumed already on
  Letterboxd. Letterboxd cannot distinguish a duplicate post from a genuine
  rewatch, so anything pushed in error must be deleted by hand.
- **No ratings.** The `movies` table has no rating column.
- **No tags.** `viewFormat` and `viewLocation` are not pushed; the diary entry
  carries only film, date, rewatch flag, and review — the same fields the CSV
  export sends today.
- **No scripted login.** See §4.
- No changes to the dashboard or add-form UI in this phase.

## Design

### 1. Schema

New migration `mariadb/docker-entrypoint-initdb.d/002-letterboxd-sync.sql`.

| column | type | purpose |
|---|---|---|
| `letterboxdStatus` | `ENUM('pending','synced','failed','skipped')` | queue state |
| `letterboxdUri` | `VARCHAR(255) NULL` | created diary entry, for verification/undo |
| `letterboxdAttempts` | `INT NOT NULL DEFAULT 0` | drives backoff and the give-up cap |
| `letterboxdLastAttempt` | `DATETIME NULL` | backoff clock |
| `letterboxdError` | `VARCHAR(512) NULL` | why a `failed` row failed |

The "new entries only" requirement is met through the column default rather
than a bulk `UPDATE`:

```sql
ALTER TABLE movies
  ADD COLUMN IF NOT EXISTS letterboxdStatus
    ENUM('pending','synced','failed','skipped') NOT NULL DEFAULT 'skipped';

-- Every pre-existing row is now 'skipped' by virtue of the default above.
-- Future inserts must queue, so flip the default afterwards:
ALTER TABLE movies ALTER COLUMN letterboxdStatus SET DEFAULT 'pending';
```

This matters because the file runs automatically on a fresh container **and**
is applied by hand to the live database. Both statements are no-ops on a
second run. The superficially equivalent
`UPDATE movies SET letterboxdStatus='skipped' WHERE letterboxdStatus='pending'`
is **not** safe to re-run: a later invocation would silently skip genuinely
pending work.

Index for the worker's selection query:

```sql
CREATE INDEX IF NOT EXISTS idx_movies_lbstatus
  ON movies (letterboxdStatus, letterboxdLastAttempt);
```

**Consequence: `server/routes/entries.js` requires no changes.** Rows enqueue
themselves via the column default, for both `newEntry` and `newEntries`.

### 2. Module layout

```
server/letterboxd/
  client.js   — the only module that knows Letterboxd's wire format
  queue.js    — selects work, applies results, backoff policy
  worker.js   — interval loop, start/stop
  errors.js   — AuthError / TransientError / PermanentError
server/routes/letterboxd.js — status and manual sync endpoints
```

All wire-format fragility is confined to `client.js` behind one function:

```js
// Throws AuthError | TransientError | PermanentError.
async function logEntry({ imdbId, watchedDate, rewatch, review }) // → { uri }
```

`queue.js` holds the retry and backoff logic — the part worth testing — and
never touches the network; its client is injected:

```js
async function runOnce({ client, limit, pauseThreshold }) // → { pushed, failed, paused }
```

When Letterboxd changes something, `client.js` is the only file to repair.

Uses the runtime's native `fetch` (Node 24 in the image, per `Dockerfile:1`).
No new dependency. The session cookie and CSRF token are managed explicitly —
a single cookie pair does not warrant a cookie-jar library.

### 3. Flow

1. `POST /api/newEntry` inserts as it does today. The row is `pending` by
   default. The response is unaffected — no Letterboxd call is made on the
   request path.
2. The worker wakes every `MOVIETHING_LETTERBOXD_INTERVAL` seconds.
3. **Pause check, before any selection.** If the total `pending` count exceeds
   `_PAUSE_THRESHOLD`, the worker pushes nothing, marks itself paused, and
   logs. See §6.
4. Otherwise it selects up to `_BATCH_LIMIT` `pending` rows, oldest
   `viewingDate` first, whose backoff has elapsed.
5. For each row it extracts the IMDb ID from `movieURL`, then calls
   `client.logEntry`.
6. Success → `synced`, storing `letterboxdUri`. Failures are classified and
   applied per §5.

### 4. Authentication

A session cookie supplied via `MOVIETHING_LETTERBOXD_COOKIE`, obtained by
logging into Letterboxd in a browser once and copying it.

The rejected alternative was storing username and password and having the
service perform the login form POST itself. That is more self-healing, but it
stores the real account password on the server and a scripted login is the
single most likely action to trigger captcha or bot-protection. Cookies are
long-lived (roughly a year); expiry is surfaced as `authOk: false` on the
status endpoint and fixed by pasting a fresh value.

### 5. Error handling

Three error classes, because each demands a different response:

| class | trigger | response |
|---|---|---|
| `AuthError` | session rejected / redirect to sign-in | **Halt the entire run.** Set `authOk: false`. Leave rows `pending` and do **not** increment `letterboxdAttempts`. |
| `TransientError` | 5xx, timeout, network | Increment attempts, remain `pending`, exponential backoff (1m, 5m, 25m, …), give up as `failed` after 5 attempts. |
| `PermanentError` | film not matched, malformed request, 4xx validation | `failed` immediately with the reason. No retry. |

The attempt-count exemption for `AuthError` is the important detail: without
it, a single expired cookie burns through every queued row's retry budget and
mass-marks the backlog `failed`, converting a one-line fix into manual
recovery.

A row whose `movieURL` contains no IMDb ID fails permanently as
`no imdb id` — there is nothing for Letterboxd to match on, so retrying is
pointless.

### 6. Pause threshold

`POST /api/newEntries` exists for bulk entry, and under §1 a bulk import of
200 historical films would queue all 200 to a public diary — precisely the
mass-duplicate outcome the no-backfill decision exists to prevent.

So a run that finds more than `_PAUSE_THRESHOLD` (default 25) pending rows
refuses to push and marks itself paused until an operator sends
`POST /api/letterboxd/sync {"confirm": true}`. Routine use never approaches
the threshold; a bulk import always trips it.

### 7. Endpoints

All behind the existing `requireAuth` middleware (`server/middleware/auth.js`).

- `GET /api/letterboxd/status` →
  `{ enabled, authOk, paused, counts: { pending, synced, failed, skipped }, recentFailures: [...] }`
- `POST /api/letterboxd/sync` — run now; `{"confirm": true}` also clears a pause.
- `POST /api/letterboxd/retry` — reset `failed` rows to `pending`, zeroing attempts.

### 8. Configuration

Every variable is optional, and they are validated **only when
`MOVIETHING_LETTERBOXD_ENABLED` is true**, so the existing required-variable
startup check (`server/index.js`) is unchanged for anyone not using the
feature.

| variable | default | meaning |
|---|---|---|
| `MOVIETHING_LETTERBOXD_ENABLED` | `false` | master switch |
| `MOVIETHING_LETTERBOXD_COOKIE` | — | session cookie; required when enabled |
| `MOVIETHING_LETTERBOXD_INTERVAL` | `300` | seconds between runs |
| `MOVIETHING_LETTERBOXD_BATCH_LIMIT` | `10` | rows pushed per run |
| `MOVIETHING_LETTERBOXD_PAUSE_THRESHOLD` | `25` | pending count that trips §6 |

Defaulting to **off** keeps tests, CI, and development containers from posting
to the real diary.

### 9. Field mapping

| Letterboxd field | source |
|---|---|
| film | `/tt\d{7,8}/` extracted from `movieURL` |
| watched date | `viewingDate` |
| rewatch | `firstViewing === 1 ? false : true` (inverted, matching `exports.js:36`) |
| review | `movieReview` |

## Testing

- **`client.js`** — fixture-based with `fetch` mocked. Asserts the outgoing
  request shape (headers, CSRF, body) and the mapping from each response shape
  onto the three error classes.
- **`queue.js`** — table-driven against a fake client across the full error
  taxonomy: success, each error class, backoff timing, the 5-attempt cap, the
  pause threshold, and missing IMDb IDs.
- **Routes** — supertest with the mocked MariaDB pool, matching the existing
  patterns in `server/__tests__/`.

No test performs live network I/O, and the worker interval does not start
under `NODE_ENV=test`.

## Implementation sequencing

**Task 1 is a spike**, because the endpoint's current shape is not known and
cannot responsibly be guessed. Against the real account, log a single film and
capture the exact request: URL, method, field names, how the CSRF token is
obtained and submitted, and the success and failure response shapes. Delete
the test diary entry afterwards. The code is throwaway; the deliverable is a
findings section appended to this document.

Everything else — migration, `queue.js`, `worker.js`, routes, and their tests —
is buildable and fully testable before the spike lands. Only the internals of
`client.js` depend on its findings.

## Risks

- **The endpoint changes without notice.** Contained to `client.js`; surfaces
  as a `failed` backlog on the status endpoint rather than as silent data loss.
- **Terms of service.** Accepted, with scope and rationale recorded above.
- **Cookie expiry.** Expected roughly annually; surfaces as `authOk: false`
  and is resolved by pasting a new cookie.
- **Duplicate diary entries.** Mitigated by no-backfill (§1) and the pause
  threshold (§6). Letterboxd cannot detect duplicates, so this failure mode is
  prevented rather than corrected.
- **A crash between the diary POST and the database write still leaves the
  row `pending`.** A dropped connection while reading the response is caught
  as `AmbiguousError` and the row is marked `skipped` for manual reconciliation
  (see client.js/queue.js), but a hard process crash in that same narrow
  window — after Letterboxd has saved the entry but before `markSynced` runs —
  bypasses that handling entirely, and a restart could re-post the row. The
  window is small and closing it fully would need a two-phase commit, which is
  not warranted here.
- **`formatViewingDate` (`server/helpers/dates.js`) uses `toISOString()`,
  which shifts the date backwards by one day for any deployment timezone east
  of UTC.** A deployment east of UTC would therefore post diary dates one day
  early. US-Eastern deployments and any deployment running with `TZ=UTC` are
  unaffected. Not fixed here: the helper is shared with `routes/exports.js`
  and the RSS feed, so changing it would alter existing, already-reviewed
  behaviour outside the scope of this feature; it belongs in its own change.

## Deviations from this design

Four points where the implementation departed from what is written above:

1. **A row with no IMDb ID is `skipped`, not `failed`** (§5 said `failed`).
   Festival shorts frequently have no IMDb entry at all, and no retry can ever
   fix that. Marking these `failed` would fill the failure list with permanent,
   unactionable noise instead of the real signal it's meant to carry.

2. **`confirm` is a query parameter (`?confirm=true`), not a body field**
   (§7 sketched a JSON body, `{"confirm": true}`). Validated request bodies in
   this codebase use the `{json: "<stringified>"}` convention (see
   "Request body convention" above), which is awkward for an operational
   endpoint meant to be reached with a plain `curl` command.

3. **`worker.runNow` returns a discriminated outcome**,
   `{ok:true,result} | {ok:false,reason:'busy'} | {ok:false,reason:'error',error}`,
   so `POST /api/letterboxd/sync` can tell "a run is already in progress" (409)
   apart from "the run errored" (500). Without this distinction a database
   failure during the run would have been reported to the caller identically
   to "just retry in a bit."

4. **The client harvests the CSRF token from the film-page response** when
   `MOVIETHING_LETTERBOXD_CSRF` is blank, rather than requiring the variable.
   This is what makes `.env.example`'s "fetched automatically" comment on that
   variable true rather than aspirational.

## Before enabling this (human steps)

None of the following happened during implementation — Docker was unavailable,
and posting to a real, public Letterboxd diary needs credentials only the
account owner holds. Do these in order before flipping
`MOVIETHING_LETTERBOXD_ENABLED` on for real:

1. **Run the Task 1 spike** against the real account (see "Implementation
   sequencing" above) to verify the endpoint hypothesis this design rests on.
   Reconcile `server/letterboxd/client.js`'s constants — `BASE`, `LOG_PATH`,
   the `URLSearchParams` field names (`__csrf`, `filmId`, `specifiedDate`,
   `viewingDateStr`, `rewatch`, `review`, `tags`, `rating`, `liked`), and the
   CSRF cookie name matched in `harvestCsrf`
   (`com.xk72.webparts.csrf`) — against whatever the spike actually finds.
   Fix `client.js` if reality disagrees.

2. **Verify the migration against a real MariaDB.** This was never run —
   Docker was unavailable throughout implementation. Run exactly the commands
   from the plan's Task 2 Step 2
   (`docs/superpowers/plans/2026-09-05-letterboxd-sync.md`):

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

   The root password is `$MOVIETHING_SQL_PASS`. Required result, exactly:
   `Old Film` reads `skipped` and `New Film` reads `pending`. Anything else
   means the migration's default-flip trick did not work as designed, and it
   must be fixed before going further.

3. **Apply the migration to the live database by hand.** The
   `mariadb/docker-entrypoint-initdb.d/002-letterboxd-sync.sql` file only runs
   automatically against an empty data directory — the live database already
   has data, so it will not be picked up on container start. Run it directly
   against production, the same way it was run in step 2 above.

4. **Enable and check status before any sync runs.** Set
   `MOVIETHING_LETTERBOXD_ENABLED=true` and `MOVIETHING_LETTERBOXD_COOKIE`,
   restart, then:

   ```bash
   curl -s -H "X-Api-Key: $MOVIETHING_VALID_API_KEY" \
     localhost:3000/api/letterboxd/status | jq .
   ```

   Confirm `counts.pending` is **0** before adding anything or running a sync.
   **If it is anything other than 0, stop.** A non-zero pending count at this
   point means step 3's migration did not mark existing history as `skipped`,
   and running a sync would post duplicate entries to the real, public diary.

5. **Only then**, add one film through the normal add form and run
   `POST /api/letterboxd/sync`. Confirm it appears in the real Letterboxd
   diary with the correct date and review before considering this feature
   live.

## Spike findings (2026-09-05) — the automated transport is blocked

Run against a real, logged-in account. **Result: the design's HTTP transport
cannot work as specified.** Recorded here without hedging.

### Blocker: Cloudflare challenges the endpoints we need

Measured anonymously, `cf-mitigated: challenge` in the response headers:

| path | result |
|---|---|
| `GET /film/heat-1995/` | 200 — passes |
| `GET /imdb/tt0113277/` | 302 → `/film/heat-1995/` — passes |
| `GET /s/autocompletefilm?q=heat` | **403, Cloudflare challenge** |
| `POST /s/save-diary-entry` | **403, Cloudflare challenge** |

Ordinary HTML pages are served normally; every `/s/` AJAX endpoint — including
the diary POST — is challenged. The browser passes these because it holds a
`cf_clearance` cookie earned by solving the challenge.

`cf_clearance` cannot carry this design:
- it is bound to the client **IP address and User-Agent**, so a value copied
  from the owner's browser will not authorise requests from the server, which
  has a different IP;
- it is short-lived (typically minutes to hours), so it cannot be pasted once
  and left, which was the entire premise of §4.

### Secondary findings (correct, but moot while the above stands)

1. **`LOG_PATH` was right.** `action="/s/save-diary-entry"` is present in the
   page markup, confirming the endpoint and that it is a form POST.
2. **`filmId` does not exist.** The real field is **`viewingableUid`**, whose
   value takes the form `film:<numeric id>` (the `<type>:<id>` convention is
   visible elsewhere on the page, e.g. `/s/full-text/viewing:138872204/`).
3. **Confirmed form fields**, read from the live form: `__csrf`, `viewingId`,
   `viewingableUid`, `specifiedDate`, `rewatch`, `viewingDateStr`, `review`,
   `containsSpoilers`, `tags`, `rating`, `liked`.
4. **`data-film-id` no longer exists** on a film page, so `resolveFilmId`'s
   approach is obsolete regardless. Logging is now a *search wizard*: JS
   resolves the film through `/s/autocompletefilm` and fills `viewingableUid`.
   That search endpoint is itself Cloudflare-challenged.
5. **`__csrf` ships as the literal string `placeholder`** in the static markup;
   the real token is injected client-side from the `com.xk72.webparts.csrf`
   cookie, which *is* issued via `Set-Cookie` on a normal page request. The
   `harvestCsrf` design was therefore sound.
6. **The session cookie is `letterboxd.user.CURRENT`**, not
   `letterboxd.signed.in.as` (which merely holds the username and is not a
   credential). `GET /settings/` returns **200 when signed out**, serving a
   sign-in page — any auth check must test content, not status code.

### Consequence

`MOVIETHING_LETTERBOXD_ENABLED` must stay `false`. The queue, schema, status,
retry, and backoff machinery are unaffected and remain useful; only
`client.js`'s transport is blocked. See the decision recorded below this
section once a direction is chosen.
