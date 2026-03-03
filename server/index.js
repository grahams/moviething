'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ override: true });

const { testConnection, pool } = require('./db');
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
