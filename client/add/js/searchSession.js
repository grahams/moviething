// Coordinates the TMDB typeahead requests for the add form.
//
// Two problems show up when typing quickly, and both need solving:
//
//   1. Every keystroke used to fire its own request. /api/searchMovie walks up
//      to ten TMDB pages sequentially, so a burst of keystrokes queues a lot of
//      slow work and saturates the browser's per-host connection limit.
//
//   2. Responses were rendered in arrival order rather than issue order. A
//      short prefix matches more pages and therefore takes *longer* to come
//      back, so the results for "Go" reliably landed after the results for
//      "Godfather" and overwrote them. Debouncing alone only narrows that
//      window; it does not close it.
//
// So each request carries a sequence number and a response is rendered only
// while it is still the newest one. Anything superseded is dropped, and the
// request behind it is aborted so the server stops working on it.
var createSearchSession = function(options) {
    var delay = options.delay;
    var minLength = options.minLength;
    var search = options.search;
    var onResults = options.onResults;
    var onCleared = options.onCleared;
    var onError = options.onError;

    var timer = null;
    var inFlight = null;
    // Bumped whenever the user's intent changes. A response whose sequence no
    // longer matches belongs to a query the user has already moved past.
    var sequence = 0;

    // Cancels the pending search and disowns whatever is in flight, so nothing
    // issued before this point can render.
    var invalidate = function() {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }

        // Bump first: aborting rejects the request, and the guards in issue()
        // must already see it as superseded even if that rejection is delivered
        // synchronously.
        sequence += 1;

        if (inFlight && typeof inFlight.abort === 'function') {
            inFlight.abort();
        }
        inFlight = null;
    };

    var issue = function(term) {
        var seq = sequence;
        var request = search(term);
        inFlight = request;

        var settle = function() {
            // Only release the handle if it is still ours; a newer request may
            // already have claimed the slot.
            if (seq === sequence) {
                inFlight = null;
            }
        };

        request.then(function(data) {
            settle();
            if (seq !== sequence) {
                return;
            }
            onResults(data, term);
        }, function() {
            settle();
            // Aborted requests land here too, and those are never worth
            // reporting — they were superseded on purpose.
            if (seq !== sequence) {
                return;
            }
            if (onError) {
                onError();
            }
        });
    };

    return {
        // Call on every change to the search box.
        input: function(term) {
            invalidate();

            if (term.length < minLength) {
                onCleared();
                return;
            }

            timer = setTimeout(function() {
                timer = null;
                issue(term);
            }, delay);
        },

        // Call when the results are no longer wanted — the user clicked away or
        // picked a movie. Without this, a slow response would pop the dropdown
        // back open after it was dismissed.
        dismiss: function() {
            invalidate();
        }
    };
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createSearchSession: createSearchSession };
}
