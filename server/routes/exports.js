'use strict';

const express = require('express');
const { stringify } = require('csv-stringify');
const RSS = require('rss');
const { getRowsBetweenDates } = require('../db/queries');
const { formatViewingDate } = require('../helpers/dates');

const router = express.Router();

router.get('/exportLetterboxd', async (req, res, next) => {
  try {
    const year = req.query.year || new Date().getFullYear().toString();
    const startDate = req.query.startDate || `${year}-01-01`;
    const endDate = req.query.endDate || `${year}-12-31`;
    const rows = await getRowsBetweenDates(startDate, endDate);

    const stringifier = stringify({
      header: true,
      columns: ['Title', 'imdbID', 'WatchedDate', 'Rewatch', 'Review']
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=letterboxd.csv');
    stringifier.pipe(res);

    rows.forEach(row => {
      const imdbIDMatch = row.movieURL && row.movieURL.match(/tt\d{7,8}/);
      stringifier.write([
        row.movieTitle,
        imdbIDMatch ? imdbIDMatch[0] : '',
        formatViewingDate(row.viewingDate),
        row.firstViewing === 1 ? 'False' : 'True',
        row.movieReview
      ]);
    });

    stringifier.end();
  } catch (err) {
    next(err);
  }
});

router.get('/rss', async (req, res, next) => {
  try {
    const year = req.query.year || new Date().getFullYear().toString();
    const rows = await getRowsBetweenDates(`${year}-01-01`, `${year}-12-31`);

    const feed = new RSS({
      title: process.env.MOVIETHING_RSS_TITLE,
      description: process.env.MOVIETHING_RSS_DESCRIPTION,
      feed_url: `${process.env.MOVIETHING_BASE_URL || 'http://localhost:3000'}/api/rss`,
      site_url: process.env.MOVIETHING_BASE_URL || 'http://localhost:3000',
      language: 'en',
      pubDate: new Date()
    });

    rows.forEach(movie => {
      const title = movie.movieGenre === 'Short' ? `Short: ${movie.movieTitle}` : movie.movieTitle;
      feed.item({
        title,
        description: movie.movieReview || 'No review available',
        url: movie.movieURL,
        date: new Date(movie.viewingDate),
        guid: movie.movieURL
      });
    });

    res.set('Content-Type', 'application/rss+xml');
    res.send(feed.xml());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
