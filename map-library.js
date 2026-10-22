/* Map Lens library: the published route maps that ship with the app, in assets/Maps/.

   A route map is built on the tablet from a Lytx GPS export (map-live.js) and drawn on
   OpenStreetMap. Once published, its file is committed here and its name listed in LIVE:

     <route>.route.json         the highlighted streets (no GPS data), e.g. M-1-2.route.json

   Routes are named exactly as on Route Sheets (no driver name). A map can also be published on
   the tablet alone (Publish, kept in fleetMgrRouteMapsPublished); has() and traced() count those.

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

    // Maps published on this tablet only (map-live.js keeps them in fleetMgrRouteMapsPublished)
    function localPublished(route) {
        try {
            var all = JSON.parse(localStorage.getItem("fleetMgrRouteMapsPublished") || "{}") || {};
            var k = key(route);
            var name = Object.keys(all).filter(function (r) { return key(r) === k; })[0];
            return name ? { name: name, map: all[name] } : null;
        } catch (e) {
            return null;
        }
    }

    // Whether a route's published map has something highlighted. Checked once per page load
    // (the service worker always asks the network first).
    var published = {};
    function traced(route) {
        var local = localPublished(route);
        if (local && local.map && ((local.map.blocks || []).length || (local.map.strokes || []).length)) return Promise.resolve(true);
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

    // Whether a spreadsheet is a GPS (Lytx location history) export rather than a route sheet:
    // its first row has latitude and longitude columns. Reads .xlsx with the page's XLSX reader.
    function isGpsFile(file) {
        function hasLatLng(row) {
            var head = (row || []).map(function (h) { return String(h).trim().toLowerCase(); });
            return (head.indexOf("latitude") !== -1 || head.indexOf("lat") !== -1) &&
                (head.indexOf("longitude") !== -1 || head.indexOf("lng") !== -1 || head.indexOf("lon") !== -1);
        }
        if (/\.csv$/i.test(file.name)) {
            return file.slice(0, 4096).text().then(function (t) { return hasLatLng(t.split(/\r?\n/)[0].split(",")); });
        }
        if (!/\.xlsx?$/i.test(file.name) || !window.XLSX) return Promise.resolve(false);
        return file.arrayBuffer().then(function (buf) {
            var wb = XLSX.read(new Uint8Array(buf), { type: "array", sheetRows: 1 });
            var rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
            return hasLatLng(rows[0]);
        }).catch(function () { return false; });
    }

    window.MapLibrary = {
        isGpsFile: isGpsFile,
        live: LIVE,
        findLive: findLive,
        // The route's name as the library (or this tablet) has it, or null when it has no published map
        has: function (route) {
            var local = localPublished(route);
            return findLive(route) || (local ? local.name : null);
        },
        traced: traced,
        liveUrl: liveUrl
    };
})();
