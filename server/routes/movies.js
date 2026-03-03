'use strict';

const express = require('express');
const { getRowsBetweenDates } = require('../db/queries');
const { formatViewingDate } = require('../helpers/dates');

const router = express.Router();

router.get('/', async (req, res, next) => {
  let startDate, endDate;

  if (req.query.startDate && req.query.endDate) {
    startDate = req.query.startDate;
    endDate = req.query.endDate;
  } else {
    const year = req.query.year || new Date().getFullYear().toString();
    startDate = `${year}-01-01`;
    endDate = `${year}-12-31`;
  }

  try {
    const rows = await getRowsBetweenDates(startDate, endDate);
    const results = rows.map(row => ({
      id: Number(row.id),
      movieTitle: row.movieTitle,
      viewingDate: formatViewingDate(row.viewingDate),
      movieURL: row.movieURL,
      viewFormat: row.viewFormat,
      viewLocation: row.viewLocation,
      firstViewing: row.firstViewing,
      movieGenre: row.movieGenre,
      movieReview: row.movieReview
    }));
    res.json({ data: results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
