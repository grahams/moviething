const express = require('express');
const mariadb = require('mariadb');
const { parse: parseDate } = require('date-fns');
const fetch = require('node-fetch');
const { stringify } = require('csv-stringify');
const cors = require('cors');
require('dotenv').config({ override: true });

const app = express();

// Environment variables check
const requiredEnvVars = [
  'MOVIETHING_SQL_HOST',
  'MOVIETHING_SQL_USER',
  'MOVIETHING_SQL_PASS',
  'MOVIETHING_SQL_DB',
  'MOVIETHING_OMDB_API_KEY',
  'MOVIETHING_VALID_API_KEY'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Database connection pool - only create if not in test environment
const pool = process.env.NODE_ENV !== 'test' ? mariadb.createPool({
  host: process.env.MOVIETHING_SQL_HOST,
  user: process.env.MOVIETHING_SQL_USER,
  password: process.env.MOVIETHING_SQL_PASS,
  database: process.env.MOVIETHING_SQL_DB,
  connectionLimit: 5
}) : mariadb.createPool();  // In test environment, this will be mocked

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create API router
const apiRouter = express.Router();

// API Key middleware
const requireApiKey = (req, res, next) => {
  const apiKey = req.body.apiKey || req.query.apiKey;
  
  if (apiKey && apiKey === process.env.MOVIETHING_VALID_API_KEY) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Helper functions
async function getRowsBetweenDates(startDate, endDate) {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT movieTitle, viewingDate, movieURL, viewFormat, viewLocation, firstViewing, movieGenre, movieReview ' +
      'FROM movies WHERE viewingDate BETWEEN ? AND ?',
      [startDate, endDate]
    );
    return rows;
  } finally {
    if (conn) conn.release();
  }
}

async function checkExistingInfo(imdbID) {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
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
  } finally {
    if (conn) conn.release();
  }
}

// Routes
apiRouter.get('/', async (req, res) => {
  const year = req.query.year || new Date().getFullYear().toString();
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  
  try {
    const rows = await getRowsBetweenDates(startDate, endDate);
    const results = rows.map(row => ({
      movieTitle: row.movieTitle,
      viewingDate: row.viewingDate ? row.viewingDate.toISOString().split('T')[0] : null,
      movieURL: row.movieURL,
      viewFormat: row.viewFormat,
      viewLocation: row.viewLocation,
      firstViewing: row.firstViewing,
      movieGenre: row.movieGenre,
      movieReview: row.movieReview
    }));
    
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.post('/searchMovie', requireApiKey, async (req, res) => {
  try {
    const { title } = JSON.parse(req.body.json);
    const url = `https://private.omdbapi.com/?apiKey=${process.env.MOVIETHING_OMDB_API_KEY}&s=${encodeURIComponent(title)}&type=movie`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.post('/getMovieDetails', requireApiKey, async (req, res) => {
  try {
    const { imdbID } = JSON.parse(req.body.json);
    const url = `https://www.omdbapi.com/?apiKey=${process.env.MOVIETHING_OMDB_API_KEY}&i=${imdbID}`;
    const response = await fetch(url);
    const data = await response.json();
    
    const existing = await checkExistingInfo(imdbID);
    data.firstViewing = existing.length === 0;
    if (!data.firstViewing) {
      data.previousViewings = existing;
    }
    
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.post('/newEntry', requireApiKey, async (req, res) => {
  let conn;
  try {
    const {
      movieTitle,
      viewingDate,
      movieURL,
      viewFormat,
      viewLocation,
      movieGenre,
      movieReview,
      firstViewing
    } = JSON.parse(req.body.json);

    const parsedDate = parseDate(viewingDate, 'MM/dd/yyyy', new Date()).toISOString().split('T')[0];
    
    conn = await pool.getConnection();
    await conn.query(
      'INSERT INTO movies (movieTitle, viewingDate, movieURL, viewFormat, viewLocation, movieGenre, movieReview, firstViewing) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [movieTitle, parsedDate, movieURL, viewFormat, viewLocation, movieGenre, movieReview, firstViewing ? 1 : 0]
    );
    
    res.json({ OK: 'Success' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ Error: 'Param Error' });
  } finally {
    if (conn) conn.release();
  }
});

apiRouter.get('/exportLetterboxd', async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear().toString();
    const startDate = req.query.startDate || `${year}-01-01`;
    const endDate = req.query.endDate || `${year}-12-31`;
    
    const rows = await getRowsBetweenDates(startDate, endDate);
    
    const stringifier = stringify({
      header: true,
      columns: ['Title', 'imdbID', 'WatchedDate', 'Rewatch', 'Review']
    });

    const csvData = rows
      .map(row => {
        const imdbIDMatch = row.movieURL && row.movieURL.match(/tt\d{7,8}/);
        return {
          Title: row.movieTitle,
          imdbID: imdbIDMatch ? imdbIDMatch[0] : '',
          WatchedDate: row.viewingDate.toISOString().split('T')[0],
          Rewatch: row.firstViewing === 1 ? 'False' : 'True',
          Review: row.movieReview
        };
      });

    // Write each row individually to the stringifier
    csvData.forEach(row => {
      stringifier.write([row.Title, row.imdbID, row.WatchedDate, row.Rewatch, row.Review]);
    });
    stringifier.end();

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=letterboxd.csv');
    
    stringifier.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mount API routes under /api
app.use('/api', apiRouter);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('../client/build'));
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, '..', 'client', 'build', 'index.html'));
  });
}

// Export the app and createServer function
const createServer = () => {
  const port = process.env.PORT || 3000;
  return app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
};

// Export both the app, server creation function, and helper functions
module.exports = { 
  app, 
  createServer,
  getRowsBetweenDates,
  checkExistingInfo
};

// If this file is being run directly (not required as a module)
if (require.main === module) {
  createServer();
} 