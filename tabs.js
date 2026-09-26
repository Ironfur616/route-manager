/* Tabbed forms for the main app shell (index.html).
   Choosing a form in the menu opens it in a new tab. Every tab is its own iframe,
   so what has been entered stays put while you switch between tabs, and the same
   form can be open more than once (for example, two different drivers).

   Each tab also autosaves what has been entered to localStorage, so a dead battery, a crash
   or an accidental reload does not lose an unsaved observation. On the next start every saved
   draft reopens as a tab. A tab's draft is deleted when its PDF is generated or the tab is closed. */
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

        tab.el.appendChild(tab.selectBtn);
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
    if (drafts.length) {
        var latest = 0;
        drafts.forEach(function (d, i) { if (d.updated > drafts[latest].updated) latest = i; });
        activate(tabs[latest], false);
    }
})();
