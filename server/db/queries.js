'use strict';

const { query } = require('./index');

async function getRowsBetweenDates(startDate, endDate) {
  return query(
    'SELECT id, movieTitle, viewingDate, movieURL, viewFormat, viewLocation, firstViewing, movieGenre, movieReview ' +
    'FROM movies WHERE viewingDate BETWEEN ? AND ?',
    [startDate, endDate]
  );
}

async function checkExistingInfo(imdbID) {
  const rows = await query(
    'SELECT movieTitle, movieGenre, viewingDate, viewFormat, viewLocation, movieReview ' +
    'FROM movies WHERE movieURL LIKE ?',
    [`%${imdbID}%`]
  );

  return rows.map(row => ({
    firstViewing: false,
    movieTitle: row.movieTitle,
    movieGenre: row.movieGenre,
    viewingDate: row.viewingDate.toISOString().split('T')[0],
    viewFormat: row.viewFormat,
    viewLocation: row.viewLocation,
    movieReview: row.movieReview
  }));
}

module.exports = { getRowsBetweenDates, checkExistingInfo };
