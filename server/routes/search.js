'use strict';

const express = require('express');
const fetch = require('node-fetch');
const { checkExistingInfo } = require('../db/queries');

const router = express.Router();

router.post('/searchMovie', async (req, res, next) => {
  try {
    const {
      title, exclude_videos,
      min_popularity, max_popularity,
      min_vote_count, max_vote_count,
      min_vote_average, max_vote_average,
      min_release_date, max_release_date
    } = JSON.parse(req.body.json);

    let allResults = [];
    let page = 1;
    let totalPages = 1;

    while (page <= 10 && page <= totalPages) {
      const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIETHING_TMDB_API_KEY}&query=${encodeURIComponent(title)}&page=${page}`;
      const response = await fetch(url);
      const pageData = await response.json();

      if (!pageData.results || pageData.results.length === 0) break;

      if (page === 1) totalPages = pageData.total_pages || 1;

      let filtered = pageData.results;
      if (exclude_videos === true) filtered = filtered.filter(m => !m.video);
      if (min_popularity != null) filtered = filtered.filter(m => m.popularity >= min_popularity);
      if (max_popularity != null) filtered = filtered.filter(m => m.popularity <= max_popularity);
      if (min_vote_count != null) filtered = filtered.filter(m => m.vote_count >= min_vote_count);
      if (max_vote_count != null) filtered = filtered.filter(m => m.vote_count <= max_vote_count);
      if (min_vote_average != null) filtered = filtered.filter(m => m.vote_average >= min_vote_average);
      if (max_vote_average != null) filtered = filtered.filter(m => m.vote_average <= max_vote_average);
      if (min_release_date != null) filtered = filtered.filter(m => m.release_date && m.release_date >= min_release_date);
      if (max_release_date != null) filtered = filtered.filter(m => m.release_date && m.release_date <= max_release_date);

      allResults = allResults.concat(filtered.map(movie => ({
        Title: movie.title,
        Year: movie.release_date ? movie.release_date.split('-')[0] : 'N/A',
        Type: 'movie',
        Poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : 'N/A',
        tmdbID: movie.id,
        overview: movie.overview,
        release_date: movie.release_date,
        vote_average: movie.vote_average,
        vote_count: movie.vote_count,
        popularity: movie.popularity,
        video: movie.video
      })));

      page++;
    }

    // Keep legacy response shape: client reads response.Search directly
    res.json({ Search: allResults, totalResults: allResults.length.toString(), Response: 'True' });
  } catch (err) {
    next(err);
  }
});

router.post('/getMovieDetails', async (req, res, next) => {
  try {
    const { tmdbID } = JSON.parse(req.body.json);

    if (isNaN(tmdbID)) {
      return res.status(404).json({ error: 'Invalid TMDB ID' });
    }

    const url = `https://api.themoviedb.org/3/movie/${tmdbID}?api_key=${process.env.MOVIETHING_TMDB_API_KEY}&append_to_response=external_ids`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status_code) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    const transformedData = {
      Title: data.title,
      Year: data.release_date ? data.release_date.split('-')[0] : 'N/A',
      Rated: 'N/A',
      Released: data.release_date || 'N/A',
      Runtime: data.runtime ? `${data.runtime} min` : 'N/A',
      Genre: data.genres ? data.genres.map(g => g.name).join(', ') : 'N/A',
      Director: 'N/A',
      Writer: 'N/A',
      Actors: 'N/A',
      Plot: data.overview || 'N/A',
      Language: data.spoken_languages ? data.spoken_languages.map(l => l.name).join(', ') : 'N/A',
      Country: data.production_countries ? data.production_countries.map(c => c.name).join(', ') : 'N/A',
      Awards: 'N/A',
      Poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : 'N/A',
      Ratings: [],
      Metascore: 'N/A',
      imdbRating: data.vote_average ? data.vote_average.toString() : 'N/A',
      imdbVotes: data.vote_count ? data.vote_count.toString() : 'N/A',
      imdbID: data.imdb_id,
      Type: 'movie',
      Response: 'True',
      tmdbID: data.id,
      backdrop_path: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : 'N/A',
      budget: data.budget,
      revenue: data.revenue,
      status: data.status,
      tagline: data.tagline,
      popularity: data.popularity
    };

    const existing = await checkExistingInfo(data.imdb_id);
    transformedData.firstViewing = existing.length === 0;
    if (!transformedData.firstViewing) {
      transformedData.previousViewings = existing;
    }

    // Keep legacy response shape: client reads response properties directly
    res.json(transformedData);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
