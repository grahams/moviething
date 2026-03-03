# Moviething Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the monolithic `server/index.js` into clean modules, add a DB query helper, standardize API responses, add zod validation, then modernize the client (Bootstrap 5, no Moment.js, JS reorganization).

**Architecture:**
- Phase 1 (backend): Split `server/index.js` into `db/`, `routes/`, `middleware/`, `validation/`, and `helpers/` modules. All errors return `{ error }`, all mutation successes return `{ data: { ok: true } }`, and read endpoints return `{ data: <payload> }`. Phase 1 is a **breaking change** for the client — Phase 2 must follow promptly.
- Phase 2 (client): Fix client to consume new response shapes, upgrade Bootstrap 4→5, remove Moment.js, reorganize JS globals into state objects.

**Tech Stack:** Node.js, Express 4, MariaDB, zod (new), Jest/Supertest, jQuery, Bootstrap, Highcharts.

---

## Phase 1: Backend Refactor

### Task 1: Install zod

**Files:**
- Modify: `server/package.json`

**Step 1: Install the dependency**

```bash
cd server && npm install zod
```

**Step 2: Verify it's in package.json**

```bash
grep '"zod"' package.json
```
Expected: a line like `"zod": "^3.x.x"`

**Step 3: Commit**

```bash
cd server && git add package.json package-lock.json
git commit -m "feat: add zod for runtime validation"
```

---

### Task 2: Create the DB query helper

The same `pool.getConnection() / try-finally / conn.release()` pattern appears in every route handler. Replace it with a single `query()` function.

**Files:**
- Create: `server/db/index.js`
- Create: `server/__tests__/db.test.js`

**Step 1: Write the failing test**

Create `server/__tests__/db.test.js`:

```js
const { query } = require('../db');

describe('db.query()', () => {
  let mockConnection;

  beforeEach(() => {
    mockConnection = {
      query: jest.fn(),
      release: jest.fn(),
    };
    global.mockPool.getConnection.mockResolvedValue(mockConnection);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns rows on success', async () => {
    const mockRows = [{ id: 1 }];
    mockConnection.query.mockResolvedValueOnce(mockRows);
    const rows = await query('SELECT 1', []);
    expect(rows).toEqual(mockRows);
    expect(mockConnection.release).toHaveBeenCalled();
  });

  it('wraps DB errors with context and still releases the connection', async () => {
    mockConnection.query.mockRejectedValueOnce(new Error('disk failure'));
    await expect(query('SELECT 1', [])).rejects.toThrow('DB query failed: disk failure');
    expect(mockConnection.release).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /home/grahams/src/moviething && npm test -- --testPathPattern=db.test
```
Expected: FAIL — `Cannot find module '../db'`

**Step 3: Create `server/db/index.js`**

```js
'use strict';

const mariadb = require('mariadb');
require('dotenv').config({ override: true });

const pool = mariadb.createPool({
  host: process.env.MOVIETHING_SQL_HOST,
  user: process.env.MOVIETHING_SQL_USER,
  password: process.env.MOVIETHING_SQL_PASS,
  database: process.env.MOVIETHING_SQL_DB,
  connectionLimit: 5,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true,
  resetAfterUse: true
});

async function query(sql, params = []) {
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

async function testConnection(maxRetries = 10, delayMs = 5000) {
  if (process.env.NODE_ENV === 'test') {
    console.log('Skipping database connection test in test environment');
    return { success: true };
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Database connection attempt ${attempt}/${maxRetries}...`);
      await query('SELECT 1 as test');
      console.log('Successfully connected to MariaDB');
      return { success: true };
    } catch (err) {
      console.error(`Database connection attempt ${attempt} failed:`, err.message);
      if (attempt === maxRetries) {
        console.error('All database connection attempts failed. Server will start but database operations will fail until connection is restored');
        return { success: false, error: err.message };
      }
      console.log(`Waiting ${delayMs}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = { pool, query, testConnection };
```

**Step 4: Run test to verify it passes**

```bash
cd /home/grahams/src/moviething && npm test -- --testPathPattern=db.test
```
Expected: PASS

**Step 5: Commit**

```bash
git add server/db/index.js server/__tests__/db.test.js
git commit -m "feat: add db query helper with error wrapping"
```

---

### Task 3: Create shared DB query functions

`getRowsBetweenDates` and `checkExistingInfo` are used across multiple routes. Move them to `server/db/queries.js` and update `helpers.test.js`.

**Files:**
- Create: `server/db/queries.js`
- Modify: `server/__tests__/helpers.test.js`

**Step 1: Update `helpers.test.js` to import from the new location**

Replace the top of `server/__tests__/helpers.test.js`:

```js
const { getRowsBetweenDates, checkExistingInfo } = require('../db/queries');
const mariadb = require('mariadb');
```

**Step 2: Run tests to confirm they now fail with the right error**

```bash
cd /home/grahams/src/moviething && npm test -- --testPathPattern=helpers.test
```
Expected: FAIL — `Cannot find module '../db/queries'`

**Step 3: Create `server/db/queries.js`**

```js
'use strict';

const { query } = require('./index');

async function getRowsBetweenDates(startDate, endDate) {
  return query(
    'SELECT id, movieTitle, viewingDate, movieURL, viewFormat, viewLocation, firstViewing, movieGenre, movieReview ' +
    'FROM movies WHERE viewingDate BETWEEN ? AND ?',
    [startDate, endDate]
  );
}

async function checkExistingInfo(imdbID) {
  const rows = await query(
    'SELECT movieTitle, movieGenre, viewingDate, viewFormat, viewLocation, movieReview ' +
    'FROM movies WHERE movieURL LIKE ?',
    [`%${imdbID}%`]
  );

  return rows.map(row => ({
    firstViewing: false,
    movieTitle: row.movieTitle,
    movieGenre: row.movieGenre,
    viewingDate: row.viewingDate.toISOString().split('T')[0],
    viewFormat: row.viewFormat,
    viewLocation: row.viewLocation,
    movieReview: row.movieReview
  }));
}

module.exports = { getRowsBetweenDates, checkExistingInfo };
```

**Step 4: Run tests to verify they pass**

```bash
cd /home/grahams/src/moviething && npm test -- --testPathPattern=helpers.test
```
Expected: PASS

**Step 5: Commit**

```bash
git add server/db/queries.js server/__tests__/helpers.test.js
git commit -m "refactor: move shared DB query functions to db/queries.js"
```

---

### Task 4: Create date formatting helper

The expression `row.viewingDate.toISOString().split('T')[0]` appears 4+ times. Extract it.

**Files:**
- Create: `server/helpers/dates.js`

**Step 1: Create `server/helpers/dates.js`**

```js
'use strict';

function formatViewingDate(date) {
  if (!date) return null;
  return date.toISOString().split('T')[0];
}

module.exports = { formatViewingDate };
```

No separate test file — this is tested implicitly through the routes. Commit it now.

**Step 2: Commit**

```bash
git add server/helpers/dates.js
git commit -m "refactor: extract formatViewingDate helper"
```

---

### Task 5: Create auth middleware

**Files:**
- Create: `server/middleware/auth.js`
- Create: `server/__tests__/auth.test.js`

**Step 1: Write the failing test**

Create `server/__tests__/auth.test.js`:

```js
const { requireAuth } = require('../middleware/auth');

function makeReq(headers = {}) {
  return { headers };
}

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('requireAuth middleware', () => {
  const next = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MOVIETHING_VALID_API_KEY = 'test_api_key';
  });

  it('calls next() when X-Authentik-Username is present', () => {
    requireAuth(makeReq({ 'x-authentik-username': 'alice' }), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('calls next() when X-Api-Key matches the env var', () => {
    requireAuth(makeReq({ 'x-api-key': 'test_api_key' }), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when neither header is present', () => {
    const res = makeRes();
    requireAuth(makeReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when X-Authentik-Username is an empty string', () => {
    const res = makeRes();
    requireAuth(makeReq({ 'x-authentik-username': '   ' }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /home/grahams/src/moviething && npm test -- --testPathPattern=auth.test
```
Expected: FAIL — `Cannot find module '../middleware/auth'`

**Step 3: Create `server/middleware/auth.js`**

```js
'use strict';

function requireAuth(req, res, next) {
  const authentikUser = req.headers['x-authentik-username'];
  const apiKey = req.headers['x-api-key'];

  if ((authentikUser && authentikUser.trim() !== '') ||
      (apiKey && apiKey === process.env.MOVIETHING_VALID_API_KEY)) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { requireAuth };
```

**Step 4: Run test to verify it passes**

```bash
cd /home/grahams/src/moviething && npm test -- --testPathPattern=auth.test
```
Expected: PASS

**Step 5: Commit**

```bash
git add server/middleware/auth.js server/__tests__/auth.test.js
git commit -m "feat: extract auth middleware with tests"
```

---

### Task 6: Create validation middleware and schemas

**Files:**
- Create: `server/middleware/validate.js`
- Create: `server/validation/schemas.js`
- Create: `server/__tests__/validate.test.js`

**Step 1: Write the failing test**

Create `server/__tests__/validate.test.js`:

```js
const { validate } = require('../middleware/validate');
const { newEntrySchema } = require('../validation/schemas');

const validBody = {
  movieTitle: 'Test Movie',
  viewingDate: '01/01/2024',
  movieURL: 'https://www.imdb.com/title/tt1234567/',
  viewFormat: 'Digital',
  viewLocation: 'Home',
  movieGenre: 'Action',
  movieReview: 'Great movie!',
  firstViewing: true
};

function makeReq(body) {
  return { body: { json: JSON.stringify(body) } };
}

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('validate middleware', () => {
  const next = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it('calls next() when body is valid', () => {
    const middleware = validate(newEntrySchema);
    middleware(makeReq(validBody), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 400 when movieTitle is missing', () => {
    const middleware = validate(newEntrySchema);
    const body = { ...validBody };
    delete body.movieTitle;
    const res = makeRes();
    middleware(makeReq(body), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.anything() }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 when viewingDate format is wrong', () => {
    const middleware = validate(newEntrySchema);
    const res = makeRes();
    middleware(makeReq({ ...validBody, viewingDate: '2024-01-01' }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /home/grahams/src/moviething && npm test -- --testPathPattern=validate.test
```
Expected: FAIL — `Cannot find module '../middleware/validate'`

**Step 3: Create `server/validation/schemas.js`**

```js
'use strict';

const { z } = require('zod');

// viewingDate format from the datepicker: MM/dd/yyyy
const datePattern = /^\d{2}\/\d{2}\/\d{4}$/;

const newEntrySchema = z.object({
  movieTitle: z.string().min(1),
  viewingDate: z.string().regex(datePattern, 'viewingDate must be MM/DD/YYYY'),
  movieURL: z.string().url(),
  viewFormat: z.string().min(1),
  viewLocation: z.string().min(1),
  movieGenre: z.string().min(1),
  movieReview: z.string().default(''),
  firstViewing: z.boolean()
});

const updateEntrySchema = z.object({
  movieTitle: z.string().min(1),
  viewingDate: z.string().regex(datePattern, 'viewingDate must be MM/DD/YYYY'),
  viewFormat: z.string().min(1),
  viewLocation: z.string().min(1),
  movieGenre: z.string().min(1),
  movieReview: z.string().default(''),
  firstViewing: z.boolean()
});

module.exports = { newEntrySchema, updateEntrySchema };
```

**Step 4: Create `server/middleware/validate.js`**

```js
'use strict';

function validate(schema) {
  return (req, res, next) => {
    if (!req.body || !req.body.json) {
      return res.status(400).json({ error: 'Missing request body' });
    }
    let parsed;
    try {
      parsed = JSON.parse(req.body.json);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON in request body' });
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      return res.status(400).json({ error: result.error.flatten() });
    }
    req.validatedBody = result.data;
    next();
  };
}

module.exports = { validate };
```

**Step 5: Run test to verify it passes**

```bash
cd /home/grahams/src/moviething && npm test -- --testPathPattern=validate.test
```
Expected: PASS

**Step 6: Commit**

```bash
git add server/middleware/validate.js server/validation/schemas.js server/__tests__/validate.test.js
git commit -m "feat: add validate middleware and zod schemas for entry mutations"
```

---

### Task 7: Create error handler middleware

No test needed — behavior is verified through integration tests.

**Files:**
- Create: `server/middleware/errorHandler.js`

**Step 1: Create `server/middleware/errorHandler.js`**

```js
'use strict';

function errorHandler(err, req, res, next) {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
}

module.exports = { errorHandler };
```

**Step 2: Commit**

```bash
git add server/middleware/errorHandler.js
git commit -m "feat: add centralized error handler middleware"
```

---

### Task 8: Create route modules

Now move the actual route handlers out of `index.js`. Each route file uses the new `db.query()` helper and `formatViewingDate`. This is the big move.

**Files:**
- Create: `server/routes/movies.js`
- Create: `server/routes/entries.js`
- Create: `server/routes/search.js`
- Create: `server/routes/exports.js`
- Create: `server/routes/health.js`

**Step 1: Create `server/routes/movies.js`**

```js
'use strict';

const express = require('express');
const { getRowsBetweenDates } = require('../db/queries');
const { formatViewingDate } = require('../helpers/dates');

const router = express.Router();

router.get('/', async (req, res, next) => {
  let startDate, endDate;

  if (req.query.startDate && req.query.endDate) {
    startDate = req.query.startDate;
    endDate = req.query.endDate;
  } else {
    const year = req.query.year || new Date().getFullYear().toString();
    startDate = `${year}-01-01`;
    endDate = `${year}-12-31`;
  }

  try {
    const rows = await getRowsBetweenDates(startDate, endDate);
    const results = rows.map(row => ({
      id: Number(row.id),
      movieTitle: row.movieTitle,
      viewingDate: formatViewingDate(row.viewingDate),
      movieURL: row.movieURL,
      viewFormat: row.viewFormat,
      viewLocation: row.viewLocation,
      firstViewing: row.firstViewing,
      movieGenre: row.movieGenre,
      movieReview: row.movieReview
    }));
    res.json({ data: results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

**Step 2: Create `server/routes/entries.js`**

```js
'use strict';

const express = require('express');
const { parse: parseDate } = require('date-fns');
const { query } = require('../db');
const { checkExistingInfo } = require('../db/queries');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { newEntrySchema, updateEntrySchema } = require('../validation/schemas');
const { formatViewingDate } = require('../helpers/dates');

const router = express.Router();

router.get('/:id', async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM movies WHERE id = ?', [req.params.id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    const row = rows[0];
    res.json({
      data: {
        id: Number(row.id),
        movieTitle: row.movieTitle,
        viewingDate: formatViewingDate(row.viewingDate),
        movieURL: row.movieURL,
        viewFormat: row.viewFormat,
        viewLocation: row.viewLocation,
        firstViewing: row.firstViewing,
        movieGenre: row.movieGenre,
        movieReview: row.movieReview
      }
    });
  } catch (err) {
    next(err);
  }
});

router.post('/newEntry', requireAuth, validate(newEntrySchema), async (req, res, next) => {
  const { movieTitle, viewingDate, movieURL, viewFormat, viewLocation, movieGenre, movieReview, firstViewing } = req.validatedBody;
  const parsedDate = parseDate(viewingDate, 'MM/dd/yyyy', new Date()).toISOString().split('T')[0];

  try {
    await query(
      'INSERT INTO movies (movieTitle, viewingDate, movieURL, viewFormat, viewLocation, movieGenre, movieReview, firstViewing) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [movieTitle, parsedDate, movieURL, viewFormat, viewLocation, movieGenre, movieReview, firstViewing ? 1 : 0]
    );
    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireAuth, validate(updateEntrySchema), async (req, res, next) => {
  const { movieTitle, viewingDate, viewFormat, viewLocation, movieGenre, movieReview, firstViewing } = req.validatedBody;
  const parsedDate = parseDate(viewingDate, 'MM/dd/yyyy', new Date()).toISOString().split('T')[0];

  try {
    const existing = await query('SELECT id FROM movies WHERE id = ?', [req.params.id]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    await query(
      'UPDATE movies SET viewingDate = ?, viewFormat = ?, viewLocation = ?, movieGenre = ?, movieReview = ?, firstViewing = ? WHERE id = ?',
      [parsedDate, viewFormat, viewLocation, movieGenre, movieReview, firstViewing ? 1 : 0, req.params.id]
    );
    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

**Step 3: Create `server/routes/search.js`**

```js
'use strict';

const express = require('express');
const fetch = require('node-fetch');
const { checkExistingInfo } = require('../db/queries');

const router = express.Router();

router.post('/searchMovie', async (req, res, next) => {
  try {
    const {
      title, exclude_videos,
      min_popularity, max_popularity,
      min_vote_count, max_vote_count,
      min_vote_average, max_vote_average,
      min_release_date, max_release_date
    } = JSON.parse(req.body.json);

    let allResults = [];
    let page = 1;
    let totalPages = 1;

    while (page <= 10 && page <= totalPages) {
      const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIETHING_TMDB_API_KEY}&query=${encodeURIComponent(title)}&page=${page}`;
      const response = await fetch(url);
      const pageData = await response.json();

      if (!pageData.results || pageData.results.length === 0) break;

      if (page === 1) totalPages = pageData.total_pages || 1;

      let filtered = pageData.results;
      if (exclude_videos === true) filtered = filtered.filter(m => !m.video);
      if (min_popularity != null) filtered = filtered.filter(m => m.popularity >= min_popularity);
      if (max_popularity != null) filtered = filtered.filter(m => m.popularity <= max_popularity);
      if (min_vote_count != null) filtered = filtered.filter(m => m.vote_count >= min_vote_count);
      if (max_vote_count != null) filtered = filtered.filter(m => m.vote_count <= max_vote_count);
      if (min_vote_average != null) filtered = filtered.filter(m => m.vote_average >= min_vote_average);
      if (max_vote_average != null) filtered = filtered.filter(m => m.vote_average <= max_vote_average);
      if (min_release_date != null) filtered = filtered.filter(m => m.release_date && m.release_date >= min_release_date);
      if (max_release_date != null) filtered = filtered.filter(m => m.release_date && m.release_date <= max_release_date);

      allResults = allResults.concat(filtered.map(movie => ({
        Title: movie.title,
        Year: movie.release_date ? movie.release_date.split('-')[0] : 'N/A',
        Type: 'movie',
        Poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : 'N/A',
        tmdbID: movie.id,
        overview: movie.overview,
        release_date: movie.release_date,
        vote_average: movie.vote_average,
        vote_count: movie.vote_count,
        popularity: movie.popularity,
        video: movie.video
      })));

      page++;
    }

    // Keep legacy shape: client reads response.Search directly
    res.json({ Search: allResults, totalResults: allResults.length.toString(), Response: 'True' });
  } catch (err) {
    next(err);
  }
});

router.post('/getMovieDetails', async (req, res, next) => {
  try {
    const { tmdbID } = JSON.parse(req.body.json);

    if (isNaN(tmdbID)) {
      return res.status(404).json({ error: 'Invalid TMDB ID' });
    }

    const findUrl = `https://api.themoviedb.org/3/movie/${tmdbID}?api_key=${process.env.MOVIETHING_TMDB_API_KEY}&language=en-US`;
    const findResponse = await fetch(findUrl);
    const findData = await findResponse.json();
    if (findData.id != tmdbID) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    const url = `https://api.themoviedb.org/3/movie/${tmdbID}?api_key=${process.env.MOVIETHING_TMDB_API_KEY}&append_to_response=external_ids`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status_code) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    const transformedData = {
      Title: data.title,
      Year: data.release_date ? data.release_date.split('-')[0] : 'N/A',
      Rated: 'N/A',
      Released: data.release_date || 'N/A',
      Runtime: data.runtime ? `${data.runtime} min` : 'N/A',
      Genre: data.genres ? data.genres.map(g => g.name).join(', ') : 'N/A',
      Director: 'N/A',
      Writer: 'N/A',
      Actors: 'N/A',
      Plot: data.overview || 'N/A',
      Language: data.spoken_languages ? data.spoken_languages.map(l => l.name).join(', ') : 'N/A',
      Country: data.production_countries ? data.production_countries.map(c => c.name).join(', ') : 'N/A',
      Awards: 'N/A',
      Poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : 'N/A',
      Ratings: [],
      Metascore: 'N/A',
      imdbRating: data.vote_average ? data.vote_average.toString() : 'N/A',
      imdbVotes: data.vote_count ? data.vote_count.toString() : 'N/A',
      imdbID: data.imdb_id,
      Type: 'movie',
      Response: 'True',
      tmdbID: data.id,
      backdrop_path: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : 'N/A',
      budget: data.budget,
      revenue: data.revenue,
      status: data.status,
      tagline: data.tagline,
      popularity: data.popularity
    };

    const existing = await checkExistingInfo(data.imdb_id);
    transformedData.firstViewing = existing.length === 0;
    if (!transformedData.firstViewing) {
      transformedData.previousViewings = existing;
    }

    // Keep legacy shape: client reads response properties directly
    res.json(transformedData);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

**Step 4: Create `server/routes/exports.js`**

```js
'use strict';

const express = require('express');
const { stringify } = require('csv-stringify');
const RSS = require('rss');
const { getRowsBetweenDates } = require('../db/queries');
const { formatViewingDate } = require('../helpers/dates');

const router = express.Router();

router.get('/exportLetterboxd', async (req, res, next) => {
  try {
    const year = req.query.year || new Date().getFullYear().toString();
    const startDate = req.query.startDate || `${year}-01-01`;
    const endDate = req.query.endDate || `${year}-12-31`;
    const rows = await getRowsBetweenDates(startDate, endDate);

    const stringifier = stringify({
      header: true,
      columns: ['Title', 'imdbID', 'WatchedDate', 'Rewatch', 'Review']
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=letterboxd.csv');
    stringifier.pipe(res);

    rows.forEach(row => {
      const imdbIDMatch = row.movieURL && row.movieURL.match(/tt\d{7,8}/);
      stringifier.write([
        row.movieTitle,
        imdbIDMatch ? imdbIDMatch[0] : '',
        formatViewingDate(row.viewingDate),
        row.firstViewing === 1 ? 'False' : 'True',
        row.movieReview
      ]);
    });

    stringifier.end();
  } catch (err) {
    next(err);
  }
});

router.get('/rss', async (req, res, next) => {
  try {
    const year = req.query.year || new Date().getFullYear().toString();
    const rows = await getRowsBetweenDates(`${year}-01-01`, `${year}-12-31`);

    const feed = new RSS({
      title: process.env.MOVIETHING_RSS_TITLE,
      description: process.env.MOVIETHING_RSS_DESCRIPTION,
      feed_url: `${process.env.MOVIETHING_BASE_URL || 'http://localhost:3000'}/api/rss`,
      site_url: process.env.MOVIETHING_BASE_URL || 'http://localhost:3000',
      language: 'en',
      pubDate: new Date()
    });

    rows.forEach(movie => {
      const title = movie.movieGenre === 'Short' ? `Short: ${movie.movieTitle}` : movie.movieTitle;
      feed.item({
        title,
        description: movie.movieReview || 'No review available',
        url: movie.movieURL,
        date: new Date(movie.viewingDate),
        guid: movie.movieURL
      });
    });

    res.set('Content-Type', 'application/rss+xml');
    res.send(feed.xml());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

**Step 5: Create `server/routes/health.js`**

```js
'use strict';

const express = require('express');
const { query } = require('../db');

const router = express.Router();

router.get('/health', async (req, res) => {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    database: { status: 'unknown', message: '' }
  };

  if (process.env.NODE_ENV === 'test') {
    healthCheck.database.status = 'test_mode';
    healthCheck.database.message = 'Database check skipped in test environment';
    return res.json(healthCheck);
  }

  try {
    await query('SELECT 1 as test');
    healthCheck.database.status = 'connected';
    healthCheck.database.message = 'Database connection successful';
    res.json(healthCheck);
  } catch (err) {
    healthCheck.status = 'unhealthy';
    healthCheck.database.status = 'disconnected';
    healthCheck.database.message = err.message;
    res.status(503).json(healthCheck);
  }
});

module.exports = router;
```

**Step 6: Commit all routes**

```bash
git add server/routes/
git commit -m "feat: extract route handlers into individual route modules"
```

---

### Task 9: Rewrite server/index.js

Now slim `index.js` down to just app setup and route mounting.

**Files:**
- Modify: `server/index.js`

**Step 1: Replace `server/index.js`**

```js
'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ override: true });

const { testConnection } = require('./db');
const { errorHandler } = require('./middleware/errorHandler');
const moviesRouter = require('./routes/movies');
const entriesRouter = require('./routes/entries');
const searchRouter = require('./routes/search');
const exportsRouter = require('./routes/exports');
const healthRouter = require('./routes/health');

const app = express();

// Environment variable check — skipped in test environment
if (process.env.NODE_ENV !== 'test') {
  const required = [
    'MOVIETHING_SQL_HOST', 'MOVIETHING_SQL_USER', 'MOVIETHING_SQL_PASS', 'MOVIETHING_SQL_DB',
    'MOVIETHING_TMDB_API_KEY', 'MOVIETHING_VALID_API_KEY',
    'MOVIETHING_RSS_TITLE', 'MOVIETHING_RSS_DESCRIPTION'
  ];
  for (const v of required) {
    if (!process.env[v]) {
      console.error(`Missing environment variable: ${v}`);
      process.exit(1);
    }
  }
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const apiRouter = express.Router();
apiRouter.use('/', moviesRouter);
apiRouter.use('/', entriesRouter);
apiRouter.use('/', searchRouter);
apiRouter.use('/', exportsRouter);
apiRouter.use('/', healthRouter);

app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, '..', 'client')));
app.use(errorHandler);

const createServer = async () => {
  const port = process.env.SERVER_PORT || 3000;
  try {
    console.log('Starting MovieThing server...');
    const result = await testConnection();
    const server = app.listen(port, () => {
      console.log(`✅ Server running on port ${port}`);
      if (!result.success) {
        console.log('⚠️  Database connection failed at startup. Use /api/health to check status.');
      } else {
        console.log('✅ Database connection successful');
      }
    });

    const gracefulShutdown = (signal) => {
      console.log(`\n${signal} received. Shutting down gracefully...`);
      server.close(() => {
        const { pool } = require('./db');
        console.log('HTTP server closed.');
        pool.end(() => {
          console.log('Database pool closed.');
          process.exit(0);
        });
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return server;
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

module.exports = { app, createServer };

if (require.main === module) {
  createServer();
}
```

> **Note:** `getRowsBetweenDates` and `checkExistingInfo` are no longer exported from `index.js`. `helpers.test.js` already imports them from `db/queries.js` (updated in Task 3).

**Step 2: Run the full test suite**

```bash
cd /home/grahams/src/moviething && npm test
```
Expected: ALL PASS. If any fail, fix them before moving on.

**Step 3: Commit**

```bash
git add server/index.js
git commit -m "refactor: slim index.js to app setup and route mounting only"
```

---

### Task 10: Update existing endpoint tests for new response shapes

The existing `endpoints.test.js` checks old response shapes. Update them now.

**Files:**
- Modify: `server/__tests__/endpoints.test.js`

**Key changes:**
- `GET /api/` now returns `{ data: [...] }` — change `response.body` to `response.body.data`
- `GET /api/entry/:id` now returns `{ data: {...} }` — change `response.body` to `response.body.data`
- `POST /api/newEntry` success now returns `{ data: { ok: true } }` — update assertion
- `PUT /api/entry/:id` success now returns `{ data: { ok: true } }` — change from `{ OK: 'Updated' }`
- `PUT /api/entry/:id` with missing fields now caught by zod middleware (400) — request body now passes `validatedBody` not `req.body.json` parsing

**Step 1: Update assertions in `endpoints.test.js`**

Edit the following tests:

For `GET /api/`:
```js
// Before:
expect(response.body).toHaveLength(1);
expect(response.body[0].movieTitle).toBe('Test Movie');
expect(response.body[0].id).toBe(1);

// After:
expect(response.body.data).toHaveLength(1);
expect(response.body.data[0].movieTitle).toBe('Test Movie');
expect(response.body.data[0].id).toBe(1);
```

For `GET /api/entry/:id` (first test):
```js
// Before:
expect(response.body.id).toBe(42);
expect(response.body.movieTitle).toBe('Test Movie');
expect(response.body.viewingDate).toBe('2024-06-15');
expect(response.body.firstViewing).toBe(1);

// After:
expect(response.body.data.id).toBe(42);
expect(response.body.data.movieTitle).toBe('Test Movie');
expect(response.body.data.viewingDate).toBe('2024-06-15');
expect(response.body.data.firstViewing).toBe(1);
```

For `PUT /api/entry/:id` success tests:
```js
// Before:
expect(response.body).toEqual({ OK: 'Updated' });

// After:
expect(response.body).toEqual({ data: { ok: true } });
```

The `PUT` 400 test (missing `movieTitle`) previously relied on manual validation in the route. It's now handled by zod before the route runs. The test should still pass (400), but verify it does.

The `POST /newEntry` success tests — these currently only check the status code (200), not the response body. No change needed.

**Step 2: Run full test suite to verify all pass**

```bash
cd /home/grahams/src/moviething && npm test
```
Expected: ALL PASS

**Step 3: Commit**

```bash
git add server/__tests__/endpoints.test.js
git commit -m "test: update endpoint tests for new response shapes and module structure"
```

---

### Task 11: Phase 1 PR

At this point the full backend refactor is done. Open the PR.

**Step 1: Push the branch**

```bash
git push -u origin HEAD
```

**Step 2: Create the PR**

```bash
gh pr create --title "refactor: backend modularization + zod validation" \
  --body "$(cat <<'EOF'
## Summary

- Split 726-line `server/index.js` into `db/`, `routes/`, `middleware/`, `validation/`, and `helpers/` modules
- Added `db.query()` helper that eliminates repeated pool/connection boilerplate and wraps errors with context
- Extracted `requireAuth` middleware with tests
- Added zod validation for `POST /newEntry` and `PUT /api/entry/:id`
- Standardized mutation responses to `{ data: { ok: true } }` and read responses to `{ data: <payload> }`
- All error responses now use `{ error }` (lowercase, consistent)

⚠️ **Breaking change for the client** — Phase 2 must follow this PR to update client response parsing.

## Test plan
- [ ] `npm test` passes (all tests)
- [ ] `docker compose up` starts the server successfully
- [ ] Can add a new movie entry via the UI
- [ ] Can edit an existing entry via the UI
- [ ] `GET /api/health` returns 200
EOF
)"
```

---

## Phase 2: Client Cleanup

> **Prerequisites:** Phase 1 merged. Start Phase 2 from an up-to-date `main`.

### Task 12: Fix client to use new response shapes

The client `add/js/main.js` needs to handle the new `{ data }` / `{ error }` shapes from the backend.

**Files:**
- Modify: `client/add/js/main.js`
- Modify: `client/js/main.js`

**Changes in `client/add/js/main.js`:**

1. Edit success detection (line 243-249) — POST `/newEntry`:
```js
// Before:
.done(function(data) {
    if(data.Error) {
        alert(data.Error);
    }
    else {
        alert( "Success!" );
    }
})

// After:
.done(function(data) {
    if(data.error) {
        alert(data.error);
    }
    else {
        alert("Success!");
    }
})
```

2. Edit entry load (line 205) — GET `/entry/:id` now returns `{ data: {...} }`:
```js
// Before:
$.get(`${API_BASE_URL}/entry/${editId}`)
.done(function(entry) {
    // uses entry.movieTitle, entry.viewingDate, etc.

// After:
$.get(`${API_BASE_URL}/entry/${editId}`)
.done(function(response) {
    const entry = response.data;
    // uses entry.movieTitle, entry.viewingDate, etc. (same as before)
```

**Changes in `client/js/main.js`:**

`GET /api/` now returns `{ data: [...] }`. Update `fetchDataForDateRange` and `fetchAllDataInBackground`:

```js
// fetchDataForDateRange — before:
jQuery.getJSON(url, function(data) {
    data.sort(...)
    allMovieData = data;

// fetchDataForDateRange — after:
jQuery.getJSON(url, function(response) {
    var data = response.data;
    data.sort(...)
    allMovieData = data;
```

```js
// fetchAllDataInBackground — before:
jQuery.getJSON(url, function(data) {
    var merged = allMovieData.concat(data);

// fetchAllDataInBackground — after:
jQuery.getJSON(url, function(response) {
    var merged = allMovieData.concat(response.data);
```

**Step 1: Make all changes above**

**Step 2: Manually test in the browser**

- Load the dashboard: movies should appear
- Apply a date filter: chart should update
- Navigate to `/add`, search for a movie, submit: success alert should show
- Navigate to `/add?edit=<id>`: entry should populate, save should work

**Step 3: Commit**

```bash
git add client/js/main.js client/add/js/main.js
git commit -m "fix: update client response parsing for new { data } / { error } API shape"
```

---

### Task 13: Remove IE compatibility comments

**Files:**
- Modify: `client/index.html`
- Modify: `client/add/index.html`

**Step 1: Edit `client/index.html`**

Replace the first 6 lines:
```html
<!DOCTYPE html>
<!--[if lt IE 7]>      <html class="no-js lt-ie9 lt-ie8 lt-ie7"> <![endif]-->
<!--[if IE 7]>         <html class="no-js lt-ie9 lt-ie8"> <![endif]-->
<!--[if IE 8]>         <html class="no-js lt-ie9"> <![endif]-->
<!--[if gt IE 8]><!--> <html class="no-js"> <!--<![endif]-->
```

With:
```html
<!DOCTYPE html>
<html>
```

Also remove the `<!--[if lt IE 9]> ... <![endif]-->` block in the body (the "outdated browser" paragraph).

Remove the `<meta http-equiv="X-UA-Compatible" content="IE=edge">` line.

**Step 2: Edit `client/add/index.html`**

Remove the `<!--[if lte IE 9]> ... <![endif]-->` block in the body.

Remove `<meta http-equiv="x-ua-compatible" content="ie=edge">`.

**Step 3: Commit**

```bash
git add client/index.html client/add/index.html
git commit -m "chore: remove IE 7/8/9 compatibility comments"
```

---

### Task 14: Upgrade Bootstrap 4 → Bootstrap 5

Bootstrap 5 drops jQuery dependency for its own JS, renames several classes and data attributes.

**Reference:** https://getbootstrap.com/docs/5.3/migration/

**Files:**
- Modify: `client/index.html`
- Modify: `client/add/index.html`
- Modify: `client/add/js/main.js`

**Step 1: Update CDN URLs in `client/index.html`**

Change:
```html
<link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0/css/bootstrap.min.css">
```
To:
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
```

Add before closing `</body>`:
```html
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
```

**Step 2: Update `client/add/index.html`**

Replace all Bootstrap 4 script/link tags:
```html
<!-- Remove: -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/popper.js/1.12.9/umd/popper.min.js" ...></script>
<script src="https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0/js/bootstrap.min.js" ...></script>
<link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0/css/bootstrap.min.css" ...>

<!-- Add: -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
```

**Step 3: Fix Bootstrap 5 breaking changes in `client/add/index.html`**

| Bootstrap 4 | Bootstrap 5 |
|-------------|-------------|
| `data-toggle="collapse"` | `data-bs-toggle="collapse"` |
| `data-target="#advancedFilters"` | `data-bs-target="#advancedFilters"` |
| `custom-select` | `form-select` |
| `custom-control custom-checkbox` | `form-check` |
| `custom-control-input` | `form-check-input` |
| `custom-control-label` | `form-check-label` |
| `input-group-append` div | Remove — just put the button directly in `.input-group` |

Apply all these changes in `client/add/index.html`.

**Step 4: Fix Bootstrap 5 breaking changes in `client/index.html`**

| Bootstrap 4 | Bootstrap 5 |
|-------------|-------------|
| `mr-2` | `me-2` |
| `ml-2` | `ms-2` |
| `form-inline` | Remove class, use flex utilities directly |

**Step 5: Fix Bootstrap 5 breaking changes in `client/add/js/main.js`**

The `badge-primary` class is used in `updateFilterIndicator`:
```js
// Before:
button.html(baseText + ' <span class="badge badge-primary ml-1">' + ...);

// After:
button.html(baseText + ' <span class="badge bg-primary ms-1">' + ...);
```

Also update the collapse event handler selectors — Bootstrap 5 uses `data-bs-target`:
```js
// Before:
$('#advancedFilters').on('show.bs.collapse', function () {
    var button = $('button[data-target="#advancedFilters"]');

// After:
$('#advancedFilters').on('show.bs.collapse', function () {
    var button = $('button[data-bs-target="#advancedFilters"]');
```
(and same change in the `hide.bs.collapse` handler)

**Step 6: Keep Bootstrap Datepicker working**

Bootstrap Datepicker 1.7.1 is compatible with Bootstrap 5 — no change needed.

**Step 7: Manually test in browser**

- Dashboard loads with correct styles
- "Add New Movie" page loads correctly
- Filter panel ("Filters ▼") opens and closes
- Checkboxes and dropdowns render correctly
- Date picker works on the viewing date field

**Step 8: Commit**

```bash
git add client/index.html client/add/index.html client/add/js/main.js
git commit -m "feat: upgrade Bootstrap 4 to Bootstrap 5"
```

---

### Task 15: Remove Moment.js

Moment.js is used in `client/js/main.js` in exactly two places:

1. `moment(row.viewingDate).month()` — get 0-based month index from a date string
2. `moment().month(x).format("MMM")` — get abbreviated month name (e.g. "Jan")

**Files:**
- Modify: `client/index.html`
- Modify: `client/js/main.js`

**Step 1: Replace Moment.js usage in `client/js/main.js`**

Replace the `countMonth` function:
```js
// Before:
var countMonth = function(data, month) {
    var monthCount = 0;
    data.forEach(function(row){
        if(moment(row.viewingDate).month() === month) {
            monthCount += 1;
        }
    });
    return monthCount;
};

// After:
var countMonth = function(data, month) {
    var monthCount = 0;
    data.forEach(function(row) {
        if (row.viewingDate && new Date(row.viewingDate + 'T00:00:00').getMonth() === month) {
            monthCount += 1;
        }
    });
    return monthCount;
};
```

> Note: The `T00:00:00` suffix forces local-timezone parsing instead of UTC, matching the previous Moment.js behavior.

Replace month category labels in `prepareMonthData`:
```js
// Before:
monthCategories.push(moment().month(x).format("MMM"));

// After:
var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// (define this once at the top of prepareMonthData)
monthCategories.push(monthNames[x]);
```

**Step 2: Remove Moment.js script tag from `client/index.html`**

Remove:
```html
<script src="js/vendor/moment.min.js" charset="utf-8"></script>
```

**Step 3: Verify the `client/js/vendor/` directory**

The `moment.min.js` file can be left in place (it's just unused now). Deleting it is optional but clean:
```bash
rm client/js/vendor/moment.min.js
# If vendor/ is now empty:
rmdir client/js/vendor
```

**Step 4: Manually test in browser**

- Navigate to the dashboard
- The "Movies by Month" bar chart should render with correct month labels (Jan–Dec)
- Verify month counts are correct for a range spanning multiple months

**Step 5: Commit**

```bash
git add client/index.html client/js/main.js
git add -A client/js/vendor  # removes deleted files if any
git commit -m "refactor: remove Moment.js, use native Date and static month array"
```

---

### Task 16: Reorganize client/js/main.js globals into a state object

Six independent global variables make state hard to reason about. Group them.

**Files:**
- Modify: `client/js/main.js`

**Step 1: Replace the top-of-file globals**

```js
// Before:
var theatreChart = null;
var formatChart = null;
var firstChart = null;
var genreChart = null;
var monthChart = null;

var allMovieData = [];
var allDataLoaded = false;
var backgroundLoading = false;
var initialYear = null;

// After:
var charts = {
    theatre: null,
    format: null,
    firstViewing: null,
    genre: null,
    month: null
};

var state = {
    allMovieData: [],
    allDataLoaded: false,
    backgroundLoading: false,
    initialYear: null
};
```

**Step 2: Update all references throughout `client/js/main.js`**

- `theatreChart` → `charts.theatre`
- `formatChart` → `charts.format`
- `firstChart` → `charts.firstViewing`
- `genreChart` → `charts.genre`
- `monthChart` → `charts.month`
- `allMovieData` → `state.allMovieData`
- `allDataLoaded` → `state.allDataLoaded`
- `backgroundLoading` → `state.backgroundLoading`
- `initialYear` → `state.initialYear`

Do a careful search-and-replace for each. There are ~30 references total. Use the browser console after to verify nothing breaks.

**Step 3: Manually test in browser**

- All charts render
- Date filters work
- Background data loading works
- Dark mode toggle works

**Step 4: Commit**

```bash
git add client/js/main.js
git commit -m "refactor: consolidate globals into charts and state objects in main.js"
```

---

### Task 17: Reorganize client/add/js/main.js

The `viewConfig`, `theatreNames`, and `homeNames` arrays are standalone globals. Group them, and extract the two large anonymous click handlers into named functions.

**Files:**
- Modify: `client/add/js/main.js`

**Step 1: Group config into a named object**

```js
// Before:
var theatreNames = [...];
var homeNames = [...];
var viewConfig = [...];

// After:
var config = {
    theatreNames: [...],
    homeNames: [...],
    views: [...]  // the old viewConfig
};
```

Update all `viewConfig` references to `config.views`, `theatreNames` to `config.theatreNames`, `homeNames` to `config.homeNames`.

**Step 2: Extract the add-mode submit handler into a named function**

```js
// Before (inside document.ready):
$('#formSubmit').click(function() {
    var data = {json: assembleData()};
    jQuery.post({ ... })
    .done(function(data) { ... })
    ...
});

// After:
function handleAddSubmit() {
    var data = {json: assembleData()};
    jQuery.post({ url: `${API_BASE_URL}/newEntry`, data: data })
    .done(function(response) {
        if (response.error) {
            alert(response.error);
        } else {
            alert("Success!");
        }
    })
    .fail(function() {
        console.log("error");
    });
}

// Inside document.ready:
$('#formSubmit').click(handleAddSubmit);
```

**Step 3: Extract the edit-mode submit handler**

```js
function handleEditSubmit(editId) {
    var data = { json: assembleData() };
    $.ajax({ url: `${API_BASE_URL}/entry/${editId}`, method: 'PUT', data: data })
    .done(function(result) {
        if (result.error) {
            alert(result.error);
        } else {
            $('#editSuccessMsg').show();
        }
    })
    .fail(function() {
        alert('Failed to save changes.');
    });
}

// Inside document.ready edit block:
$('#formSubmit').click(function() { handleEditSubmit(editId); });
```

**Step 4: Extract the edit-mode load function**

```js
function loadEntryForEdit(editId) {
    $.get(`${API_BASE_URL}/entry/${editId}`)
    .done(function(response) {
        var entry = response.data;
        $('#editMovieTitle').text(entry.movieTitle);
        $('#editModeHeading').show();
        $('#movieTitle').val(entry.movieTitle);
        // ... rest of population
        checkFormCompleted();
    })
    .fail(function() {
        alert('Failed to load entry for editing.');
    });
}
```

**Step 5: Manually test**

- Add a new movie
- Edit an existing movie

**Step 6: Commit**

```bash
git add client/add/js/main.js
git commit -m "refactor: group config globals and extract named handlers in add/js/main.js"
```

---

### Task 18: Phase 2 PR

```bash
git push -u origin HEAD
gh pr create --title "refactor: client modernization — Bootstrap 5, no Moment.js, JS cleanup" \
  --body "$(cat <<'EOF'
## Summary

- Updated client to consume new `{ data }` / `{ error }` response shapes from Phase 1 backend changes
- Removed IE 7/8/9 compatibility comments from HTML
- Upgraded Bootstrap 4.0.0 → 5.3.3 (CDN, class renames, data attribute renames)
- Removed Moment.js; replaced with native `Date.getMonth()` and static month name array
- Consolidated 8 global variables in `client/js/main.js` into `charts` and `state` objects
- Extracted anonymous submit/load handlers in `client/add/js/main.js` into named functions

## Test plan
- [ ] Dashboard loads and displays movies
- [ ] Date range filter works and updates charts
- [ ] "Movies by Month" chart shows correct month labels
- [ ] Dark mode toggle works
- [ ] `/add` page: search for a movie, submit successfully
- [ ] `/add?edit=<id>`: entry loads, edits save
- [ ] No console errors on either page
EOF
)"
```

---

## Notes

**Phase 1 is a breaking change for the client.** Merge Phase 2 immediately after Phase 1. The window between them, the dashboard and add form will not work correctly (API responses will be in the new shape but client code will expect the old shape).

**Tests cover backend only.** There are no automated tests for client JS. Manual browser testing is the verification method for Phase 2.

**`normalize.css` is still included** alongside Bootstrap 5 (which includes its own reset). Removing it is safe but is out of scope for this refactor.
