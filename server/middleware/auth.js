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
