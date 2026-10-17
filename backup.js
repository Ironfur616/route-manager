/* Backup & Restore, in Settings (the gear in the app header). Everything Route IQ keeps lives
   only in this browser on this device until Firestore is set up, so this is the safety net.

   Back Up Now builds one .json file holding all of it: every localStorage entry (the trackers,
   Route Sheets, Service, recycle calendar, settings), the county house lists (house-store.js)
   and, if ticked, the saved PDFs (pdf-store.js), then asks where it goes: Google Drive (the
   share sheet, where Drive's upload screen lets you pick the folder, or email) or this
   tablet's Downloads. Only a copy off the tablet protects against its storage being cleared.

   Restore reads a backup file, picked here or shared to Route IQ from Drive/Files (sw.js sends
   shared .json files to index.html?restore-shared=1), and shows what's in it before changing
   anything:
     Add what's missing (default)  keeps everything on the tablet; entries from the backup that
                                   aren't here are added (matched by id; routes also by name)
     Replace everything            the tablet's data becomes the backup's (needs a tick to confirm)
   Either way the tablet's data is first kept as a snapshot ("routeiq-safety" IndexedDB), so
   Undo last restore can put it back. The app reloads after a restore.

   A reminder bar at the bottom of the app offers a backup once 7 days have passed since the
   last one (or when there's data and there's never been one); Later hides it for a day.
   Loaded only by the shell (index.html), after settings.js. */
(function () {
    "use strict";

    var settings = document.querySelector(".settings-dialog");
    var settingsBody = settings && settings.querySelector(".settings-body");
    if (!settingsBody || !window.TrackerDialog) return;

    var INFO_KEY = "fleetMgrBackupInfo";
    // Every github.io project of this account shares one origin, so only Route IQ's own
    // entries (all named fleetMgr...) are backed up or replaced. Not data: the session's
    // sign-in hint and the backup bookkeeping itself.
    var PREFIX = "fleetMgr";
    var SKIP = { fleetMgrUnlocked: true, fleetMgrBackupInfo: true };

    function ours(key) {
        return !!key && key.indexOf(PREFIX) === 0 && !SKIP[key];
    }
    var REMIND_DAYS = 7;
    var DAY = 86400000;
    var FORMAT = "routeiq-backup";

    // What the preview counts, in the order it lists them
    var COUNTED = [
        ["fleetMgrMissed", "Missed collections"],
        ["fleetMgrNewCustomers", "New customers"],
        ["fleetMgrBulkPickup", "Bulk pickup requests"],
        ["fleetMgrRCA", "RCA cases"],
        ["fleetMgrServiceCustomers", "Handicap & Elderly customers"],
        ["fleetMgrServiceLog", "Service log entries"],
        ["fleetMgrRouteStreets", "Routes (Route Sheets)"]
    ];

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function pad(n) {
        return n < 10 ? "0" + n : String(n);
    }

    function prettyStamp(ms) {
        return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
    }

    function ago(ms) {
        var days = Math.floor((Date.now() - ms) / DAY);
        return days <= 0 ? "today" : days === 1 ? "yesterday" : days + " days ago";
    }

    function prettySize(bytes) {
        return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
    }

    function readInfo() {
        try { return JSON.parse(localStorage.getItem(INFO_KEY) || "{}") || {}; } catch (e) { return {}; }
    }

    function writeInfo(patch) {
        var info = readInfo();
        Object.keys(patch).forEach(function (k) { info[k] = patch[k]; });
        try { localStorage.setItem(INFO_KEY, JSON.stringify(info)); } catch (e) { /* storage full or blocked */ }
    }

    /* ---------- Gathering ---------- */

    function localData() {
        var out = {};
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (ours(k)) out[k] = localStorage.getItem(k);
        }
        return out;
    }

    function blobToBase64(blob) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(String(reader.result).replace(/^data:[^,]*,/, "")); };
            reader.onerror = function () { reject(reader.error); };
            reader.readAsDataURL(blob);
        });
    }

    function base64ToBlob(text, type) {
        var bin = atob(text);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: type || "application/pdf" });
    }

    function houseData() {
        if (!window.HouseStore) return Promise.resolve({});
        var out = {};
        return Promise.all(HouseStore.STORES.map(function (name) {
            return HouseStore.all(name).then(function (rows) { out[name] = rows; }).catch(function () { out[name] = []; });
        })).then(function () { return out; });
    }

    function pdfData() {
        if (!window.PdfStore) return Promise.resolve([]);
        return PdfStore.all().catch(function () { return []; }).then(function (rows) {
            return Promise.all(rows.map(function (r) {
                return blobToBase64(r.blob).then(function (data) {
                    return { id: r.id, name: r.name, created: r.created, size: r.size, data: data };
                });
            }));
        });
    }

    function collect(withPdfs) {
        return Promise.all([houseData(), withPdfs ? pdfData() : Promise.resolve(null)]).then(function (both) {
            var backup = { format: FORMAT, version: 1, app: "Earthwise Route IQ", created: Date.now(),
                localStorage: localData(), houses: both[0] };
            if (both[1]) backup.pdfs = both[1];
            return backup;
        });
    }

    function pdfTotal() {
        if (!window.PdfStore) return Promise.resolve({ count: 0, bytes: 0 });
        return PdfStore.list().then(function (rows) {
            return { count: rows.length, bytes: rows.reduce(function (n, r) { return n + (r.size || 0); }, 0) };
        }).catch(function () { return { count: 0, bytes: 0 }; });
    }

    /* ---------- Counting (for the preview) ---------- */

    function listLength(raw) {
        try {
            var v = JSON.parse(raw);
            return Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0;
        } catch (e) {
            return 0;
        }
    }

    function counts(local, houses, pdfCount) {
        var rows = COUNTED.map(function (c) { return [c[1], local[c[0]] ? listLength(local[c[0]]) : 0]; });
        rows.push(["County house lists", ((houses && houses.pulls) || []).length]);
        rows.push(["Saved PDFs", pdfCount]);
        return rows;
    }

    function hasData() {
        return COUNTED.some(function (c) {
            try { return listLength(localStorage.getItem(c[0]) || "[]") > 0; } catch (e) { return false; }
        });
    }

    /* ---------- Writing back ---------- */

    function sameJson(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    // Lists of records: add the backup's records that aren't here (by id, and for routes by
    // route name too); plain lists: add values not already in them; objects: add missing keys.
    // Anything already on the tablet wins.
    function mergeValue(key, currentRaw, backupRaw) {
        var cur, bak;
        try { cur = JSON.parse(currentRaw); bak = JSON.parse(backupRaw); } catch (e) { return currentRaw; }
        if (Array.isArray(cur) && Array.isArray(bak)) {
            var ids = {}, names = {}, seen = {};
            cur.forEach(function (x) {
                if (x && x.id != null) ids[x.id] = true;
                if (key === "fleetMgrRouteStreets" && x && x.route) names[String(x.route).toLowerCase()] = true;
                seen[JSON.stringify(x)] = true;
            });
            var added = bak.filter(function (x) {
                if (x && x.id != null) {
                    if (ids[x.id]) return false;
                    if (key === "fleetMgrRouteStreets" && x.route && names[String(x.route).toLowerCase()]) return false;
                    return true;
                }
                return !seen[JSON.stringify(x)];
            });
            return added.length ? JSON.stringify(cur.concat(added)) : currentRaw;
        }
        if (cur && bak && typeof cur === "object" && typeof bak === "object" && !Array.isArray(cur) && !Array.isArray(bak)) {
            var out = {};
            Object.keys(cur).forEach(function (k) { out[k] = cur[k]; });
            Object.keys(bak).forEach(function (k) { if (!(k in out)) out[k] = bak[k]; });
            return sameJson(out, cur) ? currentRaw : JSON.stringify(out);
        }
        return currentRaw;
    }

    function applyLocal(local, mode) {
        if (mode === "replace") {
            var keys = [];
            for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
            keys.forEach(function (k) { if (ours(k)) localStorage.removeItem(k); });
        }
        Object.keys(local || {}).forEach(function (k) {
            if (!ours(k)) return;
            var current = localStorage.getItem(k);
            var value = mode === "replace" || current == null ? local[k] : mergeValue(k, current, local[k]);
            if (value !== current) localStorage.setItem(k, value);
        });
    }

    function applyHouses(houses, mode) {
        if (!window.HouseStore || !houses) return Promise.resolve();
        return Promise.all(HouseStore.STORES.map(function (name) {
            var rows = houses[name] || [];
            var start = mode === "replace" ? HouseStore.clear(name) : Promise.resolve();
            return start.then(function () { return HouseStore.all(name); }).then(function (existing) {
                var have = {};
                existing.forEach(function (r) { have[r.route] = true; });
                return Promise.all(rows.filter(function (r) { return !have[r.route]; }).map(function (r) {
                    return HouseStore.put(name, r);
                }));
            });
        }));
    }

    function applyPdfs(pdfs, mode) {
        // A backup made without PDFs leaves the tablet's PDFs alone, even when replacing
        if (!window.PdfStore || !pdfs) return Promise.resolve();
        var start = mode === "replace" ? PdfStore.clear() : Promise.resolve();
        return start.then(function () { return PdfStore.all(); }).then(function (existing) {
            var have = {};
            existing.forEach(function (r) { have[r.id] = true; });
            return Promise.all(pdfs.filter(function (r) { return !have[r.id]; }).map(function (r) {
                return PdfStore.putRecord({ id: r.id, name: r.name, created: r.created, size: r.size, blob: base64ToBlob(r.data) });
            }));
        });
    }

    function apply(backup, mode) {
        return Promise.resolve().then(function () {
            applyLocal(backup.localStorage, mode);
            return applyHouses(backup.houses, mode);
        }).then(function () {
            return applyPdfs(backup.pdfs, mode);
        });
    }

    /* ---------- Safety snapshot (for Undo last restore) ---------- */

    var safetyDb = null;
    function safety(mode, fn) {
        if (!safetyDb) {
            safetyDb = new Promise(function (resolve, reject) {
                if (!window.indexedDB) return reject(new Error("IndexedDB unavailable"));
                var req = indexedDB.open("routeiq-safety", 1);
                req.onupgradeneeded = function () { req.result.createObjectStore("snapshots", { keyPath: "id" }); };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
            safetyDb.catch(function () { safetyDb = null; });
        }
        return safetyDb.then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction("snapshots", mode);
                var req = fn(tx.objectStore("snapshots"));
                tx.oncomplete = function () { resolve(req ? req.result : undefined); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function saveSnapshot() {
        return collect(true).then(function (snap) {
            snap.id = "before-restore";
            return safety("readwrite", function (s) { s.put(snap); });
        });
    }

    function getSnapshot() {
        return safety("readonly", function (s) { return s.get("before-restore"); }).catch(function () { return null; });
    }

    /* ---------- Settings section ---------- */

    var group = el("fieldset", "settings-group backup-group");
    group.innerHTML =
        "<legend>Backup</legend>" +
        '<p class="backup-last" aria-live="polite"></p>' +
        '<p class="mt-hint backup-help">Everything in Route IQ is kept only on this tablet. Back up regularly and send the file to Google Drive or email, so a copy lives somewhere else.</p>' +
        '<label class="backup-pdfs"><input type="checkbox" class="backup-pdfs-box" checked> <span class="backup-pdfs-text">Include saved PDFs</span></label>' +
        '<div class="backup-actions">' +
            '<button type="button" class="generate-pdf backup-now">Back Up Now</button>' +
            '<button type="button" class="send-email backup-restore">Restore from a Backup</button>' +
        "</div>" +
        '<button type="button" class="mt-btn backup-undo" hidden>Undo last restore</button>' +
        '<p class="backup-status" role="status" aria-live="polite"></p>';
    settingsBody.appendChild(group);

    var lastEl = group.querySelector(".backup-last");
    var pdfBox = group.querySelector(".backup-pdfs-box");
    var pdfText = group.querySelector(".backup-pdfs-text");
    var nowBtn = group.querySelector(".backup-now");
    var restoreBtn = group.querySelector(".backup-restore");
    var undoBtn = group.querySelector(".backup-undo");
    var statusEl = group.querySelector(".backup-status");

    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json,application/json";
    fileInput.hidden = true;
    document.body.appendChild(fileInput);

    function describeLast() {
        var info = readInfo();
        lastEl.textContent = info.last
            ? "Last backup: " + prettyStamp(info.last) + " (" + ago(info.last) + ")" +
                (info.where === "device" ? ", saved on this tablet only."
                    : info.where === "drive" ? ", saved to Google Drive" + (window.DriveBackup && DriveBackup.folder() ? " (" + DriveBackup.folder().name + ")" : "") + "."
                    : info.where === "shared" ? ", sent to Drive or another app." : ".")
            : "This tablet hasn't been backed up yet.";
        pdfTotal().then(function (t) {
            pdfText.textContent = "Include saved PDFs" + (t.count ? " (" + t.count + ", " + prettySize(t.bytes) + ")" : " (none yet)");
        });
        getSnapshot().then(function (snap) {
            undoBtn.hidden = !snap;
            if (snap) undoBtn.textContent = "Undo last restore (puts back this tablet's data from " + prettyStamp(snap.created) + ")";
        });
    }

    function fileName(ms) {
        var d = new Date(ms);
        return "RouteIQ-backup-" + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
            "-" + pad(d.getHours()) + pad(d.getMinutes()) + ".json";
    }

    /* Back Up Now builds the file first, then asks where it goes. Building can take a few
       seconds with PDFs, and Android only opens the share sheet straight after a tap, so the
       tap on a destination is what opens it. A backup counts (and the reminder clears) only
       once it's actually been sent or saved. */
    var saveDialog = el("dialog", "send-dialog mt-dialog backup-save-dialog");
    saveDialog.setAttribute("aria-labelledby", "backup-save-title");
    saveDialog.innerHTML =
        '<div class="mt-dialog-head">' +
            '<h2 id="backup-save-title">Save Backup</h2>' +
            '<button type="button" class="mt-dialog-close" aria-label="Close" data-dialog-close>&times;</button>' +
        "</div>" +
        '<div class="backup-body">' +
            '<p class="backup-ready"></p>' +
            '<button type="button" class="backup-dest backup-dest-drive" hidden>' +
                '<span class="backup-dest-title"></span>' +
                '<span class="backup-dest-hint"></span>' +
            "</button>" +
            '<button type="button" class="mt-btn backup-drive-change" hidden>Use a different folder</button>' +
            '<button type="button" class="backup-dest backup-dest-share">' +
                '<span class="backup-dest-title">Google Drive</span>' +
                '<span class="backup-dest-hint">Opens the share screen. Tap <strong>Drive</strong>, then under <strong>Folder</strong> pick <strong>RouteIQ Backups</strong> and tap <strong>Save</strong>. Email works from there too.</span>' +
            "</button>" +
            '<button type="button" class="backup-dest backup-dest-device">' +
                '<span class="backup-dest-title">This tablet (Downloads)</span>' +
                '<span class="backup-dest-hint">Only on this tablet, so it won\u2019t help if the tablet\u2019s storage is cleared.</span>' +
            "</button>" +
            '<p class="backup-status backup-save-status" role="status" aria-live="polite"></p>' +
        "</div>" +
        '<div class="form-actions mt-dialog-actions">' +
            '<button type="button" class="send-email" data-dialog-close>Close</button>' +
        "</div>";
    document.body.appendChild(saveDialog);

    var readyEl = saveDialog.querySelector(".backup-ready");
    var driveDest = saveDialog.querySelector(".backup-dest-drive");
    var driveChange = saveDialog.querySelector(".backup-drive-change");
    var shareDest = saveDialog.querySelector(".backup-dest-share");
    var deviceDest = saveDialog.querySelector(".backup-dest-device");
    var saveStatus = saveDialog.querySelector(".backup-save-status");
    var saveModal = TrackerDialog(saveDialog, { onClose: function () { ready = null; } });
    var ready = null; // { file, created }

    function canShareFile(file) {
        try { return !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { return false; }
    }

    function recorded(where, r) {
        r = r || ready;
        writeInfo({ last: r.created, size: r.file.size, where: where, snoozeUntil: 0 });
        hideReminder();
        describeLast();
    }

    /* Straight to Google Drive (drive-backup.js): the first tap signs in and picks the folder,
       later taps upload into it. Google's folder picker can't show over an open dialog, so the
       dialog steps aside for it and comes back with the result. */
    var drive = window.DriveBackup && DriveBackup.configured() ? DriveBackup : null;

    function paintDrive() {
        if (!drive) return;
        var folder = drive.folder();
        driveDest.hidden = false;
        driveDest.querySelector(".backup-dest-title").textContent = folder ? "Google Drive \u00B7 " + folder.name : "Google Drive: pick a folder (one time)";
        driveDest.querySelector(".backup-dest-hint").textContent = folder
            ? "Saves straight into that folder."
            : "Sign in to Google and pick the folder (RouteIQ Backups). After that, backups go straight there.";
        driveChange.hidden = !folder;
        // Shown as the share screen when Drive can be reached directly
        shareDest.querySelector(".backup-dest-title").textContent = "Share screen (email or another app)";
        shareDest.querySelector(".backup-dest-hint").textContent = "Opens the share screen to send it anywhere else.";
        drive.preload();
    }

    function driveError(err) {
        var kind = err && err.kind;
        if (kind === "cancelled") return "No folder picked, so nothing was saved.";
        if (kind === "loading") return "Still connecting to Google. Tap again in a moment.";
        if (kind === "signin") return "Google sign-in didn\u2019t finish. Tap Google Drive to try again.";
        if (kind === "expired") return "The Google sign-in ran out. Tap Google Drive again.";
        if (kind === "folder") return "That Drive folder can\u2019t be found anymore. Tap Google Drive to pick it again.";
        return navigator.onLine === false
            ? "The tablet is offline. Connect, then tap Google Drive again."
            : "The upload to Drive didn\u2019t finish. Try again, or use the share screen.";
    }

    function saveToDrive(chooseAgain) {
        if (!ready || !drive) return;
        var r = ready;
        var stepped = false;
        driveDest.disabled = true;
        saveStatus.textContent = "Saving to Google Drive\u2026";
        drive.save(r.file, {
            chooseAgain: chooseAgain,
            beforePicker: function () { stepped = true; saveModal.close(); }
        }).then(function (done) {
            recorded("drive", r);
            return "Saved to Google Drive in " + done.folder + ".";
        }, driveError).then(function (message) {
            if (stepped) {
                saveModal.open();
                ready = r;
            }
            saveStatus.textContent = message;
            driveDest.disabled = false;
            paintDrive();
        });
    }

    driveDest.addEventListener("click", function () { saveToDrive(false); });
    driveChange.addEventListener("click", function () { saveToDrive(true); });

    shareDest.addEventListener("click", function () {
        if (!ready) return;
        var r = ready;
        saveStatus.textContent = "";
        navigator.share({ files: [r.file], title: r.file.name }).then(function () {
            if (ready !== r) return;
            recorded("shared");
            saveStatus.textContent = "Sent. If you picked Drive, it\u2019s in the folder you chose once the upload finishes.";
        }).catch(function (err) {
            saveStatus.textContent = err && err.name === "AbortError"
                ? "Not sent. Tap Google Drive to try again."
                : "The share screen couldn\u2019t open. Save it to this tablet instead, then upload it from the Drive app.";
        });
    });

    deviceDest.addEventListener("click", function () {
        if (!ready) return;
        var url = URL.createObjectURL(ready.file);
        var link = document.createElement("a");
        link.href = url;
        link.download = ready.file.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        recorded("device");
        saveStatus.textContent = "Saved to the tablet\u2019s Downloads.";
    });

    function backUpNow(button, statusTarget) {
        var original = button.textContent;
        button.disabled = true;
        button.textContent = "Getting the backup ready\u2026";
        return collect(pdfBox.checked).then(function (backup) {
            var name = fileName(backup.created);
            var file = new File([JSON.stringify(backup)], name, { type: "application/json" });
            ready = { file: file, created: backup.created };
            readyEl.textContent = name + " (" + prettySize(file.size) + ") is ready. Where should it go?";
            shareDest.hidden = !canShareFile(file);
            paintDrive();
            saveStatus.textContent = shareDest.hidden ? "This browser can\u2019t share files, so it can only be saved to this tablet." : "";
            statusTarget.textContent = "";
            settingsDialogClose();
            saveModal.open();
        }).catch(function () {
            statusTarget.textContent = "The backup couldn't be made. Try again; if it keeps failing, untick Include saved PDFs.";
        }).then(function () {
            button.disabled = false;
            button.textContent = original;
        });
    }

    nowBtn.addEventListener("click", function () { backUpNow(nowBtn, statusEl); });
    restoreBtn.addEventListener("click", function () { statusEl.textContent = ""; fileInput.click(); });
    fileInput.addEventListener("change", function () {
        var f = fileInput.files && fileInput.files[0];
        fileInput.value = "";
        if (f) readBackupFile(f);
    });

    // Opening Settings refreshes the last-backup line
    new MutationObserver(function () { if (settings.open) describeLast(); }).observe(settings, { attributes: true, attributeFilter: ["open"] });

    /* ---------- Restore preview ---------- */

    var restoreDialog = el("dialog", "send-dialog mt-dialog backup-dialog");
    restoreDialog.setAttribute("aria-labelledby", "backup-title");
    restoreDialog.innerHTML =
        '<div class="mt-dialog-head">' +
            '<h2 id="backup-title">Restore from Backup</h2>' +
            '<button type="button" class="mt-dialog-close" aria-label="Close" data-dialog-close>&times;</button>' +
        "</div>" +
        '<div class="backup-body">' +
            '<p class="backup-from"></p>' +
            '<table class="backup-table"><thead><tr><th scope="col"></th><th scope="col">In the backup</th><th scope="col">On this tablet</th></tr></thead><tbody></tbody></table>' +
            '<fieldset class="settings-group">' +
                "<legend>How to restore</legend>" +
                '<label class="settings-option"><input type="radio" name="backup-mode" value="merge" checked>' +
                    '<span class="settings-option-text"><span class="settings-option-title">Add what’s missing</span>' +
                    '<span class="settings-option-hint">Keeps everything on this tablet and adds the entries from the backup that aren’t here.</span></span></label>' +
                '<label class="settings-option"><input type="radio" name="backup-mode" value="replace">' +
                    '<span class="settings-option-text"><span class="settings-option-title">Replace everything</span>' +
                    '<span class="settings-option-hint">This tablet’s data becomes the backup’s. Anything added since the backup was made is removed.</span></span></label>' +
            "</fieldset>" +
            '<label class="mt-confirm-check backup-confirm" hidden><input type="checkbox" class="backup-confirm-box"> I understand anything added since this backup will be removed</label>' +
            '<p class="mt-hint">Before restoring, Route IQ keeps a copy of this tablet’s data so you can undo it from Settings. The app reloads when it’s done.</p>' +
            '<p class="backup-status backup-restore-status" role="status" aria-live="polite"></p>' +
        "</div>" +
        '<div class="form-actions mt-dialog-actions">' +
            '<button type="button" class="send-email" data-dialog-close>Cancel</button>' +
            '<button type="button" class="generate-pdf backup-go">Restore</button>' +
        "</div>";
    document.body.appendChild(restoreDialog);

    var fromEl = restoreDialog.querySelector(".backup-from");
    var tbody = restoreDialog.querySelector(".backup-table tbody");
    var confirmRow = restoreDialog.querySelector(".backup-confirm");
    var confirmBox = restoreDialog.querySelector(".backup-confirm-box");
    var goBtn = restoreDialog.querySelector(".backup-go");
    var restoreStatus = restoreDialog.querySelector(".backup-restore-status");
    var pending = null;
    var restoreModal = TrackerDialog(restoreDialog, { onClose: function () { pending = null; } });

    function mode() {
        var checked = restoreDialog.querySelector('input[name="backup-mode"]:checked');
        return checked ? checked.value : "merge";
    }

    function syncConfirm() {
        var replacing = mode() === "replace";
        confirmRow.hidden = !replacing;
        if (!replacing) confirmBox.checked = false;
        goBtn.disabled = replacing && !confirmBox.checked;
        goBtn.textContent = replacing ? "Replace Everything" : "Restore";
    }

    Array.prototype.forEach.call(restoreDialog.querySelectorAll('input[name="backup-mode"]'), function (r) {
        r.addEventListener("change", syncConfirm);
    });
    confirmBox.addEventListener("change", syncConfirm);

    function showPreview(backup) {
        pending = backup;
        fromEl.textContent = "Backup made " + prettyStamp(backup.created) + " (" + ago(backup.created) + ")" +
            (backup.pdfs ? "." : ", without saved PDFs (the PDFs on this tablet stay as they are).");
        tbody.textContent = "";
        houseData().then(function (houses) {
            return pdfTotal().then(function (t) { return { houses: houses, pdfs: t.count }; });
        }).then(function (now) {
            var theirs = counts(backup.localStorage || {}, backup.houses, (backup.pdfs || []).length);
            var ours = counts(localData(), now.houses, now.pdfs);
            theirs.forEach(function (row, i) {
                var tr = el("tr");
                tr.appendChild(el("th", null, row[0])).setAttribute("scope", "row");
                tr.appendChild(el("td", null, row[0] === "Saved PDFs" && !backup.pdfs ? "not included" : String(row[1])));
                tr.appendChild(el("td", null, String(ours[i][1])));
                tbody.appendChild(tr);
            });
        });
        restoreDialog.querySelector('input[value="merge"]').checked = true;
        restoreStatus.textContent = "";
        syncConfirm();
        settingsDialogClose();
        restoreModal.open();
    }

    function settingsDialogClose() {
        if (settings.open) {
            var close = settings.querySelector("[data-dialog-close]");
            if (close) close.click();
        }
    }

    function readBackupFile(file) {
        var reader = new FileReader();
        reader.onload = function () {
            var backup;
            try { backup = JSON.parse(String(reader.result)); } catch (e) { backup = null; }
            if (!backup || backup.format !== FORMAT || !backup.localStorage) {
                statusEl.textContent = "That file isn't a Route IQ backup. Pick a file named like RouteIQ-backup-2026-10-17-2010.json.";
                return;
            }
            showPreview(backup);
        };
        reader.onerror = function () { statusEl.textContent = "Couldn't read that file."; };
        reader.readAsText(file);
    }

    goBtn.addEventListener("click", function () {
        if (!pending) return;
        var backup = pending, how = mode();
        goBtn.disabled = true;
        restoreStatus.textContent = "Keeping a copy of this tablet’s data first…";
        saveSnapshot().then(function () {
            restoreStatus.textContent = "Restoring…";
            return apply(backup, how);
        }).then(function () {
            restoreStatus.textContent = "Restored. Reloading Route IQ…";
            setTimeout(function () { location.reload(); }, 600);
        }).catch(function () {
            restoreStatus.textContent = "The restore didn't finish. Nothing is lost: use Undo last restore in Settings to put this tablet's data back as it was.";
            goBtn.disabled = false;
        });
    });

    undoBtn.addEventListener("click", function () {
        getSnapshot().then(function (snap) {
            if (!snap) return;
            TrackerDialog.confirmDelete({
                title: "Undo the last restore?",
                message: "This tablet's data goes back to how it was on " + prettyStamp(snap.created) + ", just before the restore.",
                confirmLabel: "Undo Restore"
            }, function () {
                statusEl.textContent = "Putting the data back…";
                apply(snap, "replace").then(function () {
                    return safety("readwrite", function (s) { s.delete("before-restore"); });
                }).then(function () {
                    location.reload();
                }).catch(function () {
                    statusEl.textContent = "Couldn't undo the restore. Try again.";
                });
            });
        });
    });

    /* ---------- Shared to Route IQ ---------- */

    // A backup file shared from Drive or Files: sw.js keeps it in the share inbox and opens
    // index.html?restore-shared=1
    if (/[?&]restore-shared=1/.test(location.search) && window.caches) {
        try { history.replaceState(null, "", location.pathname); } catch (e) { /* cosmetic only */ }
        caches.open("routeiq-share-inbox").then(function (cache) {
            return cache.keys().then(function (requests) {
                return Promise.all(requests.map(function (req) {
                    return cache.match(req).then(function (res) {
                        var name = decodeURIComponent(res.headers.get("X-File-Name") || "");
                        if (!/\.json$/i.test(name)) return null;
                        return res.blob().then(function (blob) {
                            cache.delete(req);
                            return new File([blob], name, { type: "application/json" });
                        });
                    });
                }));
            });
        }).then(function (files) {
            var f = files.filter(Boolean)[0];
            if (f) readBackupFile(f);
        }).catch(function () { /* nothing shared */ });
    }

    /* ---------- Reminder ---------- */

    var bar = el("div", "backup-reminder");
    bar.setAttribute("role", "status");
    bar.hidden = true;
    var barText = el("p", "backup-reminder-text");
    var barNow = el("button", "generate-pdf backup-reminder-now", "Back Up Now");
    barNow.type = "button";
    var barLater = el("button", "send-email backup-reminder-later", "Later");
    barLater.type = "button";
    var barActions = el("div", "backup-reminder-actions");
    barActions.appendChild(barLater);
    barActions.appendChild(barNow);
    bar.appendChild(barText);
    bar.appendChild(barActions);
    document.body.appendChild(bar);

    function hideReminder() {
        bar.hidden = true;
    }

    function checkReminder() {
        var info = readInfo();
        if (info.snoozeUntil && info.snoozeUntil > Date.now()) return hideReminder();
        if (info.last && Date.now() - info.last < REMIND_DAYS * DAY) return hideReminder();
        if (!info.last && !hasData()) return hideReminder();
        barText.textContent = info.last
            ? "Last backup was " + ago(info.last) + "."
            : "Route IQ hasn't been backed up yet.";
        bar.hidden = false;
    }

    barNow.addEventListener("click", function () { backUpNow(barNow, barText); });
    barLater.addEventListener("click", function () {
        writeInfo({ snoozeUntil: Date.now() + DAY });
        hideReminder();
    });

    checkReminder();
    // A tablet left open for days still gets reminded
    setInterval(checkReminder, 60 * 60 * 1000);
})();
