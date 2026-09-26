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
    var M = 40;
    var CONTENT_W = PAGE_W - M * 2;
    var BOTTOM = PAGE_H - 54;
    // Each form names its own report: <form class="emp-info" data-title="Residential Driver Observation">.
    // Without it, the page title up to the " · " is used.
    var formEl = document.querySelector("form.emp-info");
    var TITLE = (formEl && formEl.getAttribute("data-title")) || document.title.split(" · ")[0].trim() || "Observation";

    var BOX = 11;
    var BOX_STEP = 26;
    var TEXT_X = M + 3 * BOX_STEP + 10;

    function val(id) {
        var el = document.getElementById(id);
        return el ? el.value.trim() : "";
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
        if (logo) doc.addImage(logo, "PNG", M - 6, y - 6, 66, 66);
        var titleX = logo ? M + 68 : M;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(20);
        color("setTextColor", NAVY);
        doc.text(TITLE, titleX, y + 24);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        color("setTextColor", GRAY);
        doc.text("Earthwise Environmental Solutions  ·  Route Manager System", titleX, y + 41);
        y += 62;
        color("setFillColor", GREEN);
        doc.rect(M, y, CONTENT_W, 3, "F");
        y += 16;

        /* ---- Employee information ---- */
        var colW = (CONTENT_W - 24 - 24) / 2;
        var fields = [
            [["Name", val("emp-name")]],
            [["Date of Observation", fmtDate(val("obs-date"))], ["Time of Observation", fmtTime(val("obs-time"))]],
            [["Location of Observation", val("obs-location")], ["Unit Type & Number", val("unit")]]
        ];
        // Trainee form only: Driver / Helper and the training period
        var roleEl = document.querySelector('input[name="role"]:checked');
        var periodEl = document.getElementById("training-period");
        var extra = [];
        if (document.querySelector('input[name="role"]')) extra.push(["Position", roleEl ? roleEl.parentNode.textContent.trim() : ""]);
        if (periodEl) extra.push(["Training Period", periodEl.value]);
        if (extra.length) fields.splice(1, 0, extra);
        var infoH = 22 + fields.length * 36;
        color("setFillColor", TINT);
        doc.roundedRect(M, y, CONTENT_W, infoH, 4, 4, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        color("setTextColor", NAVY);
        doc.text("EMPLOYEE INFORMATION", M + 12, y + 15);
        var fy = y + 22;
        fields.forEach(function (row) {
            row.forEach(function (f, i) {
                var fx = M + 12 + i * (colW + 24);
                var w = row.length === 1 ? CONTENT_W - 24 : colW;
                doc.setFont("helvetica", "normal");
                doc.setFontSize(7);
                color("setTextColor", GRAY);
                doc.text(f[0].toUpperCase(), fx, fy + 9);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(10.5);
                color("setTextColor", INK);
                doc.text(doc.splitTextToSize(f[1] || " ", w)[0], fx, fy + 22);
                color("setDrawColor", RULE);
                doc.setLineWidth(0.6);
                doc.line(fx, fy + 27, fx + w, fy + 27);
            });
            fy += 36;
        });
        y += infoH + 14;

        /* ---- Key with totals ---- */
        var totals = { safe: 0, risk: 0, na: 0 };
        sections.forEach(function (s) {
            s.rows.forEach(function (r) {
                if (r.safe) totals.safe++;
                if (r.risk) totals.risk++;
                if (r.na) totals.na++;
            });
        });
        var keys = [
            ["+", "Safe", totals.safe],
            ["–", "At Risk", totals.risk],
            ["N/O", "Not Observed", totals.na]
        ];
        var kx = M;
        keys.forEach(function (k) {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(9);
            var badgeW = k[0] === "N/O" ? 26 : 16;
            color("setDrawColor", NAVY);
            doc.setLineWidth(1);
            doc.roundedRect(kx, y, badgeW, 15, 3, 3, "S");
            color("setTextColor", NAVY);
            doc.text(k[0], kx + badgeW / 2, y + 10.5, { align: "center" });
            doc.setFont("helvetica", "normal");
            color("setTextColor", INK);
            var label = k[1] + "  ";
            doc.text(label, kx + badgeW + 6, y + 10.5);
            var lw = doc.getTextWidth(label);
            doc.setFont("helvetica", "bold");
            doc.text(String(k[2]), kx + badgeW + 6 + lw, y + 10.5);
            kx += badgeW + 6 + lw + doc.getTextWidth(String(k[2])) + 22;
        });
        y += 30;

        /* ---- Practice sections ---- */
        var BAR_H = 20;

        function drawBar(title) {
            color("setFillColor", NAVY);
            doc.rect(M, y, CONTENT_W, BAR_H, "F");
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8.5);
            color("setTextColor", [255, 255, 255]);
            ["+", "–", "N/O"].forEach(function (h, i) {
                doc.text(h, M + i * BOX_STEP + BOX_STEP / 2, y + 13.5, { align: "center" });
            });
            doc.setFontSize(9.5);
            doc.text(title, TEXT_X, y + 13.5);
            y += BAR_H;
        }

        function drawBox(x, by, on, risk) {
            color("setDrawColor", on && risk ? RISK : NAVY);
            doc.setLineWidth(0.9);
            doc.rect(x, by, BOX, BOX, "S");
            if (on) {
                color("setDrawColor", risk ? RISK : GREEN);
                doc.setLineWidth(1.6);
                doc.line(x + 2, by + 2, x + BOX - 2, by + BOX - 2);
                doc.line(x + BOX - 2, by + 2, x + 2, by + BOX - 2);
            }
        }

        sections.forEach(function (sec) {
            // Keep the bar with at least its first two rows
            ensure(BAR_H + 48);
            drawBar(sec.title);

            if (sec.locked) {
                var naH = 24;
                doc.setFont("helvetica", "bold");
                doc.setFontSize(9.5);
                color("setTextColor", GRAY);
                doc.text("N/A", TEXT_X, y + 15.5);
                color("setDrawColor", RULE);
                doc.setLineWidth(0.4);
                doc.line(M, y + naH, M + CONTENT_W, y + naH);
                y += naH + 14;
                return;
            }

            sec.rows.forEach(function (row, idx) {
                doc.setFont("helvetica", "normal");
                doc.setFontSize(9.5);
                var lines = doc.splitTextToSize(row.label, CONTENT_W - (TEXT_X - M) - 8);
                var textH = lines.length * 12 + (row.note ? 10 : 0);
                var h = Math.max(24, textH + 10);

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

                var ty = y + (h - textH) / 2 + 9;
                doc.setFont("helvetica", row.risk ? "bold" : "normal");
                doc.setFontSize(9.5);
                color("setTextColor", INK);
                doc.text(lines, TEXT_X, ty, { lineHeightFactor: 1.25 });
                if (row.note) {
                    doc.setFont("helvetica", "italic");
                    doc.setFontSize(7.5);
                    color("setTextColor", GRAY);
                    doc.text(row.note, TEXT_X, ty + lines.length * 12 - 1);
                }

                color("setDrawColor", RULE);
                doc.setLineWidth(0.4);
                doc.line(M, y + h, M + CONTENT_W, y + h);
                y += h;
            });
            y += 14;
        });

        /* ---- Comments ---- */
        var comments = val("comments") || "N/A";
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        var cLines = doc.splitTextToSize(comments, CONTENT_W - 24);
        var lineH = 13;
        var cIdx = 0;
        ensure(BAR_H + 48);
        color("setFillColor", NAVY);
        doc.rect(M, y, CONTENT_W, BAR_H, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        color("setTextColor", [255, 255, 255]);
        doc.text("Comments / Corrective Actions", M + 10, y + 13.5);
        doc.setFont("helvetica", "italic");
        doc.setFontSize(7.5);
        doc.text("Must be listed for each “At Risk” behavior", M + CONTENT_W - 10, y + 13.5, { align: "right" });
        y += BAR_H;

        // The comment box may span pages, so it is drawn a page-chunk at a time
        while (cIdx < cLines.length) {
            var fit = Math.max(1, Math.floor((BOTTOM - y - 20) / lineH));
            var chunk = cLines.slice(cIdx, cIdx + fit);
            var boxH = Math.max(48, chunk.length * lineH + 20);
            color("setDrawColor", RULE);
            doc.setLineWidth(0.8);
            doc.rect(M, y, CONTENT_W, boxH, "S");
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            color("setTextColor", INK);
            doc.text(chunk, M + 12, y + 16, { lineHeightFactor: 1.3 });
            y += boxH;
            cIdx += chunk.length;
            if (cIdx < cLines.length) {
                doc.addPage();
                y = M;
            }
        }
        y += 22;

        /* ---- Signatures ---- */
        var SIG_H = 128;
        ensure(SIG_H + 20);
        var sigW = (CONTENT_W - 24) / 2;
        var signers = [
            ["Observer", val("observer-name"), val("observer-date"), val("observer-time"), "sig-observer"],
            ["Employee", val("employee-name-sig"), val("employee-date"), val("employee-time"), "sig-employee"]
        ];
        signers.forEach(function (s, i) {
            var sx = M + i * (sigW + 24);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8);
            color("setTextColor", NAVY);
            doc.text((s[0] + " Signature").toUpperCase(), sx, y + 8);

            var boxY = y + 14;
            var boxH = 58;
            color("setDrawColor", RULE);
            doc.setLineWidth(0.8);
            doc.rect(sx, boxY, sigW, boxH, "S");

            var data = (document.querySelector('input[name="' + s[4] + '"]') || {}).value;
            if (data) {
                var p = doc.getImageProperties(data);
                var scale = Math.min((sigW - 12) / p.width, (boxH - 8) / p.height);
                var iw = p.width * scale;
                var ih = p.height * scale;
                doc.addImage(data, "PNG", sx + (sigW - iw) / 2, boxY + (boxH - ih) / 2, iw, ih);
            }
            color("setDrawColor", NAVY);
            doc.setLineWidth(0.8);
            doc.line(sx + 6, boxY + boxH - 10, sx + sigW - 6, boxY + boxH - 10);

            var detail = [
                ["Printed Name", s[1]],
                ["Date", fmtDate(s[2])],
                ["Time", fmtTime(s[3])]
            ];
            var dy = boxY + boxH + 6;
            detail.forEach(function (d, di) {
                doc.setFont("helvetica", "normal");
                doc.setFontSize(7);
                color("setTextColor", GRAY);
                doc.text(d[0].toUpperCase(), sx, dy + 8 + di * 13);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(9.5);
                color("setTextColor", INK);
                doc.text(d[1] || "", sx + 62, dy + 8 + di * 13);
            });
        });

        // The signature details end ~112pt below y; the rest of SIG_H is spare room
        y += SIG_H - 16;

        /* ---- OM/GM review: blank lines, signed by hand on the printed copy ----
           Sits at the bottom of the page, but slides down (into the footer margin) if the
           signatures ran long, so it only moves to a new page when it truly can't fit. */
        var OM_LINE_MIN = y + 22;
        var OM_LINE_MAX = PAGE_H - 56;
        var lineY = BOTTOM - 18;
        if (OM_LINE_MIN > OM_LINE_MAX) {
            doc.addPage();
        } else if (OM_LINE_MIN > lineY) {
            lineY = OM_LINE_MIN;
        }
        var dateW = 130;
        var omSigW = CONTENT_W - dateW - 24;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        color("setTextColor", NAVY);
        doc.text("OM / GM SIGNATURE", M, lineY + 11);
        doc.text("DATE", M + omSigW + 24, lineY + 11);
        color("setDrawColor", NAVY);
        doc.setLineWidth(0.8);
        doc.line(M, lineY, M + omSigW, lineY);
        doc.line(M + omSigW + 24, lineY, M + CONTENT_W, lineY);

        /* ---- Footer on every page ---- */
        var pages = doc.getNumberOfPages();
        var footerText = [TITLE, val("emp-name"), fmtDate(val("obs-date"))].filter(Boolean).join("  ·  ");
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

        loadImage("assets/icons/icon-192.png")
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
            // Tells the shell (tabs.js) the report exists, so it can drop this tab's autosaved draft
            document.dispatchEvent(new CustomEvent("pdf-saved"));
        });
    });

    /* Send: collects the recipient and the saved PDF, then builds the email.
       Browsers don't let a web page silently attach a file, so where the device supports
       sharing files (most phones and tablets) the PDF goes through the share sheet into the
       mail app as a real attachment. Elsewhere a mailto: draft opens and the user attaches
       the PDF they picked. */
    var dialog = document.getElementById("send-dialog");
    var sendForm = document.getElementById("send-form");
    var toInput = document.getElementById("send-email-to");
    var pdfInput = document.getElementById("send-pdf");
    var errorBox = document.getElementById("send-error");

    function showError(msg) {
        errorBox.textContent = msg;
        errorBox.hidden = !msg;
    }

    function closeDialog() {
        if (dialog.open) dialog.close();
    }

    if (sendButton && dialog && sendForm) {
        sendButton.addEventListener("click", function () {
            if (!val("emp-name")) {
                alert("Enter the employee's name before sending. It is used in the email title.");
                document.getElementById("emp-name").focus();
                return;
            }
            showError("");
            pdfInput.value = "";
            toInput.value = lastEmail();
            dialog.showModal();
            (toInput.value ? pdfInput : toInput).focus();
        });

        document.getElementById("send-cancel").addEventListener("click", closeDialog);
        // Tapping the dimmed backdrop also closes it
        dialog.addEventListener("click", function (e) {
            if (e.target === dialog) closeDialog();
        });

        sendForm.addEventListener("submit", function (e) {
            e.preventDefault();
            var address = toInput.value.trim();
            var file = pdfInput.files && pdfInput.files[0];

            if (!EMAIL_RE.test(address)) {
                showError("Enter a valid email address.");
                toInput.focus();
                return;
            }
            if (!file) {
                showError("Choose the PDF to attach.");
                return;
            }
            if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
                showError("The attachment must be a PDF file.");
                return;
            }

            rememberEmail(address);
            var subject = TITLE + " - " + val("emp-name");
            var body = "Please find the " + TITLE + " report for " + val("emp-name") + " attached.";

            function fallback() {
                window.top.location.href = "mailto:" + encodeURIComponent(address) +
                    "?subject=" + encodeURIComponent(subject) +
                    "&body=" + encodeURIComponent(body + "\n\n(Attach the file: " + file.name + ")");
                closeDialog();
            }

            var shareData = { files: [file], title: subject, text: "To: " + address + "\n\n" + body };
            if (navigator.canShare && navigator.canShare(shareData)) {
                navigator.share(shareData)
                    .then(closeDialog)
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
