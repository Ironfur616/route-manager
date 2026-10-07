/* Route streets directory (route-streets.html), under Routing in the menu.
   A reference list of routes and the streets on each, kept in localStorage like the trackers
   (data-no-draft on <html> opts out of the shell's draft handling). Streets are entered one per
   line so a whole list can be pasted in. The search answers "which route is this street on?":
   it matches street names (as well as route and area) and highlights the matching streets.

   Each route record has room for a mapUrl, for the custom route maps planned later. */
(function () {
    "use strict";

    var KEY = "fleetMgrRouteStreets";
    var DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    var form = document.getElementById("rs-form");
    var fields = {
        route: document.getElementById("rs-route"),
        day: document.getElementById("rs-day"),
        area: document.getElementById("rs-area"),
        streets: document.getElementById("rs-streets"),
        notes: document.getElementById("rs-notes")
    };
    var submitBtn = document.getElementById("rs-submit");
    var formTitle = document.getElementById("rs-form-title");
    var errorEl = document.getElementById("rs-error");
    var streetsCount = document.getElementById("rs-streets-count");
    var listEl = document.getElementById("rs-list");
    var countEl = document.getElementById("rs-count");
    var searchEl = document.getElementById("rs-search");

    var editingId = null;

    /* ---------- Helpers ---------- */

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function pad(n) {
        return n < 10 ? "0" + n : String(n);
    }

    function dateString(d) {
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }

    // One street per line; blank lines and repeats (ignoring case) dropped, order kept
    function parseStreets(text) {
        var seen = {};
        return String(text).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(function (s) {
            var k = s.toLowerCase();
            if (!s || seen[k]) return false;
            seen[k] = true;
            return true;
        });
    }

    // "Route 2" before "Route 10": compare the numbers inside route names as numbers
    function byRoute(a, b) {
        return String(a.route).localeCompare(String(b.route), undefined, { numeric: true, sensitivity: "base" });
    }

    function showError(text) {
        errorEl.textContent = text;
        errorEl.hidden = !text;
    }

    /* ---------- Storage ---------- */

    function load() {
        try {
            var data = JSON.parse(localStorage.getItem(KEY) || "[]");
            return Array.isArray(data) ? data.filter(function (e) { return e && e.id; }) : [];
        } catch (e) {
            return [];
        }
    }

    function save(list) {
        try {
            localStorage.setItem(KEY, JSON.stringify(list));
            document.getElementById("rs-storage-warning").hidden = true;
            return true;
        } catch (e) {
            document.getElementById("rs-storage-warning").hidden = false;
            return false;
        }
    }

    /* ---------- Rendering ---------- */

    function renderDatalist(list) {
        var seen = {};
        var dl = document.getElementById("dl-rs-area");
        dl.textContent = "";
        list.forEach(function (r) {
            var v = (r.area || "").trim();
            if (v && !seen[v.toLowerCase()]) {
                seen[v.toLowerCase()] = true;
                dl.appendChild(el("option")).value = v;
            }
        });
    }

    // Wraps each match of `term` in <mark>, built with text nodes (never innerHTML)
    function highlighted(text, term) {
        var frag = document.createDocumentFragment();
        if (!term) {
            frag.appendChild(document.createTextNode(text));
            return frag;
        }
        var lower = text.toLowerCase();
        var at = 0;
        var hit;
        while ((hit = lower.indexOf(term, at)) !== -1) {
            frag.appendChild(document.createTextNode(text.slice(at, hit)));
            frag.appendChild(el("mark", null, text.slice(hit, hit + term.length)));
            at = hit + term.length;
        }
        frag.appendChild(document.createTextNode(text.slice(at)));
        return frag;
    }

    function buildCard(r, term) {
        var streets = r.streets || [];
        var matchingStreets = term ? streets.filter(function (s) { return s.toLowerCase().indexOf(term) !== -1; }) : [];

        var card = el("article", "mt-entry rs-entry");
        var head = el("div", "mt-entry-head");
        var title = el("h3", "mt-entry-address");
        title.appendChild(highlighted("Route " + r.route, term));
        head.appendChild(title);
        head.appendChild(el("span", "mt-entry-date", streets.length + " street" + (streets.length === 1 ? "" : "s")));
        card.appendChild(head);

        var chips = el("div", "mt-chips");
        if (r.day) chips.appendChild(el("span", "mt-chip", r.day));
        if (r.area) {
            var area = el("span", "mt-chip");
            area.appendChild(highlighted(r.area, term));
            chips.appendChild(area);
        }
        if (chips.childNodes.length) card.appendChild(chips);

        if (r.notes) card.appendChild(el("p", "mt-entry-notes", r.notes));

        // While searching, the streets that matched are listed up front so they're seen right away
        if (matchingStreets.length) {
            var found = el("ul", "rs-streets rs-matches");
            found.setAttribute("aria-label", "Matching streets");
            matchingStreets.forEach(function (s) {
                var li = el("li");
                li.appendChild(highlighted(s, term));
                found.appendChild(li);
            });
            card.appendChild(found);
        }

        if (streets.length) {
            var all = el("details", "rs-all-streets");
            all.appendChild(el("summary", null, matchingStreets.length ? "All streets on this route" : "Show streets"));
            var ul = el("ul", "rs-streets");
            streets.forEach(function (s) { ul.appendChild(el("li", null, s)); });
            all.appendChild(ul);
            card.appendChild(all);
        }

        var actions = el("div", "mt-entry-actions");
        var edit = el("button", "mt-btn", "Edit");
        edit.type = "button";
        edit.setAttribute("aria-label", "Edit route " + r.route);
        edit.addEventListener("click", function () { startEdit(r.id); });
        var del = el("button", "mt-btn mt-btn-danger", "Delete");
        del.type = "button";
        del.setAttribute("aria-label", "Delete route " + r.route);
        del.addEventListener("click", function () { remove(r.id); });
        actions.appendChild(edit);
        actions.appendChild(del);
        card.appendChild(actions);

        return card;
    }

    function matches(r, term) {
        if (!term) return true;
        return [r.route, "route " + r.route, r.area, r.day, r.notes].concat(r.streets || [])
            .join("\n").toLowerCase().indexOf(term) !== -1;
    }

    function render() {
        var list = load().sort(byRoute);
        var term = searchEl.value.trim().toLowerCase();
        renderDatalist(list);

        var shown = list.filter(function (r) { return matches(r, term); });
        listEl.textContent = "";
        shown.forEach(function (r) { listEl.appendChild(buildCard(r, term)); });

        var streetTotal = list.reduce(function (n, r) { return n + (r.streets || []).length; }, 0);
        if (!list.length) {
            countEl.textContent = "No routes yet. Tap Add Route to add the first one.";
        } else if (!shown.length) {
            countEl.textContent = "No route has a street, route or area matching “" + searchEl.value.trim() + "”.";
        } else if (term) {
            countEl.textContent = shown.length + " route" + (shown.length === 1 ? "" : "s") + " match.";
        } else {
            countEl.textContent = list.length + " route" + (list.length === 1 ? "" : "s") + ", " +
                streetTotal + " street" + (streetTotal === 1 ? "" : "s") + ".";
        }
        document.getElementById("rs-export").disabled = !list.length;
    }

    /* ---------- Form ---------- */

    function updateStreetsCount() {
        var n = parseStreets(fields.streets.value).length;
        streetsCount.textContent = n ? n + " street" + (n === 1 ? "" : "s") : "";
    }

    function readForm() {
        return {
            route: fields.route.value.trim().replace(/^route\s+/i, ""),
            day: fields.day.value,
            area: fields.area.value.trim(),
            streets: parseStreets(fields.streets.value),
            notes: fields.notes.value.trim()
        };
    }

    function resetForm() {
        editingId = null;
        formTitle.textContent = "Add Route";
        submitBtn.textContent = "Save Route";
        form.reset();
        showError("");
        updateStreetsCount();
    }

    function startEdit(id) {
        var r = load().filter(function (e) { return e.id === id; })[0];
        if (!r) return;
        editingId = id;
        fields.route.value = r.route || "";
        fields.day.value = r.day || "";
        fields.area.value = r.area || "";
        fields.streets.value = (r.streets || []).join("\n");
        fields.notes.value = r.notes || "";
        formTitle.textContent = "Edit Route " + r.route;
        submitBtn.textContent = "Save Changes";
        showError("");
        updateStreetsCount();
        entryDialog.open();
    }

    /* ---------- Dialog ---------- */

    // Close, the X and Escape all close it; anything typed but not saved is discarded
    var entryDialog = TrackerDialog(document.getElementById("rs-dialog"), {
        focus: fields.route,
        onClose: resetForm
    });

    document.getElementById("rs-open").addEventListener("click", function () {
        resetForm();
        entryDialog.open();
    });

    fields.streets.addEventListener("input", updateStreetsCount);

    function newId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var data = readForm();
        if (!data.route) {
            showError("Enter the route.");
            fields.route.focus();
            return;
        }
        var list = load();
        var duplicate = list.some(function (r) {
            return r.id !== editingId && String(r.route).toLowerCase() === data.route.toLowerCase();
        });
        if (duplicate) {
            showError("Route " + data.route + " is already in the list. Edit that route instead.");
            fields.route.focus();
            return;
        }

        var existing = editingId ? list.filter(function (r) { return r.id === editingId; })[0] : null;
        if (existing) {
            Object.keys(data).forEach(function (k) { existing[k] = data[k]; });
            existing.updated = Date.now();
        } else {
            data.id = newId();
            data.mapUrl = "";
            data.created = Date.now();
            list.push(data);
        }
        if (!save(list)) {
            showError("Could not save. Storage is unavailable in this browser.");
            return;
        }
        render();
        entryDialog.close();
    });

    function remove(id) {
        var r = load().filter(function (e) { return e.id === id; })[0];
        if (!r) return;
        var n = (r.streets || []).length;
        TrackerDialog.confirmDelete({
            title: "Delete route?",
            message: "Route " + r.route + " and its list of " + n + " street" + (n === 1 ? "" : "s") +
                " will be deleted. This cannot be undone.",
            confirmLabel: "Delete route"
        }, function () {
            save(load().filter(function (e) { return e.id !== id; }));
            render();
        });
    }

    searchEl.addEventListener("input", render);

    /* ---------- CSV export ---------- */

    function csvCell(value) {
        var text = String(value == null ? "" : value);
        if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    }

    // One row per street, so the file sorts and filters well in a spreadsheet
    document.getElementById("rs-export").addEventListener("click", function () {
        var rows = [["Route", "Service Day", "Area", "Street", "Notes"]];
        load().sort(byRoute).forEach(function (r) {
            var streets = (r.streets || []).length ? r.streets : [""];
            streets.forEach(function (s) { rows.push([r.route, r.day, r.area, s, r.notes]); });
        });
        var csv = "﻿" + rows.map(function (row) { return row.map(csvCell).join(","); }).join("\r\n");

        var url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        var link = document.createElement("a");
        link.href = url;
        link.download = "route-streets-" + dateString(new Date()) + ".csv";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    });

    // Another open copy of this page changed the list
    window.addEventListener("storage", function (ev) {
        if (ev.key === KEY) render();
    });

    /* ---------- Start ---------- */

    DAYS.forEach(function (d) {
        var opt = el("option", null, d || "—");
        opt.value = d;
        fields.day.appendChild(opt);
    });
    resetForm();
    render();
})();
