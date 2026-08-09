'use strict';

const { filterMovies } = require('../js/filter');

const ROWS = [
    { movieTitle: 'Alien', viewingDate: '1979-06-02' },
    { movieTitle: 'Aliens', viewingDate: '1994-11-13' },
    { movieTitle: 'Alien Romulus', viewingDate: '2024-08-20' },
    { movieTitle: 'Barbie', viewingDate: '2026-03-01' }
];

const YEAR_2026 = { startDate: '2026-01-01', endDate: '2026-12-31' };

function titles(rows) {
    return rows.map(function (row) { return row.movieTitle; });
}

describe('filterMovies', () => {
    test('with an empty search, filters by date range only', () => {
        const result = filterMovies(ROWS, Object.assign({ titleSearch: '' }, YEAR_2026));
        expect(titles(result)).toEqual(['Barbie']);
    });

    test('with a search, returns matches outside the date range', () => {
        const result = filterMovies(ROWS, Object.assign({ titleSearch: 'alien' }, YEAR_2026));
        expect(titles(result)).toEqual(['Alien', 'Aliens', 'Alien Romulus']);
    });

    test('matches case-insensitively on substrings', () => {
        const result = filterMovies(ROWS, Object.assign({ titleSearch: 'ROMU' }, YEAR_2026));
        expect(titles(result)).toEqual(['Alien Romulus']);
    });

    test('trims surrounding whitespace from the search term', () => {
        const result = filterMovies(ROWS, Object.assign({ titleSearch: '  barbie  ' }, YEAR_2026));
        expect(titles(result)).toEqual(['Barbie']);
    });

    test('treats a whitespace-only search as no search', () => {
        const result = filterMovies(ROWS, Object.assign({ titleSearch: '   ' }, YEAR_2026));
        expect(titles(result)).toEqual(['Barbie']);
    });

    test('treats a missing titleSearch as no search', () => {
        const result = filterMovies(ROWS, Object.assign({}, YEAR_2026));
        expect(titles(result)).toEqual(['Barbie']);
    });

    test('skips rows with no title when searching', () => {
        const rows = ROWS.concat([{ movieTitle: null, viewingDate: '1999-01-01' }]);
        const result = filterMovies(rows, Object.assign({ titleSearch: 'alien' }, YEAR_2026));
        expect(titles(result)).toEqual(['Alien', 'Aliens', 'Alien Romulus']);
    });

    test('skips rows with no viewing date when date filtering', () => {
        const rows = ROWS.concat([{ movieTitle: 'Undated', viewingDate: null }]);
        const result = filterMovies(rows, Object.assign({ titleSearch: '' }, YEAR_2026));
        expect(titles(result)).toEqual(['Barbie']);
    });

    test('compares only the date portion of a longer viewingDate string', () => {
        const rows = [{ movieTitle: 'Timestamped', viewingDate: '2026-03-01T00:00:00.000Z' }];
        const result = filterMovies(rows, Object.assign({ titleSearch: '' }, YEAR_2026));
        expect(titles(result)).toEqual(['Timestamped']);
    });

    test('does not mutate the input array', () => {
        const rows = ROWS.slice();
        filterMovies(rows, Object.assign({ titleSearch: 'alien' }, YEAR_2026));
        expect(rows).toHaveLength(ROWS.length);
    });
});
