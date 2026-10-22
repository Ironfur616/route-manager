/* Map Lens library: the route maps that ship with the app, in assets/Maps/.

   Live route maps (map-live.js) are built from a Lytx GPS export on the tablet and drawn on
   OpenStreetMap. Once one is published, its file is committed here and its name listed in LIVE:

     <route>.route.json         the highlighted streets (no GPS data), e.g. M-1-2.route.json

   Screenshot maps (map-lens.js, being replaced by live maps): each route is named exactly as on
   Route Sheets (no driver name) and has one sheet per blank map. A route that runs off one map
   is split into sheets ("M-2-4" → M-2-4-1 and M-2-4-2), printed as one page each. A sheet's file
   name may carry a description after the sheet number ("M-5-1-1_Canton Recycle"); list it here
   exactly as named. That description ("Canton Recycle") is printed in the handout's header. For
   every sheet the folder holds:

     <sheet>.pdf                the blank Google Maps print (11x17 landscape)
     <sheet>_breadcrumbs.png    the GPS tracking screenshot with the truck's trail
     <sheet>.trace.json         the finished trace, once one is published (optional)

   To add a screenshot route: drop its files in assets/Maps/ and list it in ROUTES. A published
   trace needs no entry; Map Lens looks for the .trace.json file on its own.

   Shared by map-lens.js, map-live.js and route-streets.js (the Route Map button on a route's card). */
(function () {
    "use strict";

    var ROUTES = [
        { route: "M-2-1", sheets: ["M-2-1"] },
        { route: "M-2-2", sheets: ["M-2-2"] },
        { route: "M-2-3", sheets: ["M-2-3"] },
        { route: "M-2-4", sheets: ["M-2-4-1", "M-2-4-2"] },
        { route: "M-5-1", sheets: ["M-5-1-1_Canton Recycle", "M-5-1-2_Canton Recycle"] },
        { route: "MR-56", sheets: ["MR-56-1_Canton Recycle Side 2", "MR-56-2_Canton Recycle Side 2"] }
    ];

    // Published live route maps (each has assets/Maps/<route>.route.json)
    var LIVE = ["M-1-2"];

    var DIR = "assets/Maps/";

    function key(route) {
        return String(route || "").trim().replace(/^route\s+/i, "").toLowerCase();
    }

    function find(route) {
        var k = key(route);
        return ROUTES.filter(function (r) { return r.route.toLowerCase() === k; })[0] || null;
    }

    function findLive(route) {
        var k = key(route);
        return LIVE.filter(function (r) { return r.toLowerCase() === k; })[0] || null;
    }

    function liveUrl(route) {
        return DIR + encodeURIComponent(route) + ".route.json";
    }

    // Whether a route's map is done: any of its sheets has a published trace with strokes in it,
    // or its published live map has something highlighted. Checked once per file per page load
    // (the service worker always asks the network first).
    var published = {};
    function fileHas(url, test) {
        if (!published[url]) {
            published[url] = fetch(url, { cache: "no-cache" })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (t) { return !!(t && test(t)); })
                .catch(function () { return false; });
        }
        return published[url];
    }

    window.MapLibrary = {
        routes: ROUTES,
        live: LIVE,
        find: find,
        findLive: findLive,
        // The route's name as the library has it (live first), or null when it has no map at all
        has: function (route) {
            var entry = find(route);
            return findLive(route) || (entry ? entry.route : null);
        },
        traced: function (route) {
            var live = findLive(route);
            if (live) {
                return fileHas(liveUrl(live), function (t) {
                    return (t.blocks || []).length > 0 || (t.strokes || []).length > 0;
                });
            }
            var entry = find(route);
            if (!entry) return Promise.resolve(false);
            return Promise.all(entry.sheets.map(function (sheet) {
                return fileHas(DIR + encodeURIComponent(sheet) + ".trace.json", function (t) {
                    return Array.isArray(t.strokes) && t.strokes.length > 0;
                });
            })).then(function (all) {
                return all.some(Boolean);
            });
        },
        // The description after the sheet number ("M-5-1-1_Canton Recycle" → "Canton Recycle"),
        // printed in the handout's header; "" when the file name has none
        label: function (sheet) {
            var i = String(sheet).indexOf("_");
            return i < 0 ? "" : sheet.slice(i + 1).replace(/_/g, " ").trim();
        },
        liveUrl: liveUrl,
        mapUrl: function (sheet) { return DIR + encodeURIComponent(sheet) + ".pdf"; },
        crumbsUrl: function (sheet) { return DIR + encodeURIComponent(sheet) + "_breadcrumbs.png"; },
        traceUrl: function (sheet) { return DIR + encodeURIComponent(sheet) + ".trace.json"; }
    };
})();
