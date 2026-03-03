# Refactoring Design: Backend Modularization + Client Modernization

**Date:** 2026-03-02
**Scope:** Moderate — backend structural refactor + client dependency upgrades + JS cleanup. No framework migration. No database schema changes. API endpoints and URLs preserved.

---

## Goals

1. Break the monolithic `server/index.js` (726 lines) into maintainable modules
2. Eliminate repeated DB connection boilerplate
3. Standardize API response shapes
4. Add server-side input validation (zod)
5. Drop deprecated/outdated client dependencies (Moment.js, Bootstrap 4, IE comments)
6. Reorganize client-side JavaScript for readability

---

## Phase 1: Backend Refactor

### New Directory Structure

```
server/
├── db/
│   └── index.js          # Pool setup + query(sql, params) helper
├── middleware/
│   ├── auth.js           # requireAuth middleware (Authentik header + API key)
│   ├── validate.js       # validate(schema) middleware factory
│   └── errorHandler.js   # Global error handler
├── routes/
│   ├── movies.js         # GET /api/ — list movies by date/year
│   ├── entries.js        # GET/POST /api/newEntry, GET/PUT /api/entry/:id
│   ├── search.js         # POST /api/searchMovie, POST /api/getMovieDetails
│   └── exports.js        # GET /api/exportLetterboxd, GET /api/rss
├── validation/
│   └── schemas.js        # zod schemas for newEntry and entry update
├── helpers/
│   └── dates.js          # formatViewingDate() and shared date utilities
├── health.js             # GET /api/health
└── index.js              # App setup, middleware mounting, route mounting (~60 lines)
```

### DB Helper

A single `query(sql, params)` function replaces per-route try/finally/release boilerplate:

```js
export async function query(sql, params = []) {
  if (!pool) throw new Error('Database connection not available');
  let conn;
  try {
    conn = await pool.getConnection();
    return await conn.query(sql, params);
  } catch (err) {
    throw Object.assign(new Error(`DB query failed: ${err.message}`), { cause: err, sql });
  } finally {
    if (conn) conn.release();
  }
}
```

### Standardized Response Shape

All endpoints use exactly two shapes:

```js
// Success
res.json({ data: ... })

// Error
res.status(4xx|5xx).json({ error: "human-readable message" })
```

Route handlers throw errors rather than manually building error responses. The global error handler catches, logs, and formats them.

### Auth Middleware

The two auth mechanisms (Authentik header, API key) are extracted to `middleware/auth.js`:

```js
export function requireAuth(req, res, next) {
  const username = req.headers['x-authentik-username'];
  const apiKey = req.headers['x-api-key'];
  if (username || apiKey === process.env.API_KEY) return next();
  res.status(401).json({ error: 'Unauthorized' });
}
```

Applied only to mutation routes (`POST /api/newEntry`, `PUT /api/entry/:id`).

### Zod Validation

Schemas for mutation endpoints:

```js
// validation/schemas.js
export const newEntrySchema = z.object({
  tmdbId: z.number().int(),
  viewingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  format: z.string().min(1),
  location: z.string().min(1),
  // ... remaining fields
});
```

Validation middleware factory:

```js
// middleware/validate.js
export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.flatten() });
  req.body = result.data;
  next();
};
```

### Date Helper

```js
// helpers/dates.js
export const formatViewingDate = (date) => date.toISOString().split('T')[0];
```

Replaces 4+ inline occurrences of the same expression.

### Testing

Existing tests are updated to reflect the new module structure. No significant expansion of coverage during this refactor.

---

## Phase 2: Client Cleanup

### IE Compatibility Comments

Remove all HTML comments referencing IE 7/8/9 compatibility from `client/index.html` and `client/add/index.html`.

### Bootstrap 4 → Bootstrap 5

- Update CDN links in HTML files
- Rename `data-*` attributes to `data-bs-*` (Bootstrap 5 requirement)
- Fix renamed utility classes (e.g., `mr-*`/`ml-*` → `me-*`/`ms-*`)
- Remove `jquery.min.js` dependency if no longer needed post-upgrade

### Drop Moment.js

Replace Moment.js usage in client JS with native `Intl.DateTimeFormat` or simple Date utilities. Moment.js CDN link removed from HTML.

### Client JS Reorganization

**`client/js/main.js` (886 lines):**
- Consolidate global variables (`allMovieData`, `backgroundLoading`, `initialYear`, chart instances) into a single `state` object
- Extract large anonymous event handlers into named functions
- Extract chart creation into a dedicated `renderCharts(data)` function

**`client/add/js/main.js` (582 lines):**
- Same treatment: named state object, named handlers
- Extract TMDB search and form submission logic into dedicated functions

---

## Constraints

- No database schema changes
- No changes to endpoint URLs or HTTP methods
- Response shapes will change (`{ data }` / `{ error }`) — this is intentional
- No frontend framework migration
- No new features introduced during this refactor

---

## Sequencing

Phase 1 (backend) completes and all tests pass before Phase 2 (client) begins. Each phase is submitted as a separate PR.
