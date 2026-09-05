'use strict';

const { loadConfig } = require('./config');
const { createClient } = require('./client');
const { createWorker } = require('./worker');
const { runOnce } = require('./queue');
const queries = require('./queries');

// Built once at require time. loadConfig throws on an enabled-but-invalid
// configuration, which surfaces at startup rather than on the first sync.
const config = loadConfig();

const worker = createWorker({
  config,
  db: queries,
  client: config.enabled ? createClient(config) : null,
  runOnce
});

module.exports = { config, worker };
