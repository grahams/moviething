// Filters movie rows for the dashboard. When a title search is active the
// date range is ignored entirely, so search always spans all of history.
var filterMovies = function(data, opts) {
    var titleSearch = (opts.titleSearch || "").toLowerCase().trim();

    if (titleSearch) {
        return data.filter(function(row) {
            return !!row.movieTitle &&
                row.movieTitle.toLowerCase().indexOf(titleSearch) !== -1;
        });
    }

    return data.filter(function(row) {
        var d = row.viewingDate ? row.viewingDate.slice(0, 10) : null;
        return !!d && d >= opts.startDate && d <= opts.endDate;
    });
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { filterMovies: filterMovies };
}
