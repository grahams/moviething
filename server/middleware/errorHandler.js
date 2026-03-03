'use strict';

function errorHandler(err, req, res, next) {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
}

module.exports = { errorHandler };
