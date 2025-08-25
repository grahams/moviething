// Configuration file for merge rules used in chart data aggregation
var mergeRulesConfig = {
    // Theatre/Location merge rules
    theatre: [
        {
            target: "Home",
            names: {   
                "home": true,
                "camp awesome": true,
                "rochester": true,
                "hopatcong": true,
                "mcweavers": true,
                "michigan": true,
                "jwm's house": true,
                "virginia": true,
                "gualala": true,
                "cleveland": true,
                "puerto rico": true,
                "airplane": true,
                "hampton beach": true
            }
        }
    ],

    // Format merge rules
    format: [
        {
            target: "Streaming",
            names: {
                "apple tv": true,
                "netflix": true,
                "download": true,
                "youtube": true,
                "nebula": true,
                "xbox streaming": true,
                "screening": true,
                "hd download": true,
                "amazon instant": true,
                "netflix streaming": true,
                "itunes streaming": true,
                "ipad": true,
                "amazon unbox": true,
                "amazon prime": true,
                "hulu": true,
                "xbox": true,
                "streaming": true,
                "disney+": true,
                "itunes (ipad)": true,
                "qello": true,
                "google play": true
            }
        },
        {
            target: "Physical",
            names: {
                "bluray": true,
                "blu-ray": true,
                "vcd": true,
                "cd": true,
                "dvd": true,
                "vhs": true
            }
        },
        {
            target: "TV/Cable",
            names: {
                "tv": true,
                "on demand": true
            }
        },
        {
            target: "Theater",
            names: {
                "theater": true,
                "theatre": true,
                "imax": true,
                "iffboston": true
            }
        }
    ]
};
