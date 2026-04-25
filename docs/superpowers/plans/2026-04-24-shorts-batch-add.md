# Shorts Batch Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable batch-adding individual shorts from festival shorts packages to the moviething database, with TMDB lookup and manual fallback.

**Architecture:** A new `--export-packages` flag on iff-schedule-tool emits a lightweight JSON file. A new moviething frontend page loads that JSON client-side, lets the user pick a package, runs TMDB lookups, and submits all entries via a new batch endpoint. The backend adds one new route (`POST /api/newEntries`) and one new Zod schema; everything else is reused.

**Tech Stack:** Python (iff-schedule-tool), Node/Express + Zod (backend), jQuery + Bootstrap 5 (frontend)

---

## File Map

### iff-schedule-tool (separate repo: `~/src/iff-schedule-tool/`)

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `iffboston_schedule.py` | Add `--export-packages` flag and `export_packages()` function |

### moviething — Backend

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `server/validation/schemas.js` | Add `batchEntrySchema` |
| Modify | `server/routes/entries.js` | Add `POST /newEntries` batch endpoint |
| Create | `server/__tests__/batch.test.js` | Tests for the batch endpoint |

### moviething — Frontend

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `client/add/shorts.html` | Shorts batch-add page HTML |
| Create | `client/add/js/shorts.js` | All JS for the shorts page (load JSON, TMDB lookups, batch submit) |

---

## Task 1: Export packages from iff-schedule-tool

**Files:**
- Modify: `~/src/iff-schedule-tool/iffboston_schedule.py:1037-1076` (main function + argparse)

- [ ] **Step 1: Add the `export_packages()` function**

Add this function after the existing `build_program_map()` function (after line 131):

```python
SITE_BASE = "https://iffboston.org"


def export_packages(program_map, all_events, output_path):
    """Export shorts packages to a JSON file for moviething batch-add.

    Output format:
    {
      "festival": "IFFBoston 2026",
      "packages": [
        {
          "name": "Shorts Mass Ave: Documentary",
          "shorts": [
            {"title": "...", "director": "...", "runtime": 25, "url": "https://iffboston.org/events/..."}
          ]
        }
      ]
    }
    """
    # Build a title -> uri lookup from all events
    uri_map = {}
    for ev in all_events:
        uri_map[ev["title"]] = ev.get("uri", "")

    packages = []
    for program_title in sorted(program_map.keys()):
        shorts = []
        for s in program_map[program_title]:
            uri = uri_map.get(s["title"], "")
            url = f"{SITE_BASE}{uri}" if uri else ""
            runtime = s["runtime"]
            if isinstance(runtime, str) and runtime != "?":
                try:
                    runtime = int(runtime)
                except ValueError:
                    pass
            shorts.append({
                "title": s["title"],
                "director": s["director"],
                "runtime": runtime,
                "url": url,
            })
        packages.append({
            "name": program_title,
            "shorts": shorts,
        })

    output = {
        "festival": "IFFBoston 2026",
        "packages": packages,
    }

    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)
    print(f"Exported {len(packages)} packages to {output_path}")
```

Note: `SITE_BASE` is already defined on line 399 of the existing file. If it's only used inside the SVG generation section, either move it to module level or define a second reference here. Check whether it's already at module level before adding the constant — if it is, skip the `SITE_BASE = ...` line above.

- [ ] **Step 2: Add `--export-packages` CLI flag and wire it up**

In the `main()` function, add the new argument to the argparse block (after the `--no-pass` argument, around line 1049):

```python
    parser.add_argument("--export-packages", metavar="FILE",
                        help="Export shorts packages to JSON file for moviething batch-add")
```

Then add the export call after the `program_map` is built (after line 1061, before `screenings = ...`):

```python
    if args.export_packages:
        export_packages(program_map, all_events, args.export_packages)
        if args.no_svg and args.no_markdown and args.no_pass:
            return
```

- [ ] **Step 3: Test the export**

Run:
```bash
cd ~/src/iff-schedule-tool
python3 iffboston_schedule.py --export-packages packages.json --no-svg --no-markdown --no-pass
cat packages.json | python3 -m json.tool | head -40
```

Expected: A JSON file with `festival`, `packages` array, each package has `name` and `shorts` with `title`, `director`, `runtime`, `url` fields. URLs should start with `https://iffboston.org/events/`.

- [ ] **Step 4: Commit**

```bash
cd ~/src/iff-schedule-tool
git add iffboston_schedule.py
git commit -m "feat: add --export-packages flag for moviething batch-add"
```

---

## Task 2: Add batch entry validation schema

**Files:**
- Modify: `server/validation/schemas.js:1-28`
- Test: `server/__tests__/validate.test.js`

- [ ] **Step 1: Write the failing test**

Add this test to `server/__tests__/validate.test.js`. First read the existing file to find the right place to add it, then append a new `describe` block:

```javascript
const { newEntrySchema, batchEntrySchema } = require('../validation/schemas');

describe('batchEntrySchema', () => {
  const validEntry = {
    movieTitle: 'Test Short',
    viewingDate: '04/24/2026',
    movieURL: 'https://iffboston.org/events/test-short/',
    viewFormat: 'IFFBoston',
    viewLocation: 'Somerville Theatre',
    movieGenre: 'Short',
    movieReview: '',
    firstViewing: true
  };

  it('should accept a valid batch of entries', () => {
    const result = batchEntrySchema.safeParse({ entries: [validEntry, validEntry] });
    expect(result.success).toBe(true);
    expect(result.data.entries).toHaveLength(2);
  });

  it('should reject an empty entries array', () => {
    const result = batchEntrySchema.safeParse({ entries: [] });
    expect(result.success).toBe(false);
  });

  it('should reject when entries is missing', () => {
    const result = batchEntrySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject when an entry is invalid', () => {
    const badEntry = { ...validEntry, movieTitle: '' };
    const result = batchEntrySchema.safeParse({ entries: [validEntry, badEntry] });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/grahams/src/moviething && npx jest server/__tests__/validate.test.js --verbose`

Expected: FAIL — `batchEntrySchema` is not exported from schemas.js

- [ ] **Step 3: Write minimal implementation**

In `server/validation/schemas.js`, add the `batchEntrySchema` after `updateEntrySchema` (after line 26):

```javascript
const batchEntrySchema = z.object({
  entries: z.array(newEntrySchema).min(1)
});
```

Update the `module.exports` line (line 28) to:

```javascript
module.exports = { newEntrySchema, updateEntrySchema, batchEntrySchema };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/grahams/src/moviething && npx jest server/__tests__/validate.test.js --verbose`

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/grahams/src/moviething
git add server/validation/schemas.js server/__tests__/validate.test.js
git commit -m "feat: add batchEntrySchema for shorts batch-add"
```

---

## Task 3: Add POST /api/newEntries batch endpoint

**Files:**
- Modify: `server/routes/entries.js:1-72`
- Create: `server/__tests__/batch.test.js`

- [ ] **Step 1: Write the failing tests**

Create `server/__tests__/batch.test.js`:

```javascript
const request = require('supertest');
const { app } = require('../index');

describe('POST /api/newEntries', () => {
  let mockConnection;

  const validEntry = {
    movieTitle: 'Test Short',
    viewingDate: '04/24/2026',
    movieURL: 'https://iffboston.org/events/test-short/',
    viewFormat: 'IFFBoston',
    viewLocation: 'Somerville Theatre',
    movieGenre: 'Short',
    movieReview: 'Lovely little film',
    firstViewing: true
  };

  beforeEach(() => {
    mockConnection = {
      query: jest.fn(),
      release: jest.fn(),
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
    };
    global.mockPool.getConnection.mockResolvedValue(mockConnection);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should insert multiple entries in a transaction', async () => {
    mockConnection.query.mockResolvedValue({ affectedRows: 1 });

    const response = await request(app)
      .post('/api/newEntries')
      .set('X-Authentik-Username', 'testuser')
      .send({ json: JSON.stringify({ entries: [validEntry, { ...validEntry, movieTitle: 'Another Short' }] }) })
      .expect(200);

    expect(response.body).toEqual({ data: { ok: true, count: 2 } });
    expect(mockConnection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(mockConnection.commit).toHaveBeenCalledTimes(1);
    expect(mockConnection.query).toHaveBeenCalledTimes(2);
  });

  it('should reject with 401 without auth', async () => {
    await request(app)
      .post('/api/newEntries')
      .send({ json: JSON.stringify({ entries: [validEntry] }) })
      .expect(401);
  });

  it('should reject with 400 for empty entries array', async () => {
    await request(app)
      .post('/api/newEntries')
      .set('X-Authentik-Username', 'testuser')
      .send({ json: JSON.stringify({ entries: [] }) })
      .expect(400);
  });

  it('should reject with 400 when an entry fails validation', async () => {
    const badEntry = { ...validEntry, movieURL: 'not-a-url' };

    await request(app)
      .post('/api/newEntries')
      .set('X-Authentik-Username', 'testuser')
      .send({ json: JSON.stringify({ entries: [validEntry, badEntry] }) })
      .expect(400);

    expect(mockConnection.beginTransaction).not.toHaveBeenCalled();
  });

  it('should rollback on database error', async () => {
    mockConnection.query.mockRejectedValueOnce(new Error('DB error'));

    await request(app)
      .post('/api/newEntries')
      .set('X-Authentik-Username', 'testuser')
      .send({ json: JSON.stringify({ entries: [validEntry] }) })
      .expect(500);

    expect(mockConnection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
    expect(mockConnection.commit).not.toHaveBeenCalled();
  });

  it('should accept request with X-Api-Key header', async () => {
    mockConnection.query.mockResolvedValue({ affectedRows: 1 });

    await request(app)
      .post('/api/newEntries')
      .set('X-Api-Key', process.env.MOVIETHING_VALID_API_KEY)
      .send({ json: JSON.stringify({ entries: [validEntry] }) })
      .expect(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/grahams/src/moviething && npx jest server/__tests__/batch.test.js --verbose`

Expected: FAIL — 404 because the route doesn't exist yet

- [ ] **Step 3: Write the batch endpoint**

In `server/routes/entries.js`, add the import for `batchEntrySchema` (modify line 8):

```javascript
const { newEntrySchema, updateEntrySchema, batchEntrySchema } = require('../validation/schemas');
```

Add the import for the pool (add after line 5):

```javascript
const { pool } = require('../db');
```

Then add the batch endpoint after the existing `POST /newEntry` route (after line 51, before the `PUT` route):

```javascript
router.post('/newEntries', requireAuth, validate(batchEntrySchema), async (req, res, next) => {
  const { entries } = req.validatedBody;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    for (const entry of entries) {
      const parsedDate = parseDate(entry.viewingDate, 'MM/dd/yyyy', new Date()).toISOString().split('T')[0];
      await conn.query(
        'INSERT INTO movies (movieTitle, viewingDate, movieURL, viewFormat, viewLocation, movieGenre, movieReview, firstViewing) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [entry.movieTitle, parsedDate, entry.movieURL, entry.viewFormat, entry.viewLocation, entry.movieGenre, entry.movieReview, entry.firstViewing ? 1 : 0]
      );
    }

    await conn.commit();
    res.json({ data: { ok: true, count: entries.length } });
  } catch (err) {
    if (conn) await conn.rollback();
    next(err);
  } finally {
    if (conn) conn.release();
  }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/grahams/src/moviething && npx jest server/__tests__/batch.test.js --verbose`

Expected: All tests PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `cd /Users/grahams/src/moviething && npm test`

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/grahams/src/moviething
git add server/routes/entries.js server/validation/schemas.js server/__tests__/batch.test.js
git commit -m "feat: add POST /api/newEntries batch endpoint for shorts"
```

---

## Task 4: Create shorts batch-add HTML page

**Files:**
- Create: `client/add/shorts.html`

- [ ] **Step 1: Create the HTML page**

Create `client/add/shorts.html`. This follows the same structure as `client/add/index.html` — same CDN links, same Bootstrap/datepicker dependencies, same dark-mode support:

```html
<!doctype html>
<html class="no-js" lang="">

<head>
    <meta charset="utf-8">
    <title>Add Shorts Package - MovieThing</title>
    <meta name="description" content="">
    <meta name="viewport" content="width=device-width, initial-scale=1">

    <link rel="stylesheet" href="../css/normalize.css">
    <link rel="stylesheet" href="../css/main.css">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
</head>

<body>
    <div class="container-fluid p-2" style="max-width: 1200px; margin: 0 auto;">
        <div class="mb-3">
            <a href="/" class="btn btn-outline-primary">← Back to Charts</a>
            <a href="/add/" class="btn btn-outline-secondary ms-2">Single Add</a>
        </div>

        <h4 class="mb-3">Add Shorts Package</h4>

        <!-- Phase 1: Load & Select -->
        <div id="phase1" class="card mb-3">
            <div class="card-body">
                <h5 class="card-title">1. Load Package File</h5>
                <div class="mb-3">
                    <input type="file" class="form-control" id="packageFile" accept=".json">
                </div>
                <div id="packageSelectGroup" style="display: none;">
                    <label for="packageSelect" class="form-label">Select a shorts package:</label>
                    <select id="packageSelect" class="form-select">
                        <option value="">-- Choose a package --</option>
                    </select>
                </div>
            </div>
        </div>

        <!-- Phase 2: Shared Fields -->
        <div id="phase2" class="card mb-3" style="display: none;">
            <div class="card-body">
                <h5 class="card-title">2. Viewing Details</h5>
                <div class="row g-2">
                    <div class="col-md-4">
                        <label for="viewingDate" class="form-label">Viewing Date</label>
                        <input id="viewingDate" data-provide="datepicker" type="text" class="form-control"
                            placeholder="Viewing date">
                    </div>
                    <div class="col-md-4">
                        <label for="viewFormat" class="form-label">Format</label>
                        <select id="viewFormat" class="form-select">
                            <option value="viewFormat">View Format</option>
                        </select>
                    </div>
                    <div class="col-md-4">
                        <label for="viewLocation" class="form-label">Location</label>
                        <select id="viewLocation" class="form-select">
                            <option value="viewLocation">View Location</option>
                        </select>
                    </div>
                </div>
                <div class="row g-2 mt-1">
                    <div class="col-md-4">
                        <label for="movieGenre" class="form-label">Genre</label>
                        <input id="movieGenre" type="text" class="form-control" value="Short">
                    </div>
                    <div class="col-md-4 d-flex align-items-end">
                        <div class="form-check">
                            <input type="checkbox" class="form-check-input" id="firstViewing" checked>
                            <label class="form-check-label" for="firstViewing">First viewing?</label>
                        </div>
                    </div>
                </div>
                <div class="mt-3">
                    <button id="lookupBtn" class="btn btn-primary" disabled>Look up shorts on TMDB</button>
                </div>
            </div>
        </div>

        <!-- Phase 3: Review & Submit -->
        <div id="phase3" style="display: none;">
            <h5 class="mb-3">3. Review Shorts</h5>
            <div id="lookupProgress" class="mb-3" style="display: none;">
                <div class="progress">
                    <div id="progressBar" class="progress-bar" role="progressbar" style="width: 0%"></div>
                </div>
                <small id="progressText" class="text-muted"></small>
            </div>
            <div id="shortsCards"></div>
            <div class="mt-3">
                <button id="submitAll" class="btn btn-success btn-lg" disabled>Submit All</button>
                <span id="submitStatus" class="ms-3"></span>
            </div>
        </div>
    </div>

    <script src="https://code.jquery.com/jquery-3.7.1.min.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/bootstrap-datepicker/1.7.1/js/bootstrap-datepicker.min.js"
        integrity="sha256-TueWqYu0G+lYIimeIcMI8x1m14QH/DQVt4s9m/uuhPw=" crossorigin="anonymous"></script>
    <link rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap-datepicker/1.7.1/css/bootstrap-datepicker3.min.css"
        integrity="sha256-WgFzD1SACMRatATw58Fxd2xjHxwTdOqB48W5h+ZGLHA=" crossorigin="anonymous" />

    <script src="../js/plugins.js"></script>
    <script src="js/shorts.js"></script>
</body>

</html>
```

- [ ] **Step 2: Commit**

```bash
cd /Users/grahams/src/moviething
git add client/add/shorts.html
git commit -m "feat: add shorts batch-add HTML page"
```

---

## Task 5: Create shorts batch-add JavaScript

**Files:**
- Create: `client/add/js/shorts.js`

This is the largest task. The JS handles all three phases: loading the JSON, TMDB lookups, and batch submission. It reuses the same config patterns from `client/add/js/main.js` (view formats, locations, dark mode).

- [ ] **Step 1: Create `client/add/js/shorts.js` with configuration and Phase 1 (load & select)**

```javascript
// Use same-origin API base URL
var API_BASE_URL = window.location.origin + '/api';

var config = {
    theatreNames: [
        "Brattle Theatre",
        "Coolidge Corner Theatre",
        "Regal Fenway Stadium 13",
        "Kendall Square Cinema",
        "Somerville Theatre",
        "Embassy Theatre",
        "AMC Assembly Row 12",
        "Majestic 7 Watertown",
        "Cinemark Superlux",
        "Jordan's IMAX Reading",
        "Jordan's IMAX Natick",
        "AMC Boston Common 19",
        "AMC South Bay Center 12",
        "Apple Cinemas",
        "Other"
    ],
    homeNames: [
        "Home",
        "Virginia",
        "Michigan",
        "Rochester",
        "Hopatcong",
        "Other"
    ]
};
config.views = [
    { name: "Theater", locations: config.theatreNames, defaultLocation: null },
    { name: "Apple TV", locations: config.homeNames, defaultLocation: "Home" },
    { name: "Download", locations: config.homeNames, defaultLocation: "Home" },
    { name: "Netflix", locations: config.homeNames, defaultLocation: "Home" },
    { name: "Disney+", locations: config.homeNames, defaultLocation: "Home" },
    { name: "Amazon Prime", locations: config.homeNames, defaultLocation: "Home" },
    { name: "Blu-ray", locations: config.homeNames, defaultLocation: "Home" },
    { name: "DVD", locations: config.homeNames, defaultLocation: "Home" },
    { name: "TV", locations: config.homeNames, defaultLocation: "Home" },
    { name: "IFFBoston", locations: config.homeNames, defaultLocation: "Home" },
    { name: "Other", locations: config.homeNames, defaultLocation: "Home" }
];

// State
var packageData = null;   // Loaded JSON
var selectedShorts = [];  // Shorts from chosen package

var updateViewLocations = function(viewItem) {
    $("#viewLocation").empty();
    for (var x = 0; x < viewItem.locations.length; x++) {
        $("<option></option>")
            .attr("value", viewItem.locations[x])
            .text(viewItem.locations[x])
            .appendTo("#viewLocation");
    }
};

$(document).ready(function() {
    // Dark mode
    var darkPref = localStorage.getItem('darkMode');
    if (darkPref === 'true') {
        $('body').addClass('dark-mode');
    } else if (darkPref === 'false') {
        $('body').removeClass('dark-mode');
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        $('body').addClass('dark-mode');
    }

    // Populate viewFormat dropdown
    for (var x = 0; x < config.views.length; x++) {
        $("<option></option>")
            .attr("value", config.views[x].name)
            .data("viewconfigindex", x)
            .text(config.views[x].name)
            .appendTo("#viewFormat");
    }

    // Default to IFFBoston format
    $("#viewFormat").val("IFFBoston").trigger("change");

    $("#viewFormat").change(function() {
        var index = $("#viewFormat")[0].selectedIndex;
        var dataIndex = $("#viewFormat").children().eq(index).data("viewconfigindex");
        updateViewLocations(config.views[dataIndex]);
    });

    // Phase 1: File load
    $("#packageFile").on("change", function(e) {
        var file = e.target.files[0];
        if (!file) return;

        var reader = new FileReader();
        reader.onload = function(evt) {
            try {
                packageData = JSON.parse(evt.target.result);
            } catch (err) {
                alert("Invalid JSON file");
                return;
            }

            if (!packageData.packages || !packageData.packages.length) {
                alert("No packages found in file");
                return;
            }

            // Populate package dropdown
            var $select = $("#packageSelect");
            $select.empty().append('<option value="">-- Choose a package --</option>');
            for (var i = 0; i < packageData.packages.length; i++) {
                var pkg = packageData.packages[i];
                $("<option></option>")
                    .attr("value", i)
                    .text(pkg.name + " (" + pkg.shorts.length + " shorts)")
                    .appendTo($select);
            }
            $("#packageSelectGroup").show();
        };
        reader.readAsText(file);
    });

    // Phase 1 -> Phase 2: Package selection
    $("#packageSelect").on("change", function() {
        var idx = $(this).val();
        if (idx === "") {
            $("#phase2").hide();
            $("#phase3").hide();
            return;
        }
        selectedShorts = packageData.packages[parseInt(idx)].shorts;
        $("#phase2").show();
        $("#phase3").hide();
        $("#shortsCards").empty();
        checkLookupReady();
    });

    // Phase 2: Enable lookup button when shared fields are filled
    $("#viewingDate, #viewFormat, #viewLocation, #movieGenre").on("change keyup", function() {
        checkLookupReady();
    });

    // Phase 2 -> Phase 3: TMDB lookups
    $("#lookupBtn").on("click", function() {
        runTmdbLookups();
    });

    // Phase 3: Submit all
    $("#submitAll").on("click", function() {
        submitBatch();
    });
});

function checkLookupReady() {
    var ready = (
        selectedShorts.length > 0 &&
        $("#viewingDate").val().length > 0 &&
        $("#viewFormat").val() !== "viewFormat" &&
        $("#viewLocation").val() !== "viewLocation" &&
        $("#movieGenre").val().length > 0
    );
    $("#lookupBtn").prop("disabled", !ready);
}
```

- [ ] **Step 2: Add the TMDB lookup logic**

Append to `client/add/js/shorts.js`:

```javascript
function runTmdbLookups() {
    $("#lookupBtn").prop("disabled", true);
    $("#phase3").show();
    $("#lookupProgress").show();
    $("#shortsCards").empty();
    $("#submitAll").prop("disabled", true);

    var total = selectedShorts.length;
    var completed = 0;
    var currentYear = new Date().getFullYear();
    var minReleaseDate = (currentYear - 2) + "-01-01";

    // Build card placeholders for each short
    for (var i = 0; i < selectedShorts.length; i++) {
        var s = selectedShorts[i];
        var cardHtml =
            '<div class="card mb-3" id="short-' + i + '">' +
            '  <div class="card-body">' +
            '    <div class="d-flex justify-content-between align-items-start">' +
            '      <div>' +
            '        <h5 class="card-title mb-1">' + escapeHtml(s.title) + '</h5>' +
            '        <small class="text-muted">Dir. ' + escapeHtml(s.director) + ' &middot; ' + s.runtime + ' min</small>' +
            '      </div>' +
            '      <span class="badge bg-secondary" id="badge-' + i + '">Pending</span>' +
            '    </div>' +
            '    <div class="mt-2">' +
            '      <label class="form-label">URL</label>' +
            '      <input type="text" class="form-control short-url" id="url-' + i + '" value="' + escapeAttr(s.url) + '">' +
            '    </div>' +
            '    <div class="mt-2">' +
            '      <label class="form-label">Review</label>' +
            '      <textarea class="form-control short-review" id="review-' + i + '" rows="2"></textarea>' +
            '    </div>' +
            '  </div>' +
            '</div>';
        $("#shortsCards").append(cardHtml);
    }

    // Sequential TMDB lookups with delay
    lookupNext(0, total, minReleaseDate);
}

function lookupNext(index, total, minReleaseDate) {
    if (index >= total) {
        $("#lookupProgress").hide();
        checkSubmitReady();
        return;
    }

    var pct = Math.round(((index + 1) / total) * 100);
    $("#progressBar").css("width", pct + "%");
    $("#progressText").text("Looking up " + (index + 1) + " of " + total + "...");

    var s = selectedShorts[index];
    var searchData = {
        json: JSON.stringify({
            title: s.title,
            min_release_date: minReleaseDate
        })
    };

    jQuery.post({ url: API_BASE_URL + "/searchMovie", data: searchData })
    .done(function(data) {
        if (data.Search && data.Search.length > 0) {
            // Pick best match: prefer exact title match, then first result
            var match = null;
            for (var j = 0; j < data.Search.length; j++) {
                if (data.Search[j].Title.toLowerCase() === s.title.toLowerCase()) {
                    match = data.Search[j];
                    break;
                }
            }
            if (!match) match = data.Search[0];

            // Get IMDB details
            var detailData = { json: JSON.stringify({ tmdbID: match.tmdbID }) };
            jQuery.post({ url: API_BASE_URL + "/getMovieDetails", data: detailData })
            .done(function(details) {
                if (details.imdbID && details.imdbID !== "N/A") {
                    $("#url-" + index).val("http://www.imdb.com/title/" + details.imdbID + "/");
                    $("#badge-" + index).removeClass("bg-secondary bg-warning").addClass("bg-success").text("TMDB");
                } else {
                    $("#badge-" + index).removeClass("bg-secondary").addClass("bg-warning text-dark").text("Manual");
                }
            })
            .fail(function() {
                $("#badge-" + index).removeClass("bg-secondary").addClass("bg-warning text-dark").text("Manual");
            })
            .always(function() {
                setTimeout(function() { lookupNext(index + 1, total, minReleaseDate); }, 300);
            });
        } else {
            $("#badge-" + index).removeClass("bg-secondary").addClass("bg-warning text-dark").text("Manual");
            setTimeout(function() { lookupNext(index + 1, total, minReleaseDate); }, 300);
        }
    })
    .fail(function() {
        $("#badge-" + index).removeClass("bg-secondary").addClass("bg-warning text-dark").text("Manual");
        setTimeout(function() { lookupNext(index + 1, total, minReleaseDate); }, 300);
    });
}
```

- [ ] **Step 3: Add submit logic and utility functions**

Append to `client/add/js/shorts.js`:

```javascript
function checkSubmitReady() {
    var ready = true;
    for (var i = 0; i < selectedShorts.length; i++) {
        var url = $("#url-" + i).val().trim();
        if (!url) {
            ready = false;
            break;
        }
    }
    $("#submitAll").prop("disabled", !ready);

    // Also re-check whenever URL fields change
    $(".short-url").off("keyup.submit").on("keyup.submit", function() {
        var allFilled = true;
        $(".short-url").each(function() {
            if (!$(this).val().trim()) allFilled = false;
        });
        $("#submitAll").prop("disabled", !allFilled);
    });
}

function submitBatch() {
    $("#submitAll").prop("disabled", true);
    $("#submitStatus").text("Submitting...");

    var entries = [];
    for (var i = 0; i < selectedShorts.length; i++) {
        entries.push({
            movieTitle: selectedShorts[i].title,
            viewingDate: $("#viewingDate").val(),
            movieURL: $("#url-" + i).val().trim(),
            viewFormat: $("#viewFormat").val(),
            viewLocation: $("#viewLocation").val(),
            movieGenre: $("#movieGenre").val(),
            movieReview: $("#review-" + i).val(),
            firstViewing: $("#firstViewing").is(":checked")
        });
    }

    jQuery.post({
        url: API_BASE_URL + "/newEntries",
        data: { json: JSON.stringify({ entries: entries }) }
    })
    .done(function(data) {
        if (data.error) {
            alert("Error: " + data.error);
            $("#submitAll").prop("disabled", false);
            $("#submitStatus").text("");
        } else {
            $("#submitStatus")
                .removeClass("text-danger")
                .addClass("text-success")
                .text("Success! " + data.data.count + " shorts added.");
            // Disable all inputs after success
            $("#phase3 input, #phase3 textarea, #submitAll").prop("disabled", true);
        }
    })
    .fail(function(xhr) {
        var msg = "Submission failed";
        if (xhr.responseJSON && xhr.responseJSON.error) {
            msg += ": " + JSON.stringify(xhr.responseJSON.error);
        }
        alert(msg);
        $("#submitAll").prop("disabled", false);
        $("#submitStatus").text("");
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/grahams/src/moviething
git add client/add/js/shorts.js
git commit -m "feat: add shorts batch-add JavaScript (load, lookup, submit)"
```

---

## Task 6: Manual integration test

**Files:** No file changes — this is a manual verification step.

- [ ] **Step 1: Generate test package data**

```bash
cd ~/src/iff-schedule-tool
python3 iffboston_schedule.py --export-packages packages.json --no-svg --no-markdown --no-pass
```

- [ ] **Step 2: Start moviething dev server**

```bash
cd /Users/grahams/src/moviething
npm run dev
```

- [ ] **Step 3: Open the shorts page in a browser**

Navigate to `http://localhost:3000/add/shorts.html` (or whatever port the dev server uses).

Verify:
- Page loads with dark/light theme matching the rest of the app
- File input is visible
- "Back to Charts" and "Single Add" nav links work

- [ ] **Step 4: Test the full flow**

1. Load `packages.json` using the file input
2. Verify the package dropdown populates with all shorts packages and short counts
3. Select a package (e.g., "Shorts Mass Ave: Documentary")
4. Verify Phase 2 appears with shared fields, viewFormat defaults to "IFFBoston"
5. Set a viewing date and location
6. Click "Look up shorts on TMDB"
7. Verify progress bar advances, cards appear with title/director/runtime
8. Verify some shorts get green "TMDB" badges (with IMDB URLs) and others get yellow "Manual" badges (with IFF URLs)
9. Fill in reviews for each short
10. For any "Manual" shorts, verify the IFF URL is pre-filled and editable
11. Click "Submit All"
12. Verify success message appears
13. Check the database to confirm entries were created

- [ ] **Step 5: Commit any fixes discovered during testing**

If any issues are found during manual testing, fix them and commit:

```bash
cd /Users/grahams/src/moviething
git add -A
git commit -m "fix: address issues found during shorts batch-add integration testing"
```
