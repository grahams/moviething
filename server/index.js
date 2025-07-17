const express = require('express');
const mariadb = require('mariadb');
const { parse: parseDate } = require('date-fns');
const fetch = require('node-fetch');
const { stringify } = require('csv-stringify');
const cors = require('cors');
const RSS = require('rss');
require('dotenv').config({ override: true });
const path = require('path');

const app = express();

// Environment variables check - skip in test environment
if (process.env.NODE_ENV !== 'test') {
  const requiredEnvVars = [
    'MOVIETHING_SQL_HOST',
    'MOVIETHING_SQL_USER',
    'MOVIETHING_SQL_PASS',
    'MOVIETHING_SQL_DB',
    'MOVIETHING_OMDB_API_KEY',
    'MOVIETHING_VALID_API_KEY',
    'MOVIETHING_RSS_TITLE',
    'MOVIETHING_RSS_DESCRIPTION'
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`Missing environment variable: ${envVar}`);
      process.exit(1);
    }
  }
}

// Database connection pool - only create if not in test environment
const pool = process.env.NODE_ENV !== 'test' ? mariadb.createPool({
  host: process.env.MOVIETHING_SQL_HOST,
  user: process.env.MOVIETHING_SQL_USER,
  password: process.env.MOVIETHING_SQL_PASS,
  database: process.env.MOVIETHING_SQL_DB,
  connectionLimit: 5
}) : null;  // In test environment, this will be mocked

// Test database connection
async function testConnection() {
  if (process.env.NODE_ENV === 'test') {
    console.log('Skipping database connection test in test environment');
    return;
  }
  
  let conn;
  try {
    conn = await pool.getConnection();
    console.log('Successfully connected to MariaDB');
  } catch (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
  } finally {
    if (conn) conn.release();
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware for error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

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
  if (process.env.NODE_ENV === 'test') {
    return []; // Return empty array in test environment
  }
  
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
  if (process.env.NODE_ENV === 'test') {
    return []; // Return empty array in test environment
  }
  
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

// Helper function to generate RSS feed XML
function generateRSSFeed(movies) {
  const feed = new RSS({
    title: process.env.MOVIETHING_RSS_TITLE,
    description: process.env.MOVIETHING_RSS_DESCRIPTION,
    feed_url: `${process.env.MOVIETHING_BASE_URL || 'http://localhost:3000'}/api/rss`,
    site_url: process.env.MOVIETHING_BASE_URL || 'http://localhost:3000',
    language: 'en',
    pubDate: new Date(),
  });

  movies.forEach(movie => {
    const title = movie.movieGenre === "Short" ? "Short: " + movie.movieTitle : movie.movieTitle;
    
    feed.item({
      title: title,
      description: movie.movieReview || 'No review available',
      url: movie.movieURL,
      date: new Date(movie.viewingDate),
      guid: movie.movieURL,
    });
  });

  return feed.xml();
}

// Health check endpoint
apiRouter.get('/health', async (req, res) => {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    database: {
      status: 'unknown',
      message: ''
    }
  };

  // In test environment, skip database check
  if (process.env.NODE_ENV === 'test') {
    healthCheck.database.status = 'test_mode';
    healthCheck.database.message = 'Database check skipped in test environment';
    res.json(healthCheck);
    return;
  }

  // Test database connection
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('SELECT 1 as test');
    healthCheck.database.status = 'connected';
    healthCheck.database.message = 'Database connection successful';
  } catch (err) {
    healthCheck.status = 'unhealthy';
    healthCheck.database.status = 'disconnected';
    healthCheck.database.message = err.message;
    res.status(503).json(healthCheck);
    return;
  } finally {
    if (conn) conn.release();
  }

  res.json(healthCheck);
});

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

// Add RSS feed route
apiRouter.get('/rss', async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear().toString();
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    
    const rows = await getRowsBetweenDates(startDate, endDate);
    const rssFeed = generateRSSFeed(rows);
    
    res.set('Content-Type', 'application/rss+xml');
    res.send(rssFeed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mount API routes under /api
app.use('/api', apiRouter);

// Serve static files from client/moviecharts directory
app.use(express.static(path.join(__dirname, '..', 'client')));


// Export the app and createServer function
const createServer = () => {
  const port = process.env.SERVER_PORT || 3000;
  
  // Test database connection before starting server
  testConnection().then(() => {
    return app.listen(port, () => {
      console.log(`Server running on port ${port}`);
      console.log('Environment:', process.env.NODE_ENV);
      console.log('Database host:', process.env.MOVIETHING_SQL_HOST);
    });
  }).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
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