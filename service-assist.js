/* Handicap & elderly service list (service-assist.html).
   Same running-log pattern as the other trackers: data lives in localStorage, not in a draft,
   and the page opts out of the shell's draft handling with data-no-draft on <html>.

   Customers are a standing weekly list, one section per weekday (Mon-Fri). Checking a customer
   off stamps completedOn (the date) and completedAt (the time). Once that date has passed, the
   check is moved into the Service Log and the checkbox is cleared for the next week. The rollover
   runs on load, when the app comes back to the front, and once a minute while it stays open, so
   it also happens if the page is left open overnight.

   Holiday and split weeks: each route day can be worked on a different date that week (Mon-Sat),
   set in This Week's Schedule. Only changed days are stored, keyed by the week's Monday, so a
   new week starts back on the normal schedule by itself. The schedule decides which route is
   "Today"; the log always records the real date a customer was checked off, and shows when that
   differs from the route's normal weekday. */
(function () {
    "use strict";

    var KEY = "fleetMgrServiceCustomers";
    var LOG_KEY = "fleetMgrServiceLog";
    var SCHEDULE_KEY = "fleetMgrServiceSchedule";

    var DAYS = [
        { value: "mon", label: "Monday", short: "Mon" },
        { value: "tue", label: "Tuesday", short: "Tue" },
        { value: "wed", label: "Wednesday", short: "Wed" },
        { value: "thu", label: "Thursday", short: "Thu" },
        { value: "fri", label: "Friday", short: "Fri" }
    ];
    var WORK_DAYS_IN_WEEK = 6; // a route can be moved to any day Monday-Saturday

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

    function parseDate(value) {
        var p = String(value).split("-");
        return p.length === 3 ? new Date(+p[0], +p[1] - 1, +p[2]) : null;
    }

    // "Tue, Oct 13"
    function shortDate(value) {
        var d = parseDate(value);
        return d ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : value;
    }

    function weekdayName(value) {
        var d = parseDate(value);
        return d ? d.toLocaleDateString(undefined, { weekday: "short" }) : value;
    }

    function addDays(value, n) {
        var d = parseDate(value);
        d.setDate(d.getDate() + n);
        return dateString(d);
    }

    // The Monday of the week a date falls in (Sunday counts with the week before it)
    function weekStartOf(value) {
        var d = parseDate(value);
        return addDays(value, -((d.getDay() + 6) % 7));
    }

    function dayIndex(day) {
        for (var i = 0; i < DAYS.length; i++) {
            if (DAYS[i].value === day) return i;
        }
        return 0;
    }

    // The date a route is normally worked in the week containing `value`
    function normalDate(day, value) {
        return addDays(weekStartOf(value), dayIndex(day));
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

    /* ---------- Weekly schedule ---------- */

    function loadSchedule() {
        try {
            var data = JSON.parse(localStorage.getItem(SCHEDULE_KEY) || "{}");
            return data && typeof data === "object" && !Array.isArray(data) ? data : {};
        } catch (e) {
            return {};
        }
    }

    function thisWeek() {
        return weekStartOf(dateString(new Date()));
    }

    function saveSchedule(changes) {
        var all = loadSchedule();
        var week = thisWeek();
        // Earlier weeks are never shown again, so they're dropped instead of piling up
        Object.keys(all).forEach(function (k) { if (k < week) delete all[k]; });
        if (Object.keys(changes).length) all[week] = changes;
        else delete all[week];
        try {
            localStorage.setItem(SCHEDULE_KEY, JSON.stringify(all));
        } catch (e) {
            document.getElementById("sv-storage-warning").hidden = false;
        }
    }

    // Only routes moved off their normal date are stored for the week
    function weekChanges() {
        return loadSchedule()[thisWeek()] || {};
    }

    function scheduledDate(day) {
        return weekChanges()[day] || normalDate(day, dateString(new Date()));
    }

    function isMoved(day) {
        return scheduledDate(day) !== normalDate(day, dateString(new Date()));
    }

    function isWorkedToday(day) {
        return scheduledDate(day) === dateString(new Date());
    }

    // Routes worked today. With none (a day off, or the weekend), the next one coming up this
    // week, or Monday's once the week is done.
    function todayDays() {
        var today = dateString(new Date());
        var onToday = DAYS.filter(function (d) { return isWorkedToday(d.value); })
            .map(function (d) { return d.value; });
        if (onToday.length) return onToday;
        var upcoming = DAYS.filter(function (d) { return scheduledDate(d.value) > today; })
            .sort(function (a, b) { return scheduledDate(a.value) < scheduledDate(b.value) ? -1 : 1; });
        return [upcoming.length ? upcoming[0].value : "mon"];
    }

    function todayDay() {
        return todayDays()[0];
    }

    function applySchedule(changes) {
        saveSchedule(changes);
        openDays = {}; // reopen whichever route is now today's
        render();
    }

    function setRouteDate(day, value) {
        var changes = weekChanges();
        if (value === normalDate(day, dateString(new Date()))) delete changes[day];
        else changes[day] = value;
        applySchedule(changes);
    }

    function renderSchedule() {
        var grid = document.getElementById("sv-schedule-grid");
        var week = thisWeek();
        grid.textContent = "";

        DAYS.forEach(function (d) {
            var id = "sv-sched-" + d.value;
            var field = el("div", "field sv-schedule-field" + (isMoved(d.value) ? " sv-moved" : ""));
            var label = el("label", null, d.label + " route");
            label.htmlFor = id;
            var select = el("select");
            select.id = id;
            for (var i = 0; i < WORK_DAYS_IN_WEEK; i++) {
                var value = addDays(week, i);
                select.appendChild(el("option", null, shortDate(value))).value = value;
            }
            select.value = scheduledDate(d.value);
            select.addEventListener("change", function () { setRouteDate(d.value, select.value); });
            field.appendChild(label);
            field.appendChild(select);
            grid.appendChild(field);
        });

        var moved = DAYS.filter(function (d) { return isMoved(d.value); });
        var status = document.getElementById("sv-schedule-status");
        status.textContent = moved.length
            ? "Changed: " + moved.map(function (d) { return d.short + " \u2192 " + weekdayName(scheduledDate(d.value)); }).join(", ")
            : "Normal week (Mon\u2013Fri)";
        status.classList.toggle("sv-schedule-changed", !!moved.length);
    }

    document.getElementById("sv-holiday").addEventListener("click", function () {
        var changes = {};
        DAYS.forEach(function (d, i) { changes[d.value] = addDays(thisWeek(), i + 1); });
        applySchedule(changes);
    });

    document.getElementById("sv-reset-week").addEventListener("click", function () {
        applySchedule({});
    });

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
        var focus = todayDays();
        daysEl.textContent = "";

        DAYS.forEach(function (d) {
            var customers = list.filter(function (c) { return c.day === d.value; });
            var doneCount = customers.filter(isDone).length;

            var worked = isWorkedToday(d.value);
            var section = el("details", "sv-day" + (worked ? " sv-today" : ""));
            if (openDays[d.value] === undefined) openDays[d.value] = focus.indexOf(d.value) !== -1;
            section.open = openDays[d.value];
            section.addEventListener("toggle", function () { openDays[d.value] = section.open; });

            var summary = el("summary");
            summary.appendChild(el("span", "sv-day-name", d.label + " route"));
            if (worked) summary.appendChild(el("span", "mt-chip sv-chip-today", "Today"));
            if (isMoved(d.value)) summary.appendChild(el("span", "mt-chip sv-chip-moved", "Moved"));
            summary.appendChild(el("span", "sv-day-date", shortDate(scheduledDate(d.value))));
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
                var meta = [dayLabel(entry.day) + " route"];
                var normal = normalDate(entry.day, entry.serviceDate);
                if (entry.serviceDate !== normal) meta.push("moved from " + weekdayName(normal));
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
        renderSchedule();
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
        var c = load().filter(function (e) { return e.id === id; })[0];
        if (!c) return;
        TrackerDialog.confirmDelete({
            title: "Remove customer?",
            message: c.address + " will be taken off the " + dayLabel(c.day) +
                " route. Their past Service Log entries are kept.",
            confirmLabel: "Remove customer",
            requireCheck: "I confirm this customer should be removed from the service list"
        }, function () {
            save(load().filter(function (e) { return e.id !== id; }));
            render();
        });
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
        var rows = [["Service Date", "Route Day", "Moved From Normal Day", "Address", "Boro / Twp",
            "Completed At", "Logged At", "Notes"]];
        log.forEach(function (e) {
            var normal = normalDate(e.day, e.serviceDate);
            rows.push([e.serviceDate, dayLabel(e.day), normal === e.serviceDate ? "No" : "Yes (" + normal + ")", e.address, e.boro,
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
