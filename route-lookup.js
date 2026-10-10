/* Finds which route a street address is on, using the routes entered in Route Sheets
   (route-streets.html, saved under fleetMgrRouteStreets). Shared by any page that logs an
   address, so a route and driver can be filled in instead of typed.

     RouteLookup.find("123 Main Street Apt 2")
       -> [{ route: "12", driver: "Sam", area: "Washington", day: "Monday", street: "Main St" }]

   The house number is dropped and the rest is matched against each route's streets with the
   same spelling rules as the trackers ("Street" = "St", "North" = "N", punctuation ignored).
   The longest matching street wins, so "N Main St Ext" beats "Main St". A street listed on
   more than one route returns every one of those routes; the lookup never guesses between
   them. combine() joins them ("12 / 9") for streets whose break points aren't known yet. */
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

    function loadRoutes() {
        try {
            var data = JSON.parse(localStorage.getItem(KEY) || "[]");
            return Array.isArray(data) ? data.filter(function (r) { return r && r.id; }) : [];
        } catch (e) {
            return [];
        }
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

    // An entry that starts with a house number is one home (a subscription stop), not a street
    function isAddress(line) {
        return /^\d/.test(normalize(line));
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

    // The town a route's street or address is in: saved per line by the Excel import (column G).
    // Lines typed in by hand have none and match in any town.
    function lineCity(r, line) {
        return (r.cities && r.cities[normalize(line)]) || "";
    }

    // find(address) or find(address, city). With a city, streets listed in a different town are
    // left out, so "Main St" in Washington and "Main St" in East Washington don't collide.
    function find(address, city) {
        var full = normalize(address);
        var target = streetPart(address);
        var town = normalize(city);
        if (!full) return [];
        var best = 0;
        var hits = [];
        loadRoutes().forEach(function (r) {
            (r.streets || []).forEach(function (s) {
                var key = normalize(s);
                if (!key) return;
                var where = lineCity(r, s);
                if (town && where && normalize(where) !== town) return;
                // A listed home beats any street; among streets, a longer one ("main st ext")
                // beats a shorter one ("main st"). A line whose town matches the given city
                // edges out one with no town on record.
                var score = 0;
                if (isAddress(s)) {
                    if (matchesAddress(full, key)) score = 100000 + key.length;
                } else if (target && startsWithStreet(target, key)) {
                    score = key.length;
                }
                if (!score) return;
                if (town && where) score += 0.5;
                if (score > best) {
                    best = score;
                    hits = [];
                }
                // One hit per route and town: the same street can be on a route in two towns
                var dup = hits.some(function (h) { return h.route === r.route && normalize(h.city) === normalize(where); });
                if (score === best && !dup) {
                    hits.push({ route: r.route, driver: r.driver || "", area: r.area || "", day: r.day || "", street: s,
                        city: where, kind: isAddress(s) ? "address" : "street" });
                }
            });
        });
        return hits;
    }

    // Every town listed in Route Sheets, for a City field's suggestions
    function cities() {
        var seen = {};
        var out = [];
        loadRoutes().forEach(function (r) {
            Object.keys(r.cities || {}).forEach(function (k) {
                var c = r.cities[k];
                if (c && !seen[normalize(c)]) {
                    seen[normalize(c)] = true;
                    out.push(c);
                }
            });
        });
        return out.sort();
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
                    (routeDiffers ? "Route Sheets has " + m.street + " on " : "Found in Route Sheets: ") + matchLabel(m, !!m.city)));
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
        cities: cities,
        hasRoutes: function () { return loadRoutes().length > 0; }
    };
})();
