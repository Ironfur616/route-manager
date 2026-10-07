// The app header and off-canvas menu live only in the shell (index.html); the forms open
// inside its tabs. Built here so the menu is defined in one place. This must run before the
// scripts below, which look the elements up, and before tabs.js, which reads the menu links.
(function () {
    "use strict";

    function link(href, label) {
        return '<li><a href="' + href + '">' + label + "</a></li>";
    }

    function subsection(id, title, links) {
        return '<div class="nav-subsection">' +
            '<h3><button type="button" class="nav-subsection-title" aria-expanded="false" aria-controls="' + id + '">' +
            title + '<span class="nav-caret" aria-hidden="true"></span></button></h3>' +
            '<div class="nav-subsection-body" id="' + id + '"><div class="nav-subsection-body-inner">' +
            '<ul class="nav-link-list">' + links.join("") + "</ul></div></div></div>";
    }

    // Top-level sections are always open; only subsections (Residential, Commercial) collapse
    function section(title, content) {
        return '<div class="nav-section">' +
            '<h2 class="nav-section-plain">' + title + "</h2>" +
            content + "</div>";
    }

    var html =
        '<header class="app-header">' +
            '<button type="button" class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-controls="site-nav" aria-label="Open menu">' +
                '<span class="nav-toggle-bars" aria-hidden="true"></span>' +
            "</button>" +
            '<h1 class="hero-title">Route IQ</h1>' +
        "</header>" +
        '<nav class="site-nav" id="site-nav" aria-label="Route IQ navigation" aria-hidden="true">' +
            '<div class="site-nav-header">' +
                '<span class="site-nav-heading">Menu</span>' +
                '<button type="button" class="nav-close" id="nav-close" aria-label="Close menu">&times;</button>' +
            "</div>" +
            section("Observations",
                subsection("panel-residential", "Residential", [
                    link("resi-driver.html", "Residential Driver"),
                    link("resi-helper.html", "Residential Helper"),
                    link("resi-trainee.html", "Residential Trainee")
                ]) +
                subsection("panel-commercial", "Commercial", [
                    link("com-driver.html", "Commercial Driver"),
                    link("com-trainee.html", "Commercial Trainee")
                ])) +
            section("Safety",
                '<ul class="nav-link-list">' + link("safety-lane-ck.html", "Safety Lane") + "</ul>") +
            section("Route Management",
                '<ul class="nav-link-list">' +
                    link("missed-tracker.html", "Missed Collections") +
                    link("new-customers.html", "New Customers") +
                    link("bulk-pickup.html", "Bulk Pickup Requests") +
                    link("rca.html", "Root Cause Assessment (RCA)") +
                "</ul>") +
            section("Service",
                '<ul class="nav-link-list">' + link("service-assist.html", "Handicap &amp; Elderly") + "</ul>") +
        "</nav>" +
        '<div class="nav-scrim" id="nav-scrim"></div>';

    document.body.insertAdjacentHTML("afterbegin", html);
})();

// Opens/closes the off-canvas hamburger nav drawer.
(function () {
    "use strict";

    var toggle = document.getElementById("nav-toggle");
    var nav = document.getElementById("site-nav");
    var closeBtn = document.getElementById("nav-close");
    var scrim = document.getElementById("nav-scrim");

    if (!toggle || !nav) {
        return;
    }

    function onKeydown(event) {
        if (event.key === "Escape") {
            closeNav();
        }
    }

    function openNav() {
        nav.classList.add("is-open");
        nav.removeAttribute("aria-hidden");
        if (scrim) {
            scrim.classList.add("is-visible");
        }
        toggle.setAttribute("aria-expanded", "true");
        document.body.classList.add("nav-open");
        document.addEventListener("keydown", onKeydown);

        var firstLink = nav.querySelector("a");
        (closeBtn || firstLink || nav).focus();
    }

    function closeNav() {
        nav.classList.remove("is-open");
        nav.setAttribute("aria-hidden", "true");
        if (scrim) {
            scrim.classList.remove("is-visible");
        }
        toggle.setAttribute("aria-expanded", "false");
        document.body.classList.remove("nav-open");
        document.removeEventListener("keydown", onKeydown);
        toggle.focus();
    }

    toggle.addEventListener("click", function () {
        if (nav.classList.contains("is-open")) {
            closeNav();
        } else {
            openNav();
        }
    });

    if (closeBtn) {
        closeBtn.addEventListener("click", closeNav);
    }

    if (scrim) {
        scrim.addEventListener("click", closeNav);
    }
})();

// Saved PDFs: an icon button pinned to the bottom right of the menu. A web page can't open a
// folder in the file manager, so this opens the device's file picker (starting in Downloads
// where the browser supports it) and shows the chosen PDF in the in-app viewer (pdf-viewer.js).
(function () {
    "use strict";

    var nav = document.getElementById("site-nav");
    if (!nav) {
        return;
    }

    var footer = document.createElement("div");
    footer.className = "site-nav-footer";
    footer.innerHTML =
        '<button type="button" class="nav-icon-btn" id="open-saved-pdfs" ' +
            'aria-label="Open saved PDFs" title="Open saved PDFs">' +
            '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">' +
                '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" ' +
                    'fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
                '<path d="M8 13h8M8 16h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
            "</svg>" +
        "</button>";
    nav.appendChild(footer);

    var input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.hidden = true;
    document.body.appendChild(input);

    function show(file) {
        // Close the menu so the viewer isn't sitting on top of an open drawer
        var closeBtn = document.getElementById("nav-close");
        if (closeBtn && nav.classList.contains("is-open")) closeBtn.click();
        window.PdfViewer.open(file);
    }

    input.addEventListener("change", function () {
        if (input.files && input.files[0]) {
            show(input.files[0]);
        }
        input.value = "";
    });

    document.getElementById("open-saved-pdfs").addEventListener("click", function () {
        if (window.showOpenFilePicker) {
            window.showOpenFilePicker({
                startIn: "downloads",
                types: [{ description: "PDF files", accept: { "application/pdf": [".pdf"] } }]
            })
                .then(function (handles) { return handles[0].getFile(); })
                .then(show)
                .catch(function (err) {
                    // Backing out of the picker is not an error
                    if (err && err.name !== "AbortError") {
                        input.click();
                    }
                });
        } else {
            input.click();
        }
    });
})();

// Collapsible Residential/Commercial subsections under Observations.
// Each heading is a button (aria-expanded/aria-controls) toggling the
// .is-open class on its panel; styles.css animates the height.
(function () {
    "use strict";

    var toggles = document.querySelectorAll(".nav-subsection-title");

    toggles.forEach(function (btn) {
        btn.addEventListener("click", function () {
            var panel = document.getElementById(btn.getAttribute("aria-controls"));
            var isOpen = btn.getAttribute("aria-expanded") === "true";

            btn.setAttribute("aria-expanded", String(!isOpen));
            if (panel) {
                panel.classList.toggle("is-open", !isOpen);
            }
        });
    });
})();
