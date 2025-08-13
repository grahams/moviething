// Dynamic API base URL - detects environment automatically
const API_BASE_URL = (function() {
    var hostname = window.location.hostname;
    var port = window.location.port;
    
    // If we're on localhost, use the development server port
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'http://localhost:3002/api';
    }
    
    // For production, use the same hostname and port as the current page
    return window.location.protocol + '//' + hostname + (port ? ':' + port : '') + '/api';
})();

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
    var apiKey = localStorage.getItem("moviesAPIKey");

    if(apiKey) {
        $("#apiKey").val(apiKey);
    }

    $("#apiKey").on("change", function(e) {
        localStorage.setItem("moviesAPIKey", $("#apiKey").val());
    })


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

        id = id.replace(/(?:.|\n)*?(tt\d{8}|tt\d{7})(?:.|\n)*?.*/gm, "$1");

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

	$("#formSubmit").click(function() {
        var data = {apiKey: $("#apiKey").val(),
                    json: assembleData()};

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
    var j = {"title": title};

    var data = {apiKey: $("#apiKey").val(),
                json: JSON.stringify(j)};

    jQuery.post({
        url: `${API_BASE_URL}/searchMovie`,
        data: data
    })
    .done(function(data) {
        // Sort search results by year in descending order
        if (data.Search && data.Search.length > 0) {
            data.Search.sort(function(a, b) {
                return parseInt(b.Year) - parseInt(a.Year);
            });
        }

        var $results = $("#searchResults");
        $results.empty();
        
        if (data.Search && data.Search.length > 0) {
            data.Search.forEach(function(movie) {
                var $item = $('<a class="dropdown-item" href="#" data-imdbid="' + movie.imdbID + '">' + 
                  movie.Title + ' (' + movie.Year + ')</a>');
                
                $item.on('mousedown', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var imdbId = $(this).data('imdbid');
                    $results.hide();
                    getMovieDetails(imdbId);
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

var getMovieDetails = function(imdbId) {
    var j = {"imdbID": imdbId};

    var data = {apiKey: $("#apiKey").val(),
                json: JSON.stringify(j)};

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
