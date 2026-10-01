// Service worker for the Earthwise Route IQ.
// Bump CACHE_NAME whenever a precached file changes so old caches get
// cleaned up on the next activate.
var CACHE_NAME = "fleet-mgr-v41";

var PRECACHE_URLS = [
    "./",
    "./index.html",
    "./resi-driver.html",
    "./resi-helper.html",
    "./resi-trainee.html",
    "./com-driver.html",
    "./com-trainee.html",
    "./safety-lane.html",
    "./missed-tracker.html",
    "./missed-tracker.js",
    "./new-customers.html",
    "./new-customers.js",
    "./rca.html",
    "./rca.js",
    "./styles.css",
    "./nav.js",
    "./tabs.js",
    "./signature-pad.js",
    "./jspdf.umd.min.js",
    "./generate-pdf.js",
    "./trainee-role.js",
    "./pin-lock.js",
    "./sw-register.js",
    "./manifest.webmanifest",
    "./assets/ew-logo.svg",
    "./assets/icons/icon-192.png",
    "./assets/icons/icon-512.png",
    "./assets/icons/icon-maskable-192.png",
    "./assets/icons/icon-maskable-512.png",
    "./assets/icons/apple-touch-icon.png",
    "./assets/icons/favicon-32.png"
];

self.addEventListener("install", function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function (cache) {
                return cache.addAll(PRECACHE_URLS);
            })
            .then(function () {
                return self.skipWaiting();
            })
    );
});

self.addEventListener("activate", function (event) {
    event.waitUntil(
        caches.keys()
            .then(function (keys) {
                return Promise.all(
                    keys
                        .filter(function (key) {
                            return key !== CACHE_NAME;
                        })
                        .map(function (key) {
                            return caches.delete(key);
                        })
                );
            })
            .then(function () {
                return self.clients.claim();
            })
    );
});

self.addEventListener("fetch", function (event) {
    var request = event.request;

    if (request.method !== "GET") {
        return;
    }

    // Page navigations: try the network first so field crews always get the
    // latest form when online, falling back to the cached copy offline.
    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then(function (response) {
                    var copy = response.clone();
                    caches.open(CACHE_NAME).then(function (cache) {
                        cache.put(request, copy);
                    });
                    return response;
                })
                .catch(function () {
                    return caches.match(request).then(function (cached) {
                        return cached || caches.match("./index.html");
                    });
                })
        );
        return;
    }

    // Everything else (CSS, JS, icons, fonts): cache-first, filling in and
    // refreshing the cache from the network when a new asset is requested.
    event.respondWith(
        caches.match(request).then(function (cached) {
            if (cached) {
                return cached;
            }
            return fetch(request).then(function (response) {
                if (response && response.status === 200 && response.type === "basic") {
                    var copy = response.clone();
                    caches.open(CACHE_NAME).then(function (cache) {
                        cache.put(request, copy);
                    });
                }
                return response;
            });
        })
    );
});
