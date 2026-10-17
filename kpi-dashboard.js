/* KPI dashboard (kpi-dashboard.html), the first item under KPI in the menu.
   Read-only: it reads what the other pages already keep in localStorage and never writes to
   their data. One date range at the top scopes every card. Each card can be shown or hidden
   from Customize (remembered per device). It re-renders when another tab changes the data, so
   it stays current while you work.

   Charts follow the app's data-viz rules: one series per chart in a single validated blue,
   thin marks with rounded data-ends, hairline gridlines, values on tap/hover/focus, and a
   table view so no value depends on the tooltip. */
(function () {
    "use strict";

    var PREFS_KEY = "fleetMgrKpiPrefs";
    var KEYS = {
        missed: "fleetMgrMissed",
        newCustomers: "fleetMgrNewCustomers",
        bulk: "fleetMgrBulkPickup",
        service: "fleetMgrServiceCustomers",
        serviceLog: "fleetMgrServiceLog",
        rca: "fleetMgrRCA"
    };
    var RANGES = [
        { value: "7", label: "7 days", days: 7 },
        { value: "30", label: "30 days", days: 30 },
        { value: "90", label: "90 days", days: 90 },
        { value: "all", label: "All time", days: null }
    ];
    var CARDS = [
        { id: "missed-summary", label: "Missed Collections: summary", build: buildMissedSummary },
        { id: "missed-trend", label: "Missed Collections: misses over time", build: buildMissedTrend },
        { id: "missed-reasons", label: "Missed Collections: top reasons", build: buildMissedReasons },
        { id: "missed-routes", label: "Missed Collections: misses by route", build: buildMissedRoutes },
        { id: "missed-repeat", label: "Missed Collections: repeat addresses", build: buildRepeatAddresses },
        { id: "newcust-summary", label: "New Customers", build: buildNewCustomers },
        { id: "bulk-summary", label: "Bulk Pickup Requests", build: buildBulk },
        { id: "service-summary", label: "Handicap & Elderly Service", build: buildService },
        { id: "rca-summary", label: "Root Cause Assessments", build: buildRca }
    ];

    var cardsEl = document.getElementById("kpi-cards");
    var tooltipEl = document.getElementById("kpi-tooltip");

    /* ---------- Helpers ---------- */

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function svgEl(tag, attrs) {
        var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
        Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
        return node;
    }

    function pad(n) {
        return n < 10 ? "0" + n : String(n);
    }

    function dateString(d) {
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }

    function parseDate(value) {
        var p = String(value).split("-");
        return new Date(+p[0], +p[1] - 1, +p[2]);
    }

    function addDays(value, n) {
        var d = parseDate(value);
        d.setDate(d.getDate() + n);
        return dateString(d);
    }

    function shortDate(value) {
        return parseDate(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }

    function readList(key) {
        try {
            var data = JSON.parse(localStorage.getItem(key) || "[]");
            return Array.isArray(data) ? data.filter(function (e) { return e && e.id; }) : [];
        } catch (e) {
            return [];
        }
    }

    function num(n) {
        return Number(n).toLocaleString();
    }

    function percent(part, whole) {
        return whole ? Math.round(part / whole * 100) + "%" : "—";
    }

    // 2.5 hrs / 1.4 days / 35 min
    function duration(ms) {
        var mins = ms / 60000;
        if (mins < 60) return Math.max(1, Math.round(mins)) + " min";
        var hrs = mins / 60;
        if (hrs < 48) return (Math.round(hrs * 10) / 10) + " hrs";
        return (Math.round(hrs / 24 * 10) / 10) + " days";
    }

    /* ---------- Preferences: range + which cards show ---------- */

    function loadPrefs() {
        try {
            var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
            return p && typeof p === "object" ? p : {};
        } catch (e) {
            return {};
        }
    }

    function savePrefs(p) {
        try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* per-device nicety only */ }
    }

    var prefs = loadPrefs();
    if (!prefs.hidden) prefs.hidden = {};
    if (!RANGES.some(function (r) { return r.value === prefs.range; })) prefs.range = "30";

    // The selected window: today and the days before it, plus the equal period before that
    function currentRange() {
        var range = RANGES.filter(function (r) { return r.value === prefs.range; })[0];
        var today = dateString(new Date());
        if (!range.days) return { label: range.label, start: null, end: today, days: null };
        var start = addDays(today, -(range.days - 1));
        return {
            label: "last " + range.label,
            start: start,
            end: today,
            days: range.days,
            prevStart: addDays(start, -range.days),
            prevEnd: addDays(start, -1)
        };
    }

    function inRange(value, range) {
        return !!value && (!range.start || value >= range.start) && value <= range.end;
    }

    /* ---------- Card frame + pieces ---------- */

    function card(title, subtitle) {
        var c = el("section", "kpi-card");
        var head = el("header", "kpi-card-head");
        head.appendChild(el("h2", "kpi-card-title", title));
        if (subtitle) head.appendChild(el("p", "kpi-card-sub", subtitle));
        c.appendChild(head);
        return c;
    }

    function empty(c, text) {
        c.appendChild(el("p", "kpi-empty", text));
        return c;
    }

    // tiles: [{ label, value, note, delta: { text, good } }]
    function tiles(list) {
        // Four tiles sit 2 x 2 rather than 3 + 1
        var row = el("div", "kpi-tiles" + (list.length === 4 ? " kpi-tiles-4" : ""));
        list.forEach(function (t) {
            var tile = el("div", "kpi-tile");
            tile.appendChild(el("p", "kpi-tile-label", t.label));
            tile.appendChild(el("p", "kpi-tile-value", t.value));
            if (t.delta) {
                var d = el("p", "kpi-tile-delta " + (t.delta.good === true ? "is-good" : t.delta.good === false ? "is-bad" : "is-flat"));
                d.textContent = t.delta.text;
                tile.appendChild(d);
            }
            if (t.note) tile.appendChild(el("p", "kpi-tile-note", t.note));
            row.appendChild(tile);
        });
        return row;
    }

    function tableView(headers, rows) {
        var details = el("details", "kpi-table-view");
        details.appendChild(el("summary", null, "Table view"));
        var table = el("table", "kpi-table");
        var tr = el("tr");
        headers.forEach(function (h) { tr.appendChild(el("th", null, h)).setAttribute("scope", "col"); });
        table.appendChild(el("thead")).appendChild(tr);
        var body = table.appendChild(el("tbody"));
        rows.forEach(function (r) {
            var row = el("tr");
            r.forEach(function (v) { row.appendChild(el("td", null, String(v))); });
            body.appendChild(row);
        });
        details.appendChild(table);
        return details;
    }

    // Horizontal bars, values labeled at the bar tip (so no value needs the tooltip)
    function barList(items) {
        var max = Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1]));
        var list = el("ol", "kpi-bars");
        items.forEach(function (i) {
            var li = el("li", "kpi-bar-row");
            li.appendChild(el("span", "kpi-bar-name", i.name));
            var track = el("span", "kpi-bar-track");
            var bar = el("span", "kpi-bar");
            bar.style.width = "calc((100% - 2.75rem) * " + Math.max(0.01, i.value / max).toFixed(4) + ")";
            track.appendChild(bar);
            track.appendChild(el("span", "kpi-bar-value", num(i.value)));
            li.appendChild(track);
            list.appendChild(li);
        });
        return list;
    }

    /* ---------- Tooltip (one, shared) ---------- */

    function showTip(target, value, label) {
        tooltipEl.textContent = "";
        tooltipEl.appendChild(el("strong", null, value));
        tooltipEl.appendChild(el("span", null, label));
        tooltipEl.hidden = false;
        var r = target.getBoundingClientRect();
        var w = tooltipEl.offsetWidth;
        var x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
        var y = r.top - tooltipEl.offsetHeight - 8;
        tooltipEl.style.left = x + "px";
        tooltipEl.style.top = Math.max(8, y) + "px";
    }

    function hideTip() {
        tooltipEl.hidden = true;
    }

    document.addEventListener("pointerdown", function (ev) {
        if (!ev.target.closest || !ev.target.closest(".kpi-col-hit")) hideTip();
    });
    window.addEventListener("scroll", hideTip, true);

    /* ---------- Column chart (misses over time) ---------- */

    function niceMax(v) {
        if (v <= 4) return 4;
        var step = Math.pow(10, Math.floor(Math.log10(v)));
        var n = Math.ceil(v / step);
        var nice = n <= 2 ? 2 : n <= 5 ? 5 : 10;
        return nice * step;
    }

    // Drawn at the card's actual pixel width (not stretched), so tick text stays 11px on any screen
    function chartWidth() {
        var full = cardsEl.clientWidth || window.innerWidth;
        return Math.max(260, full - 34); // card padding + border
    }

    // buckets: [{ label, tip, value }]
    function columnChart(buckets, unit) {
        var W = chartWidth(), H = 200, L = 30, R = 8, T = 10, B = 26;
        var plotW = W - L - R, plotH = H - T - B;
        var max = niceMax(Math.max.apply(null, buckets.map(function (b) { return b.value; }).concat([0])));
        var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, class: "kpi-chart", role: "img",
            "aria-label": "Column chart of misses per " + unit + ". Values are in the table view." });

        [0, 0.5, 1].forEach(function (f) {
            var y = T + plotH - f * plotH;
            svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y, y2: y, class: f === 0 ? "kpi-axis" : "kpi-grid" }));
            var t = svgEl("text", { x: L - 6, y: y + 4, class: "kpi-tick", "text-anchor": "end" });
            t.textContent = num(Math.round(max * f));
            svg.appendChild(t);
        });

        var band = plotW / buckets.length;
        var barW = Math.max(2, Math.min(24, band - 2)); // capped thickness, 2px surface gap
        buckets.forEach(function (b, i) {
            var x = L + i * band + (band - barW) / 2;
            var h = b.value / max * plotH;
            var y = T + plotH - h;
            if (h > 0) {
                var r = Math.min(4, barW / 2, h);
                // Rounded data-end, square at the baseline
                svg.appendChild(svgEl("path", {
                    class: "kpi-col",
                    d: "M" + x + "," + (T + plotH) + "V" + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y +
                        "H" + (x + barW - r) + "Q" + (x + barW) + "," + y + " " + (x + barW) + "," + (y + r) +
                        "V" + (T + plotH) + "Z"
                }));
            }
            // The hit target is the whole column band, taller and wider than the bar
            var hit = svgEl("rect", { x: L + i * band, y: T, width: band, height: plotH, class: "kpi-col-hit", tabindex: "0",
                "aria-label": b.tip + ": " + b.value });
            var tipValue = num(b.value) + " miss" + (b.value === 1 ? "" : "es");
            hit.addEventListener("pointerenter", function () { showTip(hit, tipValue, b.tip); });
            hit.addEventListener("pointerdown", function () { showTip(hit, tipValue, b.tip); });
            hit.addEventListener("focus", function () { showTip(hit, tipValue, b.tip); });
            hit.addEventListener("pointerleave", hideTip);
            hit.addEventListener("blur", hideTip);
            svg.appendChild(hit);
        });

        // Sparse x labels: first, middle, last
        [0, Math.floor((buckets.length - 1) / 2), buckets.length - 1].filter(function (v, i, a) { return a.indexOf(v) === i; })
            .forEach(function (i) {
                var t = svgEl("text", { x: L + i * band + band / 2, y: H - 8, class: "kpi-tick",
                    "text-anchor": i === 0 ? "start" : i === buckets.length - 1 ? "end" : "middle" });
                if (i === 0) t.setAttribute("x", L);
                if (i === buckets.length - 1) t.setAttribute("x", W - R);
                t.textContent = buckets[i].label;
                svg.appendChild(t);
            });
        return svg;
    }

    /* ---------- Missed collections ---------- */

    function missesIn(range) {
        return readList(KEYS.missed).filter(function (e) { return inRange(e.date, range); });
    }

    function buildMissedSummary(range) {
        var c = card("Missed Collections", "Misses dated in the " + range.label);
        var all = readList(KEYS.missed);
        if (!all.length) return empty(c, "No missed collections logged yet.");
        var list = missesIn(range);
        var resolved = list.filter(function (e) { return e.status === "resolved"; });
        var timed = resolved.filter(function (e) { return e.resolvedAt && e.created && e.resolvedAt >= e.created; });
        var avg = timed.length ? timed.reduce(function (s, e) { return s + (e.resolvedAt - e.created); }, 0) / timed.length : null;

        var delta = null;
        if (range.days) {
            var prev = all.filter(function (e) { return e.date >= range.prevStart && e.date <= range.prevEnd; }).length;
            var diff = list.length - prev;
            // Fewer misses is the good direction
            delta = {
                text: (diff > 0 ? "▲ " + diff : diff < 0 ? "▼ " + Math.abs(diff) : "No change") + " vs prior " + range.days + " days",
                good: diff < 0 ? true : diff > 0 ? false : null
            };
        }

        c.appendChild(tiles([
            { label: "Misses", value: num(list.length), delta: delta },
            { label: "Open now", value: num(all.filter(function (e) { return e.status !== "resolved"; }).length), note: "All dates" },
            { label: "Resolved", value: percent(resolved.length, list.length), note: num(resolved.length) + " of " + num(list.length) },
            { label: "Avg time to resolve", value: avg == null ? "—" : duration(avg),
                note: timed.length ? "From " + num(timed.length) + " with resolve times" : "No resolve times yet" },
            { label: "Yellow tags", value: num(list.filter(function (e) { return (e.reasons || []).indexOf("Customer issued a yellow tag") !== -1; }).length) },
            { label: "Boro / Twp contacted", value: num(list.filter(function (e) { return e.contactedBoro; }).length) }
        ]));
        return c;
    }

    function buildMissedTrend(range) {
        var all = readList(KEYS.missed);
        var c = card("Misses over time", "Tap a column for its count");
        if (!all.length) return empty(c, "No missed collections logged yet.");

        var start = range.start || all.reduce(function (m, e) { return e.date < m ? e.date : m; }, range.end);
        var spanDays = Math.round((parseDate(range.end) - parseDate(start)) / 86400000) + 1;
        var byWeek = spanDays > 31;
        var buckets = [];
        if (byWeek) {
            // Weeks start on Sunday, like the recycle calendar
            var first = addDays(start, -parseDate(start).getDay());
            for (var w = first; w <= range.end; w = addDays(w, 7)) {
                buckets.push({ from: w, to: addDays(w, 6), label: shortDate(w), tip: "Week of " + shortDate(w), value: 0 });
            }
        } else {
            for (var d = start; d <= range.end; d = addDays(d, 1)) {
                buckets.push({ from: d, to: d, label: shortDate(d),
                    tip: parseDate(d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), value: 0 });
            }
        }
        all.forEach(function (e) {
            for (var i = 0; i < buckets.length; i++) {
                if (e.date >= buckets[i].from && e.date <= buckets[i].to) { buckets[i].value++; break; }
            }
        });
        c.querySelector(".kpi-card-sub").textContent = "Misses per " + (byWeek ? "week" : "day") + " · tap a column for its count";
        var wrap = el("div", "kpi-chart-wrap");
        wrap.appendChild(columnChart(buckets, byWeek ? "week" : "day"));
        c.appendChild(wrap);
        c.appendChild(tableView([byWeek ? "Week of" : "Date", "Misses"], buckets.map(function (b) { return [b.tip.replace(/^Week of /, ""), b.value]; })));
        return c;
    }

    function topCounts(values, limit) {
        var counts = {};
        values.forEach(function (v) { if (v) counts[v] = (counts[v] || 0) + 1; });
        return Object.keys(counts).map(function (k) { return { name: k, value: counts[k] }; })
            .sort(function (a, b) { return b.value - a.value || a.name.localeCompare(b.name); })
            .slice(0, limit);
    }

    function buildMissedReasons(range) {
        var list = missesIn(range);
        var c = card("Top miss reasons", "In the " + range.label + " · a miss can have more than one reason");
        var reasons = [];
        list.forEach(function (e) {
            (e.reasons || []).forEach(function (r) { if (r !== "Customer issued a yellow tag") reasons.push(r); });
        });
        var top = topCounts(reasons, 6);
        if (!top.length) return empty(c, "No misses in this range.");
        c.appendChild(barList(top));
        return c;
    }

    function buildMissedRoutes(range) {
        var list = missesIn(range);
        var c = card("Misses by route", "In the " + range.label + " · top 8 routes");
        var top = topCounts(list.map(function (e) { return e.route ? "Route " + e.route : "No route entered"; }), 8);
        if (!top.length) return empty(c, "No misses in this range.");
        c.appendChild(barList(top));
        return c;
    }

    var SUFFIXES = {
        street: "st", avenue: "ave", road: "rd", drive: "dr", lane: "ln", court: "ct",
        boulevard: "blvd", place: "pl", circle: "cir", terrace: "ter", highway: "hwy"
    };

    // Same matching as Missed Collections, so "123 Main Street" and "123 main st." are one address
    function addressKey(text) {
        return String(text).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
            .map(function (w) { return SUFFIXES[w] || w; }).join(" ");
    }

    function buildRepeatAddresses(range) {
        var list = missesIn(range);
        var c = card("Repeat addresses", "Missed more than once in the " + range.label);
        var groups = {};
        list.forEach(function (e) {
            var k = addressKey(e.address);
            if (!k) return;
            if (!groups[k]) groups[k] = { address: e.address, count: 0, last: e.date, routes: {} };
            groups[k].count++;
            if (e.date > groups[k].last) { groups[k].last = e.date; groups[k].address = e.address; }
            if (e.route) groups[k].routes[e.route] = true;
        });
        var rows = Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (g) { return g.count > 1; })
            .sort(function (a, b) { return b.count - a.count || (a.last < b.last ? 1 : -1); }).slice(0, 10);
        if (!rows.length) return empty(c, "No address was missed more than once in this range.");
        var table = el("table", "kpi-table kpi-table-open");
        var tr = el("tr");
        ["Address", "Misses", "Route", "Last miss"].forEach(function (h) { tr.appendChild(el("th", null, h)).setAttribute("scope", "col"); });
        table.appendChild(el("thead")).appendChild(tr);
        var body = table.appendChild(el("tbody"));
        rows.forEach(function (g) {
            var row = el("tr");
            [g.address, num(g.count), Object.keys(g.routes).join(", ") || "—", shortDate(g.last)].forEach(function (v) {
                row.appendChild(el("td", null, v));
            });
            body.appendChild(row);
        });
        c.appendChild(table);
        return c;
    }

    /* ---------- Other trackers ---------- */

    function buildNewCustomers(range) {
        var c = card("New Customers", "Added in the " + range.label);
        var all = readList(KEYS.newCustomers);
        if (!all.length) return empty(c, "No new customers logged yet.");
        var today = dateString(new Date());
        function daysSince(v) { return Math.round((parseDate(today) - parseDate(v)) / 86400000); }
        var active = all.filter(function (e) { return e.firstDay && daysSince(e.firstDay) < 90; });
        var checklistDone = active.filter(function (e) { return e.informed && e.pushed && e.rmCheck; }).length;
        c.appendChild(tiles([
            { label: "Added", value: num(all.filter(function (e) { return e.created && inRange(dateString(new Date(e.created)), range); }).length) },
            { label: "Starting in next 7 days", value: num(all.filter(function (e) { return e.firstDay > today && e.firstDay <= addDays(today, 7); }).length) },
            { label: "In first 30 days", value: num(all.filter(function (e) { return e.firstDay && daysSince(e.firstDay) >= 0 && daysSince(e.firstDay) <= 29; }).length) },
            { label: "Checklist complete", value: percent(checklistDone, active.length), note: num(checklistDone) + " of " + num(active.length) + " not yet established" }
        ]));
        return c;
    }

    function buildBulk(range) {
        var c = card("Bulk Pickup Requests", "Completed counts use the " + range.label);
        var all = readList(KEYS.bulk);
        if (!all.length) return empty(c, "No bulk pickup requests logged yet.");
        var today = dateString(new Date());
        c.appendChild(tiles([
            { label: "Upcoming", value: num(all.filter(function (e) { return e.pickupDate >= today; }).length) },
            { label: "Next 7 days", value: num(all.filter(function (e) { return e.pickupDate >= today && e.pickupDate <= addDays(today, 6); }).length) },
            { label: "Completed", value: num(all.filter(function (e) { return e.pickupDate < today && inRange(e.pickupDate, range); }).length) }
        ]));
        return c;
    }

    function buildService(range) {
        var c = card("Handicap & Elderly Service", "Services logged in the " + range.label);
        var customers = readList(KEYS.service);
        var log = readList(KEYS.serviceLog);
        if (!customers.length && !log.length) return empty(c, "No service customers added yet.");
        var today = dateString(new Date());
        c.appendChild(tiles([
            { label: "On the weekly list", value: num(customers.length) },
            { label: "Checked off today", value: num(customers.filter(function (x) { return x.completedOn === today; }).length) },
            { label: "Services logged", value: num(log.filter(function (e) { return inRange(e.serviceDate, range); }).length),
                note: "Checks move to the log the day after" }
        ]));
        return c;
    }

    function buildRca(range) {
        var c = card("Root Cause Assessments", "Status counts are for all cases");
        var all = readList(KEYS.rca);
        if (!all.length) return empty(c, "No RCA cases opened yet.");
        function count(s) { return all.filter(function (x) { return x.status === s; }).length; }
        c.appendChild(tiles([
            { label: "Open", value: num(count("open")) },
            { label: "Investigating", value: num(count("investigating")) },
            { label: "Resolved", value: num(count("resolved")) },
            { label: "Opened in range", value: num(all.filter(function (x) { return x.created && inRange(dateString(new Date(x.created)), range); }).length),
                note: range.label.charAt(0).toUpperCase() + range.label.slice(1) }
        ]));
        return c;
    }

    /* ---------- Controls + render ---------- */

    function renderRange() {
        var group = document.getElementById("kpi-range");
        group.textContent = "";
        RANGES.forEach(function (r) {
            var b = el("button", "kpi-range-btn" + (r.value === prefs.range ? " is-selected" : ""), r.label);
            b.type = "button";
            b.setAttribute("aria-pressed", String(r.value === prefs.range));
            b.addEventListener("click", function () {
                prefs.range = r.value;
                savePrefs(prefs);
                render();
            });
            group.appendChild(b);
        });
        var range = currentRange();
        document.getElementById("kpi-range-note").textContent = range.start
            ? shortDate(range.start) + " – " + shortDate(range.end) + ", " + parseDate(range.end).getFullYear()
            : "Everything logged so far";
    }

    function renderCustomize() {
        var list = document.getElementById("kpi-customize-list");
        list.textContent = "";
        CARDS.forEach(function (cd) {
            var id = "kpi-show-" + cd.id;
            var row = el("div", "mt-entry-contacted kpi-customize-row");
            var box = el("input");
            box.type = "checkbox";
            box.id = id;
            box.checked = !prefs.hidden[cd.id];
            box.addEventListener("change", function () {
                if (box.checked) delete prefs.hidden[cd.id];
                else prefs.hidden[cd.id] = true;
                savePrefs(prefs);
                renderCards();
            });
            var label = el("label", null, cd.label);
            label.htmlFor = id;
            row.appendChild(box);
            row.appendChild(label);
            list.appendChild(row);
        });
    }

    function renderCards() {
        hideTip();
        var range = currentRange();
        cardsEl.textContent = "";
        var shown = CARDS.filter(function (cd) { return !prefs.hidden[cd.id]; });
        shown.forEach(function (cd) {
            var built;
            try {
                built = cd.build(range);
            } catch (e) {
                console.error(e);
                built = empty(card(cd.label), "This card couldn't be shown.");
            }
            built.classList.add("kpi-card-" + cd.id);
            cardsEl.appendChild(built);
        });
        if (!shown.length) cardsEl.appendChild(el("p", "kpi-empty", "Every card is hidden. Tap Customize to choose what to show."));
    }

    function render() {
        renderRange();
        renderCards();
    }

    var customizeBtn = document.getElementById("kpi-customize-btn");
    customizeBtn.addEventListener("click", function () {
        var panel = document.getElementById("kpi-customize");
        panel.hidden = !panel.hidden;
        customizeBtn.setAttribute("aria-expanded", String(!panel.hidden));
        customizeBtn.textContent = panel.hidden ? "Customize" : "Done";
    });

    var lastWidth = 0;
    var resizeTimer = null;
    window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            if (cardsEl.clientWidth !== lastWidth) {
                lastWidth = cardsEl.clientWidth;
                renderCards();
            }
        }, 200);
    });

    // Another tab changed the data: refresh in place
    window.addEventListener("storage", function (ev) {
        var watched = Object.keys(KEYS).map(function (k) { return KEYS[k]; });
        if (watched.indexOf(ev.key) !== -1) renderCards();
    });
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") render();
    });

    renderCustomize();
    render();
})();
