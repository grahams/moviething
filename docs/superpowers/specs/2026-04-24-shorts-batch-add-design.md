# Shorts Batch Add — Design Spec

## Problem

When attending film festivals (IFFBoston, etc.), shorts are shown in curated packages containing 4-7 individual films. Each short should be logged as its own entry in moviething. Manually adding each one via the existing single-movie form is tedious — it requires separate TMDB searches, and many shorts aren't on TMDB at all.

## Solution Overview

A two-part system:

1. **iff-schedule-tool** gets a new export command that emits a lightweight JSON file containing shorts packages and their constituent films.
2. **moviething** gets a new frontend page and a single new backend endpoint to support batch-adding shorts from that export.

The frontend handles all orchestration (parsing, TMDB lookups, user review). The backend stays thin — it only adds a batch insert endpoint. moviething has no knowledge of the IFF/Elevent data format.

## Export Format (iff-schedule-tool)

New CLI flag `--export-packages` on `iffboston_schedule.py` emits a JSON file:

```json
{
  "festival": "IFFBoston 2026",
  "packages": [
    {
      "name": "Shorts Mass Ave: Documentary",
      "shorts": [
        {
          "title": "Between Moon Tides",
          "director": "Jason Jaacks",
          "runtime": 25,
          "url": "https://iffboston.org/films/between-moon-tides/"
        },
        {
          "title": "Gatorville",
          "director": "Freddie Gluck",
          "runtime": 19,
          "url": "https://iffboston.org/films/gatorville/"
        }
      ]
    }
  ]
}
```

Fields per short:
- `title` — film title
- `director` — director name(s)
- `runtime` — duration in minutes
- `url` — IFF festival page URL (fallback when IMDB is unavailable)

The existing `build_program_map()` function already resolves the bidirectional Elevent relationships between packages and their constituent shorts. The export serializes that data into this portable format.

## Frontend: New Page (`client/add/shorts.html` + `client/add/js/shorts.js`)

Same Bootstrap/jQuery patterns, dark/light theme support, and API key handling as the existing add page.

### Phase 1 — Load & Select

- File input to load the export JSON
- Dropdown populated with all package names from the file
- Select a package to proceed

### Phase 2 — Shared Viewing Fields

Set once, applied to every short in the batch:

- `viewingDate` — date picker (same as existing add form)
- `viewFormat` — dropdown (Theater, etc.)
- `viewLocation` — dropdown (populated based on viewFormat)
- `firstViewing` — checkbox (checked by default)
- `movieGenre` — pre-filled as "Short" (editable)

A "Look up shorts" button triggers TMDB searches for all shorts in the selected package.

### Phase 3 — Review & Submit

A card/row per short showing:

- **Title** — from export data, read-only
- **Director** — from export data, displayed for reference
- **movieURL** — pre-filled with IMDB link if TMDB found a match, otherwise pre-filled with the IFF URL from the export. Editable in all cases.
- **TMDB status indicator** — visual badge showing whether TMDB matched (green) or the entry needs manual attention (yellow)
- **movieReview** — empty textarea for an individual review

"Submit All" button at the bottom sends the full batch to the backend.

### TMDB Lookup Strategy

For each short in the package:

1. Call existing `POST /api/searchMovie` with the short's title
2. Filter results to exclude anything with a release date more than 2 years before the current year (shorts at festivals are recent; this reduces false positives from older films with the same title)
3. If results remain, match by title similarity and runtime (under 60 minutes is a strong signal for a short)
4. If a confident match is found, call `POST /api/getMovieDetails` to get the IMDB ID and build the IMDB URL
5. If no match, fall back to the IFF URL from the export and mark the short as "manual"

Lookups run sequentially with a small delay between each to avoid hammering the TMDB API. A progress indicator shows status as each short is looked up.

No automatic submission — TMDB results only pre-fill fields. The user reviews everything before submitting.

## Backend: New Endpoint

### `POST /api/newEntries`

Batch insert endpoint.

- **Auth:** Same `requireAuth` middleware as `/api/newEntry` (accepts Authentik header or API key)
- **Request body:** `{ entries: [ ...array of entry objects... ] }` where each entry has the same shape as a single `/api/newEntry` request (movieTitle, viewingDate, movieURL, viewFormat, viewLocation, movieGenre, movieReview, firstViewing)
- **Validation:** Each entry validated against the existing Zod schema (`newEntrySchema`)
- **Insert:** All entries inserted in a single database transaction. If any entry fails validation, none are inserted.
- **Response:** `{ data: { ok: true, count: N } }` on success, or error details on failure

No other backend changes. Existing `/api/searchMovie` and `/api/getMovieDetails` endpoints are reused as-is.

## What Does Not Change

- Existing add page (`client/add/index.html`)
- Dashboard page
- Database schema (no new tables or columns — shorts are regular movie entries with genre "Short")
- Any existing API endpoints
- RSS feed, CSV export, or any other existing functionality

## Scope Boundaries

- The export format is intentionally simple and not coupled to the Elevent data structure. Other festivals could produce the same format from different sources.
- The moviething frontend page parses the JSON client-side. There is no server-side storage of package data.
- TMDB lookup is best-effort. The user is always the final reviewer before submission.
