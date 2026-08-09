# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev              # Start server with nodemon (auto-reload)
npm start                # Start server in production mode

# Testing (from repo root or server/)
npm test                 # Run all tests
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report

# Single test file
npx jest server/__tests__/endpoints.test.js

# Client dev server (port 3001)
cd client && npm run dev
```

## Architecture

**moviething** is a personal movie-tracking web app with an Express backend and a jQuery/Bootstrap frontend. It uses npm workspaces (root, `server/`, `client/`).

### Backend (`server/index.js`)

Single-file Express server (~640 lines) with:
- MariaDB connection pool (via `mariadb` package)
- API key auth middleware applied to all routes
- TMDB API integration for movie search/details
- RSS feed generation (`rss` package)
- CSV export in Letterboxd format (`csv-stringify`)

Key endpoints:
- `GET /api/` — fetch movies by year or date range
- `POST /api/searchMovie` — TMDB search with advanced filters
- `POST /api/getMovieDetails` — TMDB movie details lookup
- `POST /api/newEntry` — insert movie viewing record
- `GET /api/exportLetterboxd` — CSV export
- `GET /api/rss` — RSS feed
- `GET /api/health` — health check with DB status

**Database schema** (single `movies` table): `movieTitle`, `viewingDate`, `movieURL`, `viewFormat`, `viewLocation`, `firstViewing`, `movieGenre`, `movieReview`.

### Frontend (`client/`)

Two distinct UIs, both plain HTML/CSS/jQuery (no build step):

- **Dashboard** (`client/index.html` + `client/js/main.js`): Highcharts visualizations, date range filtering, dark/light theme toggle persisted in localStorage.
- **Add form** (`client/add/index.html` + `client/add/js/main.js`): TMDB movie search with advanced filters, form for logging a viewing, previous viewing history display.

The client API base URL is `window.location.origin + '/api'`. API key is stored in localStorage and sent in request bodies.

### Infrastructure

Docker Compose (`compose.yml`) runs three services: the app (Node 23), MariaDB 10.11, and phpMyAdmin (port 8080). DB data lives in `./mariadb/db`.

### Testing

Jest + Supertest with mocked MariaDB connections. Tests live in `server/__tests__/`. The mock setup is in `server/__tests__/setup.js` (or similar).

### Environment variables

See `.env.example`. Required: `SERVER_PORT`, `MOVIETHING_SQL_*` (host/user/pass/db), `MOVIETHING_TMDB_API_KEY`, `MOVIETHING_VALID_API_KEY`, and optional RSS title/description vars.
