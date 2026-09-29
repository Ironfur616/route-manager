/* Missed collection tracker (missed-tracker.html).
    Unlike the observation forms, this is a running log, not a draft: entries are kept in
    localStorage until they are deleted. The page opts out of the shell's draft handling with
   data-no-draft on <html>. Every change re-reads storage first, so two open tabs stay in step. */
(function () {
    "use strict";

    var KEY = "fleetMgrMissed";

    var SERVICES = ["Residential", "Recycling", "Yard Waste", "Bulk", "Commercial", "Other"];
    var REASONS = [
        "Trash / RCY not out",
        "Trash / RCY out late",
        "Customer issued a yellow tag",
        "Customer called in request for service",
        "Trash / RCY blocked / no access",
        "Can contaminated (trash mixed with recycle)",
        "Move out pile",
        "Overloaded / too heavy",
        "Wrong can out",
        "Mattress not properly wrapped",
        "Items not part of trash program",
        "Not properly contained / bundled",
        "No electronic devices",
        "Yard Waste mixed with garbage",
        "Construction material",
        "Hazardous waste",
        "Items not included in recycling program",
        "Recyclables in bags",
        "No batteries or lithium batteries",
        "Recycle contains (hangers, hoses, wire, cords, rope, or chains)",
        "Other (see notes)"
    ];
    var STATUSES = [
        { value: "open", label: "Open" },
        { value: "notified", label: "Customer notified" },
        { value: "district_notified", label: "Collections area notified"},
        { value: "resolved", label: "Resolved" }
    ];

    var form = document.getElementById("mt-form");
    var fields = {
        date: document.getElementById("mt-date"),
        route: document.getElementById("mt-route"),
        address: document.getElementById("mt-address"),
        service: document.getElementById("mt-service"),
        driver: document.getElementById("mt-driver"),
        unit: document.getElementById("mt-unit"),
        status: document.getElementById("mt-status"),
        notes: document.getElementById("mt-notes")
    };
    var reasonsContainer = document.getElementById("mt-reasons");
    var reasonsCount = document.getElementById("mt-reasons-count");
    var reasonsError = document.getElementById("mt-reasons-error");
    var submitBtn = document.getElementById("mt-submit");
    var cancelBtn = document.getElementById("mt-cancel");
    var formTitle = document.getElementById("mt-form-title");
    var message = document.getElementById("mt-message");
    var addressHint = document.getElementById("mt-address-hint");
    var listEl = document.getElementById("mt-list");
    var countEl = document.getElementById("mt-count");
    var searchEl = document.getElementById("mt-search");
    var filterStatus = document.getElementById("mt-filter-status");

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

    // "2026-09-25" -> "Sep 25, 2026". Built from parts so the date never shifts with the time zone.
    function prettyDate(value) {
        var p = String(value).split("-");
        if (p.length !== 3) return value;
        return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, {
            month: "short", day: "numeric", year: "numeric"
        });
    }

    var SUFFIXES = {
        street: "st", avenue: "ave", road: "rd", drive: "dr", lane: "ln", court: "ct",
        boulevard: "blvd", place: "pl", circle: "cir", terrace: "ter", highway: "hwy"
    };

    // So "123 Main Street" and "123 main st." count as the same address
    function addressKey(text) {
        return String(text).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
            .map(function (w) { return SUFFIXES[w] || w; }).join(" ");
    }

    function labelFor(list, value) {
        for (var i = 0; i < list.length; i++) {
            if (list[i].value === value) return list[i].label;
        }
        return value;
    }

    function fillSelect(select, options, placeholder) {
        select.textContent = "";
        if (placeholder) {
            var first = el("option", null, placeholder);
            first.value = "";
            select.appendChild(first);
        }
        options.forEach(function (o) {
            var opt = el("option", null, typeof o === "string" ? o : o.label);
            opt.value = typeof o === "string" ? o : o.value;
            select.appendChild(opt);
        });
    }

    function say(text) {
        message.textContent = text;
    }

    /* ---------- Reason chips (multi-select) ---------- */

    function buildReasonChips() {
        reasonsContainer.textContent = "";
        REASONS.forEach(function (reason, i) {
            var label = el("label", "mt-reason-chip");
            var input = document.createElement("input");
            input.type = "checkbox";
            input.id = "mt-reason-" + i;
            input.name = "reasons";
            input.value = reason;
            label.appendChild(input);
            label.appendChild(document.createTextNode(reason));
            reasonsContainer.appendChild(label);
        });
    }

    function getCheckedReasons() {
        return Array.prototype.filter.call(reasonsContainer.querySelectorAll("input"), function (cb) {
            return cb.checked;
        }).map(function (cb) { return cb.value; });
    }

    function setCheckedReasons(reasons) {
        var picked = {};
        (reasons || []).forEach(function (r) { picked[r] = true; });
        Array.prototype.forEach.call(reasonsContainer.querySelectorAll("input"), function (cb) {
            cb.checked = !!picked[cb.value];
        });
    }

    function updateReasonsCount() {
        var n = getCheckedReasons().length;
        reasonsCount.textContent = n ? n + " selected" : "";
        if (n) reasonsError.hidden = true;
    }

    reasonsContainer.addEventListener("change", updateReasonsCount);

    /* ---------- Storage ---------- */

    function load() {
        try {
            var data = JSON.parse(localStorage.getItem(KEY) || "[]");
            if (!Array.isArray(data)) return [];
            return data.filter(function (e) { return e && e.id; }).map(function (e) {
                // Entries saved before reasons could be multi-select had a single "reason" string
                if (!e.reasons) {
                    var legacy = e.reason
                        ? e.reason.replace(/^Cart /, "Can ").replace("Wrong cart out", "Wrong can out")
                        : "";
                    e.reasons = legacy ? [legacy] : [];
                    delete e.reason;
                }
                return e;
            });
        } catch (e) {
            return [];
        }
    }

    function save(list) {
        try {
            localStorage.setItem(KEY, JSON.stringify(list));
            document.getElementById("mt-storage-warning").hidden = true;
            return true;
        } catch (e) {
            document.getElementById("mt-storage-warning").hidden = false;
            return false;
        }
    }

    function newest(a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return (b.created || 0) - (a.created || 0);
    }

    /* ---------- Rendering ---------- */

    function addressCounts(entries) {
        var counts = {};
        entries.forEach(function (e) {
            var k = addressKey(e.address);
            counts[k] = (counts[k] || 0) + 1;
        });
        return counts;
    }

    function renderStats(entries, counts) {
        var cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 6);
        var cutoffStr = dateString(cutoff);
        var repeats = Object.keys(counts).filter(function (k) { return k && counts[k] > 1; }).length;

        document.getElementById("stat-open").textContent =
            entries.filter(function (e) { return e.status !== "resolved"; }).length;
        document.getElementById("stat-week").textContent =
            entries.filter(function (e) { return e.date >= cutoffStr; }).length;
        document.getElementById("stat-repeat").textContent = repeats;
    }

    function renderDatalists(entries) {
        [["dl-route", "route"], ["dl-address", "address"], ["dl-driver", "driver"], ["dl-unit", "unit"]]
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
        return [e.address, e.route, e.driver, e.unit, e.notes, e.service].concat(e.reasons || []).join(" ")
            .toLowerCase().indexOf(term) !== -1;
    }

    function buildCard(e, counts) {
        var card = el("article", "mt-entry mt-status-" + e.status);

        var head = el("div", "mt-entry-head");
        head.appendChild(el("h3", "mt-entry-address", e.address));
        head.appendChild(el("span", "mt-entry-date", prettyDate(e.date)));
        card.appendChild(head);

        var chips = el("div", "mt-chips");
        (e.reasons || []).forEach(function (r) {
            chips.appendChild(el("span", "mt-chip mt-chip-reason", r));
        });
        chips.appendChild(el("span", "mt-chip", e.service));
        chips.appendChild(el("span", "mt-chip mt-chip-status", labelFor(STATUSES, e.status)));
        var times = counts[addressKey(e.address)];
        if (times > 1) chips.appendChild(el("span", "mt-chip mt-chip-repeat", times + " misses at this address"));
        card.appendChild(chips);

        var meta = [];
        if (e.route) meta.push("Route " + e.route);
        if (e.driver) meta.push(e.driver);
        if (e.unit) meta.push("Unit " + e.unit);
        if (meta.length) card.appendChild(el("p", "mt-entry-meta", meta.join(" · ")));
        if (e.notes) card.appendChild(el("p", "mt-entry-notes", e.notes));

        var actions = el("div", "mt-entry-actions");
        var status = el("select", "mt-entry-status");
        status.setAttribute("aria-label", "Status for " + e.address);
        fillSelect(status, STATUSES);
        status.value = e.status;
        status.addEventListener("change", function () { setStatus(e.id, status.value); });
        var edit = el("button", "mt-btn", "Edit");
        edit.type = "button";
        edit.setAttribute("aria-label", "Edit " + e.address);
        edit.addEventListener("click", function () { startEdit(e.id); });
        var del = el("button", "mt-btn mt-btn-danger", "Delete");
        del.type = "button";
        del.setAttribute("aria-label", "Delete " + e.address);
        del.addEventListener("click", function () { remove(e.id); });
        actions.appendChild(status);
        actions.appendChild(edit);
        actions.appendChild(del);
        card.appendChild(actions);

        return card;
    }

    function render() {
        var entries = load().sort(newest);
        var counts = addressCounts(entries);
        var term = searchEl.value.trim().toLowerCase();
        var status = filterStatus.value;

        renderStats(entries, counts);
        renderDatalists(entries);
        updateAddressHint();

        var shown = entries.filter(function (e) {
            return (!status || e.status === status) && matchesSearch(e, term);
        });

        listEl.textContent = "";
        shown.forEach(function (e) { listEl.appendChild(buildCard(e, counts)); });

        if (!entries.length) {
            countEl.textContent = "No missed collections logged yet. Use the form above to add the first one.";
        } else if (!shown.length) {
            countEl.textContent = "Nothing matches the current search or filter.";
        } else {
            countEl.textContent = "Showing " + shown.length + " of " + entries.length;
        }
        document.getElementById("mt-export").disabled = !entries.length;
    }

    /* ---------- Form ---------- */

    function updateAddressHint() {
        var key = addressKey(fields.address.value);
        if (!key) {
            addressHint.textContent = "";
            return;
        }
        var n = load().filter(function (e) { return e.id !== editingId && addressKey(e.address) === key; }).length;
        addressHint.textContent = n
            ? "Heads up: " + n + " earlier miss" + (n === 1 ? "" : "es") + " logged at this address."
            : "";
    }

    function readForm() {
        return {
            date: fields.date.value,
            route: fields.route.value.trim(),
            address: fields.address.value.trim(),
            service: fields.service.value,
            reasons: getCheckedReasons(),
            driver: fields.driver.value.trim(),
            unit: fields.unit.value.trim(),
            status: fields.status.value,
            notes: fields.notes.value.trim()
        };
    }

    // After saving, the day's route/driver/unit stay filled in: a manager usually logs several
    // misses from the same route in a row. Only the parts that differ per stop are cleared.
    function resetForm(keepContext) {
        editingId = null;
        formTitle.textContent = "LOG A MISSED COLLECTION";
        submitBtn.textContent = "Save Entry";
        cancelBtn.hidden = true;

        var keep = keepContext ? readForm() : {};
        form.reset();
        fields.date.value = keep.date || dateString(new Date());
        if (keep.route) fields.route.value = keep.route;
        if (keep.driver) fields.driver.value = keep.driver;
        if (keep.unit) fields.unit.value = keep.unit;
        fields.service.value = keep.service || SERVICES[0];
        fields.status.value = "open";
        updateReasonsCount();
        reasonsError.hidden = true;
        updateAddressHint();
    }

    function startEdit(id) {
        var entry = load().filter(function (e) { return e.id === id; })[0];
        if (!entry) return;
        editingId = id;
        Object.keys(fields).forEach(function (k) { fields[k].value = entry[k] || ""; });
        setCheckedReasons(entry.reasons);
        updateReasonsCount();
        reasonsError.hidden = true;
        formTitle.textContent = "EDIT ENTRY";
        submitBtn.textContent = "Save Changes";
        cancelBtn.hidden = false;
        say("");
        updateAddressHint();
        form.scrollIntoView({ behavior: "smooth", block: "start" });
        fields.address.focus({ preventScroll: true });
    }

    function newId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var data = readForm();
        if (!data.reasons.length) {
            reasonsError.hidden = false;
            reasonsContainer.querySelector("input").focus();
            return;
        }
        var list = load();
        var existing = editingId ? list.filter(function (e) { return e.id === editingId; })[0] : null;

        if (existing) {
            Object.keys(data).forEach(function (k) { existing[k] = data[k]; });
            existing.updated = Date.now();
        } else {
            data.id = newId();
            data.created = Date.now();
            list.push(data);
        }
        if (!save(list)) {
            say("Could not save. Storage is unavailable in this browser.");
            return;
        }

        var wasEdit = !!existing;
        resetForm(!wasEdit);
        render();
        say(wasEdit ? "Changes saved." : "Entry saved. Route and driver kept for the next stop.");
        if (!wasEdit) fields.address.focus();
    });

    cancelBtn.addEventListener("click", function () {
        resetForm(false);
        say("");
    });

    fields.address.addEventListener("input", updateAddressHint);

    /* ---------- List actions ---------- */

    function setStatus(id, value) {
        var list = load();
        list.forEach(function (e) {
            if (e.id === id) {
                e.status = value;
                e.updated = Date.now();
            }
        });
        save(list);
        render();
    }

    function remove(id) {
        if (!confirm("Delete this entry? This cannot be undone.")) return;
        save(load().filter(function (e) { return e.id !== id; }));
        if (editingId === id) resetForm(false);
        render();
    }

    searchEl.addEventListener("input", render);
    filterStatus.addEventListener("change", render);

    /* ---------- CSV export ---------- */

    // A leading = + - @ would be run as a formula by Excel, so those cells get a quote prefix
    function csvCell(value) {
        var text = String(value == null ? "" : value);
        if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    }

    document.getElementById("mt-export").addEventListener("click", function () {
        var entries = load().sort(newest);
        var counts = addressCounts(entries);
        var rows = [["Date", "Route", "Address", "Service", "Reasons", "Driver", "Unit", "Status",
            "Misses at address", "Notes"]];
        entries.forEach(function (e) {
            rows.push([e.date, e.route, e.address, e.service, (e.reasons || []).join("; "), e.driver, e.unit,
                labelFor(STATUSES, e.status), counts[addressKey(e.address)], e.notes]);
        });
        var csv = "﻿" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");

        var url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        var link = document.createElement("a");
        link.href = url;
        link.download = "missed-collections-" + dateString(new Date()) + ".csv";
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

    fillSelect(fields.service, SERVICES);
    buildReasonChips();
    fillSelect(fields.status, STATUSES);
    fillSelect(filterStatus, STATUSES, "All statuses");
    resetForm(false);
    render();
})();
