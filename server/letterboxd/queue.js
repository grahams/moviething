'use strict';

const { AuthError, PermanentError } = require('./errors');
const { formatViewingDate } = require('../helpers/dates');

const MAX_ATTEMPTS = 5;

function imdbIdFrom(movieURL) {
  const match = movieURL && movieURL.match(/tt\d{7,8}/);
  return match ? match[0] : null;
}

/**
 * Drain up to `limit` pending entries to Letterboxd.
 *
 * `client` and `db` are injected so this runs against fakes in tests: the
 * retry policy is the part worth testing, and it must not need a network or
 * a database to exercise.
 */
async function runOnce({ client, db, limit, pauseThreshold }) {
  const pending = await db.getPendingCount();

  // Checked before selection: a bulk import must not get its first batch
  // through before the guard notices.
  if (pending > pauseThreshold) {
    return { pushed: 0, failed: 0, skipped: 0, paused: true, authFailed: false, pending };
  }

  const rows = await db.getEligibleRows(limit);
  let pushed = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const imdbId = imdbIdFrom(row.movieURL);

    // Not a failure: plenty of festival shorts have no IMDb entry at all, and
    // no retry could ever help. Recorded as skipped so the failure list stays
    // a meaningful signal.
    if (!imdbId) {
      await db.markSkipped(row.id, 'no imdb id');
      skipped++;
      continue;
    }

    try {
      const { uri } = await client.logEntry({
        imdbId,
        watchedDate: formatViewingDate(row.viewingDate),
        rewatch: row.firstViewing !== 1,
        review: row.movieReview || ''
      });
      await db.markSynced(row.id, uri);
      pushed++;
    } catch (err) {
      // Abandon the run entirely. Every remaining row would fail identically,
      // and burning their attempt counts would mass-fail the backlog over a
      // problem fixed by pasting one new cookie.
      if (err instanceof AuthError) {
        return { pushed, failed, skipped, paused: false, authFailed: true, pending };
      }

      if (err instanceof PermanentError) {
        await db.markFailed(row.id, err.message);
        failed++;
        continue;
      }

      // TransientError, plus anything unexpected: a bug in the client should
      // not take down the worker, so treat unknown errors as retryable.
      if (row.letterboxdAttempts + 1 >= MAX_ATTEMPTS) {
        await db.markFailed(row.id, err.message);
        failed++;
      } else {
        await db.recordAttempt(row.id, err.message);
      }
    }
  }

  return { pushed, failed, skipped, paused: false, authFailed: false, pending };
}

module.exports = { runOnce, imdbIdFrom, MAX_ATTEMPTS };
