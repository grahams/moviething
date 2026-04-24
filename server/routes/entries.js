'use strict';

const express = require('express');
const { parse: parseDate } = require('date-fns');
const { pool, query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { newEntrySchema, updateEntrySchema, batchEntrySchema } = require('../validation/schemas');
const { formatViewingDate } = require('../helpers/dates');

const router = express.Router();

router.get('/entry/:id', async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM movies WHERE id = ?', [req.params.id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    const row = rows[0];
    res.json({
      data: {
        id: Number(row.id),
        movieTitle: row.movieTitle,
        viewingDate: formatViewingDate(row.viewingDate),
        movieURL: row.movieURL,
        viewFormat: row.viewFormat,
        viewLocation: row.viewLocation,
        firstViewing: row.firstViewing,
        movieGenre: row.movieGenre,
        movieReview: row.movieReview
      }
    });
  } catch (err) {
    next(err);
  }
});

router.post('/newEntry', requireAuth, validate(newEntrySchema), async (req, res, next) => {
  const { movieTitle, viewingDate, movieURL, viewFormat, viewLocation, movieGenre, movieReview, firstViewing } = req.validatedBody;
  const parsedDate = parseDate(viewingDate, 'MM/dd/yyyy', new Date()).toISOString().split('T')[0];

  try {
    await query(
      'INSERT INTO movies (movieTitle, viewingDate, movieURL, viewFormat, viewLocation, movieGenre, movieReview, firstViewing) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [movieTitle, parsedDate, movieURL, viewFormat, viewLocation, movieGenre, movieReview, firstViewing ? 1 : 0]
    );
    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

router.post('/newEntries', requireAuth, validate(batchEntrySchema), async (req, res, next) => {
  const { entries } = req.validatedBody;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    for (const entry of entries) {
      const parsedDate = parseDate(entry.viewingDate, 'MM/dd/yyyy', new Date()).toISOString().split('T')[0];
      await conn.query(
        'INSERT INTO movies (movieTitle, viewingDate, movieURL, viewFormat, viewLocation, movieGenre, movieReview, firstViewing) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [entry.movieTitle, parsedDate, entry.movieURL, entry.viewFormat, entry.viewLocation, entry.movieGenre, entry.movieReview, entry.firstViewing ? 1 : 0]
      );
    }

    await conn.commit();
    res.json({ data: { ok: true, count: entries.length } });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) { /* rollback failed — original error preserved */ }
    }
    next(err);
  } finally {
    if (conn) conn.release();
  }
});

router.put('/entry/:id', requireAuth, validate(updateEntrySchema), async (req, res, next) => {
  const { viewingDate, viewFormat, viewLocation, movieGenre, movieReview, firstViewing } = req.validatedBody;
  const parsedDate = parseDate(viewingDate, 'MM/dd/yyyy', new Date()).toISOString().split('T')[0];

  try {
    const existing = await query('SELECT id FROM movies WHERE id = ?', [req.params.id]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    await query(
      'UPDATE movies SET viewingDate = ?, viewFormat = ?, viewLocation = ?, movieGenre = ?, movieReview = ?, firstViewing = ? WHERE id = ?',
      [parsedDate, viewFormat, viewLocation, movieGenre, movieReview, firstViewing ? 1 : 0, req.params.id]
    );
    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
