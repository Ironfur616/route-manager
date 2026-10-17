/* The app's own copy of every PDF it creates, kept in IndexedDB so Saved PDFs can list and open
   them inside the app. Android's file browser, opened from an installed app, can leave people
   with no way back to Route IQ short of force-closing it, so the app no longer sends anyone
   there to find a report. The download to the device still happens as before.

   Shared by the form pages (which add PDFs) and the shell (which lists them). All pages are on
   the same origin, so they see the same store.

     PdfStore.add(name, blob)  -> Promise
     PdfStore.list()           -> Promise of [{ id, name, created, size }], newest first
     PdfStore.get(id)          -> Promise of { id, name, created, size, blob }
     PdfStore.remove(id)       -> Promise
*/
(function () {
    "use strict";

    var DB_NAME = "routeiq-pdfs";
    var STORE = "pdfs";
    var KEEP = 100; // oldest copies beyond this are dropped; the downloaded files are untouched

    var dbPromise = null;

    function open() {
        if (!dbPromise) {
            dbPromise = new Promise(function (resolve, reject) {
                if (!window.indexedDB) {
                    reject(new Error("IndexedDB unavailable"));
                    return;
                }
                var req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = function () {
                    req.result.createObjectStore(STORE, { keyPath: "id" }).createIndex("created", "created");
                };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
            dbPromise.catch(function () { dbPromise = null; });
        }
        return dbPromise;
    }

    // Runs fn(store) in a transaction and resolves with whatever fn's request returns
    function run(mode, fn) {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, mode);
                var req = fn(tx.objectStore(STORE));
                tx.oncomplete = function () { resolve(req ? req.result : undefined); };
                tx.onerror = function () { reject(tx.error); };
                tx.onabort = function () { reject(tx.error); };
            });
        });
    }

    function list() {
        return run("readonly", function (store) { return store.getAll(); }).then(function (rows) {
            return rows.sort(function (a, b) { return b.created - a.created; }).map(function (r) {
                return { id: r.id, name: r.name, created: r.created, size: r.size };
            });
        });
    }

    function prune() {
        return list().then(function (rows) {
            var extra = rows.slice(KEEP);
            if (!extra.length) return;
            return run("readwrite", function (store) {
                extra.forEach(function (r) { store.delete(r.id); });
            });
        });
    }

    window.PdfStore = {
        add: function (name, blob) {
            // Ask the browser not to clear this storage when the device runs low on space
            if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
            var record = {
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
                name: name,
                created: Date.now(),
                size: blob.size,
                blob: blob
            };
            return run("readwrite", function (store) { store.put(record); }).then(prune);
        },
        list: list,
        get: function (id) {
            return run("readonly", function (store) { return store.get(id); });
        },
        remove: function (id) {
            return run("readwrite", function (store) { store.delete(id); });
        }
    };
})();
