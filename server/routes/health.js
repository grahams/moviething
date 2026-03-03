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
