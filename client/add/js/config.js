// Shared configuration for movie add pages
var config = {
    theatreNames: [
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
    ],
    homeNames: [
        "Home",
        "Virginia",
        "Michigan",
        "Rochester",
        "Hopatcong",
        "Other"
    ]
};
config.views = [
    {
        name: "Theater",
        locations: config.theatreNames,
        defaultLocation: null
    },
    {
        name: "Apple TV",
        locations: config.homeNames,
        defaultLocation: "Home"
    },
    {
        name: "Download",
        locations: config.homeNames,
        defaultLocation: "Home"
    },
    {
        name: "Netflix",
        locations: config.homeNames,
        defaultLocation: "Home"
    },
    {
        name: "Disney+",
        locations: config.homeNames,
        defaultLocation: "Home"
    },
    {
        name: "Amazon Prime",
        locations: config.homeNames,
        defaultLocation: "Home"
    },
    {
        name: "Blu-ray",
        locations: config.homeNames,
        defaultLocation: "Home"
    },
    {
        name: "DVD",
        locations: config.homeNames,
        defaultLocation: "Home"
    },
    {
        name: "TV",
        locations: config.homeNames,
        defaultLocation: "Home"
    },
    {
        name: "IFFBoston",
        locations: config.homeNames,
        defaultLocation: "Home"
    },
    {
        name: "Other",
        locations: config.homeNames,
        defaultLocation: "Home"
    }
];
