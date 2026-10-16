/* Pull from County, on each Route Sheets card (route-streets.js).
   Builds a route's house list from Washington County's 911 address points, published free by
   the county through PASDA (Penn State's public map data service). Only the streets on the
   route being pulled are asked for. Every house found is listed for review, grouped under the
   route line it came from, and the route's spreadsheet can then be written back out with a row
   per house under each street, with zip, latitude and longitude filled in.

   Alleys: in Washington many "streets" on a route are alleys (E Ave) that the houses on either
   side put their cans out to, but those houses are addressed on their front street, so the
   alley itself has no address points. A route line with a road centerline but no address
   points is looked up as an alley: every parcel whose lot touches the alley is taken, and its
   house is listed under the alley with its real address. Corner lots (the lot touches the end
   of the alley but the house faces the cross street) are listed but left unticked. Any line
   can be switched between street and alley in the review. A house that also fronts a street on
   the route is ticked under that street and marked alley-backed; under the alley it's listed for
   reference only. Each alley-backed house has an Alley use button (not checked yet / puts cans
   in the alley / uses the front street) for confirming in the field, and the spreadsheet's added
   Collection Point column says "Alley: E Ave", "Alley-backed: E Ave (not checked)" or nothing.

   What's left out: the county data has no land-use code, so non-residential stops are spotted
   by the parcel owner's name. Churches, schools and government owners are unticked; buildings
   with 5 or more units are unticked as apartment buildings; company-owned houses (LLC, Inc)
   stay ticked but are flagged, since many are rentals. Every tick can be changed, and changes
   are kept when the route is pulled again.

   Storage: IndexedDB "routeiq-houses" ("sheets": each imported spreadsheet's rows, so the export
   keeps the columns Route Sheets doesn't use; "pulls": each route's house list). Route Sheets
   keeps only the small summary shown on the card.

     CountyPull.saveSheet(routeKey, { fileName, rows })  -> Promise
     CountyPull.open(route, onSummary)  opens the dialog; onSummary({ kept, total, pulled })
*/
(function () {
    "use strict";

    var BASE = "https://mapservices.pasda.psu.edu/server/rest/services/pasda/WashingtonCounty/MapServer/";
    var LAYER_POINTS = 0, LAYER_ROADS = 3, LAYER_PARCELS = 7;
    var PAGE = 1000;          // the service's maxRecordCount
    var IN_CHUNK = 80;        // parcel IDs per "IN (...)" query
    var ALLEY_REACH_FT = 12;  // a lot counts as backing onto the alley within this distance
    var APARTMENT_UNITS = 5;  // this many address points on one parcel = apartment building

    var COL = { address: 4, line2: 5, city: 6, state: 7, zip: 8, lat: 11, lon: 12 }; // E F G H I L M

    /* ---------- Storage ---------- */

    var DB_NAME = "routeiq-houses";
    var dbPromise = null;

    function openDb() {
        if (!dbPromise) {
            dbPromise = new Promise(function (resolve, reject) {
                if (!window.indexedDB) return reject(new Error("IndexedDB unavailable"));
                var req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = function () {
                    req.result.createObjectStore("sheets", { keyPath: "route" });
                    req.result.createObjectStore("pulls", { keyPath: "route" });
                };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
            dbPromise.catch(function () { dbPromise = null; });
        }
        return dbPromise;
    }

    function dbRun(storeName, mode, fn) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeName, mode);
                var req = fn(tx.objectStore(storeName));
                tx.oncomplete = function () { resolve(req ? req.result : undefined); };
                tx.onerror = function () { reject(tx.error); };
                tx.onabort = function () { reject(tx.error); };
            });
        });
    }

    function getRecord(storeName, key) {
        return dbRun(storeName, "readonly", function (s) { return s.get(key); });
    }

    function putRecord(storeName, record) {
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
        return dbRun(storeName, "readwrite", function (s) { s.put(record); });
    }

    /* ---------- Names ---------- */

    var TYPES = {
        st: "Street", str: "Street", street: "Street", ave: "Avenue", av: "Avenue", avenue: "Avenue",
        rd: "Road", road: "Road", ln: "Lane", lane: "Lane", dr: "Drive", drive: "Drive",
        ct: "Court", court: "Court", cir: "Circle", circle: "Circle", pl: "Place", place: "Place",
        ter: "Terrace", terr: "Terrace", terrace: "Terrace", way: "Way", blvd: "Boulevard",
        boulevard: "Boulevard", aly: "Alley", al: "Alley", alley: "Alley", ext: "Extension",
        extension: "Extension", mnr: "Manor", manor: "Manor", hl: "Hill", hill: "Hill",
        vw: "View", view: "View", hts: "Heights", heights: "Heights", trl: "Trail", trail: "Trail",
        pike: "Pike", sq: "Square", square: "Square", pkwy: "Parkway", parkway: "Parkway",
        hwy: "Highway", highway: "Highway", run: "Run", row: "Row", xing: "Crossing", crossing: "Crossing"
    };
    var SHORT_TYPE = {
        Street: "St", Avenue: "Ave", Road: "Rd", Lane: "Ln", Drive: "Dr", Court: "Ct", Circle: "Cir",
        Place: "Pl", Terrace: "Ter", Way: "Way", Boulevard: "Blvd", Alley: "Aly", Extension: "Ext",
        Manor: "Mnr", Hill: "Hl", View: "Vw", Heights: "Hts", Trail: "Trl", Pike: "Pike",
        Square: "Sq", Parkway: "Pkwy", Highway: "Hwy", Run: "Run", Row: "Row", Crossing: "Xing"
    };
    var DIRS = {
        n: "North", north: "North", s: "South", south: "South", e: "East", east: "East",
        w: "West", west: "West", ne: "Northeast", northeast: "Northeast", nw: "Northwest",
        northwest: "Northwest", se: "Southeast", southeast: "Southeast", sw: "Southwest", southwest: "Southwest"
    };
    var SHORT_DIR = { North: "N", South: "S", East: "E", West: "W", Northeast: "NE", Northwest: "NW", Southeast: "SE", Southwest: "SW" };
    var ORDINALS = ["", "FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH", "SIXTH", "SEVENTH", "EIGHTH", "NINTH", "TENTH",
        "ELEVENTH", "TWELFTH", "THIRTEENTH", "FOURTEENTH", "FIFTEENTH", "SIXTEENTH", "SEVENTEENTH", "EIGHTEENTH", "NINETEENTH", "TWENTIETH"];

    function blank(v) {
        return v == null || String(v).trim() === "";
    }

    function clean(v) {
        return blank(v) ? "" : String(v).trim();
    }

    // "E Ave" -> { name: "E", type: "Avenue" }; "North True Street" -> { preDir: "North", name: "TRUE", type: "Street" }
    function parseStreet(text) {
        var tokens = String(text).replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
        var out = { preDir: "", name: "", type: "", postDir: "" };
        var low = function (t) { return String(t || "").toLowerCase(); };
        if (tokens.length > 2 && DIRS[low(tokens[tokens.length - 1])] && TYPES[low(tokens[tokens.length - 2])]) {
            out.postDir = DIRS[low(tokens.pop())];
        }
        if (tokens.length > 1 && TYPES[low(tokens[tokens.length - 1])]) out.type = TYPES[low(tokens.pop())];
        // A lone direction is the name itself ("E Ave", "North Avenue")
        if (tokens.length > 1 && DIRS[low(tokens[0])]) out.preDir = DIRS[low(tokens.shift())];
        out.name = tokens.join(" ").toUpperCase();
        return out;
    }

    // "1234 N. Main Street" -> { number: "1234", suffix: "", street: {...} }
    function parseAddress(text) {
        var m = /^\s*(\d+)\s*([A-Za-z](?=\s))?\s*(.*)$/.exec(String(text));
        if (!m) return null;
        return { number: m[1], suffix: (m[2] || "").toUpperCase(), street: parseStreet(m[3]) };
    }

    // Spellings to try for a name: "2ND" also as "SECOND" and the other way round
    function nameVariants(name) {
        var out = [name];
        var m = /^(\d+)(ST|ND|RD|TH)$/.exec(name);
        if (m && ORDINALS[+m[1]]) out.push(ORDINALS[+m[1]]);
        var i = ORDINALS.indexOf(name);
        if (i > 0) out.push(i + (i === 1 ? "ST" : i === 2 ? "ND" : i === 3 ? "RD" : "TH"));
        if (/^ST /.test(name)) out.push(name.replace(/^ST /, "SAINT "));
        if (/^SAINT /.test(name)) out.push(name.replace(/^SAINT /, "ST "));
        if (/^MT /.test(name)) out.push(name.replace(/^MT /, "MOUNT "));
        if (/^MOUNT /.test(name)) out.push(name.replace(/^MOUNT /, "MT "));
        return out;
    }

    // Capital first letter, rest lower, with McKinley, O'Hara, Smith-Jones and 2nd handled
    function titleWord(w) {
        if (/^\d+(ST|ND|RD|TH)$/i.test(w)) return w.toLowerCase();
        if (/^\d/.test(w)) return w.toUpperCase();
        return w.split("-").map(function (part) {
            var lower = part.toLowerCase();
            if (/^mc[a-z]{2,}/.test(lower)) return "Mc" + lower.charAt(2).toUpperCase() + lower.slice(3);
            if (/^o'[a-z]/.test(lower)) return "O'" + lower.charAt(2).toUpperCase() + lower.slice(3);
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        }).join("-");
    }

    function titleCase(text) {
        return clean(text).split(/\s+/).map(titleWord).join(" ");
    }

    function sql(text) {
        return "'" + String(text).replace(/'/g, "''") + "'";
    }

    // 450 Shirls Avenue (shown in the app) / 450 Shirls Ave (in the spreadsheet)
    function streetLabel(h, short) {
        var parts = [];
        if (h.preDir) parts.push(short ? SHORT_DIR[h.preDir] || h.preDir : h.preDir);
        parts.push(titleCase(h.name));
        if (h.type) parts.push(short ? SHORT_TYPE[h.type] || h.type : h.type);
        if (h.postDir) parts.push(short ? SHORT_DIR[h.postDir] || h.postDir : h.postDir);
        return parts.join(" ");
    }

    function houseLabel(h, short) {
        return h.number + (h.numSuf || "") + " " + streetLabel(h, short) + (h.unit ? (short ? "" : ", Unit " + h.unit) : "");
    }

    function houseKey(h) {
        return [h.number + (h.numSuf || ""), h.preDir, h.name, h.type, h.postDir, h.unit].join("|").toUpperCase();
    }

    // Grouped by front street, then house number in order (12 before 101), then unit
    function byStreetThenNumber(a, b) {
        return streetLabel(a, false).localeCompare(streetLabel(b, false)) ||
            (parseInt(a.number, 10) - parseInt(b.number, 10)) ||
            String(a.numSuf + a.unit).localeCompare(String(b.numSuf + b.unit), undefined, { numeric: true });
    }

    function lineKey(line) {
        return window.RouteLookup ? RouteLookup.normalize(line) : String(line).trim().toLowerCase();
    }

    function isAddress(line) {
        return window.RouteLookup ? RouteLookup.isAddress(line) : /^\s*\d/.test(line);
    }

    /* ---------- County service ---------- */

    function query(layer, params) {
        var body = new URLSearchParams();
        body.set("f", "json");
        Object.keys(params).forEach(function (k) { body.set(k, params[k]); });
        // A form POST keeps long ID lists and alley shapes out of the URL and needs no preflight
        return fetch(BASE + layer + "/query", { method: "POST", body: body }).then(function (res) {
            if (!res.ok) throw new Error("County service answered " + res.status);
            return res.json();
        }).then(function (data) {
            if (data.error) throw new Error(data.error.message || "County service error");
            return data;
        });
    }

    // Every page of a query (the service returns at most 1,000 rows at a time)
    function queryAll(layer, params) {
        var rows = [];
        function page(offset) {
            var p = {};
            Object.keys(params).forEach(function (k) { p[k] = params[k]; });
            p.resultOffset = offset;
            p.resultRecordCount = PAGE;
            return query(layer, p).then(function (data) {
                rows = rows.concat(data.features || []);
                if (data.exceededTransferLimit && (data.features || []).length) return page(offset + data.features.length);
                return rows;
            });
        }
        return page(0);
    }

    var POINT_FIELDS = "Add_Number,AddNum_Suf,St_PreDir,StreetName,St_PosTyp,St_PosDir,Unit,Inc_Muni,Post_Comm,Post_Code,UPI";

    function toHouse(feature) {
        var a = feature.attributes, g = feature.geometry || {};
        return {
            number: clean(a.Add_Number), numSuf: clean(a.AddNum_Suf).toUpperCase(),
            preDir: titleCase(a.St_PreDir), name: clean(a.StreetName).toUpperCase(),
            type: titleCase(a.St_PosTyp), postDir: titleCase(a.St_PosDir), unit: clean(a.Unit),
            muni: titleCase(a.Inc_Muni), city: titleCase(a.Post_Comm), zip: clean(a.Post_Code),
            upi: clean(a.UPI), lat: g.y != null ? +(+g.y).toFixed(6) : "", lon: g.x != null ? +(+g.x).toFixed(6) : ""
        };
    }

    function points(where) {
        return queryAll(LAYER_POINTS, {
            where: where, outFields: POINT_FIELDS, returnGeometry: "true", outSR: "4326", orderByFields: "OBJECTID"
        }).then(function (features) { return features.map(toHouse).filter(function (h) { return h.number && h.number !== "0"; }); });
    }

    // Limits a query to the route line's town: its municipality first, then its mailing town
    function townClauses(town, muniField, postField) {
        var t = clean(town).toUpperCase();
        if (!t) return [""];
        return ["(" + muniField + " LIKE " + sql(t + "%") + ")", "(" + postField + " = " + sql(t) + ")"];
    }

    // Runs fn(townClause) for each clause in turn until one finds something
    function inTown(clauses, fn) {
        function at(i) {
            return fn(clauses[i]).then(function (found) {
                if (!found.length && i + 1 < clauses.length) return at(i + 1);
                return found;
            });
        }
        return at(0);
    }

    function streetWhere(s, opts) {
        var parts = ["StreetName IN (" + nameVariants(s.name).map(sql).join(",") + ")"];
        if (s.type && !opts.anyType) parts.push("St_PosTyp = " + sql(s.type));
        // A line without a direction ("Beau St") covers East and West Beau St alike
        if (!opts.anyDir && s.preDir) parts.push("St_PreDir = " + sql(s.preDir));
        if (s.span) parts.push("Add_Number >= " + s.span.from + " AND Add_Number <= " + s.span.to);
        if (opts.town) parts.push(opts.town);
        return parts.join(" AND ");
    }

    function roadWhere(s, town) {
        var parts = ["St_Name IN (" + nameVariants(s.name).map(sql).join(",") + ")"];
        if (s.type) parts.push("St_PosTyp = " + sql(s.type));
        if (town) parts.push(town);
        return parts.join(" AND ");
    }

    function roads(s, town) {
        var clauses = townClauses(town, "IncMuni_L", "PostComm_L");
        function tryAt(i) {
            var c = clauses[i];
            var townSql = c ? "(" + c + " OR " + c.replace(/_L\b/g, "_R") + ")" : "";
            return queryAll(LAYER_ROADS, {
                where: roadWhere(s, townSql), outFields: "OBJECTID", returnGeometry: "true", outSR: "4326"
            }).then(function (f) {
                if (!f.length && i + 1 < clauses.length) return tryAt(i + 1);
                return f;
            });
        }
        return tryAt(0);
    }

    function inChunks(field, values) {
        var out = [];
        for (var i = 0; i < values.length; i += IN_CHUNK) {
            out.push(field + " IN (" + values.slice(i, i + IN_CHUNK).map(sql).join(",") + ")");
        }
        return out;
    }

    function sequence(items, fn) {
        var results = [];
        return items.reduce(function (p, item) {
            return p.then(function () { return fn(item); }).then(function (r) { results.push(r); });
        }, Promise.resolve()).then(function () { return results; });
    }

    /* A whole street: its address points in the route line's town. If there are none but the
       road exists, it's taken as an alley. A looser match (any direction, then any type) is
       tried only when no road of that exact name exists, and is flagged for checking. */
    function lookupStreet(line, town, forceMode) {
        // "240-920 Allison Ave": only houses numbered in that range, both sides of the street
        var span = window.RouteLookup && RouteLookup.range(line);
        var s = parseStreet(span ? span.street : line);
        if (span) s.span = span;
        var result = { mode: "street", note: "", houses: [] };
        if (!s.name) { result.note = "Couldn't read a street name."; return Promise.resolve(result); }
        if (forceMode === "alley") return lookupAlley(s, town, result);

        var clauses = townClauses(town, "Inc_Muni", "Post_Comm");
        return inTown(clauses, function (t) { return points(streetWhere(s, { town: t })); }).then(function (found) {
            if (found.length || forceMode === "street") {
                result.houses = found;
                if (!found.length) result.note = "No county address points found for this street.";
                return result;
            }
            return roads(s, town).then(function (roadFeatures) {
                if (roadFeatures.length) {
                    // The road is there but no house faces it: an alley
                    result.alleyRoads = roadFeatures;
                    return lookupAlley(s, town, result);
                }
                return inTown(clauses, function (t) { return points(streetWhere(s, { town: t, anyDir: true })); }).then(function (loose) {
                    if (loose.length || !s.type) return loose;
                    return inTown(clauses, function (t) { return points(streetWhere(s, { town: t, anyDir: true, anyType: true })); });
                }).then(function (loose) {
                    result.houses = loose;
                    result.note = loose.length
                        ? "No exact match; found by a looser spelling. Check these are the right street."
                        : "Not found in the county data. Check the spelling, or switch to alley.";
                    if (loose.length) loose.forEach(function (h) { h.flag = "Loose match"; });
                    return result;
                });
            });
        });
    }

    function lookupAlley(s, town, result) {
        result.mode = "alley";
        var roadsPromise = result.alleyRoads ? Promise.resolve(result.alleyRoads) : roads(s, town);
        return roadsPromise.then(function (roadFeatures) {
            if (!roadFeatures.length) {
                result.note = "No road of this name in the county data.";
                return result;
            }
            var paths = [];
            roadFeatures.forEach(function (f) { if (f.geometry && f.geometry.paths) paths = paths.concat(f.geometry.paths); });
            var shape = JSON.stringify({ paths: paths, spatialReference: { wkid: 4326 } });
            var near = {
                geometry: shape, geometryType: "esriGeometryPolyline", inSR: "4326",
                spatialRel: "esriSpatialRelIntersects", returnGeometry: "false"
            };
            function withExtra(base, extra) {
                var p = {};
                Object.keys(base).forEach(function (k) { p[k] = base[k]; });
                Object.keys(extra).forEach(function (k) { p[k] = extra[k]; });
                return p;
            }
            return Promise.all([
                queryAll(LAYER_PARCELS, withExtra(near, { distance: ALLEY_REACH_FT, units: "esriSRUnit_Foot", outFields: "PIN" })),
                // Roads touching the alley are its cross streets; a lot fronting one is a corner lot
                queryAll(LAYER_ROADS, withExtra(near, { distance: 5, units: "esriSRUnit_Foot", outFields: "St_Name,St_PosTyp" }))
            ]).then(function (both) {
                var pins = {};
                both[0].forEach(function (f) {
                    var pin = clean(f.attributes.PIN);
                    if (pin && !/^999-/.test(pin)) pins[pin] = true;
                });
                var cross = {};
                both[1].forEach(function (f) {
                    var k = (clean(f.attributes.St_Name) + "|" + titleCase(f.attributes.St_PosTyp)).toUpperCase();
                    cross[k] = true;
                });
                var alleyKey = (s.name + "|" + s.type).toUpperCase();
                return sequence(inChunks("UPI", Object.keys(pins)), function (where) { return points(where); }).then(function (lists) {
                    var houses = [].concat.apply([], lists);
                    houses.forEach(function (h) {
                        var front = (h.name + "|" + h.type).toUpperCase();
                        if (front === alleyKey) return;
                        h.front = streetLabel(h, false);
                        if (cross[front]) { h.flag = "Corner lot: touches the end of the alley"; h.autoOff = true; }
                    });
                    result.houses = houses;
                    var backing = houses.filter(function (h) { return h.front; }).length;
                    result.note = backing
                        ? backing + " lot" + (backing === 1 ? "" : "s") + " back onto this alley. Untick any that don't put cans out here."
                        : "No lots found along this alley.";
                    return result;
                });
            });
        });
    }

    // A subscription home listed on its own: its county point, for zip and coordinates
    function lookupAddress(line, town) {
        var a = parseAddress(line);
        if (!a || !a.street.name) return Promise.resolve(null);
        return inTown(townClauses(town, "Inc_Muni", "Post_Comm"), function (t) {
            return points("Add_Number = " + (+a.number) + " AND " + streetWhere(a.street, { town: t }));
        }).then(function (found) { return found[0] || null; });
    }

    /* ---------- Who's left out ---------- */

    var EXCLUDE = [
        [/\b(CHURCH|PARISH|DIOCESE|CONGREGATION|MINISTRY|MINISTRIES|TEMPLE|SYNAGOGUE|MOSQUE|CATHEDRAL|CHAPEL|BIBLE|PRESBYTERY|PRESBYTERIAN|METHODIST|BAPTIST|LUTHERAN|CATHOLIC|EPISCOPAL|EVANGELICAL|PENTECOSTAL|KINGDOM HALL|JEHOVAH|TABERNACLE|ASSEMBLY OF GOD|AME ZION|TRUSTEES OF)\b/, "Church / religious"],
        [/\b(SCHOOL|SCHOOLS|SCH DIST|COLLEGE|UNIVERSITY|ACADEMY|PRESCHOOL|DAY CARE|DAYCARE)\b/, "School"],
        [/\b(CITY OF|COUNTY OF|BOROUGH OF|BORO OF|TOWNSHIP OF|TWP OF|COMMONWEALTH|UNITED STATES|AUTHORITY|REDEVELOPMENT|POST OFFICE|FIRE CO|FIRE COMPANY|FIRE DEPT|VOLUNTEER FIRE)\b/, "Government / public"],
        [/\b(HOSPITAL|CLINIC|MEDICAL|CEMETERY|FUNERAL|LODGE|VFW|AMERICAN LEGION|ELKS|MOOSE|BANK|HOTEL|MOTEL|RESTAURANT|NURSING|HEALTHCARE|HEALTH CARE)\b/, "Business / institution"]
    ];
    var COMPANY = /\b(INC|LLC|L L C|CORP|CORPORATION|COMPANY|CO|LP|LLP|LTD|PROPERTIES|ENTERPRISES|HOLDINGS|REALTY|PARTNERS|PARTNERSHIP|INVESTMENTS|GROUP|ASSOCIATES|ASSOCIATION|CLUB)\b/;

    function owners(upis) {
        var map = {};
        return sequence(inChunks("PIN", upis), function (where) {
            return queryAll(LAYER_PARCELS, { where: where, outFields: "PIN,owndat_own1,owndat_own2", returnGeometry: "false" });
        }).then(function (lists) {
            [].concat.apply([], lists).forEach(function (f) {
                var a = f.attributes;
                map[clean(a.PIN)] = (clean(a.owndat_own1) + " " + clean(a.owndat_own2)).trim();
            });
            return map;
        });
    }

    /* Sets each house's automatic tick and the reason shown beside it. A house found on two
       lines is ticked once: under its front street when that street is on the route (marked
       alley-backed when it also backs onto one of the route's alleys), otherwise where it was
       found first. */
    function classify(pull, ownerMap) {
        var perParcel = {}, alleyOf = {}, home = {};
        pull.lines.forEach(function (l) {
            (l.houses || []).forEach(function (h) {
                h.key = houseKey(h);
                if (h.upi) (perParcel[h.upi] = perParcel[h.upi] || {})[h.key] = true;
                if (l.mode === "alley" && h.front && !h.autoOff && !alleyOf[h.key]) alleyOf[h.key] = l.line;
                var onOwnStreet = l.mode !== "alley";
                if (!home[h.key] || (onOwnStreet && !home[h.key].own)) home[h.key] = { line: l, own: onOwnStreet };
            });
        });
        pull.lines.forEach(function (l) {
            (l.houses || []).forEach(function (h) {
                h.okey = lineKey(l.line) + "#" + h.key;
                h.owner = ownerMap[h.upi] || h.owner || "";
                h.alley = alleyOf[h.key] || "";
                var owner = h.owner.toUpperCase();
                var units = h.upi ? Object.keys(perParcel[h.upi]).length : 1;
                var auto = !h.autoOff;
                var why = h.flag || "";
                for (var i = 0; i < EXCLUDE.length; i++) {
                    if (EXCLUDE[i][0].test(owner)) { auto = false; why = EXCLUDE[i][1] + " (owner: " + titleCase(h.owner) + ")"; break; }
                }
                if (auto && units >= APARTMENT_UNITS) {
                    auto = false;
                    why = "Apartment building, " + units + " units on one parcel";
                } else if (auto && COMPANY.test(owner)) {
                    why = "Company-owned, check (owner: " + titleCase(h.owner) + ")";
                }
                // Counted on another line: shown here for reference only, never ticked twice
                h.elsewhere = home[h.key].line !== l ? home[h.key].line.line : "";
                if (h.elsewhere) auto = false;
                h.auto = auto;
                h.why = why;
            });
        });
    }

    // Ticks are kept per line, so a house's second listing can't be ticked along with its first
    function isKept(pull, h) {
        return Object.prototype.hasOwnProperty.call(pull.overrides, h.okey) ? pull.overrides[h.okey] : h.auto;
    }

    // Whether an alley-backed house puts its cans out in the alley: true, false, or not checked yet
    function alleyUse(pull, h) {
        var use = pull.alleyUse || {};
        return Object.prototype.hasOwnProperty.call(use, h.key) ? use[h.key] : null;
    }

    function summary(pull) {
        var kept = 0, total = 0;
        pull.lines.forEach(function (l) {
            (l.houses || []).forEach(function (h) {
                if (h.elsewhere) return;
                total++;
                if (isKept(pull, h)) kept++;
            });
        });
        return { kept: kept, total: total, pulled: pull.pulled };
    }

    /* ---------- Dialog ---------- */

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    var dialog = el("dialog", "send-dialog mt-dialog cp-dialog");
    dialog.setAttribute("aria-labelledby", "cp-title");
    dialog.innerHTML =
        '<div class="mt-dialog-head">' +
            '<h2 id="cp-title">County Houses</h2>' +
            '<button type="button" class="mt-dialog-close" aria-label="Close" data-dialog-close>&times;</button>' +
        "</div>" +
        '<div class="cp-body">' +
            '<p class="mt-count cp-status" role="status" aria-live="polite"></p>' +
            '<p class="mt-hint cp-sheet-note" hidden></p>' +
            '<div class="cp-list"></div>' +
            '<p class="mt-hint cp-source">House data: Washington County 911 address points and parcels, through PASDA. Verify before relying on it.</p>' +
        "</div>" +
        '<div class="form-actions mt-dialog-actions">' +
            '<button type="button" class="send-email cp-again">Pull Again</button>' +
            '<button type="button" class="generate-pdf cp-sheet">Spreadsheet</button>' +
        "</div>";
    document.body.appendChild(dialog);

    var statusEl = dialog.querySelector(".cp-status");
    var listEl = dialog.querySelector(".cp-list");
    var sheetNote = dialog.querySelector(".cp-sheet-note");
    var againBtn = dialog.querySelector(".cp-again");
    var sheetBtn = dialog.querySelector(".cp-sheet");
    var titleEl = dialog.querySelector("#cp-title");

    var current = null; // { route, pull, onSummary, busy }
    var cpDialog = TrackerDialog(dialog, { onClose: function () { if (current) current.closed = true; } });

    var saveTimer = null;
    function savePull() {
        if (!current || !current.pull) return;
        var c = current;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
            putRecord("pulls", c.pull).catch(function () {});
        }, 300);
        if (c.onSummary) c.onSummary(summary(c.pull));
        updateStatus();
    }

    function prettyDate(ms) {
        return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
    }

    function updateStatus() {
        if (!current || !current.pull || current.busy) return;
        var s = summary(current.pull);
        statusEl.textContent = s.kept + " house" + (s.kept === 1 ? "" : "s") + " ticked of " + s.total + " found. Pulled " + prettyDate(s.pulled) + ".";
    }

    // "40 of 42 ticked"; an alley also says how many lots have been checked for alley use
    function lineMeta(pull, l) {
        if (l.error) return (l.mode === "alley" ? "Alley \u00B7 " : "") + "Couldn't load";
        var own = (l.houses || []).filter(function (h) { return !h.elsewhere; });
        var kept = own.filter(function (h) { return isKept(pull, h); }).length;
        if (l.mode !== "alley") return kept + " of " + own.length + " ticked";
        var backing = (l.houses || []).filter(function (h) { return h.alley === l.line; });
        var uses = backing.filter(function (h) { return alleyUse(pull, h) === true; }).length;
        var open = backing.filter(function (h) { return alleyUse(pull, h) === null; }).length;
        return "Alley \u00B7 " + backing.length + " lots \u00B7 " + uses + " use it \u00B7 " + open + " not checked";
    }

    var ALLEY_STATES = [
        [null, "Alley use: not checked yet", ""],
        [true, "Puts cans in the alley", " is-yes"],
        [false, "Uses the front street", " is-no"]
    ];
    var alleyButtons = {}; // house key -> its buttons in every list it appears in, kept in step

    function alleyButton(pull, h, onChange) {
        var btn = el("button", "cp-alley-btn");
        btn.type = "button";
        function paint() {
            var state = alleyUse(pull, h);
            var row = ALLEY_STATES.filter(function (st) { return st[0] === state; })[0];
            btn.textContent = row[1].replace("the alley", h.alley);
            btn.className = "cp-alley-btn" + row[2];
            btn.setAttribute("aria-label", "Alley use for " + houseLabel(h, false) + ": " + btn.textContent + ". Tap to change.");
        }
        btn.addEventListener("click", function () {
            var states = ALLEY_STATES.map(function (st) { return st[0]; });
            var next = states[(states.indexOf(alleyUse(pull, h)) + 1) % states.length];
            pull.alleyUse = pull.alleyUse || {};
            if (next === null) delete pull.alleyUse[h.key];
            else pull.alleyUse[h.key] = next;
            (alleyButtons[h.key] || []).forEach(function (b) { b.paint(); });
            onChange();
            savePull();
        });
        btn.paint = paint;
        (alleyButtons[h.key] = alleyButtons[h.key] || []).push(btn);
        paint();
        return btn;
    }

    var lineMetas = []; // [line, element] for refreshing counts after a change

    function refreshMetas() {
        lineMetas.forEach(function (pair) { pair[1].textContent = lineMeta(current.pull, pair[0]); });
    }

    function renderList() {
        var pull = current.pull;
        listEl.textContent = "";
        alleyButtons = {};
        lineMetas = [];
        pull.lines.forEach(function (l, index) {
            if (l.address) return;
            var box = el("details", "cp-line" + (l.error ? " is-error" : ""));
            var sum = el("summary");
            sum.appendChild(el("span", "cp-line-name", l.line));
            var meta = el("span", "cp-line-meta", lineMeta(pull, l));
            lineMetas.push([l, meta]);
            sum.appendChild(meta);
            box.appendChild(sum);

            var built = false;
            box.addEventListener("toggle", function () {
                if (!box.open || built) return;
                built = true;
                if (l.note || l.error) box.appendChild(el("p", "cp-line-note" + (l.error ? " is-error" : ""), l.error || l.note));
                var ul = el("ul", "cp-houses");
                (l.houses || []).forEach(function (h) {
                    var li = el("li", "cp-house");
                    var text = el("span", "cp-house-text");
                    text.appendChild(el("span", "cp-house-addr", houseLabel(h, false)));
                    if (h.elsewhere) {
                        text.appendChild(el("span", "cp-house-where", "Counted under " + h.elsewhere));
                    } else if (h.alley && l.mode !== "alley") {
                        text.appendChild(el("span", "cp-house-where cp-house-alley", "Alley-backed: " + h.alley));
                    } else if (h.front && l.mode === "alley") {
                        text.appendChild(el("span", "cp-house-where", "Backs onto " + l.line));
                    }
                    if (h.why) text.appendChild(el("span", "cp-house-why", h.why));

                    if (h.elsewhere) {
                        // Reference row: the house is ticked (or not) on its own street's list
                        li.classList.add("is-ref");
                        var row = el("div", "cp-house-row");
                        row.appendChild(text);
                        li.appendChild(row);
                    } else {
                        var label = el("label", "cp-house-row");
                        var tick = document.createElement("input");
                        tick.type = "checkbox";
                        tick.checked = isKept(pull, h);
                        tick.addEventListener("change", function () {
                            if (tick.checked === h.auto) delete pull.overrides[h.okey];
                            else pull.overrides[h.okey] = tick.checked;
                            li.classList.toggle("is-off", !tick.checked);
                            refreshMetas();
                            savePull();
                        });
                        label.appendChild(tick);
                        label.appendChild(text);
                        li.appendChild(label);
                        if (!tick.checked) li.classList.add("is-off");
                    }
                    if (h.alley) li.appendChild(alleyButton(pull, h, refreshMetas));
                    ul.appendChild(li);
                });
                box.appendChild(ul);
                var flip = el("button", "mt-btn cp-flip", l.mode === "alley" ? "Look up as a street instead" : "Look up as an alley instead");
                flip.type = "button";
                flip.addEventListener("click", function () { relookLine(index, l.mode === "alley" ? "street" : "alley"); });
                box.appendChild(flip);
            });
            listEl.appendChild(box);
        });
        var addrs = pull.lines.filter(function (l) { return l.address; });
        if (addrs.length) {
            var found = addrs.filter(function (l) { return l.fill; }).length;
            listEl.appendChild(el("p", "mt-hint", addrs.length + " individual address" + (addrs.length === 1 ? "" : "es") +
                " on this route: " + found + " found in the county data for zip and coordinates."));
        }
        if (!pull.lines.length) listEl.appendChild(el("p", "mt-hint", "This route has no streets to look up."));
    }

    function townFor(route, line) {
        var c = route.cities && route.cities[lineKey(line)];
        return c || String(route.area || "").split("/")[0].trim();
    }

    function lookLine(route, l) {
        var town = townFor(route, l.line);
        if (l.address) {
            return lookupAddress(l.line, town).then(function (h) { l.fill = h; }).catch(function () { l.fill = null; });
        }
        return lookupStreet(l.line, town, l.forced).then(function (r) {
            l.mode = r.mode; l.note = r.note; l.houses = r.houses.sort(byStreetThenNumber); l.error = "";
        }).catch(function () {
            l.error = "Couldn't reach the county data for this street. Tap Pull Again to retry.";
            l.houses = [];
        });
    }

    function finishPull(c) {
        var upis = {};
        c.pull.lines.forEach(function (l) { (l.houses || []).forEach(function (h) { if (h.upi) upis[h.upi] = true; }); });
        statusEl.textContent = "Checking parcel owners…";
        return owners(Object.keys(upis)).catch(function () { return {}; }).then(function (map) {
            classify(c.pull, map);
            c.busy = false;
            setBusy(false);
            if (c.closed && c !== current) return;
            renderList();
            savePull();
        });
    }

    function relookLine(index, mode) {
        var c = current;
        var l = c.pull.lines[index];
        l.forced = mode;
        c.busy = true;
        setBusy(true);
        statusEl.textContent = "Looking up " + l.line + " as " + (mode === "alley" ? "an alley" : "a street") + "…";
        lookLine(c.route, l).then(function () { return finishPull(c); });
    }

    function setBusy(on) {
        againBtn.disabled = on;
        sheetBtn.disabled = on || !current || !current.pull;
    }

    function runPull(c) {
        if (navigator.onLine === false) {
            statusEl.textContent = "The tablet is offline. Pulling from the county needs a connection.";
            return;
        }
        var previous = c.pull;
        var forced = {};
        if (previous) previous.lines.forEach(function (l) { if (l.forced) forced[lineKey(l.line)] = l.forced; });
        var pull = {
            route: c.key, pulled: Date.now(), overrides: previous ? previous.overrides : {},
            alleyUse: previous && previous.alleyUse ? previous.alleyUse : {},
            lines: (c.route.streets || []).map(function (line) {
                return { line: line, address: isAddress(line), forced: forced[lineKey(line)] || "" };
            })
        };
        c.pull = pull;
        c.busy = true;
        setBusy(true);
        listEl.textContent = "";
        var done = 0;
        var queue = pull.lines.slice();
        function worker() {
            var l = queue.shift();
            if (!l) return Promise.resolve();
            return lookLine(c.route, l).then(function () {
                done++;
                statusEl.textContent = "Looking up " + done + " of " + pull.lines.length + " streets and addresses…";
                return worker();
            });
        }
        statusEl.textContent = "Looking up " + pull.lines.length + " streets and addresses…";
        // Three at a time keeps it quick without hammering the county's server
        Promise.all([worker(), worker(), worker()]).then(function () { return finishPull(c); });
    }

    /* ---------- Spreadsheet ---------- */

    var xlsxPromise = null;
    function loadXlsx() {
        if (window.XLSX) return Promise.resolve(window.XLSX);
        if (!xlsxPromise) {
            xlsxPromise = new Promise(function (resolve, reject) {
                var script = document.createElement("script");
                script.src = "xlsx.mini.min.js";
                script.onload = function () { resolve(window.XLSX); };
                script.onerror = function () { xlsxPromise = null; reject(new Error("Spreadsheet writer failed to load")); };
                document.head.appendChild(script);
            });
        }
        return xlsxPromise;
    }

    function findCol(header, pattern, fallback) {
        for (var i = 0; i < header.length; i++) if (pattern.test(String(header[i] || ""))) return i;
        return fallback;
    }

    // Header cells that belong to one account or stop, so a new house row leaves them blank
    var PER_STOP = /\b(id|account|acct|record|seq|sequence|stop|customer|name)\b/i;

    function buildRows(route, sheet, pull) {
        var header, data;
        if (sheet && sheet.rows && sheet.rows.length) {
            header = sheet.rows[0].slice();
            data = sheet.rows.slice(1);
        } else {
            header = ["", "", "", "", "Site Address", "Site Address 2", "City", "State", "Zip", "", "", "Site Latitude", "Site Longitude"];
            data = (route.streets || []).map(function (line) {
                var row = ["", "", "", "", line, "", (route.cities && route.cities[lineKey(line)]) || "", "PA", ""];
                return row;
            });
        }
        var lat = findCol(header, /lat/i, COL.lat), lon = findCol(header, /lon/i, COL.lon);
        if (blank(header[lat])) header[lat] = "Site Latitude";
        if (blank(header[lon])) header[lon] = "Site Longitude";
        var width = Math.max(header.length, lat + 1, lon + 1);
        // Collection Point goes after the sheet's last column, so no existing column moves
        var point = findCol(header, /collection point/i, -1);
        if (point < 0) point = width;
        while (header.length < point) header.push("");
        header[point] = "Collection Point";
        width = Math.max(width, point + 1);
        var byLine = {};
        pull.lines.forEach(function (l) { byLine[lineKey(l.line)] = l; });
        var out = [header];
        var used = {}, written = {};

        function fit(row) {
            row = row.slice();
            while (row.length < width) row.push("");
            return row;
        }

        data.forEach(function (row) {
            row = fit(row);
            var line = clean(row[COL.address]);
            var l = line && byLine[lineKey(line)];
            if (l && l.address && l.fill) {
                if (blank(row[lat])) row[lat] = l.fill.lat;
                if (blank(row[lon])) row[lon] = l.fill.lon;
                if (blank(row[COL.zip])) row[COL.zip] = l.fill.zip;
            }
            out.push(row);
            if (!l || l.address || used[lineKey(line)]) return;
            used[lineKey(line)] = true;
            (l.houses || []).filter(function (h) { return isKept(pull, h) && !written[h.key]; }).forEach(function (h) {
                written[h.key] = true;
                var add = row.map(function (v, i) { return PER_STOP.test(String(header[i] || "")) ? "" : v; });
                add[COL.address] = houseLabel(h, true);
                add[COL.line2] = h.unit ? (/^[A-Za-z]/.test(h.unit) && /\s/.test(h.unit) ? titleCase(h.unit) : "Unit " + h.unit) : "";
                add[COL.city] = titleCase(row[COL.city]) || h.city;
                add[COL.state] = "PA";
                add[COL.zip] = h.zip;
                add[lat] = h.lat;
                add[lon] = h.lon;
                var use = h.alley ? alleyUse(pull, h) : false;
                add[point] = use === true ? "Alley: " + h.alley : use === null ? "Alley-backed: " + h.alley + " (not checked)" : "";
                out.push(add);
            });
        });
        return out;
    }

    function sheetName(route, sheet) {
        var base = sheet && sheet.fileName ? sheet.fileName.replace(/\.xlsx$/i, "")
            : [route.route, route.driver].filter(Boolean).join(" ");
        return base.replace(/\s*\(houses\)$/i, "") + " (houses).xlsx";
    }

    function writeSheet() {
        var c = current;
        if (!c || !c.pull) return;
        sheetBtn.disabled = true;
        var oldText = sheetBtn.textContent;
        sheetBtn.textContent = "Building…";
        Promise.all([loadXlsx(), getRecord("sheets", c.key).catch(function () { return null; })]).then(function (both) {
            var XLSX = both[0], sheet = both[1];
            var rows = buildRows(c.route, sheet, c.pull);
            var wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Route " + String(c.route.route).slice(0, 24));
            var bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
            var name = sheetName(c.route, sheet);
            var file = new File([bytes], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

            var url = URL.createObjectURL(file);
            var link = document.createElement("a");
            link.href = url;
            link.download = name;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 10000);

            statusEl.textContent = "Saved " + name + " (" + (rows.length - 1) + " rows) to the tablet's Downloads.";
            // The share sheet is a separate app, so Back always returns here
            try {
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    navigator.share({ files: [file], title: name }).catch(function () {});
                }
            } catch (e) { /* sharing isn't available; the download is enough */ }
        }).catch(function () {
            statusEl.textContent = "Couldn't build the spreadsheet. Check the connection once, then try again.";
        }).then(function () {
            sheetBtn.textContent = oldText;
            sheetBtn.disabled = false;
        });
    }

    againBtn.addEventListener("click", function () { if (current && !current.busy) runPull(current); });
    sheetBtn.addEventListener("click", writeSheet);

    function open(route, onSummary) {
        var key = String(route.route).toLowerCase();
        var c = { route: route, key: key, pull: null, onSummary: onSummary, busy: false };
        current = c;
        titleEl.textContent = "Route " + route.route + " Houses";
        listEl.textContent = "";
        sheetNote.hidden = true;
        statusEl.textContent = "Loading…";
        setBusy(true);
        cpDialog.open();

        getRecord("sheets", key).catch(function () { return null; }).then(function (sheet) {
            if (c !== current) return;
            if (!sheet) {
                sheetNote.textContent = "Route IQ doesn't have this route's original spreadsheet yet, so the export will only have the address, city, state, zip and location columns. Import the route's .xlsx again once (its service day and notes are kept) to carry every column through.";
                sheetNote.hidden = false;
            }
            return getRecord("pulls", key).catch(function () { return null; });
        }).then(function (saved) {
            if (c !== current) return;
            if (saved && saved.lines) {
                c.pull = saved;
                setBusy(false);
                renderList();
                updateStatus();
            } else {
                runPull(c);
            }
        });
    }

    window.CountyPull = {
        open: open,
        saveSheet: function (routeKey, sheet) {
            return putRecord("sheets", { route: String(routeKey).toLowerCase(), fileName: sheet.fileName, rows: sheet.rows, saved: Date.now() });
        },
        // For tests and the console
        _parseStreet: parseStreet,
        _titleCase: titleCase
    };
})();
