'use strict';

const { query } = require('../db');

const ROW_FIELDS =
  'id, movieTitle, viewingDate, movieURL, firstViewing, movieReview, letterboxdAttempts';

async function getPendingCount() {
  const rows = await query(
    "SELECT COUNT(*) AS n FROM movies WHERE letterboxdStatus = 'pending'", []
  );
  return Number(rows[0].n);
}

// Eligible = pending, and either never attempted or past its backoff window.
// Backoff is 60 * 5^attempts seconds: 1m, 5m, 25m, ~2h, ~10h.
async function getEligibleRows(limit) {
  return query(
    `SELECT ${ROW_FIELDS} FROM movies ` +
    "WHERE letterboxdStatus = 'pending' " +
    'AND (letterboxdLastAttempt IS NULL OR letterboxdLastAttempt < ' +
    'DATE_SUB(NOW(), INTERVAL (60 * POW(5, letterboxdAttempts)) SECOND)) ' +
    'ORDER BY viewingDate ASC, id ASC LIMIT ?',
    [limit]
  );
}

async function markSynced(id, uri) {
  await query(
    "UPDATE movies SET letterboxdStatus = 'synced', letterboxdUri = ?, " +
    'letterboxdError = NULL, letterboxdLastAttempt = NOW() WHERE id = ?',
    [uri, id]
  );
}

async function markFailed(id, message) {
  await query(
    "UPDATE movies SET letterboxdStatus = 'failed', letterboxdError = ?, " +
    'letterboxdLastAttempt = NOW() WHERE id = ?',
    [truncate(message), id]
  );
}

async function markSkipped(id, message) {
  await query(
    "UPDATE movies SET letterboxdStatus = 'skipped', letterboxdError = ?, " +
    'letterboxdLastAttempt = NOW() WHERE id = ?',
    [truncate(message), id]
  );
}

// Leaves letterboxdStatus alone: the row stays 'pending' for a later retry.
async function recordAttempt(id, message) {
  await query(
    'UPDATE movies SET letterboxdAttempts = letterboxdAttempts + 1, ' +
    'letterboxdError = ?, letterboxdLastAttempt = NOW() WHERE id = ?',
    [truncate(message), id]
  );
}

async function getCounts() {
  const rows = await query(
    'SELECT letterboxdStatus, COUNT(*) AS n FROM movies GROUP BY letterboxdStatus', []
  );
  const counts = { pending: 0, synced: 0, failed: 0, skipped: 0 };
  rows.forEach(r => { counts[r.letterboxdStatus] = Number(r.n); });
  return counts;
}

async function getRecentFailures(limit) {
  return query(
    'SELECT id, movieTitle, letterboxdError, letterboxdAttempts, letterboxdLastAttempt ' +
    "FROM movies WHERE letterboxdStatus = 'failed' " +
    'ORDER BY letterboxdLastAttempt DESC LIMIT ?',
    [limit]
  );
}

async function resetFailed() {
  const result = await query(
    "UPDATE movies SET letterboxdStatus = 'pending', letterboxdAttempts = 0, " +
    "letterboxdError = NULL WHERE letterboxdStatus = 'failed'", []
  );
  return Number(result.affectedRows || 0);
}

// letterboxdError is VARCHAR(512); an over-long message would abort the UPDATE
// and lose the status change along with it.
function truncate(message) {
  return String(message == null ? '' : message).slice(0, 512);
}

module.exports = {
  getPendingCount, getEligibleRows, markSynced, markFailed, markSkipped,
  recordAttempt, getCounts, getRecentFailures, resetFailed
};
