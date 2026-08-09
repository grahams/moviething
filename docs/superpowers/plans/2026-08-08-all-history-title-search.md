# All-History Title Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard's "Search Titles" box search all viewing history regardless of the selected date range, and collapse the charts while a search is active.

**Architecture:** Purely client-side. The full 2003→present dataset is already fetched into `state.allMovieData` by `fetchAllDataInBackground` (`client/js/main.js:492`), so no new server endpoint is needed. The filter predicate is extracted from `applyDateRangeFilter` into a new pure module `client/js/filter.js` that is unit-tested with a new minimal Jest project in the `client/` workspace. The remaining changes are DOM state management in `main.js` plus markup and CSS.

**Tech Stack:** Plain ES5-style jQuery (no build step, no bundler), Bootstrap 5, Highcharts, Jest 29 (Node test environment), npm workspaces.

## Global Constraints

- **No build step.** `client/` is served as static files. Scripts are plain globals loaded via `<script>` tags — do not introduce ES modules, `import`/`export`, bundlers, or transpilation.
- **Match existing style.** `client/js/main.js` uses `var`, function expressions assigned to `var`, and 4-space indentation. Follow it. Do not convert existing code to `const`/`let`/arrow functions.
- **No server changes.** Do not add API routes, DB queries, or touch anything under `server/`.
- **Jest version:** `^29.7.0`, matching `server/package.json`.
- **Date strings** throughout are `YYYY-MM-DD` and compared as strings.
- **Sort order is unchanged.** `state.allMovieData` is sorted oldest-first at load; `prepareListData` renders in array order. Do not add sorting.
- **Do not disable the date inputs.** They are visually muted during search but keep their values and take effect again when the search is cleared.
- Spec: `docs/superpowers/specs/2026-08-08-all-history-title-search-design.md`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `client/js/filter.js` | **New.** Pure `filterMovies(data, opts)` — the only place the date-vs-title filter rule lives. Browser global + CommonJS export guard. |
| `client/__tests__/filter.test.js` | **New.** Unit tests for `filterMovies`. |
| `client/jest.config.js` | **New.** Minimal Jest config for the client workspace. |
| `client/package.json` | Add `jest` devDependency and `test` script. |
| `client/js/main.js` | Consume `filterMovies`; own DOM state: search-vs-date UI muting, status messages, chart collapse. |
| `client/index.html` | Markup: `filter.js` script tag, date-ignored note, `#searchStatus`, `#chartsSection` wrapper and toggle button. |
| `client/css/main.css` | `.filter-inactive`, `.filter-note` styles (light + dark mode). |

---

### Task 1: Extract `filterMovies` into a tested pure module

Sets up the client Jest project and builds the filter rule test-first. Produces no visible behavior change — `main.js` is not touched in this task.

**Files:**
- Create: `client/jest.config.js`
- Create: `client/__tests__/filter.test.js`
- Create: `client/js/filter.js`
- Modify: `client/package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `filterMovies(data, opts)` where `data` is an array of row objects with `movieTitle` (string, may be null) and `viewingDate` (string `YYYY-MM-DD`, may be null), and `opts` is `{ startDate: string, endDate: string, titleSearch: string }`. Returns a new filtered array, preserving input order. When `opts.titleSearch` is non-empty after trimming, the date range is ignored entirely.

- [ ] **Step 1: Add the Jest config**

Create `client/jest.config.js`:

```js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
};
```

- [ ] **Step 2: Add the test script and Jest devDependency**

In `client/package.json`, add `"test": "jest"` to `scripts` and `"jest": "^29.7.0"` to `devDependencies`. Result:

```json
{
  "name": "@moviething/client",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "serve -s .",
    "dev": "serve -l 3001 .",
    "test": "jest"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "serve": "^14.2.1"
  }
}
```

Then install from the repo root so the workspace is linked:

```bash
npm install
```

- [ ] **Step 3: Write the failing tests**

Create `client/__tests__/filter.test.js`:

```js
'use strict';

const { filterMovies } = require('../js/filter');

const ROWS = [
    { movieTitle: 'Alien', viewingDate: '1979-06-02' },
    { movieTitle: 'Aliens', viewingDate: '1994-11-13' },
    { movieTitle: 'Alien Romulus', viewingDate: '2024-08-20' },
    { movieTitle: 'Barbie', viewingDate: '2026-03-01' }
];

const YEAR_2026 = { startDate: '2026-01-01', endDate: '2026-12-31' };

function titles(rows) {
    return rows.map(function (row) { return row.movieTitle; });
}

describe('filterMovies', () => {
    test('with an empty search, filters by date range only', () => {
        const result = filterMovies(ROWS, Object.assign({ titleSearch: '' }, YEAR_2026));
        expect(titles(result)).toEqual(['Barbie']);
    });

    test('with a search, returns matches outside the date range', () => {
        const result = filterMovies(ROWS, Object.assign({ titleSearch: 'alien' }, YEAR_2026));
        expect(titles(result)).toEqual(['Alien', 'Aliens', 'Alien Romulus']);
    });

    test('matches case-insensitively on substrings', () => {
        const result = filterMovies(ROWS, Object.assign({ titleSearch: 'ROMU' }, YEAR_2026));
        expect(titles(result)).toEqual(['Alien Romulus']);
    });

    test('trims surrounding whitespace from the search term', () => {
        const result = filterMovies(ROWS, Object.assign({ titleSearch: '  barbie  ' }, YEAR_2026));
        expect(titles(result)).toEqual(['Barbie']);
    });

    test('treats a whitespace-only search as no search', () => {
        const result = filterMovies(ROWS, Object.assign({ titleSearch: '   ' }, YEAR_2026));
        expect(titles(result)).toEqual(['Barbie']);
    });

    test('treats a missing titleSearch as no search', () => {
        const result = filterMovies(ROWS, Object.assign({}, YEAR_2026));
        expect(titles(result)).toEqual(['Barbie']);
    });

    test('skips rows with no title when searching', () => {
        const rows = ROWS.concat([{ movieTitle: null, viewingDate: '1999-01-01' }]);
        const result = filterMovies(rows, Object.assign({ titleSearch: 'alien' }, YEAR_2026));
        expect(titles(result)).toEqual(['Alien', 'Aliens', 'Alien Romulus']);
    });

    test('skips rows with no viewing date when date filtering', () => {
        const rows = ROWS.concat([{ movieTitle: 'Undated', viewingDate: null }]);
        const result = filterMovies(rows, Object.assign({ titleSearch: '' }, YEAR_2026));
        expect(titles(result)).toEqual(['Barbie']);
    });

    test('compares only the date portion of a longer viewingDate string', () => {
        const rows = [{ movieTitle: 'Timestamped', viewingDate: '2026-03-01T00:00:00.000Z' }];
        const result = filterMovies(rows, Object.assign({ titleSearch: '' }, YEAR_2026));
        expect(titles(result)).toEqual(['Timestamped']);
    });

    test('does not mutate the input array', () => {
        const rows = ROWS.slice();
        filterMovies(rows, Object.assign({ titleSearch: 'alien' }, YEAR_2026));
        expect(rows).toHaveLength(ROWS.length);
    });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test --workspace=client`
Expected: FAIL — `Cannot find module '../js/filter' from '__tests__/filter.test.js'`

- [ ] **Step 5: Write the implementation**

Create `client/js/filter.js`:

```js
// Filters movie rows for the dashboard. When a title search is active the
// date range is ignored entirely, so search always spans all of history.
var filterMovies = function(data, opts) {
    var titleSearch = (opts.titleSearch || "").toLowerCase().trim();

    if (titleSearch) {
        return data.filter(function(row) {
            return !!row.movieTitle &&
                row.movieTitle.toLowerCase().indexOf(titleSearch) !== -1;
        });
    }

    return data.filter(function(row) {
        var d = row.viewingDate ? row.viewingDate.slice(0, 10) : null;
        return !!d && d >= opts.startDate && d <= opts.endDate;
    });
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { filterMovies: filterMovies };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace=client`
Expected: PASS — 10 tests passing.

- [ ] **Step 7: Verify the server suite still runs from the root**

Run: `npm test`
Expected: both `@moviething/client` and `@moviething/server` suites run and pass.

- [ ] **Step 8: Commit**

```bash
git add client/jest.config.js client/package.json client/__tests__/filter.test.js client/js/filter.js package-lock.json
git commit -m "test: add client jest project and pure filterMovies"
```

---

### Task 2: Make search ignore the date range

Wires `filterMovies` into the dashboard. After this task the core user-facing behavior works: typing a title finds it anywhere in history.

**Files:**
- Modify: `client/index.html` (script tags, around line 84-86)
- Modify: `client/js/main.js:527-561` (`applyDateRangeFilter`)

**Interfaces:**
- Consumes: `filterMovies(data, opts)` from Task 1, available as a browser global.
- Produces: `applyDateRangeFilter()` keeps its current name and zero-argument signature; it now delegates filtering to `filterMovies`.

- [ ] **Step 1: Load `filter.js` in the page**

In `client/index.html`, add the script tag before `main.js` so the global exists when `main.js` runs:

```html
        <script src="js/plugins.js"></script>
        <script src="js/merge-rules.js"></script>
        <script src="js/filter.js"></script>
        <script src="js/main.js"></script>
```

- [ ] **Step 2: Delegate filtering in `applyDateRangeFilter`**

In `client/js/main.js`, replace this block (currently at lines 535-545):

```js
    var startDate = $("#startDate").val();
    var endDate = $("#endDate").val();
    var titleSearch = $("#titleSearch").val().toLowerCase().trim();
    
    var filtered = state.allMovieData.filter(function(row) {
        var d = row.viewingDate ? row.viewingDate.slice(0, 10) : null;
        var dateMatch = d && d >= startDate && d <= endDate;
        var titleMatch = !titleSearch || (row.movieTitle && row.movieTitle.toLowerCase().includes(titleSearch));
        return dateMatch && titleMatch;
    });
```

with:

```js
    var filtered = filterMovies(state.allMovieData, {
        startDate: $("#startDate").val(),
        endDate: $("#endDate").val(),
        titleSearch: $("#titleSearch").val()
    });
```

- [ ] **Step 3: Verify in the browser**

Run the app (`npm run dev` from the repo root) and open the dashboard. Wait a couple of seconds for the background history fetch, then:

1. With the default current-year date range, type a title you last watched years ago into **Search Titles**.
   Expected: the old viewing appears in the movie list, with its original year in the Viewing Date column.
2. Clear the search.
   Expected: the list returns to the current-year entries and the date fields are unchanged.
3. Set a narrow date range, click **Apply Filter**, confirm it still narrows the list.
   Expected: date filtering still works when the search box is empty.

- [ ] **Step 4: Commit**

```bash
git add client/index.html client/js/main.js
git commit -m "feat: search titles across all history, ignoring the date range"
```

---

### Task 3: Signal that dates are ignored, and surface history-load state

Makes the override visible and replaces the current silent failure of the background fetch with a message and a retry.

**Files:**
- Modify: `client/index.html` (filter form, around lines 24-37)
- Modify: `client/js/main.js` (state object at lines 9-14; `fetchAllDataInBackground` at lines 491-525; `applyDateRangeFilter` at line 527; new handlers)
- Modify: `client/css/main.css` (append)

**Interfaces:**
- Consumes: `applyDateRangeFilter()` from Task 2.
- Produces:
  - `isSearching()` → `boolean`, true when `#titleSearch` has non-whitespace text. Task 4 uses this.
  - `updateSearchUiState()` → `undefined`, syncs the muted date controls and `#searchStatus` from current state.
  - `state.backgroundLoadFailed` (boolean) and `state.backgroundLoadStart` (string `YYYY-MM-DD`, the argument the background fetch was first called with).

- [ ] **Step 1: Add the markup**

In `client/index.html`, add the note inside the filter form after the Apply Filter button, and the status line after the form. The `#dateRangeFilter` block becomes:

```html
            <!-- Date Range Filter UI -->
            <div class="mb-3" id="dateRangeFilter">
                <form>
                    <label for="startDate" class="me-2">Start Date:</label>
                    <input type="date" id="startDate" class="filter-input form-control me-2">
                    <label for="endDate" class="me-2">End Date:</label>
                    <input type="date" id="endDate" class="filter-input form-control me-2">
                    <button type="button" id="setStart2003" class="btn btn-secondary me-2">All</button>
                    <label for="titleSearch" class="me-2">Search Titles:</label>
                    <div style="position: relative; display: inline-block;">
                        <input type="text" id="titleSearch" class="filter-input form-control me-2 pe-4" placeholder="Enter movie title..." style="padding-right: 2rem;">
                        <button type="button" id="clearTitleSearch" style="position: absolute; right: 15px; top: 50%; transform: translateY(-50%); border: none; background: transparent; padding: 0; font-size: 1.2em; line-height: 1; color: #aaa; display: none;" tabindex="-1" aria-label="Clear title search">&times;</button>
                    </div>
                    <button type="button" id="applyDateFilter" class="btn btn-primary">Apply Filter</button>
                </form>
                <div id="dateIgnoredNote" class="filter-note" style="display: none;">Date range ignored while searching</div>
                <div id="searchStatus" class="filter-note" style="display: none;"></div>
            </div>
```

- [ ] **Step 2: Add the styles**

Append to `client/css/main.css`:

```css
/* Muted date controls while a title search overrides them */
.filter-inactive {
    opacity: 0.45;
}

.filter-note {
    margin-top: 0.35rem;
    font-size: 0.9em;
    color: #666;
}

body.dark-mode .filter-note {
    color: #aaa;
}
```

- [ ] **Step 3: Add the new state flags**

In `client/js/main.js`, extend the `state` object (lines 9-14):

```js
var state = {
    allMovieData: [],
    allDataLoaded: false,
    backgroundLoading: false,
    backgroundLoadFailed: false,
    backgroundLoadStart: null,
    initialYear: null
};
```

- [ ] **Step 4: Add the UI state helpers**

In `client/js/main.js`, add these two functions immediately above `function applyDateRangeFilter()` (line 527):

```js
function isSearching() {
    return $("#titleSearch").val().trim().length > 0;
}

function updateSearchUiState() {
    var searching = isSearching();

    $("#startDate, #endDate, #setStart2003, #applyDateFilter")
        .toggleClass("filter-inactive", searching);
    $("#dateIgnoredNote").toggle(searching);

    var $status = $("#searchStatus");
    if (state.backgroundLoadFailed) {
        $status
            .html('&#9888; Couldn\'t load full history &mdash; <a href="#" id="retryHistoryLoad">Retry</a>')
            .show();
    } else if (searching && !state.allDataLoaded) {
        $status
            .text("⏳ Still loading full history — results will update.")
            .show();
    } else {
        $status.hide().empty();
    }
}
```

Note the loading condition is `!state.allDataLoaded` rather than `state.backgroundLoading`: it also covers the window before the background fetch starts, when the dataset is equally incomplete.

- [ ] **Step 5: Call the helper from `applyDateRangeFilter`**

Make `updateSearchUiState();` the first line of `applyDateRangeFilter` (line 528, before the `createFirstViewingChart()` call). Every path that changes the search or finishes loading already funnels through `applyDateRangeFilter`, so this is the only call site needed.

- [ ] **Step 6: Record the background fetch's start date and handle failure**

In `client/js/main.js`, in `fetchAllDataInBackground` (line 491), record the argument right after the guard:

```js
function fetchAllDataInBackground(currentYearStart) {
    if (state.backgroundLoading || state.allDataLoaded) return;
    state.backgroundLoading = true;
    state.backgroundLoadStart = currentYearStart;
```

and replace the `.fail()` handler at the end of the same function:

```js
    }).fail(function() {
        state.backgroundLoading = false;
        state.backgroundLoadFailed = true;
        updateSearchUiState();
    });
```

- [ ] **Step 7: Wire the retry link**

The link is inserted dynamically, so use a delegated handler. Add it inside the existing `$(document).ready(...)` block in `client/js/main.js`, next to the other handlers (e.g. after the `#setStart2003` handler around line 364):

```js
    $(document).on("click", "#retryHistoryLoad", function(e) {
        e.preventDefault();
        state.backgroundLoadFailed = false;
        updateSearchUiState();
        fetchAllDataInBackground(state.backgroundLoadStart);
    });
```

- [ ] **Step 8: Verify in the browser**

1. Type into the search box.
   Expected: the date inputs, **All**, and **Apply Filter** fade to 45% opacity and "Date range ignored while searching" appears. Clearing the search restores them.
2. Reload and type into the search box immediately, before the background fetch lands.
   Expected: "⏳ Still loading full history — results will update." appears, then disappears and the result list grows once loading finishes.
3. Simulate a failure: in DevTools, throttle to Offline, reload, go back Online after the page loads but let the background request fail — or temporarily change the URL in `fetchAllDataInBackground` to a bad path.
   Expected: "⚠ Couldn't load full history — Retry" appears; clicking **Retry** re-runs the fetch and the message clears on success. Revert any temporary URL edit.
4. Toggle dark mode with a search active.
   Expected: the note text is legible in both themes.

- [ ] **Step 9: Commit**

```bash
git add client/index.html client/css/main.css client/js/main.js
git commit -m "feat: show search overrides dates, and surface history load state"
```

---

### Task 4: Collapse charts while searching

Puts the movie list at the top of the page during a search, with a sticky manual override.

**Files:**
- Modify: `client/index.html` (chart containers, lines 47-55)
- Modify: `client/js/main.js` (state object; `applyDateRangeFilter`; `#theatreControlButton` handler at line 297; new toggle handler)

**Interfaces:**
- Consumes: `isSearching()` and `updateSearchUiState()` from Task 3.
- Produces: `chartsVisible()` → `boolean`; `state.chartsExpandedDuringSearch` (boolean, session-only, reset whenever the search is empty).

- [ ] **Step 1: Wrap the chart containers and add the toggle**

In `client/index.html`, replace the block of chart container divs (currently lines 47-55) with:

```html
            <div id="chartsToggleContainer" class="mb-2" style="display: none;">
                <button type="button" id="toggleCharts" class="btn btn-outline-secondary btn-sm">Show charts</button>
            </div>

            <div id="chartsSection">
                <div id="formatContainer"></div>
                <div id="theatreContainer"></div>
                <div id="theatreControlContainer">
                    <button id="theatreControlButton" class="btn btn-outline-primary">Toggle "Home"</button>
                </div>
                <div id="firstViewingContainer"></div>
                <div id="genreContainer"></div>
                <div id="monthContainer"></div>
            </div>
```

`#textStats` (above) and `#movieListDiv` (below) stay outside the wrapper — they remain visible during a search.

- [ ] **Step 2: Add the sticky-expand flag**

In `client/js/main.js`, add to the `state` object:

```js
    chartsExpandedDuringSearch: false,
```

- [ ] **Step 3: Add `chartsVisible()`**

Add directly below `isSearching()` in `client/js/main.js`:

```js
function chartsVisible() {
    return !isSearching() || state.chartsExpandedDuringSearch;
}
```

- [ ] **Step 4: Skip chart work when collapsed**

Rewrite `applyDateRangeFilter` (which, after Tasks 2 and 3, runs from line 527) to this. The `#chartsSection` must be un-hidden *before* the create calls, or Highcharts measures a zero-width container:

```js
function applyDateRangeFilter() {
    if (!isSearching()) {
        state.chartsExpandedDuringSearch = false;
    }

    updateSearchUiState();

    var showCharts = chartsVisible();
    $("#chartsToggleContainer").toggle(isSearching());
    $("#toggleCharts").text(showCharts ? "Hide charts" : "Show charts");
    $("#chartsSection").toggle(showCharts);

    // Always recreate charts before updating
    if (showCharts) {
        createFirstViewingChart();
        createTheatreChart();
        createFormatChart();
        createGenreChart();
        createMonthChart();
    }

    var filtered = filterMovies(state.allMovieData, {
        startDate: $("#startDate").val(),
        endDate: $("#endDate").val(),
        titleSearch: $("#titleSearch").val()
    });

    // Clear previous chart/list data
    if (showCharts) {
        if (charts.format) { charts.format.series[0].setData([]); charts.format.axes[0].setCategories([]); }
        if (charts.theatre) { charts.theatre.series[0].setData([]); charts.theatre.axes[0].setCategories([]); }
        if (charts.firstViewing) { charts.firstViewing.series[0].setData([]); }
        if (charts.genre) { charts.genre.series[0].setData([]); charts.genre.axes[0].setCategories([]); }
        if (charts.month) { charts.month.series[0].setData([]); charts.month.axes[0].setCategories([]); }
    }
    $("#movieList tbody").empty();

    // Update all UI with filtered data
    if($("#textStats").length > 0) { prepareTextData(filtered); }
    if(showCharts) {
        if($("#formatContainer").length > 0) { prepareFormatData(filtered); }
        if($("#theatreContainer").length > 0) { prepareTheatreData(filtered); }
        if($("#firstViewingContainer").length > 0) { prepareFirstViewingData(filtered); }
        if($("#genreContainer").length > 0) { prepareGenreData(filtered); }
        if($("#monthContainer").length > 0) { prepareMonthData(filtered); }
    }
    if($("#movieListDiv").length > 0) { prepareListData(filtered); }
}
```

- [ ] **Step 5: Wire the toggle button**

Add inside the existing `$(document).ready(...)` block in `client/js/main.js`, next to the `#theatreControlButton` handler:

```js
    $("#toggleCharts").on("click", function() {
        state.chartsExpandedDuringSearch = !state.chartsExpandedDuringSearch;
        applyDateRangeFilter();
    });
```

The button is only visible while searching (Step 4 hides `#chartsToggleContainer` otherwise), so this always means "expand/collapse during this search".

- [ ] **Step 6: Guard the theatre toggle against a missing chart**

The `#theatreControlButton` handler (line 297) dereferences `charts.theatre.series[0]` unguarded. Its container is now hidden during a collapsed search, but make it defensive:

```js
    $("#theatreControlButton").on("click", function(event) {
        if (!charts.theatre) { return; }
        var data  = charts.theatre.series[0].data;
```

- [ ] **Step 7: Verify in the browser**

1. Type a search.
   Expected: charts disappear, the movie list sits directly under the stats, and a **Show charts** button appears above it.
2. Click **Show charts** during the search.
   Expected: charts render at full width (not squashed to zero width) with data for the matched set, and the button reads **Hide charts**.
3. Change the search text without clearing it.
   Expected: charts stay expanded — the override is sticky.
4. Clear the search.
   Expected: charts reappear, the toggle button disappears, and stats/charts show the date-range data again.
5. Search again after clearing.
   Expected: charts auto-collapse — the sticky flag was reset.
6. Toggle dark mode while charts are collapsed during a search, then expand.
   Expected: no JavaScript errors in the console; charts render with the correct theme.

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: all client and server tests pass.

- [ ] **Step 9: Commit**

```bash
git add client/index.html client/js/main.js
git commit -m "feat: collapse charts while a title search is active"
```

---

## Verification Summary

After all four tasks:

- `npm test` — client `filterMovies` unit tests plus the existing server suite, all passing.
- Browser: search finds titles outside the date range; date controls mute with an explanatory note; loading and failure states appear and clear; charts auto-collapse on search and stick when manually expanded.

Not covered by automated tests: all DOM behavior. The client has no DOM test harness and adding one is out of scope per the spec — the browser steps in Tasks 2-4 are the verification.
