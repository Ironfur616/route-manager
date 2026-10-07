/* Saved PDFs list, opened from the folder icon at the bottom right of the menu.
   Lists the copies the app keeps of every PDF it creates (pdf-store.js), newest first. A PDF
   opens in the in-app viewer (pdf-viewer.js); where the device can share files, Share hands it
   to the Android share sheet (email, Drive, etc.); Delete removes the app's copy only.
   Nothing here opens the device's file browser, which an installed app can't always get back
   out of. Loaded only by the shell (index.html). */
(function () {
    "use strict";

    var openBtn = document.getElementById("open-saved-pdfs");
    if (!openBtn || !window.PdfStore) return;

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function prettyStamp(ms) {
        return new Date(ms).toLocaleString(undefined, {
            month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
        });
    }

    function prettySize(bytes) {
        return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
    }

    var dialog = el("dialog", "send-dialog mt-dialog sp-dialog");
    dialog.setAttribute("aria-labelledby", "sp-title");
    dialog.innerHTML =
        '<div class="mt-dialog-head">' +
            '<h2 id="sp-title">Saved PDFs</h2>' +
            '<button type="button" class="mt-dialog-close" aria-label="Close" data-dialog-close>&times;</button>' +
        "</div>" +
        '<div class="sp-body">' +
            '<p class="mt-count sp-status" role="status" aria-live="polite"></p>' +
            '<div class="sp-list"></div>' +
        "</div>";
    document.body.appendChild(dialog);

    var listEl = dialog.querySelector(".sp-list");
    var statusEl = dialog.querySelector(".sp-status");
    var savedDialog = TrackerDialog(dialog, {});

    function fileFor(record) {
        return new File([record.blob], record.name, { type: "application/pdf" });
    }

    function view(id) {
        PdfStore.get(id).then(function (record) {
            if (!record) return render();
            savedDialog.close();
            PdfViewer.open(fileFor(record));
        });
    }

    function share(id) {
        PdfStore.get(id).then(function (record) {
            if (!record) return;
            var data = { files: [fileFor(record)], title: record.name };
            navigator.share(data).catch(function () { /* backing out of the share sheet is fine */ });
        });
    }

    function remove(row) {
        TrackerDialog.confirmDelete({
            title: "Delete saved PDF?",
            message: row.name + " will be removed from Saved PDFs. A copy downloaded to the tablet is not affected.",
            confirmLabel: "Delete PDF"
        }, function () {
            PdfStore.remove(row.id).then(render);
        });
    }

    function canShareFiles() {
        try {
            return !!(navigator.canShare && navigator.canShare({
                files: [new File(["x"], "x.pdf", { type: "application/pdf" })]
            }));
        } catch (e) {
            return false;
        }
    }

    function render() {
        return PdfStore.list().then(function (rows) {
            var sharing = canShareFiles();
            listEl.textContent = "";
            statusEl.textContent = rows.length
                ? rows.length + " saved PDF" + (rows.length === 1 ? "" : "s") + ", newest first."
                : "No saved PDFs yet. Every PDF you create from now on is listed here.";

            rows.forEach(function (row) {
                var item = el("article", "sp-item");

                var openRow = el("button", "sp-open");
                openRow.type = "button";
                openRow.appendChild(el("span", "sp-name", row.name));
                openRow.appendChild(el("span", "sp-meta", prettyStamp(row.created) + " · " + prettySize(row.size)));
                openRow.addEventListener("click", function () { view(row.id); });
                item.appendChild(openRow);

                var actions = el("div", "sp-actions");
                if (sharing) {
                    var shareBtn = el("button", "mt-btn", "Share");
                    shareBtn.type = "button";
                    shareBtn.setAttribute("aria-label", "Share " + row.name);
                    shareBtn.addEventListener("click", function () { share(row.id); });
                    actions.appendChild(shareBtn);
                }
                var del = el("button", "mt-btn mt-btn-danger", "Delete");
                del.type = "button";
                del.setAttribute("aria-label", "Delete " + row.name);
                del.addEventListener("click", function () { remove(row); });
                actions.appendChild(del);
                item.appendChild(actions);

                listEl.appendChild(item);
            });
        }).catch(function () {
            listEl.textContent = "";
            statusEl.textContent = "Saved PDFs aren't available in this browser.";
        });
    }

    openBtn.addEventListener("click", function () {
        // Close the menu first so the list isn't sitting on top of an open drawer
        var nav = document.getElementById("site-nav");
        var closeBtn = document.getElementById("nav-close");
        if (closeBtn && nav && nav.classList.contains("is-open")) closeBtn.click();
        statusEl.textContent = "Loading…";
        listEl.textContent = "";
        savedDialog.open();
        render();
    });
})();
