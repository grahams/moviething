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

    let uri;
    try {
      ({ uri } = await client.logEntry({
        imdbId,
        watchedDate: formatViewingDate(row.viewingDate),
        rewatch: row.firstViewing !== 1,
        review: row.movieReview || ''
      }));
    } catch (err) {
      if (err instanceof AuthError) {
        return { pushed, failed, skipped, paused: false, authFailed: true, pending };
      }
      try {
        if (err instanceof PermanentError || row.letterboxdAttempts + 1 >= MAX_ATTEMPTS) {
          await db.markFailed(row.id, err.message);
          failed++;
        } else {
          await db.recordAttempt(row.id, err.message);
        }
      } catch (dbErr) {
        // One row's bookkeeping failure must not abandon the rest of the
        // batch. The row stays pending and is retried next run.
        console.error(`letterboxd: could not record outcome for row ${row.id}: ${dbErr.message}`);
      }
      continue;
    }

    // The entry now EXISTS on Letterboxd. Whatever happens below, this row must
    // never be pushed again: a second push puts a duplicate in a public diary,
    // and Letterboxd cannot tell a duplicate from a genuine rewatch.
    try {
      await db.markSynced(row.id, uri);
      pushed++;
    } catch (err) {
      console.error(`letterboxd: posted row ${row.id} to ${uri} but could not record it: ${err.message}`);
      // 'skipped', not 'failed': POST /api/letterboxd/retry re-queues failed rows,
      // which would duplicate this entry. Skipped rows are never pushed again by
      // any path. The uri is preserved so the row can be reconciled by hand.
      try {
        await db.markSkipped(row.id, `posted to letterboxd (${uri}) but recording failed: ${err.message}`);
      } catch (dbErr) {
        console.error(`letterboxd: could not mark row ${row.id} skipped: ${dbErr.message}`);
      }
      // Counted as failed even though the row is 'skipped': the row status
      // protects against duplicates, this counter reports that the run had a
      // problem. They are answering different questions.
      failed++;
    }
  }

  return { pushed, failed, skipped, paused: false, authFailed: false, pending };
}

module.exports = { runOnce, imdbIdFrom, MAX_ATTEMPTS };
