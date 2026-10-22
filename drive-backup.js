/* Direct Google Drive backups, for Backup & Restore (backup.js). The first time, you sign in
   to Google and pick the folder (Google's own folder picker, e.g. "RouteIQ Backups"); after
   that each backup uploads straight into that folder with one tap.

   Access is Google's drive.file permission: Route IQ can only see files it uploaded and the
   folder picked here, nothing else in the Drive. The sign-in token lasts about an hour and is
   kept in memory only; the folder (id and name) is remembered in fleetMgrBackupDrive.

   Needs, from the ewrouteiq Google Cloud project: an OAuth client ID (web, with
   https://ironfur616.github.io as an authorized origin) and an API key allowed to use the
   Google Picker API. Until both are filled in below, DriveBackup.configured() is false and
   backup.js offers only the share screen and Downloads.

   Published route maps (map-live.js) go to a folder of their own (e.g. "Route Maps" inside the
   backups folder), picked the same way the first time and remembered in fleetMgrRouteMapsDrive.
   Calls that take `slot` use "maps" for that folder; leaving it out means the backups folder.

     DriveBackup.configured()          -> bool
     DriveBackup.folder(slot)          -> { id, name } or null
     DriveBackup.preload(slot)         loads Google's scripts ahead of the tap that needs them
     DriveBackup.ready()               -> bool, whether a tap can sign in right now
     DriveBackup.save(file, opts)      -> Promise of { name, folder }; signs in and (first time,
                                          or opts.chooseAgain) picks the folder first.
                                          opts.beforePicker() runs before the picker shows.
                                          opts.slot picks which folder ("maps" or the backups').
     DriveBackup.forget(slot)          forgets the folder
*/
(function () {
    "use strict";

    var CONFIG = {
        clientId: "59647765517-cgf0gon2aej87mtb7coiucne3ttq267f.apps.googleusercontent.com", // OAuth client ID, ends in .apps.googleusercontent.com
        apiKey: "AIzaSyCLfrN3czwwCXsbFJvjdvWdbLpLo4PRIzg", // API key, Google Picker API only, ironfur616.github.io only
        appId: "59647765517"         // the ewrouteiq project number
    };
    var SCOPE = "https://www.googleapis.com/auth/drive.file";
    var FOLDER_KEY = "fleetMgrBackupDrive";
    var SLOTS = {
        maps: { key: "fleetMgrRouteMapsDrive", title: "Pick the folder for published route maps (Route Maps)" }
    };
    var BACKUPS = { key: FOLDER_KEY, title: "Pick the folder for Route IQ backups" };

    function slotOf(name) {
        return SLOTS[name] || BACKUPS;
    }
    var SMALL = 5 * 1024 * 1024;     // up to this, one request; bigger files use a resumable upload

    var token = null, tokenExpires = 0, tokenClient = null;
    var scripts = {};

    function loadScript(src) {
        if (!scripts[src]) {
            scripts[src] = new Promise(function (resolve, reject) {
                var s = document.createElement("script");
                s.src = src;
                s.async = true;
                s.onload = function () { resolve(); };
                s.onerror = function () { delete scripts[src]; reject(new Error("Couldn't load " + src)); };
                document.head.appendChild(s);
            });
        }
        return scripts[src];
    }

    function configured() {
        return !!(CONFIG.clientId && CONFIG.apiKey);
    }

    // Without a key, the backups folder (which also records that Google permission was given)
    function readFolder(key) {
        try {
            var v = JSON.parse(localStorage.getItem(key || FOLDER_KEY) || "null");
            return v && v.id ? v : null;
        } catch (e) {
            return null;
        }
    }

    function writeFolder(v, key) {
        try {
            if (v) localStorage.setItem(key || FOLDER_KEY, JSON.stringify(v));
            else localStorage.removeItem(key || FOLDER_KEY);
        } catch (e) { /* storage blocked: it'll ask for the folder again */ }
    }

    function hasGis() {
        return !!(window.google && google.accounts && google.accounts.oauth2);
    }

    function preload(slot) {
        if (!configured()) return;
        loadScript("https://accounts.google.com/gsi/client").catch(function () {});
        if (!readFolder(slotOf(slot).key)) {
            loadScript("https://apis.google.com/js/api.js").then(function () {
                return new Promise(function (resolve) { gapi.load("picker", { callback: resolve }); });
            }).catch(function () {});
        }
    }

    // Must run straight from a tap: Google's sign-in opens a window
    function getToken() {
        if (token && Date.now() < tokenExpires - 60000) return Promise.resolve(token);
        if (!hasGis()) return Promise.reject({ kind: "loading" });
        return new Promise(function (resolve, reject) {
            if (!tokenClient) {
                tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CONFIG.clientId, scope: SCOPE, callback: function () {} });
            }
            tokenClient.callback = function (resp) {
                if (!resp || resp.error) return reject({ kind: "signin", detail: resp && resp.error });
                token = resp.access_token;
                tokenExpires = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
                var f = readFolder() || {};
                if (!f.consented) writeFolder(f.id ? merge(f, { consented: true }) : null);
                resolve(token);
            };
            tokenClient.error_callback = function (err) { reject({ kind: "signin", detail: err && err.type }); };
            // The first time asks for permission; later sign-ins go straight through
            tokenClient.requestAccessToken({ prompt: (readFolder() || {}).consented ? "" : "consent" });
        });
    }

    function merge(a, b) {
        var out = {};
        Object.keys(a).forEach(function (k) { out[k] = a[k]; });
        Object.keys(b).forEach(function (k) { out[k] = b[k]; });
        return out;
    }

    function pickFolder(accessToken, beforePicker, title, startIn) {
        return loadScript("https://apis.google.com/js/api.js").then(function () {
            return new Promise(function (resolve) { gapi.load("picker", { callback: resolve }); });
        }).then(function () {
            return new Promise(function (resolve) {
                if (beforePicker) beforePicker();
                var view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
                    .setIncludeFolders(true)
                    .setSelectFolderEnabled(true)
                    .setMimeTypes("application/vnd.google-apps.folder");
                // Opens inside a folder when there's one to start from (Route Maps sits in the backups folder)
                if (startIn) view.setParent(startIn);
                new google.picker.PickerBuilder()
                    .addView(view)
                    .setTitle(title)
                    .setOAuthToken(accessToken)
                    .setDeveloperKey(CONFIG.apiKey)
                    .setAppId(CONFIG.appId)
                    .setCallback(function (data) {
                        if (data.action === google.picker.Action.PICKED && data.docs && data.docs[0]) {
                            resolve({ id: data.docs[0].id, name: data.docs[0].name });
                        } else if (data.action === google.picker.Action.CANCEL) {
                            resolve(null);
                        }
                    })
                    .build()
                    .setVisible(true);
            });
        });
    }

    function checked(res) {
        if (res.status === 401) throw { kind: "expired" };
        if (res.status === 404) throw { kind: "folder" };
        if (!res.ok) throw { kind: "upload", status: res.status };
        return res;
    }

    function upload(file, folderId, accessToken) {
        var meta = { name: file.name, parents: [folderId], mimeType: "application/json" };
        var base = "https://www.googleapis.com/upload/drive/v3/files?fields=id,name&supportsAllDrives=true&uploadType=";
        var auth = "Bearer " + accessToken;
        if (file.size <= SMALL) {
            var boundary = "routeiq" + Date.now().toString(36);
            var body = new Blob([
                "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) + "\r\n" +
                "--" + boundary + "\r\nContent-Type: application/json\r\n\r\n",
                file,
                "\r\n--" + boundary + "--"
            ]);
            return fetch(base + "multipart", {
                method: "POST",
                headers: { Authorization: auth, "Content-Type": "multipart/related; boundary=" + boundary },
                body: body
            }).then(checked).then(function (res) { return res.json(); });
        }
        return fetch(base + "resumable", {
            method: "POST",
            headers: { Authorization: auth, "Content-Type": "application/json; charset=UTF-8",
                "X-Upload-Content-Type": "application/json", "X-Upload-Content-Length": String(file.size) },
            body: JSON.stringify(meta)
        }).then(checked).then(function (res) {
            var where = res.headers.get("Location");
            if (!where) throw { kind: "upload" };
            return fetch(where, { method: "PUT", headers: { "Content-Type": "application/json" }, body: file });
        }).then(checked).then(function (res) { return res.json(); });
    }

    function save(file, opts) {
        opts = opts || {};
        var slot = slotOf(opts.slot);
        return getToken().then(function (accessToken) {
            var folder = opts.chooseAgain ? null : readFolder(slot.key);
            if (folder) return [accessToken, folder];
            var startIn = slot === BACKUPS ? null : (readFolder() || {}).id;
            return pickFolder(accessToken, opts.beforePicker, slot.title, startIn).then(function (picked) {
                if (!picked) throw { kind: "cancelled" };
                writeFolder({ id: picked.id, name: picked.name, consented: true }, slot.key);
                return [accessToken, readFolder(slot.key)];
            });
        }).then(function (pair) {
            return upload(file, pair[1].id, pair[0]).catch(function (err) {
                if (err && err.kind === "expired") token = null;
                if (err && err.kind === "folder") writeFolder(merge(readFolder(slot.key) || {}, { id: "" }), slot.key);
                throw err;
            }).then(function (made) {
                return { name: made && made.name, folder: pair[1].name };
            });
        });
    }

    window.DriveBackup = {
        configured: configured,
        folder: function (slot) { var f = readFolder(slotOf(slot).key); return f && f.id ? f : null; },
        preload: preload,
        ready: function () { return hasGis() || (token && Date.now() < tokenExpires - 60000); },
        save: save,
        forget: function (slot) { writeFolder(null, slotOf(slot).key); }
    };
})();
