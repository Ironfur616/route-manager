/* Root Cause Assessment (RCA) tracker (rca.html).
   Same running-log pattern as missed-tracker.js / new-customers.js: cases live in localStorage
   until deleted, not in a draft. The page opts out of the shell's draft handling with
   data-no-draft on <html>.

   Structure: one CASE per ongoing problem. Evidence entries (date, description, source, an
   optional photo) are logged under a case over time, building toward a root cause (tagged with
   the standard fishbone categories) and a corrective action. A case's status (Open /
   Investigating / Resolved) drives its left status bar, same visual language as Missed
   Collections: red = unresolved, blue = being worked, green = done. */
(function () {
    "use strict";

    var KEY = "fleetMgrRCA";
    var MAX_PHOTO_DIM = 1000; // px, longest side after downscaling
    var PHOTO_QUALITY = 0.72; // JPEG quality; keeps a phone photo down to roughly 100-300KB

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
        var evidenceText = (c.evidence || []).map(function (ev) { return ev.description + " " + ev.source; }).join(" ");
        return [c.title, c.description, c.route, c.address, c.rootCause, c.correctiveAction, evidenceText]
            .join(" ").toLowerCase().indexOf(term) !== -1;
    }

    function buildEvidenceItem(c, ev) {
        var item = el("div", "rca-evidence-item");
        var head = el("div", "rca-evidence-head");
        head.appendChild(el("span", "rca-evidence-date", prettyDate(ev.date)));
        if (ev.source) head.appendChild(el("span", "rca-evidence-source", ev.source));
        item.appendChild(head);
        if (ev.description) item.appendChild(el("p", "rca-evidence-desc", ev.description));
        if (ev.photo) {
            var link = document.createElement("a");
            link.href = ev.photo;
            link.target = "_blank";
            link.rel = "noopener";
            var img = document.createElement("img");
            img.src = ev.photo;
            img.alt = "Evidence photo";
            img.className = "rca-evidence-photo";
            link.appendChild(img);
            item.appendChild(link);
        }
        var del = el("button", "rca-evidence-remove", "Remove");
        del.type = "button";
        del.setAttribute("aria-label", "Remove this evidence entry");
        del.addEventListener("click", function () {
            if (!confirm("Remove this evidence entry? This cannot be undone.")) return;
            updateCase(c.id, { evidence: (c.evidence || []).filter(function (e) { return e.id !== ev.id; }) });
        });
        item.appendChild(del);
        return item;
    }

    function buildAddEvidenceForm(c) {
        var wrap = el("div", "rca-add-evidence");
        wrap.appendChild(el("h4", "nc-notes-label", "Add Evidence"));

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
        photoInput.setAttribute("aria-label", "Attach a photo");

        var photoStatus = el("p", "mt-hint", "");
        var pendingPhoto = null;

        photoInput.addEventListener("change", function () {
            pendingPhoto = null;
            photoStatus.textContent = "";
            var file = photoInput.files && photoInput.files[0];
            if (!file) return;
            photoStatus.textContent = "Processing photo...";
            downscalePhoto(file).then(function (dataUrl) {
                pendingPhoto = dataUrl;
                photoStatus.textContent = "Photo attached.";
            }).catch(function (err) {
                photoStatus.textContent = err.message || "Could not attach that photo.";
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
                photo: pendingPhoto,
                created: Date.now()
            }]);
            updateCase(c.id, { evidence: evidence });
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
        var statusSelect = el("select", "mt-entry-status");
        statusSelect.setAttribute("aria-labelledby", statusSelectId + "-label");
        fillSelect(statusSelect, STATUSES);
        statusSelect.value = c.status;
        statusSelect.addEventListener("change", function () {
            updateCase(c.id, { status: statusSelect.value });
        });
        statusField.appendChild(statusLabel);
        statusField.appendChild(statusSelect);
        card.appendChild(statusField);

        // Root cause: fishbone categories
        var causeField = el("div", "nc-notes-field");
        causeField.appendChild(el("span", "nc-notes-label", "Root Cause Category"));
        var causeChecks = el("div", "nc-checks rca-cause-checks");
        CAUSES.forEach(function (pair) {
            var key = pair[0];
            var label = el("label", "nc-check");
            var input = document.createElement("input");
            input.type = "checkbox";
            input.checked = !!(c.causes && c.causes[key]);
            input.addEventListener("change", function () {
                var causes = {};
                Object.keys(c.causes || {}).forEach(function (k) { causes[k] = c.causes[k]; });
                causes[key] = input.checked;
                updateCase(c.id, { causes: causes });
            });
            label.appendChild(input);
            label.appendChild(document.createTextNode(pair[1]));
            causeChecks.appendChild(label);
        });
        causeField.appendChild(causeChecks);
        card.appendChild(causeField);

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

        // Evidence pool
        var evidenceSection = el("div", "rca-evidence");
        evidenceSection.appendChild(el("h4", "nc-notes-label", "Evidence (" + (c.evidence || []).length + ")"));
        var evidenceList = el("div", "rca-evidence-list");
        (c.evidence || []).slice().sort(function (a, b) {
            return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.created || 0) - (a.created || 0);
        }).forEach(function (ev) { evidenceList.appendChild(buildEvidenceItem(c, ev)); });
        if (!(c.evidence || []).length) evidenceList.appendChild(el("p", "mt-hint", "No evidence logged yet."));
        evidenceSection.appendChild(evidenceList);
        evidenceSection.appendChild(buildAddEvidenceForm(c));
        card.appendChild(evidenceSection);

        var actions = el("div", "mt-entry-actions");
        var pdfBtn = el("button", "mt-btn", "Generate PDF");
        pdfBtn.type = "button";
        pdfBtn.addEventListener("click", function () { buildCasePdf(c); });
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
        if (!confirm("Delete this case and all of its evidence? This cannot be undone.")) return;
        save(load().filter(function (c) { return c.id !== id; }));
        if (editingId === id) resetForm();
        render();
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
            "Corrective Action", "Evidence Date", "Evidence Description", "Evidence Source", "Has Photo"]];
        cases.forEach(function (c) {
            var causeList = CAUSES.filter(function (p) { return c.causes && c.causes[p[0]]; }).map(function (p) { return p[1]; }).join("; ");
            var evidence = c.evidence || [];
            if (!evidence.length) {
                rows.push([c.title, labelFor(STATUSES, c.status), c.route, c.address, causeList, c.rootCause, c.correctiveAction, "", "", "", ""]);
            } else {
                evidence.forEach(function (ev) {
                    rows.push([c.title, labelFor(STATUSES, c.status), c.route, c.address, causeList, c.rootCause, c.correctiveAction,
                        ev.date, ev.description, ev.source, ev.photo ? "Yes" : "No"]);
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

    function buildCasePdf(c) {
        if (!window.jspdf) {
            alert("The PDF library did not load. Reload the page and try again.");
            return;
        }
        var NAVY = [4, 57, 96], GREEN = [4, 102, 53], INK = [26, 26, 26];
        var GRAY = [110, 118, 126], RULE = [214, 222, 230], TINT = [244, 247, 250];

        var PAGE_W = 612, PAGE_H = 792, M = 40;
        var CONTENT_W = PAGE_W - M * 2;
        var BOTTOM = PAGE_H - 54;

        var doc = new window.jspdf.jsPDF({ unit: "pt", format: "letter" });
        var y = M;
        function color(fn, col) { doc[fn](col[0], col[1], col[2]); }
        function ensure(h) { if (y + h > BOTTOM) { doc.addPage(); y = M; return true; } return false; }

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
            evidence.forEach(function (ev, idx) {
                var headerText = prettyDate(ev.date) + (ev.source ? "  ·  " + ev.source : "");
                var descLines = doc.splitTextToSize(ev.description || "", CONTENT_W - 12);
                var textH = 14 + descLines.length * 12;
                var imgDims = null;
                if (ev.photo) {
                    try {
                        var props = doc.getImageProperties(ev.photo);
                        var maxW = CONTENT_W - 12, maxH = 160;
                        var scale = Math.min(maxW / props.width, maxH / props.height, 1);
                        imgDims = { w: props.width * scale, h: props.height * scale };
                    } catch (e) { imgDims = null; }
                }
                var blockH = textH + (imgDims ? imgDims.h + 8 : 0) + 14;

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
                if (imgDims) {
                    doc.addImage(ev.photo, "JPEG", M + 6, y + textH + 6, imgDims.w, imgDims.h);
                }
                y += blockH + 8;
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
