/* Generate PDF: builds a formatted report from the form with jsPDF (jspdf.umd.min.js)
   and downloads it. Everything runs in the browser, so it works offline. */
(function () {
    var button = document.getElementById("generate-pdf");
    if (!button) return;

    var NAVY = [4, 57, 96];
    var GREEN = [4, 102, 53];
    var SKY = [86, 157, 214];
    var INK = [26, 26, 26];
    var GRAY = [110, 118, 126];
    var RULE = [214, 222, 230];
    var TINT = [244, 247, 250];
    var RISK_TINT = [253, 237, 235];
    var RISK = [178, 34, 34];

    var PAGE_W = 612;
    var PAGE_H = 792;
    var M = 32;
    var CONTENT_W = PAGE_W - M * 2;
    var BOTTOM = PAGE_H - 40;
    // Each form names its own report: <form class="emp-info" data-title="Residential Driver Observation">.
    // Without it, the page title up to the " · " is used.
    var formEl = document.querySelector("form.emp-info");
    var TITLE = (formEl && formEl.getAttribute("data-title")) || document.title.split(" · ")[0].trim() || "Observation";

    var BOX = 9;
    var BOX_STEP = 21;
    var TEXT_X = M + 3 * BOX_STEP + 7;

    function val(id) {
        var el = document.getElementById(id);
        return el ? el.value.trim() : "";
    }

    // Reads a field's own <label> text instead of hardcoding it, so forms with different
    // wording for the same field (e.g. Safety Lane Check's "Date:" vs the observation
    // forms' "Date of Observation") each print their own label.
    function fieldLabel(id, fallback) {
        var label = document.querySelector('label[for="' + id + '"]');
        var text = label ? label.textContent.replace(/:\s*$/, "").trim() : "";
        return text || fallback;
    }

    // Reads a field's value formatted for its own input type, so a form doesn't have to
    // name a field "obs-date" just to get date formatting - any <input type="date"> does.
    function fieldValue(id) {
        var el = document.getElementById(id);
        if (!el) return null;
        if (el.type === "date") return fmtDate(el.value.trim());
        if (el.type === "time") return fmtTime(el.value.trim());
        if (el.tagName === "SELECT") return (el.options[el.selectedIndex] || {}).text || "";
        return el.value.trim();
    }

    function fmtDate(v) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
        return m ? m[2] + "/" + m[3] + "/" + m[1] : v;
    }

    function fmtTime(v) {
        var m = /^(\d{2}):(\d{2})$/.exec(v);
        if (!m) return v;
        var h = parseInt(m[1], 10);
        return ((h % 12) || 12) + ":" + m[2] + " " + (h < 12 ? "AM" : "PM");
    }

    function fileName() {
        var parts = [TITLE, val("emp-name"), val("obs-date")].filter(Boolean).join(" - ");
        return parts.replace(/[\\/:*?"<>|]/g, "") + ".pdf";
    }

    function loadImage(url) {
        return fetch(url)
            .then(function (r) { return r.blob(); })
            .then(function (blob) {
                return new Promise(function (resolve, reject) {
                    var reader = new FileReader();
                    reader.onload = function () { resolve(reader.result); };
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            })
            .catch(function () { return null; }); // report still works without the logo
    }

    /* Pull the observed practices out of the page so the PDF always matches the form */
    function readSections() {
        var sections = [];
        document.querySelectorAll("form.emp-info fieldset").forEach(function (fs) {
            var rows = fs.querySelectorAll(".practice:not(.practice-head)");
            if (!rows.length) return;
            // Trainee form: sections for the role that was not picked print as N/A
            var locked = fs.classList.contains("role-locked");
            var legend = fs.querySelector("legend").cloneNode(true);
            var legendNote = legend.querySelector("#note");
            if (legendNote) legendNote.remove();
            sections.push({
                title: legend.textContent.trim(),
                locked: locked,
                rows: locked ? [] : Array.prototype.map.call(rows, function (row) {
                    var text = row.querySelector(".practice-text").cloneNode(true);
                    var note = text.querySelector("#note");
                    var noteText = note ? note.textContent.trim() : "";
                    if (note) note.remove();
                    var boxes = row.querySelectorAll("input[type=checkbox]");
                    return {
                        label: text.textContent.replace(/\s+/g, " ").trim(),
                        note: noteText,
                        safe: boxes[0].checked,
                        risk: boxes[1].checked,
                        na: boxes[2].checked
                    };
                })
            });
        });
        return sections;
    }

    /* Pull the signers out of the SIGNATURES fieldset generically: whatever .field inputs
       (Name, and Date/Time where the form has them) sit before a given signature pad belong
       to that signer. This lets a leaner form like Safety Lane Check - Name only, no Date/Time
       rows - print correctly without the PDF needing to know which form it's on. */
    function readSigners() {
        var fieldsets = document.querySelectorAll("form.emp-info fieldset");
        var sigFieldset = Array.prototype.filter.call(fieldsets, function (fs) {
            return fs.querySelector("[data-signature]");
        })[0];
        if (!sigFieldset) return [];

        var signers = [];
        var pending = [];
        Array.prototype.forEach.call(sigFieldset.children, function (child) {
            if (child.classList.contains("field")) {
                var input = child.querySelector("input, textarea");
                if (!input) return;
                var v = input.value.trim();
                pending.push(input.type === "date" ? fmtDate(v) : input.type === "time" ? fmtTime(v) : v);
            } else if (child.classList.contains("signature-field")) {
                // Preferred: the field names its own print title via data-signer-title, so the
                // PDF never has to guess whether the on-page title is a <label> or a <span>.
                // Falls back to the old aria-labelledby lookup for forms not yet migrated.
                var hidden = child.querySelector('input[type="hidden"]');
                var title = child.getAttribute("data-signer-title");
                if (!title) {
                    var canvas = child.querySelector("canvas[aria-labelledby]");
                    var titleEl = canvas && document.getElementById(canvas.getAttribute("aria-labelledby"));
                    title = titleEl ? titleEl.textContent.trim() : "Signature";
                }
                signers.push({ title: title, values: pending, sigName: hidden ? hidden.name : "" });
                pending = [];
            }
        });
        return signers;
    }

    function build(jsPDF, logo) {
        var doc = new jsPDF({ unit: "pt", format: "letter" });
        var y = M;
        var sections = readSections();

        function color(fn, c) { doc[fn](c[0], c[1], c[2]); }

        function ensure(h) {
            if (y + h <= BOTTOM) return false;
            doc.addPage();
            y = M;
            return true;
        }

        /* ---- Header ---- */
        if (logo) doc.addImage(logo, "PNG", M - 3, y - 3, 38, 38);
        var titleX = logo ? M + 42 : M;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        color("setTextColor", NAVY);
        doc.text(TITLE, titleX, y + 16);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        color("setTextColor", GRAY);
        doc.text("Earthwise Environmental Solutions", titleX, y + 27);
        y += 38;
        color("setFillColor", GREEN);
        doc.rect(M, y, CONTENT_W, 2, "F");
        y += 8;

        /* ---- Employee information ----
           A form lists which fields to print, and in what order, via
           data-pdf-fields="id id id" on <form class="emp-info">. Each id's own <label> supplies
           the printed field name and its <input> type supplies the formatting (date/time/select),
           so a new form opts in without generate-pdf.js needing to know its field names.
           Forms that haven't set data-pdf-fields fall back to the original fixed list, so
           nothing breaks until they're migrated. */
        var DEFAULT_FIELD_IDS = ["emp-name", "obs-date", "obs-time", "obs-location", "unit"];
        var configuredIds = formEl && formEl.getAttribute("data-pdf-fields");
        var fieldIds = configuredIds ? configuredIds.trim().split(/\s+/) : DEFAULT_FIELD_IDS;

        var GAP = 16;
        var ROW_SIZE = 3;
        var allFields = [];
        fieldIds.forEach(function (id) {
            var v = fieldValue(id);
            if (v !== null) allFields.push([fieldLabel(id, id), v]);
        });
        var fields = [];
        for (var fi = 0; fi < allFields.length; fi += ROW_SIZE) fields.push(allFields.slice(fi, fi + ROW_SIZE));

        // Trainee form only: Driver / Helper and the training period
        var roleEl = document.querySelector('input[name="role"]:checked');
        var periodEl = document.getElementById("training-period");
        var extra = [];
        if (document.querySelector('input[name="role"]')) extra.push(["Position", roleEl ? roleEl.parentNode.textContent.trim() : ""]);
        if (periodEl) extra.push(["Training Period", periodEl.value]);
        if (extra.length) fields.push(extra);
        var ROW_H = 22;
        var infoH = 10 + fields.length * ROW_H;
        color("setFillColor", TINT);
        doc.roundedRect(M, y, CONTENT_W, infoH, 3, 3, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.5);
        color("setTextColor", NAVY);
        doc.text("EMPLOYEE INFORMATION", M + 10, y + 10);
        var fy = y + 16;
        fields.forEach(function (row) {
            var w = (CONTENT_W - 20 - GAP * (row.length - 1)) / row.length;
            row.forEach(function (f, i) {
                var fx = M + 10 + i * (w + GAP);
                doc.setFont("helvetica", "normal");
                doc.setFontSize(6);
                color("setTextColor", GRAY);
                doc.text(f[0].toUpperCase(), fx, fy + 6);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(9);
                color("setTextColor", INK);
                doc.text(doc.splitTextToSize(f[1] || " ", w)[0], fx, fy + 16);
                color("setDrawColor", RULE);
                doc.setLineWidth(0.5);
                doc.line(fx, fy + 19, fx + w, fy + 19);
            });
            fy += ROW_H;
        });
        y += infoH + 8;

        /* ---- Key with totals ----
           The column symbols (and what they mean) come from the form's own practice-head row,
           so Safety Lane Check's Pass/Fail/N-A reads correctly instead of the observation
           forms' Safe/At-Risk/Not-Observed wording. */
        var totals = { safe: 0, risk: 0, na: 0 };
        sections.forEach(function (s) {
            s.rows.forEach(function (r) {
                if (r.safe) totals.safe++;
                if (r.risk) totals.risk++;
                if (r.na) totals.na++;
            });
        });
        // Each header glyph carries its own readable label via data-label, e.g.
        // <span data-label="Pass">P</span>, so the key never has to guess what a glyph means.
        // Falls back to the old guess-from-glyph dictionary for forms not yet migrated.
        var headEl = document.querySelector("form.emp-info .practice-head");
        var headSpans = headEl ? headEl.querySelectorAll("span") : [];
        var KEY_LABELS = { "+": "Safe", "−": "At Risk", "–": "At Risk", "-": "At Risk", "N/O": "Not Observed", "P": "Pass", "F": "Fail", "N/A": "N/A" };
        var HEADERS = headSpans.length
            ? Array.prototype.map.call(headSpans, function (s) { return s.textContent.trim(); })
            : ["+", "−", "N/O"];
        var HEADER_LABELS = headSpans.length
            ? Array.prototype.map.call(headSpans, function (s) {
                return s.getAttribute("data-label") || KEY_LABELS[s.textContent.trim()] || s.textContent.trim();
            })
            : ["Safe", "At Risk", "Not Observed"];
        var keys = [
            [HEADERS[0], HEADER_LABELS[0], totals.safe],
            [HEADERS[1], HEADER_LABELS[1], totals.risk],
            [HEADERS[2], HEADER_LABELS[2], totals.na]
        ];
        var kx = M;
        keys.forEach(function (k) {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(7);
            var badgeW = k[0].length > 1 ? 18 : 12;
            color("setDrawColor", NAVY);
            doc.setLineWidth(0.8);
            doc.roundedRect(kx, y, badgeW, 11, 2, 2, "S");
            color("setTextColor", NAVY);
            doc.text(k[0], kx + badgeW / 2, y + 8, { align: "center" });
            doc.setFont("helvetica", "normal");
            color("setTextColor", INK);
            var label = k[1] + "  ";
            doc.text(label, kx + badgeW + 4, y + 8);
            var lw = doc.getTextWidth(label);
            doc.setFont("helvetica", "bold");
            doc.text(String(k[2]), kx + badgeW + 4 + lw, y + 8);
            kx += badgeW + 4 + lw + doc.getTextWidth(String(k[2])) + 14;
        });
        y += 12;

        /* ---- Practice sections ---- */
        var BAR_H = 13;
        var ROW_FONT = 8.5, ROW_LINE_H = 9, ROW_MIN_H = 14;

        function drawBar(title) {
            color("setFillColor", NAVY);
            doc.rect(M, y, CONTENT_W, BAR_H, "F");
            doc.setFont("helvetica", "bold");
            doc.setFontSize(7);
            color("setTextColor", [255, 255, 255]);
            HEADERS.forEach(function (h, i) {
                doc.text(h, M + i * BOX_STEP + BOX_STEP / 2, y + 9.5, { align: "center" });
            });
            doc.setFontSize(8);
            doc.text(title, TEXT_X, y + 9.5);
            y += BAR_H;
        }

        function drawBox(x, by, on, risk) {
            color("setDrawColor", on && risk ? RISK : NAVY);
            doc.setLineWidth(0.8);
            doc.rect(x, by, BOX, BOX, "S");
            if (on) {
                color("setDrawColor", risk ? RISK : GREEN);
                doc.setLineWidth(1.2);
                doc.line(x + 1.5, by + 1.5, x + BOX - 1.5, by + BOX - 1.5);
                doc.line(x + BOX - 1.5, by + 1.5, x + 1.5, by + BOX - 1.5);
            }
        }

        sections.forEach(function (sec) {
            // Keep the bar with at least its first row
            ensure(BAR_H + 30);
            drawBar(sec.title);

            if (sec.locked) {
                var naH = 15;
                doc.setFont("helvetica", "bold");
                doc.setFontSize(8);
                color("setTextColor", GRAY);
                doc.text("N/A", TEXT_X, y + 10.5);
                color("setDrawColor", RULE);
                doc.setLineWidth(0.4);
                doc.line(M, y + naH, M + CONTENT_W, y + naH);
                y += naH + 3;
                return;
            }

            sec.rows.forEach(function (row, idx) {
                doc.setFont("helvetica", "normal");
                doc.setFontSize(ROW_FONT);
                var lines = doc.splitTextToSize(row.label, CONTENT_W - (TEXT_X - M) - 6);
                var textH = lines.length * ROW_LINE_H + (row.note ? 7 : 0);
                var h = Math.max(ROW_MIN_H, textH + 4);

                if (y + h > BOTTOM) {
                    doc.addPage();
                    y = M;
                    drawBar(sec.title + " (continued)");
                }

                if (row.risk) {
                    color("setFillColor", RISK_TINT);
                    doc.rect(M, y, CONTENT_W, h, "F");
                } else if (idx % 2 === 1) {
                    color("setFillColor", TINT);
                    doc.rect(M, y, CONTENT_W, h, "F");
                }

                var by = y + (h - BOX) / 2;
                drawBox(M + (BOX_STEP - BOX) / 2, by, row.safe, false);
                drawBox(M + BOX_STEP + (BOX_STEP - BOX) / 2, by, row.risk, true);
                drawBox(M + BOX_STEP * 2 + (BOX_STEP - BOX) / 2, by, row.na, false);

                var ty = y + (h - textH) / 2 + 7;
                doc.setFont("helvetica", row.risk ? "bold" : "normal");
                doc.setFontSize(ROW_FONT);
                color("setTextColor", INK);
                doc.text(lines, TEXT_X, ty, { lineHeightFactor: 1.1 });
                if (row.note) {
                    doc.setFont("helvetica", "italic");
                    doc.setFontSize(6);
                    color("setTextColor", GRAY);
                    doc.text(row.note, TEXT_X, ty + lines.length * ROW_LINE_H - 1);
                }

                color("setDrawColor", RULE);
                doc.setLineWidth(0.3);
                doc.line(M, y + h, M + CONTENT_W, y + h);
                y += h;
            });
            y += 2;
        });

        /* ---- Comments ---- */
        var comments = val("comments") || "N/A";
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        var cLines = doc.splitTextToSize(comments, CONTENT_W - 18);
        var lineH = 10.5;
        var cIdx = 0;
        ensure(BAR_H + 32);
        color("setFillColor", NAVY);
        doc.rect(M, y, CONTENT_W, BAR_H, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        color("setTextColor", [255, 255, 255]);
        doc.text("Comments / Corrective Actions", M + 7, y + 9.5);
        doc.setFont("helvetica", "italic");
        doc.setFontSize(6);
        doc.text("Must be listed for each “At Risk” behavior", M + CONTENT_W - 7, y + 9.5, { align: "right" });
        y += BAR_H;

        // The comment box may span pages, so it is drawn a page-chunk at a time
        while (cIdx < cLines.length) {
            var fit = Math.max(1, Math.floor((BOTTOM - y - 12) / lineH));
            var chunk = cLines.slice(cIdx, cIdx + fit);
            var boxH = Math.max(30, chunk.length * lineH + 12);
            color("setDrawColor", RULE);
            doc.setLineWidth(0.6);
            doc.rect(M, y, CONTENT_W, boxH, "S");
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8.5);
            color("setTextColor", INK);
            doc.text(chunk, M + 9, y + 12, { lineHeightFactor: 1.15 });
            y += boxH;
            cIdx += chunk.length;
            if (cIdx < cLines.length) {
                doc.addPage();
                y = M;
            }
        }
        y += 10;

        /* ---- Signatures ---- */
        var SIG_H = 78;
        ensure(SIG_H + 14);
        var sigW = (CONTENT_W - 18) / 2;
        var DETAIL_LABELS = ["Printed Name", "Date", "Time"];
        var signers = readSigners();
        signers.forEach(function (s, i) {
            var sx = M + i * (sigW + 18);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(6.5);
            color("setTextColor", NAVY);
            doc.text(s.title.toUpperCase(), sx, y + 6);

            var boxY = y + 9;
            var boxH = 34;
            color("setDrawColor", RULE);
            doc.setLineWidth(0.6);
            doc.rect(sx, boxY, sigW, boxH, "S");

            var data = (document.querySelector('input[name="' + s.sigName + '"]') || {}).value;
            if (data) {
                var p = doc.getImageProperties(data);
                var scale = Math.min((sigW - 10) / p.width, (boxH - 6) / p.height);
                var iw = p.width * scale;
                var ih = p.height * scale;
                doc.addImage(data, "PNG", sx + (sigW - iw) / 2, boxY + (boxH - ih) / 2, iw, ih);
            }
            color("setDrawColor", NAVY);
            doc.setLineWidth(0.6);
            doc.line(sx + 4, boxY + boxH - 7, sx + sigW - 4, boxY + boxH - 7);

            var dy = boxY + boxH + 4;
            s.values.forEach(function (v, di) {
                doc.setFont("helvetica", "normal");
                doc.setFontSize(6);
                color("setTextColor", GRAY);
                doc.text((DETAIL_LABELS[di] || "").toUpperCase(), sx, dy + 6 + di * 9.5);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(8);
                color("setTextColor", INK);
                doc.text(v || "", sx + 52, dy + 6 + di * 9.5);
            });
        });

        // The signature details end well below y; the rest of SIG_H is spare room
        y += SIG_H - 8;

        /* ---- OM/GM review: blank lines, signed by hand on the printed copy ----
           Sits at the bottom of the page, but slides down (into the footer margin) if the
           signatures ran long, so it only moves to a new page when it truly can't fit.
           A form opts out with data-no-om-signature when it already carries all the sign-off
           it needs (Safety Lane Check has its own digital Driver + Inspector signatures). */
        if (!formEl || !formEl.hasAttribute("data-no-om-signature")) {
            var OM_LINE_MIN = y + 14;
            var OM_LINE_MAX = PAGE_H - 40;
            var lineY = BOTTOM - 10;
            if (OM_LINE_MIN > OM_LINE_MAX) {
                doc.addPage();
            } else if (OM_LINE_MIN > lineY) {
                lineY = OM_LINE_MIN;
            }
            var dateW = 90;
            var omSigW = CONTENT_W - dateW - 18;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(6.5);
            color("setTextColor", NAVY);
            doc.text("OM / GM SIGNATURE", M, lineY + 8);
            doc.text("DATE", M + omSigW + 18, lineY + 8);
            color("setDrawColor", NAVY);
            doc.setLineWidth(0.6);
            doc.line(M, lineY, M + omSigW, lineY);
            doc.line(M + omSigW + 18, lineY, M + CONTENT_W, lineY);
        }

        /* ---- Footer on every page ---- */
        var pages = doc.getNumberOfPages();
        var footerText = [TITLE, val("emp-name"), fmtDate(val("obs-date"))].filter(Boolean).join("  ·  ");
        for (var pg = 1; pg <= pages; pg++) {
            doc.setPage(pg);
            color("setDrawColor", RULE);
            doc.setLineWidth(0.5);
            doc.line(M, PAGE_H - 28, PAGE_W - M, PAGE_H - 28);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(6.5);
            color("setTextColor", GRAY);
            doc.text(footerText, M, PAGE_H - 17);
            doc.text("Page " + pg + " of " + pages, PAGE_W - M, PAGE_H - 17, { align: "right" });
        }

        return doc;
    }

    var sendButton = document.getElementById("send-email");
    var EMAIL_KEY = "fleetMgrLastEmail";
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    function lastEmail() {
        try { return localStorage.getItem(EMAIL_KEY) || ""; } catch (e) { return ""; }
    }

    function rememberEmail(address) {
        try { localStorage.setItem(EMAIL_KEY, address); } catch (e) { /* storage unavailable */ }
    }

    /* Builds the PDF, then hands the finished doc to done(). Shared by both buttons. */
    function run(btn, busyText, done) {
        if (!window.jspdf) {
            alert("The PDF library did not load. Reload the page and try again.");
            return;
        }
        var roleGroup = document.querySelector('input[name="role"]');
        if (roleGroup && !document.querySelector('input[name="role"]:checked')) {
            alert("Select Driver or Helper before continuing.");
            roleGroup.focus();
            return;
        }
        var label = btn.textContent;
        button.disabled = true;
        if (sendButton) sendButton.disabled = true;
        btn.textContent = busyText;

        loadImage("assets/icons/ew-logo-192.png")
            .then(function (logo) {
                done(build(window.jspdf.jsPDF, logo));
            })
            .catch(function (err) {
                console.error(err);
                alert("Sorry, the PDF could not be created.");
            })
            .then(function () {
                button.disabled = false;
                if (sendButton) sendButton.disabled = false;
                btn.textContent = label;
            });
    }

    button.addEventListener("click", function () {
        run(button, "Generating…", function (doc) {
            doc.save(fileName());
            // Keep the app's own copy for Saved PDFs in the menu
            if (window.PdfStore) window.PdfStore.add(fileName(), doc.output("blob")).catch(function () {});
            // Tells the shell (tabs.js) the report exists, so it can drop this tab's autosaved draft
            document.dispatchEvent(new CustomEvent("pdf-saved"));
        });
    });

    /* Send: builds the PDF from the form, then collects the recipient and builds the email.
       The PDF is made when Send is tapped, before the dialog opens, so nobody has to dig it
       out of Android's file browser (which an installed app can't always get back out of).
       It's ready by the time Create Email is tapped, so sharing happens inside that tap, as the
       browser requires. Where the device supports sharing files (most phones and tablets) the
       PDF goes through the share sheet into the mail app as a real attachment. Elsewhere the
       PDF is downloaded and a mailto: draft opens for the user to attach it. */
    var dialog = document.getElementById("send-dialog");
    var sendForm = document.getElementById("send-form");
    var toInput = document.getElementById("send-email-to");
    var attachmentEl = document.getElementById("send-attachment");
    var errorBox = document.getElementById("send-error");
    var preparedPdf = null;

    function showError(msg) {
        errorBox.textContent = msg;
        errorBox.hidden = !msg;
    }

    function closeDialog() {
        if (dialog.open) dialog.close();
    }

    // The sent report goes into Saved PDFs too
    function keepCopy(file) {
        if (window.PdfStore) window.PdfStore.add(file.name, file).catch(function () {});
    }

    if (sendButton && dialog && sendForm) {
        sendButton.addEventListener("click", function () {
            if (!val("emp-name")) {
                alert("Enter the employee's name before sending. It is used in the email title.");
                document.getElementById("emp-name").focus();
                return;
            }
            run(sendButton, "Preparing\u2026", function (doc) {
                preparedPdf = new File([doc.output("blob")], fileName(), { type: "application/pdf" });
                attachmentEl.textContent = "\uD83D\uDCCE " + preparedPdf.name;
                showError("");
                toInput.value = lastEmail();
                dialog.showModal();
                (toInput.value ? sendForm.querySelector(".send-submit") : toInput).focus();
            });
        });

        document.getElementById("send-cancel").addEventListener("click", closeDialog);
        // Tapping the dimmed backdrop also closes it
        dialog.addEventListener("click", function (e) {
            if (e.target === dialog) closeDialog();
        });

        sendForm.addEventListener("submit", function (e) {
            e.preventDefault();
            var address = toInput.value.trim();
            var file = preparedPdf;

            if (!EMAIL_RE.test(address)) {
                showError("Enter a valid email address.");
                toInput.focus();
                return;
            }
            if (!file) {
                showError("The PDF wasn't created. Close this and tap Send again.");
                return;
            }

            rememberEmail(address);
            var subject = TITLE + " - " + val("emp-name");
            var body = "Please find the " + TITLE + " report for " + val("emp-name") + " attached.";

            // No file sharing on this device: download the PDF, then open a draft to attach it to
            function fallback() {
                var url = URL.createObjectURL(file);
                var link = document.createElement("a");
                link.href = url;
                link.download = file.name;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
                keepCopy(file);

                window.top.location.href = "mailto:" + encodeURIComponent(address) +
                    "?subject=" + encodeURIComponent(subject) +
                    "&body=" + encodeURIComponent(body + "\n\n(Attach the downloaded file: " + file.name + ")");
                closeDialog();
            }

            var shareData = { files: [file], title: subject, text: "To: " + address + "\n\n" + body };
            if (navigator.canShare && navigator.canShare(shareData)) {
                navigator.share(shareData)
                    .then(function () {
                        keepCopy(file);
                        closeDialog();
                    })
                    .catch(function (err) {
                        // Backing out of the share sheet is not an error worth reporting
                        if (err && err.name === "AbortError") return;
                        fallback();
                    });
            } else {
                fallback();
            }
        });
    }
})();
