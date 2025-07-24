var theatreChart = null;
var formatChart = null;
var firstChart = null;
var genreChart = null;
var monthChart = null;

var allMovieData = [];
var allDataLoaded = false; // Track if all data is loaded
var backgroundLoading = false; // Track if background loading is in progress
var initialYear = null;

// Helper to get query parameter from URL
function getQueryParam(name) {
    var match = window.location.search.match(new RegExp('[?&]' + name + '=([^&]*)'));
    return match && decodeURIComponent(match[1].replace(/\+/g, ' '));
}

// Dynamic API base URL - detects environment automatically
var API_BASE_URL = (function() {
    var hostname = window.location.hostname;
    var port = window.location.port;
    
    // If we're on localhost, use the development server port
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'http://localhost:3002';
    }
    
    // For production, use the same hostname and port as the current page
    //return window.location.protocol + '//' + hostname + (port ? ':' + port : '');
    return 'https://movies.grahams.wtf/';
})();

// Highcharts dark mode theme
var highchartsDarkTheme = {
    chart: {
        backgroundColor: 'transparent',
        style: {
            color: '#fff'
        }
    },
    title: {
        style: {
            color: '#fff',
            fontWeight: 'bold'
        }
    },
    subtitle: {
        style: {
            color: '#fff'
        }
    },
    xAxis: {
        labels: {
            style: {
                color: '#fff'
            }
        },
        title: {
            style: {
                color: '#fff'
            }
        },
        gridLineColor: '#444'
    },
    yAxis: {
        labels: {
            style: {
                color: '#fff'
            }
        },
        title: {
            style: {
                color: '#fff'
            }
        },
        gridLineColor: '#444'
    },
    legend: {
        itemStyle: {
            color: '#fff'
        },
        itemHoverStyle: {
            color: '#ddd'
        }
    },
    tooltip: {
        backgroundColor: '#222',
        style: {
            color: '#fff'
        }
    },
    credits: {
        style: {
            color: '#666'
        }
    },
    plotOptions: {
        series: {
            dataLabels: {
                color: '#fff'
            }
        }
    },
    navigation: {
        buttonOptions: {
            symbolStroke: '#fff',
            theme: {
                fill: '#222',
                stroke: '#444',
                style: {
                    color: '#fff'
                },
                states: {
                    hover: {
                        fill: '#333',
                        style: { color: '#fff' }
                    },
                    select: {
                        fill: '#111',
                        style: { color: '#fff' }
                    }
                }
            }
        }
    },
    exporting: {
        menuItemHoverStyle: {
            background: '#333',
            color: '#fff'
        },
        menuItemStyle: {
            background: '#222',
            color: '#fff'
        },
        menuStyle: {
            background: '#222',
            color: '#fff',
            border: '1px solid #444'
        }
    }
};

var highchartsLightTheme = {
    chart: {
        backgroundColor: null,
        style: {
            color: '#333'
        }
    },
    title: {
        style: {
            color: '#333',
            fontWeight: 'bold'
        }
    },
    subtitle: {
        style: {
            color: '#333'
        }
    },
    xAxis: {
        labels: {
            style: {
                color: '#333'
            }
        },
        title: {
            style: {
                color: '#333'
            }
        },
        gridLineColor: '#eee'
    },
    yAxis: {
        labels: {
            style: {
                color: '#333'
            }
        },
        title: {
            style: {
                color: '#333'
            }
        },
        gridLineColor: '#eee'
    },
    legend: {
        itemStyle: {
            color: '#333'
        },
        itemHoverStyle: {
            color: '#000'
        }
    },
    tooltip: {
        backgroundColor: '#fff',
        style: {
            color: '#333'
        }
    },
    credits: {
        style: {
            color: '#999'
        }
    },
    plotOptions: {
        series: {
            dataLabels: {
                color: '#333'
            }
        }
    },
    navigation: {
        buttonOptions: {
            symbolStroke: '#333',
            theme: {
                fill: '#fff',
                stroke: '#ccc',
                style: {
                    color: '#333'
                },
                states: {
                    hover: {
                        fill: '#eee',
                        style: { color: '#333' }
                    },
                    select: {
                        fill: '#ddd',
                        style: { color: '#333' }
                    }
                }
            }
        }
    },
    exporting: {
        menuItemHoverStyle: {
            background: '#eee',
            color: '#333'
        },
        menuItemStyle: {
            background: '#fff',
            color: '#333'
        },
        menuStyle: {
            background: '#fff',
            color: '#333',
            border: '1px solid #ccc'
        }
    }
};

function applyHighchartsTheme(isDark) {
    if (isDark) {
        Highcharts.setOptions(highchartsDarkTheme);
    } else {
        Highcharts.setOptions(highchartsLightTheme);
    }
}

function isDarkModeActive() {
    return $("body").hasClass("dark-mode");
}

function redrawAllCharts() {
    // Recreate all charts with current filtered data
    applyDateRangeFilter();
}

$(document).ready(function() {
    // Hide filter controls or dark mode button based on URL params
    var hideFilters = getQueryParam('hideFilters') === 'true';
    var hideDarkMode = getQueryParam('hideDarkMode') === 'true';
    if (hideFilters) {
        $('#dateRangeFilter').hide();
        // Optionally hide the add button and theatre control if you want all controls gone:
        $('.mb-3:has(#setStart2003), .mb-3:has(#applyDateFilter), #theatreControlContainer').hide();
    }
    if (hideDarkMode) {
        $('#toggleDarkMode').hide();
    }
    var hideAddButton = getQueryParam('hideAddButton') === 'true';
    if (hideAddButton) {
        $("a[href='/add']").hide();
    }

    // Set up date pickers to default to current year or URL param
    var now = new Date();
    var urlYear = parseInt(getQueryParam('initialYear'), 10);
    if (!isNaN(urlYear) && urlYear > 1900 && urlYear < 3000) {
        initialYear = urlYear;
    }
    if(!initialYear) {
        initialYear = now.getFullYear();
    }

    var startOfYear = new Date(initialYear, 0, 1).toISOString().slice(0, 10);
    var endOfYear = new Date(initialYear, 11, 31).toISOString().slice(0, 10);
    $("#startDate").val(startOfYear);
    $("#endDate").val(endOfYear);

    // Load initial data for current year using date range API
    var currentYear = now.getFullYear();
    fetchDataForDateRange(startOfYear, endOfYear, true); // true = initial load

    $("#theatreControlButton").on("click", function(event) {
        var data  = theatreChart.series[0].data;
        if(data.length) {
            for(var x = 0; x < data.length; x += 1) {
                if(data[x].name === "Home") {
                    var current = data[x].visible;
                    data[x].setVisible(!current);
                    break;
                }
            }
        }
    });

    // Date filter button handler
    $("#applyDateFilter").on("click", function() {
        var startDate = $("#startDate").val();
        var endDate = $("#endDate").val();
        if (allDataLoaded) {
            applyDateRangeFilter();
        } else {
            fetchDataForDateRange(startDate, endDate, false);
        }
    });

    // Prevent form submission on Enter key and apply filter instead
    $("#dateRangeFilter form").on("submit", function(e) {
        e.preventDefault();
        var startDate = $("#startDate").val();
        var endDate = $("#endDate").val();
        if (allDataLoaded) {
            applyDateRangeFilter();
        } else {
            fetchDataForDateRange(startDate, endDate, false);
        }
    });

    // Also handle Enter key specifically on the title search field
    $(".filter-input").on("keypress", function(e) {
        if (e.which === 13) { // Enter key
            e.preventDefault();
            var startDate = $("#startDate").val();
            var endDate = $("#endDate").val();
            if (allDataLoaded) {
                applyDateRangeFilter();
            } else {
                fetchDataForDateRange(startDate, endDate, false);
            }
        }
    });

    // Apply title search filter as you type (with debouncing)
    var titleSearchTimeout;
    $("#titleSearch").on("input", function() {
        clearTimeout(titleSearchTimeout);
        titleSearchTimeout = setTimeout(function() {
            applyDateRangeFilter(); // Just reapply the filter with current data
        }, 300); // 300ms delay
    });

    // Add visual feedback for the apply filter button
    $("#applyDateFilter").on("click", function() {
        var $btn = $(this);
        var originalText = $btn.text();
        $btn.text("Applying...").prop("disabled", true);
        setTimeout(function() {
            $btn.text(originalText).prop("disabled", false);
        }, 1000);
    });

    // Set start date to 2003-01-01 when the button is clicked
    $("#setStart2003").on("click", function() {
        $("#startDate").val("2003-01-01");
        $("#applyDateFilter").click();
    });

    // Restore dark mode state from localStorage or system preference
    var darkPref = localStorage.getItem('darkMode');
    if (darkPref === 'true') {
        $('body').addClass('dark-mode');
    } else if (darkPref === 'false') {
        $('body').removeClass('dark-mode');
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        $('body').addClass('dark-mode');
    }

    // Apply Highcharts theme on load
    applyHighchartsTheme(isDarkModeActive());

    $("#toggleDarkMode").on("click", function() {
        var isDark = $("body").hasClass("dark-mode");
        if (isDark) {
            $("body").removeClass("dark-mode");
            localStorage.setItem('darkMode', 'false');
        } else {
            $("body").addClass("dark-mode");
            localStorage.setItem('darkMode', 'true');
        }
        // Apply Highcharts theme and redraw charts
        applyHighchartsTheme(!isDark);
        redrawAllCharts();
    });
});

// Fetches data for a date range. If initialLoad is true, triggers background fetch for all data.
function fetchDataForDateRange(startDate, endDate, initialLoad) {
    // If all data is loaded, just filter client-side
    if (allDataLoaded) {
        applyDateRangeFilter();
        return;
    }
    var url = API_BASE_URL + "/api/?startDate=" + encodeURIComponent(startDate) + "&endDate=" + encodeURIComponent(endDate);
    jQuery.getJSON(url, function(data) {
        data.sort(function(rowA, rowB) {
            var timeA = new Date(rowA.viewingDate).getTime();
            var timeB = new Date(rowB.viewingDate).getTime();
            if (timeA < timeB) return -1;
            if (timeA > timeB) return 1;
            return 0;
        });
        allMovieData = data;
        applyDateRangeFilter();
        // If this is the initial load, start background fetch for all data
        if (initialLoad) {
            fetchAllDataInBackground(startDate);
        }
    }).fail(function() {
        allMovieData = [];
        applyDateRangeFilter();
    });
}

// Background fetch for all data from 2003-01-01 to the day before the current year
function fetchAllDataInBackground(currentYearStart) {
    if (backgroundLoading || allDataLoaded) return;
    backgroundLoading = true;
    var url = API_BASE_URL + "/api/?startDate=2003-01-01&endDate=" + encodeURIComponent(new Date(new Date(currentYearStart).getTime() - 86400000).toISOString().slice(0, 10));
    jQuery.getJSON(url, function(data) {
        // Merge and deduplicate data
        var merged = allMovieData.concat(data);
        // Deduplicate by a unique key (movieTitle + viewingDate + viewLocation)
        var seen = {};
        var deduped = [];
        merged.forEach(function(row) {
            var key = (row.movieTitle || "") + "|" + (row.viewingDate || "") + "|" + (row.viewLocation || "");
            if (!seen[key]) {
                seen[key] = true;
                deduped.push(row);
            }
        });
        deduped.sort(function(rowA, rowB) {
            var timeA = new Date(rowA.viewingDate).getTime();
            var timeB = new Date(rowB.viewingDate).getTime();
            if (timeA < timeB) return -1;
            if (timeA > timeB) return 1;
            return 0;
        });
        allMovieData = deduped;
        allDataLoaded = true;
        backgroundLoading = false;
        applyDateRangeFilter();
    }).fail(function() {
        backgroundLoading = false;
        // Optionally, could retry or show a message
    });
}

function applyDateRangeFilter() {
    // Always recreate charts before updating
    createFirstViewingChart();
    createTheatreChart();
    createFormatChart();
    createGenreChart();
    createMonthChart();

    var startDate = $("#startDate").val();
    var endDate = $("#endDate").val();
    var titleSearch = $("#titleSearch").val().toLowerCase().trim();
    
    var filtered = allMovieData.filter(function(row) {
        var d = row.viewingDate ? row.viewingDate.slice(0, 10) : null;
        var dateMatch = d && d >= startDate && d <= endDate;
        var titleMatch = !titleSearch || (row.movieTitle && row.movieTitle.toLowerCase().includes(titleSearch));
        return dateMatch && titleMatch;
    });
    
    // Clear previous chart/list data
    if (formatChart) { formatChart.series[0].setData([]); formatChart.axes[0].setCategories([]); }
    if (theatreChart) { theatreChart.series[0].setData([]); theatreChart.axes[0].setCategories([]); }
    if (firstChart) { firstChart.series[0].setData([]); }
    if (genreChart) { genreChart.series[0].setData([]); genreChart.axes[0].setCategories([]); }
    if (monthChart) { monthChart.series[0].setData([]); monthChart.axes[0].setCategories([]); }
    $("#movieList tbody").empty();
    // Update all UI with filtered data
    if($("#textStats").length > 0) { prepareTextData(filtered); }
    if($("#formatContainer").length > 0) { prepareFormatData(filtered); }
    if($("#theatreContainer").length > 0) { prepareTheatreData(filtered); }
    if($("#firstViewingContainer").length > 0) { prepareFirstViewingData(filtered); }
    if($("#genreContainer").length > 0) { prepareGenreData(filtered); }
    if($("#monthContainer").length > 0) { prepareMonthData(filtered); }
    if($("#movieListDiv").length > 0) { prepareListData(filtered); }
}

var countMonth = function(data, month) {
    var monthCount = 0;

    data.forEach(function(row){ 
        if(moment(row.viewingDate).month() === month) {
            monthCount += 1;
        }
    });

    return monthCount;
};

var createPieChart = function(container, title, seriesName) {
    var chart = new Highcharts.Chart({
        chart: {
            renderTo: container,
            height: 600,
            type: 'pie',
            backgroundColor: null // Use theme
        },
        credits: {
            enabled: false
        },
        title: {
            text: title,
            backgroundColor: null // Use theme
        },
        xAxis: {
        },
        yAxis: {
        },
        legend: {
            enabled: false,
            align: "center",
            itemWidth: 200,
            width: 200,
            y: 200,
            verticalAlign: "bottom"
        },
        tooltip: {
            formatter: function() {
                var s = '<b>'+ this.key +'</b>';
                var chart = this.series.chart;
                
                s += '<br/>'+ this.point.series.name +': '+
                    this.point.y;

                // List the individual components of the 'Other' category
                // in the tooltip (if any)
                if(this.key === "Other" && chart.otherNames) {
                    s = '<b>'+ this.key +'</b>';

                    for(var x = 0; x < chart.otherNames.length; x += 1) {
                        s += '<br/>'+ chart.otherNames[x] +': '+
                            chart.otherValues[x];
                    }
                }
                
                return s;
            },
            shared: true
        },
        series: [{
            name: seriesName,
            showInLegend: false,
            allowPointSelect: true,
            dataLabels: {
                enabled: true,
                format: '{point.name} - {percentage:.1f}%'
            },
            data: []
        }]
    });        

    return chart;
};

var createFirstViewingChart = function() {
    if($("#firstViewingContainer").length > 0) {
        firstChart = createPieChart("firstViewingContainer", "First Viewing", "Viewings");
    }
};

var createTheatreChart = function() {
    if($("#theatreContainer").length > 0) {
        theatreChart = 
            createPieChart("theatreContainer", "Theatre Frequency", "Visits");
    }
};

var createFormatChart = function() {
    if($("#formatContainer").length > 0) {
        formatChart = 
            createPieChart("formatContainer", "Format", "Viewings");
    }
};

var createGenreChart = function() {
    if($("#genreContainer").length > 0) {
        genreChart = createPieChart("genreContainer", "Genres", "Viewings");
    }
};

var createMonthChart = function () {
    if($("#monthContainer").length > 0) {
        monthChart = new Highcharts.Chart({
            chart: {
                renderTo: "monthContainer",
                type: 'bar',
                backgroundColor: null // Use theme
            },
            title: {
                text: "Movies by Month"
            },
            xAxis: {
                title: {
                    text: "Month"
                }
            },
            yAxis: {
                title: {
                    text: "# Movies"
                }
            },
            legend: {
                align: "right",
                itemWidth: 200,
                width: 200,
                verticalAlign: "middle"
            },
            series: [{
                name: "Movies",
                showInLegend: false,
                data: []
            }]
        });        
    }
};

var prepareTextData = function(data) {
    var shortCount = 0;

    data.forEach(function(row){ 
        if(row.movieGenre === "Short") {
            shortCount += 1;
        }
    });

    $("#textStatsTotal").html(data.length);
    $("#textStatsFeatures").html(data.length - shortCount);
    $("#textStatsShorts").html(shortCount);
};


var countByWithOther = function(data, key, chart) {
    var categories = [];

    var otherThreshold = 3;
    var otherCount = 0;
    var otherNames = [];
    var otherValues = [];

    var totals = {};

    data.forEach(function(row){ 
        var k = row[key];
        if(totals[k] === undefined) {
            totals[k] = 1;
        }
        else {
            totals[k] += 1;
        }
    });

    // Pull out the location data
    for(var v in totals) {
        if(totals[v] <= otherThreshold) {
            otherCount += totals[v];
            otherNames.push(v);
            otherValues.push(totals[v]);
            delete totals[v];
        }
        else {
            chart.series[0].addPoint({
                name: v,
                y: totals[v]
            }, true);
            categories.push(v);
        }
    }

    if(otherCount > 0) {
        chart.series[0].addPoint({
            name: "Other",
            y: otherCount
        }, true);
        categories.push("Other");
    }

    chart.axes[0].setCategories(categories);
    chart.otherNames = otherNames;
    chart.otherValues = otherValues;
};

var prepareTheatreData = function(data) {
    var theatreCategories = [];

    // Folds theatres below a number of visits into a 'Other' category
    var theatreOtherTarget = "Other";
    var theatreOtherThreshold = 3;
    var theatreOtherNames = [];
    var theatreOtherValues = [];
    var theatreOtherCount = 0;

    // Folds several 'locations' into 'Home'
    var theatreCollapseTarget = "Home";
    var theatreCollapseCount = 0;
    var theatreCollapseNames = {"Home": true,
                                "Camp Awesome": true,
                                "Rochester": true,
                                "Hopatcong": true,
                                "McWeavers": true,
                                "Michigan": true,
                                "jwm's house": true,
                                "Virginia": true,
                                "Gualala": true,
                                "Puerto Rico": true,
                                "Airplane": true,
                                "Hampton Beach": true};

    // Compute theatre totals
    var theatreTotals = {};
    theatreTotals[theatreCollapseTarget] = 0;

    data.forEach(function(row){ 
        if(theatreCollapseNames[row.viewLocation] === true) {
            theatreCollapseCount += 1;
            theatreTotals[theatreCollapseTarget] += 1;
        }
        else {
            if(theatreTotals[row.viewLocation] === undefined) {
                theatreTotals[row.viewLocation] = 1;
            }
            else {
                theatreTotals[row.viewLocation] += 1;
            }
        }
    });

    // Pull out the location data
    for(var theatre in theatreTotals) {
        if(theatreTotals[theatre] <= theatreOtherThreshold) {
            theatreOtherCount += theatreTotals[theatre];
            theatreOtherNames.push(theatre);
            theatreOtherValues.push(theatreTotals[theatre]);
            delete theatreTotals[theatre];
        }
        else {
            theatreChart.series[0].addPoint({
                name: theatre,
                y: theatreTotals[theatre]
            }, true);
            theatreCategories.push(theatre);
        }
    }

    if(theatreOtherCount > 0) {
        theatreChart.series[0].addPoint({
            name: "Other",
            y: theatreOtherCount
        }, true);
        theatreCategories.push("Other");
    }

    theatreChart.axes[0].setCategories(theatreCategories);
    theatreChart.otherNames = theatreOtherNames;
    theatreChart.otherValues = theatreOtherValues;
};

var prepareFormatData = function(data) {
    countByWithOther(data, "viewFormat", formatChart);
};

var prepareGenreData = function(data) {
    countByWithOther(data, "movieGenre", genreChart);
};

var prepareFirstViewingData = function(data) {
    var firstViewing = 0;
    var repeatViewing = 0;

    // Pull out the first/repeat viewing data
    data.forEach(function(row) {
        if(row.firstViewing === 1) {
            firstViewing += 1;
        }
        else {
            repeatViewing += 1;
        }
    });

    firstChart.series[0].addPoint({
        name: "First Viewing",
        y: +firstViewing
    }, true);
    firstChart.series[0].addPoint({
        name: "Repeat Viewing",
        y: +repeatViewing
    }, true);
};

var prepareMonthData = function(data) {
    var monthCategories = [];

    for(var x = 0; x < 12; x += 1) {
        /*
        monthChart.series[0].addPoint({
            name: moment().month(x).format("MMMM"),
            y: countMonth(data, x)
        }, true);
        */
        monthChart.series[0].addPoint(countMonth(data,x));


        monthCategories.push(moment().month(x).format("MMM"));
    }

    monthChart.axes[0].setCategories(monthCategories);
};

var prepareListData = function(data) {
    data.forEach(function(row) {
        var title = row.movieTitle;
        if(row.movieGenre === "Short") {
            title = "Short: " + title;
        }
        var titleCell = $("<td />");
        var link = $("<a />", { 'href': row.movieURL, 'text': title });
        if(row.firstViewing !== 1) {
            link.css("font-style", "italic");
        }
        titleCell.append(link);
        var reviewCell = $("<td />").text(row.movieReview);
        var viewingDateCell = $("<td />").addClass("viewing-date-cell").text(row.viewingDate ? row.viewingDate.slice(0, 10) : "");
        var locationCell = $("<td />").addClass("location-cell").text(row.viewLocation || "");
        var rowElem = $("<tr />")
            .append(titleCell)
            .append(reviewCell)
            .append(viewingDateCell)
            .append(locationCell);
        $("#movieList tbody").append(rowElem);
    });
};
