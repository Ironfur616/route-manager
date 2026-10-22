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
        (m.blocks || []).forEach(function (b) { blocks[b.id] = { c: b.c, n: b.n || "", g: b.g }; });
        return {
            route: m.route, label: m.label || "", updated: m.updated || 0,
            legend: { b: (m.legend || {}).b || "", g: (m.legend || {}).g || "" },
            blocks: blocks, strokes: (m.strokes || []).slice(), trail: []
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

        var recs = rows.slice(1).map(function (r) {
            return {
                type: cType >= 0 ? String(r[cType]).trim() : "GPS Trail",
                lat: parseFloat(r[cLat]), lng: parseFloat(r[cLng]),
                mph: cSpeed >= 0 ? parseFloat(r[cSpeed]) || 0 : 0,
                t: cDate >= 0 ? timeOf(r[cDate], cTime >= 0 ? r[cTime] : 0) : NaN,
                vehicle: cVehicle >= 0 ? String(r[cVehicle]).trim() : ""
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
                return [round5(r.lat), round5(r.lng), Math.round(r.mph), isFinite(r.t) ? r.t - t0 : 0];
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
        map.createPane("mlvTrail").style.zIndex = 410;
        var hl = map.createPane("mlvHighlight");
        hl.style.zIndex = 420;
        hl.style.mixBlendMode = "multiply";
        hl.style.opacity = "0.6";
        trailRenderer = L.canvas({ pane: "mlvTrail" });
        hlRenderer = L.canvas({ pane: "mlvHighlight", padding: 0.5 });
        trailGroup = L.layerGroup();
        strokeGroup = L.layerGroup().addTo(map);
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

    function clearLayers() {
        Object.keys(blockLayers).forEach(function (id) { map.removeLayer(blockLayers[id].layer); });
        blockLayers = {};
        strokeGroup.clearLayers();
        trailGroup.clearLayers();
        if (liveStroke) { map.removeLayer(liveStroke); liveStroke = null; }
    }

    function drawTrail() {
        trailGroup.clearLayers();
        var t = ed.draft.trail || [];
        if (t.length < 2) return;
        var run = [t[0]], fast = t[1][2] > SLOW_MPH;
        function flush() {
            if (run.length < 2) return;
            trailGroup.addLayer(L.polyline(run.map(function (p) { return [p[0], p[1]]; }), fast
                ? { renderer: trailRenderer, color: "#6b7280", weight: 2, opacity: 0.5, dashArray: "6 6", interactive: false }
                : { renderer: trailRenderer, color: "#DC143C", weight: 2, opacity: 0.6, interactive: false }));
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
                trailGroup.addLayer(L.circleMarker([p[0], p[1]], { renderer: trailRenderer, radius: 2, stroke: false, fillColor: "#DC143C", fillOpacity: 0.7, interactive: false }));
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
            titleEl.textContent = title(ed.route, ed.draft.label);
            syncBlocks();
            syncStrokes();
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
        say(statusText({ lib: ed.state.lib, draft: null }));
        requestAnimationFrame(function () { map.invalidateSize(); });
    }

    function startEditing() {
        ed.editing = true;
        viewTools.hidden = true;
        editTools.hidden = false;
        setMode(ed.mode);
        showTrail(true);
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
        return { blocks: Object.assign({}, ed.draft.blocks), strokes: ed.draft.strokes.slice() };
    }

    function restore(s) {
        ed.draft.blocks = Object.assign({}, s.blocks);
        ed.draft.strokes = s.strokes.slice();
        syncBlocks();
        syncStrokes();
    }

    function changed() {
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
            ed.draft.blocks[hit.id] = { c: ed.color, n: b.n, g: b.g };
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

    function wirePointer() {
        var pointers = {};

        function count() { return Object.keys(pointers).length; }

        function begin(e) {
            ed.action = { id: e.pointerId, before: snapshot(), touched: {}, changed: false, clearOnTap: null, moved: false, sx: e.clientX, sy: e.clientY };
            var ll = map.mouseEventToLatLng(e);
            if (ed.mode === "blocks") blocksAt(ll, true);
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
            if (e.target.closest && e.target.closest(".leaflet-control")) return;
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
    trailBtn.addEventListener("click", function () { if (ed) showTrail(!ed.showTrail); });
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
        readRows(file).then(function (rows) {
            var t = lytxTrail(rows);
            var names = nameFromFile(file.name);
            pendingImport = t;
            importRoute.value = importFor || names.route;
            importRoute.readOnly = !!importFor;
            var existing = draftFor(importRoute.value);
            importLabel.value = existing ? existing.label || names.label : names.label;
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
            var b = d.blocks[id];
            return "    " + JSON.stringify({ id: id, c: b.c, n: b.n || "", g: b.g });
        });
        var strokes = d.strokes.map(function (s) { return "    " + JSON.stringify({ c: s.c, g: s.g }); });
        return "{\n" +
            '  "route": ' + JSON.stringify(d.route) + ",\n" +
            '  "label": ' + JSON.stringify(d.label || "") + ",\n" +
            '  "updated": ' + d.updated + ",\n" +
            '  "legend": ' + JSON.stringify({ b: d.legend.b || "", g: d.legend.g || "" }) + ",\n" +
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
        card.appendChild(actions);
        return card;
    }

    // Opened from Route Sheets (map-lens.html?route=M-1-2): a live map wins over a screenshot map
    function show(route) {
        var name = lib.findLive(route) || Object.keys(loadDrafts()).filter(function (r) { return routeKey(r) === routeKey(route); })[0];
        if (!name) return false;
        var card = document.getElementById(cardId(name));
        if (card) card.scrollIntoView({ block: "start" });
        open(name);
        return true;
    }

    window.MapLive = { show: show };
    window.addEventListener("storage", function (e) { if (e.key === SHEETS_KEY && !dialog.open) renderList(); });

    renderList();
})();
