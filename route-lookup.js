/* Finds which route a street address is on, using the routes entered in Route Sheets
   (route-streets.html, saved under fleetMgrRouteStreets). Shared by any page that logs an
   address, so a route and driver can be filled in instead of typed.

     RouteLookup.find("123 Main Street Apt 2")
       -> [{ route: "12", driver: "Sam", area: "Washington", day: "Monday", street: "Main St" }]

   The house number is dropped and the rest is matched against each route's streets with the
   same spelling rules as the trackers ("Street" = "St", "North" = "N", punctuation ignored).
   The longest matching street wins, so "N Main St Ext" beats "Main St". A street listed on
   more than one route returns every one of those routes, for the person to pick from; the
   lookup never guesses between them. */
(function () {
    "use strict";

    var KEY = "fleetMgrRouteStreets";
    var WORDS = {
        street: "st", avenue: "ave", road: "rd", drive: "dr", lane: "ln", court: "ct",
        boulevard: "blvd", place: "pl", circle: "cir", terrace: "ter", highway: "hwy",
        extension: "ext", parkway: "pkwy", pike: "pk",
        north: "n", south: "s", east: "e", west: "w"
    };

    function normalize(text) {
        return String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
            .map(function (w) { return WORDS[w] || w; }).join(" ");
    }

    // "123 Main St", "123-125 Main St", "12A Main St" -> "main st"
    function streetPart(address) {
        return normalize(address).replace(/^(\d+[a-z]?\s*)+/, "").trim();
    }

    function loadRoutes() {
        try {
            var data = JSON.parse(localStorage.getItem(KEY) || "[]");
            return Array.isArray(data) ? data.filter(function (r) { return r && r.id; }) : [];
        } catch (e) {
            return [];
        }
    }

    // "n main st" -> ["n main st", "main st"], so "N Main St" and "Main St" find each other
    function variants(text) {
        var bare = text.replace(/^[nsew]\s+/, "");
        return bare !== text && bare ? [text, bare] : [text];
    }

    // Whole words from the start: "main st" matches "main st apt 2" but not "main stream rd"
    function startsWithStreet(target, key) {
        return variants(target).some(function (t) {
            return variants(key).some(function (k) { return t === k || t.indexOf(k + " ") === 0; });
        });
    }

    function find(address) {
        var target = streetPart(address);
        if (!target) return [];
        var best = 0;
        var hits = [];
        loadRoutes().forEach(function (r) {
            (r.streets || []).forEach(function (s) {
                var key = normalize(s);
                // A longer listed street ("main st ext") wins over a shorter one ("main st")
                if (!key || !startsWithStreet(target, key)) return;
                if (key.length > best) {
                    best = key.length;
                    hits = [];
                }
                if (key.length === best && !hits.some(function (h) { return h.route === r.route; })) {
                    hits.push({ route: r.route, driver: r.driver || "", area: r.area || "", day: r.day || "", street: s });
                }
            });
        });
        return hits;
    }

    window.RouteLookup = {
        find: find,
        hasRoutes: function () { return loadRoutes().length > 0; }
    };
})();
