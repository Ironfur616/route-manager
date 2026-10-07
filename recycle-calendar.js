/* Recycle week calendar, opened from the calendar button at the right of the app header.
   A quick reference for which weeks are recycle weeks in each service area. Weeks are marked
   by hand (Edit weeks, then tap a week), and stored per area in localStorage under the date of
   the week's Sunday, the first day of each calendar row. The calendar opens view-only so a
   stray tap while checking it can't change anything.

   The header button shows a small recycle badge when the current week is a recycle week for
   the selected area, so the answer is visible without opening the calendar.

   Loaded only by the shell (index.html), after nav.js has built the header. */
(function () {
    "use strict";

    var KEY = "fleetMgrRecycleCalendar";
    var BUILT_IN = [
        { id: "east-washington", name: "East Washington" },
        { id: "washington", name: "Washington" }
    ];
    var WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

    var header = document.querySelector(".app-header");
    if (!header) return;

    var viewMonth = startOfMonth(new Date());
    var editing = false;
    var addingArea = false;

    /* ---------- Dates ---------- */

    function pad(n) {
        return n < 10 ? "0" + n : String(n);
    }

    function dateString(d) {
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
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

    // "Oct 4 – 10" or "Sep 27 – Oct 3"
    function weekRange(sunday) {
        var saturday = addDays(sunday, 6);
        var first = sunday.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        var last = saturday.getMonth() === sunday.getMonth()
            ? String(saturday.getDate())
            : saturday.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        return first + " – " + last;
    }

    /* ---------- Storage ---------- */

    function load() {
        var data;
        try {
            data = JSON.parse(localStorage.getItem(KEY) || "{}");
        } catch (e) {
            data = {};
        }
        if (!data || typeof data !== "object") data = {};
        if (!Array.isArray(data.customAreas)) data.customAreas = [];
        if (!data.weeks || typeof data.weeks !== "object") data.weeks = {};
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

    function isRecycleWeek(data, areaId, sunday) {
        return (data.weeks[areaId] || []).indexOf(dateString(sunday)) !== -1;
    }

    function toggleWeek(sunday) {
        var data = load();
        var area = selectedArea(data);
        var list = data.weeks[area.id] || [];
        var key = dateString(sunday);
        var at = list.indexOf(key);
        if (at === -1) list.push(key);
        else list.splice(at, 1);
        data.weeks[area.id] = list.sort();
        save(data);
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
    openBtn.setAttribute("aria-label", "Recycle week calendar");
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
        var on = isRecycleWeek(data, area.id, weekStart(new Date()));
        openBtn.querySelector(".rc-badge").hidden = !on;
        openBtn.setAttribute("aria-label", "Recycle week calendar" +
            (on ? " (this week is a recycle week in " + area.name + ")" : ""));
    }

    /* ---------- Dialog ---------- */

    var dialog = el("dialog", "send-dialog mt-dialog rc-dialog");
    dialog.setAttribute("aria-labelledby", "rc-title");
    dialog.innerHTML =
        '<div class="mt-dialog-head">' +
            '<h2 id="rc-title">Recycle Weeks</h2>' +
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
            '<div class="rc-month-nav">' +
                '<button type="button" class="mt-btn rc-prev" aria-label="Previous month">‹</button>' +
                '<h3 class="rc-month" aria-live="polite"></h3>' +
                '<button type="button" class="mt-btn rc-next" aria-label="Next month">›</button>' +
            "</div>" +
            '<table class="rc-grid"><thead><tr></tr></thead><tbody></tbody></table>' +
            '<p class="mt-hint rc-hint"></p>' +
        "</div>" +
        '<div class="form-actions mt-dialog-actions rc-actions">' +
            '<button type="button" class="send-email rc-today">Today</button>' +
            '<button type="button" class="generate-pdf rc-edit">Edit weeks</button>' +
        "</div>";
    document.body.appendChild(dialog);

    var areasEl = dialog.querySelector(".rc-areas");
    var addAreaEl = dialog.querySelector(".rc-add-area");
    var areaInput = dialog.querySelector("#rc-area-name");
    var addError = dialog.querySelector(".rc-add-error");
    var statusEl = dialog.querySelector(".rc-status");
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
            updateBadge();
        }
    });

    openBtn.addEventListener("click", function () {
        viewMonth = startOfMonth(new Date());
        editing = false;
        addingArea = false;
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
        var thisWeek = weekStart(new Date());
        var on = isRecycleWeek(data, area.id, thisWeek);
        statusEl.className = "rc-status" + (on ? " is-recycle" : "");
        statusEl.textContent = "";
        statusEl.appendChild(el("strong", null, on
            ? "♻ This week is a recycle week"
            : "This week is not a recycle week"));
        statusEl.appendChild(el("span", null, area.name + " · " + weekRange(thisWeek)));

        if (!on) {
            var upcoming = (data.weeks[area.id] || []).filter(function (k) { return k > dateString(thisWeek); })[0];
            if (upcoming) {
                var p = upcoming.split("-");
                statusEl.appendChild(el("span", null, "Next recycle week: " +
                    weekRange(new Date(+p[0], +p[1] - 1, +p[2]))));
            } else if (!(data.weeks[area.id] || []).length) {
                statusEl.appendChild(el("span", null, "No recycle weeks marked yet for this area."));
            }
        }
    }

    function renderGrid(data, area) {
        var today = dateString(new Date());
        var month = viewMonth.getMonth();
        monthEl.textContent = viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
        tbody.textContent = "";

        // Every week that touches this month, Sunday to Saturday
        for (var sunday = weekStart(viewMonth); sunday.getMonth() === month || sunday < viewMonth; sunday = addDays(sunday, 7)) {
            (function (rowStart) {
                var on = isRecycleWeek(data, area.id, rowStart);
                var row = el("tr", "rc-week" + (on ? " is-recycle" : ""));
                if (editing) {
                    row.tabIndex = 0;
                    row.setAttribute("role", "button");
                    row.setAttribute("aria-pressed", String(on));
                    row.setAttribute("aria-label", "Week of " + weekRange(rowStart) +
                        (on ? ", recycle week. Tap to unmark." : ". Tap to mark as a recycle week."));
                    row.addEventListener("click", function () { toggleWeek(rowStart); });
                    row.addEventListener("keydown", function (ev) {
                        if (ev.key === "Enter" || ev.key === " ") {
                            ev.preventDefault();
                            toggleWeek(rowStart);
                        }
                    });
                }
                for (var i = 0; i < 7; i++) {
                    var day = addDays(rowStart, i);
                    var cell = el("td", "rc-day" +
                        (day.getMonth() !== month ? " is-other-month" : "") +
                        (dateString(day) === today ? " is-today" : ""));
                    cell.appendChild(el("span", "rc-day-num", String(day.getDate())));
                    if (on && i === 0) cell.appendChild(el("span", "rc-week-icon", "♻"));
                    row.appendChild(cell);
                }
                tbody.appendChild(row);
            })(sunday);
        }
    }

    function render() {
        var data = load();
        var area = selectedArea(data);

        renderAreas(data);
        addAreaEl.hidden = !addingArea;
        renderStatus(data, area);
        renderGrid(data, area);

        dialog.classList.toggle("is-editing", editing);
        editBtn.textContent = editing ? "Done" : "Edit weeks";
        hintEl.textContent = editing
            ? "Tap a week to mark or unmark it as a recycle week for " + area.name + "."
            : "Recycle weeks are highlighted in green. Tap Edit weeks to change them.";

        // Only areas you added can be removed; the two built-in ones always stay
        var removeBtn = dialog.querySelector(".rc-remove-area");
        if (removeBtn) removeBtn.remove();
        if (editing && !BUILT_IN.some(function (a) { return a.id === area.id; })) {
            var remove = button("mt-btn mt-btn-danger rc-remove-area", "Remove " + area.name, function () {
                TrackerDialog.confirmDelete({
                    title: "Remove area?",
                    message: area.name + " and all of its marked recycle weeks will be removed. This cannot be undone.",
                    confirmLabel: "Remove area"
                }, function () {
                    var d = load();
                    d.customAreas = d.customAreas.filter(function (a) { return a.id !== area.id; });
                    delete d.weeks[area.id];
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
        editing = true; // a new area has no weeks yet, so go straight to marking them
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
