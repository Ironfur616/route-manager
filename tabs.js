/* Tabbed forms for the main app shell (index.html).
   Choosing a form in the menu opens it in a new tab. Every tab is its own iframe,
   so what has been entered stays put while you switch between tabs, and the same
   form can be open more than once (for example, two different drivers).

   Each tab also autosaves what has been entered to localStorage, so a dead battery, a crash
   or an accidental reload does not lose an unsaved observation. On the next start every saved
   draft reopens as a tab. A tab's draft is deleted when its PDF is generated or the tab is closed.

   Any tab can be pinned. A pinned tab sits at the front of the bar, has no close button (unpin it
   first), and reopens every time the app starts. Pins are remembered by page (one per form). */
(function () {
    "use strict";

    var bar = document.getElementById("tab-bar");
    var panels = document.getElementById("tab-panels");
    var empty = document.getElementById("tab-empty");
    var navClose = document.getElementById("nav-close");
    if (!bar || !panels) return;

    var tabs = [];
    var nextId = 1;
    var active = null;

    var DRAFT_PREFIX = "fleetMgrDraft:";
    var PINS_KEY = "fleetMgrPinnedTabs";
    var PIN_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">' +
        '<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" fill="currentColor"/>' +
        '<path d="M12 14v7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    var SAVE_DELAY = 400;
    var warnedStorage = false;

    /* ---------- Draft autosave ---------- */

    function formControls(doc) {
        return Array.prototype.filter.call(
            doc.querySelectorAll("form.emp-info input, form.emp-info textarea, form.emp-info select"),
            function (el) {
                if (el.type === "file" || el.type === "button" || el.type === "submit" || el.type === "reset") return false;
                // Read-only fields under the signatures are copies of other fields and rebuild themselves
                return !el.hasAttribute("data-mirror");
            }
        );
    }

    function fieldKey(el) {
        if (el.id) return el.id;
        return el.name + (el.type === "checkbox" || el.type === "radio" ? "|" + el.value : "");
    }

    function collect(doc) {
        var values = {};
        formControls(doc).forEach(function (el) {
            var key = fieldKey(el);
            if (el.type === "checkbox" || el.type === "radio") {
                if (el.checked) values[key] = true;
            } else if (el.value) {
                values[key] = el.value;
            }
        });
        return values;
    }

    function restore(doc, values) {
        formControls(doc).forEach(function (el) {
            var key = fieldKey(el);
            var has = Object.prototype.hasOwnProperty.call(values, key);
            if (el.type === "checkbox" || el.type === "radio") {
                el.checked = has;
                // Lets the trainee form re-lock the sections for the restored Driver / Helper choice
                if (el.type === "radio") el.dispatchEvent(new Event("change", { bubbles: true }));
            } else if (el.type === "hidden") {
                var pad = el.closest("[data-signature]");
                if (has && pad && pad.restoreSignature) pad.restoreSignature(values[key]);
            } else if (has) {
                el.value = values[key];
                // Lets the mirrored fields under the signatures pick the value up
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });
    }

    function saveDraft(tab) {
        clearTimeout(tab.saveTimer);
        tab.saveTimer = null;
        try {
            var doc = tab.frame.contentDocument;
            if (!doc) return;
            localStorage.setItem(DRAFT_PREFIX + tab.draftId, JSON.stringify({
                id: tab.draftId,
                href: tab.href,
                created: tab.created,
                updated: Date.now(),
                values: collect(doc)
            }));
        } catch (e) {
            if (!warnedStorage) {
                warnedStorage = true;
                console.warn("Autosave unavailable:", e);
            }
        }
    }

    function scheduleSave(tab) {
        clearTimeout(tab.saveTimer);
        tab.saveTimer = setTimeout(function () { saveDraft(tab); }, SAVE_DELAY);
    }

    function removeDraft(tab) {
        clearTimeout(tab.saveTimer);
        tab.saveTimer = null;
        try { localStorage.removeItem(DRAFT_PREFIX + tab.draftId); } catch (e) { /* storage unavailable */ }
    }

    function flushDrafts() {
        tabs.forEach(function (tab) {
            if (tab.saveTimer) saveDraft(tab);
        });
    }

    // Don't leave a pending edit behind when the app is backgrounded or closed
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "hidden") flushDrafts();
    });
    window.addEventListener("pagehide", flushDrafts);

    function loadDrafts(allowedHrefs) {
        var found = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (!key || key.indexOf(DRAFT_PREFIX) !== 0) continue;
                try {
                    var d = JSON.parse(localStorage.getItem(key));
                    if (d && d.id && d.values && allowedHrefs[d.href]) found.push(d);
                } catch (e) { /* unreadable draft: skip it */ }
            }
        } catch (e) { /* storage unavailable */ }
        return found.sort(function (a, b) { return a.created - b.created; });
    }

    /* ---------- Pinned tabs ---------- */

    function loadPins() {
        try {
            var data = JSON.parse(localStorage.getItem(PINS_KEY) || "[]");
            return Array.isArray(data) ? data.filter(function (h) { return typeof h === "string"; }) : [];
        } catch (e) {
            return [];
        }
    }

    // Saved in the order the pinned tabs sit in the bar
    function savePins() {
        try {
            localStorage.setItem(PINS_KEY, JSON.stringify(tabs.filter(function (t) { return t.pinned; })
                .map(function (t) { return t.href; })));
        } catch (e) { /* storage unavailable: pins last until the app closes */ }
    }

    // Pinned tabs first, in pin order; the rest keep their order after them
    function arrangeTabs() {
        var pinned = tabs.filter(function (t) { return t.pinned; });
        var rest = tabs.filter(function (t) { return !t.pinned; });
        tabs = pinned.concat(rest);
        tabs.forEach(function (t) { bar.appendChild(t.el); });
    }

    function setPinned(tab, on) {
        if (on) {
            // One pinned tab per page: pinning this one unpins any other copy of the same form
            tabs.forEach(function (t) { if (t !== tab && t.href === tab.href) t.pinned = false; });
            // Newly pinned goes to the end of the pinned group
            tab.pinned = true;
            tabs.splice(tabs.indexOf(tab), 1);
            var lastPinned = -1;
            tabs.forEach(function (t, i) { if (t.pinned) lastPinned = i; });
            tabs.splice(lastPinned + 1, 0, tab);
        } else {
            tab.pinned = false;
        }
        arrangeTabs();
        savePins();
        refreshLabels();
        tab.el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    function baseLabel(tab) {
        var sameForm = tabs.filter(function (t) { return t.href === tab.href; });
        var n = sameForm.indexOf(tab) + 1;
        return sameForm.length > 1 ? tab.title + " " + n : tab.title;
    }

    function refreshLabels() {
        tabs.forEach(function (tab) {
            var label = baseLabel(tab);
            if (tab.person) label += " – " + tab.person;
            tab.selectBtn.textContent = label;
            tab.selectBtn.title = label;
            tab.closeBtn.setAttribute("aria-label", "Close " + label);
            tab.el.classList.toggle("is-pinned", !!tab.pinned);
            tab.pinBtn.setAttribute("aria-pressed", String(!!tab.pinned));
            tab.pinBtn.setAttribute("aria-label", (tab.pinned ? "Unpin " : "Pin ") + label);
            tab.pinBtn.title = tab.pinned ? "Unpin tab" : "Pin tab";
            // A pinned tab can't be closed by accident: unpin it first
            tab.closeBtn.hidden = !!tab.pinned;
        });
    }

    function activate(tab, focus) {
        active = tab;
        tabs.forEach(function (t) {
            var on = t === tab;
            t.el.classList.toggle("is-active", on);
            t.selectBtn.setAttribute("aria-selected", String(on));
            t.selectBtn.tabIndex = on ? 0 : -1;
            t.frame.hidden = !on;
        });
        // A frame that loaded while hidden has unsized signature pads; resizing sets them up
        try { tab.frame.contentWindow.dispatchEvent(new Event("resize")); } catch (e) { /* not loaded yet */ }
        if (focus) tab.selectBtn.focus();
        tab.el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    function closeTab(tab) {
        if (tab.pinned) return;
        if (tab.dirty && !confirm("Close this tab? Anything entered on it will be lost.")) return;
        removeDraft(tab);
        var i = tabs.indexOf(tab);
        tabs.splice(i, 1);
        tab.el.remove();
        tab.frame.remove();

        if (!tabs.length) {
            active = null;
            bar.hidden = true;
            empty.hidden = false;
            return;
        }
        refreshLabels();
        if (active === tab) activate(tabs[Math.min(i, tabs.length - 1)], true);
    }

    /* Track edits inside the frame: keeps the tab label in step with the employee
       name and remembers whether closing would throw work away. */
    function watchFrame(tab, doc) {
        var onEdit = function (e) {
            tab.dirty = true;
            var nameField = doc.getElementById("emp-name");
            if (nameField && (!e || e.target === nameField)) {
                tab.person = nameField.value.trim();
                refreshLabels();
            }
            scheduleSave(tab);
        };
        doc.addEventListener("input", onEdit);
        doc.addEventListener("change", onEdit);
        // Signature pads draw on a canvas, which fires no input event
        doc.addEventListener("pointerup", function (e) {
            if (e.target && e.target.classList && e.target.classList.contains("signature-pad")) {
                tab.dirty = true;
                scheduleSave(tab);
            }
        });
        doc.addEventListener("click", function (e) {
            if (e.target && e.target.classList && e.target.classList.contains("signature-clear")) scheduleSave(tab);
        });
        // The PDF now exists, so the backup is no longer needed. Further edits start a new draft.
        doc.addEventListener("pdf-saved", function () {
            tab.dirty = false;
            removeDraft(tab);
        });
    }

    function onFrameLoad(tab) {
        var doc;
        try { doc = tab.frame.contentDocument; } catch (e) { return; }
        if (!doc) return;
        // Pages that keep their own saved data (the missed collection log) are not drafts:
        // nothing to autosave, nothing lost on close
        if (doc.documentElement.hasAttribute("data-no-draft")) return;
        if (tab.pending) {
            restore(doc, tab.pending);
            tab.pending = null;
            tab.dirty = true;
            var nameField = doc.getElementById("emp-name");
            tab.person = nameField ? nameField.value.trim() : "";
            refreshLabels();
        }
        watchFrame(tab, doc);
    }

    function openTab(href, title, draft) {
        var id = nextId++;
        var tab = {
            id: id, href: href, title: title, person: "", dirty: false,
            draftId: draft ? draft.id : Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            created: draft ? draft.created : Date.now(),
            pending: draft ? draft.values : null
        };

        tab.el = document.createElement("div");
        tab.el.className = "tab";
        tab.el.setAttribute("role", "presentation");

        tab.selectBtn = document.createElement("button");
        tab.selectBtn.type = "button";
        tab.selectBtn.className = "tab-select";
        tab.selectBtn.id = "tab-" + id;
        tab.selectBtn.setAttribute("role", "tab");
        tab.selectBtn.setAttribute("aria-controls", "panel-" + id);
        tab.selectBtn.addEventListener("click", function () { activate(tab, false); });

        tab.closeBtn = document.createElement("button");
        tab.closeBtn.type = "button";
        tab.closeBtn.className = "tab-close";
        tab.closeBtn.textContent = "×";
        tab.closeBtn.addEventListener("click", function () { closeTab(tab); });

        tab.pinBtn = document.createElement("button");
        tab.pinBtn.type = "button";
        tab.pinBtn.className = "tab-pin";
        tab.pinBtn.innerHTML = PIN_ICON;
        tab.pinBtn.addEventListener("click", function () { setPinned(tab, !tab.pinned); });

        tab.el.appendChild(tab.selectBtn);
        tab.el.appendChild(tab.pinBtn);
        tab.el.appendChild(tab.closeBtn);
        bar.appendChild(tab.el);

        tab.frame = document.createElement("iframe");
        tab.frame.className = "tab-frame";
        tab.frame.id = "panel-" + id;
        tab.frame.setAttribute("role", "tabpanel");
        tab.frame.setAttribute("aria-labelledby", "tab-" + id);
        tab.frame.title = title;
        tab.frame.addEventListener("load", function () { onFrameLoad(tab); });
        tab.frame.src = href;
        panels.appendChild(tab.frame);

        tabs.push(tab);
        bar.hidden = false;
        empty.hidden = true;
        refreshLabels();
        activate(tab, false);
        return tab;
    }

    // Arrow keys move between tabs, as a tablist is expected to
    bar.addEventListener("keydown", function (e) {
        var i = tabs.indexOf(active);
        var target = null;
        if (e.key === "ArrowRight") target = tabs[(i + 1) % tabs.length];
        else if (e.key === "ArrowLeft") target = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === "Home") target = tabs[0];
        else if (e.key === "End") target = tabs[tabs.length - 1];
        if (target) {
            e.preventDefault();
            activate(target, true);
        }
    });

    // Menu links open a new tab instead of navigating away from the open forms
    var titles = {};
    document.querySelectorAll(".nav-link-list a").forEach(function (link) {
        titles[link.getAttribute("href")] = link.textContent.trim();
        link.addEventListener("click", function (e) {
            if (e.ctrlKey || e.metaKey || e.shiftKey) return; // let "open in new window" work
            e.preventDefault();
            openTab(link.getAttribute("href"), link.textContent.trim());
            if (navClose) navClose.click();
        });
    });

    // Reopen anything that was still unsaved when the app last closed, most recently edited on top
    var drafts = loadDrafts(titles);
    drafts.forEach(function (d) { openTab(d.href, titles[d.href], d); });
    var latestDraft = null;
    if (drafts.length) {
        var latest = 0;
        drafts.forEach(function (d, i) { if (d.updated > drafts[latest].updated) latest = i; });
        latestDraft = tabs[latest];
    }

    // Reopen pinned tabs. A pinned form that came back with a draft is that same tab, not a second copy.
    var pins = loadPins().filter(function (href) { return titles[href]; });
    pins.forEach(function (href) {
        var tab = tabs.filter(function (t) { return t.href === href && !t.pinned; })[0] || openTab(href, titles[href]);
        tab.pinned = true;
    });
    if (pins.length) {
        // Keep the saved pin order, pinned tabs first
        var order = {};
        pins.forEach(function (href, i) { order[href] = i; });
        var pinned = tabs.filter(function (t) { return t.pinned; }).sort(function (a, b) { return order[a.href] - order[b.href]; });
        tabs = pinned.concat(tabs.filter(function (t) { return !t.pinned; }));
        arrangeTabs();
        refreshLabels();
    }
    // Land on the most recently edited draft, else the first pinned tab
    if (latestDraft) activate(latestDraft, false);
    else if (tabs.length) activate(tabs[0], false);

    // Opened by sharing spreadsheets to Route IQ: show Route Sheets, which imports them
    if (/[?&]import-shared=1/.test(location.search)) {
        try { history.replaceState(null, "", location.pathname); } catch (e) { /* cosmetic only */ }
        var SHEETS = "route-streets.html";
        var sheetsTab = tabs.filter(function (t) { return t.href === SHEETS; })[0];
        if (sheetsTab) {
            activate(sheetsTab, false);
            // Already loaded: ask it to look for the shared files (a tab still loading checks on its own)
            try { sheetsTab.frame.contentWindow.dispatchEvent(new Event("rs-check-shared")); } catch (e) { /* loading */ }
        } else if (titles[SHEETS]) {
            openTab(SHEETS, titles[SHEETS]);
        }
    }
})();
