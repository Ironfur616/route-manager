/* Root Cause Assessment (RCA) tracker (rca.html).
   Same running-log pattern as missed-tracker.js / new-customers.js: cases live in localStorage
   until deleted, not in a draft. The page opts out of the shell's draft handling with
   data-no-draft on <html>.

   Structure: one CASE per ongoing problem, with its root cause tagged against the standard
   fishbone categories (People/Process/Equipment/Materials/Environment) and a corrective action.
   Evidence (date, description, source, any number of photos) is logged under whichever category
   it supports. There's no separate "mark this category as a cause" control: adding evidence to
   a category IS what flags it, showing the same pill a manual check used to produce. A case's
   status (Open/Investigating/Resolved) drives its left status bar, same visual language as
   Missed Collections: red = unresolved, blue = being worked, green = done. */
(function () {
    "use strict";

    var KEY = "fleetMgrRCA";
    var MAX_PHOTO_DIM = 1400; // px, longest side after downscaling
    var PHOTO_QUALITY = 0.8; // JPEG quality; bigger/clearer than before for the PDF report,
        // still compressed since several photos can now live on one evidence entry

    var STATUSES = [
        { value: "open", label: "Open" },
        { value: "investigating", label: "Investigating" },
        { value: "resolved", label: "Resolved" }
    ];
    var CAUSES = [
        ["people", "People"],
        ["process", "Process"],
        ["equipment", "Equipment"],
        ["materials", "Materials"],
        ["environment", "Environment"]
    ];

    var form = document.getElementById("rca-form");
    var fields = {
        title: document.getElementById("rca-title"),
        description: document.getElementById("rca-description"),
        route: document.getElementById("rca-route"),
        address: document.getElementById("rca-address")
    };
    var submitBtn = document.getElementById("rca-submit");
    var cancelBtn = document.getElementById("rca-cancel");
    var formTitle = document.getElementById("rca-form-title");
    var message = document.getElementById("rca-message");
    var listEl = document.getElementById("rca-list");
    var countEl = document.getElementById("rca-count");
    var searchEl = document.getElementById("rca-search");
    var filterStatus = document.getElementById("rca-filter-status");

    var editingId = null;
    var editingEvidence = null; // { caseId, evidenceId } of the one evidence entry being edited, if any

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

    function labelFor(list, value) {
        for (var i = 0; i < list.length; i++) {
            if (list[i].value === value) return list[i].label;
        }
        return value;
    }

    function causeLabel(key) {
        for (var i = 0; i < CAUSES.length; i++) {
            if (CAUSES[i][0] === key) return CAUSES[i][1];
        }
        return key || "";
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

    function newId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    // Fetched once up front so clicking Generate PDF doesn't wait on it later. Resolves to null
    // (report still works without the logo) if it can't be loaded, e.g. offline on first visit.
    function loadLogo() {
        return fetch("assets/icons/icon-192.png")
            .then(function (r) { return r.blob(); })
            .then(function (blob) {
                return new Promise(function (resolve, reject) {
                    var reader = new FileReader();
                    reader.onload = function () { resolve(reader.result); };
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            })
            .catch(function () { return null; });
    }
    var logoPromise = loadLogo();

    // Downscales + re-compresses a photo before it ever touches storage. A phone photo straight
    // off the camera can be several MB; localStorage only has a few MB total for the whole app,
    // shared with every other saved case, entry and draft. This keeps one photo to roughly
    // 100-300KB so a case can hold several without blowing the quota.
    function downscalePhoto(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onerror = function () { reject(new Error("Could not read that photo.")); };
            reader.onload = function () {
                var img = new Image();
                img.onerror = function () { reject(new Error("Could not read that photo.")); };
                img.onload = function () {
                    var scale = Math.min(1, MAX_PHOTO_DIM / Math.max(img.width, img.height));
                    var w = Math.max(1, Math.round(img.width * scale));
                    var h = Math.max(1, Math.round(img.height * scale));
                    var canvas = document.createElement("canvas");
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL("image/jpeg", PHOTO_QUALITY));
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    /* ---------- Storage ---------- */

    function load() {
        try {
            var data = JSON.parse(localStorage.getItem(KEY) || "[]");
            return Array.isArray(data) ? data.filter(function (c) { return c && c.id; }) : [];
        } catch (e) {
            return [];
        }
    }

    function save(list) {
        try {
            localStorage.setItem(KEY, JSON.stringify(list));
            document.getElementById("rca-storage-warning").hidden = true;
            return true;
        } catch (e) {
            document.getElementById("rca-storage-warning").hidden = false;
            say("Could not save. Storage is unavailable or full in this browser.");
            return false;
        }
    }

    function updateCase(id, patch) {
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

    function newest(a, b) {
        return (b.created || 0) - (a.created || 0);
    }

    /* ---------- Rendering ---------- */

    function renderStats(cases) {
        var counts = { open: 0, investigating: 0, resolved: 0 };
        var evidenceTotal = 0;
        cases.forEach(function (c) {
            counts[c.status] = (counts[c.status] || 0) + 1;
            evidenceTotal += (c.evidence || []).length;
        });
        document.getElementById("stat-open").textContent = counts.open;
        document.getElementById("stat-investigating").textContent = counts.investigating;
        document.getElementById("stat-resolved").textContent = counts.resolved;
        document.getElementById("stat-evidence").textContent = evidenceTotal;
    }

    function renderDatalists(cases) {
        [["dl-rca-route", "route"], ["dl-rca-address", "address"]].forEach(function (pair) {
            var seen = {};
            var list = document.getElementById(pair[0]);
            list.textContent = "";
            cases.forEach(function (c) {
                var v = (c[pair[1]] || "").trim();
                if (v && !seen[v.toLowerCase()]) {
                    seen[v.toLowerCase()] = true;
                    list.appendChild(el("option")).value = v;
                }
            });
        });
        var seenSource = {};
        var sourceList = document.getElementById("dl-rca-source");
        sourceList.textContent = "";
        cases.forEach(function (c) {
            (c.evidence || []).forEach(function (ev) {
                var v = (ev.source || "").trim();
                if (v && !seenSource[v.toLowerCase()]) {
                    seenSource[v.toLowerCase()] = true;
                    sourceList.appendChild(el("option")).value = v;
                }
            });
        });
    }

    function matchesSearch(c, term) {
        if (!term) return true;
        var evidenceText = (c.evidence || []).map(function (ev) {
            return ev.description + " " + ev.source + " " + causeLabel(ev.category);
        }).join(" ");
        return [c.title, c.description, c.route, c.address, c.rootCause, c.correctiveAction, evidenceText]
            .join(" ").toLowerCase().indexOf(term) !== -1;
    }

    // Evidence saved before multi-photo support used a single "photo" field; this reads either
    function photosFor(ev) {
        if (ev.photos) return ev.photos;
        return ev.photo ? [ev.photo] : [];
    }

    function evidencePhotosGallery(ev) {
        var photos = photosFor(ev);
        if (!photos.length) return null;
        var gallery = el("div", "rca-evidence-photos");
        photos.forEach(function (photoData) {
            var link = document.createElement("a");
            link.href = photoData;
            link.target = "_blank";
            link.rel = "noopener";
            var img = document.createElement("img");
            img.src = photoData;
            img.alt = "Evidence photo";
            img.className = "rca-evidence-photo";
            link.appendChild(img);
            gallery.appendChild(link);
        });
        return gallery;
    }

    // Edited in place rather than through a separate dialog, so fixing a typo is a quick
    // date/description/source correction right where the entry already sits. Category and
    // photos aren't editable here; delete and re-add the entry if those need to change.
    function buildEvidenceEditForm(c, ev) {
        var wrap = el("div", "rca-add-evidence rca-evidence-edit");

        var dateInput = document.createElement("input");
        dateInput.type = "date";
        dateInput.value = ev.date || dateString(new Date());
        dateInput.setAttribute("aria-label", "Evidence date");

        var descInput = document.createElement("textarea");
        descInput.rows = 2;
        descInput.className = "nc-notes";
        descInput.setAttribute("aria-label", "Evidence description");
        descInput.value = ev.description || "";

        var sourceInput = document.createElement("input");
        sourceInput.type = "text";
        sourceInput.placeholder = "Source (driver report, customer call, GPS log...)";
        sourceInput.setAttribute("list", "dl-rca-source");
        sourceInput.setAttribute("aria-label", "Evidence source");
        sourceInput.autocomplete = "off";
        sourceInput.value = ev.source || "";

        var errorMsg = el("p", "mt-hint", "");

        var gallery = evidencePhotosGallery(ev);

        var actions = el("div", "rca-evidence-edit-actions");
        var saveBtn = el("button", "mt-btn", "Save");
        saveBtn.type = "button";
        saveBtn.addEventListener("click", function () {
            var description = descInput.value.trim();
            if (!description) {
                errorMsg.textContent = "Description can't be empty.";
                descInput.focus();
                return;
            }
            var evidence = (c.evidence || []).map(function (e) {
                if (e.id !== ev.id) return e;
                var updated = {};
                Object.keys(e).forEach(function (k) { updated[k] = e[k]; });
                updated.date = dateInput.value || dateString(new Date());
                updated.description = description;
                updated.source = sourceInput.value.trim();
                return updated;
            });
            editingEvidence = null;
            updateCase(c.id, { evidence: evidence });
        });
        var cancelBtn = el("button", "mt-btn", "Cancel");
        cancelBtn.type = "button";
        cancelBtn.addEventListener("click", function () {
            editingEvidence = null;
            render();
        });
        actions.appendChild(saveBtn);
        actions.appendChild(cancelBtn);

        wrap.appendChild(dateInput);
        wrap.appendChild(descInput);
        wrap.appendChild(sourceInput);
        if (gallery) wrap.appendChild(gallery);
        wrap.appendChild(errorMsg);
        wrap.appendChild(actions);
        return wrap;
    }

    function buildEvidenceItem(c, ev) {
        if (editingEvidence && editingEvidence.caseId === c.id && editingEvidence.evidenceId === ev.id) {
            return buildEvidenceEditForm(c, ev);
        }

        var item = el("div", "rca-evidence-item");
        var head = el("div", "rca-evidence-head");
        head.appendChild(el("span", "rca-evidence-date", prettyDate(ev.date)));
        if (ev.source) head.appendChild(el("span", "rca-evidence-source", ev.source));
        item.appendChild(head);
        if (ev.description) item.appendChild(el("p", "rca-evidence-desc", ev.description));
        var gallery = evidencePhotosGallery(ev);
        if (gallery) item.appendChild(gallery);

        var actions = el("div", "rca-evidence-item-actions");
        var editBtn = el("button", "rca-evidence-edit-btn", "Edit");
        editBtn.type = "button";
        editBtn.setAttribute("aria-label", "Edit this evidence entry");
        editBtn.addEventListener("click", function () {
            editingEvidence = { caseId: c.id, evidenceId: ev.id };
            render();
        });
        var del = el("button", "rca-evidence-remove", "Remove");
        del.type = "button";
        del.setAttribute("aria-label", "Remove this evidence entry");
        del.addEventListener("click", function () {
            TrackerDialog.confirmDelete({
                title: "Remove evidence?",
                message: "This evidence entry will be removed from “" + c.title + "”. This cannot be undone.",
                confirmLabel: "Remove evidence"
            }, function () {
                updateCase(c.id, { evidence: (c.evidence || []).filter(function (e) { return e.id !== ev.id; }) });
            });
        });
        actions.appendChild(editBtn);
        actions.appendChild(del);
        item.appendChild(actions);
        return item;
    }

    function buildAddEvidenceForm(c, categoryKey) {
        var wrap = el("div", "rca-add-evidence");

        var dateInput = document.createElement("input");
        dateInput.type = "date";
        dateInput.value = dateString(new Date());
        dateInput.setAttribute("aria-label", "Evidence date");

        var descInput = document.createElement("textarea");
        descInput.rows = 2;
        descInput.placeholder = "What happened / what was observed";
        descInput.setAttribute("aria-label", "Evidence description");
        descInput.className = "nc-notes";

        var sourceInput = document.createElement("input");
        sourceInput.type = "text";
        sourceInput.placeholder = "Source (driver report, customer call, GPS log...)";
        sourceInput.setAttribute("list", "dl-rca-source");
        sourceInput.setAttribute("aria-label", "Evidence source");
        sourceInput.autocomplete = "off";

        var photoInput = document.createElement("input");
        photoInput.type = "file";
        photoInput.accept = "image/*";
        photoInput.multiple = true;
        photoInput.setAttribute("aria-label", "Attach photos");

        var photoStatus = el("p", "mt-hint", "");
        var pendingPhotos = [];

        photoInput.addEventListener("change", function () {
            pendingPhotos = [];
            var files = photoInput.files ? Array.prototype.slice.call(photoInput.files) : [];
            if (!files.length) {
                photoStatus.textContent = "";
                return;
            }
            photoStatus.textContent = "Processing " + files.length + " photo" + (files.length === 1 ? "" : "s") + "...";
            Promise.all(files.map(downscalePhoto)).then(function (dataUrls) {
                pendingPhotos = dataUrls;
                photoStatus.textContent = dataUrls.length + " photo" + (dataUrls.length === 1 ? "" : "s") + " attached.";
            }).catch(function (err) {
                photoStatus.textContent = err.message || "Could not attach one or more of those photos.";
            });
        });

        var addBtn = el("button", "mt-btn", "Add Evidence");
        addBtn.type = "button";
        addBtn.addEventListener("click", function () {
            var description = descInput.value.trim();
            if (!description) {
                photoStatus.textContent = "Enter a description before adding this evidence.";
                descInput.focus();
                return;
            }
            var evidence = (c.evidence || []).concat([{
                id: newId(),
                date: dateInput.value || dateString(new Date()),
                description: description,
                source: sourceInput.value.trim(),
                photos: pendingPhotos,
                category: categoryKey,
                created: Date.now()
            }]);
            // Adding evidence to a category flags it the same way checking its Root Cause
            // Category box would: once a category has supporting evidence, its pill shows.
            // This only ever turns a category ON; removing evidence never un-flags it, since a
            // conclusion already drawn from evidence shouldn't silently disappear because one
            // piece of evidence (possibly among several) was deleted later.
            var causes = {};
            Object.keys(c.causes || {}).forEach(function (k) { causes[k] = c.causes[k]; });
            causes[categoryKey] = true;
            updateCase(c.id, { evidence: evidence, causes: causes });
        });

        wrap.appendChild(dateInput);
        wrap.appendChild(descInput);
        wrap.appendChild(sourceInput);
        wrap.appendChild(photoInput);
        wrap.appendChild(photoStatus);
        wrap.appendChild(addBtn);
        return wrap;
    }

    function buildCard(c) {
        var card = el("article", "mt-entry rca-case rca-status-" + c.status);

        var head = el("div", "mt-entry-head");
        head.appendChild(el("h3", "mt-entry-address", c.title));
        head.appendChild(el("span", "mt-entry-date", "Opened " + prettyDate(dateString(new Date(c.created)))));
        card.appendChild(head);

        var chips = el("div", "mt-chips");
        chips.appendChild(el("span", "mt-chip mt-chip-status", labelFor(STATUSES, c.status)));
        if (c.route) chips.appendChild(el("span", "mt-chip", "Route " + c.route));
        if (c.address) chips.appendChild(el("span", "mt-chip", c.address));
        CAUSES.forEach(function (pair) {
            if (c.causes && c.causes[pair[0]]) chips.appendChild(el("span", "mt-chip mt-chip-reason", pair[1]));
        });
        card.appendChild(chips);

        if (c.description) card.appendChild(el("p", "mt-entry-meta", c.description));

        // Status select
        var statusField = el("div", "nc-notes-field");
        var statusLabel = el("label", "nc-notes-label", "Status");
        var statusSelectId = "rca-status-" + c.id;
        statusLabel.id = statusSelectId + "-label";
        var statusSelect = el("select", "mt-entry-status rca-status-select");
        statusSelect.setAttribute("aria-labelledby", statusSelectId + "-label");
        fillSelect(statusSelect, STATUSES);
        statusSelect.value = c.status;
        statusSelect.addEventListener("change", function () {
            updateCase(c.id, { status: statusSelect.value });
        });
        statusField.appendChild(statusLabel);
        statusField.appendChild(statusSelect);
        card.appendChild(statusField);

        // Root cause + corrective action text, saved on blur like New Customers' notes field
        [["rootCause", "Root Cause"], ["correctiveAction", "Corrective Action"]].forEach(function (pair) {
            var key = pair[0];
            var field = el("div", "nc-notes-field");
            var labelId = "rca-" + key + "-" + c.id;
            field.appendChild(el("label", "nc-notes-label", pair[1])).id = labelId;
            var textarea = document.createElement("textarea");
            textarea.className = "nc-notes rca-text";
            textarea.rows = 2;
            textarea.setAttribute("aria-labelledby", labelId);
            textarea.value = c[key] || "";
            textarea.addEventListener("blur", function () {
                if (textarea.value !== (c[key] || "")) {
                    var patch = {};
                    patch[key] = textarea.value;
                    updateCase(c.id, patch);
                }
            });
            field.appendChild(textarea);
            card.appendChild(field);
        });

        // Evidence pool: one section per fishbone category. Adding evidence to a category
        // auto-flags its category pill above (see buildAddEvidenceForm).
        var allEvidence = c.evidence || [];
        var evidenceSection = el("div", "rca-evidence");
        evidenceSection.appendChild(el("h4", "nc-notes-label", "Evidence (" + allEvidence.length + ")"));

        function byNewest(a, b) {
            return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.created || 0) - (a.created || 0);
        }

        CAUSES.forEach(function (pair) {
            var key = pair[0], label = pair[1];
            var catEvidence = allEvidence.filter(function (ev) { return ev.category === key; });

            var sub = el("div", "rca-evidence-category");
            var subHead = el("div", "rca-evidence-category-head");
            subHead.appendChild(el("span", "rca-evidence-category-name", label));
            subHead.appendChild(el("span", "rca-evidence-category-count", String(catEvidence.length)));
            sub.appendChild(subHead);

            var list = el("div", "rca-evidence-list");
            catEvidence.slice().sort(byNewest).forEach(function (ev) { list.appendChild(buildEvidenceItem(c, ev)); });
            if (!catEvidence.length) list.appendChild(el("p", "mt-hint", "No evidence yet."));
            sub.appendChild(list);

            sub.appendChild(buildAddEvidenceForm(c, key));
            evidenceSection.appendChild(sub);
        });

        // Evidence saved before categories existed: kept visible rather than hidden/dropped
        var uncategorized = allEvidence.filter(function (ev) { return !ev.category; });
        if (uncategorized.length) {
            var legacySub = el("div", "rca-evidence-category");
            var legacyHead = el("div", "rca-evidence-category-head");
            legacyHead.appendChild(el("span", "rca-evidence-category-name", "Uncategorized"));
            legacyHead.appendChild(el("span", "rca-evidence-category-count", String(uncategorized.length)));
            legacySub.appendChild(legacyHead);
            var legacyList = el("div", "rca-evidence-list");
            uncategorized.slice().sort(byNewest).forEach(function (ev) { legacyList.appendChild(buildEvidenceItem(c, ev)); });
            legacySub.appendChild(legacyList);
            evidenceSection.appendChild(legacySub);
        }

        card.appendChild(evidenceSection);

        var actions = el("div", "mt-entry-actions");
        var pdfBtn = el("button", "mt-btn", "Generate PDF");
        pdfBtn.type = "button";
        pdfBtn.addEventListener("click", function () {
            var label = pdfBtn.textContent;
            pdfBtn.disabled = true;
            pdfBtn.textContent = "Generating...";
            logoPromise
                .then(function (logo) { buildCasePdf(c, logo); })
                .catch(function (err) {
                    console.error(err);
                    alert("Sorry, the PDF could not be created.");
                })
                .then(function () {
                    pdfBtn.disabled = false;
                    pdfBtn.textContent = label;
                });
        });
        var edit = el("button", "mt-btn", "Edit");
        edit.type = "button";
        edit.setAttribute("aria-label", "Edit " + c.title);
        edit.addEventListener("click", function () { startEdit(c.id); });
        var del = el("button", "mt-btn mt-btn-danger", "Delete");
        del.type = "button";
        del.setAttribute("aria-label", "Delete " + c.title);
        del.addEventListener("click", function () { removeCase(c.id); });
        actions.appendChild(pdfBtn);
        actions.appendChild(edit);
        actions.appendChild(del);
        card.appendChild(actions);

        return card;
    }

    function render() {
        var cases = load().sort(newest);
        var term = searchEl.value.trim().toLowerCase();
        var status = filterStatus.value;

        renderStats(cases);
        renderDatalists(cases);

        var shown = cases.filter(function (c) {
            return (!status || c.status === status) && matchesSearch(c, term);
        });

        listEl.textContent = "";
        shown.forEach(function (c) { listEl.appendChild(buildCard(c)); });

        if (!cases.length) {
            countEl.textContent = "No RCA cases yet. Use the form above to open the first one.";
        } else if (!shown.length) {
            countEl.textContent = "Nothing matches the current search or filter.";
        } else {
            countEl.textContent = "Showing " + shown.length + " of " + cases.length;
        }
        document.getElementById("rca-export").disabled = !cases.length;
    }

    /* ---------- Form ---------- */

    function readForm() {
        return {
            title: fields.title.value.trim(),
            description: fields.description.value.trim(),
            route: fields.route.value.trim(),
            address: fields.address.value.trim()
        };
    }

    function resetForm() {
        editingId = null;
        formTitle.textContent = "OPEN NEW RCA CASE";
        submitBtn.textContent = "Save Entry";
        cancelBtn.hidden = true;
        form.reset();
    }

    function startEdit(id) {
        var c = load().filter(function (x) { return x.id === id; })[0];
        if (!c) return;
        editingId = id;
        fields.title.value = c.title || "";
        fields.description.value = c.description || "";
        fields.route.value = c.route || "";
        fields.address.value = c.address || "";
        formTitle.textContent = "EDIT CASE";
        submitBtn.textContent = "Save Changes";
        cancelBtn.hidden = false;
        say("");
        form.scrollIntoView({ behavior: "smooth", block: "start" });
        fields.title.focus({ preventScroll: true });
    }

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
            data.status = "open";
            data.causes = {};
            data.rootCause = "";
            data.correctiveAction = "";
            data.evidence = [];
            data.created = Date.now();
            list.push(data);
        }
        if (!save(list)) return;

        var wasEdit = !!existing;
        resetForm();
        render();
        say(wasEdit ? "Changes saved." : "Case opened.");
    });

    cancelBtn.addEventListener("click", function () {
        resetForm();
        say("");
    });

    function removeCase(id) {
        var c = load().filter(function (e) { return e.id === id; })[0];
        if (!c) return;
        TrackerDialog.confirmDelete({
            title: "Delete case?",
            message: "“" + c.title + "” and all of its evidence will be deleted. This cannot be undone.",
            confirmLabel: "Delete case"
        }, function () {
            save(load().filter(function (e) { return e.id !== id; }));
            if (editingId === id) resetForm();
            render();
        });
    }

    searchEl.addEventListener("input", render);
    filterStatus.addEventListener("change", render);

    /* ---------- CSV export: one row per evidence entry, case details repeated on each row ---------- */

    function csvCell(value) {
        var text = String(value == null ? "" : value);
        if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    }

    document.getElementById("rca-export").addEventListener("click", function () {
        var cases = load().sort(newest);
        var rows = [["Case", "Status", "Route", "Address", "Cause Categories", "Root Cause",
            "Corrective Action", "Evidence Category", "Evidence Date", "Evidence Description", "Evidence Source", "Photo Count"]];
        cases.forEach(function (c) {
            var causeList = CAUSES.filter(function (p) { return c.causes && c.causes[p[0]]; }).map(function (p) { return p[1]; }).join("; ");
            var evidence = c.evidence || [];
            if (!evidence.length) {
                rows.push([c.title, labelFor(STATUSES, c.status), c.route, c.address, causeList, c.rootCause, c.correctiveAction, "", "", "", "", ""]);
            } else {
                evidence.forEach(function (ev) {
                    rows.push([c.title, labelFor(STATUSES, c.status), c.route, c.address, causeList, c.rootCause, c.correctiveAction,
                        ev.category ? causeLabel(ev.category) : "Uncategorized", ev.date, ev.description, ev.source, photosFor(ev).length]);
                });
            }
        });
        var csv = "﻿" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");

        var url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        var link = document.createElement("a");
        link.href = url;
        link.download = "rca-evidence-" + dateString(new Date()) + ".csv";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    });

    /* ---------- PDF report ---------- */

    function buildCasePdf(c, logo) {
        if (!window.jspdf) {
            alert("The PDF library did not load. Reload the page and try again.");
            return;
        }
        var NAVY = [4, 57, 96], GREEN = [4, 102, 53], INK = [26, 26, 26];
        var GRAY = [110, 118, 126], RULE = [214, 222, 230], TINT = [244, 247, 250];

        var PAGE_W = 612, PAGE_H = 792, M = 40;
        var CONTENT_W = PAGE_W - M * 2;
        var BOTTOM = PAGE_H - 54;
        var LOGO_SIZE = 50;

        var doc = new window.jspdf.jsPDF({ unit: "pt", format: "letter" });
        var y = M;
        function color(fn, col) { doc[fn](col[0], col[1], col[2]); }
        function ensure(h) { if (y + h > BOTTOM) { doc.addPage(); y = M; return true; } return false; }

        if (logo) doc.addImage(logo, "PNG", PAGE_W - M - LOGO_SIZE, M - 4, LOGO_SIZE, LOGO_SIZE);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        color("setTextColor", NAVY);
        doc.text("Root Cause Assessment", M, y + 20);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        color("setTextColor", GRAY);
        doc.text("Earthwise Environmental Solutions", M, y + 34);
        y += 50;
        color("setFillColor", GREEN);
        doc.rect(M, y, CONTENT_W, 3, "F");
        y += 16;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        color("setTextColor", NAVY);
        var titleLines = doc.splitTextToSize(c.title || "Untitled Case", CONTENT_W);
        doc.text(titleLines, M, y + 12);
        y += titleLines.length * 16 + 10;

        var infoRows = [
            ["Status", labelFor(STATUSES, c.status)],
            ["Route", c.route || "N/A"],
            ["Address / Area", c.address || "N/A"],
            ["Opened", prettyDate(dateString(new Date(c.created)))]
        ];
        var infoH = 14 + infoRows.length * 16;
        color("setFillColor", TINT);
        doc.roundedRect(M, y, CONTENT_W, infoH, 4, 4, "F");
        var iy = y + 18;
        infoRows.forEach(function (row) {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8);
            color("setTextColor", NAVY);
            doc.text(row[0].toUpperCase(), M + 12, iy);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9.5);
            color("setTextColor", INK);
            doc.text(String(row[1]), M + 140, iy);
            iy += 16;
        });
        y += infoH + 16;

        function sectionBar(title) {
            ensure(20 + 20);
            color("setFillColor", NAVY);
            doc.rect(M, y, CONTENT_W, 18, "F");
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            color("setTextColor", [255, 255, 255]);
            doc.text(title, M + 8, y + 13);
            y += 18 + 8;
        }

        function paragraph(text) {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9.5);
            color("setTextColor", INK);
            var lines = doc.splitTextToSize(text || "N/A", CONTENT_W);
            var lineH = 12;
            var i = 0;
            while (i < lines.length) {
                var fit = Math.max(1, Math.floor((BOTTOM - y) / lineH));
                var chunk = lines.slice(i, i + fit);
                doc.text(chunk, M, y + 10, { lineHeightFactor: 1.3 });
                y += chunk.length * lineH + 4;
                i += chunk.length;
                if (i < lines.length) { doc.addPage(); y = M; }
            }
        }

        sectionBar("Problem Description");
        paragraph(c.description);
        y += 10;

        sectionBar("Root Cause");
        var causeList = CAUSES.filter(function (p) { return c.causes && c.causes[p[0]]; }).map(function (p) { return p[1]; });
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        color("setTextColor", NAVY);
        doc.text("CATEGORY: " + (causeList.length ? causeList.join(", ") : "Not yet determined"), M, y + 9);
        y += 20;
        paragraph(c.rootCause || "Not yet determined.");
        y += 10;

        sectionBar("Corrective Action");
        paragraph(c.correctiveAction || "Not yet determined.");
        y += 10;

        var evidence = (c.evidence || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
        sectionBar("Evidence Timeline (" + evidence.length + ")");
        if (!evidence.length) {
            paragraph("No evidence logged.");
        } else {
            evidence.forEach(function (ev) {
                var headerText = prettyDate(ev.date) + "  ·  " + (ev.category ? causeLabel(ev.category) : "Uncategorized") +
                    (ev.source ? "  ·  " + ev.source : "");
                var descLines = doc.splitTextToSize(ev.description || "", CONTENT_W - 12);
                var textH = 14 + descLines.length * 12;
                var blockH = textH + 14;

                if (y + blockH > BOTTOM) { doc.addPage(); y = M; }

                color("setDrawColor", RULE);
                doc.setLineWidth(0.7);
                doc.rect(M, y, CONTENT_W, blockH, "S");
                doc.setFont("helvetica", "bold");
                doc.setFontSize(9);
                color("setTextColor", NAVY);
                doc.text(headerText, M + 8, y + 14);
                doc.setFont("helvetica", "normal");
                doc.setFontSize(9);
                color("setTextColor", INK);
                doc.text(descLines, M + 8, y + 28, { lineHeightFactor: 1.25 });
                y += blockH + 8;

                // Each photo gets its own large, clear block of its own (not a cramped
                // thumbnail wedged into the text box above), with its own page-break check
                photosFor(ev).forEach(function (photoData) {
                    try {
                        var props = doc.getImageProperties(photoData);
                        var maxW = CONTENT_W, maxH = 340;
                        var scale = Math.min(maxW / props.width, maxH / props.height, 1);
                        var w = props.width * scale, h = props.height * scale;
                        if (y + h > BOTTOM) { doc.addPage(); y = M; }
                        doc.addImage(photoData, "JPEG", M + (CONTENT_W - w) / 2, y, w, h);
                        y += h + 10;
                    } catch (e) { /* unreadable image: skip it rather than fail the whole report */ }
                });
            });
        }

        var pages = doc.getNumberOfPages();
        var footerText = ["RCA", c.title].filter(Boolean).join("  ·  ");
        for (var pg = 1; pg <= pages; pg++) {
            doc.setPage(pg);
            color("setDrawColor", RULE);
            doc.setLineWidth(0.6);
            doc.line(M, PAGE_H - 40, PAGE_W - M, PAGE_H - 40);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            color("setTextColor", GRAY);
            doc.text(footerText, M, PAGE_H - 27);
            doc.text("Page " + pg + " of " + pages, PAGE_W - M, PAGE_H - 27, { align: "right" });
        }

        var fileSafeTitle = (c.title || "RCA-Case").replace(/[\\/:*?"<>|]/g, "");
        doc.save(fileSafeTitle + " - " + dateString(new Date()) + ".pdf");
    }

    // Another open copy of this page changed the log
    window.addEventListener("storage", function (ev) {
        if (ev.key === KEY) render();
    });

    /* ---------- Start ---------- */

    fillSelect(filterStatus, STATUSES, "All statuses");
    resetForm();
    render();
})();
