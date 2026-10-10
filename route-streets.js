/* Route Sheets (route-streets.html), under Routing in the menu: routes and their streets.
   A reference list of routes and the streets on each, kept in localStorage like the trackers
   (data-no-draft on <html> opts out of the shell's draft handling). Streets are entered one per
   line so a whole list can be pasted in. The search answers "which route is this street on?":
   it matches street names (as well as route and area) and highlights the matching streets.

   Print (one route) and Print All build a route sheet PDF in the house report format and open
   it in the app's own viewer, with Print / Share there (see Printing below). Each route
   starts on its own page.

   A route's list can mix whole streets ("Main Street") and individual homes for subscription
   service ("1234 N. Main Street"); anything starting with a house number is a home. They're
   counted, listed and printed separately.

   Import from Excel (or sharing .xlsx files to Route IQ) builds routes from spreadsheets: the file
   name gives the route and driver ("MS-52-1 Bill Vaughn.xlsx"), column E the site addresses and
   column G the city, from row 2 down. A preview comes first; re-importing a route replaces its
   list, driver and area but keeps its service day and notes.

   Each route record has room for a mapUrl, for the custom route maps planned later. */
(function () {
    "use strict";

    var KEY = "fleetMgrRouteStreets";
    var DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    var form = document.getElementById("rs-form");
    var fields = {
        route: document.getElementById("rs-route"),
        day: document.getElementById("rs-day"),
        driver: document.getElementById("rs-driver"),
        area: document.getElementById("rs-area"),
        streets: document.getElementById("rs-streets"),
        notes: document.getElementById("rs-notes")
    };
    var submitBtn = document.getElementById("rs-submit");
    var formTitle = document.getElementById("rs-form-title");
    var errorEl = document.getElementById("rs-error");
    var streetsCount = document.getElementById("rs-streets-count");
    var listEl = document.getElementById("rs-list");
    var countEl = document.getElementById("rs-count");
    var searchEl = document.getElementById("rs-search");

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

    // A line starting with a house number is one home, not a whole street
    function isAddress(line) {
        return /^\s*\d/.test(String(line));
    }

    function splitStops(lines) {
        return {
            streets: (lines || []).filter(function (s) { return !isAddress(s); }),
            addresses: (lines || []).filter(isAddress)
        };
    }

    // Each line's town, saved by the import (column G), keyed like the route lookup matches
    function cityOf(r, line) {
        return (r.cities && r.cities[keyOf(line)]) || "";
    }

    function hasSeveralTowns(r) {
        var seen = {};
        Object.keys(r.cities || {}).forEach(function (k) { if (r.cities[k]) seen[r.cities[k].toLowerCase()] = true; });
        return Object.keys(seen).length > 1;
    }

    // "Main Street (Washington)" on routes that span towns; just "Main Street" otherwise.
    // Pass severalTowns in (worked out once per route) rather than checking for every line.
    function withTown(r, line, severalTowns) {
        var c = severalTowns ? cityOf(r, line) : "";
        return c ? line + " (" + c + ")" : line;
    }

    function stopCount(lines) {
        var p = splitStops(lines);
        var parts = [p.streets.length + " street" + (p.streets.length === 1 ? "" : "s")];
        if (p.addresses.length) parts.push(p.addresses.length + " address" + (p.addresses.length === 1 ? "" : "es"));
        return parts.join(" \u00B7 ");
    }

    // One street per line; blank lines and repeats (ignoring case) dropped, order kept
    function parseStreets(text) {
        var seen = {};
        return String(text).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(function (s) {
            var k = s.toLowerCase();
            if (!s || seen[k]) return false;
            seen[k] = true;
            return true;
        });
    }

    // "Route 2" before "Route 10": compare the numbers inside route names as numbers
    function byRoute(a, b) {
        return String(a.route).localeCompare(String(b.route), undefined, { numeric: true, sensitivity: "base" });
    }

    function showError(text) {
        errorEl.textContent = text;
        errorEl.hidden = !text;
    }

    /* ---------- Storage ---------- */

    function load() {
        try {
            var data = JSON.parse(localStorage.getItem(KEY) || "[]");
            return Array.isArray(data) ? data.filter(function (e) { return e && e.id; }) : [];
        } catch (e) {
            return [];
        }
    }

    function save(list) {
        try {
            localStorage.setItem(KEY, JSON.stringify(list));
            if (window.RouteLookup) RouteLookup.invalidate();
            document.getElementById("rs-storage-warning").hidden = true;
            return true;
        } catch (e) {
            document.getElementById("rs-storage-warning").hidden = false;
            return false;
        }
    }

    /* ---------- Rendering ---------- */

    function renderDatalists(list) {
        [["dl-rs-area", "area"], ["dl-rs-driver", "driver"]].forEach(function (pair) {
            var seen = {};
            var dl = document.getElementById(pair[0]);
            dl.textContent = "";
            list.forEach(function (r) {
                var v = (r[pair[1]] || "").trim();
                if (v && !seen[v.toLowerCase()]) {
                    seen[v.toLowerCase()] = true;
                    dl.appendChild(el("option")).value = v;
                }
            });
        });
    }

    // Wraps each match of `term` in <mark>, built with text nodes (never innerHTML)
    function highlighted(text, term) {
        var frag = document.createDocumentFragment();
        if (!term) {
            frag.appendChild(document.createTextNode(text));
            return frag;
        }
        var lower = text.toLowerCase();
        var at = 0;
        var hit;
        while ((hit = lower.indexOf(term, at)) !== -1) {
            frag.appendChild(document.createTextNode(text.slice(at, hit)));
            frag.appendChild(el("mark", null, text.slice(hit, hit + term.length)));
            at = hit + term.length;
        }
        frag.appendChild(document.createTextNode(text.slice(at)));
        return frag;
    }

    function buildCard(r, term) {
        var streets = r.streets || [];
        var matchingStreets = term ? streets.filter(function (s) { return s.toLowerCase().indexOf(term) !== -1; }) : [];

        var card = el("article", "mt-entry rs-entry");
        var head = el("div", "mt-entry-head");
        var title = el("h3", "mt-entry-address");
        title.appendChild(highlighted("Route " + r.route, term));
        head.appendChild(title);
        head.appendChild(el("span", "mt-entry-date", stopCount(streets)));
        card.appendChild(head);

        var chips = el("div", "mt-chips");
        if (r.day) chips.appendChild(el("span", "mt-chip", r.day));
        if (r.driver) {
            var driver = el("span", "mt-chip");
            driver.appendChild(highlighted(r.driver, term));
            chips.appendChild(driver);
        }
        if (r.area) {
            var area = el("span", "mt-chip");
            area.appendChild(highlighted(r.area, term));
            chips.appendChild(area);
        }
        if (chips.childNodes.length) card.appendChild(chips);

        if (r.notes) card.appendChild(el("p", "mt-entry-notes", r.notes));

        // While searching, the streets that matched are listed up front so they're seen right away
        if (matchingStreets.length) {
            var found = el("ul", "rs-streets rs-matches");
            found.setAttribute("aria-label", "Matching streets");
            matchingStreets.forEach(function (s) {
                var li = el("li");
                li.appendChild(highlighted(s, term));
                found.appendChild(li);
            });
            card.appendChild(found);
        }

        if (streets.length) {
            var groups = splitStops(streets);
            var all = el("details", "rs-all-streets");
            all.appendChild(el("summary", null, matchingStreets.length ? "Everything on this route"
                : groups.addresses.length ? "Show streets and addresses" : "Show streets"));
            // Built the first time it's opened: with every route's full list in the page at once,
            // a few dozen routes meant tens of thousands of elements and slow searching
            var built = false;
            all.addEventListener("toggle", function () {
                if (!all.open || built) return;
                built = true;
                var several = hasSeveralTowns(r);
                [["Streets", groups.streets], ["Individual addresses", groups.addresses]].forEach(function (g) {
                    if (!g[1].length) return;
                    if (groups.addresses.length) all.appendChild(el("p", "rs-group-title", g[0] + " (" + g[1].length + ")"));
                    var ul = el("ul", "rs-streets");
                    g[1].forEach(function (s) { ul.appendChild(el("li", null, withTown(r, s, several))); });
                    all.appendChild(ul);
                });
            });
            card.appendChild(all);
        }

        var actions = el("div", "mt-entry-actions");
        var print = el("button", "mt-btn", "Print");
        print.type = "button";
        print.setAttribute("aria-label", "Print route " + r.route);
        print.addEventListener("click", function () { printRoutes([r], print); });
        actions.appendChild(print);
        var edit = el("button", "mt-btn", "Edit");
        edit.type = "button";
        edit.setAttribute("aria-label", "Edit route " + r.route);
        edit.addEventListener("click", function () { startEdit(r.id); });
        var del = el("button", "mt-btn mt-btn-danger", "Delete");
        del.type = "button";
        del.setAttribute("aria-label", "Delete route " + r.route);
        del.addEventListener("click", function () { remove(r.id); });
        actions.appendChild(edit);
        actions.appendChild(del);
        card.appendChild(actions);

        return card;
    }

    function matches(r, term) {
        if (!term) return true;
        return [r.route, "route " + r.route, r.area, r.day, r.driver, r.notes].concat(r.streets || [])
            .join("\n").toLowerCase().indexOf(term) !== -1;
    }

    function render() {
        var list = load().sort(byRoute);
        var term = searchEl.value.trim().toLowerCase();
        renderDatalists(list);

        var shown = list.filter(function (r) { return matches(r, term); });
        listEl.textContent = "";
        shown.forEach(function (r) { listEl.appendChild(buildCard(r, term)); });

        var streetTotal = list.reduce(function (n, r) { return n + splitStops(r.streets).streets.length; }, 0);
        var addressTotal = list.reduce(function (n, r) { return n + splitStops(r.streets).addresses.length; }, 0);
        if (!list.length) {
            countEl.textContent = "No routes yet. Tap Add Route to add the first one.";
        } else if (!shown.length) {
            countEl.textContent = "No route has a street, route or area matching “" + searchEl.value.trim() + "”.";
        } else if (term) {
            countEl.textContent = shown.length + " route" + (shown.length === 1 ? "" : "s") + " match.";
        } else {
            countEl.textContent = list.length + " route" + (list.length === 1 ? "" : "s") + ", " +
                streetTotal + " street" + (streetTotal === 1 ? "" : "s") +
                (addressTotal ? ", " + addressTotal + " individual address" + (addressTotal === 1 ? "" : "es") : "") + ".";
        }
        document.getElementById("rs-export").disabled = !list.length;
        document.getElementById("rs-print-all").disabled = !list.length;
    }

    /* ---------- Printing ---------- */
    /* Print builds the route sheet PDF in the house report format (the RCA case PDF's layout:
       Earthwise logo, navy title, company line, green rule, page footer) and shows it in the
       app's own PDF viewer. From there Print / Share hands it to Android's share sheet, where a
       printing app (Samsung Print Service, Mopria, HP Smart...) or email takes it. That opens as
       a separate app, so the back button always returns to Route IQ. Opening the system print
       screen inside the app could leave no way back. Every sheet is kept in Saved PDFs too. */

    // Fetched once up front; resolves to null (sheets still work without it) if it can't load
    var logoPromise = fetch("assets/icons/ew-logo-192.png")
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

    function prettyToday() {
        return new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    }

    function buildSheetsPdf(routes, logo) {
        var NAVY = [4, 57, 96], GREEN = [4, 102, 53], INK = [26, 26, 26];
        var GRAY = [110, 118, 126], RULE = [214, 222, 230], TINT = [244, 247, 250];

        var PAGE_W = 612, PAGE_H = 792, M = 40;
        var CONTENT_W = PAGE_W - M * 2;
        var BOTTOM = PAGE_H - 54;
        var LOGO_SIZE = 60;
        var ROW_H = 18;

        var doc = new window.jspdf.jsPDF({ unit: "pt", format: "letter" });
        var y = M;
        var pageRoute = []; // pageRoute[n] = the route printed on page n, for the footers
        function color(fn, col) { doc[fn](col[0], col[1], col[2]); }

        function sectionBar(title) {
            color("setFillColor", NAVY);
            doc.rect(M, y, CONTENT_W, 18, "F");
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            color("setTextColor", [255, 255, 255]);
            doc.text(title, M + 8, y + 13);
            y += 18 + 6;
        }

        routes.forEach(function (r, index) {
            if (index > 0) doc.addPage();
            y = M;
            pageRoute[doc.getNumberOfPages()] = r.route;
            var streets = r.streets || [];

            if (logo) doc.addImage(logo, "PNG", PAGE_W - M - LOGO_SIZE + 6, M - 12, LOGO_SIZE, LOGO_SIZE);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(18);
            color("setTextColor", NAVY);
            doc.text("Route Sheet", M, y + 20);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
            color("setTextColor", GRAY);
            doc.text("Earthwise Environmental Solutions", M, y + 34);
            y += 50;
            color("setFillColor", GREEN);
            doc.rect(M, y, CONTENT_W, 3, "F");
            y += 16;

            doc.setFont("helvetica", "bold");
            doc.setFontSize(15);
            color("setTextColor", NAVY);
            doc.text("Route " + r.route, M, y + 13);
            y += 26;

            // Day, area, street count and print date across one shaded box
            var info = [["Service Day", r.day || "N/A"], ["Driver", r.driver || "N/A"], ["Area", r.area || "N/A"],
                ["Streets / Addr.", splitStops(streets).streets.length + " / " + splitStops(streets).addresses.length],
                ["Printed", prettyToday()]];
            var colW = CONTENT_W / info.length;
            // A long value (an area covering several towns) wraps to a second, smaller line
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            var wraps = info.some(function (pair) { return doc.splitTextToSize(String(pair[1]), colW - 16).length > 1; });
            var boxH = wraps ? 48 : 40;
            color("setFillColor", TINT);
            doc.roundedRect(M, y, CONTENT_W, boxH, 4, 4, "F");
            info.forEach(function (pair, i) {
                var x = M + 12 + i * colW;
                doc.setFont("helvetica", "bold");
                doc.setFontSize(7.5);
                color("setTextColor", NAVY);
                doc.text(pair[0].toUpperCase(), x, y + 15);
                doc.setFont("helvetica", "normal");
                doc.setFontSize(10);
                color("setTextColor", INK);
                var valueLines = doc.splitTextToSize(String(pair[1]), colW - 16);
                if (valueLines.length > 1) {
                    doc.setFontSize(8.5);
                    valueLines = doc.splitTextToSize(String(pair[1]), colW - 16).slice(0, 2);
                    doc.text(valueLines, x, y + 28, { lineHeightFactor: 1.2 });
                } else {
                    doc.text(valueLines[0] || "", x, y + 30);
                }
            });
            y += boxH + 16;

            if (r.notes) {
                sectionBar("Notes");
                doc.setFont("helvetica", "normal");
                doc.setFontSize(9.5);
                color("setTextColor", INK);
                var lines = doc.splitTextToSize(r.notes, CONTENT_W);
                doc.text(lines, M, y + 9, { lineHeightFactor: 1.3 });
                y += lines.length * 12.5 + 12;
            }

            // Two per row, read left to right, so numbering stays in order across pages. A page
            // break repeats the bar with the route number, so loose pages can't be mixed up.
            function listSection(title, items, emptyText) {
                if (y + 24 + ROW_H > BOTTOM) {
                    doc.addPage();
                    y = M;
                    pageRoute[doc.getNumberOfPages()] = r.route;
                }
                sectionBar("Route " + r.route + "  \u00B7  " + title);
                if (!items.length) {
                    doc.setFont("helvetica", "normal");
                    doc.setFontSize(9.5);
                    color("setTextColor", INK);
                    doc.text(emptyText, M, y + 10);
                    y += 22;
                    return;
                }
                var half = CONTENT_W / 2;
                for (var i = 0; i < items.length; i += 2) {
                    if (y + ROW_H > BOTTOM) {
                        doc.addPage();
                        y = M;
                        pageRoute[doc.getNumberOfPages()] = r.route;
                        sectionBar("Route " + r.route + "  \u00B7  " + title + " (continued)");
                    }
                    [i, i + 1].forEach(function (n, col) {
                        if (n >= items.length) return;
                        var x = M + col * half;
                        doc.setFont("helvetica", "normal");
                        doc.setFontSize(9);
                        color("setTextColor", GRAY);
                        doc.text((n + 1) + ".", x + 20, y + 12, { align: "right" });
                        doc.setFontSize(10);
                        color("setTextColor", INK);
                        doc.text(doc.splitTextToSize(withTown(r, items[n], severalTowns), half - 40)[0], x + 26, y + 12);
                        color("setDrawColor", RULE);
                        doc.setLineWidth(0.5);
                        doc.line(x, y + ROW_H - 1, x + half - 12, y + ROW_H - 1);
                    });
                    y += ROW_H;
                }
                y += 14;
            }

            var groups = splitStops(streets);
            var severalTowns = hasSeveralTowns(r);
            listSection("Streets", groups.streets, groups.addresses.length
                ? "No whole streets on this route." : "No streets entered for this route.");
            if (groups.addresses.length) listSection("Individual Addresses", groups.addresses, "");
        });

        // Footer: which route, and its page count, so each sheet stands on its own
        var pages = doc.getNumberOfPages();
        var counts = {};
        var seen = {};
        for (var pg = 1; pg <= pages; pg++) counts[pageRoute[pg]] = (counts[pageRoute[pg]] || 0) + 1;
        for (pg = 1; pg <= pages; pg++) {
            var route = pageRoute[pg];
            seen[route] = (seen[route] || 0) + 1;
            doc.setPage(pg);
            color("setDrawColor", RULE);
            doc.setLineWidth(0.6);
            doc.line(M, PAGE_H - 40, PAGE_W - M, PAGE_H - 40);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            color("setTextColor", GRAY);
            doc.text("Route " + route + "  \u00B7  Earthwise Environmental Solutions", M, PAGE_H - 27);
            doc.text("Page " + seen[route] + " of " + counts[route], PAGE_W - M, PAGE_H - 27, { align: "right" });
        }
        return doc;
    }

    function printRoutes(routes, button) {
        if (!window.jspdf) {
            alert("The PDF library did not load. Reload the page and try again.");
            return;
        }
        var label = button.textContent;
        button.disabled = true;
        button.textContent = "Preparing\u2026";
        logoPromise.then(function (logo) {
            var doc = buildSheetsPdf(routes, logo);
            var name = (routes.length === 1 ? "Route " + routes[0].route + " Sheet" : "Route Sheets - All Routes") +
                " - " + dateString(new Date()) + ".pdf";
            name = name.replace(/[\\/:*?"<>|]/g, "");
            var file = new File([doc.output("blob")], name, { type: "application/pdf" });
            if (window.PdfStore) window.PdfStore.add(file.name, file).catch(function () {});

            // The viewer lives in the app shell; opened on its own, this page just downloads it
            var viewer = null;
            try { viewer = window.top.PdfViewer; } catch (e) { /* not inside the app */ }
            if (viewer) {
                viewer.open(file);
            } else {
                doc.save(file.name);
            }
        }).catch(function (err) {
            console.error(err);
            alert("Sorry, the route sheet could not be created.");
        }).then(function () {
            button.disabled = false;
            button.textContent = label;
        });
    }

    document.getElementById("rs-print-all").addEventListener("click", function () {
        printRoutes(load().sort(byRoute), this);
    });

    /* ---------- Form ---------- */

    function updateStreetsCount() {
        var lines = parseStreets(fields.streets.value);
        streetsCount.textContent = lines.length ? stopCount(lines) : "";
    }

    function readForm() {
        return {
            route: fields.route.value.trim().replace(/^route\s+/i, ""),
            day: fields.day.value,
            area: fields.area.value.trim(),
            driver: fields.driver.value.trim(),
            streets: parseStreets(fields.streets.value),
            notes: fields.notes.value.trim()
        };
    }

    function resetForm() {
        editingId = null;
        formTitle.textContent = "Add Route";
        submitBtn.textContent = "Save Route";
        form.reset();
        showError("");
        updateStreetsCount();
    }

    function startEdit(id) {
        var r = load().filter(function (e) { return e.id === id; })[0];
        if (!r) return;
        editingId = id;
        fields.route.value = r.route || "";
        fields.day.value = r.day || "";
        fields.driver.value = r.driver || "";
        fields.area.value = r.area || "";
        fields.streets.value = (r.streets || []).join("\n");
        fields.notes.value = r.notes || "";
        formTitle.textContent = "Edit Route " + r.route;
        submitBtn.textContent = "Save Changes";
        showError("");
        updateStreetsCount();
        entryDialog.open();
    }

    /* ---------- Dialog ---------- */

    // Close, the X and Escape all close it; anything typed but not saved is discarded
    var entryDialog = TrackerDialog(document.getElementById("rs-dialog"), {
        focus: fields.route,
        onClose: resetForm
    });

    document.getElementById("rs-open").addEventListener("click", function () {
        resetForm();
        entryDialog.open();
    });

    fields.streets.addEventListener("input", updateStreetsCount);

    function newId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var data = readForm();
        if (!data.route) {
            showError("Enter the route.");
            fields.route.focus();
            return;
        }
        var list = load();
        var duplicate = list.some(function (r) {
            return r.id !== editingId && String(r.route).toLowerCase() === data.route.toLowerCase();
        });
        if (duplicate) {
            showError("Route " + data.route + " is already in the list. Edit that route instead.");
            fields.route.focus();
            return;
        }

        var existing = editingId ? list.filter(function (r) { return r.id === editingId; })[0] : null;
        if (existing) {
            Object.keys(data).forEach(function (k) { existing[k] = data[k]; });
            // Lines still on the list keep their town; added lines have none (they match any town)
            var kept = {};
            data.streets.forEach(function (line) {
                var c = existing.cities && existing.cities[keyOf(line)];
                if (c) kept[keyOf(line)] = c;
            });
            existing.cities = kept;
            existing.updated = Date.now();
        } else {
            data.id = newId();
            data.mapUrl = "";
            data.created = Date.now();
            list.push(data);
        }
        if (!save(list)) {
            showError("Could not save. Storage is unavailable in this browser.");
            return;
        }
        render();
        entryDialog.close();
    });

    function remove(id) {
        var r = load().filter(function (e) { return e.id === id; })[0];
        if (!r) return;
        var n = (r.streets || []).length;
        TrackerDialog.confirmDelete({
            title: "Delete route?",
            message: "Route " + r.route + " and its list of " + n + " street" + (n === 1 ? "" : "s") +
                " will be deleted. This cannot be undone.",
            confirmLabel: "Delete route"
        }, function () {
            save(load().filter(function (e) { return e.id !== id; }));
            render();
        });
    }

    // Redraw once typing pauses, not on every keystroke
    var searchTimer = null;
    searchEl.addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(render, 200);
    });

    /* ---------- Import from Excel ---------- */
    /* One .xlsx file per route. The file name is "<route> <driver>" ("MS-52-1 Bill Vaughn.xlsx");
       on the first sheet, column E holds the site addresses and column G the city, from row 2
       down (column F, a second address line, and H/I, state and zip, aren't needed). Files come
       from the Import from Excel button or from sharing them to Route IQ (sw.js keeps shared
       files in the "routeiq-share-inbox" cache until this page picks them up). */

    var SHARE_INBOX = "routeiq-share-inbox";
    var COL_ADDRESS = 4; // E
    var COL_CITY = 6;    // G
    var importList = document.getElementById("rs-import-list");
    var importStatus = document.getElementById("rs-import-status");
    var importGo = document.getElementById("rs-import-go");
    var importDone = document.getElementById("rs-import-done");
    var pendingImport = [];
    var xlsxPromise = null;

    var importDialog = TrackerDialog(document.getElementById("rs-import-dialog"), {
        onClose: function () {
            pendingImport = [];
            importList.textContent = "";
        }
    });

    function loadXlsx() {
        if (window.XLSX) return Promise.resolve(window.XLSX);
        if (!xlsxPromise) {
            xlsxPromise = new Promise(function (resolve, reject) {
                var script = document.createElement("script");
                script.src = "xlsx.mini.min.js";
                script.onload = function () { resolve(window.XLSX); };
                script.onerror = function () {
                    xlsxPromise = null;
                    reject(new Error("Spreadsheet reader failed to load"));
                };
                document.head.appendChild(script);
            });
        }
        return xlsxPromise;
    }

    function keyOf(line) {
        return window.RouteLookup ? RouteLookup.normalize(line) : String(line).trim().toLowerCase();
    }

    // "MS-52-1 Bill Vaughn.xlsx" -> { route: "MS-52-1", driver: "Bill Vaughn" }
    function nameParts(fileName) {
        var base = String(fileName).replace(/\.xlsx$/i, "").replace(/\s+/g, " ").trim();
        var m = /^(\S+)\s+(.+)$/.exec(base);
        return m ? { route: m[1], driver: m[2] } : { route: base, driver: "" };
    }

    function readFile(XLSX, file) {
        var parts = nameParts(file.name);
        var result = { fileName: file.name, route: parts.route, driver: parts.driver, lines: [], cities: {}, area: "", error: "" };
        return file.arrayBuffer().then(function (buf) {
            var wb = XLSX.read(new Uint8Array(buf), { type: "array" });
            var sheet = wb.Sheets[wb.SheetNames[0]];
            var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
            var seen = {};
            var cities = {};
            rows.slice(1).forEach(function (row) {
                var line = String(row[COL_ADDRESS] || "").replace(/\s+/g, " ").trim();
                if (!line) return;
                var k = keyOf(line);
                if (!k || seen[k]) return;
                seen[k] = true;
                result.lines.push(line);
                var city = String(row[COL_CITY] || "").trim();
                if (city) {
                    cities[city] = (cities[city] || 0) + 1;
                    result.cities[k] = city;
                }
            });
            // Most common city first; a route covering several towns lists up to three
            result.area = Object.keys(cities).sort(function (a, b) { return cities[b] - cities[a]; }).slice(0, 3).join(" / ");
            if (!result.lines.length) result.error = "No site addresses found in column E (starting at row 2).";
        }).catch(function () {
            result.error = "Couldn't read this file as an Excel workbook (.xlsx).";
        }).then(function () { return result; });
    }

    function renderImportPreview() {
        var existing = {};
        load().forEach(function (r) { existing[String(r.route).toLowerCase()] = r; });
        var seenRoutes = {};
        importList.textContent = "";
        var good = 0;

        pendingImport.forEach(function (item) {
            var row = el("article", "rs-import-item" + (item.error ? " is-error" : ""));
            // A file that couldn't be used is named as-is; its name isn't a route
            row.appendChild(el("p", "rs-import-route", item.error ? item.fileName
                : "Route " + item.route + (item.driver ? " \u00B7 " + item.driver : "")));
            if (!item.error) row.appendChild(el("p", "rs-import-file", item.fileName));
            if (item.error) {
                row.appendChild(el("p", "rs-import-note is-error", item.error));
            } else {
                var key = String(item.route).toLowerCase();
                var before = existing[key];
                var detail = stopCount(item.lines) + (item.area ? " \u00B7 " + item.area : "");
                row.appendChild(el("p", "rs-import-note", detail));
                var status = seenRoutes[key] ? "Also in another file here; this one is used"
                    : before ? "Replaces Route " + before.route + " (" + stopCount(before.streets) + " now)" : "New route";
                row.appendChild(el("span", "mt-chip rs-import-chip" + (before || seenRoutes[key] ? " is-replace" : " is-new"), status));
                if (!item.driver) row.appendChild(el("p", "rs-import-note is-warn", "No driver in the file name (expected \u201cMS-52-1 Bill Vaughn.xlsx\u201d)."));
                seenRoutes[key] = true;
                good++;
            }
            importList.appendChild(row);
        });

        importStatus.textContent = pendingImport.length + " file" + (pendingImport.length === 1 ? "" : "s") + " read. " +
            (good ? "Check the routes below, then tap Import." : "Nothing here can be imported.");
        importGo.disabled = !good;
        importGo.textContent = good ? "Import " + good + " route" + (good === 1 ? "" : "s") : "Import";
    }

    function handleFiles(files) {
        files = Array.prototype.slice.call(files || []);
        if (!files.length) return;
        importDone.textContent = "";
        pendingImport = [];
        importList.textContent = "";
        importGo.disabled = true;
        importStatus.textContent = "Reading " + files.length + " file" + (files.length === 1 ? "" : "s") + "\u2026";
        importDialog.open();
        loadXlsx().then(function (XLSX) {
            return Promise.all(files.map(function (f) { return readFile(XLSX, f); }));
        }).then(function (results) {
            pendingImport = results;
            renderImportPreview();
        }).catch(function () {
            importStatus.textContent = "The spreadsheet reader couldn't load. Check the connection once, then try again.";
        });
    }

    importGo.addEventListener("click", function () {
        var list = load();
        var byRoute = {};
        list.forEach(function (r) { byRoute[String(r.route).toLowerCase()] = r; });
        var added = 0, updated = 0;
        // Later files win when two files name the same route
        pendingImport.filter(function (i) { return !i.error; }).forEach(function (item) {
            var key = String(item.route).toLowerCase();
            var r = byRoute[key];
            if (r) {
                // The file is the source of truth for the list, driver and area; day and notes stay
                r.streets = item.lines.slice();
                r.cities = item.cities;
                if (item.driver) r.driver = item.driver;
                if (item.area) r.area = item.area;
                r.updated = Date.now();
                updated++;
            } else {
                r = { id: newId(), route: item.route, day: "", driver: item.driver, area: item.area,
                    streets: item.lines.slice(), cities: item.cities, notes: "", mapUrl: "", created: Date.now() };
                list.push(r);
                byRoute[key] = r;
                added++;
            }
        });
        if (!save(list)) {
            importStatus.textContent = "Could not save. Storage is unavailable in this browser.";
            return;
        }
        render();
        importDialog.close();
        var parts = [];
        if (added) parts.push(added + " new");
        if (updated) parts.push(updated + " updated");
        importDone.textContent = "Imported " + (added + updated) + " route" + (added + updated === 1 ? "" : "s") +
            " (" + parts.join(", ") + ").";
    });

    var fileInput = document.getElementById("rs-import-file");
    document.getElementById("rs-import-open").addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () {
        handleFiles(fileInput.files);
        fileInput.value = "";
    });

    // Files shared to Route IQ from another app wait in the service worker's inbox
    function checkSharedFiles() {
        if (!window.caches) return;
        caches.open(SHARE_INBOX).then(function (cache) {
            return cache.keys().then(function (requests) {
                if (!requests.length) return;
                return Promise.all(requests.map(function (req) {
                    return cache.match(req).then(function (res) {
                        return res.blob().then(function (blob) {
                            var name = decodeURIComponent(res.headers.get("X-File-Name") || "shared.xlsx");
                            return new File([blob], name, { type: blob.type });
                        });
                    });
                })).then(function (files) {
                    return Promise.all(requests.map(function (req) { return cache.delete(req); })).then(function () {
                        handleFiles(files);
                    });
                });
            });
        }).catch(function () { /* no inbox: nothing was shared */ });
    }
    window.addEventListener("rs-check-shared", checkSharedFiles);

    /* ---------- CSV export ---------- */

    function csvCell(value) {
        var text = String(value == null ? "" : value);
        if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    }

    // One row per street, so the file sorts and filters well in a spreadsheet
    document.getElementById("rs-export").addEventListener("click", function () {
        var rows = [["Route", "Service Day", "Driver", "Area", "Type", "Street / Address", "City", "Notes"]];
        load().sort(byRoute).forEach(function (r) {
            var streets = (r.streets || []).length ? r.streets : [""];
            streets.forEach(function (s) {
                rows.push([r.route, r.day, r.driver, r.area, s ? (isAddress(s) ? "Address" : "Street") : "", s, s ? cityOf(r, s) : "", r.notes]);
            });
        });
        var csv = "﻿" + rows.map(function (row) { return row.map(csvCell).join(","); }).join("\r\n");

        var url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        var link = document.createElement("a");
        link.href = url;
        link.download = "route-sheets-" + dateString(new Date()) + ".csv";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    });

    // Another open copy of this page changed the list
    window.addEventListener("storage", function (ev) {
        if (ev.key === KEY) render();
    });

    /* ---------- Start ---------- */

    DAYS.forEach(function (d) {
        var opt = el("option", null, d || "—");
        opt.value = d;
        fields.day.appendChild(opt);
    });
    resetForm();
    render();
    checkSharedFiles();
})();
