/* Map Lens library: the route maps that ship with the app, in assets/Maps/.
   Each route is named exactly as on Route Sheets (no driver name) and has one sheet per blank map.
   A route that runs off one map is split into sheets ("M-2-4" → M-2-4-1 and M-2-4-2), printed as
   one page each. A sheet's file name may carry a description after the sheet number
   ("M-5-1-1_Canton Recycle"); list it here exactly as named. That description ("Canton Recycle")
   is printed in the handout's header. For every sheet the folder holds:

     <sheet>.pdf                the blank Google Maps print (11x17 landscape)
     <sheet>_breadcrumbs.png    the GPS tracking screenshot with the truck's trail
     <sheet>.trace.json         the finished trace, once one is published (optional)

   To add a route: drop its files in assets/Maps/ and list it here. A published trace needs no
   entry; Map Lens looks for the .trace.json file on its own.

   Shared by map-lens.js and route-streets.js (the Route Map button on a route's card). */
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

    var DIR = "assets/Maps/";

    function find(route) {
        var key = String(route || "").trim().replace(/^route\s+/i, "").toLowerCase();
        return ROUTES.filter(function (r) { return r.route.toLowerCase() === key; })[0] || null;
    }

    // Whether a route's map is done: any of its sheets has a published trace with strokes in it.
    // Checked once per sheet per page load (the service worker always asks the network first).
    var published = {};
    function sheetTraced(sheet) {
        if (!published[sheet]) {
            published[sheet] = fetch(DIR + encodeURIComponent(sheet) + ".trace.json", { cache: "no-cache" })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (t) { return !!(t && Array.isArray(t.strokes) && t.strokes.length); })
                .catch(function () { return false; });
        }
        return published[sheet];
    }

    window.MapLibrary = {
        routes: ROUTES,
        find: find,
        traced: function (route) {
            var entry = find(route);
            if (!entry) return Promise.resolve(false);
            return Promise.all(entry.sheets.map(sheetTraced)).then(function (all) {
                return all.some(Boolean);
            });
        },
        // The description after the sheet number ("M-5-1-1_Canton Recycle" → "Canton Recycle"),
        // printed in the handout's header; "" when the file name has none
        label: function (sheet) {
            var i = String(sheet).indexOf("_");
            return i < 0 ? "" : sheet.slice(i + 1).replace(/_/g, " ").trim();
        },
        mapUrl: function (sheet) { return DIR + encodeURIComponent(sheet) + ".pdf"; },
        crumbsUrl: function (sheet) { return DIR + encodeURIComponent(sheet) + "_breadcrumbs.png"; },
        traceUrl: function (sheet) { return DIR + encodeURIComponent(sheet) + ".trace.json"; }
    };
})();
