/* Live route maps in Map Lens (map-lens.html): a route's streets highlighted on OpenStreetMap,
   built from a Lytx GPS export instead of screenshots.

   Import: a Lytx location-history export (.xlsx or .csv: date, time, type, latitude, longitude,
   speed(mph)...) is read on the device. Its "GPS Trail" rows, one every 30 seconds, are kept
   from leaving the yard (the first "Geofence End") to getting back (the last "Geofence Start").
   The file name gives the route ("route M-1-2.xlsx"; text after "_" is the label). The export
   also holds the truck, the yard and driving events, so it stays on this device: the trail lives
   only in the draft and is never published.

   Streets: OpenStreetMap's streets near the trail (the slow, collection-speed part of it) come
   from the Overpass API, cut into blocks from intersection to intersection. The download can take
   most of a minute, so it's kept in Cache Storage (routeiq-streets) per route. Load Streets Here
   adds the streets in view, for anything the truck didn't pass that day.

   Editing: tap a block to highlight it (tap it again to clear it, or with another color to
   recolor it); drag to highlight every block the finger passes. Draw is freehand, for what OSM
   doesn't have. Erase clears the blocks it touches and only the touched part of a freehand line.
   Two fingers always pan and zoom, and a second finger cancels what the first one started. Move
   pans with one finger. Yellow is the basic route street; blue and green mean what the legend says.

   The trail's time order also gives each highlighted block a direction of travel (arrows,
   off by default; Arrows mode sets them by hand) and the route's Start and End pins (on by
   default, dragged to adjust). Print Map makes the 11x17 handout from OpenStreetMap itself, so
   street names print.

   Drafts are kept in localStorage (fleetMgrRouteMaps, so they're in backups). Publish saves
   <route>.route.json (highlights only); once committed to assets/Maps/ and listed in
   map-library.js, every device has it, and the draft is dropped when the library holds one at
   least as new. Highlighted lines are kept in the drafts and files themselves, so viewing a map
   never needs the street download. */
(function () {
    "use strict";

    var DRAFTS_KEY = "fleetMgrRouteMaps";
    var SHEETS_KEY = "fleetMgrRouteStreets";
    var STREETS_CACHE = "routeiq-streets";
    var OVERPASS = [
        { url: "https://overpass-api.de/api/interpreter", wait: 100000 },
        { url: "https://overpass.private.coffee/api/interpreter", wait: 60000 }
    ];
    var HIGHWAYS = "primary|secondary|tertiary|unclassified|residential|living_street|service|road";
    var CELL = 0.004;       // degrees: the squares of map the street download covers (~400 m)
    var MAX_CELLS = 200;
    var SLOW_MPH = 25;      // collection speed; faster is driving between places
    var COLORS = { y: "#FFE500", b: "#1E90FF", g: "#22C55E" };
    var COLOR_NAMES = { y: "Yellow", b: "Blue", g: "Green" };
    var LINE_PX = 12;       // highlighter width on screen at any zoom
    var HIT_PX = 22;        // how near a tap has to land to a street
    var ERASE_PX = 18;
    var DRAW_STEP_PX = 3;

    var lib = window.MapLibrary;
    if (!lib || !window.L) return;

    var listEl = document.getElementById("mlv-list");
    var countEl = document.getElementById("mlv-count");
    var messageEl = document.getElementById("mlv-message");
    var fileInput = document.getElementById("mlv-import-file");

    /* ---------- Helpers ---------- */

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function round5(n) {
        return Math.round(n * 1e5) / 1e5;
    }

    function routeKey(route) {
        return String(route || "").trim().replace(/^route\s+/i, "").toLowerCase();
    }

    function title(route, label) {
        return "Route " + route + (label ? " · " + label : "");
    }

    function routeSheet(route) {
        try {
            var list = JSON.parse(localStorage.getItem(SHEETS_KEY) || "[]");
            var k = routeKey(route);
            return (Array.isArray(list) ? list : []).filter(function (r) {
                return r && routeKey(r.route) === k;
            })[0] || null;
        } catch (e) {
            return null;
        }
    }

    function bboxOf(g) {
        var b = [Infinity, Infinity, -Infinity, -Infinity];
        g.forEach(function (p) {
            if (p[0] < b[0]) b[0] = p[0];
            if (p[1] < b[1]) b[1] = p[1];
            if (p[0] > b[2]) b[2] = p[0];
            if (p[1] > b[3]) b[3] = p[1];
        });
        return b;
    }

    function distToSegment(px, py, ax, ay, bx, by) {
        var dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
        var t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
        var x = ax + t * dx - px, y = ay + t * dy - py;
        return Math.sqrt(x * x + y * y);
    }

    /* ---------- Drafts and published maps ---------- */

    function loadDrafts() {
        try {
            var data = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}");
            return data && typeof data === "object" && !Array.isArray(data) ? data : {};
        } catch (e) {
            return {};
        }
    }

    function draftFor(route) {
        var all = loadDrafts(), k = routeKey(route);
        for (var name in all) if (routeKey(name) === k) return all[name];
        return null;
    }

    function saveDraft(route, draft) {
        var all = loadDrafts(), k = routeKey(route);
        Object.keys(all).forEach(function (name) { if (routeKey(name) === k) delete all[name]; });
        if (draft) all[route] = draft;
        try {
            localStorage.setItem(DRAFTS_KEY, JSON.stringify(all));
            return true;
        } catch (e) {
            say("This device's storage is full, so the map couldn't be saved. Publish it or free some space.");
            return false;
        }
    }

    var published = {};
    function publishedMap(route) {
        var name = lib.findLive(route);
        if (!name) return Promise.resolve(null);
        if (!published[name]) {
            published[name] = fetch(lib.liveUrl(name), { cache: "no-cache" })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (m) { return m && Array.isArray(m.blocks) ? m : null; })
                .catch(function () { return null; });
        }
        return published[name];
    }

    // A route's published map and local draft; a draft the library has caught up with is dropped
    function current(route) {
        return publishedMap(route).then(function (pub) {
            var draft = draftFor(route);
            if (draft && pub && (pub.updated || 0) >= (draft.updated || 0)) {
                saveDraft(route, null);
                draft = null;
            }
            return { lib: pub, draft: draft };
        });
    }

    function statusText(state) {
        if (state.draft && state.draft.published) return "Published, waiting for the app update";
        if (state.draft) return "Draft on this device";
        if (state.lib) return "Published";
        return "Not started";
    }

    // Published files list blocks; drafts keep them by id
    function fromFile(m) {
        var blocks = {};
        (m.blocks || []).forEach(function (b) {
            var copy = { c: b.c, n: b.n || "", g: b.g };
            if (b.d) copy.d = b.d;
            if (b.dm != null) copy.dm = b.dm;
            if (b.t != null) copy.t = b.t;
            blocks[b.id] = copy;
        });
        return {
            route: m.route, label: m.label || "", updated: m.updated || 0,
            legend: { b: (m.legend || {}).b || "", g: (m.legend || {}).g || "" },
            blocks: blocks, strokes: (m.strokes || []).slice(), trail: [],
            start: m.start || null, end: m.end || null,
            // Maps published before pins and arrows existed get the defaults
            show: m.show ? { markers: !!m.show.markers, arrows: !!m.show.arrows } : Object.assign({}, DEFAULT_SHOW)
        };
    }

    /* ---------- Reading a Lytx export ---------- */

    function parseCsv(text) {
        var rows = [], row = [], field = "", quoted = false;
        for (var i = 0; i < text.length; i++) {
            var ch = text[i];
            if (quoted) {
                if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
                else if (ch === '"') quoted = false;
                else field += ch;
            } else if (ch === '"') {
                quoted = true;
            } else if (ch === ",") {
                row.push(field); field = "";
            } else if (ch === "\n" || ch === "\r") {
                if (ch === "\r" && text[i + 1] === "\n") i++;
                row.push(field); rows.push(row); row = []; field = "";
            } else {
                field += ch;
            }
        }
        if (field || row.length) { row.push(field); rows.push(row); }
        return rows;
    }

    function readRows(file) {
        if (/\.csv$/i.test(file.name)) return file.text().then(parseCsv);
        if (!window.XLSX) return Promise.reject(new Error("The spreadsheet reader didn't load."));
        return file.arrayBuffer().then(function (buf) {
            var wb = XLSX.read(new Uint8Array(buf), { type: "array" });
            return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
        });
    }

    // Seconds since 1970 from Excel serial days or text dates and times. Lytx gives local clock
    // times, so a serial's day and time are read as this device's local time.
    function timeOf(date, time) {
        if (typeof date === "number") {
            var days = date + (typeof time === "number" ? time : 0);
            var utc = new Date(Math.round((days - 25569) * 86400) * 1000);
            return Math.round(new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(),
                utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds()).getTime() / 1000);
        }
        var t = Date.parse(String(date || "") + " " + String(time || ""));
        return isNaN(t) ? NaN : Math.round(t / 1000);
    }

    function lytxTrail(rows) {
        var head = (rows[0] || []).map(function (h) { return String(h).trim().toLowerCase(); });
        function col(test) {
            for (var i = 0; i < head.length; i++) if (test(head[i])) return i;
            return -1;
        }
        var cLat = col(function (h) { return h === "latitude" || h === "lat"; });
        var cLng = col(function (h) { return h === "longitude" || h === "lng" || h === "lon"; });
        if (cLat < 0 || cLng < 0) throw new Error("This file has no latitude and longitude columns. Export Location History from Lytx.");
        var cType = col(function (h) { return h === "type"; });
        var cDate = col(function (h) { return h === "date"; });
        var cTime = col(function (h) { return h === "time"; });
        var cSpeed = col(function (h) { return /^speed\b/.test(h) && h.indexOf("limit") < 0 && h.indexOf("max") < 0; });
        var cVehicle = col(function (h) { return h === "vehicle_name" || h === "vehicle"; });
        var cHeading = col(function (h) { return h === "heading"; });

        var recs = rows.slice(1).map(function (r) {
            return {
                type: cType >= 0 ? String(r[cType]).trim() : "GPS Trail",
                lat: parseFloat(r[cLat]), lng: parseFloat(r[cLng]),
                mph: cSpeed >= 0 ? parseFloat(r[cSpeed]) || 0 : 0,
                t: cDate >= 0 ? timeOf(r[cDate], cTime >= 0 ? r[cTime] : 0) : NaN,
                vehicle: cVehicle >= 0 ? String(r[cVehicle]).trim() : "",
                heading: cHeading >= 0 && r[cHeading] !== "" ? parseFloat(r[cHeading]) : NaN
            };
        }).filter(function (r) { return isFinite(r.lat) && isFinite(r.lng) && (r.lat || r.lng); });
        if (recs.every(function (r) { return isFinite(r.t); })) recs.sort(function (a, b) { return a.t - b.t; });

        // From leaving the yard to getting back, when the export shows both
        var from = 0, to = recs.length - 1;
        var left = -1, back = -1;
        recs.forEach(function (r, i) {
            if (left < 0 && /geofence end/i.test(r.type)) left = i;
            if (left >= 0 && i > left && /geofence start/i.test(r.type)) back = i;
        });
        if (left >= 0) from = left;
        if (back > left) to = back;
        var trailRows = recs.slice(from, to + 1).filter(function (r) { return /gps trail/i.test(r.type); });
        if (!trailRows.length) trailRows = recs.slice(from, to + 1);
        if (trailRows.length < 2) throw new Error("This file doesn't have a GPS trail in it.");

        var t0 = isFinite(trailRows[0].t) ? trailRows[0].t : 0;
        return {
            trail: trailRows.map(function (r) {
                // [lat, lng, mph, seconds from the start, heading in degrees (-1 when not given)]
                return [round5(r.lat), round5(r.lng), Math.round(r.mph), isFinite(r.t) ? r.t - t0 : 0,
                    isFinite(r.heading) ? Math.round(r.heading) : -1];
            }),
            start: isFinite(trailRows[0].t) ? new Date(trailRows[0].t * 1000) : null,
            end: isFinite(trailRows[trailRows.length - 1].t) ? new Date(trailRows[trailRows.length - 1].t * 1000) : null,
            vehicle: trailRows[0].vehicle || "",
            trimmed: left >= 0
        };
    }

    // "route M-1-2.xlsx" → M-1-2; "route M-5-1_Canton Recycle.xlsx" → M-5-1, Canton Recycle
    function nameFromFile(name) {
        var base = String(name).replace(/\.[^.]+$/, "").replace(/^route\s+/i, "").trim();
        var i = base.indexOf("_");
        return i < 0 ? { route: base, label: "" } : { route: base.slice(0, i).trim(), label: base.slice(i + 1).replace(/_/g, " ").trim() };
    }

    /* ---------- Streets from OpenStreetMap ---------- */

    function overpass(query) {
        var i = 0;
        function attempt() {
            var server = OVERPASS[i];
            var ctrl = window.AbortController ? new AbortController() : null;
            var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, server.wait) : null;
            return fetch(server.url, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: "data=" + encodeURIComponent(query),
                signal: ctrl ? ctrl.signal : undefined
            }).then(function (r) {
                clearTimeout(timer);
                if (!r.ok) throw new Error("Street server answered " + r.status);
                return r.json();
            }).catch(function (err) {
                clearTimeout(timer);
                if (++i < OVERPASS.length) return attempt();
                throw err;
            });
        }
        return attempt();
    }

    function wayFilter() {
        return '["highway"~"^(' + HIGHWAYS + ')$"]["service"!~"^(parking_aisle|drive-through|driveway)$"]["access"!~"^(private|no)$"]';
    }

    function cellsQuery(points) {
        var cells = {};
        points.forEach(function (p) { cells[Math.floor(p[0] / CELL) + "," + Math.floor(p[1] / CELL)] = 1; });
        var keys = Object.keys(cells).slice(0, MAX_CELLS);
        var f = wayFilter();
        return "[out:json][timeout:90];(" + keys.map(function (k) {
            var a = k.split(","), s = a[0] * CELL, w = a[1] * CELL;
            return "way" + f + "(" + s.toFixed(4) + "," + w.toFixed(4) + "," + (s + CELL).toFixed(4) + "," + (w + CELL).toFixed(4) + ");";
        }).join("") + ");out geom;";
    }

    function boundsQuery(b) {
        return "[out:json][timeout:90];way" + wayFilter() + "(" + [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]
            .map(function (n) { return n.toFixed(5); }).join(",") + ");out geom;";
    }

    function compactWays(json) {
        return (json.elements || []).filter(function (e) {
            return e.type === "way" && e.nodes && e.geometry && e.nodes.length === e.geometry.length && e.geometry.every(Boolean);
        }).map(function (e) {
            var t = e.tags || {};
            return {
                id: e.id, n: t.name || t.ref || "", nodes: e.nodes,
                g: e.geometry.map(function (p) { return [round5(p.lat), round5(p.lon)]; })
            };
        });
    }

    function streetsKey(route) {
        return new URL("./streets/" + encodeURIComponent(routeKey(route)), location.href).href;
    }

    function cachedWays(route) {
        if (!window.caches) return Promise.resolve(null);
        return caches.open(STREETS_CACHE).then(function (c) { return c.match(streetsKey(route)); })
            .then(function (r) { return r ? r.json() : null; })
            .catch(function () { return null; });
    }

    function cacheWays(route, ways) {
        if (!window.caches) return Promise.resolve();
        return caches.open(STREETS_CACHE).then(function (c) {
            return c.put(streetsKey(route), new Response(JSON.stringify(ways), { headers: { "Content-Type": "application/json" } }));
        }).catch(function () { /* the next edit downloads them again */ });
    }

    // Each way cut at every node another loaded way shares: one block per stretch between intersections
    function buildBlocks(ways) {
        var uses = {};
        ways.forEach(function (w) {
            var seen = {};
            w.nodes.forEach(function (n) {
                if (seen[n]) return;
                seen[n] = 1;
                uses[n] = (uses[n] || 0) + 1;
            });
        });
        var blocks = [];
        ways.forEach(function (w) {
            var start = 0, last = w.nodes.length - 1;
            for (var i = 1; i <= last; i++) {
                if (i === last || uses[w.nodes[i]] > 1) {
                    var g = w.g.slice(start, i + 1);
                    blocks.push({ id: w.id + ":" + w.nodes[start] + ":" + w.nodes[i], n: w.n, g: g, bb: bboxOf(g) });
                    start = i;
                }
            }
        });
        return blocks;
    }

    /* ---------- Driving order: direction arrows, start and end ---------- */
    /* The Lytx trail is in time order, so it shows which way each highlighted block was driven.
       Every trail point within NEAR_M of a block (away from its ends, where cross streets meet)
       votes by comparing the truck's heading (or, without one, the line to its neighbors) with
       the block's own direction; a block driven both ways gets a double arrow. The earliest vote
       is when the block was first driven (t), which orders the route for navigation later.
       Arrows mode sets a direction by hand (dm), which wins over the trail's (d). */

    var NEAR_M = 20, END_M = 12, AGREE = 0.64; // cos 50°
    var DEFAULT_SHOW = { markers: true, arrows: false };

    // Flat meters around a latitude: plenty accurate across one route
    function localXY(lat0) {
        var kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
        return function (p) { return [p[1] * kx, p[0] * ky]; };
    }

    function travelVectors(trail, P) {
        return trail.map(function (p, i) {
            if (p.length > 4 && p[4] >= 0 && p[2] > 2) {
                var a = p[4] * Math.PI / 180;
                return [Math.sin(a), Math.cos(a)];
            }
            var a0 = P[Math.max(0, i - 1)], b0 = P[Math.min(P.length - 1, i + 1)];
            var dx = b0[0] - a0[0], dy = b0[1] - a0[1], len = Math.hypot(dx, dy);
            return len > 3 ? [dx / len, dy / len] : null;
        });
    }

    function lengths(G) {
        var cum = [0];
        for (var i = 1; i < G.length; i++) cum.push(cum[i - 1] + Math.hypot(G[i][0] - G[i - 1][0], G[i][1] - G[i - 1][1]));
        return cum;
    }

    // Sets d (1 along the block's points, -1 against, 2 both) and t on every highlighted block.
    // Blocks are replaced, not changed, so undo snapshots keep their own copies.
    // At 30 seconds apart, the trail's points miss short blocks. Between two slow points close
    // enough that the truck likely stayed on one street, points every DENSE_M along the line
    // between them carry that line's direction (time spread evenly between the two).
    var DENSE_M = 10, DENSE_MAX_M = 120;
    function densify(trail, P, V) {
        var outP = [], outV = [], outT = [];
        for (var i = 0; i < trail.length; i++) {
            outP.push(P[i]); outV.push(V[i]); outT.push(trail[i][3]);
            if (i === trail.length - 1 || trail[i][2] > SLOW_MPH || trail[i + 1][2] > SLOW_MPH) continue;
            var a = P[i], b = P[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
            if (len < 2 * DENSE_M || len > DENSE_MAX_M) continue;
            var v = [dx / len, dy / len], n = Math.floor(len / DENSE_M);
            for (var k = 1; k < n; k++) {
                outP.push([a[0] + dx * k / n, a[1] + dy * k / n]);
                outV.push(v);
                outT.push(trail[i][3] + (trail[i + 1][3] - trail[i][3]) * k / n);
            }
        }
        return { P: outP, V: outV, T: outT };
    }

    function computeDirections(draft) {
        var trail = draft.trail || [];
        var ids = Object.keys(draft.blocks);
        if (trail.length < 3 || !ids.length) return;
        var xy = localXY(trail[0][0]);
        var dense = densify(trail, trail.map(xy), travelVectors(trail, trail.map(xy)));
        var P = dense.P, V = dense.V, T = dense.T;
        ids.forEach(function (id) {
            var b = draft.blocks[id], G = b.g.map(xy), cum = lengths(G), len = cum[cum.length - 1];
            var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            G.forEach(function (q) {
                minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]);
                minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]);
            });
            var plus = 0, minus = 0, first = null;
            for (var k = 0; k < P.length; k++) {
                var p = P[k], v = V[k];
                if (!v || p[0] < minX - NEAR_M || p[0] > maxX + NEAR_M || p[1] < minY - NEAR_M || p[1] > maxY + NEAR_M) continue;
                var best = Infinity, along = 0, seg = 0;
                for (var j = 1; j < G.length; j++) {
                    var ax = G[j - 1][0], ay = G[j - 1][1], dx = G[j][0] - ax, dy = G[j][1] - ay, l2 = dx * dx + dy * dy;
                    var t = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
                    var d = Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1]);
                    if (d < best) { best = d; along = cum[j - 1] + t * Math.sqrt(l2); seg = j; }
                }
                if (best > NEAR_M || !seg) continue;
                if (len > 3 * END_M && (along < END_M || along > len - END_M)) continue;
                var sx = G[seg][0] - G[seg - 1][0], sy = G[seg][1] - G[seg - 1][1], sl = Math.hypot(sx, sy);
                if (!sl) continue;
                var dot = (v[0] * sx + v[1] * sy) / sl;
                if (dot > AGREE) plus++;
                else if (dot < -AGREE) minus++;
                else continue;
                if (first === null) first = Math.round(T[k]);
            }
            var dir = 0;
            if (plus && minus) dir = plus >= 3 * minus ? 1 : minus >= 3 * plus ? -1 : 2;
            else if (plus) dir = 1;
            else if (minus) dir = -1;
            var nb = Object.assign({}, b);
            if (dir) nb.d = dir; else delete nb.d;
            if (first !== null) nb.t = first; else delete nb.t;
            draft.blocks[id] = nb;
        });
    }

    function directionOf(b) {
        return b.dm != null ? b.dm : (b.d || 0);
    }

    // The nearest point on a highlighted block within maxM meters of pt, or null
    function snapToBlocks(draft, pt, maxM) {
        var xy = localXY(pt[0]), p = xy(pt), best = null, bestD = maxM;
        Object.keys(draft.blocks).forEach(function (id) {
            var g = draft.blocks[id].g;
            for (var j = 1; j < g.length; j++) {
                var a = xy(g[j - 1]), b = xy(g[j]), dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
                var t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
                var d = Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
                if (d < bestD) {
                    bestD = d;
                    best = [round5(g[j - 1][0] + t * (g[j][0] - g[j - 1][0])), round5(g[j - 1][1] + t * (g[j][1] - g[j - 1][1]))];
                }
            }
        });
        return best;
    }

    // Start: where the trail first reaches a highlighted street at collection speed; end: where it
    // last leaves one. Without a trail, the first and last driven blocks (or any) stand in.
    function autoEnds(draft) {
        var ids = Object.keys(draft.blocks);
        if (!ids.length && !draft.strokes.length) { draft.start = draft.end = null; return; }
        var trail = (draft.trail || []).filter(function (p) { return p[2] <= SLOW_MPH; });
        var start = null, end = null, i;
        for (i = 0; i < trail.length && !start; i++) start = snapToBlocks(draft, trail[i], 40);
        for (i = trail.length - 1; i >= 0 && !end; i--) end = snapToBlocks(draft, trail[i], 40);
        if (!start || !end) {
            var order = ids.map(function (id) { return draft.blocks[id]; }).sort(function (a, b) {
                return (a.t != null ? a.t : Infinity) - (b.t != null ? b.t : Infinity);
            });
            var lines = order.map(function (b) { return b.g; }).concat(draft.strokes.map(function (s) { return s.g; }));
            start = start || lines[0][0];
            end = end || lines[lines.length - 1][lines[lines.length - 1].length - 1];
        }
        draft.start = start;
        draft.end = end;
    }

    // Meters per pixel at a zoom level, at a latitude (web map tiles)
    function metersPerPixel(z, lat) {
        return 156543.03 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
    }

    // Where a block's arrows go: about every `spacing` meters (one at least), each turned to the
    // direction of travel (degrees clockwise from north, which is straight up on the north-up map)
    function arrowSpots(g, dir, spacing) {
        var xy = localXY(g[0][0]), G = g.map(xy), cum = lengths(G), len = cum[cum.length - 1];
        if (!len) return [];
        var n = Math.max(1, Math.round(len / (spacing || 140))), spots = [];
        for (var k = 0; k < n; k++) {
            var target = len * (k + 0.5) / n, j = 1;
            while (j < G.length - 1 && cum[j] < target) j++;
            var segLen = cum[j] - cum[j - 1] || 1, f = (target - cum[j - 1]) / segLen;
            var lat = g[j - 1][0] + f * (g[j][0] - g[j - 1][0]), lng = g[j - 1][1] + f * (g[j][1] - g[j - 1][1]);
            var deg = Math.atan2(G[j][0] - G[j - 1][0], G[j][1] - G[j - 1][1]) * 180 / Math.PI;
            spots.push({ ll: [lat, lng], deg: dir === -1 ? deg + 180 : deg, both: dir === 2 });
        }
        return spots;
    }

    /* ---------- Map ---------- */

    var dialog = document.getElementById("mlv-editor");
    var titleEl = document.getElementById("mlv-title");
    var statusEl = document.getElementById("mlv-status");
    var mapEl = document.getElementById("mlv-map");
    var editTools = document.getElementById("mlv-edit-tools");
    var viewTools = document.getElementById("mlv-view-tools");
    var moreEl = document.getElementById("mlv-more");
    var moreBtn = document.getElementById("mlv-more-btn");
    var trailBtn = document.getElementById("mlv-trail");
    var undoBtn = document.getElementById("mlv-undo");
    var redoBtn = document.getElementById("mlv-redo");
    var legendRow = document.getElementById("mlv-legend-row");
    var legendLabel = document.getElementById("mlv-legend-label");
    var legendInput = document.getElementById("mlv-legend-input");

    var map = null, hlRenderer = null, trailRenderer = null;
    var trailGroup = null, strokeGroup = null, liveStroke = null;
    var arrowGroup = null, endsGroup = null;
    var blockLayers = {};

    function say(text) {
        statusEl.textContent = text || "";
    }

    function setupMap() {
        if (map) return;
        map = L.map(mapEl, {
            zoomControl: false, doubleClickZoom: false, boxZoom: false,
            zoomSnap: 0.5, wheelPxPerZoomLevel: 90, maxZoom: 19
        });
        L.control.zoom({ position: "topright" }).addTo(map);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
        }).addTo(map);
        // The highlighter: drawn opaque on a pane shown multiplied at partial strength, so streets
        // and their names show through and overlapping highlights don't darken
        // The trail is a guide for highlighting, so it's drawn over the highlighter (whose
        // multiply blend would otherwise tint it out of sight on highlighted streets)
        map.createPane("mlvTrail").style.zIndex = 430;
        var hl = map.createPane("mlvHighlight");
        hl.style.zIndex = 420;
        hl.style.mixBlendMode = "multiply";
        hl.style.opacity = "0.6";
        trailRenderer = L.canvas({ pane: "mlvTrail" });
        hlRenderer = L.canvas({ pane: "mlvHighlight", padding: 0.5 });
        trailGroup = L.layerGroup();
        strokeGroup = L.layerGroup().addTo(map);
        arrowGroup = L.layerGroup().addTo(map);
        endsGroup = L.layerGroup().addTo(map);
        // Moving the map by hand while navigating stops it following the truck
        map.on("dragstart", function () { if (nav && nav.follow) setFollow(false); });
        // Arrows are spaced on screen, so zooming re-spaces them
        map.on("zoomend", function () {
            if (ed && ((ed.draft.show || {}).arrows || (ed.editing && ed.mode === "arrows"))) syncExtras();
        });
        wirePointer();
    }

    function lineStyle(c) {
        return { renderer: hlRenderer, color: COLORS[c] || COLORS.y, weight: LINE_PX, opacity: 1, lineCap: "round", lineJoin: "round", interactive: false };
    }

    /* ---------- Editor state ---------- */

    var ed = null;
    var openToken = 0;
    var saveTimer = null;
    var pushedHistory = false;

    function syncBlocks() {
        var want = ed.draft.blocks;
        Object.keys(blockLayers).forEach(function (id) {
            if (!want[id]) {
                map.removeLayer(blockLayers[id].layer);
                delete blockLayers[id];
            }
        });
        Object.keys(want).forEach(function (id) {
            var b = want[id], have = blockLayers[id];
            if (have && have.c === b.c) return;
            if (have) {
                have.layer.setStyle({ color: COLORS[b.c] });
                have.c = b.c;
                return;
            }
            blockLayers[id] = { c: b.c, bb: bboxOf(b.g), layer: L.polyline(b.g, lineStyle(b.c)).addTo(map) };
        });
    }

    function syncStrokes() {
        strokeGroup.clearLayers();
        ed.draft.strokes.forEach(function (s) {
            strokeGroup.addLayer(s.g.length > 1 ? L.polyline(s.g, lineStyle(s.c))
                : L.circleMarker(s.g[0], { renderer: hlRenderer, radius: LINE_PX / 2, stroke: false, fillColor: COLORS[s.c], fillOpacity: 1, interactive: false }));
        });
    }

    // Direction arrows (when shown, and always in Arrows mode) and the Start / End pins, which
    // can be dragged while editing
    var ARROW_SVG = '<svg viewBox="-10 -10 20 20" width="20" height="20" aria-hidden="true"><path d="M0-8L7 6 0 2-7 6Z"/></svg>';
    var BOTH_SVG = '<svg viewBox="-10 -12 20 24" width="20" height="24" aria-hidden="true"><path d="M0-11L6-1 0-4-6-1ZM0 11L6 1 0 4-6 1Z"/></svg>';

    function syncExtras() {
        if (!ed) return;
        arrowGroup.clearLayers();
        endsGroup.clearLayers();
        var show = ed.draft.show || {};
        if (show.arrows || (ed.editing && ed.mode === "arrows")) {
            var spacing = 110 * metersPerPixel(map.getZoom(), map.getCenter().lat);
            Object.keys(ed.draft.blocks).forEach(function (id) {
                var b = ed.draft.blocks[id], dir = directionOf(b);
                if (!dir) return;
                arrowSpots(b.g, dir, spacing).forEach(function (spot) {
                    arrowGroup.addLayer(L.marker(spot.ll, {
                        interactive: false, keyboard: false,
                        icon: L.divIcon({
                            className: "mlv-arrow" + (b.dm != null ? " is-manual" : ""),
                            html: '<span style="transform: rotate(' + spot.deg.toFixed(1) + 'deg)">' + (spot.both ? BOTH_SVG : ARROW_SVG) + "</span>",
                            iconSize: [24, 24], iconAnchor: [12, 12]
                        })
                    }));
                });
            });
        }
        if (show.markers) {
            [["start", "Start"], ["end", "End"]].forEach(function (pair) {
                var at = ed.draft[pair[0]];
                if (!at) return;
                var m = L.marker(at, {
                    draggable: ed.editing, keyboard: false, interactive: ed.editing,
                    title: ed.editing ? "Drag to move the " + pair[1].toLowerCase() : pair[1],
                    icon: L.divIcon({ className: "mlv-end mlv-end-" + pair[0], html: "<span>" + pair[1] + "</span>", iconSize: [60, 28], iconAnchor: [30, 14] })
                });
                m.on("dragend", function () {
                    var ll = m.getLatLng();
                    ed.undo.push(snapshot());
                    ed.redo = [];
                    ed.draft[pair[0]] = [round5(ll.lat), round5(ll.lng)];
                    ed.draft.endsAuto = false;
                    changed();
                });
                endsGroup.addLayer(m);
            });
        }
        syncMenu();
    }

    function syncMenu() {
        var show = ed.draft.show || {};
        dialog.querySelectorAll('[data-more="markers"]').forEach(function (b) { b.textContent = "Start/End Pins: " + (show.markers ? "On" : "Off"); });
        dialog.querySelectorAll('[data-more="arrows"]').forEach(function (b) { b.textContent = "Direction Arrows: " + (show.arrows ? "On" : "Off"); });
        dialog.querySelectorAll('[data-more="ends"]').forEach(function (b) { b.hidden = !show.markers; });
    }

    // After the highlights change: directions from the trail, and auto-placed ends kept current
    function refreshOrder() {
        if ((ed.draft.trail || []).length) computeDirections(ed.draft);
        var show = ed.draft.show || {};
        if (show.markers && (ed.draft.endsAuto !== false || !ed.draft.start)) autoEnds(ed.draft);
    }

    function clearLayers() {
        Object.keys(blockLayers).forEach(function (id) { map.removeLayer(blockLayers[id].layer); });
        blockLayers = {};
        strokeGroup.clearLayers();
        trailGroup.clearLayers();
        arrowGroup.clearLayers();
        endsGroup.clearLayers();
        if (liveStroke) { map.removeLayer(liveStroke); liveStroke = null; }
    }

    // Purple with a white outline: unlike the highlighters (yellow, blue, green) and OSM's red
    // and orange main roads, it stands out on every part of the map. Faster driving is dashed.
    var TRAIL_COLOR = "#7E22CE";

    function drawTrail() {
        trailGroup.clearLayers();
        var t = ed.draft.trail || [];
        if (t.length < 2) return;
        var run = [t[0]], fast = t[1][2] > SLOW_MPH;
        function flush() {
            if (run.length < 2) return;
            var line = run.map(function (p) { return [p[0], p[1]]; });
            trailGroup.addLayer(L.polyline(line, { renderer: trailRenderer, color: "#FFFFFF", weight: fast ? 4 : 5, opacity: 0.85,
                dashArray: fast ? "7 7" : null, lineCap: "round", lineJoin: "round", interactive: false }));
            trailGroup.addLayer(L.polyline(line, { renderer: trailRenderer, color: TRAIL_COLOR, weight: fast ? 2 : 2.5, opacity: fast ? 0.7 : 0.9,
                dashArray: fast ? "7 7" : null, lineCap: "round", lineJoin: "round", interactive: false }));
        }
        for (var i = 1; i < t.length; i++) {
            var f = t[i][2] > SLOW_MPH;
            if (f !== fast) {
                run.push(t[i]);
                flush();
                run = [t[i]];
                fast = f;
            } else {
                run.push(t[i]);
            }
        }
        flush();
        t.forEach(function (p) {
            if (p[2] <= SLOW_MPH) {
                trailGroup.addLayer(L.circleMarker([p[0], p[1]], { renderer: trailRenderer, radius: 2.5, color: "#FFFFFF", weight: 1.5, opacity: 0.9,
                    fillColor: TRAIL_COLOR, fillOpacity: 1, interactive: false }));
            }
        });
    }

    function showTrail(on) {
        ed.showTrail = on && (ed.draft.trail || []).length > 1;
        trailBtn.setAttribute("aria-pressed", String(ed.showTrail));
        trailBtn.disabled = !(ed.draft.trail || []).length;
        if (ed.showTrail) trailGroup.addTo(map);
        else map.removeLayer(trailGroup);
    }

    function fitRoute() {
        var pts = [];
        Object.keys(ed.draft.blocks).forEach(function (id) { pts = pts.concat(ed.draft.blocks[id].g); });
        ed.draft.strokes.forEach(function (s) { pts = pts.concat(s.g); });
        if (!pts.length) pts = (ed.draft.trail || []).filter(function (p) { return p[2] <= SLOW_MPH; });
        if (!pts.length) pts = ed.draft.trail || [];
        if (pts.length) map.fitBounds(L.latLngBounds(pts.map(function (p) { return [p[0], p[1]]; })), { padding: [24, 24] });
        else map.setView([40.17, -80.25], 13);
    }

    /* ---------- Opening a route ---------- */

    function open(route, options) {
        options = options || {};
        stopNav();
        var token = ++openToken;
        setupMap();
        if (!dialog.open) {
            dialog.showModal();
            history.pushState({ mapLive: true }, "");
            pushedHistory = true;
        }
        map.invalidateSize();
        if (ed) clearLayers();
        ed = null;
        titleEl.textContent = title(route, "");
        say("Loading…");
        editTools.hidden = viewTools.hidden = true;
        legendRow.hidden = true;
        moreEl.hidden = true;

        return current(route).then(function (state) {
            if (token !== openToken || !dialog.open) return;
            var source = state.draft || (state.lib ? fromFile(state.lib) : null);
            if (!source) {
                say("This route has no map yet.");
                return;
            }
            ed = {
                route: source.route || route, state: state,
                draft: JSON.parse(JSON.stringify(source)),
                editing: false, mode: "blocks", color: "y", showTrail: true,
                blocks: null, streetsPromise: null, undo: [], redo: [], action: null
            };
            ed.draft.blocks = ed.draft.blocks || {};
            ed.draft.strokes = ed.draft.strokes || [];
            ed.draft.legend = ed.draft.legend || { b: "", g: "" };
            ed.draft.show = ed.draft.show || { markers: false, arrows: false };
            if (ed.draft.show.markers && !ed.draft.start) autoEnds(ed.draft);
            titleEl.textContent = title(ed.route, ed.draft.label);
            syncBlocks();
            syncStrokes();
            syncExtras();
            drawTrail();
            map.invalidateSize();
            fitRoute();
            if (state.draft || options.edit) startEditing();
            else setView();
        });
    }

    function setView() {
        ed.editing = false;
        editTools.hidden = true;
        viewTools.hidden = false;
        legendRow.hidden = true;
        map.dragging.enable();
        showTrail(false);
        syncExtras();
        say(statusText({ lib: ed.state.lib, draft: null }));
        requestAnimationFrame(function () { map.invalidateSize(); });
    }

    function startEditing() {
        ed.editing = true;
        viewTools.hidden = true;
        editTools.hidden = false;
        setMode(ed.mode);
        // The trail guides the first highlighting; once streets are highlighted it starts hidden.
        // The Trail button's choice holds for the rest of the session.
        var highlighted = Object.keys(ed.draft.blocks).length > 0 || ed.draft.strokes.length > 0;
        showTrail(ed.trailChoice != null ? ed.trailChoice : !highlighted);
        refreshStatus();
        loadStreets();
        requestAnimationFrame(function () { map.invalidateSize(); });
    }

    function refreshStatus() {
        if (!ed) return;
        var libUpdated = (ed.state.lib || {}).updated || 0;
        var draft = ed.draft.updated > libUpdated ? ed.draft : ed.state.draft;
        var text = statusText({ lib: ed.state.lib, draft: draft });
        if (ed.streetsState) text += " · " + ed.streetsState;
        say(text);
    }

    function streetsNote(text) {
        ed.streetsState = text;
        refreshStatus();
    }

    function loadStreets() {
        if (ed.streetsPromise) return ed.streetsPromise;
        var route = ed.route, token = openToken;
        ed.streetsPromise = cachedWays(route).then(function (ways) {
            if (ways && ways.length) return ways;
            var pts = (ed.draft.trail || []).filter(function (p) { return p[2] <= SLOW_MPH; });
            if (pts.length < 2) pts = ed.draft.trail || [];
            if (!pts.length) {
                Object.keys(ed.draft.blocks).forEach(function (id) { pts = pts.concat(ed.draft.blocks[id].g); });
                ed.draft.strokes.forEach(function (s) { pts = pts.concat(s.g); });
            }
            if (!pts.length) return [];
            streetsNote("Downloading streets, this can take up to a minute…");
            return overpass(cellsQuery(pts)).then(function (json) {
                var w = compactWays(json);
                cacheWays(route, w);
                return w;
            });
        }).then(function (ways) {
            if (token !== openToken || !ed) return;
            ed.ways = {};
            ways.forEach(function (w) { ed.ways[w.id] = w; });
            ed.blocks = buildBlocks(ways);
            streetsNote(ed.blocks.length ? "" : "No streets loaded yet. Use ⋯ → Load Streets Here.");
        }).catch(function (err) {
            console.error(err);
            if (token !== openToken || !ed) return;
            ed.streetsPromise = null;
            streetsNote("Streets couldn't be downloaded. Check the signal, then use ⋯ → Load Streets Here.");
        });
        return ed.streetsPromise;
    }

    function loadStreetsHere() {
        if (!ed) return;
        if (map.getZoom() < 15) {
            say("Zoom in closer first, so only the streets in this area download.");
            return;
        }
        var route = ed.route, token = openToken;
        streetsNote("Downloading the streets in view…");
        overpass(boundsQuery(map.getBounds())).then(function (json) {
            if (token !== openToken || !ed) return;
            ed.ways = ed.ways || {};
            compactWays(json).forEach(function (w) { ed.ways[w.id] = w; });
            var ways = Object.keys(ed.ways).map(function (id) { return ed.ways[id]; });
            ed.blocks = buildBlocks(ways);
            ed.streetsPromise = Promise.resolve();
            cacheWays(route, ways);
            streetsNote("");
        }).catch(function (err) {
            console.error(err);
            if (token === openToken && ed) streetsNote("Streets couldn't be downloaded. Check the signal and try again.");
        });
    }

    /* ---------- Tools ---------- */

    function setMode(mode) {
        ed.mode = mode;
        dialog.querySelectorAll("[data-mode]").forEach(function (b) {
            b.setAttribute("aria-pressed", String(b.getAttribute("data-mode") === mode));
        });
        if (mode === "move") map.dragging.enable();
        else map.dragging.disable();
        mapEl.classList.toggle("is-drawing", mode !== "move");
        syncColor();
        syncExtras();
        if (mode === "arrows") say("Tap a highlighted block to change its arrow: one way, the other way, both ways, none.");
    }

    function syncColor() {
        dialog.querySelectorAll("[data-color]").forEach(function (b) {
            b.setAttribute("aria-pressed", String(b.getAttribute("data-color") === ed.color));
        });
        var labelled = ed.color === "b" || ed.color === "g";
        legendRow.hidden = !(ed.editing && labelled);
        if (labelled) {
            legendLabel.textContent = COLOR_NAMES[ed.color] + " means";
            legendInput.value = ed.draft.legend[ed.color] || "";
        }
        undoBtn.disabled = !ed.undo.length;
        redoBtn.disabled = !ed.redo.length;
    }

    function snapshot() {
        return {
            blocks: Object.assign({}, ed.draft.blocks), strokes: ed.draft.strokes.slice(),
            start: ed.draft.start, end: ed.draft.end, endsAuto: ed.draft.endsAuto,
            show: Object.assign({}, ed.draft.show)
        };
    }

    function restore(s) {
        ed.draft.blocks = Object.assign({}, s.blocks);
        ed.draft.strokes = s.strokes.slice();
        ed.draft.start = s.start;
        ed.draft.end = s.end;
        ed.draft.endsAuto = s.endsAuto;
        ed.draft.show = Object.assign({}, s.show);
        syncBlocks();
        syncStrokes();
        syncExtras();
    }

    function changed() {
        refreshOrder();
        syncExtras();
        ed.draft.updated = Date.now();
        delete ed.draft.published;
        clearTimeout(saveTimer);
        var route = ed.route, draft = ed.draft;
        saveTimer = setTimeout(function () { saveTimer = null; saveDraft(route, draft); }, 400);
        refreshStatus();
        syncColor();
    }

    function flushSave() {
        if (saveTimer && ed) {
            clearTimeout(saveTimer);
            saveTimer = null;
            saveDraft(ed.route, ed.draft);
        }
    }

    function undoRedo(from, to) {
        if (!ed || !from.length) return;
        to.push(snapshot());
        restore(from.pop());
        changed();
    }

    // The nearest of `items` (each { g, bb }) within px of the point, or null
    function nearest(items, latlng, px) {
        var cp = map.latLngToContainerPoint(latlng);
        var corner = map.containerPointToLatLng([cp.x + px, cp.y + px]);
        var dLat = Math.abs(corner.lat - latlng.lat), dLng = Math.abs(corner.lng - latlng.lng);
        var best = null, bestD = px;
        items.forEach(function (it) {
            var bb = it.bb;
            if (latlng.lat < bb[0] - dLat || latlng.lat > bb[2] + dLat || latlng.lng < bb[1] - dLng || latlng.lng > bb[3] + dLng) return;
            var prev = map.latLngToContainerPoint(it.g[0]);
            for (var i = 1; i < it.g.length; i++) {
                var next = map.latLngToContainerPoint(it.g[i]);
                var d = distToSegment(cp.x, cp.y, prev.x, prev.y, next.x, next.y);
                if (d < bestD) { bestD = d; best = it; }
                prev = next;
            }
        });
        return best;
    }

    function highlightedItems() {
        return Object.keys(ed.draft.blocks).map(function (id) {
            var have = blockLayers[id];
            return { id: id, g: ed.draft.blocks[id].g, bb: have ? have.bb : bboxOf(ed.draft.blocks[id].g) };
        });
    }

    // Blocks mode at one point. A highlighted block wins over the street under it, so a highlight
    // made from differently cut streets can still be cleared or recolored.
    function blocksAt(latlng, first) {
        var hit = nearest(highlightedItems(), latlng, HIT_PX);
        if (hit) {
            var b = ed.draft.blocks[hit.id];
            if (b.c === ed.color) {
                if (first) ed.action.clearOnTap = hit.id;
                return;
            }
            if (ed.action.touched[hit.id]) return;
            ed.draft.blocks[hit.id] = Object.assign({}, b, { c: ed.color });
            ed.action.touched[hit.id] = true;
            ed.action.changed = true;
            syncBlocks();
            return;
        }
        if (!ed.blocks) {
            if (first) say(ed.streetsPromise ? "Streets are still downloading…" : "No streets loaded here. Use ⋯ → Load Streets Here.");
            return;
        }
        var street = nearest(ed.blocks, latlng, HIT_PX);
        if (!street || ed.draft.blocks[street.id]) return;
        ed.draft.blocks[street.id] = { c: ed.color, n: street.n, g: street.g };
        ed.action.touched[street.id] = true;
        ed.action.changed = true;
        syncBlocks();
    }

    // Erase at one point: highlighted blocks it touches, and the touched part of freehand lines
    function eraseAt(latlng) {
        var hit;
        while ((hit = nearest(highlightedItems(), latlng, ERASE_PX))) {
            delete ed.draft.blocks[hit.id];
            ed.action.changed = true;
            syncBlocks();
        }
        var cp = map.latLngToContainerPoint(latlng);
        var out = [], cut = false;
        ed.draft.strokes.forEach(function (s) {
            var piece = [];
            s.g.forEach(function (p) {
                var q = map.latLngToContainerPoint(p);
                if (Math.hypot(q.x - cp.x, q.y - cp.y) <= ERASE_PX) {
                    cut = true;
                    if (piece.length > 1) out.push({ c: s.c, g: piece });
                    piece = [];
                } else {
                    piece.push(p);
                }
            });
            if (piece.length > 1 || (piece.length === 1 && s.g.length === 1)) out.push({ c: s.c, g: piece });
        });
        if (cut) {
            ed.draft.strokes = out;
            ed.action.changed = true;
            syncStrokes();
        }
    }

    // Arrows mode: one way, the other way, both ways, none, then back around (set by hand)
    var NEXT_DIR = { "1": -1, "-1": 2, "2": 0, "0": 1 };
    function arrowAt(latlng) {
        var hit = nearest(highlightedItems(), latlng, HIT_PX);
        if (!hit) return;
        var b = ed.draft.blocks[hit.id];
        ed.draft.blocks[hit.id] = Object.assign({}, b, { dm: NEXT_DIR[String(directionOf(b))] });
        ed.action.changed = true;
        syncExtras();
    }

    function wirePointer() {
        var pointers = {};

        function count() { return Object.keys(pointers).length; }

        function begin(e) {
            ed.action = { id: e.pointerId, before: snapshot(), touched: {}, changed: false, clearOnTap: null, moved: false, sx: e.clientX, sy: e.clientY };
            var ll = map.mouseEventToLatLng(e);
            if (ed.mode === "blocks") blocksAt(ll, true);
            else if (ed.mode === "arrows") arrowAt(ll);
            else if (ed.mode === "erase") eraseAt(ll);
            else if (ed.mode === "draw") {
                ed.action.stroke = { c: ed.color, g: [[round5(ll.lat), round5(ll.lng)]] };
                ed.action.last = { x: e.clientX, y: e.clientY };
                liveStroke = L.polyline([ll, ll], lineStyle(ed.color)).addTo(map);
            }
        }

        function cancel() {
            if (!ed || !ed.action) return;
            if (liveStroke) { map.removeLayer(liveStroke); liveStroke = null; }
            if (ed.action.changed) restore(ed.action.before);
            ed.action = null;
        }

        function finish() {
            var a = ed.action;
            ed.action = null;
            if (liveStroke) { map.removeLayer(liveStroke); liveStroke = null; }
            if (a.stroke) {
                ed.draft.strokes.push(a.stroke);
                a.changed = true;
                syncStrokes();
            }
            // A tap on a block already in this color clears it; a drag across it doesn't
            if (a.clearOnTap && !a.moved && !Object.keys(a.touched).length) {
                delete ed.draft.blocks[a.clearOnTap];
                a.changed = true;
                syncBlocks();
            }
            if (a.changed) {
                ed.undo.push(a.before);
                if (ed.undo.length > 100) ed.undo.shift();
                ed.redo = [];
                changed();
            }
        }

        mapEl.addEventListener("pointerdown", function (e) {
            pointers[e.pointerId] = true;
            if (!ed || !ed.editing || ed.mode === "move") return;
            if (e.target.closest && e.target.closest(".leaflet-control, .leaflet-marker-icon.leaflet-interactive")) return;
            if (count() > 1) { cancel(); return; }
            if (e.pointerType === "mouse" && e.button !== 0) return;
            begin(e);
        }, true);

        mapEl.addEventListener("pointermove", function (e) {
            if (!ed || !ed.action || ed.action.id !== e.pointerId || count() > 1) return;
            var a = ed.action;
            if (Math.hypot(e.clientX - a.sx, e.clientY - a.sy) > 8) a.moved = true;
            var events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
            if (!events.length) events = [e];
            events.forEach(function (ce) {
                var ll = map.mouseEventToLatLng(ce);
                if (ed.mode === "blocks") {
                    if (a.moved) blocksAt(ll, false);
                } else if (ed.mode === "erase") {
                    eraseAt(ll);
                } else if (ed.mode === "draw" && a.stroke) {
                    if (Math.hypot(ce.clientX - a.last.x, ce.clientY - a.last.y) < DRAW_STEP_PX) return;
                    a.last = { x: ce.clientX, y: ce.clientY };
                    a.stroke.g.push([round5(ll.lat), round5(ll.lng)]);
                    liveStroke.addLatLng(ll);
                }
            });
        });

        function up(e) {
            delete pointers[e.pointerId];
            if (!ed || !ed.action || ed.action.id !== e.pointerId) return;
            if (e.type === "pointercancel") cancel();
            else finish();
        }
        mapEl.addEventListener("pointerup", up, true);
        mapEl.addEventListener("pointercancel", up, true);
    }

    /* ---------- Toolbar ---------- */

    dialog.querySelectorAll("[data-mode]").forEach(function (b) {
        b.addEventListener("click", function () { if (ed) setMode(b.getAttribute("data-mode")); });
    });

    dialog.querySelectorAll("[data-color]").forEach(function (b) {
        b.addEventListener("click", function () {
            if (!ed) return;
            ed.color = b.getAttribute("data-color");
            if (ed.mode === "erase" || ed.mode === "move") setMode("blocks");
            else syncColor();
        });
    });

    undoBtn.addEventListener("click", function () { if (ed) undoRedo(ed.undo, ed.redo); });
    redoBtn.addEventListener("click", function () { if (ed) undoRedo(ed.redo, ed.undo); });
    trailBtn.addEventListener("click", function () {
        if (!ed) return;
        showTrail(!ed.showTrail);
        ed.trailChoice = ed.showTrail;
    });
    document.getElementById("mlv-edit").addEventListener("click", function () { if (ed) startEditing(); });

    legendInput.addEventListener("input", function () {
        if (!ed || (ed.color !== "b" && ed.color !== "g")) return;
        ed.draft.legend[ed.color] = legendInput.value.trim();
        changed();
    });

    function toggleMore(show) {
        moreEl.hidden = !show;
        moreBtn.setAttribute("aria-expanded", String(show));
    }
    moreBtn.addEventListener("click", function () { toggleMore(moreEl.hidden); });

    dialog.querySelectorAll("[data-more]").forEach(function (b) {
        b.addEventListener("click", function () {
            toggleMore(false);
            if (!ed) return;
            var what = b.getAttribute("data-more");
            if (what === "fit") fitRoute();
            else if (what === "streets") loadStreetsHere();
            else if (what === "reimport") { importFor = ed.route; fileInput.click(); }
            else if (what === "publish") openPublish();
            else if (what === "print") printRoute(ed.route, b);
            else if (what === "navigate") startNav();
            else if (what === "markers" || what === "arrows") {
                ed.undo.push(snapshot());
                ed.redo = [];
                ed.draft.show[what] = !ed.draft.show[what];
                if (what === "markers" && ed.draft.show.markers && !ed.draft.start) ed.draft.endsAuto = true;
                changed();
            } else if (what === "ends") {
                ed.undo.push(snapshot());
                ed.redo = [];
                ed.draft.endsAuto = true;
                changed();
            }
        });
    });

    dialog.addEventListener("keydown", function (e) {
        if (!ed || !ed.editing || !(e.ctrlKey || e.metaKey) || e.target === legendInput) return;
        var k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) undoRedo(ed.undo, ed.redo);
        else if (k === "y" || (k === "z" && e.shiftKey)) undoRedo(ed.redo, ed.undo);
        else return;
        e.preventDefault();
    });

    /* ---------- Close ---------- */

    document.getElementById("mlv-close").addEventListener("click", function () { if (dialog.open) dialog.close(); });

    dialog.addEventListener("close", function () {
        stopNav();
        openToken++;
        flushSave();
        if (ed && map) clearLayers();
        ed = null;
        toggleMore(false);
        if (pushedHistory) {
            pushedHistory = false;
            history.back();
        }
        renderList();
    });

    window.addEventListener("popstate", function () {
        if (pushedHistory && dialog.open) {
            pushedHistory = false;
            dialog.close();
        }
    });

    window.addEventListener("resize", function () { if (map && dialog.open) map.invalidateSize(); });

    /* ---------- Import ---------- */

    var importDialogEl = document.getElementById("mlv-import-dialog");
    var importDialog = window.TrackerDialog ? TrackerDialog(importDialogEl, {}) : null;
    var importRoute = document.getElementById("mlv-import-route");
    var importLabel = document.getElementById("mlv-import-label");
    var importSummary = document.getElementById("mlv-import-summary");
    var importNote = document.getElementById("mlv-import-note");
    var pendingImport = null;
    var importFor = null; // Replace GPS Trail: the route whose trail is being replaced

    document.getElementById("mlv-import-open").addEventListener("click", function () {
        importFor = null;
        fileInput.click();
    });

    function timeText(d) {
        return d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    }

    fileInput.addEventListener("change", function () {
        var file = fileInput.files[0];
        fileInput.value = "";
        if (!file) return;
        messageEl.textContent = "Reading " + file.name + "…";
        var t, names;
        readRows(file).then(function (rows) {
            t = lytxTrail(rows);
            names = nameFromFile(file.name);
            return current(importFor || names.route);
        }).then(function (state) {
            pendingImport = t;
            importRoute.value = importFor || names.route;
            importRoute.readOnly = !!importFor;
            // A route that already has a map keeps its label unless the file name gives one
            var existing = state.draft || state.lib;
            importLabel.value = names.label || (existing && existing.label) || "";
            importSummary.textContent = t.trail.length + " GPS points" +
                (t.start ? ", " + t.start.toLocaleDateString() + " " + timeText(t.start) + "–" + timeText(t.end) : "") +
                (t.vehicle ? ", truck " + t.vehicle : "") +
                (t.trimmed ? " (yard to yard)" : "") + ".";
            updateImportNote();
            messageEl.textContent = "";
            if (dialog.open) toggleMore(false);
            if (importDialog) importDialog.open();
            else importDialogEl.showModal();
        }).catch(function (err) {
            console.error(err);
            messageEl.textContent = err && err.message ? err.message : "That file couldn't be read.";
            if (dialog.open) say(messageEl.textContent);
        });
    });

    function updateImportNote() {
        var route = importRoute.value.trim();
        var existing = route && (draftFor(route) || lib.findLive(route));
        importNote.textContent = existing ? "Route " + route + " already has a map. This replaces its GPS trail and keeps the highlighted streets." : "";
    }
    importRoute.addEventListener("input", updateImportNote);

    document.getElementById("mlv-import-form").addEventListener("submit", function (e) {
        e.preventDefault();
        var route = importRoute.value.trim().replace(/^route\s+/i, "");
        if (!route || !pendingImport) return;
        var label = importLabel.value.trim();
        var t = pendingImport;
        pendingImport = null;
        if (importDialog) importDialog.close();
        else importDialogEl.close();

        current(route).then(function (state) {
            var base = state.draft || (state.lib ? fromFile(state.lib) : null) ||
                { route: route, label: label, legend: { b: "", g: "" }, blocks: {}, strokes: [] };
            base.route = base.route || route;
            base.label = label;
            base.trail = t.trail;
            base.show = base.show || Object.assign({}, DEFAULT_SHOW);
            if (base.endsAuto !== false) base.endsAuto = true;
            computeDirections(base);
            if (base.show.markers) autoEnds(base);
            base.updated = Date.now();
            delete base.published;
            if (!saveDraft(base.route, base)) return;
            // Streets already downloaded for this route are kept (the download is the slow part);
            // Load Streets Here fills in anywhere the new trail goes that they don't cover
            renderList();
            open(base.route, { edit: true });
        });
    });

    /* ---------- Publish ---------- */

    var publishDialogEl = document.getElementById("mlv-publish-dialog");
    var publishDialog = window.TrackerDialog ? TrackerDialog(publishDialogEl, {}) : null;

    function fileText(d) {
        var blocks = Object.keys(d.blocks).sort().map(function (id) {
            var b = d.blocks[id], out = { id: id, c: b.c, n: b.n || "" };
            if (b.d) out.d = b.d;
            if (b.dm != null) out.dm = b.dm;
            if (b.t != null) out.t = b.t;
            out.g = b.g;
            return "    " + JSON.stringify(out);
        });
        var strokes = d.strokes.map(function (s) { return "    " + JSON.stringify({ c: s.c, g: s.g }); });
        return "{\n" +
            '  "route": ' + JSON.stringify(d.route) + ",\n" +
            '  "label": ' + JSON.stringify(d.label || "") + ",\n" +
            '  "updated": ' + d.updated + ",\n" +
            '  "legend": ' + JSON.stringify({ b: d.legend.b || "", g: d.legend.g || "" }) + ",\n" +
            '  "show": ' + JSON.stringify({ markers: !!(d.show || {}).markers, arrows: !!(d.show || {}).arrows }) + ",\n" +
            '  "start": ' + JSON.stringify(d.start || null) + ",\n" +
            '  "end": ' + JSON.stringify(d.end || null) + ",\n" +
            '  "blocks": [\n' + blocks.join(",\n") + (blocks.length ? "\n" : "") + "  ],\n" +
            '  "strokes": [\n' + strokes.join(",\n") + (strokes.length ? "\n" : "") + "  ]\n}\n";
    }

    function shareFile(file) {
        var top = window;
        try { if (window.top.navigator) top = window.top; } catch (e) { /* not inside the app */ }
        try {
            if (top.navigator.canShare && top.navigator.canShare({ files: [file] })) {
                return top.navigator.share({ files: [file], title: file.name }).catch(function () {});
            }
        } catch (e) { /* fall through to a download */ }
        var url = URL.createObjectURL(file);
        var link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        return Promise.resolve();
    }

    // The app shell's Google Drive upload (drive-backup.js): same sign-in and folder as backups
    function drive() {
        try {
            var d = window.top.DriveBackup;
            return d && d.configured() ? d : null;
        } catch (e) {
            return null;
        }
    }

    var publishStatus = document.getElementById("mlv-publish-status");
    var driveBtn = document.getElementById("mlv-publish-drive");

    var driveChange = document.getElementById("mlv-publish-drive-change");

    // Published maps get their own Drive folder ("maps" slot), apart from the backups
    function paintDrive() {
        var d = drive();
        driveBtn.hidden = !d;
        driveChange.hidden = !(d && d.folder("maps"));
        if (!d) return;
        var folder = d.folder("maps");
        driveBtn.textContent = folder ? "Save to Drive · " + folder.name : "Save to Google Drive";
        d.preload("maps");
    }

    function openPublish() {
        if (!Object.keys(ed.draft.blocks).length && !ed.draft.strokes.length) {
            say("Nothing is highlighted yet.");
            return;
        }
        document.getElementById("mlv-publish-file").textContent = ed.route + ".route.json";
        publishStatus.textContent = "";
        paintDrive();
        if (publishDialog) publishDialog.open();
        else publishDialogEl.showModal();
    }

    // Stamps the draft as published and returns the file to send
    function publishFile() {
        clearTimeout(saveTimer);
        saveTimer = null;
        ed.draft.updated = Date.now();
        var file = new File([fileText(ed.draft)], ed.route + ".route.json", { type: "application/json" });
        ed.draft.published = true;
        saveDraft(ed.route, ed.draft);
        refreshStatus();
        return file;
    }

    function driveError(err) {
        var kind = err && err.kind;
        if (kind === "cancelled") return "No folder picked, so nothing was saved.";
        if (kind === "loading") return "Still connecting to Google. Tap again in a moment.";
        if (kind === "signin") return "Google sign-in didn’t finish. Tap Save to Drive to try again.";
        if (kind === "expired") return "The Google sign-in ran out. Tap Save to Drive again.";
        if (kind === "folder") return "That Drive folder can’t be found anymore. Tap Save to Drive to pick it again.";
        return navigator.onLine === false
            ? "The tablet is offline. Connect, then tap Save to Drive again."
            : "The upload to Drive didn’t finish. Try again, or use Share / Save File.";
    }

    function saveToDrive(chooseAgain) {
        var d = drive();
        if (!ed || !d) return;
        var file = publishFile();
        driveBtn.disabled = true;
        publishStatus.textContent = d.folder("maps") && !chooseAgain ? "Saving to Google Drive…"
            : "Pick the Route Maps folder (it's inside the backups folder)…";
        d.save(file, { slot: "maps", chooseAgain: chooseAgain }).then(function (done) {
            return "Saved " + file.name + " to Google Drive in " + done.folder + ".";
        }, driveError).then(function (message) {
            publishStatus.textContent = message;
            driveBtn.disabled = false;
            paintDrive();
        });
    }

    driveBtn.addEventListener("click", function () { saveToDrive(false); });
    driveChange.addEventListener("click", function () { saveToDrive(true); });

    document.getElementById("mlv-publish-go").addEventListener("click", function () {
        if (!ed) return;
        var file = publishFile();
        if (publishDialog) publishDialog.close();
        else publishDialogEl.close();
        shareFile(file);
    });

    /* ---------- Navigation ---------- */
    /* Shows where the truck is on the route and what's next. The highlighted blocks with a
       first-driven time (t, from the GPS trail) are put in driving order, each turned the way it
       was driven. Back-to-back blocks on the same street, without a sharp turn between, are one
       step; each new step starts with a turn worked out from the change in direction. Blocks the
       trail never confirmed aren't in the order (they still show on the map).

       Each position fix finds the block the truck is on, looking ahead of the last one first so
       a street driven twice doesn't send it back, and measures to the next step. Away from every
       highlighted block for a while, it says so and names the nearest route street. Voice reads
       each turn once well ahead and again close up (off by default). The screen is kept on, and
       Follow Me keeps the truck centered until the map is moved by hand. */

    var FT_PER_M = 3.28084;
    var ON_ROUTE_M = 35, OFF_ROUTE_M = 70, OFF_ROUTE_S = 12;
    var SAY_AHEAD_M = 150, SAY_NOW_M = 40;
    var navBanner = document.getElementById("mlv-nav-banner");
    var navIcon = document.getElementById("mlv-nav-icon");
    var navMain = document.getElementById("mlv-nav-main");
    var navSub = document.getElementById("mlv-nav-sub");
    var navTools = document.getElementById("mlv-nav-tools");
    var navFollowBtn = document.getElementById("mlv-nav-follow");
    var navVoiceBtn = document.getElementById("mlv-nav-voice");
    var nav = null;
    var navVoiceOn = false; // remembered for the session

    var TURN_ICONS = { straight: "↑", slightLeft: "↖", slightRight: "↗", left: "←", right: "→", uturn: "↶", goto: "➜", end: "⚑", none: "•" };

    function distText(m) {
        var ft = m * FT_PER_M;
        if (ft < 1000) return Math.max(50, Math.round(ft / 50) * 50) + " ft";
        var mi = m / 1609.34;
        return (mi < 10 ? mi.toFixed(1) : String(Math.round(mi))) + " mi";
    }

    function streetName(n) {
        return n || "the unnamed street";
    }

    // Degrees clockwise from north at the start or end of a line, in flat meters
    function bearingOf(G, atEnd) {
        var a = atEnd ? G[Math.max(0, G.length - 2)] : G[0], b = atEnd ? G[G.length - 1] : G[Math.min(1, G.length - 1)];
        return Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI;
    }

    function turnBetween(fromDeg, toDeg) {
        var d = ((toDeg - fromDeg + 540) % 360) - 180; // -180..180, positive is to the right
        var a = Math.abs(d);
        if (a < 25) return "straight";
        if (a < 60) return d > 0 ? "slightRight" : "slightLeft";
        if (a < 150) return d > 0 ? "right" : "left";
        return "uturn";
    }

    function stepText(step) {
        var name = streetName(step.name);
        switch (step.turn) {
            case "start": return "Start on " + name;
            // A jump to a section that doesn't join on: where it lies, not a turn
            case "goto": return step.sameStreet ? "Continue to the next stretch of " + name
                : "Head to " + name + (step.side ? ", " + step.side : "");
            case "straight": return "Continue onto " + name;
            case "slightLeft": return "Bear left onto " + name;
            case "slightRight": return "Bear right onto " + name;
            case "left": return "Turn left onto " + name;
            case "right": return "Turn right onto " + name;
            case "uturn": return step.sameStreet ? "Turn around on " + name : "Turn around onto " + name;
            default: return name;
        }
    }

    // The driving order: legs (one block each, turned the way it was driven) and steps (runs of legs)
    function buildPlan(draft) {
        var ids = Object.keys(draft.blocks).filter(function (id) {
            var b = draft.blocks[id];
            return b.t != null && directionOf(b);
        }).sort(function (a, b) { return draft.blocks[a].t - draft.blocks[b].t; });
        if (!ids.length) return null;
        var xy = localXY(draft.blocks[ids[0]].g[0][0]);
        var legs = [], prevEnd = null;
        ids.forEach(function (id) {
            var b = draft.blocks[id], g = b.g.slice(), dir = directionOf(b);
            if (dir === -1) g.reverse();
            // Driven both ways: start from whichever end is nearer where the last block ended
            else if (dir === 2 && prevEnd) {
                var s = xy(g[0]), e = xy(g[g.length - 1]);
                if (Math.hypot(e[0] - prevEnd[0], e[1] - prevEnd[1]) < Math.hypot(s[0] - prevEnd[0], s[1] - prevEnd[1])) g.reverse();
            }
            var G = g.map(xy), cum = lengths(G);
            legs.push({ id: id, n: b.n || "", g: g, G: G, cum: cum, len: cum[cum.length - 1] });
            prevEnd = G[G.length - 1];
        });
        var steps = [];
        legs.forEach(function (leg, i) {
            leg.step = steps.length;
            if (i === 0) {
                steps.push({ first: 0, name: leg.n, turn: "start" });
                return;
            }
            var prev = legs[i - 1], last = steps[steps.length - 1];
            var a = prev.G[prev.G.length - 1], b = leg.G[0];
            var gap = Math.hypot(b[0] - a[0], b[1] - a[1]);
            var turn = turnBetween(bearingOf(prev.G, true), bearingOf(leg.G, false));
            var same = leg.n && leg.n === prev.n;
            if (same && gap < 60 && turn !== "uturn") {
                leg.step = steps.length - 1;
                return;
            }
            var side = null;
            if (gap >= 60) {
                var toward = turnBetween(bearingOf(prev.G, true), Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI);
                side = toward === "straight" ? "ahead" : toward === "uturn" ? "behind you"
                    : /Left|left/.test(toward) ? "on the left" : "on the right";
            }
            steps.push({ first: i, name: leg.n, turn: gap >= 60 ? "goto" : turn, sameStreet: same, side: side });
            last.next = steps.length - 1;
        });
        return { legs: legs, steps: steps, xy: xy };
    }

    // Distance from a point to a leg, and how far along it the nearest spot is
    function onLeg(leg, p) {
        var best = Infinity, along = 0;
        for (var j = 1; j < leg.G.length; j++) {
            var ax = leg.G[j - 1][0], ay = leg.G[j - 1][1], dx = leg.G[j][0] - ax, dy = leg.G[j][1] - ay, l2 = dx * dx + dy * dy;
            var t = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
            var d = Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1]);
            if (d < best) { best = d; along = leg.cum[j - 1] + t * Math.sqrt(l2); }
        }
        return { d: best, along: along };
    }

    function nearestRouteStreet(p) {
        var best = null;
        Object.keys(ed.draft.blocks).forEach(function (id) {
            var b = ed.draft.blocks[id], xy = nav.xy;
            var d = onLeg({ G: b.g.map(xy), cum: lengths(b.g.map(xy)) }, p).d;
            if (!best || d < best.d) best = { d: d, n: b.n };
        });
        return best;
    }

    function setBanner(icon, main, sub, warn) {
        navBanner.hidden = false;
        navBanner.classList.toggle("is-warning", !!warn);
        navIcon.textContent = icon;
        navMain.textContent = main;
        navSub.textContent = sub || "";
    }

    function speak(text) {
        if (!navVoiceOn || !window.speechSynthesis) return;
        try {
            window.speechSynthesis.cancel();
            var u = new SpeechSynthesisUtterance(text);
            u.lang = "en-US";
            window.speechSynthesis.speak(u);
        } catch (e) { /* no voice on this device */ }
    }

    function keepAwake() {
        if (!nav || nav.wake || !navigator.wakeLock || document.visibilityState !== "visible") return;
        navigator.wakeLock.request("screen").then(function (lock) {
            if (!nav) { lock.release(); return; }
            nav.wake = lock;
            lock.addEventListener("release", function () { if (nav && nav.wake === lock) nav.wake = null; });
        }).catch(function () { /* not allowed here; the screen may dim */ });
    }
    document.addEventListener("visibilitychange", keepAwake);

    var ME_ICON = '<span class="mlv-me-cone"></span><span class="mlv-me-dot"></span>';

    function showMe(ll, accuracy, heading) {
        if (!nav.me) {
            nav.me = L.marker(ll, { interactive: false, keyboard: false, zIndexOffset: 1000,
                icon: L.divIcon({ className: "mlv-me", html: ME_ICON, iconSize: [44, 44], iconAnchor: [22, 22] }) }).addTo(map);
            nav.ring = L.circle(ll, { radius: accuracy, interactive: false, stroke: false, fillColor: "#1E90FF", fillOpacity: 0.12 }).addTo(map);
        } else {
            nav.me.setLatLng(ll);
            nav.ring.setLatLng(ll).setRadius(accuracy);
        }
        var cone = nav.me.getElement() && nav.me.getElement().querySelector(".mlv-me-cone");
        if (cone) {
            cone.style.display = heading == null ? "none" : "";
            if (heading != null) cone.style.transform = "rotate(" + heading.toFixed(0) + "deg)";
        }
    }

    function onFix(pos) {
        if (!nav || !ed) return;
        var c = pos.coords, ll = L.latLng(c.latitude, c.longitude);
        nav.lastFixAt = Date.now();
        var p = nav.xy([c.latitude, c.longitude]);
        // Heading: the device's while moving, else from the last fix if it moved enough
        var heading = c.heading != null && !isNaN(c.heading) && (c.speed == null || c.speed > 1) ? c.heading : null;
        if (heading == null && nav.lastP && Math.hypot(p[0] - nav.lastP[0], p[1] - nav.lastP[1]) > 8) {
            heading = Math.atan2(p[0] - nav.lastP[0], p[1] - nav.lastP[1]) * 180 / Math.PI;
        }
        if (heading == null) heading = nav.heading;
        if (!nav.lastP || Math.hypot(p[0] - nav.lastP[0], p[1] - nav.lastP[1]) > 8) nav.lastP = p;
        nav.heading = heading;
        showMe(ll, Math.min(c.accuracy || 20, 200), heading);
        if (nav.follow) map.setView(ll, Math.max(map.getZoom(), 17), { animate: true });
        update(p, c.accuracy || 20, pos.timestamp || Date.now());
    }

    function update(p, accuracy, now) {
        if (!nav.plan) {
            setBanner(TURN_ICONS.none, "Showing where you are", "Turn-by-turn needs this map's driving order: Replace GPS Trail, then publish again.");
            return;
        }
        var legs = nav.plan.legs, steps = nav.plan.steps, near = Math.max(ON_ROUTE_M, Math.min(accuracy, 60));
        // Ahead of the last block first (a street driven twice mustn't pull it back), then anywhere
        var best = null, from = Math.max(0, nav.idx - 2), to = Math.min(legs.length - 1, nav.idx + 25), i, hit;
        for (i = from; i <= to; i++) {
            hit = onLeg(legs[i], p);
            if (hit.d <= near && (!best || hit.d < best.d - 5)) best = { i: i, d: hit.d, along: hit.along };
        }
        if (!best) {
            for (i = 0; i < legs.length; i++) {
                hit = onLeg(legs[i], p);
                if (hit.d <= near && (!best || hit.d < best.d)) best = { i: i, d: hit.d, along: hit.along };
            }
        }
        if (!best) {
            if (!nav.offSince) nav.offSince = now;
            var routeStreet = nearestRouteStreet(p);
            var where = routeStreet ? streetName(routeStreet.n) + ", " + distText(routeStreet.d) : "";
            if (!nav.started) {
                setBanner(TURN_ICONS.goto, "Head to the route", where ? "Nearest route street: " + where : "");
            } else if (now - nav.offSince > OFF_ROUTE_S * 1000) {
                setBanner("!", "Off route", where ? "Nearest route street: " + where : "", true);
                if (!nav.offSaid) { speak("Off route."); nav.offSaid = true; }
            }
            return;
        }
        nav.started = true;
        nav.offSince = null;
        nav.offSaid = false;
        nav.idx = best.i;
        var leg = legs[best.i], step = steps[leg.step];
        if (step.next == null) {
            // Last step: the rest of the way to the end
            var left = leg.len - best.along;
            for (i = best.i + 1; i < legs.length; i++) left += legs[i].len;
            if (left < 25) {
                setBanner(TURN_ICONS.end, "End of route", "That's the last highlighted street.");
                if (nav.said !== "end") { speak("You've reached the end of the route."); nav.said = "end"; }
            } else {
                setBanner(TURN_ICONS.straight, "On " + streetName(leg.n), "End of route in " + distText(left));
            }
            return;
        }
        var next = steps[step.next], toTurn = leg.len - best.along;
        for (i = best.i + 1; i < next.first; i++) toTurn += legs[i].len;
        var text = stepText(next);
        setBanner(TURN_ICONS[next.turn] || TURN_ICONS.straight, text, distText(toTurn) + "  ·  now on " + streetName(leg.n));
        // Voice: once well ahead, once close (each step only once)
        if (toTurn <= SAY_NOW_M && nav.said !== step.next + "now") {
            speak(text + ".");
            nav.said = step.next + "now";
        } else if (toTurn <= SAY_AHEAD_M && toTurn > SAY_NOW_M && nav.said !== step.next + "ahead" && nav.said !== step.next + "now") {
            speak("In " + distText(toTurn).replace("ft", "feet").replace("mi", "miles") + ", " + text.charAt(0).toLowerCase() + text.slice(1) + ".");
            nav.said = step.next + "ahead";
        }
    }

    function setFollow(on) {
        if (!nav) return;
        nav.follow = on;
        navFollowBtn.setAttribute("aria-pressed", String(on));
        if (on && nav.me) map.setView(nav.me.getLatLng(), Math.max(map.getZoom(), 17));
    }

    function startNav() {
        if (!ed || nav) return;
        if (!navigator.geolocation) {
            say("This device can't share its location.");
            return;
        }
        flushSave();
        nav = {
            wasEditing: ed.editing, plan: buildPlan(ed.draft), idx: 0, follow: true,
            xy: null, me: null, ring: null, watch: null, wake: null, said: null, started: false
        };
        nav.xy = nav.plan ? nav.plan.xy : localXY(map.getCenter().lat);
        ed.editing = false;
        ed.action = null;
        editTools.hidden = viewTools.hidden = true;
        legendRow.hidden = true;
        navTools.hidden = false;
        map.dragging.enable();
        mapEl.classList.remove("is-drawing");
        showTrail(false);
        syncExtras();
        setFollow(true);
        navVoiceBtn.setAttribute("aria-pressed", String(navVoiceOn));
        navVoiceBtn.textContent = "Voice: " + (navVoiceOn ? "On" : "Off");
        setBanner(TURN_ICONS.none, "Finding your location…", "");
        say(nav.plan ? nav.plan.steps.length + " steps on this route." : "Showing your location.");
        keepAwake();
        nav.watch = navigator.geolocation.watchPosition(onFix, function (err) {
            if (!nav) return;
            if (err.code !== 1 && nav.lastFixAt && Date.now() - nav.lastFixAt < 20000) return;
            setBanner("!", err.code === 1 ? "Location is turned off for Route IQ" : "Can't find your location",
                err.code === 1 ? "Allow location for this site in the browser's settings, then tap Navigate again." : "Waiting for a GPS signal…", true);
        }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
        requestAnimationFrame(function () { map.invalidateSize(); });
    }

    function stopNav() {
        if (!nav) return;
        var n = nav;
        nav = null;
        if (n.watch != null) navigator.geolocation.clearWatch(n.watch);
        if (n.wake) n.wake.release().catch(function () {});
        if (n.me) map.removeLayer(n.me);
        if (n.ring) map.removeLayer(n.ring);
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        navBanner.hidden = true;
        navTools.hidden = true;
        if (ed && dialog.open) {
            if (n.wasEditing) startEditing();
            else setView();
        }
    }

    navFollowBtn.addEventListener("click", function () { if (nav) setFollow(!nav.follow); });
    navVoiceBtn.addEventListener("click", function () {
        navVoiceOn = !navVoiceOn;
        navVoiceBtn.setAttribute("aria-pressed", String(navVoiceOn));
        navVoiceBtn.textContent = "Voice: " + (navVoiceOn ? "On" : "Off");
        if (navVoiceOn) speak("Voice directions on.");
        else if (window.speechSynthesis) window.speechSynthesis.cancel();
    });
    document.getElementById("mlv-nav-stop").addEventListener("click", stopNav);

    /* ---------- Print Map ---------- */
    /* An 11x17 landscape handout drawn from OpenStreetMap, so street names print. Each sheet is
       a 1584 x 900 pixel picture (the page's map area at 96 dpi, the size OSM's labels are made
       for), laid in the house format: slim header (route, label, sheet; logo at the right), the
       map, a legend, and the credit OSM requires. A route too big for one sheet is cut into as
       many as it needs, overlapping a little (see planSheets for the zoom). Never names a
       driver: maps outlast whoever drives the route. */

    var SHEET_W = 1584, SHEET_H = 900, SHEET_PAD = 48, SHEET_OVERLAP = 64;
    var END_COLORS = { start: "#15803d", end: "#b91c1c" };

    var logoPromise = null;
    function loadLogo() {
        if (!logoPromise) {
            logoPromise = fetch("assets/icons/ew-logo-192.png")
                .then(function (r) { return r.blob(); })
                .then(function (blob) {
                    return new Promise(function (resolve, reject) {
                        var reader = new FileReader();
                        reader.onload = function () { resolve(reader.result); };
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                })
                .catch(function () { logoPromise = null; return null; });
        }
        return logoPromise;
    }

    function contentPoints(src) {
        var pts = [];
        Object.keys(src.blocks).forEach(function (id) { pts = pts.concat(src.blocks[id].g); });
        src.strokes.forEach(function (s) { pts = pts.concat(s.g); });
        if (src.show && src.show.markers) [src.start, src.end].forEach(function (p) { if (p) pts.push(p); });
        return pts;
    }

    // The sheets for printing at one zoom: OSM's labels print the same size at every zoom, so
    // 17 is closer in (more sheets) and 16 farther out (fewer); 16 still names residential
    // streets, and 15 and out drop too many of them
    function planSheets(src, z) {
        var crs = L.CRS.EPSG3857, pts = contentPoints(src);
        if (!pts.length) return null;
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pts.forEach(function (p) {
            var q = crs.latLngToPoint(L.latLng(p[0], p[1]), z);
            minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
            minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
        });
        var w = maxX - minX + 2 * SHEET_PAD, h = maxY - minY + 2 * SHEET_PAD;
        var cols = Math.max(1, Math.ceil((w - SHEET_OVERLAP) / (SHEET_W - SHEET_OVERLAP)));
        var rows = Math.max(1, Math.ceil((h - SHEET_OVERLAP) / (SHEET_H - SHEET_OVERLAP)));
        var plan = { z: z, cols: cols, rows: rows, minX: minX, minY: minY, w: w, h: h };
        // The sheets' grid, centered on the route
        var gridW = plan.cols * SHEET_W - (plan.cols - 1) * SHEET_OVERLAP;
        var gridH = plan.rows * SHEET_H - (plan.rows - 1) * SHEET_OVERLAP;
        var x0 = plan.minX - SHEET_PAD - (gridW - plan.w) / 2, y0 = plan.minY - SHEET_PAD - (gridH - plan.h) / 2;
        plan.sheets = [];
        for (var r = 0; r < plan.rows; r++) {
            for (var c = 0; c < plan.cols; c++) {
                plan.sheets.push({ x: Math.round(x0 + c * (SHEET_W - SHEET_OVERLAP)), y: Math.round(y0 + r * (SHEET_H - SHEET_OVERLAP)) });
            }
        }
        return plan;
    }

    function tileImage(z, x, y) {
        return new Promise(function (resolve) {
            var img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = function () { resolve(img); };
            img.onerror = function () { resolve(null); };
            img.src = "https://tile.openstreetmap.org/" + z + "/" + x + "/" + y + ".png";
        });
    }

    function drawArrow(ctx, x, y, deg, both) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(deg * Math.PI / 180);
        ctx.beginPath();
        if (both) {
            ctx.moveTo(0, -11); ctx.lineTo(6, -1); ctx.lineTo(0, -4); ctx.lineTo(-6, -1); ctx.closePath();
            ctx.moveTo(0, 11); ctx.lineTo(6, 1); ctx.lineTo(0, 4); ctx.lineTo(-6, 1); ctx.closePath();
        } else {
            ctx.moveTo(0, -8); ctx.lineTo(7, 6); ctx.lineTo(0, 2); ctx.lineTo(-7, 6); ctx.closePath();
        }
        ctx.lineJoin = "round";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
        ctx.fillStyle = "#043960";
        ctx.fill();
        ctx.restore();
    }

    function drawPin(ctx, x, y, text, color) {
        ctx.save();
        ctx.font = "bold 15px Helvetica, Arial, sans-serif";
        var w = Math.max(56, ctx.measureText(text).width + 22), h = 26;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, 13);
        else ctx.rect(x - w / 2, y - h / 2, w, h);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, x, y + 1);
        ctx.restore();
    }

    function renderSheet(src, z, ox, oy) {
        var crs = L.CRS.EPSG3857;
        var canvas = document.createElement("canvas");
        canvas.width = SHEET_W;
        canvas.height = SHEET_H;
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#f2efe9";
        ctx.fillRect(0, 0, SHEET_W, SHEET_H);
        function at(p) {
            var q = crs.latLngToPoint(L.latLng(p[0], p[1]), z);
            return [q.x - ox, q.y - oy];
        }
        var n = Math.pow(2, z), loads = [];
        for (var tx = Math.floor(ox / 256); tx <= Math.floor((ox + SHEET_W - 1) / 256); tx++) {
            for (var ty = Math.floor(oy / 256); ty <= Math.floor((oy + SHEET_H - 1) / 256); ty++) {
                if (ty < 0 || ty >= n) continue;
                (function (tx, ty) {
                    loads.push(tileImage(z, ((tx % n) + n) % n, ty).then(function (img) {
                        if (img) ctx.drawImage(img, tx * 256 - ox, ty * 256 - oy);
                    }));
                })(tx, ty);
            }
        }
        return Promise.all(loads).then(function () {
            // The highlighter, as on screen: opaque on its own layer, multiplied at partial strength
            var ink = document.createElement("canvas");
            ink.width = SHEET_W;
            ink.height = SHEET_H;
            var ictx = ink.getContext("2d");
            ictx.lineCap = "round";
            ictx.lineJoin = "round";
            ictx.lineWidth = LINE_PX;
            function line(g, c) {
                ictx.strokeStyle = COLORS[c] || COLORS.y;
                ictx.beginPath();
                g.forEach(function (p, i) {
                    var q = at(p);
                    if (i) ictx.lineTo(q[0], q[1]);
                    else ictx.moveTo(q[0], q[1]);
                });
                if (g.length === 1) ictx.lineTo(at(g[0])[0] + 0.01, at(g[0])[1]);
                ictx.stroke();
            }
            Object.keys(src.blocks).forEach(function (id) { line(src.blocks[id].g, src.blocks[id].c); });
            src.strokes.forEach(function (s) { line(s.g, s.c); });
            ctx.globalAlpha = 0.6;
            ctx.globalCompositeOperation = "multiply";
            ctx.drawImage(ink, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
            ink.width = 0;

            var show = src.show || {};
            if (show.arrows) {
                var spacing = 120 * metersPerPixel(z, crs.pointToLatLng(L.point(ox + SHEET_W / 2, oy + SHEET_H / 2), z).lat);
                Object.keys(src.blocks).forEach(function (id) {
                    var b = src.blocks[id], dir = directionOf(b);
                    if (!dir) return;
                    arrowSpots(b.g, dir, spacing).forEach(function (spot) {
                        var q = at(spot.ll);
                        if (q[0] > -20 && q[1] > -20 && q[0] < SHEET_W + 20 && q[1] < SHEET_H + 20) drawArrow(ctx, q[0], q[1], spot.deg, spot.both);
                    });
                });
            }
            if (show.markers) {
                if (src.start) drawPin(ctx, at(src.start)[0], at(src.start)[1], "Start", END_COLORS.start);
                if (src.end) drawPin(ctx, at(src.end)[0], at(src.end)[1], "End", END_COLORS.end);
            }
            var data = canvas.toDataURL("image/jpeg", 0.92);
            canvas.width = 0;
            return data;
        });
    }

    function hexToRgb(hex) {
        var v = parseInt(hex.slice(1), 16);
        return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    }

    // Colors are listed when blue or green is used (yellow is then "Route streets"); pins and
    // arrows when they're shown
    function legendItems(src) {
        var used = {}, items = [], legend = src.legend || {}, show = src.show || {};
        Object.keys(src.blocks).forEach(function (id) { used[src.blocks[id].c] = true; });
        src.strokes.forEach(function (s) { used[s.c] = true; });
        if (used.b || used.g) {
            if (used.y) items.push({ swatch: COLORS.y, label: "Route streets" });
            if (used.b) items.push({ swatch: COLORS.b, label: legend.b || "Blue" });
            if (used.g) items.push({ swatch: COLORS.g, label: legend.g || "Green" });
        }
        if (show.markers && (src.start || src.end)) items.push({ pin: true, label: "Start / End of route" });
        if (show.arrows) items.push({ arrow: true, label: "Direction of travel" });
        return items;
    }

    function buildPrint(src, images, logo) {
        var NAVY = [4, 57, 96], GREEN = [4, 102, 53], GRAY = [110, 118, 126], INK = [26, 26, 26];
        var PAGE_W = 1224, PAGE_H = 792, M = 18, CONTENT_W = PAGE_W - M * 2, LOGO = 40;
        var MAP_W = SHEET_W * 0.75, MAP_H = SHEET_H * 0.75; // 96 dpi → points
        var doc = new window.jspdf.jsPDF({ unit: "pt", format: "tabloid", orientation: "landscape" });
        function color(fn, c) { doc[fn](c[0], c[1], c[2]); }
        var legend = legendItems(src);
        var printed = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

        images.forEach(function (image, i) {
            if (i > 0) doc.addPage("tabloid", "landscape");
            var y = M;
            if (logo) doc.addImage(logo, "PNG", PAGE_W - M - LOGO, y - 4, LOGO, LOGO);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(18);
            color("setTextColor", NAVY);
            doc.text("Route " + src.route + " Map" + (src.label ? "  ·  " + src.label : "") +
                (images.length > 1 ? "  ·  Sheet " + (i + 1) + " of " + images.length : ""), M, y + 16);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            color("setTextColor", GRAY);
            doc.text("Earthwise Environmental Solutions", M, y + 30);
            y += 38;
            color("setFillColor", GREEN);
            doc.rect(M, y, CONTENT_W, 2.5, "F");
            y += 7;

            doc.addImage(image, "JPEG", M + (CONTENT_W - MAP_W) / 2, y, MAP_W, MAP_H);
            color("setDrawColor", [200, 206, 212]);
            doc.setLineWidth(0.5);
            doc.rect(M + (CONTENT_W - MAP_W) / 2, y, MAP_W, MAP_H, "S");
            y += MAP_H + 9;

            var x = M;
            doc.setFontSize(10);
            legend.forEach(function (item) {
                if (item.swatch) {
                    var rgb = hexToRgb(item.swatch).map(function (v) { return Math.round(255 - (255 - v) * 0.6); });
                    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
                    doc.roundedRect(x, y, 28, 10, 2, 2, "F");
                    x += 34;
                } else if (item.pin) {
                    color("setFillColor", hexToRgb(END_COLORS.start));
                    doc.roundedRect(x, y - 1, 14, 12, 6, 6, "F");
                    color("setFillColor", hexToRgb(END_COLORS.end));
                    doc.roundedRect(x + 17, y - 1, 14, 12, 6, 6, "F");
                    x += 37;
                } else if (item.arrow) {
                    color("setFillColor", NAVY);
                    doc.triangle(x + 2, y + 9, x + 14, y + 5, x + 2, y + 1, "F");
                    x += 20;
                }
                color("setTextColor", INK);
                doc.setFont("helvetica", "bold");
                doc.text(item.label, x, y + 8.5);
                x += doc.getTextWidth(item.label) + 24;
            });

            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            color("setTextColor", GRAY);
            doc.text("Map © OpenStreetMap contributors  ·  Printed " + printed, M, PAGE_H - M + 4);
            doc.text("Route " + src.route + "  ·  Page " + (i + 1) + " of " + images.length, PAGE_W - M, PAGE_H - M + 4, { align: "right" });
        });
        return doc;
    }

    // Asks which way to print a route that doesn't fit on one sheet close up
    var printDialogEl = document.getElementById("mlv-print-dialog");
    var printDialog = window.TrackerDialog ? TrackerDialog(printDialogEl, {}) : null;
    var printChoice = null;

    function sheetsText(n, how) {
        return n + " sheet" + (n === 1 ? "" : "s") + ", " + how;
    }

    function askSheets(far, near) {
        return new Promise(function (resolve, reject) {
            document.getElementById("mlv-print-far").textContent = sheetsText(far.sheets.length, "zoomed out");
            document.getElementById("mlv-print-near").textContent = sheetsText(near.sheets.length, "closer in");
            printChoice = { far: far, near: near, resolve: resolve, reject: reject };
            if (printDialog) printDialog.open();
            else printDialogEl.showModal();
        });
    }

    function choosePrint(which) {
        var c = printChoice;
        printChoice = null;
        if (printDialog) printDialog.close();
        else printDialogEl.close();
        if (!c) return;
        if (which) c.resolve(c[which]);
        else c.reject({ cancelled: true });
    }

    document.getElementById("mlv-print-far").addEventListener("click", function () { choosePrint("far"); });
    document.getElementById("mlv-print-near").addEventListener("click", function () { choosePrint("near"); });
    // Closed any other way (X, Escape): nothing prints
    printDialogEl.addEventListener("close", function () { if (printChoice) choosePrint(null); });

    function printRoute(route, button) {
        if (!window.jspdf) {
            alert("The PDF library did not load. Reload the page and try again.");
            return;
        }
        if (ed && routeKey(ed.route) === routeKey(route)) flushSave();
        var label = button.textContent;
        button.disabled = true;
        button.textContent = "Preparing…";
        current(route).then(function (state) {
            var src = state.draft ? JSON.parse(JSON.stringify(state.draft)) : state.lib ? fromFile(state.lib) : null;
            if (!src) throw { message: "This route has no map yet." };
            src.blocks = src.blocks || {};
            src.strokes = src.strokes || [];
            src.show = src.show || {};
            if (src.show.markers && !src.start) autoEnds(src);
            var near = planSheets(src, 17);
            if (!near) throw { message: "Nothing is highlighted on this map yet." };
            var far = planSheets(src, 16);
            // Fits close up, or zooming out wouldn't save a sheet: no need to ask
            if (near.sheets.length === 1 || far.sheets.length === near.sheets.length) return [src, near];
            return askSheets(far, near).then(function (plan) { return [src, plan]; });
        }).then(function (picked) {
            var src = picked[0], plan = picked[1];
            var images = [];
            return plan.sheets.reduce(function (chain, sheet) {
                return chain.then(function () {
                    return renderSheet(src, plan.z, sheet.x, sheet.y).then(function (data) { images.push(data); });
                });
            }, Promise.resolve()).then(loadLogo).then(function (logo) {
                var doc = buildPrint(src, images, logo);
                var now = new Date();
                var day = now.getFullYear() + "-" + ("0" + (now.getMonth() + 1)).slice(-2) + "-" + ("0" + now.getDate()).slice(-2);
                var name = ("Route " + src.route + " Map - " + day + ".pdf").replace(/[\\/:*?"<>|]/g, "");
                var file = new File([doc.output("blob")], name, { type: "application/pdf" });
                if (window.PdfStore) window.PdfStore.add(file.name, file).catch(function () {});
                var viewer = null;
                try { viewer = window.top.PdfViewer; } catch (e) { /* not inside the app */ }
                if (viewer) viewer.open(file);
                else doc.save(file.name);
            });
        }).catch(function (err) {
            if (err && err.cancelled) return;
            console.error(err);
            var text = err && err.message && !(err instanceof Error) ? err.message : "Sorry, the map couldn't be printed. Check the signal and try again.";
            if (dialog.open) say(text);
            else messageEl.textContent = text;
        }).then(function () {
            button.disabled = false;
            button.textContent = label;
        });
    }

    /* ---------- Route list ---------- */

    var renderToken = 0;

    function allRoutes() {
        var names = {};
        lib.live.forEach(function (r) { names[routeKey(r)] = r; });
        Object.keys(loadDrafts()).forEach(function (r) { if (!names[routeKey(r)]) names[routeKey(r)] = r; });
        return Object.keys(names).map(function (k) { return names[k]; }).sort(function (a, b) {
            return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
        });
    }

    function renderList() {
        var token = ++renderToken;
        var routes = allRoutes();
        listEl.textContent = "";
        routes.forEach(function (route) { listEl.appendChild(buildCard(route, token)); });
        countEl.textContent = routes.length ? routes.length + " route map" + (routes.length === 1 ? "" : "s") + "."
            : "No route maps yet. Export a route day's Location History from Lytx, then tap Import Lytx GPS Export.";
    }

    function cardId(route) {
        return "mlv-route-" + route.replace(/[^A-Za-z0-9-]/g, "_");
    }

    function buildCard(route, token) {
        var info = routeSheet(route);
        var card = el("article", "mt-entry ml-card");
        card.id = cardId(route);
        var head = el("div", "mt-entry-head");
        var h = el("h3", "mt-entry-address", "Route " + route);
        head.appendChild(h);
        card.appendChild(head);
        card.appendChild(el("p", "mt-entry-meta", info
            ? [info.driver, info.day, info.area].filter(Boolean).join(" · ") || "On Route Sheets"
            : "Not on Route Sheets yet."));
        var chips = el("div", "mt-chips");
        var chip = el("span", "mt-chip", "…");
        chips.appendChild(chip);
        card.appendChild(chips);
        current(route).then(function (state) {
            if (token !== renderToken) return;
            var src = state.draft || state.lib;
            if (src && src.label) h.textContent = title(route, src.label);
            chip.textContent = statusText(state);
            chip.classList.add(state.draft ? "ml-chip-draft" : "ml-chip-done");
            card.classList.add("ml-card-traced");
        });
        var actions = el("div", "mt-entry-actions");
        var b = el("button", "mt-btn", "Open Map");
        b.type = "button";
        b.addEventListener("click", function () { open(route); });
        actions.appendChild(b);
        var print = el("button", "mt-btn", "Print Map");
        print.type = "button";
        print.setAttribute("aria-label", "Print the map for route " + route);
        print.addEventListener("click", function () { printRoute(route, print); });
        actions.appendChild(print);
        card.appendChild(actions);
        return card;
    }

    // Opened from a route's card on Route Sheets: map-lens.html?route=M-1-2, or, with Map Lens
    // already open in a tab, the shell's "routeiq-open" event carrying that address
    function showFromQuery(query) {
        var m = /[?&]route=([^&]*)/.exec(query || "");
        if (!m) return;
        var route = decodeURIComponent(m[1]);
        var name = lib.findLive(route) || Object.keys(loadDrafts()).filter(function (r) { return routeKey(r) === routeKey(route); })[0];
        if (!name) {
            messageEl.textContent = "Route " + route + " doesn't have a map yet.";
            return;
        }
        var card = document.getElementById(cardId(name));
        if (card) card.scrollIntoView({ block: "start" });
        open(name);
    }

    window.addEventListener("routeiq-open", function (e) { showFromQuery(String(e.detail || "").replace(/^[^?]*/, "")); });
    window.addEventListener("storage", function (e) { if (e.key === SHEETS_KEY && !dialog.open) renderList(); });

    renderList();
    showFromQuery(location.search);
})();
