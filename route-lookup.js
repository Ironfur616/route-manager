/* Finds which route a street address is on, using the routes entered in Route Sheets
   (route-streets.html, saved under fleetMgrRouteStreets). Shared by any page that logs an
   address, so a route and driver can be filled in instead of typed.

     RouteLookup.find("123 Main Street Apt 2")
       -> [{ route: "12", driver: "Sam", area: "Washington", day: "Monday", street: "Main St" }]

   The house number is dropped and the rest is matched against each route's streets with the
   same spelling rules as the trackers ("Street" = "St", "North" = "N", punctuation ignored).
   The longest matching street wins, so "N Main St Ext" beats "Main St". A street listed on
   more than one route returns every one of those routes; the lookup never guesses between
   them. combine() joins them ("12 / 9") for streets whose break points aren't known yet.

   A street split at known break points is listed as a house-number range ("240-920 Allison
   Ave"): it's a street, not one home, and an address only matches it when its number falls in
   the range (both sides of the street).

   House lists: a route pulled from the county (county-pull.js) has a list of every house on
   it, read here from house-store.js once the page loads. An address on a house list beats any
   street match, so a house that's on a route only because it backs onto one of its alleys
   still finds that route. house(address) says whether an address is on a list, left off one,
   or missing from a pulled route's list, and where its cans go (alley or front street). */
(function () {
    "use strict";

    var KEY = "fleetMgrRouteStreets";
    var WORDS = {
        street: "st", avenue: "ave", road: "rd", drive: "dr", lane: "ln", court: "ct",
        boulevard: "blvd", place: "pl", circle: "cir", terrace: "ter", highway: "hwy",
        extension: "ext", parkway: "pkwy", pike: "pk",
        north: "n", south: "s", east: "e", west: "w"
    };

    function normalize(text) {
        return String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
            .map(function (w) { return WORDS[w] || w; }).join(" ");
    }

    // "123 Main St", "123-125 Main St", "12A Main St" -> "main st"
    function streetPart(address) {
        return normalize(address).replace(/^(\d+[a-z]?\s*)+/, "").trim();
    }

    function readRoutes() {
        try {
            var data = JSON.parse(localStorage.getItem(KEY) || "[]");
            return Array.isArray(data) ? data.filter(function (r) { return r && r.id; }) : [];
        } catch (e) {
            return [];
        }
    }

    /* ---------- Index ----------
       Route Sheets can hold thousands of lines. Reading and re-normalizing all of them for every
       lookup made pages that look up many addresses at once (Missed Collections' Fill from Route
       Sheets check runs on every redraw) take many seconds. So the lines are read and normalized
       once into an index, grouped by first word (streets) and house number (homes), and a lookup
       only checks the lines that could match. The index is dropped whenever Route Sheets change:
       another page saving fires a storage event here, and Route Sheets calls invalidate() after
       its own saves. */
    var cache = null;

    function invalidate() {
        cache = null;
    }

    window.addEventListener("storage", function (ev) {
        if (!ev.key || ev.key === KEY) invalidate();
    });
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") invalidate();
    });

    function firstWord(text) {
        var i = text.indexOf(" ");
        return i === -1 ? text : text.slice(0, i);
    }

    function index() {
        if (cache) return cache;
        var routes = readRoutes();
        var lines = [];
        var byWord = {};
        var byNumber = {};
        var towns = {};
        function add(map, k, i) {
            (map[k] || (map[k] = [])).push(i);
        }
        routes.forEach(function (r) {
            (r.streets || []).forEach(function (s) {
                var key = normalize(s);
                if (!key) return;
                var where = (r.cities && r.cities[key]) || "";
                var i = lines.length;
                var span = range(s);
                var home = !span && /^\d/.test(key);
                lines.push({ r: r, line: s, key: span ? normalize(span.street) : key, span: span,
                    home: home, where: where, whereKey: normalize(where) });
                if (span) key = normalize(span.street);
                if (home) {
                    add(byNumber, firstWord(key), i);
                } else {
                    // Both "n main st" and "main st" lead here, so a missing or extra N. still finds it
                    variants(key).forEach(function (v) { add(byWord, firstWord(v), i); });
                }
                if (where && !towns[normalize(where)]) towns[normalize(where)] = where;
            });
        });
        cache = { routes: routes, lines: lines, byWord: byWord, byNumber: byNumber,
            towns: Object.keys(towns).map(function (k) { return towns[k]; }).sort() };
        return cache;
    }

    function loadRoutes() {
        return index().routes;
    }

    /* ---------- House lists ---------- */
    var houses = null;          // normalized address -> [{ route (key), on, alley, use, why, line, town }]
    var pulledRoutes = {};      // route key -> true for routes with a house list
    var housesStamp = null;
    var houseListeners = [];

    function readStamp() {
        try { return localStorage.getItem("fleetMgrHouseIndex"); } catch (e) { return null; }
    }

    function loadHouses() {
        if (!window.HouseStore) return;
        var stamp = readStamp();
        if (houses && stamp === housesStamp) return;
        housesStamp = stamp;
        HouseStore.all("index").then(function (records) {
            var map = {}, pulled = {};
            records.forEach(function (rec) {
                pulled[rec.route] = true;
                Object.keys(rec.houses || {}).forEach(function (k) {
                    var v = rec.houses[k];
                    var entry = { route: rec.route, on: !!v[0], alley: v[1], use: v[2] === 1 ? true : v[2] === 0 ? false : null,
                        why: v[3], line: v[4], town: v[5] };
                    // Filed with and without a leading direction, so "100 Beau St" finds "100 E Beau St"
                    addressVariants(k).forEach(function (variant) { (map[variant] = map[variant] || []).push(entry); });
                });
            });
            houses = map;
            pulledRoutes = pulled;
            houseListeners.forEach(function (fn) { try { fn(); } catch (e) { /* one page's problem */ } });
        }).catch(function () { houses = houses || {}; });
    }

    window.addEventListener("storage", function (ev) {
        if (ev.key === "fleetMgrHouseIndex") loadHouses();
    });
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") loadHouses();
    });

    // The house-list entries for an address: "326 Shirls Ave Apt 2, Washington" finds "326 shirls ave"
    function houseEntries(address) {
        if (!houses) return [];
        var full = normalize(address);
        if (!/^\d/.test(full)) return [];
        var words = full.split(" ");
        for (var n = words.length; n >= 2; n--) {
            var hit = houses[words.slice(0, n).join(" ")];
            if (hit) return hit;
        }
        return [];
    }

    function routeByKey(key) {
        return index().routes.filter(function (r) { return String(r.route).toLowerCase() === key; })[0];
    }

    /* house(address, city) -> null when no house list covers it, otherwise
         { status: "on", route, alley, use }   on a route's house list (alley "" when it isn't alley-backed)
         { status: "off", route, why }          on a pulled street but left off the list (church, school...)
         { status: "missing", route }           its street is on a route with a house list, but this number isn't */
    function house(address, city) {
        var entries = houseEntries(address).filter(function (e) { return routeByKey(e.route); });
        var town = normalize(city);
        if (town) {
            var inTown = entries.filter(function (e) { return !e.town || normalize(e.town) === town; });
            if (inTown.length) entries = inTown;
        }
        // A house on a route only by its alley, confirmed to use its front street instead, isn't that route's
        var on = entries.filter(function (e) { return e.on && !(e.use === false && e.line === e.alley); });
        if (on.length) {
            return { status: "on", route: routeByKey(on[0].route).route, alley: on[0].alley, use: on[0].use,
                line: on[0].line, alleyOnly: !!on[0].alley && on[0].line === on[0].alley };
        }
        var off = entries.filter(function (e) { return !e.on; });
        if (off.length) return { status: "off", route: routeByKey(off[0].route).route, why: off[0].why };
        // Ticked but confirmed to use its own street: that street's route decides, no note needed
        if (entries.length) return null;
        if (!houses || !/^\d/.test(normalize(address))) return null;
        var pulledHit = streetFind(address, city).filter(function (m) {
            return m.kind === "street" && pulledRoutes[String(m.route).toLowerCase()];
        })[0];
        return pulledHit ? { status: "missing", route: pulledHit.route } : null;
    }

    // "n main st" -> ["n main st", "main st"], so "N Main St" and "Main St" find each other
    function variants(text) {
        var bare = text.replace(/^[nsew]\s+/, "");
        return bare !== text && bare ? [text, bare] : [text];
    }

    // Whole words from the start: "main st" matches "main st apt 2" but not "main stream rd"
    function startsWithStreet(target, key) {
        return variants(target).some(function (t) {
            return variants(key).some(function (k) { return t === k || t.indexOf(k + " ") === 0; });
        });
    }

    // "240-920 Allison Ave" -> { from: 240, to: 920, street: "Allison Ave" }; anything else -> null
    function range(line) {
        var m = /^\s*(\d+)\s*[-–—]\s*(\d+)\s+(\D.*)$/.exec(String(line || ""));
        if (!m) return null;
        var a = +m[1], b = +m[2];
        return { from: Math.min(a, b), to: Math.max(a, b), street: m[3].trim() };
    }

    // An entry that starts with a house number is one home (a subscription stop), not a street,
    // unless it's a range of house numbers
    function isAddress(line) {
        return /^\d/.test(normalize(line)) && !range(line);
    }

    // "1234 n main st" -> ["1234 n main st", "1234 main st"], so the N. is optional either way
    function addressVariants(text) {
        var m = /^(\d+[a-z]?)\s+[nsew]\s+(.+)$/.exec(text);
        return m ? [text, m[1] + " " + m[2]] : [text];
    }

    // "1234 n main st" matches "1234 N Main Street" and "1234 Main St Apt 2", never "12345 Main St"
    function matchesAddress(full, key) {
        return addressVariants(full).some(function (t) {
            return addressVariants(key).some(function (k) { return t === k || t.indexOf(k + " ") === 0; });
        });
    }

    // Each line's town comes from the route's cities map, saved per line by the Excel import
    // (column G). Lines typed in by hand have none and match in any town.
    // find(address) or find(address, city). With a city, streets listed in a different town are
    // left out, so "Main St" in Washington and "Main St" in East Washington don't collide.
    // The index lines that could match: homes with the same house number, and streets starting
    // with the same word as the address's street (with and without a leading N./S./E./W.).
    // Kept in Route Sheets order, so results come out in the order routes were entered.
    function candidates(ix, full, target) {
        var picked = {};
        if (/^\d/.test(full)) (ix.byNumber[firstWord(full)] || []).forEach(function (i) { picked[i] = true; });
        if (target) {
            variants(target).forEach(function (v) {
                (ix.byWord[firstWord(v)] || []).forEach(function (i) { picked[i] = true; });
            });
        }
        return Object.keys(picked).map(Number).sort(function (a, b) { return a - b; })
            .map(function (i) { return ix.lines[i]; });
    }

    // An address on a route's house list goes to that route, ahead of any street match
    function find(address, city) {
        var h = house(address, city);
        if (h && h.status === "on") {
            var r = routeByKey(String(h.route).toLowerCase());
            return [{ route: r.route, driver: r.driver || "", area: r.area || "", day: r.day || "", street: h.line,
                city: (r.cities && r.cities[normalize(h.line)]) || "", kind: "house", alley: h.alley, use: h.use }];
        }
        return streetFind(address, city);
    }

    function streetFind(address, city) {
        var full = normalize(address);
        var target = streetPart(address);
        var town = normalize(city);
        if (!full) return [];
        var best = 0;
        var hits = [];
        candidates(index(), full, target).forEach(function (entry) {
            (function (r, s, key, where) {
                if (town && where && entry.whereKey !== town) return;
                // A listed home beats any street; among streets, a longer one ("main st ext")
                // beats a shorter one ("main st"). A line whose town matches the given city
                // edges out one with no town on record.
                var score = 0;
                if (entry.home) {
                    if (matchesAddress(full, key)) score = 100000 + key.length;
                } else if (target && startsWithStreet(target, key)) {
                    score = key.length;
                    if (entry.span) {
                        // Only an address numbered inside the range; a number-less street name matches any range
                        var number = /^(\d+)/.exec(full);
                        if (number && (+number[1] < entry.span.from || +number[1] > entry.span.to)) score = 0;
                        else if (number) score += 0.25; // a range that holds the number beats the bare street
                    }
                }
                if (!score) return;
                if (town && where) score += 0.5;
                if (score > best) {
                    best = score;
                    hits = [];
                }
                // One hit per route and town: the same street can be on a route in two towns
                var dup = hits.some(function (h) { return h.route === r.route && normalize(h.city) === entry.whereKey; });
                if (score === best && !dup) {
                    hits.push({ route: r.route, driver: r.driver || "", area: r.area || "", day: r.day || "", street: s,
                        city: where, kind: entry.home ? "address" : "street" });
                }
            })(entry.r, entry.line, entry.key, entry.where);
        });
        return hits;
    }

    // Every town listed in Route Sheets, for a City field's suggestions
    function cities() {
        return index().towns.slice();
    }

    // A street split between routes, until its break points are known, gets every route and
    // driver at once, joined with " / " ("12 / 9", "Sam / Kim"), in Route Sheets order
    function combine(matches) {
        function joined(key) {
            var seen = {};
            return matches.map(function (m) { return m[key]; }).filter(function (v) {
                var k = String(v || "").toLowerCase();
                if (!k || seen[k]) return false;
                seen[k] = true;
                return true;
            }).join(" / ");
        }
        return { route: joined("route"), driver: joined("driver"), area: joined("area"), day: joined("day"),
            city: joined("city"), street: matches.length ? matches[0].street : "" };
    }

    /* ---------- Form auto-fill ----------
       Connects a form's address, route and driver inputs (and an optional city input) to the lookup:

         var routeFill = RouteLookup.attach({ address: input, city: input, route: input, driver: input, note: element });
         routeFill.reset();          // a fresh form (kept values from the last stop stay replaceable)
         routeFill.editing(entry);   // an existing entry: its saved values count as typed by hand

       Typing the address fills Route and Driver unless they were typed by hand in this form. A
       street on several routes fills all of them ("12 / 9", "Sam / Kim") with buttons to narrow it
       to one. Values the lookup filled for an earlier address are cleared when the address stops
       matching. The note element explains what happened, including why a driver didn't fill.

       With a city input: a city typed by hand narrows the match to that town; when every match is
       in one town, the city is filled in; when a street is in several towns, the buttons name the
       town and picking one fills the city too. */
    function attach(f) {
        // Where each value in the form came from. Only "manual" (typed by hand here) is protected;
        // "kept" (from the last stop or empty) and "auto" (filled by a lookup) are not. "picked" is
        // one route chosen from a split street's buttons: kept while that street's address is
        // still being typed, replaced like "auto" otherwise.
        var source = { route: "kept", driver: "kept", city: "kept" };

        function isLookupValue(s) {
            return s === "auto" || s === "picked";
        }

        function el(tag, className, text) {
            var node = document.createElement(tag);
            if (className) node.className = className;
            if (text != null) node.textContent = text;
            return node;
        }

        function same(a, b) {
            return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
        }

        // Only a city typed by hand narrows the search; one the lookup filled in for an earlier
        // address must not hide the right route for a new one
        function cityFilter() {
            return f.city && source.city === "manual" ? f.city.value : "";
        }

        function fillFrom(match, how) {
            if (source.route !== "manual") {
                f.route.value = match.route;
                source.route = how || "auto";
            }
            // A combined "Washington / East Washington" isn't one town, so it's never put in the box
            if (f.city && source.city !== "manual" && match.city && match.city.indexOf(" / ") === -1) {
                f.city.value = match.city;
                source.city = how || "auto";
            }
            if (source.driver === "manual") return;
            if (match.driver) {
                f.driver.value = match.driver;
                source.driver = how || "auto";
            } else if (isLookupValue(source.driver)) {
                // A driver filled in for an earlier route isn't this route's driver
                f.driver.value = "";
                source.driver = "kept";
            }
        }

        function clearAutoFilled() {
            ["route", "driver", "city"].forEach(function (k) {
                if (f[k] && isLookupValue(source[k])) {
                    f[k].value = "";
                    source[k] = "kept";
                }
            });
        }

        function multipleTowns(matches) {
            var seen = {};
            matches.forEach(function (m) { if (m.city) seen[normalize(m.city)] = true; });
            return Object.keys(seen).length > 1;
        }

        function matchLabel(m, withTown) {
            return "Route " + m.route + (m.driver ? " · " + m.driver : "") + (withTown && m.city ? " (" + m.city + ")" : "");
        }

        function pickButton(text, chosen, onPick) {
            var b = el("button", "mt-btn mt-route-pick" + (chosen ? " is-selected" : ""), text);
            b.type = "button";
            if (chosen !== null) b.setAttribute("aria-pressed", String(!!chosen));
            b.addEventListener("click", function () {
                onPick();
                update(false);
            });
            return b;
        }

        // A button tap: overrides even values typed by hand, since the person chose it
        function useMatch(m, how) {
            source.route = "auto";
            source.driver = "auto";
            if (m.city && m.city.indexOf(" / ") === -1) source.city = "auto";
            fillFrom(m, how);
        }

        // Why the driver didn't fill in: a route with no driver in Route Sheets, or a driver
        // entered by hand that the lookup won't overwrite (with a button to use Route Sheets')
        function driverNotes(matches) {
            var both = combine(matches);
            var forRoute = same(both.route, f.route.value) ? matches
                : matches.filter(function (m) { return same(m.route, f.route.value); });
            if (!forRoute.length) return;

            var missing = forRoute.filter(function (m) { return !m.driver; });
            if (missing.length) {
                f.note.appendChild(el("p", "mt-route-none", "No driver listed for " +
                    missing.map(function (m) { return "Route " + m.route; }).join(" or ") +
                    " in Route Sheets. Add it there to have it filled in here."));
            }

            var expected = combine(forRoute).driver;
            if (expected && source.driver === "manual" && !same(f.driver.value, expected)) {
                f.note.appendChild(el("p", "mt-route-none", "Driver was entered by hand, so it was left as is."));
                f.note.appendChild(pickButton("Use " + expected, null, function () {
                    f.driver.value = expected;
                    source.driver = "auto";
                }));
            }
        }

        // Where this house's cans go, or why it isn't on the route's house list
        function houseNotes() {
            var h = house(f.address.value, f.city ? f.city.value : "");
            if (!h) return;
            if (h.status === "on" && h.alley && h.use !== false) {
                f.note.appendChild(el("p", "mt-route-alley", h.use
                    ? "Collection point: " + h.alley + " (alley)."
                    : "Backs onto " + h.alley + " (alley). Not yet checked whether the cans go there."));
                // Unchecked and only on this route by its alley: its own street may be someone else's
                if (h.alleyOnly && h.use === null) {
                    var others = streetFind(f.address.value, f.city ? f.city.value : "").filter(function (m) { return !same(m.route, h.route); });
                    if (others.length) {
                        f.note.appendChild(el("p", "mt-route-none", "Its front street is on " +
                            others.map(function (m) { return "Route " + m.route; }).join(" and ") +
                            ". Check which route collects it, then set its alley use in Route Sheets."));
                    }
                }
            } else if (h.status === "off") {
                f.note.appendChild(el("p", "mt-route-none", "Left off Route " + h.route + "'s house list" + (h.why ? ": " + h.why : "") + "."));
            } else if (h.status === "missing") {
                f.note.appendChild(el("p", "mt-route-none", "This house number isn't on Route " + h.route + "'s house list from the county. Check the address."));
            }
        }

        function update(apply) {
            f.note.textContent = "";
            if (!loadRoutes().length) return;
            if (!f.address.value.trim()) {
                if (apply) clearAutoFilled();
                return;
            }
            var town = cityFilter();
            var matches = find(f.address.value, town);
            var towns = multipleTowns(matches);

            if (matches.length === 1) {
                var m = matches[0];
                if (apply) fillFrom(m);
                var routeDiffers = f.route.value.trim() && !same(f.route.value, m.route);
                f.note.appendChild(el("p", "mt-route-found",
                    (routeDiffers ? "Route Sheets has " + m.street + " on " : m.kind === "house" ? "On the house list for " : "Found in Route Sheets: ") + matchLabel(m, !!m.city)));
                // A route typed by hand that disagrees with Route Sheets: offer, don't overwrite
                if (routeDiffers) f.note.appendChild(pickButton("Use " + matchLabel(m, !!m.city), null, function () { useMatch(m); }));
                else driverNotes(matches);
            } else if (matches.length > 1) {
                // Split street (or the same street in several towns): every route and driver until
                // it's narrowed down. A single route picked below is kept while the rest of the
                // address is typed.
                var both = combine(matches);
                var pickedOne = source.route === "picked" && matches.some(function (x) { return same(x.route, f.route.value); });
                if (apply && !pickedOne) {
                    fillFrom(both);
                    // Different towns: a city the lookup filled for an earlier address no longer applies
                    if (towns && f.city && isLookupValue(source.city)) {
                        f.city.value = "";
                        source.city = "kept";
                    }
                }
                var intro = towns
                    ? matches[0].street + " is on " + matches.length + " routes in different towns" +
                        (f.city ? ". Enter the city, or tap the right one:" : ". Tap the right one:")
                    : matches[0].street + " is split between " + matches.map(function (x) { return matchLabel(x, false); }).join(" and ") + ". " +
                        (same(f.route.value, both.route) ? "Both are filled in; tap one if you know which:" : "Tap the route this stop is on, or Both:");
                f.note.appendChild(el("p", "mt-route-found", intro));
                var picks = el("div", "mt-route-picks");
                if (!towns) picks.appendChild(pickButton("Both", same(f.route.value, both.route), function () { useMatch(both); }));
                matches.forEach(function (match) {
                    var chosen = same(f.route.value, match.route) && (!towns || !f.city || same(f.city.value, match.city));
                    picks.appendChild(pickButton(matchLabel(match, towns), chosen, function () { useMatch(match, "picked"); }));
                });
                f.note.appendChild(picks);
                driverNotes(matches);
            } else {
                if (apply) clearAutoFilled();
                if (/[a-z]/i.test(f.address.value)) {
                    f.note.appendChild(el("p", "mt-route-none", town
                        ? "Street not found in Route Sheets for " + town.trim() + "."
                        : "Street not found in Route Sheets."));
                }
            }
        }

        var updateStreets = update;
        update = function (apply) {
            updateStreets(apply);
            if (f.address.value.trim() && loadRoutes().length) houseNotes();
        };
        // House lists load a moment after the page; check again once they're in
        houseListeners.push(function () {
            if (f.address.value.trim()) update(false);
        });

        f.address.addEventListener("input", function () { update(true); });
        f.route.addEventListener("input", function () {
            source.route = f.route.value.trim() ? "manual" : "kept";
            update(false);
        });
        f.driver.addEventListener("input", function () {
            source.driver = f.driver.value.trim() ? "manual" : "kept";
        });
        if (f.city) {
            // A city typed (or picked from the suggestions) narrows the match right away
            f.city.addEventListener("input", function () {
                source.city = f.city.value.trim() ? "manual" : "kept";
                update(true);
            });
        }

        return {
            reset: function () {
                source = { route: "kept", driver: "kept", city: "kept" };
                f.note.textContent = "";
            },
            editing: function (entry) {
                source = { route: entry.route ? "manual" : "kept", driver: entry.driver ? "manual" : "kept",
                    city: entry.city ? "manual" : "kept" };
                f.note.textContent = "";
            }
        };
    }

    window.RouteLookup = {
        find: find,
        combine: combine,
        attach: attach,
        normalize: normalize,
        isAddress: isAddress,
        range: range,
        house: house,
        // fn runs whenever the house lists (re)load, so pages can redraw with them
        onHouses: function (fn) { houseListeners.push(fn); if (houses) fn(); },
        cities: cities,
        invalidate: invalidate,
        hasRoutes: function () { return loadRoutes().length > 0; }
    };
    loadHouses();
})();
