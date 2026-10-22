/* Map Lens library: the published route maps that ship with the app, in assets/Maps/.

   A route map is built on the tablet from a Lytx GPS export (map-live.js) and drawn on
   OpenStreetMap. Once published, its file is committed here and its name listed in LIVE:

     <route>.route.json         the highlighted streets (no GPS data), e.g. M-1-2.route.json

   Routes are named exactly as on Route Sheets (no driver name).

   Shared by map-live.js and route-streets.js (the Route Map button and map icon on a route's card). */
(function () {
    "use strict";

    // Published route maps (each has assets/Maps/<route>.route.json)
    var LIVE = ["M-1-2"];

    var DIR = "assets/Maps/";

    function key(route) {
        return String(route || "").trim().replace(/^route\s+/i, "").toLowerCase();
    }

    function findLive(route) {
        var k = key(route);
        return LIVE.filter(function (r) { return r.toLowerCase() === k; })[0] || null;
    }

    function liveUrl(route) {
        return DIR + encodeURIComponent(route) + ".route.json";
    }

    // Whether a route's published map has something highlighted. Checked once per page load
    // (the service worker always asks the network first).
    var published = {};
    function traced(route) {
        var name = findLive(route);
        if (!name) return Promise.resolve(false);
        if (!published[name]) {
            published[name] = fetch(liveUrl(name), { cache: "no-cache" })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (t) { return !!(t && ((t.blocks || []).length || (t.strokes || []).length)); })
                .catch(function () { return false; });
        }
        return published[name];
    }

    window.MapLibrary = {
        live: LIVE,
        findLive: findLive,
        // The route's name as the library has it, or null when it has no published map
        has: findLive,
        traced: traced,
        liveUrl: liveUrl
    };
})();
