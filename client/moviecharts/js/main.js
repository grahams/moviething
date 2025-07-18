var theatreChart = null;
var formatChart = null;
var firstChart = null;
var genreChart = null;
var monthChart = null;

var year = null;
var retry = false;
var allMovieData = [];
var lastTriedApi = false;
var loadedYear = null;
var loadedYears = {};

$(document).ready(function() {
    // Set up date pickers to default to current year
    var now = new Date();
    var startOfYear = new Date(now.getFullYear(), 0, 1);
    var endOfYear = new Date(now.getFullYear(), 11, 31);
    $("#startDate").val(startOfYear.toISOString().slice(0, 10));
    $("#endDate").val(endOfYear.toISOString().slice(0, 10));

    // Remove year param logic, always use current year for initial data load
    year = mcYear;
    loadedYears = {};
    fetchAndApplyRange(year, year, applyDateRangeFilter);

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
        var startYear = parseInt(startDate.slice(0,4));
        var endYear = parseInt(endDate.slice(0,4));
        fetchAndApplyRange(startYear, endYear, applyDateRangeFilter);
    });
});

function fetchAndApplyRange(startYear, endYear, callback) {
    var yearsToFetch = [];
    for (var y = startYear; y <= endYear; y++) {
        if (!loadedYears[y]) yearsToFetch.push(y);
    }
    if (yearsToFetch.length === 0) {
        // All years already loaded
        allMovieData = [];
        for (var y = startYear; y <= endYear; y++) {
            allMovieData = allMovieData.concat(loadedYears[y]);
        }
        callback();
        return;
    }
    var fetched = 0;
    yearsToFetch.forEach(function(y) {
        requestDataMulti('https://movies.grahams.wtf/moviecharts/data/' + y + '.json', y, function() {
            fetched++;
            if (fetched === yearsToFetch.length) {
                // All fetches done, combine
                allMovieData = [];
                for (var yy = startYear; yy <= endYear; yy++) {
                    allMovieData = allMovieData.concat(loadedYears[yy] || []);
                }
                callback();
            }
        });
    });
}

function requestDataMulti(path, yearForApi, done) {
    jQuery.getJSON(path, function(data) {
        data.sort(function(rowA, rowB) {
            var timeA = new Date(rowA.viewingDate).getTime();
            var timeB = new Date(rowB.viewingDate).getTime();
            if (timeA < timeB) return -1;
            if (timeA > timeB) return 1;
            return 0;
        });
        loadedYears[yearForApi] = data;
        done();
    }).fail(function(jqxhr) {
        if (jqxhr.status === 404 || jqxhr.status === 0 || jqxhr.status === 500) {
            jQuery.getJSON("https://movies.grahams.wtf/api/?year=" + yearForApi, function(data) {
                data.sort(function(rowA, rowB) {
                    var timeA = new Date(rowA.viewingDate).getTime();
                    var timeB = new Date(rowB.viewingDate).getTime();
                    if (timeA < timeB) return -1;
                    if (timeA > timeB) return 1;
                    return 0;
                });
                loadedYears[yearForApi] = data;
                done();
            }).fail(function() {
                loadedYears[yearForApi] = [];
                done();
            });
        } else {
            loadedYears[yearForApi] = [];
            done();
        }
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
            type: 'pie'
        },
        credits: {
            enabled: false
        },
        title: {
            text: title
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
                type: 'bar'
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
        var link = $("<a />", { 'href': row.movieURL, 
                                'text': title });

        if(row.firstViewing !== 1) {
            link.css("font-style", "italic");
        }
        titleCell.append(link);

        var reviewCell = $("<td />").text(row.movieReview);

        var row = $("<tr />").append(titleCell).append(reviewCell);
        $("#movieList tbody").append(row);
    });
};
