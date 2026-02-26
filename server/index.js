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
    'MOVIETHING_TMDB_API_KEY',
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

// Database connection pool
// In tests, mariadb.createPool is mocked to return a mock pool
const pool = mariadb.createPool({
  host: process.env.MOVIETHING_SQL_HOST,
  user: process.env.MOVIETHING_SQL_USER,
  password: process.env.MOVIETHING_SQL_PASS,
  database: process.env.MOVIETHING_SQL_DB,
  connectionLimit: 5,
  acquireTimeout: 60000, // 60 seconds
  timeout: 60000, // 60 seconds
  reconnect: true,
  resetAfterUse: true
});

// Test database connection with retry logic
async function testConnection(maxRetries = 10, delayMs = 5000) {
  if (process.env.NODE_ENV === 'test') {
    console.log('Skipping database connection test in test environment');
    return { success: true };
  }
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let conn;
    try {
      console.log(`Database connection attempt ${attempt}/${maxRetries}...`);
      conn = await pool.getConnection();
      await conn.query('SELECT 1 as test');
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
    } finally {
      if (conn) conn.release();
    }
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

// Auth middleware for write endpoints.
// Accepts either:
//   1. A non-empty X-Authentik-Username header — trusted because Authentik injects it at the
//      reverse-proxy layer. The Node server must not be directly internet-accessible for this
//      to be safe.
//   2. The correct MOVIETHING_VALID_API_KEY value in the request body or query string, for
//      external (non-UI) API clients such as scripts or curl.
const requireAuth = (req, res, next) => {
  const authentikUser = req.headers['x-authentik-username'];
  const apiKey = req.body.apiKey || req.query.apiKey;

  if ((authentikUser && authentikUser.trim() !== '') ||
      (apiKey && apiKey === process.env.MOVIETHING_VALID_API_KEY)) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Helper functions
async function getRowsBetweenDates(startDate, endDate) {
  if (!pool) {
    throw new Error('Database connection not available');
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
  } catch (err) {
    console.error('Database query failed:', err.message);
    throw new Error('Database connection failed');
  } finally {
    if (conn) conn.release();
  }
}

async function checkExistingInfo(imdbID) {
  if (!pool) {
    throw new Error('Database connection not available');
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
  } catch (err) {
    console.error('Database query failed:', err.message);
    throw new Error('Database connection failed');
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
  let startDate, endDate;
  
  // Support both year parameter (backward compatibility) and date range parameters
  if (req.query.startDate && req.query.endDate) {
    // Use explicit date range
    startDate = req.query.startDate;
    endDate = req.query.endDate;
  } else {
    // Use year parameter (backward compatibility)
    const year = req.query.year || new Date().getFullYear().toString();
    startDate = `${year}-01-01`;
    endDate = `${year}-12-31`;
  }
  
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

apiRouter.post('/searchMovie', async (req, res) => {
  try {
    const { 
      title, 
      exclude_videos, 
      min_popularity, 
      max_popularity, 
      min_vote_count, 
      max_vote_count, 
      min_vote_average, 
      max_vote_average, 
      min_release_date, 
      max_release_date 
    } = JSON.parse(req.body.json);
    
    let allResults = [];
    let page = 1;
    let totalResults = 0;
    let totalPages = 1;
    
    // Fetch all pages of results
    while (page <= 10 && page <= totalPages) { // Limit to 10 pages to prevent excessive API calls
      const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIETHING_TMDB_API_KEY}&query=${encodeURIComponent(title)}&page=${page}`;
      const response = await fetch(url);
      const pageData = await response.json();
      
      if (pageData.total_results === 0 || !pageData.results || pageData.results.length === 0) {
        // No more results
        break;
      }
      
      if (page === 1) {
        totalResults = pageData.total_results || 0;
        totalPages = pageData.total_pages || 1;
      }
      
      if (pageData.results && pageData.results.length > 0) {
        // Apply all filters
        let filteredResults = pageData.results;
        
        // Filter out videos if exclude_videos is true
        if (exclude_videos === true) {
          filteredResults = filteredResults.filter(movie => !movie.video);
        }
        
        // Filter by popularity
        if (min_popularity !== undefined && min_popularity !== null) {
          filteredResults = filteredResults.filter(movie => 
            movie.popularity !== undefined && movie.popularity >= min_popularity
          );
        }
        if (max_popularity !== undefined && max_popularity !== null) {
          filteredResults = filteredResults.filter(movie => 
            movie.popularity !== undefined && movie.popularity <= max_popularity
          );
        }
        
        // Filter by vote count
        if (min_vote_count !== undefined && min_vote_count !== null) {
          filteredResults = filteredResults.filter(movie => 
            movie.vote_count !== undefined && movie.vote_count >= min_vote_count
          );
        }
        if (max_vote_count !== undefined && max_vote_count !== null) {
          filteredResults = filteredResults.filter(movie => 
            movie.vote_count !== undefined && movie.vote_count <= max_vote_count
          );
        }
        
        // Filter by vote average
        if (min_vote_average !== undefined && min_vote_average !== null) {
          filteredResults = filteredResults.filter(movie => 
            movie.vote_average !== undefined && movie.vote_average >= min_vote_average
          );
        }
        if (max_vote_average !== undefined && max_vote_average !== null) {
          filteredResults = filteredResults.filter(movie => 
            movie.vote_average !== undefined && movie.vote_average <= max_vote_average
          );
        }
        
        // Filter by release date
        if (min_release_date !== undefined && min_release_date !== null) {
          filteredResults = filteredResults.filter(movie => 
            movie.release_date && movie.release_date >= min_release_date
          );
        }
        if (max_release_date !== undefined && max_release_date !== null) {
          filteredResults = filteredResults.filter(movie => 
            movie.release_date && movie.release_date <= max_release_date
          );
        }
        
        // Only process if we have results after filtering
        if (filteredResults.length > 0) {
          // Transform TMDB results to match OMDB format for backward compatibility
          const transformedResults = filteredResults.map(movie => ({
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
          }));
          allResults = allResults.concat(transformedResults);
        }
      }
      
      page++;
    }
    
    // Return combined results in the same format as the original API
    const combinedData = {
      Search: allResults,
      totalResults: allResults.length.toString(), // Use actual filtered results count
      Response: 'True'
    };
    
    res.json(combinedData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.post('/getMovieDetails', async (req, res) => {
  try {
    const { tmdbID } = JSON.parse(req.body.json);
    
    // Since we're now using TMDB IDs instead of IMDb IDs, we need to handle both cases
    // If the ID is numeric, it's likely a TMDB ID; if it starts with 'tt', it's an IMDb ID
    let movieId = tmdbID;
    
    if (!isNaN(tmdbID)) {
      // It's an IMDb ID, we need to find the TMDB movie by IMDb ID
      const findUrl = `https://api.themoviedb.org/3/movie/${tmdbID}?api_key=${process.env.MOVIETHING_TMDB_API_KEY}&language=en-US`;
      const findResponse = await fetch(findUrl);
      const findData = await findResponse.json();
      
      if (findData.id == tmdbID) {
        movieId = tmdbID;
      } else {
        return res.status(404).json({ error: 'Movie not found' });
      }
    }
    else {
      return res.status(404).json({ error: 'Invalid TMDB ID' });
    }
    
    // Get movie details from TMDB
    const url = `https://api.themoviedb.org/3/movie/${movieId}?api_key=${process.env.MOVIETHING_TMDB_API_KEY}&append_to_response=external_ids`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status_code) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    
    // Transform TMDB data to match OMDB format for backward compatibility
    const transformedData = {
      Title: data.title,
      Year: data.release_date ? data.release_date.split('-')[0] : 'N/A',
      Rated: 'N/A', // TMDB doesn't have MPAA ratings in the same format
      Released: data.release_date || 'N/A',
      Runtime: data.runtime ? `${data.runtime} min` : 'N/A',
      Genre: data.genres ? data.genres.map(g => g.name).join(', ') : 'N/A',
      Director: 'N/A', // Will be filled by credits endpoint if needed
      Writer: 'N/A', // Will be filled by credits endpoint if needed
      Actors: 'N/A', // Will be filled by credits endpoint if needed
      Plot: data.overview || 'N/A',
      Language: data.spoken_languages ? data.spoken_languages.map(l => l.name).join(', ') : 'N/A',
      Country: data.production_countries ? data.production_countries.map(c => c.name).join(', ') : 'N/A',
      Awards: 'N/A', // TMDB doesn't have awards in the same format
      Poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : 'N/A',
      Ratings: [], // TMDB doesn't have the same rating system
      Metascore: 'N/A', // TMDB doesn't have Metascore
      imdbRating: data.vote_average ? data.vote_average.toString() : 'N/A',
      imdbVotes: data.vote_count ? data.vote_count.toString() : 'N/A',
      imdbID: data.imdb_id,
      Type: 'movie',
      Response: 'True',
      // Additional TMDB-specific data
      tmdbID: data.id,
      backdrop_path: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : 'N/A',
      budget: data.budget,
      revenue: data.revenue,
      status: data.status,
      tagline: data.tagline,
      popularity: data.popularity
    };
    
    // Check existing viewings using the original ID (could be IMDb or TMDB)
    const existing = await checkExistingInfo(data.imdb_id);
    transformedData.firstViewing = existing.length === 0;
    if (!transformedData.firstViewing) {
      transformedData.previousViewings = existing;
    }
    
    res.json(transformedData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.post('/newEntry', requireAuth, async (req, res) => {
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
    
    if (!pool) {
      return res.status(503).json({ Error: 'Database connection not available' });
    }
    
    conn = await pool.getConnection();
    await conn.query(
      'INSERT INTO movies (movieTitle, viewingDate, movieURL, viewFormat, viewLocation, movieGenre, movieReview, firstViewing) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [movieTitle, parsedDate, movieURL, viewFormat, viewLocation, movieGenre, movieReview, firstViewing ? 1 : 0]
    );
    
    res.json({ OK: 'Success' });
  } catch (err) {
    console.error(err);
    if (err.message.includes('Database connection')) {
      res.status(503).json({ Error: 'Database connection failed' });
    } else {
      res.status(500).json({ Error: 'Param Error' });
    }
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
const createServer = async () => {
  const port = process.env.SERVER_PORT || 3000;
  
  try {
    console.log('Starting MovieThing server...');
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Database host:', process.env.MOVIETHING_SQL_HOST);
    
    // Test database connection before starting server
    const result = await testConnection();
    
    const server = app.listen(port, () => {
      console.log(`✅ Server running on port ${port}`);
      if (!result.success) {
        console.log('⚠️  Database connection failed at startup. Use /api/health to check status.');
      } else {
        console.log('✅ Database connection successful');
      }
    });

    // Graceful shutdown handling
    const gracefulShutdown = (signal) => {
      console.log(`\n${signal} received. Shutting down gracefully...`);
      server.close(() => {
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