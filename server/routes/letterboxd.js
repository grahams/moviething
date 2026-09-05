'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { worker, config } = require('../letterboxd');
const queries = require('../letterboxd/queries');

const router = express.Router();

router.get('/letterboxd/status', requireAuth, async (req, res, next) => {
  try {
    const [counts, recentFailures] = await Promise.all([
      queries.getCounts(),
      queries.getRecentFailures(10)
    ]);
    res.json({ data: { ...worker.getState(), counts, recentFailures } });
  } catch (err) {
    next(err);
  }
});

router.post('/letterboxd/sync', requireAuth, async (req, res, next) => {
  try {
    if (!config.enabled) {
      return res.status(409).json({ error: 'Letterboxd sync is disabled (MOVIETHING_LETTERBOXD_ENABLED).' });
    }
    const confirm = req.query.confirm === 'true';
    const outcome = await worker.runNow({ confirm });

    // 'busy' is a real 409 (retry later); 'error' is a 500. Collapsing both to
    // one message would tell a user with a broken database to just try again.
    if (!outcome.ok) {
      if (outcome.reason === 'busy') {
        return res.status(409).json({ error: 'A sync run is already in progress.' });
      }
      return res.status(500).json({ error: outcome.error });
    }

    const result = outcome.result;
    if (result.paused) {
      return res.status(409).json({
        error: `${result.pending} entries pending, above the pause threshold. ` +
               'Re-send with ?confirm=true to push them all.'
      });
    }
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/letterboxd/retry', requireAuth, async (req, res, next) => {
  try {
    if (!config.enabled) {
      return res.status(409).json({ error: 'Letterboxd sync is disabled (MOVIETHING_LETTERBOXD_ENABLED).' });
    }
    const requeued = await queries.resetFailed();
    res.json({ data: { ok: true, requeued } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
