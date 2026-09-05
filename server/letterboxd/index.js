'use strict';

const { loadConfig } = require('./config');
const { createClient } = require('./client');
const { createWorker } = require('./worker');
const { runOnce } = require('./queue');
const queries = require('./queries');

// Built once at require time. loadConfig throws on an enabled-but-invalid
// configuration; that must surface at startup rather than on the first sync,
// but this module is required at module scope (via routes/letterboxd.js),
// outside createServer's try/catch, so throwing here would be an uncaught
// stack trace that crashes the whole test suite for a half-configured .env.
let config;
let configError = null;
try {
  config = loadConfig();
} catch (err) {
  // Reported cleanly by createServer; throwing here would be an uncaught
  // stack trace at require time and would break the whole test suite.
  configError = err.message;
  config = { enabled: false };
}

const worker = createWorker({
  config,
  db: queries,
  client: config.enabled ? createClient(config) : null,
  runOnce
});

module.exports = { config, configError, worker };
