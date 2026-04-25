// Use same-origin API base URL
const API_BASE_URL = window.location.origin + '/api';

// config is loaded from config.js (included via script tag before this file)

// State
var packageData = null;   // Loaded JSON
var selectedShorts = [];  // Shorts from chosen package

var updateViewLocations = function(viewItem) {
    $("#viewLocation").empty();
    for (var x = 0; x < viewItem.locations.length; x++) {
        $("<option></option>")
            .attr("value", viewItem.locations[x])
            .text(viewItem.locations[x])
            .appendTo("#viewLocation");
    }
};

$(document).ready(function() {
    // Dark mode
    var darkPref = localStorage.getItem('darkMode');
    if (darkPref === 'true') {
        $('body').addClass('dark-mode');
    } else if (darkPref === 'false') {
        $('body').removeClass('dark-mode');
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        $('body').addClass('dark-mode');
    }

    // Populate viewFormat dropdown
    for (var x = 0; x < config.views.length; x++) {
        $("<option></option>")
            .attr("value", config.views[x].name)
            .data("viewconfigindex", x)
            .text(config.views[x].name)
            .appendTo("#viewFormat");
    }

    // Default to IFFBoston format
    $("#viewFormat").val("IFFBoston").trigger("change");

    $("#viewFormat").change(function() {
        var index = $("#viewFormat")[0].selectedIndex;
        var dataIndex = $("#viewFormat").children().eq(index).data("viewconfigindex");
        updateViewLocations(config.views[dataIndex]);
    });

    // Phase 1: File load
    $("#packageFile").on("change", function(e) {
        var file = e.target.files[0];
        if (!file) return;

        var reader = new FileReader();
        reader.onload = function(evt) {
            try {
                packageData = JSON.parse(evt.target.result);
            } catch (err) {
                alert("Invalid JSON file");
                return;
            }

            if (!packageData.packages || !packageData.packages.length) {
                alert("No packages found in file");
                return;
            }

            // Populate package dropdown
            var $select = $("#packageSelect");
            $select.empty().append('<option value="">-- Choose a package --</option>');
            for (var i = 0; i < packageData.packages.length; i++) {
                var pkg = packageData.packages[i];
                $("<option></option>")
                    .attr("value", i)
                    .text(pkg.name + " (" + pkg.shorts.length + " shorts)")
                    .appendTo($select);
            }
            $("#packageSelectGroup").show();
        };
        reader.readAsText(file);
    });

    // Phase 1 -> Phase 2: Package selection
    $("#packageSelect").on("change", function() {
        var idx = $(this).val();
        if (idx === "") {
            $("#phase2").hide();
            $("#phase3").hide();
            return;
        }
        selectedShorts = packageData.packages[parseInt(idx)].shorts;
        $("#phase2").show();
        $("#phase3").hide();
        $("#shortsCards").empty();
        checkLookupReady();
    });

    // Phase 2: Enable lookup button when shared fields are filled
    $("#viewingDate, #viewFormat, #viewLocation, #movieGenre").on("change keyup", function() {
        checkLookupReady();
    });

    // Phase 2 -> Phase 3: TMDB lookups
    $("#lookupBtn").on("click", function() {
        runTmdbLookups();
    });

    // Phase 3: Submit all
    $("#submitAll").on("click", function() {
        submitBatch();
    });
});

function checkLookupReady() {
    var ready = (
        selectedShorts.length > 0 &&
        $("#viewingDate").val().length > 0 &&
        $("#viewFormat").val() !== "viewFormat" &&
        $("#viewLocation").val() !== "viewLocation" &&
        $("#movieGenre").val().length > 0
    );
    $("#lookupBtn").prop("disabled", !ready);
}

function runTmdbLookups() {
    $("#lookupBtn").prop("disabled", true);
    $("#phase3").show();
    $("#lookupProgress").show();
    $("#shortsCards").empty();
    $("#submitAll").prop("disabled", true);

    var total = selectedShorts.length;
    var currentYear = new Date().getFullYear();
    var minReleaseDate = (currentYear - 2) + "-01-01";

    // Build card placeholders for each short
    for (var i = 0; i < selectedShorts.length; i++) {
        var s = selectedShorts[i];
        var cardHtml =
            '<div class="card mb-3" id="short-' + i + '">' +
            '  <div class="card-body">' +
            '    <div class="d-flex justify-content-between align-items-start">' +
            '      <div>' +
            '        <h5 class="card-title mb-1">' + escapeHtml(s.title) + '</h5>' +
            '        <small class="text-muted">Dir. ' + escapeHtml(s.director) + ' &middot; ' + escapeHtml(String(s.runtime)) + ' min</small>' +
            '      </div>' +
            '      <span class="badge bg-secondary" id="badge-' + i + '">Pending</span>' +
            '    </div>' +
            '    <div class="mt-2">' +
            '      <label class="form-label">URL</label>' +
            '      <input type="text" class="form-control short-url" id="url-' + i + '" value="' + escapeAttr(s.url) + '">' +
            '    </div>' +
            '    <div class="mt-2">' +
            '      <label class="form-label">Review</label>' +
            '      <textarea class="form-control short-review" id="review-' + i + '" rows="2"></textarea>' +
            '    </div>' +
            '  </div>' +
            '</div>';
        $("#shortsCards").append(cardHtml);
    }

    // Sequential TMDB lookups with delay
    lookupNext(0, total, minReleaseDate);
}

function lookupNext(index, total, minReleaseDate) {
    if (index >= total) {
        $("#lookupProgress").hide();
        checkSubmitReady();
        return;
    }

    var pct = Math.round(((index + 1) / total) * 100);
    $("#progressBar").css("width", pct + "%");
    $("#progressText").text("Looking up " + (index + 1) + " of " + total + "...");

    var s = selectedShorts[index];
    var searchData = {
        json: JSON.stringify({
            title: s.title,
            min_release_date: minReleaseDate
        })
    };

    jQuery.post({ url: API_BASE_URL + "/searchMovie", data: searchData })
    .done(function(data) {
        if (data.Search && data.Search.length > 0) {
            // Pick best match: prefer exact title match, then first result
            var match = null;
            for (var j = 0; j < data.Search.length; j++) {
                if (data.Search[j].Title.toLowerCase() === s.title.toLowerCase()) {
                    match = data.Search[j];
                    break;
                }
            }
            if (!match) match = data.Search[0];

            // Get IMDB details
            var detailData = { json: JSON.stringify({ tmdbID: match.tmdbID }) };
            jQuery.post({ url: API_BASE_URL + "/getMovieDetails", data: detailData })
            .done(function(details) {
                if (details.imdbID && details.imdbID !== "N/A") {
                    $("#url-" + index).val("http://www.imdb.com/title/" + details.imdbID + "/");
                    $("#badge-" + index).removeClass("bg-secondary bg-warning").addClass("bg-success").text("TMDB");
                } else {
                    $("#badge-" + index).removeClass("bg-secondary").addClass("bg-warning text-dark").text("Manual");
                }
            })
            .fail(function() {
                $("#badge-" + index).removeClass("bg-secondary").addClass("bg-warning text-dark").text("Manual");
            })
            .always(function() {
                setTimeout(function() { lookupNext(index + 1, total, minReleaseDate); }, 300);
            });
        } else {
            $("#badge-" + index).removeClass("bg-secondary").addClass("bg-warning text-dark").text("Manual");
            setTimeout(function() { lookupNext(index + 1, total, minReleaseDate); }, 300);
        }
    })
    .fail(function() {
        $("#badge-" + index).removeClass("bg-secondary").addClass("bg-warning text-dark").text("Manual");
        setTimeout(function() { lookupNext(index + 1, total, minReleaseDate); }, 300);
    });
}

function checkSubmitReady() {
    var ready = true;
    for (var i = 0; i < selectedShorts.length; i++) {
        var url = $("#url-" + i).val().trim();
        if (!url) {
            ready = false;
            break;
        }
    }
    $("#submitAll").prop("disabled", !ready);

    // Also re-check whenever URL fields change
    $(".short-url").off("keyup.submit").on("keyup.submit", function() {
        var allFilled = true;
        $(".short-url").each(function() {
            if (!$(this).val().trim()) allFilled = false;
        });
        $("#submitAll").prop("disabled", !allFilled);
    });
}

function submitBatch() {
    $("#submitAll").prop("disabled", true);
    $("#submitStatus").text("Submitting...");

    var entries = [];
    for (var i = 0; i < selectedShorts.length; i++) {
        entries.push({
            movieTitle: selectedShorts[i].title,
            viewingDate: $("#viewingDate").val(),
            movieURL: $("#url-" + i).val().trim(),
            viewFormat: $("#viewFormat").val(),
            viewLocation: $("#viewLocation").val(),
            movieGenre: $("#movieGenre").val(),
            movieReview: $("#review-" + i).val(),
            firstViewing: $("#firstViewing").is(":checked")
        });
    }

    jQuery.post({
        url: API_BASE_URL + "/newEntries",
        data: { json: JSON.stringify({ entries: entries }) }
    })
    .done(function(data) {
        if (data.error) {
            alert("Error: " + data.error);
            $("#submitAll").prop("disabled", false);
            $("#submitStatus").text("");
        } else {
            $("#submitStatus")
                .removeClass("text-danger")
                .addClass("text-success")
                .text("Success! " + data.data.count + " shorts added.");
            // Disable all inputs after success
            $("#phase3 input, #phase3 textarea, #submitAll").prop("disabled", true);
        }
    })
    .fail(function(xhr) {
        var msg = "Submission failed";
        if (xhr.responseJSON && xhr.responseJSON.error) {
            msg += ": " + JSON.stringify(xhr.responseJSON.error);
        }
        alert(msg);
        $("#submitAll").prop("disabled", false);
        $("#submitStatus").text("");
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
