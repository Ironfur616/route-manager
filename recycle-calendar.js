/* Recycle calendar, opened from the calendar button at the right of the app header.
   A quick reference for which days are recycle days in each service area. Days are marked by
   hand: Edit, then pick how a tap works (one Day, a Range from a first to a last day, or a whole
   Week) and tap the calendar. Marked days are stored per area in localStorage as a sorted list
   of "YYYY-MM-DD" dates. The calendar opens view-only so a stray tap while checking it can't
   change anything.

   The header button shows a small recycle badge when today is a recycle day for the selected
   area, so the answer is visible without opening the calendar.

   Loaded only by the shell (index.html), after nav.js has built the header. */
(function () {
    "use strict";

    var KEY = "fleetMgrRecycleCalendar";
    var BUILT_IN = [
        { id: "east-washington", name: "East Washington" },
        { id: "washington", name: "Washington" }
    ];
    var WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
    var TOOLS = [
        { value: "day", label: "Day", hint: "Tap a day to mark or unmark it." },
        { value: "range", label: "Range", hint: "Tap the first day, then the last day. Every day in between is marked (or unmarked, if the first day was already marked)." },
        { value: "week", label: "Week", hint: "Tap any day to mark or unmark its whole week." }
    ];

    var header = document.querySelector(".app-header");
    if (!header) return;

    var viewMonth = startOfMonth(new Date());
    var editing = false;
    var addingArea = false;
    var tool = "day";
    var rangeStart = null; // "YYYY-MM-DD" of the first tap of a range, waiting for the second

    /* ---------- Dates ---------- */

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

    function startOfMonth(d) {
        return new Date(d.getFullYear(), d.getMonth(), 1);
    }

    function addDays(d, n) {
        var copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        copy.setDate(copy.getDate() + n);
        return copy;
    }

    function weekStart(d) {
        return addDays(d, -d.getDay());
    }

    function shortDay(value) {
        return parseDate(value).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    }

    // Consecutive dates grouped into runs: ["2026-10-05".."2026-10-08"] -> "Mon, Oct 5 – Thu, Oct 8"
    function describeRuns(dates) {
        var runs = [];
        dates.forEach(function (value) {
            var last = runs[runs.length - 1];
            if (last && dateString(addDays(parseDate(last.end), 1)) === value) last.end = value;
            else runs.push({ start: value, end: value });
        });
        return runs.map(function (r) {
            return r.start === r.end ? shortDay(r.start) : shortDay(r.start) + " – " + shortDay(r.end);
        }).join("; ");
    }

    /* ---------- Storage ---------- */

    // Calendars saved before single days could be marked stored whole weeks under each
    // week's Sunday; those become the seven marked days they stood for.
    function migrate(data) {
        if (!data.weeks) return false;
        Object.keys(data.weeks).forEach(function (areaId) {
            var days = data.days[areaId] || [];
            (data.weeks[areaId] || []).forEach(function (sunday) {
                for (var i = 0; i < 7; i++) {
                    var day = dateString(addDays(parseDate(sunday), i));
                    if (days.indexOf(day) === -1) days.push(day);
                }
            });
            data.days[areaId] = days.sort();
        });
        delete data.weeks;
        return true;
    }

    function load() {
        var data;
        try {
            data = JSON.parse(localStorage.getItem(KEY) || "{}");
        } catch (e) {
            data = {};
        }
        if (!data || typeof data !== "object") data = {};
        if (!Array.isArray(data.customAreas)) data.customAreas = [];
        if (!data.days || typeof data.days !== "object") data.days = {};
        if (migrate(data)) save(data);
        return data;
    }

    function save(data) {
        try {
            localStorage.setItem(KEY, JSON.stringify(data));
            return true;
        } catch (e) {
            return false;
        }
    }

    function areas(data) {
        return BUILT_IN.concat(data.customAreas);
    }

    function selectedArea(data) {
        var all = areas(data);
        for (var i = 0; i < all.length; i++) {
            if (all[i].id === data.selected) return all[i];
        }
        return all[0];
    }

    function daysFor(data, areaId) {
        return data.days[areaId] || [];
    }

    function isRecycleDay(data, areaId, value) {
        return daysFor(data, areaId).indexOf(value) !== -1;
    }

    // Marks (or unmarks) every date from `from` to `to`, in either order
    function setDays(from, to, marked) {
        var data = load();
        var area = selectedArea(data);
        var set = {};
        daysFor(data, area.id).forEach(function (d) { set[d] = true; });
        var a = from < to ? from : to;
        var b = from < to ? to : from;
        for (var d = parseDate(a); dateString(d) <= b; d = addDays(d, 1)) {
            if (marked) set[dateString(d)] = true;
            else delete set[dateString(d)];
        }
        data.days[area.id] = Object.keys(set).sort();
        save(data);
    }

    function tapDay(value) {
        var data = load();
        var area = selectedArea(data);
        var on = isRecycleDay(data, area.id, value);

        if (tool === "day") {
            setDays(value, value, !on);
        } else if (tool === "week") {
            var sunday = weekStart(parseDate(value));
            // Fill the week unless it's already fully marked, in which case clear it
            var full = true;
            for (var i = 0; i < 7; i++) {
                if (!isRecycleDay(data, area.id, dateString(addDays(sunday, i)))) full = false;
            }
            setDays(dateString(sunday), dateString(addDays(sunday, 6)), !full);
        } else if (!rangeStart) {
            rangeStart = value;
        } else {
            // The first day's state decides: start on an unmarked day to mark, a marked one to clear
            setDays(rangeStart, value, !isRecycleDay(data, area.id, rangeStart));
            rangeStart = null;
        }
        render();
    }

    /* ---------- Small DOM helper ---------- */

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function button(className, text, onClick) {
        var b = el("button", className, text);
        b.type = "button";
        b.addEventListener("click", onClick);
        return b;
    }

    /* ---------- Header button ---------- */

    var openBtn = el("button", "rc-open");
    openBtn.type = "button";
    openBtn.setAttribute("aria-label", "Recycle calendar");
    openBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">' +
            '<rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
            '<path d="M3 10h18M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
            '<rect x="7" y="13" width="3" height="3" rx="0.5" fill="currentColor"/>' +
        "</svg>" +
        '<span class="rc-badge" aria-hidden="true" hidden>♻</span>';
    header.appendChild(openBtn);

    function updateBadge() {
        var data = load();
        var area = selectedArea(data);
        var on = isRecycleDay(data, area.id, dateString(new Date()));
        openBtn.querySelector(".rc-badge").hidden = !on;
        openBtn.setAttribute("aria-label", "Recycle calendar" +
            (on ? " (today is a recycle day in " + area.name + ")" : ""));
    }

    /* ---------- Dialog ---------- */

    var dialog = el("dialog", "send-dialog mt-dialog rc-dialog");
    dialog.setAttribute("aria-labelledby", "rc-title");
    dialog.innerHTML =
        '<div class="mt-dialog-head">' +
            '<h2 id="rc-title">Recycle Days</h2>' +
            '<button type="button" class="mt-dialog-close" aria-label="Close" data-dialog-close>&times;</button>' +
        "</div>" +
        '<div class="rc-body">' +
            '<div class="rc-areas" role="group" aria-label="Service area"></div>' +
            '<div class="rc-add-area" hidden>' +
                '<label for="rc-area-name">New area name</label>' +
                '<div class="rc-add-row">' +
                    '<input type="text" id="rc-area-name" autocomplete="off" maxlength="40">' +
                    '<button type="button" class="mt-btn rc-add-save">Add</button>' +
                    '<button type="button" class="mt-btn rc-add-cancel">Cancel</button>' +
                "</div>" +
                '<p class="send-error rc-add-error" hidden></p>' +
            "</div>" +
            '<div class="rc-status" aria-live="polite"></div>' +
            '<div class="rc-tools" role="group" aria-label="What a tap marks" hidden></div>' +
            '<div class="rc-month-nav">' +
                '<button type="button" class="mt-btn rc-prev" aria-label="Previous month">‹</button>' +
                '<h3 class="rc-month" aria-live="polite"></h3>' +
                '<button type="button" class="mt-btn rc-next" aria-label="Next month">›</button>' +
            "</div>" +
            '<table class="rc-grid"><thead><tr></tr></thead><tbody></tbody></table>' +
            '<p class="mt-hint rc-hint" aria-live="polite"></p>' +
        "</div>" +
        '<div class="form-actions mt-dialog-actions rc-actions">' +
            '<button type="button" class="send-email rc-today">Today</button>' +
            '<button type="button" class="generate-pdf rc-edit">Edit</button>' +
        "</div>";
    document.body.appendChild(dialog);

    var areasEl = dialog.querySelector(".rc-areas");
    var addAreaEl = dialog.querySelector(".rc-add-area");
    var areaInput = dialog.querySelector("#rc-area-name");
    var addError = dialog.querySelector(".rc-add-error");
    var statusEl = dialog.querySelector(".rc-status");
    var toolsEl = dialog.querySelector(".rc-tools");
    var monthEl = dialog.querySelector(".rc-month");
    var tbody = dialog.querySelector(".rc-grid tbody");
    var hintEl = dialog.querySelector(".rc-hint");
    var editBtn = dialog.querySelector(".rc-edit");

    WEEKDAYS.forEach(function (d) {
        dialog.querySelector(".rc-grid thead tr").appendChild(el("th", null, d)).setAttribute("scope", "col");
    });

    var calendarDialog = TrackerDialog(dialog, {
        onClose: function () {
            editing = false;
            addingArea = false;
            rangeStart = null;
            updateBadge();
        }
    });

    openBtn.addEventListener("click", function () {
        viewMonth = startOfMonth(new Date());
        editing = false;
        addingArea = false;
        rangeStart = null;
        render();
        calendarDialog.open();
    });

    /* ---------- Rendering ---------- */

    function renderAreas(data) {
        var current = selectedArea(data);
        areasEl.textContent = "";
        areas(data).forEach(function (a) {
            var b = button("rc-area" + (a.id === current.id ? " is-selected" : ""), a.name, function () {
                var d = load();
                d.selected = a.id;
                save(d);
                rangeStart = null;
                render();
            });
            b.setAttribute("aria-pressed", String(a.id === current.id));
            areasEl.appendChild(b);
        });
        areasEl.appendChild(button("rc-area rc-area-add", "+ Add area", function () {
            addingArea = true;
            render();
            areaInput.value = "";
            areaInput.focus();
        }));
    }

    function renderStatus(data, area) {
        var today = dateString(new Date());
        var on = isRecycleDay(data, area.id, today);
        var sunday = dateString(weekStart(new Date()));
        var saturday = dateString(addDays(weekStart(new Date()), 6));
        var thisWeek = daysFor(data, area.id).filter(function (d) { return d >= sunday && d <= saturday; });

        statusEl.className = "rc-status" + (on ? " is-recycle" : "");
        statusEl.textContent = "";
        statusEl.appendChild(el("strong", null, on ? "♻ Today is a recycle day" : "Today is not a recycle day"));
        statusEl.appendChild(el("span", null, area.name));
        if (thisWeek.length) {
            statusEl.appendChild(el("span", null, "This week: " + describeRuns(thisWeek)));
        }
        if (!on) {
            var next = daysFor(data, area.id).filter(function (d) { return d > today; })[0];
            if (next && next > saturday) statusEl.appendChild(el("span", null, "Next recycle day: " + shortDay(next)));
            else if (!daysFor(data, area.id).length) statusEl.appendChild(el("span", null, "No recycle days marked yet for this area."));
        }
    }

    function renderTools() {
        toolsEl.hidden = !editing;
        toolsEl.textContent = "";
        TOOLS.forEach(function (t) {
            var b = button("rc-tool" + (t.value === tool ? " is-selected" : ""), t.label, function () {
                tool = t.value;
                rangeStart = null;
                render();
            });
            b.setAttribute("aria-pressed", String(t.value === tool));
            toolsEl.appendChild(b);
        });
    }

    function renderGrid(data, area) {
        var today = dateString(new Date());
        var month = viewMonth.getMonth();
        monthEl.textContent = viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
        tbody.textContent = "";

        // Every week that touches this month, Sunday to Saturday
        for (var sunday = weekStart(viewMonth); sunday.getMonth() === month || sunday < viewMonth; sunday = addDays(sunday, 7)) {
            var row = el("tr", "rc-week");
            for (var i = 0; i < 7; i++) {
                var day = addDays(sunday, i);
                var value = dateString(day);
                var on = isRecycleDay(data, area.id, value);
                // Rounded ends where a run of marked days starts and stops
                var prevOn = on && i > 0 && isRecycleDay(data, area.id, dateString(addDays(day, -1)));
                var nextOn = on && i < 6 && isRecycleDay(data, area.id, dateString(addDays(day, 1)));
                var cell = el("td", "rc-day" +
                    (day.getMonth() !== month ? " is-other-month" : "") +
                    (value === today ? " is-today" : "") +
                    (on ? " is-recycle" : "") +
                    (on && !prevOn ? " run-start" : "") +
                    (on && !nextOn ? " run-end" : "") +
                    (value === rangeStart ? " is-range-start" : ""));
                cell.appendChild(el("span", "rc-day-num", String(day.getDate())));
                if (on && !prevOn) cell.appendChild(el("span", "rc-week-icon", "♻"));

                if (editing) {
                    cell.tabIndex = 0;
                    cell.setAttribute("role", "button");
                    cell.setAttribute("aria-pressed", String(on));
                    cell.setAttribute("aria-label", shortDay(value) + (on ? ", recycle day" : ""));
                    (function (v) {
                        cell.addEventListener("click", function () { tapDay(v); });
                        cell.addEventListener("keydown", function (ev) {
                            if (ev.key === "Enter" || ev.key === " ") {
                                ev.preventDefault();
                                tapDay(v);
                            }
                        });
                    })(value);
                }
                row.appendChild(cell);
            }
            tbody.appendChild(row);
        }
    }

    function hintText(area) {
        if (!editing) return "Recycle days are highlighted in green. Tap Edit to change them.";
        if (tool === "range" && rangeStart) {
            return "First day: " + shortDay(rangeStart) + ". Now tap the last day of the range (you can change months first).";
        }
        for (var i = 0; i < TOOLS.length; i++) {
            if (TOOLS[i].value === tool) return TOOLS[i].hint + " Changes apply to " + area.name + ".";
        }
        return "";
    }

    function render() {
        var data = load();
        var area = selectedArea(data);

        renderAreas(data);
        addAreaEl.hidden = !addingArea;
        renderStatus(data, area);
        renderTools();
        renderGrid(data, area);

        dialog.classList.toggle("is-editing", editing);
        editBtn.textContent = editing ? "Done" : "Edit";
        hintEl.textContent = hintText(area);

        // Only areas you added can be removed; the two built-in ones always stay
        var removeBtn = dialog.querySelector(".rc-remove-area");
        if (removeBtn) removeBtn.remove();
        if (editing && !BUILT_IN.some(function (a) { return a.id === area.id; })) {
            var remove = button("mt-btn mt-btn-danger rc-remove-area", "Remove " + area.name, function () {
                TrackerDialog.confirmDelete({
                    title: "Remove area?",
                    message: area.name + " and all of its marked recycle days will be removed. This cannot be undone.",
                    confirmLabel: "Remove area"
                }, function () {
                    var d = load();
                    d.customAreas = d.customAreas.filter(function (a) { return a.id !== area.id; });
                    delete d.days[area.id];
                    d.selected = BUILT_IN[0].id;
                    save(d);
                    render();
                });
            });
            hintEl.insertAdjacentElement("afterend", remove);
        }
    }

    /* ---------- Controls ---------- */

    dialog.querySelector(".rc-prev").addEventListener("click", function () {
        viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
        render();
    });

    dialog.querySelector(".rc-next").addEventListener("click", function () {
        viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
        render();
    });

    dialog.querySelector(".rc-today").addEventListener("click", function () {
        viewMonth = startOfMonth(new Date());
        render();
    });

    editBtn.addEventListener("click", function () {
        editing = !editing;
        rangeStart = null;
        render();
    });

    function addArea() {
        var name = areaInput.value.trim();
        var data = load();
        var taken = areas(data).some(function (a) { return a.name.toLowerCase() === name.toLowerCase(); });
        if (!name || taken) {
            addError.textContent = name ? name + " is already in the list." : "Enter a name for the area.";
            addError.hidden = false;
            areaInput.focus();
            return;
        }
        var id = "area-" + Date.now().toString(36);
        data.customAreas.push({ id: id, name: name });
        data.selected = id;
        if (!save(data)) {
            addError.textContent = "Could not save. Storage is unavailable in this browser.";
            addError.hidden = false;
            return;
        }
        addError.hidden = true;
        addingArea = false;
        editing = true; // a new area has no days yet, so go straight to marking them
        render();
    }

    dialog.querySelector(".rc-add-save").addEventListener("click", addArea);
    areaInput.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
            ev.preventDefault();
            addArea();
        }
    });
    dialog.querySelector(".rc-add-cancel").addEventListener("click", function () {
        addingArea = false;
        addError.hidden = true;
        render();
    });

    /* ---------- Keep the badge current ---------- */

    window.addEventListener("storage", function (ev) {
        if (ev.key !== KEY) return;
        updateBadge();
        if (dialog.open) render();
    });
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") updateBadge();
    });

    updateBadge();
})();
