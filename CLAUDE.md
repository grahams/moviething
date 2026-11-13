# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev              # Start server with nodemon (auto-reload)
npm start                # Start server in production mode

# Testing
npm test                 # Run all tests (server + client, via workspaces)
npm run test:watch       # Watch mode (server only)
npm run test:coverage    # Coverage report (server only)

# Single test file
npx jest server/__tests__/endpoints.test.js

# Client static dev server (port 3001)
cd client && npm run dev
```

Note: the root `jest.config.js` lists only `<rootDir>/server` as a project, so
running `npx jest` from the repo root runs **server tests only**. Client tests
run through the workspace script (`npm test`) or from `client/`.

## Architecture

**moviething** is a personal movie-tracking web app with an Express backend and
a jQuery/Bootstrap frontend. It uses npm workspaces (root, `server/`, `client/`).

### Backend (`server/`)

Modular Express app, ~670 lines total. `server/index.js` is bootstrap only
(~90 lines): env validation, middleware, router mounting, graceful shutdown.
It exports `{ app, createServer }` and only listens when run directly, which is
what lets Supertest import `app` without opening a port.

```
server/
  index.js              # bootstrap, env check, graceful shutdown
  db/index.js           # MariaDB pool, query(), testConnection()
  db/queries.js         # shared queries (getRowsBetweenDates, checkExistingInfo)
  routes/               # movies, entries, search, exports, health
  middleware/           # auth, validate, errorHandler
  helpers/dates.js      # formatViewingDate
  validation/schemas.js # zod schemas
```

All routers mount at `/api` (each with prefix `/`, so paths are declared in
full inside each router). The client is served as static files from `client/`.

#### Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/` | — | movies by year or date range |
| GET | `/api/entry/:id` | — | single entry |
| POST | `/api/newEntry` | **yes** | insert one viewing |
| POST | `/api/newEntries` | **yes** | batch insert, single transaction |
| PUT | `/api/entry/:id` | **yes** | update a viewing |
| POST | `/api/searchMovie` | — | TMDB search with filters |
| POST | `/api/getMovieDetails` | — | TMDB details lookup |
| GET | `/api/exportLetterboxd` | — | CSV export |
| GET | `/api/rss` | — | RSS feed |
| GET | `/api/health` | — | health check with DB status |

**Auth applies to writes only.** `requireAuth` (`server/middleware/auth.js`) is
attached per-route to `newEntry`, `newEntries`, and `PUT /entry/:id`. Reads,
search, export, and RSS are unauthenticated — the deployment relies on Traefik
plus Authentik in front of the app for those.

`requireAuth` accepts **either** credential:
- `x-authentik-username` header (injected by Authentik ForwardAuth for UI requests)
- `x-api-key` header matching `MOVIETHING_VALID_API_KEY` (for external clients)

#### Request body convention (important)

Validated endpoints do **not** take a normal JSON body. `validate()`
(`server/middleware/validate.js`) expects a `json` field containing a JSON
**string**, which it parses and then checks against a zod schema:

```js
// Correct:
POST /api/newEntry   { "json": "{\"movieTitle\":\"Heat\", ...}" }
// Not:
POST /api/newEntry   { "movieTitle": "Heat", ... }
```

The parsed, validated result lands on `req.validatedBody` — route handlers read
that, never `req.body`. Validation failures return 400 with a zod
`flatten()`-shaped error.

#### Database

Single `movies` table: `id` (auto-increment PK), `movieTitle`, `viewingDate`,
`movieURL`, `viewFormat`, `viewLocation`, `firstViewing` (TINYINT 0/1),
`movieGenre`, `movieReview`.

Schema is managed by numbered SQL files in
`mariadb/docker-entrypoint-initdb.d/`. **These run only when the container
initialises an empty data directory**, so any change to an existing database
must also be applied by hand. Write migrations to be idempotent
(`ADD COLUMN IF NOT EXISTS`, etc.) so both paths are safe.

`movieURL` holds an IMDb URL; the IMDb ID is extracted with `/tt\d{7,8}/` where
needed (see `routes/exports.js`).

### Frontend (`client/`)

Plain HTML/CSS/jQuery, no build step. Three pages:

- **Dashboard** (`index.html` + `js/main.js`) — Highcharts visualisations, date
  range filtering, dark/light theme toggle persisted in localStorage. Filtering
  logic is extracted into `js/filter.js` (pure, unit-tested).
- **Add form** (`add/index.html` + `add/js/main.js`) — TMDB search with advanced
  filters, viewing-log form, previous-viewing history. Search state lives in
  `add/js/searchSession.js`.
- **Shorts** (`add/shorts.html` + `add/js/shorts.js`) — batch entry for short
  films, posting to `/api/newEntries`.

API base URL is `window.location.origin + '/api'`. The browser client sends
**no** API key — writes authenticate via the `x-authentik-username` header that
Authentik's ForwardAuth injects. (An older build kept a key in localStorage;
`add/js/main.js` now removes that stale `moviesAPIKey` entry on load.) The
`x-api-key` path exists for external clients calling the API directly.

Client tests live in `client/__tests__/` and cover `filter.js` and
`searchSession.js`.

### Infrastructure

Docker Compose (`compose.yml`) runs three services: the app (`node:26-trixie-slim`),
MariaDB 11.8, and phpMyAdmin (port 8080). DB data lives in `./mariadb/db`.

### Testing

Jest + Supertest, with `mariadb.createPool` mocked — no live database. Server
tests are in `server/__tests__/` and the mock setup is `server/__tests__/setup.js`.

### Environment variables

See `.env.example`. `server/index.js` validates the required vars at startup and
calls `process.exit(1)` on the first one missing. The check is skipped when
`NODE_ENV=test`.

**Required** — the server will not start without all of these:
`MOVIETHING_SQL_HOST`, `MOVIETHING_SQL_USER`, `MOVIETHING_SQL_PASS`, `MOVIETHING_SQL_DB`, `MOVIETHING_TMDB_API_KEY`, `MOVIETHING_VALID_API_KEY`, `MOVIETHING_RSS_TITLE`, `MOVIETHING_RSS_DESCRIPTION`.

**Optional** — these have fallbacks:
- `SERVER_PORT` — defaults to `3000`.
- `MOVIETHING_BASE_URL` — defaults to `http://localhost:3000`. Used for the RSS feed's `feed_url` and `site_url`, so a deployed instance should set it or the feed will advertise localhost URLs.
