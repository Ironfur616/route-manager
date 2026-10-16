/* The county house lists' storage (IndexedDB "routeiq-houses"), shared by Pull from County
   (county-pull.js) and the route lookup (route-lookup.js) so both open it the same way.

     "sheets"  each imported route spreadsheet's rows, keyed by route
     "pulls"   each route's full house list from the county, with every tick and alley choice
     "index"   a small per-route summary the lookup reads: address -> on the list or not, alley

   Writing the index also stamps localStorage (fleetMgrHouseIndex), so other open pages hear
   about it through a storage event and reload their copy.

     HouseStore.get(store, key) -> Promise of the record or undefined
     HouseStore.put(store, record) -> Promise
     HouseStore.all(store) -> Promise of every record
*/
(function () {
    "use strict";

    var DB_NAME = "routeiq-houses";
    var VERSION = 2;
    var STORES = ["sheets", "pulls", "index"];
    var dbPromise = null;

    function open() {
        if (!dbPromise) {
            dbPromise = new Promise(function (resolve, reject) {
                if (!window.indexedDB) return reject(new Error("IndexedDB unavailable"));
                var req = indexedDB.open(DB_NAME, VERSION);
                req.onupgradeneeded = function () {
                    var db = req.result;
                    STORES.forEach(function (name) {
                        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "route" });
                    });
                };
                req.onsuccess = function () {
                    // Another tab upgrading the database asks this one to let go
                    req.result.onversionchange = function () { req.result.close(); dbPromise = null; };
                    resolve(req.result);
                };
                req.onerror = function () { reject(req.error); };
            });
            dbPromise.catch(function () { dbPromise = null; });
        }
        return dbPromise;
    }

    function run(storeName, mode, fn) {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeName, mode);
                var req = fn(tx.objectStore(storeName));
                tx.oncomplete = function () { resolve(req ? req.result : undefined); };
                tx.onerror = function () { reject(tx.error); };
                tx.onabort = function () { reject(tx.error); };
            });
        });
    }

    window.HouseStore = {
        STAMP_KEY: "fleetMgrHouseIndex",
        get: function (storeName, key) {
            return run(storeName, "readonly", function (s) { return s.get(key); });
        },
        put: function (storeName, record) {
            if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
            return run(storeName, "readwrite", function (s) { s.put(record); }).then(function () {
                if (storeName !== "index") return;
                try { localStorage.setItem("fleetMgrHouseIndex", String(Date.now())); } catch (e) { /* other pages just won't hear */ }
            });
        },
        all: function (storeName) {
            return run(storeName, "readonly", function (s) { return s.getAll(); });
        }
    };
})();
