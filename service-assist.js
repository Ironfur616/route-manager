/* Handicap & elderly service list (service-assist.html).
   Same running-log pattern as the other trackers: data lives in localStorage, not in a draft,
   and the page opts out of the shell's draft handling with data-no-draft on <html>.

   Customers are a standing weekly list, one section per weekday (Mon-Fri). Checking a customer
   off stamps completedOn (the date) and completedAt (the time). Once that date has passed, the
   check is moved into the Service Log and the checkbox is cleared for the next week. The rollover
   runs on load, when the app comes back to the front, and once a minute while it stays open, so
   it also happens if the page is left open overnight. */
(function () {
    "use strict";

    var KEY = "fleetMgrServiceCustomers";
    var LOG_KEY = "fleetMgrServiceLog";

    var DAYS = [
        { value: "mon", label: "Monday" },
        { value: "tue", label: "Tuesday" },
        { value: "wed", label: "Wednesday" },
        { value: "thu", label: "Thursday" },
        { value: "fri", label: "Friday" }
    ];

    var form = document.getElementById("sv-form");
    var fields = {
        day: document.getElementById("sv-day"),
        address: document.getElementById("sv-address"),
        boro: document.getElementById("sv-boro"),
        notes: document.getElementById("sv-notes")
    };
    var submitBtn = document.getElementById("sv-submit");
    var formTitle = document.getElementById("sv-form-title");
    var message = document.getElementById("sv-message");
    var daysEl = document.getElementById("sv-days");
    var summaryEl = document.getElementById("sv-summary");
    var logEl = document.getElementById("sv-log");
    var logCountEl = document.getElementById("sv-log-count");

    var editingId = null;
    var openDays = {};
    var lastDate = null;

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
            weekday: "short", month: "short", day: "numeric", year: "numeric"
        });
    }

    function prettyTime(ms) {
        return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }

    function prettyStamp(ms) {
        return new Date(ms).toLocaleString(undefined, {
            month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
        });
    }

    function dayLabel(value) {
        for (var i = 0; i < DAYS.length; i++) {
            if (DAYS[i].value === value) return DAYS[i].label;
        }
        return value;
    }

    // Today's weekday section, or Monday on a weekend (the next service day)
    function todayDay() {
        var d = new Date().getDay();
        return d >= 1 && d <= 5 ? DAYS[d - 1].value : "mon";
    }

    function isDone(c) {
        return !!c.completedOn;
    }

    function say(text) {
        message.textContent = text;
    }

    /* ---------- Storage ---------- */

    function readList(key) {
        try {
            var data = JSON.parse(localStorage.getItem(key) || "[]");
            return Array.isArray(data) ? data.filter(function (e) { return e && e.id; }) : [];
        } catch (e) {
            return [];
        }
    }

    function writeList(key, list) {
        try {
            localStorage.setItem(key, JSON.stringify(list));
            document.getElementById("sv-storage-warning").hidden = true;
            return true;
        } catch (e) {
            document.getElementById("sv-storage-warning").hidden = false;
            return false;
        }
    }

    function load() {
        return readList(KEY);
    }

    function save(list) {
        return writeList(KEY, list);
    }

    function updateCustomer(id, patch) {
        var list = load();
        list.forEach(function (c) {
            if (c.id === id) {
                Object.keys(patch).forEach(function (k) { c[k] = patch[k]; });
                c.updated = Date.now();
            }
        });
        save(list);
        render();
    }

    function newId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    /* ---------- End-of-day rollover ---------- */

    // Any check made on an earlier date goes into the log, then the checkbox is cleared.
    // The log is written first, so a failed write never loses a completed check.
    function rollover() {
        var today = dateString(new Date());
        lastDate = today;
        var list = load();
        var due = list.filter(function (c) { return c.completedOn && c.completedOn < today; });
        if (!due.length) return false;

        var log = readList(LOG_KEY);
        var now = Date.now();
        due.forEach(function (c) {
            log.push({
                id: newId(),
                customerId: c.id,
                day: c.day,
                address: c.address,
                boro: c.boro,
                notes: c.notes,
                serviceDate: c.completedOn,
                completedAt: c.completedAt,
                loggedAt: now
            });
        });
        if (!writeList(LOG_KEY, log)) return false;

        due.forEach(function (c) {
            c.completedOn = "";
            c.completedAt = null;
        });
        save(list);
        return true;
    }

    function checkForNewDay() {
        if (dateString(new Date()) === lastDate) return;
        openDays = {}; // so the new day's section opens on its own
        rollover();
        render();
    }

    /* ---------- Rendering ---------- */

    function renderDatalist(list) {
        var seen = {};
        var dl = document.getElementById("dl-sv-boro");
        dl.textContent = "";
        list.forEach(function (c) {
            var v = (c.boro || "").trim();
            if (v && !seen[v.toLowerCase()]) {
                seen[v.toLowerCase()] = true;
                dl.appendChild(el("option")).value = v;
            }
        });
    }

    function buildCard(c) {
        var done = isDone(c);
        var card = el("article", "mt-entry sv-entry" + (done ? " sv-done" : ""));

        var head = el("div", "mt-entry-head");
        head.appendChild(el("h3", "mt-entry-address", c.address));
        card.appendChild(head);

        var chips = el("div", "mt-chips");
        if (done) chips.appendChild(el("span", "mt-chip mt-chip-done", "⚑ Completed " + prettyTime(c.completedAt)));
        if (c.boro) chips.appendChild(el("span", "mt-chip", c.boro));
        if (chips.childNodes.length) card.appendChild(chips);

        if (c.notes) card.appendChild(el("p", "mt-entry-notes", c.notes));

        var checkId = "sv-done-" + c.id;
        var check = el("div", "mt-entry-contacted sv-check");
        var box = el("input");
        box.type = "checkbox";
        box.id = checkId;
        box.checked = done;
        box.addEventListener("change", function () {
            updateCustomer(c.id, box.checked
                ? { completedOn: dateString(new Date()), completedAt: Date.now() }
                : { completedOn: "", completedAt: null });
        });
        var label = el("label", null, "Completed");
        label.htmlFor = checkId;
        check.appendChild(box);
        check.appendChild(label);
        card.appendChild(check);

        var actions = el("div", "mt-entry-actions");
        var edit = el("button", "mt-btn", "Edit");
        edit.type = "button";
        edit.setAttribute("aria-label", "Edit " + c.address);
        edit.addEventListener("click", function () { startEdit(c.id); });
        var del = el("button", "mt-btn mt-btn-danger", "Delete");
        del.type = "button";
        del.setAttribute("aria-label", "Delete " + c.address);
        del.addEventListener("click", function () { remove(c.id); });
        actions.appendChild(edit);
        actions.appendChild(del);
        card.appendChild(actions);

        return card;
    }

    function renderDays(list) {
        var today = todayDay();
        daysEl.textContent = "";

        DAYS.forEach(function (d) {
            var customers = list.filter(function (c) { return c.day === d.value; });
            var doneCount = customers.filter(isDone).length;

            var section = el("details", "sv-day" + (d.value === today ? " sv-today" : ""));
            if (openDays[d.value] === undefined) openDays[d.value] = d.value === today;
            section.open = openDays[d.value];
            section.addEventListener("toggle", function () { openDays[d.value] = section.open; });

            var summary = el("summary");
            summary.appendChild(el("span", "sv-day-name", d.label));
            if (d.value === today) summary.appendChild(el("span", "mt-chip sv-chip-today", "Today"));
            summary.appendChild(el("span", "sv-day-count", customers.length
                ? doneCount + " of " + customers.length + " done"
                : "No customers"));
            section.appendChild(summary);

            var body = el("div", "sv-day-body");
            var cards = el("div", "mt-list");
            customers.forEach(function (c) { cards.appendChild(buildCard(c)); });
            body.appendChild(cards);

            var add = el("button", "mt-btn sv-add-day", "+ Add customer to " + d.label);
            add.type = "button";
            add.addEventListener("click", function () { startAdd(d.value); });
            body.appendChild(add);

            section.appendChild(body);
            daysEl.appendChild(section);
        });

        summaryEl.textContent = list.length
            ? list.length + " customer" + (list.length === 1 ? "" : "s") + " on the weekly list."
            : "No customers yet. Tap Add Customer, or open a day and add one there.";
    }

    // Newest service day first, each day's checks in the order they were made
    function renderLog() {
        var log = readList(LOG_KEY).sort(function (a, b) {
            if (a.serviceDate !== b.serviceDate) return a.serviceDate < b.serviceDate ? 1 : -1;
            return (a.completedAt || 0) - (b.completedAt || 0);
        });
        logEl.textContent = "";

        var groups = [];
        log.forEach(function (entry) {
            var last = groups[groups.length - 1];
            if (!last || last.date !== entry.serviceDate) groups.push(last = { date: entry.serviceDate, items: [] });
            last.items.push(entry);
        });

        groups.forEach(function (g) {
            var group = el("section", "sv-log-group");
            group.appendChild(el("h3", "sv-log-date",
                prettyDate(g.date) + " · " + g.items.length + " collected"));
            g.items.forEach(function (entry) {
                var row = el("div", "sv-log-row");
                var top = el("div", "mt-entry-head");
                top.appendChild(el("span", "sv-log-address", entry.address));
                top.appendChild(el("span", "mt-entry-date", entry.completedAt ? prettyTime(entry.completedAt) : ""));
                row.appendChild(top);
                var meta = [dayLabel(entry.day)];
                if (entry.boro) meta.push(entry.boro);
                meta.push("Logged " + prettyStamp(entry.loggedAt));
                row.appendChild(el("p", "mt-entry-meta", meta.join(" · ")));
                if (entry.notes) row.appendChild(el("p", "mt-entry-notes", entry.notes));
                group.appendChild(row);
            });
            logEl.appendChild(group);
        });

        logCountEl.textContent = log.length
            ? log.length + " completed service" + (log.length === 1 ? "" : "s") + " logged."
            : "Nothing logged yet. Completed customers are logged here the day after they're checked off.";
        document.getElementById("sv-export").disabled = !log.length;
    }

    function render() {
        var list = load().sort(function (a, b) { return (a.created || 0) - (b.created || 0); });
        renderDatalist(list);
        renderDays(list);
        renderLog();
    }

    /* ---------- Form ---------- */

    function readForm() {
        return {
            day: fields.day.value,
            address: fields.address.value.trim(),
            boro: fields.boro.value.trim(),
            notes: fields.notes.value.trim()
        };
    }

    function resetForm() {
        editingId = null;
        formTitle.textContent = "Add Customer";
        submitBtn.textContent = "Save Customer";
        form.reset();
        fields.day.value = todayDay();
    }

    function startAdd(day) {
        resetForm();
        fields.day.value = day;
        say("");
        entryDialog.open();
    }

    function startEdit(id) {
        var c = load().filter(function (e) { return e.id === id; })[0];
        if (!c) return;
        editingId = id;
        fields.day.value = c.day;
        fields.address.value = c.address || "";
        fields.boro.value = c.boro || "";
        fields.notes.value = c.notes || "";
        formTitle.textContent = "Edit Customer";
        submitBtn.textContent = "Save Changes";
        say("");
        entryDialog.open();
    }

    /* ---------- Dialog ---------- */

    // Close, the X and Escape all close it; anything typed but not saved is discarded
    var entryDialog = TrackerDialog(document.getElementById("sv-dialog"), {
        focus: fields.address,
        onClose: function () {
            resetForm();
            say("");
        }
    });

    document.getElementById("sv-open").addEventListener("click", function () { startAdd(todayDay()); });

    form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var data = readForm();
        var list = load();
        var existing = editingId ? list.filter(function (c) { return c.id === editingId; })[0] : null;

        if (existing) {
            Object.keys(data).forEach(function (k) { existing[k] = data[k]; });
            existing.updated = Date.now();
        } else {
            data.id = newId();
            data.completedOn = "";
            data.completedAt = null;
            data.created = Date.now();
            list.push(data);
        }
        if (!save(list)) {
            say("Could not save. Storage is unavailable in this browser.");
            return;
        }

        // Show the day the customer was saved to
        openDays[data.day] = true;
        render();
        entryDialog.close();
    });

    function remove(id) {
        if (!confirm("Remove this customer from the weekly list? Their past service log entries are kept.")) return;
        save(load().filter(function (c) { return c.id !== id; }));
        render();
    }

    /* ---------- CSV export ---------- */

    function csvCell(value) {
        var text = String(value == null ? "" : value);
        if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    }

    document.getElementById("sv-export").addEventListener("click", function () {
        var log = readList(LOG_KEY).sort(function (a, b) {
            return a.serviceDate < b.serviceDate ? -1 : a.serviceDate > b.serviceDate ? 1 : (a.completedAt || 0) - (b.completedAt || 0);
        });
        var rows = [["Service Date", "Day", "Address", "Boro / Twp", "Completed At", "Logged At", "Notes"]];
        log.forEach(function (e) {
            rows.push([e.serviceDate, dayLabel(e.day), e.address, e.boro,
                e.completedAt ? prettyStamp(e.completedAt) : "", prettyStamp(e.loggedAt), e.notes]);
        });
        var csv = "﻿" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");

        var url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        var link = document.createElement("a");
        link.href = url;
        link.download = "service-log-" + dateString(new Date()) + ".csv";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    });

    // Another open copy of this page changed the list or the log
    window.addEventListener("storage", function (ev) {
        if (ev.key === KEY || ev.key === LOG_KEY) render();
    });

    // Catch the day changing while the app sits open or in the background
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") checkForNewDay();
    });
    setInterval(checkForNewDay, 60000);

    /* ---------- Start ---------- */

    DAYS.forEach(function (d) {
        var opt = el("option", null, d.label);
        opt.value = d.value;
        fields.day.appendChild(opt);
    });
    resetForm();
    rollover();
    render();
})();
