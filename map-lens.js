/* Map Lens (map-lens.html), under Routing in the menu: clean route maps for driver
   handouts, traced by hand from the GPS breadcrumbs.

   The routes and their map files come from the library (map-library.js, assets/Maps/). Each
   sheet is a blank Google Maps print (PDF, 11x17 landscape) plus a screenshot of the GPS
   tracking system's breadcrumbs for the same area.

   Line Up: tap the same spots (intersections) on the breadcrumbs and on the blank map, two or
   more pairs. Both are north-up web maps, so a scale + shift (with a little rotation allowed)
   fits one onto the other; with three or more pairs it's a least-squares fit and the app can
   say when the points disagree.

   Trace: the black trail is lifted out of the screenshot (everything else in it, the GPS map,
   pins and labels, is dropped) and laid over the blank map, either whole or only inside a
   lens circle that follows the pen. Highlighter strokes go on a layer of their own, drawn
   opaque and shown multiplied at partial strength, so a street gone over twice doesn't darken.
   Yellow is the basic route street; blue and green mean whatever the legend on that sheet says.

   Everything is kept in page points (the PDF's 1224 x 792 pt page, top-left origin), so a trace
   lines up with its map however it's shown or printed.

   Traces in progress are drafts in localStorage (fleetMgrMapLens, so they're in backups). Publish
   saves the sheet's .trace.json; once that file is committed to assets/Maps/ and the app updates,
   every device has it. A draft is dropped as soon as the library holds a trace at least as new.

   Print Map builds the handout: one 11x17 landscape page per sheet, minimum margins, a slim
   house-format header (Earthwise logo, route, driver, day) and a legend only when blue or green
   is used. It opens in the app's PDF viewer and is kept in Saved PDFs, like the route sheets. */
(function () {
    "use strict";

    var DRAFTS_KEY = "fleetMgrMapLens";
    var SHEETS_KEY = "fleetMgrRouteStreets";
    var SCREEN_SCALE = 2;   // canvas pixels per point on screen
    var PRINT_SCALE = 3;    // ~216 dpi across the 16.5" print width
    var COLORS = { y: "#FFE500", b: "#1E90FF", g: "#22C55E" };
    var COLOR_NAMES = { y: "Yellow", b: "Blue", g: "Green" };
    var INK_ALPHA = 0.55;
    var TRAIL_RGB = [220, 20, 60];
    var LENS_RADIUS = 90;   // screen pixels
    var MIN_STEP = 1.5;     // points between recorded pen positions
    var ERASE_RADIUS = 6;   // points, beyond the stroke's own half width

    var lib = window.MapLibrary;
    var listEl = document.getElementById("ml-list");
    var countEl = document.getElementById("ml-count");
    var searchEl = document.getElementById("ml-search");
    var storageWarning = document.getElementById("ml-storage-warning");

    /* ---------- Helpers ---------- */

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function pad(n) {
        return (n < 10 ? "0" : "") + n;
    }

    function dateString(d) {
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }

    function sheetLabel(entry, index) {
        return entry.sheets.length > 1 ? "Sheet " + (index + 1) : "Map";
    }

    // Driver and day for the handout header come from the route's card on Route Sheets
    function routeSheet(route) {
        try {
            var list = JSON.parse(localStorage.getItem(SHEETS_KEY) || "[]");
            var key = String(route).toLowerCase();
            return (Array.isArray(list) ? list : []).filter(function (r) {
                return r && String(r.route || "").toLowerCase() === key;
            })[0] || null;
        } catch (e) {
            return null;
        }
    }

    /* ---------- Drafts and published traces ---------- */

    function loadDrafts() {
        try {
            var data = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}");
            return data && typeof data === "object" && !Array.isArray(data) ? data : {};
        } catch (e) {
            return {};
        }
    }

    function saveDraft(sheet, trace) {
        var all = loadDrafts();
        if (trace) all[sheet] = trace;
        else delete all[sheet];
        try {
            localStorage.setItem(DRAFTS_KEY, JSON.stringify(all));
            storageWarning.hidden = true;
            return true;
        } catch (e) {
            storageWarning.hidden = false;
            return false;
        }
    }

    function validTrace(t) {
        return t && typeof t === "object" && Array.isArray(t.strokes) ? t : null;
    }

    var libTraces = {};
    function libraryTrace(sheet) {
        if (!libTraces[sheet]) {
            libTraces[sheet] = fetch(lib.traceUrl(sheet), { cache: "no-cache" })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(validTrace)
                .catch(function () { return null; });
        }
        return libTraces[sheet];
    }

    // The sheet's library trace and local draft; a draft the library has caught up with is dropped
    function current(sheet) {
        return libraryTrace(sheet).then(function (published) {
            var draft = validTrace(loadDrafts()[sheet]);
            if (draft && published && (published.updated || 0) >= (draft.updated || 0)) {
                saveDraft(sheet, null);
                draft = null;
            }
            return { lib: published, draft: draft, trace: draft || published };
        });
    }

    function statusText(state) {
        if (state.draft && state.draft.published) return "Published, waiting for the app update";
        if (state.draft) return "Draft on this device";
        if (state.lib && state.lib.strokes.length) return "Traced";
        return "Not traced";
    }

    /* ---------- Loading the maps ---------- */

    var pdfLib = null;
    function loadPdfLibrary() {
        if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
        if (!pdfLib) {
            pdfLib = new Promise(function (resolve, reject) {
                var script = document.createElement("script");
                script.src = "pdf.min.js";
                script.onload = function () {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
                    resolve(window.pdfjsLib);
                };
                script.onerror = function () {
                    pdfLib = null;
                    reject(new Error("PDF library failed to load"));
                };
                document.head.appendChild(script);
            });
        }
        return pdfLib;
    }

    function renderPage(sheet, scale) {
        return Promise.all([loadPdfLibrary(), fetch(lib.mapUrl(sheet)).then(function (r) {
            if (!r.ok) throw new Error("Map not found: " + sheet);
            return r.arrayBuffer();
        })]).then(function (parts) {
            return parts[0].getDocument({ data: new Uint8Array(parts[1]) }).promise;
        }).then(function (doc) {
            return doc.getPage(1).then(function (page) {
                var viewport = page.getViewport({ scale: scale });
                var canvas = document.createElement("canvas");
                canvas.width = Math.round(viewport.width);
                canvas.height = Math.round(viewport.height);
                var ctx = canvas.getContext("2d");
                ctx.fillStyle = "#fff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
                    var size = page.getViewport({ scale: 1 });
                    doc.destroy();
                    return { canvas: canvas, pageW: size.width, pageH: size.height };
                });
            });
        });
    }

    // The map itself, without the Google header above it or the white band below: the longest
    // run of rows (then columns) that are mostly not white
    function detectCrop(canvas, scale, pageW, pageH) {
        var w = canvas.width, h = canvas.height;
        var data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
        function inked(x, y) {
            var i = (y * w + x) * 4;
            return data[i] < 248 || data[i + 1] < 248 || data[i + 2] < 248;
        }
        function longestRun(n, test) {
            var best = [0, -1], start = -1;
            for (var i = 0; i <= n; i++) {
                if (i < n && test(i)) {
                    if (start < 0) start = i;
                } else if (start >= 0) {
                    if (i - 1 - start > best[1] - best[0]) best = [start, i - 1];
                    start = -1;
                }
            }
            return best;
        }
        var rows = longestRun(h, function (y) {
            var hit = 0, total = 0;
            for (var x = 0; x < w; x += 4, total++) if (inked(x, y)) hit++;
            return hit / total > 0.6;
        });
        var fallback = { x: 0, y: pageH * 0.0625, w: pageW, h: pageH * 0.7345 };
        if (rows[1] - rows[0] < h * 0.3) return fallback;
        var cols = longestRun(w, function (x) {
            var hit = 0, total = 0;
            for (var y = rows[0]; y <= rows[1]; y += 4, total++) if (inked(x, y)) hit++;
            return hit / total > 0.6;
        });
        if (cols[1] - cols[0] < w * 0.3) return fallback;
        // One point in from each edge keeps antialiased borders out
        var x0 = cols[0] / scale + 1, y0 = rows[0] / scale + 1;
        return { x: x0, y: y0, w: (cols[1] + 1) / scale - 1 - x0, h: (rows[1] + 1) / scale - 1 - y0 };
    }

    function cropCanvas(full, crop, scale) {
        var c = document.createElement("canvas");
        c.width = Math.round(crop.w * scale);
        c.height = Math.round(crop.h * scale);
        c.getContext("2d").drawImage(full, -crop.x * scale, -crop.y * scale);
        return c;
    }

    var maps = {};
    function screenMap(sheet) {
        if (!maps[sheet]) {
            maps[sheet] = renderPage(sheet, SCREEN_SCALE).then(function (page) {
                var crop = detectCrop(page.canvas, SCREEN_SCALE, page.pageW, page.pageH);
                var canvas = cropCanvas(page.canvas, crop, SCREEN_SCALE);
                page.canvas.width = 0;
                return { canvas: canvas, crop: crop };
            });
            maps[sheet].catch(function () { delete maps[sheet]; });
        }
        return maps[sheet];
    }

    // The trail is the near-black, colorless pixels; the GPS map, pins and labels are colored or gray
    function extractTrail(img) {
        var c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        var ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        var image = ctx.getImageData(0, 0, c.width, c.height);
        var p = image.data;
        for (var i = 0; i < p.length; i += 4) {
            var max = Math.max(p[i], p[i + 1], p[i + 2]);
            var min = Math.min(p[i], p[i + 1], p[i + 2]);
            if (p[i + 3] && max < 50 && max - min < 28) {
                var strength = max <= 35 ? 1 : (50 - max) / 15;
                p[i] = TRAIL_RGB[0];
                p[i + 1] = TRAIL_RGB[1];
                p[i + 2] = TRAIL_RGB[2];
                p[i + 3] = Math.round(p[i + 3] * strength);
            } else {
                p[i + 3] = 0;
            }
        }
        dropSpecks(p, c.width, c.height, 24);
        ctx.putImageData(image, 0, 0);
        return c;
    }

    // The trail is long and connected; the GPS app's own dark bits (the date box's calendar icon
    // and digits) are small islands. Clears every connected patch smaller than `size` pixels across.
    function dropSpecks(p, w, h, size) {
        var seen = new Uint8Array(w * h);
        var stack = new Int32Array(w * h);
        for (var start = 0; start < w * h; start++) {
            if (seen[start] || !p[start * 4 + 3]) continue;
            var top = 0, count = 0;
            var minX = w, maxX = 0, minY = h, maxY = 0;
            stack[top++] = start;
            seen[start] = 1;
            var members = [];
            while (top) {
                var i = stack[--top], x = i % w, y = (i - x) / w;
                members.push(i);
                count++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                for (var dy = -1; dy <= 1; dy++) {
                    for (var dx = -1; dx <= 1; dx++) {
                        var nx = x + dx, ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                        var n = ny * w + nx;
                        if (!seen[n] && p[n * 4 + 3]) {
                            seen[n] = 1;
                            stack[top++] = n;
                        }
                    }
                }
            }
            if (maxX - minX < size && maxY - minY < size) {
                for (var k = 0; k < count; k++) p[members[k] * 4 + 3] = 0;
            }
        }
    }

    var crumbs = {};
    function loadCrumbs(sheet) {
        if (!crumbs[sheet]) {
            crumbs[sheet] = new Promise(function (resolve, reject) {
                var img = new Image();
                img.onload = function () { resolve({ img: img, trail: extractTrail(img) }); };
                img.onerror = function () { reject(new Error("Breadcrumbs not found: " + sheet)); };
                img.src = lib.crumbsUrl(sheet);
            });
            crumbs[sheet].catch(function () { delete crumbs[sheet]; });
        }
        return crumbs[sheet];
    }

    /* ---------- Lining up ---------- */

    // Least-squares similarity (scale, rotation, shift) taking breadcrumb pixels to page points:
    //   X = a x - b y + e,  Y = b x + a y + f
    function fitAlignment(align) {
        var src = align.crumbs, dst = align.map, n = Math.min(src.length, dst.length);
        if (n < 2) return null;
        var A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], B = [0, 0, 0, 0];
        function add(row, v) {
            for (var i = 0; i < 4; i++) {
                for (var j = 0; j < 4; j++) A[i][j] += row[i] * row[j];
                B[i] += row[i] * v;
            }
        }
        for (var k = 0; k < n; k++) {
            add([src[k][0], -src[k][1], 1, 0], dst[k][0]);
            add([src[k][1], src[k][0], 0, 1], dst[k][1]);
        }
        var s = solve(A, B);
        if (!s) return null;
        var t = { a: s[0], b: s[1], e: s[2], f: s[3] };
        var sum = 0;
        for (k = 0; k < n; k++) {
            var p = applyFit(t, src[k]);
            sum += Math.pow(p[0] - dst[k][0], 2) + Math.pow(p[1] - dst[k][1], 2);
        }
        t.rms = Math.sqrt(sum / n);
        t.points = n;
        return t;
    }

    function applyFit(t, pt) {
        return [t.a * pt[0] - t.b * pt[1] + t.e, t.b * pt[0] + t.a * pt[1] + t.f];
    }

    // Gaussian elimination with partial pivoting
    function solve(A, B) {
        var n = B.length, M = A.map(function (row, i) { return row.concat([B[i]]); });
        for (var c = 0; c < n; c++) {
            var pivot = c;
            for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
            if (Math.abs(M[pivot][c]) < 1e-9) return null;
            var tmp = M[c]; M[c] = M[pivot]; M[pivot] = tmp;
            for (r = 0; r < n; r++) {
                if (r === c) continue;
                var f = M[r][c] / M[c][c];
                for (var k = c; k <= n; k++) M[r][k] -= f * M[c][k];
            }
        }
        return M.map(function (row, i) { return row[n] / row[i]; });
    }

    /* ---------- Drawing ---------- */

    // Strokes are flat [x0, y0, x1, y1, ...] lists in page points; smoothed through the midpoints
    function strokePath(ctx, p) {
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        if (p.length === 2) {
            ctx.lineTo(p[0] + 0.01, p[1]);
            return;
        }
        for (var i = 2; i < p.length - 2; i += 2) {
            ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
        }
        ctx.lineTo(p[p.length - 2], p[p.length - 1]);
    }

    function drawStrokes(ctx, strokes, crop, scale) {
        ctx.save();
        ctx.setTransform(scale, 0, 0, scale, -crop.x * scale, -crop.y * scale);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        strokes.forEach(function (s) {
            ctx.strokeStyle = COLORS[s.c] || COLORS.y;
            ctx.lineWidth = s.w;
            strokePath(ctx, s.p);
            ctx.stroke();
        });
        ctx.restore();
    }

    function drawTrail(ctx, trail, fit, crop, scale) {
        ctx.save();
        ctx.setTransform(scale, 0, 0, scale, -crop.x * scale, -crop.y * scale);
        ctx.transform(fit.a, fit.b, -fit.b, fit.a, fit.e, fit.f);
        ctx.drawImage(trail, 0, 0);
        ctx.restore();
    }

    function distToSegment(px, py, ax, ay, bx, by) {
        var dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
        var t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
        var x = ax + t * dx - px, y = ay + t * dy - py;
        return Math.sqrt(x * x + y * y);
    }

    function strokeHit(s, x, y) {
        var r = s.w / 2 + ERASE_RADIUS, p = s.p;
        if (p.length === 2) return Math.hypot(p[0] - x, p[1] - y) <= r;
        for (var i = 0; i < p.length - 2; i += 2) {
            if (distToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= r) return true;
        }
        return false;
    }

    /* ---------- Pan / zoom viewport ---------- */
    /* One finger draws (draw mode) or pans; two fingers always pan and pinch-zoom, and a second
       finger landing cancels the stroke the first one started. A mouse wheel zooms. Content
       units are the stage's own CSS pixels (page points for the map, image pixels for the
       breadcrumbs). */
    function Viewport(box, stage, handlers) {
        var vp = this;
        vp.box = box;
        vp.stage = stage;
        vp.handlers = handlers || {};
        vp.mode = "pan";
        vp.w = 1;
        vp.h = 1;
        vp.z = 1;
        vp.tx = 0;
        vp.ty = 0;
        vp.fitZ = 1;

        var pointers = {};
        var drawingId = null;
        var pan = null;
        var pinch = null;

        function count() { return Object.keys(pointers).length; }
        function local(e) {
            var r = box.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        }

        function startPinch() {
            var ids = Object.keys(pointers);
            var a = pointers[ids[0]], b = pointers[ids[1]];
            pinch = {
                dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
                cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
                z: vp.z, tx: vp.tx, ty: vp.ty
            };
        }

        box.addEventListener("pointerdown", function (e) {
            if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
            try { box.setPointerCapture(e.pointerId); } catch (err) { /* already gone */ }
            pointers[e.pointerId] = local(e);
            var n = count();
            if (n === 1) {
                var p = pointers[e.pointerId];
                if (vp.mode === "draw" && e.button === 0) {
                    drawingId = e.pointerId;
                    if (vp.handlers.onDraw) vp.handlers.onDraw("start", vp.toContent(p));
                    pan = null;
                } else {
                    pan = { id: e.pointerId, x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false };
                }
            } else if (n === 2) {
                if (drawingId != null) {
                    if (vp.handlers.onDraw) vp.handlers.onDraw("cancel");
                    drawingId = null;
                }
                pan = null;
                startPinch();
            }
            e.preventDefault();
        });

        box.addEventListener("pointermove", function (e) {
            var p = local(e);
            if (!pointers[e.pointerId]) {
                if (vp.handlers.onHover) vp.handlers.onHover(vp.toContent(p));
                return;
            }
            pointers[e.pointerId] = p;
            if (pinch && count() >= 2) {
                var ids = Object.keys(pointers);
                var a = pointers[ids[0]], b = pointers[ids[1]];
                var dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
                var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
                var z = vp.clampZoom(pinch.z * dist / pinch.dist);
                var contentX = (pinch.cx - pinch.tx) / pinch.z, contentY = (pinch.cy - pinch.ty) / pinch.z;
                vp.z = z;
                vp.tx = cx - contentX * z;
                vp.ty = cy - contentY * z;
                vp.apply();
            } else if (drawingId === e.pointerId) {
                var events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
                if (!events.length) events = [e];
                events.forEach(function (ce) {
                    var cp = vp.toContent(local(ce));
                    if (vp.handlers.onDraw) vp.handlers.onDraw("move", cp);
                    if (vp.handlers.onHover) vp.handlers.onHover(cp);
                });
            } else if (pan && pan.id === e.pointerId) {
                vp.tx += p.x - pan.x;
                vp.ty += p.y - pan.y;
                pan.x = p.x;
                pan.y = p.y;
                if (Math.hypot(p.x - pan.sx, p.y - pan.sy) > 8) pan.moved = true;
                vp.apply();
            }
        });

        function end(e) {
            if (!pointers[e.pointerId]) return;
            var p = pointers[e.pointerId];
            delete pointers[e.pointerId];
            if (drawingId === e.pointerId) {
                drawingId = null;
                if (vp.handlers.onDraw) vp.handlers.onDraw(e.type === "pointercancel" ? "cancel" : "end");
            } else if (pan && pan.id === e.pointerId) {
                if (!pan.moved && e.type === "pointerup" && vp.handlers.onTap) vp.handlers.onTap(vp.toContent(p));
                pan = null;
            }
            if (count() < 2) pinch = null;
            // Lifting one finger of a pinch leaves the other panning, never drawing
            if (count() === 1) {
                var id = Object.keys(pointers)[0];
                pan = { id: Number(id), x: pointers[id].x, y: pointers[id].y, sx: 0, sy: 0, moved: true };
            }
        }
        box.addEventListener("pointerup", end);
        box.addEventListener("pointercancel", end);

        box.addEventListener("wheel", function (e) {
            e.preventDefault();
            var p = local(e);
            vp.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
        }, { passive: false });

        // When the box changes size (a tool row appears, the tablet turns) the same spot stays
        // in the middle at the same zoom
        if (window.ResizeObserver) {
            new ResizeObserver(function () {
                var bw = box.clientWidth, bh = box.clientHeight, last = vp.size;
                if (!bw || !bh) return;
                if (last && (last.w !== bw || last.h !== bh)) {
                    vp.tx += (bw - last.w) / 2;
                    vp.ty += (bh - last.h) / 2;
                    vp.fitZ = Math.min(bw / vp.w, bh / vp.h);
                    vp.apply();
                }
                vp.size = { w: bw, h: bh };
            }).observe(box);
        }
    }

    Viewport.prototype.setContent = function (w, h) {
        this.w = w;
        this.h = h;
        this.stage.style.width = w + "px";
        this.stage.style.height = h + "px";
        this.fit();
    };

    Viewport.prototype.fit = function () {
        var bw = this.box.clientWidth, bh = this.box.clientHeight;
        if (!bw || !bh) return;
        this.fitZ = Math.min(bw / this.w, bh / this.h);
        this.size = { w: bw, h: bh };
        this.z = this.fitZ;
        this.tx = (bw - this.w * this.z) / 2;
        this.ty = (bh - this.h * this.z) / 2;
        this.apply();
    };

    Viewport.prototype.clampZoom = function (z) {
        return Math.max(this.fitZ * 0.75, Math.min(this.fitZ * 12, z));
    };

    Viewport.prototype.zoomAt = function (x, y, factor) {
        var z = this.clampZoom(this.z * factor);
        var cx = (x - this.tx) / this.z, cy = (y - this.ty) / this.z;
        this.z = z;
        this.tx = x - cx * z;
        this.ty = y - cy * z;
        this.apply();
    };

    Viewport.prototype.toContent = function (p) {
        return { x: (p.x - this.tx) / this.z, y: (p.y - this.ty) / this.z };
    };

    Viewport.prototype.apply = function () {
        // Keep at least a quarter of the content on screen
        var bw = this.box.clientWidth, bh = this.box.clientHeight;
        var cw = this.w * this.z, ch = this.h * this.z;
        this.tx = Math.min(bw - Math.min(cw, bw) / 4, Math.max(Math.min(cw, bw) / 4 - cw, this.tx));
        this.ty = Math.min(bh - Math.min(ch, bh) / 4, Math.max(Math.min(ch, bh) / 4 - ch, this.ty));
        this.stage.style.transform = "translate(" + this.tx + "px, " + this.ty + "px) scale(" + this.z + ")";
        if (this.handlers.onChange) this.handlers.onChange();
    };

    /* ---------- Editor ---------- */

    var dialog = document.getElementById("ml-editor");
    var titleEl = document.getElementById("ml-title");
    var statusEl = document.getElementById("ml-status");
    var loadingEl = document.getElementById("ml-loading");
    var viewTools = document.getElementById("ml-view-tools");
    var traceTools = document.getElementById("ml-trace-tools");
    var alignTools = document.getElementById("ml-align-tools");
    var alignHelp = document.getElementById("ml-align-help");
    var alignDone = document.getElementById("ml-align-done");
    var alignCancel = document.getElementById("ml-align-cancel");
    var legendRow = document.getElementById("ml-legend-row");
    var legendLabel = document.getElementById("ml-legend-label");
    var legendInput = document.getElementById("ml-legend-input");
    var undoBtn = document.getElementById("ml-undo");
    var redoBtn = document.getElementById("ml-redo");
    var opacityEl = document.getElementById("ml-opacity");
    var crumbsPane = document.getElementById("ml-crumbs-pane");
    var crumbsStage = document.getElementById("ml-crumbs-stage");
    var mapLabel = document.getElementById("ml-map-label");
    var mapStage = document.getElementById("ml-map-stage");
    var baseCanvas = document.getElementById("ml-base");
    var trailCanvas = document.getElementById("ml-trail");
    var inkCanvas = document.getElementById("ml-ink");
    var lensRing = document.getElementById("ml-lens-ring");

    var ed = null;           // the open sheet
    var openToken = 0;
    var saveTimer = null;
    var pushedHistory = false;

    var mapVp = new Viewport(document.getElementById("ml-map-vp"), mapStage, {
        onDraw: onDraw,
        onTap: function (p) { if (ed && ed.mode === "align") alignTap("map", p); },
        onHover: function (p) { if (ed) moveLens(p); },
        onChange: function () { updateLens(); updatePins(); }
    });
    var crumbsVp = new Viewport(document.getElementById("ml-crumbs-vp"), crumbsStage, {
        onTap: function (p) { if (ed && ed.mode === "align") alignTap("crumbs", p); },
        onChange: updatePins
    });

    function newTrace(sheet) {
        return { sheet: sheet, updated: 0, align: null, legend: { b: "", g: "" }, strokes: [] };
    }

    function clone(t) {
        return JSON.parse(JSON.stringify(t));
    }

    function setStatus(text) {
        statusEl.textContent = text;
    }

    function openSheet(entry, index) {
        var sheet = entry.sheets[index];
        var token = ++openToken;
        ed = null;
        titleEl.textContent = "Route " + entry.route + (entry.sheets.length > 1 ? " · Sheet " + (index + 1) + " of " + entry.sheets.length : "");
        setStatus("");
        showTools(null);
        loadingEl.textContent = "Loading map…";
        loadingEl.hidden = false;
        mapStage.hidden = true;
        crumbsPane.hidden = true;
        if (!dialog.open) {
            dialog.showModal();
            history.pushState({ mapLens: true }, "");
            pushedHistory = true;
        }

        Promise.all([current(sheet), screenMap(sheet), loadCrumbs(sheet)]).then(function (parts) {
            if (token !== openToken || !dialog.open) return;
            var state = parts[0], map = parts[1];
            ed = {
                entry: entry, index: index, sheet: sheet, state: state,
                map: map, crumbs: parts[2],
                trace: state.trace ? clone(state.trace) : newTrace(sheet),
                editing: false, mode: "view", tool: "y", width: 7,
                trail: "off", opacity: Number(opacityEl.value) / 100,
                lens: { x: map.crop.x + map.crop.w / 2, y: map.crop.y + map.crop.h / 2 },
                stroke: null, erased: null, undo: [], redo: []
            };
            ed.fit = ed.trace.align ? fitAlignment(ed.trace.align) : null;

            [baseCanvas, trailCanvas, inkCanvas].forEach(function (c) {
                c.width = map.canvas.width;
                c.height = map.canvas.height;
            });
            baseCanvas.getContext("2d").drawImage(map.canvas, 0, 0);
            crumbsStage.textContent = "";
            ed.crumbsImg = el("img", "ml-crumbs-img");
            ed.crumbsImg.src = ed.crumbs.img.src;
            ed.crumbsImg.alt = "GPS breadcrumbs for " + sheet;
            crumbsStage.appendChild(ed.crumbsImg);

            loadingEl.hidden = true;
            mapStage.hidden = false;
            redrawTrail();
            redrawInk();
            // A draft is someone's tracing in progress: straight back into it
            if (state.draft) startEditing();
            else setMode("view");
            refreshStatus();
        }).catch(function (err) {
            if (token !== openToken) return;
            console.error(err);
            loadingEl.textContent = "This map couldn't be loaded. Check the connection and try again.";
        });
    }

    function refreshStatus() {
        if (!ed) return;
        // Opening the published trace for editing isn't a draft until something changes
        var libUpdated = (ed.state.lib || {}).updated || 0;
        var draft = ed.editing && ed.trace.updated > libUpdated ? ed.trace : ed.state.draft;
        var text = statusText({ lib: ed.state.lib, draft: draft });
        if (ed.mode === "align") text = "Lining up the GPS trail";
        setStatus(text);
    }

    function showTools(mode) {
        viewTools.hidden = mode !== "view";
        traceTools.hidden = mode !== "trace";
        alignTools.hidden = mode !== "align";
        legendRow.hidden = !(mode === "trace" && (ed.tool === "b" || ed.tool === "g"));
    }

    function setMode(mode) {
        ed.mode = mode;
        showTools(mode);
        var aligning = mode === "align";
        crumbsPane.hidden = !aligning;
        mapLabel.hidden = !aligning;
        dialog.classList.toggle("is-aligning", aligning);
        inkCanvas.hidden = aligning;
        mapVp.mode = mode === "trace" && ed.tool !== "move" ? "draw" : "pan";
        if (mode === "view") ed.trail = "off";
        if (aligning) beginAlign();
        syncPressed();
        // Layout changed (the breadcrumbs pane came or went): refit both
        requestAnimationFrame(function () {
            if (!ed) return;
            mapVp.setContent(ed.map.crop.w, ed.map.crop.h);
            if (aligning) crumbsVp.setContent(ed.crumbs.img.naturalWidth, ed.crumbs.img.naturalHeight);
            applyTrailView();
            refreshStatus();
        });
    }

    function syncPressed() {
        dialog.querySelectorAll("[data-tool]").forEach(function (b) {
            b.setAttribute("aria-pressed", String(b.getAttribute("data-tool") === ed.tool));
        });
        dialog.querySelectorAll("[data-width]").forEach(function (b) {
            b.setAttribute("aria-pressed", String(Number(b.getAttribute("data-width")) === ed.width));
        });
        dialog.querySelectorAll("[data-trail]").forEach(function (b) {
            b.setAttribute("aria-pressed", String(b.getAttribute("data-trail") === ed.trail));
        });
        undoBtn.disabled = !ed.undo.length;
        redoBtn.disabled = !ed.redo.length;
        if (ed.tool === "b" || ed.tool === "g") {
            legendLabel.textContent = COLOR_NAMES[ed.tool] + " means";
            legendInput.value = (ed.trace.legend || {})[ed.tool] || "";
        }
    }

    function startEditing() {
        if (!ed) return;
        if (!ed.editing) {
            ed.editing = true;
            ed.trace = clone(ed.state.draft || ed.state.lib || newTrace(ed.sheet));
            ed.trace.legend = ed.trace.legend || { b: "", g: "" };
            ed.fit = ed.trace.align ? fitAlignment(ed.trace.align) : null;
        }
        ed.trail = "lens";
        if (!ed.fit) setMode("align");
        else setMode("trace");
    }

    function changed() {
        ed.trace.updated = Date.now();
        delete ed.trace.published;
        clearTimeout(saveTimer);
        var sheet = ed.sheet, trace = ed.trace;
        saveTimer = setTimeout(function () { saveTimer = null; saveDraft(sheet, trace); }, 400);
        refreshStatus();
    }

    function flushSave() {
        if (saveTimer && ed) {
            clearTimeout(saveTimer);
            saveTimer = null;
            saveDraft(ed.sheet, ed.trace);
        }
    }

    /* Trail and lens */

    function redrawTrail() {
        var ctx = trailCanvas.getContext("2d");
        ctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
        if (ed.fit) drawTrail(ctx, ed.crumbs.trail, ed.fit, ed.map.crop, SCREEN_SCALE);
    }

    function applyTrailView() {
        var show = ed.fit && ed.mode !== "align" && ed.trail !== "off";
        trailCanvas.hidden = !show;
        trailCanvas.style.opacity = String(ed.opacity);
        lensRing.hidden = !(show && ed.trail === "lens");
        updateLens();
    }

    function moveLens(p) {
        ed.lens = { x: p.x + ed.map.crop.x, y: p.y + ed.map.crop.y };
        updateLens();
    }

    function updateLens() {
        if (!ed) return;
        if (ed.trail !== "lens" || trailCanvas.hidden) {
            trailCanvas.style.clipPath = "";
            return;
        }
        var x = ed.lens.x - ed.map.crop.x, y = ed.lens.y - ed.map.crop.y, r = LENS_RADIUS / mapVp.z;
        trailCanvas.style.clipPath = "circle(" + r + "px at " + x + "px " + y + "px)";
        lensRing.style.width = lensRing.style.height = LENS_RADIUS * 2 + "px";
        lensRing.style.transform = "translate(" + (mapVp.tx + x * mapVp.z - LENS_RADIUS) + "px, " +
            (mapVp.ty + y * mapVp.z - LENS_RADIUS) + "px)";
    }

    /* Ink */

    function redrawInk() {
        var ctx = inkCanvas.getContext("2d");
        ctx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
        drawStrokes(ctx, ed.trace.strokes, ed.map.crop, SCREEN_SCALE);
    }

    function pushUndo() {
        ed.undo.push(ed.trace.strokes.slice());
        if (ed.undo.length > 100) ed.undo.shift();
        ed.redo = [];
    }

    function onDraw(phase, p) {
        if (!ed || ed.mode !== "trace") return;
        var x = p ? Math.round((p.x + ed.map.crop.x) * 2) / 2 : 0;
        var y = p ? Math.round((p.y + ed.map.crop.y) * 2) / 2 : 0;

        if (ed.tool === "erase") {
            if (phase === "start") ed.erased = ed.trace.strokes.slice();
            if (phase === "start" || phase === "move") {
                var before = ed.trace.strokes.length;
                ed.trace.strokes = ed.trace.strokes.filter(function (s) { return !strokeHit(s, x, y); });
                if (ed.trace.strokes.length !== before) redrawInk();
            } else if (phase === "end" || phase === "cancel") {
                if (ed.erased && ed.erased.length !== ed.trace.strokes.length) {
                    ed.undo.push(ed.erased);
                    ed.redo = [];
                    changed();
                }
                ed.erased = null;
                syncPressed();
            }
            return;
        }

        if (phase === "start") {
            ed.stroke = { c: ed.tool, w: ed.width, p: [x, y] };
            drawSegment(x, y, x + 0.01, y);
        } else if (phase === "move" && ed.stroke) {
            var pts = ed.stroke.p, lx = pts[pts.length - 2], ly = pts[pts.length - 1];
            if (Math.hypot(x - lx, y - ly) < MIN_STEP) return;
            pts.push(x, y);
            drawSegment(lx, ly, x, y);
        } else if (phase === "end" && ed.stroke) {
            pushUndo();
            ed.trace.strokes.push(ed.stroke);
            ed.stroke = null;
            redrawInk();
            changed();
            syncPressed();
        } else if (phase === "cancel") {
            ed.stroke = null;
            redrawInk();
        }
    }

    // While drawing, only the newest piece is added; the whole layer is redrawn smoothed at the end
    function drawSegment(x0, y0, x1, y1) {
        var ctx = inkCanvas.getContext("2d"), crop = ed.map.crop;
        ctx.save();
        ctx.setTransform(SCREEN_SCALE, 0, 0, SCREEN_SCALE, -crop.x * SCREEN_SCALE, -crop.y * SCREEN_SCALE);
        ctx.strokeStyle = COLORS[ed.stroke.c];
        ctx.lineWidth = ed.stroke.w;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.restore();
    }

    function undoRedo(from, to) {
        if (!ed || !from.length) return;
        to.push(ed.trace.strokes.slice());
        ed.trace.strokes = from.pop();
        redrawInk();
        changed();
        syncPressed();
    }

    /* Line Up */

    var pending = null; // breadcrumb point waiting for its map partner

    function beginAlign() {
        ed.alignBefore = ed.trace.align ? clone(ed.trace.align) : null;
        ed.alignWork = ed.trace.align ? clone(ed.trace.align) : { crumbs: [], map: [] };
        pending = null;
        alignCancel.hidden = !ed.alignBefore;
        drawPins();
        alignStep();
    }

    function alignStep() {
        var w = ed.alignWork, n = w.map.length;
        var fit = fitAlignment(w);
        alignDone.disabled = n < 2;
        var text;
        if (pending) {
            text = "Now tap the same spot on the blank map.";
        } else if (n === 0) {
            text = "Tap a spot you can find on both maps, like an intersection, on the GPS breadcrumbs first.";
        } else if (n === 1) {
            text = "Point 1 matched. Tap a second spot, far from the first, on the breadcrumbs.";
        } else {
            text = n + " points matched. ";
            if (n >= 3 && fit && fit.rms > 6) text += "These points don't agree well. Check them, or Undo Point and try again.";
            else text += n === 2 ? "Add a third far from the others for a better fit, or tap Done." : "Tap Done, or add more points.";
        }
        alignHelp.textContent = text;
    }

    function alignTap(where, p) {
        var w = ed.alignWork;
        if (where === "crumbs") {
            pending = [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
        } else {
            if (!pending) {
                alignHelp.textContent = "Tap the spot on the GPS breadcrumbs first, then here.";
                return;
            }
            w.crumbs.push(pending);
            w.map.push([Math.round((p.x + ed.map.crop.x) * 10) / 10, Math.round((p.y + ed.map.crop.y) * 10) / 10]);
            pending = null;
        }
        drawPins();
        alignStep();
    }

    function pin(stage, n, x, y, waiting) {
        var d = el("div", "ml-pin" + (waiting ? " is-waiting" : ""), String(n));
        d.style.left = x + "px";
        d.style.top = y + "px";
        stage.appendChild(d);
    }

    function drawPins() {
        mapStage.querySelectorAll(".ml-pin").forEach(function (d) { d.remove(); });
        crumbsStage.querySelectorAll(".ml-pin").forEach(function (d) { d.remove(); });
        if (!ed || ed.mode !== "align") return;
        var w = ed.alignWork;
        w.crumbs.forEach(function (c, i) {
            pin(crumbsStage, i + 1, c[0], c[1]);
            pin(mapStage, i + 1, w.map[i][0] - ed.map.crop.x, w.map[i][1] - ed.map.crop.y);
        });
        if (pending) pin(crumbsStage, w.crumbs.length + 1, pending[0], pending[1], true);
        updatePins();
    }

    // Pins stay the same size on screen at any zoom
    function updatePins() {
        [[mapStage, mapVp], [crumbsStage, crumbsVp]].forEach(function (pair) {
            pair[0].querySelectorAll(".ml-pin").forEach(function (d) {
                d.style.transform = "translate(-50%, -50%) scale(" + (1 / pair[1].z) + ")";
            });
        });
    }

    document.getElementById("ml-align-undo").addEventListener("click", function () {
        if (pending) pending = null;
        else {
            ed.alignWork.crumbs.pop();
            ed.alignWork.map.pop();
        }
        drawPins();
        alignStep();
    });

    document.getElementById("ml-align-clear").addEventListener("click", function () {
        ed.alignWork = { crumbs: [], map: [] };
        pending = null;
        drawPins();
        alignStep();
    });

    alignCancel.addEventListener("click", function () {
        pending = null;
        ed.mode = "trace";
        drawPins();
        setMode("trace");
    });

    alignDone.addEventListener("click", function () {
        var fit = fitAlignment(ed.alignWork);
        if (!fit) return;
        ed.trace.align = ed.alignWork;
        ed.fit = fit;
        pending = null;
        ed.mode = "trace";
        drawPins();
        redrawTrail();
        ed.trail = "full";
        changed();
        setMode("trace");
        setTimeout(function () {
            if (ed && ed.mode === "trace") setStatus("Lined up. Check that the trail sits on the streets; Line Up again if not.");
        }, 50);
    });

    /* Toolbar */

    dialog.querySelectorAll("[data-tool]").forEach(function (b) {
        b.addEventListener("click", function () {
            ed.tool = b.getAttribute("data-tool");
            mapVp.mode = ed.tool === "move" ? "pan" : "draw";
            showTools("trace");
            syncPressed();
        });
    });

    dialog.querySelectorAll("[data-width]").forEach(function (b) {
        b.addEventListener("click", function () {
            ed.width = Number(b.getAttribute("data-width"));
            if (ed.tool === "erase" || ed.tool === "move") ed.tool = "y";
            mapVp.mode = "draw";
            showTools("trace");
            syncPressed();
        });
    });

    dialog.querySelectorAll("[data-trail]").forEach(function (b) {
        b.addEventListener("click", function () {
            if (!ed) return;
            ed.trail = b.getAttribute("data-trail");
            if (ed.trail !== "off" && !ed.fit) {
                setStatus("This sheet hasn't been lined up yet, so there's no trail to show.");
                ed.trail = "off";
            }
            syncPressed();
            applyTrailView();
        });
    });

    dialog.querySelectorAll("[data-fit]").forEach(function (b) {
        b.addEventListener("click", function () { if (ed) mapVp.fit(); });
    });

    opacityEl.addEventListener("input", function () {
        if (!ed) return;
        ed.opacity = Number(opacityEl.value) / 100;
        if (ed.trail === "off" && ed.fit) ed.trail = "lens";
        syncPressed();
        applyTrailView();
    });

    legendInput.addEventListener("input", function () {
        if (!ed || (ed.tool !== "b" && ed.tool !== "g")) return;
        ed.trace.legend = ed.trace.legend || { b: "", g: "" };
        ed.trace.legend[ed.tool] = legendInput.value.trim();
        changed();
    });

    undoBtn.addEventListener("click", function () { if (ed) undoRedo(ed.undo, ed.redo); });
    redoBtn.addEventListener("click", function () { if (ed) undoRedo(ed.redo, ed.undo); });
    document.getElementById("ml-edit").addEventListener("click", startEditing);
    document.getElementById("ml-realign").addEventListener("click", function () { if (ed) setMode("align"); });

    // Ctrl+Z / Ctrl+Y with a keyboard
    dialog.addEventListener("keydown", function (e) {
        if (!ed || ed.mode !== "trace" || !(e.ctrlKey || e.metaKey) || e.target === legendInput) return;
        var k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) undoRedo(ed.undo, ed.redo);
        else if (k === "y" || (k === "z" && e.shiftKey)) undoRedo(ed.redo, ed.undo);
        else return;
        e.preventDefault();
    });

    /* Close */

    function closeEditor() {
        if (dialog.open) dialog.close();
    }

    document.getElementById("ml-close").addEventListener("click", closeEditor);

    dialog.addEventListener("close", function () {
        openToken++;
        flushSave();
        // An editor opened and closed without a change leaves no draft behind
        ed = null;
        pending = null;
        if (pushedHistory) {
            pushedHistory = false;
            history.back();
        }
        renderList();
    });

    // Android Back closes the editor instead of leaving the page
    window.addEventListener("popstate", function () {
        if (pushedHistory && dialog.open) {
            pushedHistory = false;
            dialog.close();
        }
    });

    /* ---------- Publish ---------- */

    var publishDialogEl = document.getElementById("ml-publish-dialog");
    var publishDialog = window.TrackerDialog ? TrackerDialog(publishDialogEl, {}) : null;

    // One stroke per line keeps the committed file readable and its diffs small
    function traceFileText(t) {
        var legend = { b: (t.legend || {}).b || "", g: (t.legend || {}).g || "" };
        var lines = t.strokes.map(function (s) { return "    " + JSON.stringify({ c: s.c, w: s.w, p: s.p }); });
        return "{\n" +
            '  "sheet": ' + JSON.stringify(t.sheet) + ",\n" +
            '  "updated": ' + t.updated + ",\n" +
            '  "align": ' + JSON.stringify(t.align) + ",\n" +
            '  "legend": ' + JSON.stringify(legend) + ",\n" +
            '  "strokes": [\n' + lines.join(",\n") + (lines.length ? "\n" : "") + "  ]\n}\n";
    }

    function shareFile(file) {
        var top = window;
        try { if (window.top.navigator) top = window.top; } catch (e) { /* not inside the app */ }
        try {
            if (top.navigator.canShare && top.navigator.canShare({ files: [file] })) {
                return top.navigator.share({ files: [file], title: file.name }).catch(function () {});
            }
        } catch (e) { /* fall through to a download */ }
        var url = URL.createObjectURL(file);
        var link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        return Promise.resolve();
    }

    document.getElementById("ml-publish").addEventListener("click", function () {
        if (!ed) return;
        if (!ed.trace.strokes.length) {
            setStatus("Nothing traced on this sheet yet.");
            return;
        }
        document.getElementById("ml-publish-file").textContent = ed.sheet + ".trace.json";
        if (publishDialog) publishDialog.open();
        else publishDialogEl.showModal();
    });

    document.getElementById("ml-publish-go").addEventListener("click", function () {
        if (!ed) return;
        clearTimeout(saveTimer);
        saveTimer = null;
        ed.trace.updated = Date.now();
        var file = new File([traceFileText(ed.trace)], ed.sheet + ".trace.json", { type: "application/json" });
        ed.trace.published = true;
        saveDraft(ed.sheet, ed.trace);
        if (publishDialog) publishDialog.close();
        else publishDialogEl.close();
        refreshStatus();
        renderList();
        shareFile(file);
    });

    /* ---------- Print Map ---------- */

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

    // The sheet as printed: the map, with the highlighter layer multiplied over it
    function printImage(sheet, trace) {
        return Promise.all([renderPage(sheet, PRINT_SCALE), screenMap(sheet)]).then(function (parts) {
            var page = parts[0], crop = parts[1].crop;
            var out = cropCanvas(page.canvas, crop, PRINT_SCALE);
            page.canvas.width = 0;
            if (trace && trace.strokes.length) {
                var ink = document.createElement("canvas");
                ink.width = out.width;
                ink.height = out.height;
                drawStrokes(ink.getContext("2d"), trace.strokes, crop, PRINT_SCALE);
                var ctx = out.getContext("2d");
                ctx.globalAlpha = INK_ALPHA;
                ctx.globalCompositeOperation = "multiply";
                ctx.drawImage(ink, 0, 0);
                ink.width = 0;
            }
            var data = out.toDataURL("image/jpeg", 0.9);
            var size = { w: out.width, h: out.height };
            out.width = 0;
            return { data: data, w: size.w, h: size.h };
        });
    }

    function buildHandout(entry, sheets, logo) {
        var NAVY = [4, 57, 96], GREEN = [4, 102, 53], GRAY = [110, 118, 126], INK = [26, 26, 26];
        var PAGE_W = 1224, PAGE_H = 792, M = 18;
        var CONTENT_W = PAGE_W - M * 2;
        var LOGO = 40;
        var info = routeSheet(entry.route) || {};

        var doc = new window.jspdf.jsPDF({ unit: "pt", format: "tabloid", orientation: "landscape" });
        function color(fn, c) { doc[fn](c[0], c[1], c[2]); }

        sheets.forEach(function (s, i) {
            if (i > 0) doc.addPage("tabloid", "landscape");
            var y = M;

            // Slim header: route and sheet on the left, driver and day after it, logo at the right
            if (logo) doc.addImage(logo, "PNG", PAGE_W - M - LOGO, y - 4, LOGO, LOGO);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(18);
            color("setTextColor", NAVY);
            var title = "Route " + entry.route + " Map" + (sheets.length > 1 ? "  ·  Sheet " + (i + 1) + " of " + sheets.length : "");
            doc.text(title, M, y + 16);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            color("setTextColor", GRAY);
            var meta = [info.driver ? "Driver: " + info.driver : "", info.day ? "Service day: " + info.day : "",
                "Earthwise Environmental Solutions"].filter(Boolean).join("   ·   ");
            doc.text(meta, M, y + 30);
            y += 38;
            color("setFillColor", GREEN);
            doc.rect(M, y, CONTENT_W, 2.5, "F");
            y += 7;

            // The map, as wide as the page allows. The blank maps are wider than 11x17, so the
            // room left over is split above and below it.
            var h = CONTENT_W * s.image.h / s.image.w;
            var legend = legendItems(s.trace);
            var legendH = legend.length ? 22 : 0;
            var room = PAGE_H - M - y - 14 - legendH;
            var w = CONTENT_W;
            if (h > room) {
                w = CONTENT_W * room / h;
                h = room;
            }
            y += (room - h) / 2;
            doc.addImage(s.image.data, "JPEG", M + (CONTENT_W - w) / 2, y, w, h);
            y += h + 8;

            if (legend.length) {
                var x = M;
                doc.setFontSize(10);
                legend.forEach(function (item) {
                    var rgb = hexToRgb(COLORS[item.c]);
                    // The swatch as it prints: the highlighter over white at the same strength
                    doc.setFillColor.apply(doc, rgb.map(function (v) { return Math.round(255 - (255 - v) * INK_ALPHA); }));
                    doc.roundedRect(x, y, 28, 10, 2, 2, "F");
                    color("setTextColor", INK);
                    doc.setFont("helvetica", "bold");
                    doc.text(item.label, x + 34, y + 8.5);
                    x += 34 + doc.getTextWidth(item.label) + 24;
                });
                y += 22;
            }

            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            color("setTextColor", GRAY);
            doc.text("Map data © Google  ·  Printed " + new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
                M, PAGE_H - M + 4);
            doc.text("Route " + entry.route + "  ·  Page " + (i + 1) + " of " + sheets.length, PAGE_W - M, PAGE_H - M + 4, { align: "right" });
        });
        return doc;
    }

    // Shown only when blue or green is on the sheet; yellow is then listed as the route streets
    function legendItems(trace) {
        if (!trace) return [];
        var used = {};
        trace.strokes.forEach(function (s) { used[s.c] = true; });
        if (!used.b && !used.g) return [];
        var legend = trace.legend || {};
        var items = [];
        if (used.y) items.push({ c: "y", label: "Route streets" });
        if (used.b) items.push({ c: "b", label: legend.b || "Blue" });
        if (used.g) items.push({ c: "g", label: legend.g || "Green" });
        return items;
    }

    function hexToRgb(hex) {
        var n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function printRoute(entry, button) {
        if (!window.jspdf) {
            alert("The PDF library did not load. Reload the page and try again.");
            return;
        }
        var label = button.textContent;
        button.disabled = true;
        button.textContent = "Preparing…";
        var sheets = [];
        // One sheet at a time keeps only one big page image in memory
        entry.sheets.reduce(function (chain, sheet) {
            return chain.then(function () {
                return current(sheet).then(function (state) {
                    return printImage(sheet, state.trace).then(function (image) {
                        sheets.push({ trace: state.trace, image: image });
                    });
                });
            });
        }, Promise.resolve()).then(function () {
            return logoPromise;
        }).then(function (logo) {
            var doc = buildHandout(entry, sheets, logo);
            var name = ("Route " + entry.route + " Map - " + dateString(new Date()) + ".pdf").replace(/[\\/:*?"<>|]/g, "");
            var file = new File([doc.output("blob")], name, { type: "application/pdf" });
            if (window.PdfStore) window.PdfStore.add(file.name, file).catch(function () {});
            var viewer = null;
            try { viewer = window.top.PdfViewer; } catch (e) { /* not inside the app */ }
            if (viewer) viewer.open(file);
            else doc.save(file.name);
        }).catch(function (err) {
            console.error(err);
            alert("Sorry, the route map could not be created.");
        }).then(function () {
            button.disabled = false;
            button.textContent = label;
        });
    }

    /* ---------- Route list ---------- */

    var renderToken = 0;

    function renderList() {
        var token = ++renderToken;
        var term = searchEl.value.trim().toLowerCase();
        var routes = lib.routes.filter(function (entry) {
            if (!term) return true;
            var info = routeSheet(entry.route) || {};
            return [entry.route, "route " + entry.route, info.driver, info.day, info.area].join("\n").toLowerCase().indexOf(term) !== -1;
        });
        listEl.textContent = "";
        routes.forEach(function (entry) { listEl.appendChild(buildCard(entry, token)); });
        countEl.textContent = !lib.routes.length ? "No route maps in the library yet."
            : !routes.length ? "No route matches “" + searchEl.value.trim() + "”."
            : routes.length + " route map" + (routes.length === 1 ? "" : "s") + ".";
    }

    function buildCard(entry, token) {
        var info = routeSheet(entry.route);
        var card = el("article", "mt-entry ml-card");
        card.id = "ml-route-" + entry.route.replace(/[^A-Za-z0-9-]/g, "_");
        var head = el("div", "mt-entry-head");
        head.appendChild(el("h3", "mt-entry-address", "Route " + entry.route));
        card.appendChild(head);
        card.appendChild(el("p", "mt-entry-meta", info
            ? [info.driver, info.day, info.area].filter(Boolean).join(" · ") || "On Route Sheets"
            : "Not on Route Sheets yet, so the handout won't show a driver or day."));

        var chips = el("div", "mt-chips");
        card.appendChild(chips);
        var traced = 0;
        entry.sheets.forEach(function (sheet, i) {
            var chip = el("span", "mt-chip", sheetLabel(entry, i) + ": …");
            chips.appendChild(chip);
            current(sheet).then(function (state) {
                if (token !== renderToken) return;
                chip.textContent = sheetLabel(entry, i) + ": " + statusText(state);
                if (state.trace && state.trace.strokes.length) {
                    traced++;
                    chip.classList.add(state.draft ? "ml-chip-draft" : "ml-chip-done");
                }
                if (traced) card.classList.add("ml-card-traced");
            });
        });

        var actions = el("div", "mt-entry-actions");
        entry.sheets.forEach(function (sheet, i) {
            var b = el("button", "mt-btn", entry.sheets.length > 1 ? "Open Sheet " + (i + 1) : "Open Map");
            b.type = "button";
            b.addEventListener("click", function () { openSheet(entry, i); });
            actions.appendChild(b);
        });
        var print = el("button", "mt-btn", "Print Map");
        print.type = "button";
        print.setAttribute("aria-label", "Print the map for route " + entry.route);
        print.addEventListener("click", function () { printRoute(entry, print); });
        actions.appendChild(print);
        card.appendChild(actions);
        return card;
    }

    searchEl.addEventListener("input", renderList);

    // Opened from a route's card on Route Sheets: map-lens.html?route=M-2-4
    function showRoute(query) {
        var m = /[?&]route=([^&]*)/.exec(query || "");
        if (!m) return;
        var entry = lib.find(decodeURIComponent(m[1]));
        if (!entry) return;
        searchEl.value = "";
        renderList();
        var card = document.getElementById("ml-route-" + entry.route.replace(/[^A-Za-z0-9-]/g, "_"));
        if (card) card.scrollIntoView({ block: "start" });
        openSheet(entry, 0);
    }

    window.addEventListener("routeiq-open", function (e) { showRoute(String(e.detail || "").replace(/^[^?]*/, "")); });
    window.addEventListener("storage", function (e) { if (e.key === SHEETS_KEY && !dialog.open) renderList(); });

    renderList();
    showRoute(location.search);
})();
