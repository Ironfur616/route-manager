/* New customer tracker (new-customers.html).
   Same running-log pattern as missed-tracker.js: entries live in localStorage until deleted,
   not in a draft. The page opts out of the shell's draft handling with data-no-draft on <html>.

   Each entry's status bar color is never set by hand — it's computed from how many days have
   passed between today and the customer's 1st Day of Service:
     before day 0   -> "pending"     orange bar + a light orange wash across the whole card
     day 0-29       -> "new"         blue bar
     day 30-59      -> "settling"    green bar
     day 60-89      -> "active"      no color, still in the main list
     day 90+        -> "established" no color, moved into the Established Customers section
   Recomputed on every render, so a card's color/section can change just from time passing,
   even if nobody edits the entry. */
(function () {
    "use strict";

    var KEY = "fleetMgrNewCustomers";
    var TYPES = ["Residential", "Commercial"];

    var form = document.getElementById("nc-form");
    var fields = {
        address: document.getElementById("nc-address"),
        type: document.getElementById("nc-type"),
        route: document.getElementById("nc-route"),
        driver: document.getElementById("nc-driver"),
        firstDay: document.getElementById("nc-first-day")
    };
    var submitBtn = document.getElementById("nc-submit");
    var formTitle = document.getElementById("nc-form-title");
    var message = document.getElementById("nc-message");
    var listEl = document.getElementById("nc-list");
    var establishedListEl = document.getElementById("nc-established-list");
    var countEl = document.getElementById("nc-count");
    var establishedCountEl = document.getElementById("stat-established");
    var searchEl = document.getElementById("nc-search");

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

    // Whole days between the customer's 1st Day of Service and today (negative if still upcoming)
    function daysSince(firstDay) {
        var p = String(firstDay).split("-");
        if (p.length !== 3) return 0;
        var first = new Date(+p[0], +p[1] - 1, +p[2]);
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        first.setHours(0, 0, 0, 0);
        return Math.round((today - first) / 86400000);
    }

    var STAGES = {
        pending: "Not started",
        new: "New (0-29 days)",
        settling: "Settling in (30-59 days)",
        active: "Active (60-89 days)",
        established: "Established"
    };

    function stageFor(e) {
        var d = daysSince(e.firstDay);
        if (d < 0) return "pending";
        if (d <= 29) return "new";
        if (d <= 59) return "settling";
        if (d <= 89) return "active";
        return "established";
    }

    function fillSelect(select, options) {
        select.textContent = "";
        options.forEach(function (o) {
            var opt = el("option", null, o);
            opt.value = o;
            select.appendChild(opt);
        });
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

    function byFirstDay(a, b) {
        return a.firstDay < b.firstDay ? -1 : a.firstDay > b.firstDay ? 1 : 0;
    }

    /* ---------- Rendering ---------- */

    function renderDatalists(entries) {
        [["dl-nc-address", "address"], ["dl-nc-route", "route"], ["dl-nc-driver", "driver"]]
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
        return [e.address, e.route, e.driver, e.notes, e.type].join(" ").toLowerCase().indexOf(term) !== -1;
    }

    function buildCard(e) {
        var stage = stageFor(e);
        var card = el("article", "mt-entry nc-entry nc-stage-" + stage);

        var head = el("div", "mt-entry-head");
        head.appendChild(el("h3", "mt-entry-address", e.address));
        head.appendChild(el("span", "mt-entry-date", "Service starts " + prettyDate(e.firstDay)));
        card.appendChild(head);

        var chips = el("div", "mt-chips");
        chips.appendChild(el("span", "mt-chip", e.type));
        if (e.route) chips.appendChild(el("span", "mt-chip", "Route " + e.route));
        chips.appendChild(el("span", "mt-chip mt-chip-status", STAGES[stage]));
        card.appendChild(chips);

        if (e.driver) card.appendChild(el("p", "mt-entry-meta", e.driver));

        var checks = el("div", "nc-checks");
        [
            ["informed", "Driver informed of new stop"],
            ["pushed", "New Stop Pushed to Tablet"],
            ["rmCheck", "Route Manager Check (on first day of service)"]
        ].forEach(function (pair) {
            var key = pair[0];
            var label = el("label", "nc-check");
            var input = document.createElement("input");
            input.type = "checkbox";
            input.checked = !!e[key];
            input.addEventListener("change", function () {
                var patch = {};
                patch[key] = input.checked;
                updateEntry(e.id, patch);
            });
            label.appendChild(input);
            label.appendChild(document.createTextNode(pair[1]));
            checks.appendChild(label);
        });
        card.appendChild(checks);

        var notesField = el("div", "nc-notes-field");
        var notesLabelId = "nc-notes-label-" + e.id;
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
        var active = matching.filter(function (e) { return stageFor(e) !== "established"; }).sort(byFirstDay);
        var established = matching.filter(function (e) { return stageFor(e) === "established"; }).sort(byFirstDay).reverse();

        listEl.textContent = "";
        active.forEach(function (e) { listEl.appendChild(buildCard(e)); });

        establishedListEl.textContent = "";
        established.forEach(function (e) { establishedListEl.appendChild(buildCard(e)); });
        establishedCountEl.textContent = established.length;

        if (!entries.length) {
            countEl.textContent = "No new customers logged yet. Tap Add New Customer to add the first one.";
        } else if (!active.length) {
            countEl.textContent = term ? "Nothing matches the current search." : "No active new customers. Check Established Customers below.";
        } else {
            countEl.textContent = "Showing " + active.length + " of " + entries.filter(function (e) { return stageFor(e) !== "established"; }).length;
        }
        document.getElementById("nc-export").disabled = !entries.length;
    }

    /* ---------- Form ---------- */

    function readForm() {
        return {
            address: fields.address.value.trim(),
            type: fields.type.value,
            route: fields.route.value.trim(),
            driver: fields.driver.value.trim(),
            firstDay: fields.firstDay.value
        };
    }

    function resetForm() {
        editingId = null;
        formTitle.textContent = "Add New Customer";
        submitBtn.textContent = "Save Entry";
        form.reset();
        fields.type.value = TYPES[0];
    }

    function startEdit(id) {
        var entry = load().filter(function (e) { return e.id === id; })[0];
        if (!entry) return;
        editingId = id;
        fields.address.value = entry.address || "";
        fields.type.value = entry.type || TYPES[0];
        fields.route.value = entry.route || "";
        fields.driver.value = entry.driver || "";
        fields.firstDay.value = entry.firstDay || "";
        formTitle.textContent = "Edit Customer";
        submitBtn.textContent = "Save Changes";
        say("");
        entryDialog.open();
    }

    /* ---------- Dialog ---------- */

    // Close, the X and Escape all close it; anything typed but not saved is discarded
    var entryDialog = TrackerDialog(document.getElementById("nc-dialog"), {
        focus: fields.address,
        onClose: function () {
            resetForm();
            say("");
        }
    });

    document.getElementById("nc-open").addEventListener("click", function () {
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
            data.informed = false;
            data.pushed = false;
            data.rmCheck = false;
            data.notes = "";
            data.created = Date.now();
            list.push(data);
        }
        if (!save(list)) return;

        render();
        entryDialog.close();
    });

    function remove(id) {
        if (!confirm("Delete this customer? This cannot be undone.")) return;
        save(load().filter(function (e) { return e.id !== id; }));
        if (editingId === id) resetForm();
        render();
    }

    searchEl.addEventListener("input", render);

    /* ---------- CSV export ---------- */

    function csvCell(value) {
        var text = String(value == null ? "" : value);
        if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    }

    document.getElementById("nc-export").addEventListener("click", function () {
        var entries = load().sort(byFirstDay);
        var rows = [["Address", "Type", "Route", "Driver", "1st Day of Service", "Status",
            "Driver Informed", "Pushed to Tablet", "RM Check", "Notes"]];
        entries.forEach(function (e) {
            rows.push([e.address, e.type, e.route, e.driver, e.firstDay, STAGES[stageFor(e)],
                e.informed ? "Yes" : "No", e.pushed ? "Yes" : "No", e.rmCheck ? "Yes" : "No", e.notes]);
        });
        var csv = "﻿" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");

        var url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        var link = document.createElement("a");
        link.href = url;
        link.download = "new-customers-" + dateString(new Date()) + ".csv";
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

    fillSelect(fields.type, TYPES);
    resetForm();
    render();
})();
