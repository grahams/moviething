# All-History Title Search — Design

Date: 2026-08-08

## Problem

On the dashboard, "Search Titles" only matches within the currently selected
date range. To answer "have I seen this, and when?", the user must first click
**All** to widen the date range to 2003-01-01, then type in the search box.

The cause is not missing data. `fetchAllDataInBackground`
(`client/js/main.js:492`) already pulls the full 2003→present history into
`state.allMovieData` immediately after the initial year loads. The **All**
button (`#setStart2003`) loads nothing — it only sets the Start Date field.

The actual constraint is in `applyDateRangeFilter` (`client/js/main.js:527`),
which ANDs the title match with the date-range match:

```js
var dateMatch = d && d >= startDate && d <= endDate;
var titleMatch = !titleSearch || (row.movieTitle && ...includes(titleSearch));
return dateMatch && titleMatch;
```

Search is therefore clipped to the date fields even though the full dataset is
already in memory.

## Goals

- Typing in Search Titles searches all of viewing history, with no preparatory
  clicks.
- Search results are usable immediately — the movie list is at the top of the
  page, not below five charts.

## Non-goals

- No server-side search endpoint. The full history is already client-side; a
  `/api/search` route would duplicate the background fetch for no benefit at
  this dataset size.
- No change to date-range browsing when the search box is empty.
- No unrelated refactoring of the chart code.

## Design

### 1. Search overrides the date range

When `#titleSearch` is non-empty, the filter matches on title only, ignoring
`#startDate` / `#endDate`. When it is empty, behavior is exactly as today.

The filter predicate is extracted from `applyDateRangeFilter` into a pure,
testable function in a new file `client/js/filter.js`:

```js
function filterMovies(data, opts) {
  var titleSearch = (opts.titleSearch || "").toLowerCase().trim();
  var searching = titleSearch.length > 0;

  return data.filter(function (row) {
    if (searching) {
      return !!row.movieTitle &&
        row.movieTitle.toLowerCase().indexOf(titleSearch) !== -1;
    }
    var d = row.viewingDate ? row.viewingDate.slice(0, 10) : null;
    return !!d && d >= opts.startDate && d <= opts.endDate;
  });
}
```

The file assigns `filterMovies` as a global (matching the existing
`merge-rules.js` / `plugins.js` script-tag pattern) and adds a
`typeof module !== 'undefined' && module.exports` guard so Jest can require it.
It is loaded via a `<script>` tag in `client/index.html` before `main.js`.

While a search is active the date controls are visually muted — `#startDate`,
`#endDate`, `#setStart2003` and `#applyDateFilter` get a `.filter-inactive`
class (reduced opacity) and the note **"Date range ignored while searching"**
appears next to them. The inputs are *not* disabled: their values are preserved
and take effect again the moment the search is cleared. Clearing the search
does not modify the date field values.

### 2. Loading and failure states

A new `#searchStatus` element sits under the filter row and shows, in priority
order:

| Condition | Message |
| --- | --- |
| `state.backgroundLoadFailed` | ⚠ Couldn't load full history — **Retry** |
| `state.backgroundLoading` (search active) | ⏳ Still loading full history — results will update. |
| otherwise | (hidden) |

When the background fetch completes it already calls `applyDateRangeFilter()`,
which re-reads the search box, so results refresh automatically with no extra
wiring.

The existing `.fail()` handler in `fetchAllDataInBackground` currently only
resets `state.backgroundLoading`, leaving a permanently incomplete dataset with
no user-visible signal. It gains `state.backgroundLoadFailed = true` and a
`updateSearchUiState()` call. The **Retry** link clears the flag and re-invokes
`fetchAllDataInBackground` with the same argument, which is stored on
`state.backgroundLoadStart` at first call so retry does not need the original
caller's scope.

### 3. Chart collapse

The five chart containers (`#formatContainer`, `#theatreContainer`,
`#theatreControlContainer`, `#firstViewingContainer`, `#genreContainer`,
`#monthContainer`) are wrapped in a `#chartsSection` div with a
`#toggleCharts` button above it.

Rules:

- Search becomes non-empty → charts collapse.
- User clicks **Show charts** during a search → `state.chartsExpandedDuringSearch`
  is set and charts stay expanded for the rest of the session. Page reload
  resets it.
- Search cleared → charts always restored, and
  `state.chartsExpandedDuringSearch` is reset to `false`.

Chart visibility is derived by a single helper:

```js
function chartsVisible() {
  var searching = $("#titleSearch").val().trim().length > 0;
  return !searching || state.chartsExpandedDuringSearch;
}
```

When charts are hidden, `applyDateRangeFilter` skips both chart creation
(`createFormatChart()` et al.) and the `prepare*Data` calls that populate them.
This is a real performance win: the function currently rebuilds all five
Highcharts objects on every debounced keystroke. Charts are built fresh when
expanded, which matches how the code already recreates them on each pass and
avoids Highcharts' sizing problems when rendering into a `display:none`
container.

`#textStats` and `#movieListDiv` are **not** collapsed. Stats stay visible and
become a match count for the searched set (total / features / shorts).

### 4. Sort order

Unchanged. `state.allMovieData` is sorted oldest-first at load and
`prepareListData` renders in array order, so search results read as a viewing
chronology.

## Files changed

| File | Change |
| --- | --- |
| `client/js/filter.js` | **New.** Pure `filterMovies(data, opts)`. |
| `client/js/main.js` | Use `filterMovies`; add `updateSearchUiState()`, `chartsVisible()`; new state flags; chart-skip logic; background-fetch fail handler. |
| `client/index.html` | `#chartsSection` wrapper, `#toggleCharts` button, `#searchStatus` element, `<script>` tag for `filter.js`. |
| `client/css/main.css` | `.filter-inactive`, `#searchStatus`, collapsed-section styles. |
| `client/package.json` | Add `jest` devDependency and `test` script. |
| `client/jest.config.js` | **New.** Minimal config, `testMatch` on `__tests__`. |
| `client/__tests__/filter.test.js` | **New.** Unit tests for `filterMovies`. |

## Testing

`filterMovies` is developed test-first against a new minimal Jest project in
the `client/` workspace. Root `npm test` already runs `--workspaces`, so client
tests join the existing server suite automatically.

Cases:

- Empty search, rows inside and outside the range → date filtering only.
- Non-empty search → matches outside the date range are returned.
- Search is case-insensitive and matches substrings.
- Leading/trailing whitespace in the search term is trimmed; a
  whitespace-only search behaves as empty.
- Rows with a null/missing `movieTitle` are skipped when searching, and rows
  with a null `viewingDate` are skipped when date-filtering.

DOM behavior (chart collapse, muted date fields, status messages) is not
covered by unit tests — the client has no DOM test harness and adding one is
out of scope. It is verified manually in the running app:

1. Load the dashboard on the current year; search a title last seen years ago
   → it appears.
2. Charts collapse on search; **Show charts** keeps them open for subsequent
   searches in that session; clearing the search restores them and resets the
   sticky flag.
3. Date fields mute during search and their values still apply after clearing.
4. Type into the search box immediately on page load → loading note appears and
   results update when the background fetch lands.

## Risks

- **Highcharts re-render on expand.** Building charts into a container that was
  just un-hidden can produce a zero-width render if the toggle and the build
  happen in the same tick. Mitigation: un-hide the section before calling the
  create/prepare functions, and verify chart widths manually in step 2 above.
- **Search on an incomplete dataset.** Accepted and surfaced via the loading
  note rather than blocked, per the chosen design.
