// Use same-origin API base URL
const API_BASE_URL = window.location.origin + '/api';

// Helper to read a query parameter from the current URL
function getQueryParam(name) {
    var match = window.location.search.match(new RegExp('[?&]' + name + '=([^&]*)'));
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;
}

var theatreNames = [
    "Brattle Theatre",
    "Coolidge Corner Theatre",
    "Regal Fenway Stadium 13",
    "Kendall Square Cinema",
    "Somerville Theatre",
    "Embassy Theatre",
    "AMC Assembly Row 12",
    "Majestic 7 Watertown",
    "Cinemark Superlux",
    "Jordan's IMAX Reading",
    "Jordan's IMAX Natick",
    "AMC Boston Common 19",
    "AMC South Bay Center 12",
    "Apple Cinemas",
    "Other"
];


var homeNames = [
	"Home",
	"Virginia",
	"Michigan",
	"Rochester",
	"Hopatcong",
	"Other"
];

var viewConfig = [
    { 
        name: "Theater",
        locations: theatreNames,
        defaultLocation: null
    },
    {
	    name: "Apple TV",
        locations: homeNames,
        defaultLocation: "Home"
    },
    {
	    name: "Download",
        locations: homeNames,
        defaultLocation: "Home"
    },
    {
	    name: "Netflix",
        locations: homeNames,
        defaultLocation: "Home"
    },
    {
	    name: "Disney+",
        locations: homeNames,
        defaultLocation: "Home"
    },
    {
	    name: "Amazon Prime",
        locations: homeNames,
        defaultLocation: "Home"
    },
    {
	    name: "Blu-ray",
        locations: homeNames,
        defaultLocation: "Home"
    },
    {
	    name: "DVD",
        locations: homeNames,
        defaultLocation: "Home"
    },
    {
	    name: "TV",
        locations: homeNames,
        defaultLocation: "Home"
    },
    {
	    name: "IFFBoston",
        locations: homeNames,
        defaultLocation: "Home"
    },
    {
	    name: "Other",
        locations: homeNames,
        defaultLocation: "Home"
    }
];

$(document).ready(function() {
    // Clean up stale API key from localStorage (no longer used)
    localStorage.removeItem("moviesAPIKey");

    // Apply dark mode based on saved preference or system default
    var darkPref = localStorage.getItem('darkMode');
    if (darkPref === 'true') {
        $('body').addClass('dark-mode');
    } else if (darkPref === 'false') {
        $('body').removeClass('dark-mode');
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        $('body').addClass('dark-mode');
    }

    // Add keyup event for real-time search
    $("#searchName").on("keyup", function(e) {
        if ($(this).val().length >= 2) {
            searchMovie($(this).val().toTitleCase());
        } else {
            $("#searchResults").hide().empty();
        }
    });

    // Close dropdown when clicking outside
    $(document).on('click', function(e) {
        if (!$(e.target).closest('#searchName, #searchResults').length) {
            $("#searchResults").hide();
        }
    });

    // Remove any existing click handlers before adding new ones
    $(document).off('click', '#searchResults .dropdown-item');

    $("#lookupId").on("change", function(e) {
		var id = $("#lookupId").val();

        extractedId = id.match(/([0-9]+)/gm);
        if(extractedId) {
            id = extractedId[0];
        }
        else {
            alert("Invalid TheMovieDB ID");
            return;
        }

        getMovieDetails(id);
    })

    for(var x = 0; x < viewConfig.length; x += 1) {
        var item = viewConfig[x];

        $("<option></option")
            .attr("value", item.name)
            .data("viewconfigindex", x)
            .text(item.name)
            .appendTo("#viewFormat");
    }

    $("#viewFormat").change(function() {
        var index = $("#viewFormat")[0].selectedIndex;

        var dataIndex = $("#viewFormat").children().eq(index).data("viewconfigindex");

        updateViewLocations(viewConfig[dataIndex]);
    });

	$("#movieForm").change(function() {
        checkFormCompleted();
	});

	$("#movieReview").keyup(function() {
        checkFormCompleted();
	});

    var editId = getQueryParam('edit');

    if (editId) {
        // Hide the TMDB search section in edit mode
        $('#searchForm').hide();

        // Change submit button label
        $('#formSubmit').text('Save Changes');

        // Hide success message whenever the user changes the form
        $('#movieForm').on('change keyup', function() {
            $('#editSuccessMsg').hide();
        });

        // Override submit to PUT instead of POST (auth via Authentik header, no apiKey needed)
        $('#formSubmit').click(function() {
            var data = { json: assembleData() };
            $.ajax({
                url: `${API_BASE_URL}/entry/${editId}`,
                method: 'PUT',
                data: data
            })
            .done(function(result) {
                if (result.error) {
                    alert(result.error);
                } else {
                    $('#editSuccessMsg').show();
                }
            })
            .fail(function() {
                alert('Failed to save changes.');
            });
        });

        // Fetch entry data and pre-populate form (GET /api/entry/:id is public)
        $.get(`${API_BASE_URL}/entry/${editId}`)
        .done(function(entry) {
            // Show edit mode heading with movie title
            $('#editMovieTitle').text(entry.movieTitle);
            $('#editModeHeading').show();

            // Pre-populate form fields
            $('#movieTitle').val(entry.movieTitle);
            $('#movieURL').val(entry.movieURL);

            // Set date via datepicker — split YYYY-MM-DD to avoid UTC timezone shift
            var parts = entry.viewingDate.split('-');
            $('#viewingDate').datepicker('setDate', new Date(parts[0], parts[1] - 1, parts[2]));

            // Set format and trigger change to populate location dropdown
            $('#viewFormat').val(entry.viewFormat).trigger('change');
            // Set location after dropdown has been populated
            $('#viewLocation').val(entry.viewLocation);

            $('#firstViewing').prop('checked', entry.firstViewing === 1 || entry.firstViewing === true);
            $('#movieGenre').val(entry.movieGenre);
            $('#movieReview').val(entry.movieReview);

            checkFormCompleted();
        })
        .fail(function() {
            alert('Failed to load entry for editing.');
        });

    } else {
        // Normal add mode submit handler (auth via Authentik header)
        $('#formSubmit').click(function() {
            var data = {json: assembleData()};

            jQuery.post({
                url: `${API_BASE_URL}/newEntry`,
                data: data
            })
            .done(function(data) {
                if(data.Error) {
                    alert(data.Error);
                }
                else {
                    alert( "Success!" );
                }
            })
            .fail(function(data) {
                console.log( "error" );
            })
        });
    }
});

var updateViewLocations = function(viewItem) {
    $("#viewLocation").empty();

    for(var x = 0; x < viewItem.locations.length; x += 1) {
        var location = viewItem.locations[x];

        $("<option></option")
            .attr("value", location)
            .text(location)
            .appendTo("#viewLocation");
    }
};


var searchMovie = function(title) {
    var j = {
        "title": title,
        "exclude_videos": $("#excludeVideos").is(":checked"),
        "min_popularity": $("#minPopularity").val() ? parseFloat($("#minPopularity").val()) : undefined,
        "max_popularity": $("#maxPopularity").val() ? parseFloat($("#maxPopularity").val()) : undefined,
        "min_vote_count": $("#minVoteCount").val() ? parseInt($("#minVoteCount").val()) : undefined,
        "max_vote_count": $("#maxVoteCount").val() ? parseInt($("#maxVoteCount").val()) : undefined,
        "min_vote_average": $("#minVoteAverage").val() ? parseFloat($("#minVoteAverage").val()) : undefined,
        "max_vote_average": $("#maxVoteAverage").val() ? parseFloat($("#maxVoteAverage").val()) : undefined,
        "min_release_date": $("#minReleaseDate").val() || undefined,
        "max_release_date": $("#maxReleaseDate").val() || undefined
    };

    // Update filter indicator
    updateFilterIndicator(j);

    var data = {
        json: JSON.stringify(j)
    };

    jQuery.post({
        url: `${API_BASE_URL}/searchMovie`,
        data: data
    })
    .done(function(data) {
        // // Sort search results by year in descending order
        // if (data.Search && data.Search.length > 0) {
        //     data.Search.sort(function(a, b) {
        //         return parseInt(b.Year) - parseInt(a.Year);
        //     });
        // }

        var $results = $("#searchResults");
        $results.empty();
        
        if (data.Search && data.Search.length > 0) {
            data.Search.forEach(function(movie) {
                var $item = $('<a class="dropdown-item" href="#" data-tmdbid="' + movie.tmdbID + '">' + 
                  movie.Title + ' (' + movie.Year + ')</a>');
                
                $item.on('mousedown', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var tmdbId = $(this).data('tmdbid');
                    $results.hide();
                    getMovieDetails(tmdbId);
                    return false;
                });
                
                $results.append($item);
            });
            $results.show();
        } else {
            $results.hide();
        }
    })
    .fail(function(data) {
        console.log("error");
    })
};

var getMovieDetails = function(tmdbId) {
    var j = {"tmdbID": tmdbId};

    var data = {json: JSON.stringify(j)};

    jQuery.post({
        url: `${API_BASE_URL}/getMovieDetails`,
        data: data
    })
    .done(function(data) {
        $("#movieTitle").val(data.Title);
        $('#viewingDate').datepicker('setDate', new Date());
        $("#movieURL").val("http://www.imdb.com/title/" + data.imdbID + "/");

        if(data.previousGenre) {
            $("#movieGenre").val(data.previousGenre);
        }
        else {
            $("#movieGenre").val(data.Genre);
        }

        $("#firstViewing").prop('checked', data.firstViewing);

        // Clear and populate previous viewings if they exist
        $("#viewingsList").empty();
        if (data.previousViewings && data.previousViewings.length > 0) {
            // Sort viewings by date (ascending)
            data.previousViewings.sort(function(a, b) {
                return new Date(a.viewingDate) - new Date(b.viewingDate);
            });

            var template = {
                '<>': 'tr', 'html': [
                    {'<>': 'td', 'html': '${viewingDate}'},
                    {'<>': 'td', 'html': '${viewFormat}'},
                    {'<>': 'td', 'html': '${viewLocation}'},
                    {'<>': 'td', 'html': '${movieReview}'}
                ]
            };
            
            $("#viewingsList").html(json2html.transform(data.previousViewings, template));
            $("#viewingsMovieTitle").text(data.Title + " (" + data.previousViewings.length + " viewings)");
            $("#viewingsHeader, #viewingsTable").addClass('visible');
        } else {
            $("#viewingsHeader, #viewingsTable").removeClass('visible');
        }
    })
    .fail(function(data) {
        console.log("API Error:", data);
        console.log( "error" );
    })
};

var formCompleted = function() {
	var completed = (
		($("#movieTitle").val().length > 0) &&
		($("#viewingDate").val().length > 0) &&
		($("#movieURL").val().length > 0) &&
		($("#viewFormat").val() !== "viewFormat") &&
		($("#viewLocation").val() !== "viewLocation") &&
		($("#movieGenre").val().length > 0) &&
		($("#movieReview").val().length > 0) );
	return completed;
};

var checkFormCompleted = function() {
    if(formCompleted()) {
        $("#formSubmit").attr("disabled", null);
    }
    else {
        $("#formSubmit").attr("disabled", "disabled");
    }
};

var assembleData = function() {
	var data = {};

	data.movieTitle = $("#movieTitle").val();
	data.viewingDate = $("#viewingDate").val();
	data.movieURL = $("#movieURL").val();
	data.viewFormat = $("#viewFormat").val();
	data.viewLocation = $("#viewLocation").val();
	data.movieGenre = $("#movieGenre").val();
	data.movieReview = $("#movieReview").val();
	data.firstViewing = $("#firstViewing").is(":checked");

	return JSON.stringify(data);
};

// Function to update filter indicator
var updateFilterIndicator = function(filters) {
    var activeFilters = [];
    
    if (filters.exclude_videos) activeFilters.push('No Videos');
    if (filters.min_popularity !== undefined) activeFilters.push(`Pop≥${filters.min_popularity}`);
    if (filters.max_popularity !== undefined) activeFilters.push(`Pop≤${filters.max_popularity}`);
    if (filters.min_vote_count !== undefined) activeFilters.push(`Votes≥${filters.min_vote_count}`);
    if (filters.max_vote_count !== undefined) activeFilters.push(`Votes≤${filters.max_vote_count}`);
    if (filters.min_vote_average !== undefined) activeFilters.push(`Rating≥${filters.min_vote_average}`);
    if (filters.max_vote_average !== undefined) activeFilters.push(`Rating≤${filters.max_vote_average}`);
    if (filters.min_release_date) activeFilters.push(`From ${filters.min_release_date}`);
    if (filters.max_release_date) activeFilters.push(`To ${filters.max_release_date}`);
    
    var button = $('button[data-target="#advancedFilters"]');
    var isExpanded = button.html().includes('▲');
    var baseText = isExpanded ? 'Filters ▲' : 'Filters ▼';
    
    if (activeFilters.length > 0) {
        button.html(baseText + ' <span class="badge badge-primary ml-1">' + activeFilters.length + '</span>');
    } else {
        button.html(baseText);
    }
};

// Advanced Filters localStorage functions
var saveAdvancedFilters = function() {
    var filters = {
        excludeVideos: $('#excludeVideos').is(':checked'),
        minPopularity: $('#minPopularity').val(),
        maxPopularity: $('#maxPopularity').val(),
        minVoteCount: $('#minVoteCount').val(),
        maxVoteCount: $('#maxVoteCount').val(),
        minVoteAverage: $('#minVoteAverage').val(),
        maxVoteAverage: $('#maxVoteAverage').val(),
        minReleaseDate: $('#minReleaseDate').val(),
        maxReleaseDate: $('#maxReleaseDate').val()
    };
    localStorage.setItem('advancedFilters', JSON.stringify(filters));
};

var loadAdvancedFilters = function() {
    var savedFilters = localStorage.getItem('advancedFilters');
    if (savedFilters) {
        try {
            var filters = JSON.parse(savedFilters);
            $('#excludeVideos').prop('checked', filters.excludeVideos || false);
            $('#minPopularity').val(filters.minPopularity || '');
            $('#maxPopularity').val(filters.maxPopularity || '');
            $('#minVoteCount').val(filters.minVoteCount || '');
            $('#maxVoteCount').val(filters.maxVoteCount || '');
            $('#minVoteAverage').val(filters.minVoteAverage || '');
            $('#maxVoteAverage').val(filters.maxVoteAverage || '');
            $('#minReleaseDate').val(filters.minReleaseDate || '');
            $('#maxReleaseDate').val(filters.maxReleaseDate || '');
            
            // Update filter indicator after loading saved filters
            var searchTerm = $("#searchName").val().trim();
            if (searchTerm) {
                searchMovie(searchTerm);
            } else {
                // Just update the filter indicator without triggering search
                var filterData = {
                    exclude_videos: filters.excludeVideos || false,
                    min_popularity: filters.minPopularity ? parseFloat(filters.minPopularity) : undefined,
                    max_popularity: filters.maxPopularity ? parseFloat(filters.maxPopularity) : undefined,
                    min_vote_count: filters.minVoteCount ? parseInt(filters.minVoteCount) : undefined,
                    max_vote_count: filters.maxVoteCount ? parseInt(filters.maxVoteCount) : undefined,
                    min_vote_average: filters.minVoteAverage ? parseFloat(filters.minVoteAverage) : undefined,
                    max_vote_average: filters.maxVoteAverage ? parseFloat(filters.maxVoteAverage) : undefined,
                    min_release_date: filters.minReleaseDate || undefined,
                    max_release_date: filters.maxReleaseDate || undefined
                };
                updateFilterIndicator(filterData);
            }
        } catch (e) {
            console.log('Error loading saved filters:', e);
        }
    }
};

// Advanced Filters functionality
$(document).ready(function() {
    // Load saved filters on page load
    loadAdvancedFilters();
    
    // Handle collapsible toggle button text
    $('#advancedFilters').on('show.bs.collapse', function () {
        var button = $('button[data-target="#advancedFilters"]');
        var badge = button.find('.badge');
        var baseText = 'Filters ▲';
        if (badge.length > 0) {
            button.html(baseText + ' <span class="badge badge-primary ml-1">' + badge.text() + '</span>');
        } else {
            button.html(baseText);
        }
    });
    
    $('#advancedFilters').on('hide.bs.collapse', function () {
        var button = $('button[data-target="#advancedFilters"]');
        var badge = button.find('.badge');
        var baseText = 'Filters ▼';
        if (badge.length > 0) {
            button.html(baseText + ' <span class="badge badge-primary ml-1">' + badge.text() + '</span>');
        } else {
            button.html(baseText);
        }
    });
    
    // Clear all filters functionality
    $('#clearFilters').on('click', function() {
        $('#excludeVideos').prop('checked', false);
        $('#minPopularity').val('');
        $('#maxPopularity').val('');
        $('#minVoteCount').val('');
        $('#maxVoteCount').val('');
        $('#minVoteAverage').val('');
        $('#maxVoteAverage').val('');
        $('#minReleaseDate').val('');
        $('#maxReleaseDate').val('');
        
        // Clear saved filters from localStorage
        localStorage.removeItem('advancedFilters');
        
        // Trigger search after clearing if there's a search term
        var searchTerm = $("#searchName").val().trim();
        if (searchTerm) {
            searchMovie(searchTerm);
        }
    });
    
    // Auto-search when filter fields change
    var filterFields = [
        '#excludeVideos',
        '#minPopularity', 
        '#maxPopularity',
        '#minVoteCount',
        '#maxVoteCount', 
        '#minVoteAverage',
        '#maxVoteAverage',
        '#minReleaseDate',
        '#maxReleaseDate'
    ];
    
    filterFields.forEach(function(selector) {
        $(selector).on('change input', function() {
            // Save filters to localStorage whenever they change
            saveAdvancedFilters();
            
            var searchTerm = $("#searchName").val().trim();
            if (searchTerm) {
                // Small delay to avoid too many requests while typing
                clearTimeout(window.searchTimeout);
                window.searchTimeout = setTimeout(function() {
                    searchMovie(searchTerm);
                }, 300);
            }
        });
    });
});
