/* In-app PDF viewer for saved PDFs (opened from the folder icon in the menu).
   Opening the file as its own browser page stranded people in the installed app: there is no
   address bar or back button there, and Android Chrome can't show a PDF inside the app at all.
   So the PDF is drawn here, page by page, with PDF.js (pdf.min.js + pdf.worker.min.js, loaded
   the first time a PDF is opened), in a full-screen dialog with a Close button. On Android the
   system Back button also closes it, through a history entry added while it's open.

     PdfViewer.open(file);   // a File or Blob from the file picker */
(function () {
    "use strict";

    var ZOOMS = [1, 1.5, 2, 3];
    // iOS Safari draws nothing on a canvas over ~16.7 million pixels, so big zooms are capped
    var MAX_CANVAS_PIXELS = 16000000;

    var dialog = null;
    var pagesEl, titleEl, statusEl, zoomOutBtn, zoomInBtn;
    var pdfDoc = null;
    var zoomIndex = 0;
    var renderToken = 0;
    var libPromise = null;
    var pushedHistory = false;

    function loadLibrary() {
        if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
        if (!libPromise) {
            libPromise = new Promise(function (resolve, reject) {
                var script = document.createElement("script");
                script.src = "pdf.min.js";
                script.onload = function () {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
                    resolve(window.pdfjsLib);
                };
                script.onerror = function () {
                    libPromise = null;
                    reject(new Error("PDF viewer failed to load"));
                };
                document.head.appendChild(script);
            });
        }
        return libPromise;
    }

    function build() {
        dialog = document.createElement("dialog");
        dialog.className = "pdf-viewer";
        dialog.setAttribute("aria-labelledby", "pdf-viewer-title");
        dialog.innerHTML =
            '<div class="pdf-viewer-bar">' +
                '<h2 class="pdf-viewer-title" id="pdf-viewer-title"></h2>' +
                '<div class="pdf-viewer-zoom">' +
                    '<button type="button" class="pdf-viewer-btn" data-zoom="-1" aria-label="Zoom out">−</button>' +
                    '<button type="button" class="pdf-viewer-btn" data-zoom="1" aria-label="Zoom in">+</button>' +
                "</div>" +
                '<button type="button" class="pdf-viewer-close">Close</button>' +
            "</div>" +
            '<div class="pdf-viewer-pages">' +
                '<p class="pdf-viewer-status" role="status" aria-live="polite"></p>' +
            "</div>";
        document.body.appendChild(dialog);

        pagesEl = dialog.querySelector(".pdf-viewer-pages");
        titleEl = dialog.querySelector(".pdf-viewer-title");
        statusEl = dialog.querySelector(".pdf-viewer-status");
        zoomOutBtn = dialog.querySelector('[data-zoom="-1"]');
        zoomInBtn = dialog.querySelector('[data-zoom="1"]');

        dialog.querySelector(".pdf-viewer-close").addEventListener("click", close);
        zoomOutBtn.addEventListener("click", function () { setZoom(zoomIndex - 1); });
        zoomInBtn.addEventListener("click", function () { setZoom(zoomIndex + 1); });

        // Escape (or the browser closing it) ends up here too
        dialog.addEventListener("close", function () {
            renderToken++;
            if (pdfDoc) {
                pdfDoc.destroy();
                pdfDoc = null;
            }
            clearPages();
            if (pushedHistory) {
                pushedHistory = false;
                history.back();
            }
        });

        // Android Back while the viewer is open: close it instead of leaving the app
        window.addEventListener("popstate", function () {
            if (pushedHistory && dialog.open) {
                pushedHistory = false;
                dialog.close();
            }
        });

        var resizeTimer = null;
        window.addEventListener("resize", function () {
            if (!dialog.open || !pdfDoc) return;
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(renderAll, 200);
        });
    }

    function close() {
        if (dialog && dialog.open) dialog.close();
    }

    function clearPages() {
        Array.prototype.slice.call(pagesEl.querySelectorAll("canvas")).forEach(function (c) {
            c.width = 0;
            c.height = 0;
            c.remove();
        });
    }

    function say(text) {
        statusEl.textContent = text;
        statusEl.hidden = !text;
    }

    function setZoom(index) {
        zoomIndex = Math.max(0, Math.min(ZOOMS.length - 1, index));
        zoomOutBtn.disabled = zoomIndex === 0;
        zoomInBtn.disabled = zoomIndex === ZOOMS.length - 1;
        if (pdfDoc) renderAll();
    }

    // Draws every page to fit the viewer's width at the current zoom, sharp on high-DPI screens.
    // A newer render (zoom, resize, close) bumps the token and the older one stops.
    function renderAll() {
        var token = ++renderToken;
        var doc = pdfDoc;
        var ratio = window.devicePixelRatio || 1;
        var available = Math.max(200, pagesEl.clientWidth - 24) * ZOOMS[zoomIndex];
        clearPages();

        function renderPage(number) {
            if (token !== renderToken || number > doc.numPages) return Promise.resolve();
            return doc.getPage(number).then(function (page) {
                if (token !== renderToken) return;
                var base = page.getViewport({ scale: 1 });
                var scale = available / base.width * ratio;
                var pixels = base.width * base.height * scale * scale;
                if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
                var viewport = page.getViewport({ scale: scale });

                var canvas = document.createElement("canvas");
                canvas.className = "pdf-viewer-page";
                canvas.width = Math.floor(viewport.width);
                canvas.height = Math.floor(viewport.height);
                canvas.style.width = Math.floor(available) + "px";
                canvas.setAttribute("aria-label", "Page " + number + " of " + doc.numPages);
                pagesEl.appendChild(canvas);

                return page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise;
            }).then(function () {
                return renderPage(number + 1);
            });
        }

        return renderPage(1).catch(function () {
            if (token === renderToken) say("Some pages of this PDF could not be shown.");
        });
    }

    window.PdfViewer = {
        open: function (file) {
            if (!dialog) build();
            titleEl.textContent = file.name || "PDF";
            clearPages();
            say("Opening…");
            setZoom(0);

            if (!dialog.open) {
                dialog.showModal();
                history.pushState({ pdfViewer: true }, "");
                pushedHistory = true;
            }
            dialog.querySelector(".pdf-viewer-close").focus();

            var token = ++renderToken;
            Promise.all([loadLibrary(), file.arrayBuffer()])
                .then(function (parts) {
                    return parts[0].getDocument({ data: new Uint8Array(parts[1]) }).promise;
                })
                .then(function (doc) {
                    if (token !== renderToken || !dialog.open) {
                        doc.destroy();
                        return;
                    }
                    pdfDoc = doc;
                    say("");
                    return renderAll();
                })
                .catch(function () {
                    if (token === renderToken) {
                        say("This file couldn't be opened. Make sure it's a PDF saved by Route IQ or another app.");
                    }
                });
        }
    };
})();
