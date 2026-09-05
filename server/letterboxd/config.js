'use strict';

// Parsed once at startup. Returns {enabled:false} rather than throwing when the
// feature is off, so that the vast majority of deployments need no new config
// at all and server/index.js's required-vars list stays untouched.
function loadConfig(env = process.env) {
  if (env.MOVIETHING_LETTERBOXD_ENABLED !== 'true') return { enabled: false };

  const cookie = env.MOVIETHING_LETTERBOXD_COOKIE;
  if (!cookie) {
    throw new Error(
      'MOVIETHING_LETTERBOXD_ENABLED is true but MOVIETHING_LETTERBOXD_COOKIE is not set'
    );
  }

  return {
    enabled: true,
    cookie,
    csrf: env.MOVIETHING_LETTERBOXD_CSRF || '',
    intervalSeconds: positiveInt(env, 'MOVIETHING_LETTERBOXD_INTERVAL', 300),
    batchLimit: positiveInt(env, 'MOVIETHING_LETTERBOXD_BATCH_LIMIT', 10),
    pauseThreshold: positiveInt(env, 'MOVIETHING_LETTERBOXD_PAUSE_THRESHOLD', 25)
  };
}

// A typo'd number must fail loudly at startup. Silently falling back to the
// default would leave the operator believing a setting had taken effect.
function positiveInt(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`);
  }
  return n;
}

module.exports = { loadConfig };
