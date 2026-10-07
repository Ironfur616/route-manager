/* Bulk pickup request tracker (bulk-pickup.html).
   Same running-log pattern as new-customers.js: entries live in localStorage until deleted,
   not in a draft. The page opts out of the shell's draft handling with data-no-draft on <html>.

   Only one exception from that pattern: there's no multi-stage status bar. An entry is simply
   "upcoming" through its Scheduled Pickup Date (today included, since the pickup hasn't
   happened yet that day), and starting the day after, it's considered done and moves into the
   collapsible Completed Pickups section - recomputed on every render, same as New Customers'
   established-customer cutoff, just a single threshold instead of several. */
(function () {
    "use strict";

    var KEY = "fleetMgrBulkPickup";

    var form = document.getElementById("bp-form");
    var fields = {
        address: document.getElementById("bp-address"),
        route: document.getElementById("bp-route"),
        driver: document.getElementById("bp-driver"),
        pickupDate: document.getElementById("bp-date"),
        items: document.getElementById("bp-items")
    };
    var submitBtn = document.getElementById("bp-submit");
    var formTitle = document.getElementById("bp-form-title");
    var message = document.getElementById("bp-message");
    var listEl = document.getElementById("bp-list");
    var completedListEl = document.getElementById("bp-completed-list");
    var countEl = document.getElementById("bp-count");
    var completedCountEl = document.getElementById("stat-completed");
    var searchEl = document.getElementById("bp-search");

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

    function prettyDate(value) {
        var p = String(value).split("-");
        if (p.length !== 3) return value;
        return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, {
            month: "short", day: "numeric", year: "numeric"
        });
    }

    // ISO date strings compare correctly with plain string comparison (YYYY-MM-DD)
    function isCompleted(e) {
        return e.pickupDate < dateString(new Date());
    }

    function say(text) {
        message.textContent = text;
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
            return true;
        } catch (e) {
            say("Could not save. Storage is unavailable in this browser.");
            return false;
        }
    }

    function updateEntry(id, patch) {
        var list = load();
        list.forEach(function (e) {
            if (e.id === id) {
                Object.keys(patch).forEach(function (k) { e[k] = patch[k]; });
                e.updated = Date.now();
            }
        });
        save(list);
        render();
    }

    function byPickupDate(a, b) {
        return a.pickupDate < b.pickupDate ? -1 : a.pickupDate > b.pickupDate ? 1 : 0;
    }

    /* ---------- Rendering ---------- */

    function renderDatalists(entries) {
        [["dl-bp-address", "address"], ["dl-bp-route", "route"], ["dl-bp-driver", "driver"]]
            .forEach(function (pair) {
                var seen = {};
                var list = document.getElementById(pair[0]);
                list.textContent = "";
                entries.forEach(function (e) {
                    var v = (e[pair[1]] || "").trim();
                    if (v && !seen[v.toLowerCase()]) {
                        seen[v.toLowerCase()] = true;
                        list.appendChild(el("option")).value = v;
                    }
                });
            });
    }

    function matchesSearch(e, term) {
        if (!term) return true;
        return [e.address, e.route, e.driver, e.items, e.notes].join(" ").toLowerCase().indexOf(term) !== -1;
    }

    function buildCard(e) {
        var card = el("article", "mt-entry bp-entry");

        var head = el("div", "mt-entry-head");
        head.appendChild(el("h3", "mt-entry-address", e.address));
        head.appendChild(el("span", "mt-entry-date", "Pickup " + prettyDate(e.pickupDate)));
        card.appendChild(head);

        var chips = el("div", "mt-chips");
        if (e.route) chips.appendChild(el("span", "mt-chip", "Route " + e.route));
        chips.appendChild(el("span", "mt-chip mt-chip-status", isCompleted(e) ? "Completed" : "Upcoming"));
        card.appendChild(chips);

        if (e.driver) card.appendChild(el("p", "mt-entry-meta", e.driver));
        if (e.items) card.appendChild(el("p", "mt-entry-meta", e.items));

        var notesField = el("div", "nc-notes-field");
        var notesLabelId = "bp-notes-label-" + e.id;
        notesField.appendChild(el("label", "nc-notes-label", "Notes")).id = notesLabelId;
        var notes = document.createElement("textarea");
        notes.className = "nc-notes";
        notes.rows = 2;
        notes.setAttribute("aria-labelledby", notesLabelId);
        notes.value = e.notes || "";
        notes.addEventListener("blur", function () {
            if (notes.value !== (e.notes || "")) updateEntry(e.id, { notes: notes.value });
        });
        notesField.appendChild(notes);
        card.appendChild(notesField);

        var actions = el("div", "mt-entry-actions");
        var edit = el("button", "mt-btn", "Edit");
        edit.type = "button";
        edit.setAttribute("aria-label", "Edit " + e.address);
        edit.addEventListener("click", function () { startEdit(e.id); });
        var del = el("button", "mt-btn mt-btn-danger", "Delete");
        del.type = "button";
        del.setAttribute("aria-label", "Delete " + e.address);
        del.addEventListener("click", function () { remove(e.id); });
        actions.appendChild(edit);
        actions.appendChild(del);
        card.appendChild(actions);

        return card;
    }

    function render() {
        var entries = load();
        var term = searchEl.value.trim().toLowerCase();

        renderDatalists(entries);

        var matching = entries.filter(function (e) { return matchesSearch(e, term); });
        var upcoming = matching.filter(function (e) { return !isCompleted(e); }).sort(byPickupDate);
        var completed = matching.filter(isCompleted).sort(byPickupDate).reverse();

        listEl.textContent = "";
        upcoming.forEach(function (e) { listEl.appendChild(buildCard(e)); });

        completedListEl.textContent = "";
        completed.forEach(function (e) { completedListEl.appendChild(buildCard(e)); });
        completedCountEl.textContent = completed.length;

        if (!entries.length) {
            countEl.textContent = "No bulk pickup requests logged yet. Tap Add Bulk Pickup Request to add the first one.";
        } else if (!upcoming.length) {
            countEl.textContent = term ? "Nothing matches the current search." : "No upcoming pickups. Check Completed Pickups below.";
        } else {
            countEl.textContent = "Showing " + upcoming.length + " of " + entries.filter(function (e) { return !isCompleted(e); }).length;
        }
        document.getElementById("bp-export").disabled = !entries.length;
    }

    /* ---------- Form ---------- */

    function readForm() {
        return {
            address: fields.address.value.trim(),
            route: fields.route.value.trim(),
            driver: fields.driver.value.trim(),
            pickupDate: fields.pickupDate.value,
            items: fields.items.value.trim()
        };
    }

    function resetForm() {
        editingId = null;
        formTitle.textContent = "Add Bulk Pickup Request";
        submitBtn.textContent = "Save Entry";
        form.reset();
    }

    function startEdit(id) {
        var entry = load().filter(function (e) { return e.id === id; })[0];
        if (!entry) return;
        editingId = id;
        fields.address.value = entry.address || "";
        fields.route.value = entry.route || "";
        fields.driver.value = entry.driver || "";
        fields.pickupDate.value = entry.pickupDate || "";
        fields.items.value = entry.items || "";
        formTitle.textContent = "Edit Request";
        submitBtn.textContent = "Save Changes";
        say("");
        entryDialog.open();
    }

    /* ---------- Dialog ---------- */

    // Close, the X and Escape all close it; anything typed but not saved is discarded
    var entryDialog = TrackerDialog(document.getElementById("bp-dialog"), {
        focus: fields.address,
        onClose: function () {
            resetForm();
            say("");
        }
    });

    document.getElementById("bp-open").addEventListener("click", function () {
        resetForm();
        say("");
        entryDialog.open();
    });

    function newId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var data = readForm();
        var list = load();
        var existing = editingId ? list.filter(function (e) { return e.id === editingId; })[0] : null;

        if (existing) {
            Object.keys(data).forEach(function (k) { existing[k] = data[k]; });
            existing.updated = Date.now();
        } else {
            data.id = newId();
            data.notes = "";
            data.created = Date.now();
            list.push(data);
        }
        if (!save(list)) return;

        render();
        entryDialog.close();
    });

    function remove(id) {
        var entry = load().filter(function (e) { return e.id === id; })[0];
        if (!entry) return;
        TrackerDialog.confirmDelete({
            title: "Delete pickup request?",
            message: "The bulk pickup at " + entry.address + " (" + prettyDate(entry.pickupDate) +
                ") will be deleted. This cannot be undone.",
            confirmLabel: "Delete request"
        }, function () {
            save(load().filter(function (e) { return e.id !== id; }));
            if (editingId === id) resetForm();
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

    document.getElementById("bp-export").addEventListener("click", function () {
        var entries = load().sort(byPickupDate);
        var rows = [["Address", "Route", "Driver", "Scheduled Pickup Date", "Status", "Items / Description", "Notes"]];
        entries.forEach(function (e) {
            rows.push([e.address, e.route, e.driver, e.pickupDate, isCompleted(e) ? "Completed" : "Upcoming", e.items, e.notes]);
        });
        var csv = "﻿" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");

        var url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        var link = document.createElement("a");
        link.href = url;
        link.download = "bulk-pickup-requests-" + dateString(new Date()) + ".csv";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    });

    // Another open copy of this page changed the log
    window.addEventListener("storage", function (ev) {
        if (ev.key === KEY) render();
    });

    /* ---------- Start ---------- */

    resetForm();
    render();
})();
