// Service worker for the Earthwise Route IQ.
// Bump CACHE_NAME whenever a precached file changes so old caches get
// cleaned up on the next activate.
var CACHE_NAME = "fleet-mgr-v80";

var PRECACHE_URLS = [
    "./",
    "./index.html",
    "./kpi-dashboard.html",
    "./kpi-dashboard.js",
    "./resi-driver.html",
    "./resi-helper.html",
    "./resi-trainee.html",
    "./com-driver.html",
    "./com-trainee.html",
    "./safety-lane-ck.html",
    "./missed-tracker.html",
    "./missed-tracker.js",
    "./new-customers.html",
    "./new-customers.js",
    "./bulk-pickup.html",
    "./bulk-pickup.js",
    "./rca.html",
    "./rca.js",
    "./service-assist.html",
    "./service-assist.js",
    "./route-streets.html",
    "./route-streets.js",
    "./styles.css",
    "./nav.js",
    "./tabs.js",
    "./signature-pad.js",
    "./jspdf.umd.min.js",
    "./pdf-viewer.js",
    "./pdf-store.js",
    "./saved-pdfs.js",
    "./pdf.min.js",
    "./pdf.worker.min.js",
    "./generate-pdf.js",
    "./trainee-role.js",
    "./pin-lock.js",
    "./sw-register.js",
    "./tracker-dialog.js",
    "./recycle-calendar.js",
    "./manifest.webmanifest",
    "./assets/ew-logo.svg",
    "./assets/icons/ew-logo-192.png",
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
                // cache: "reload" skips the browser's HTTP cache. GitHub Pages sends max-age=600,
                // so without it a new version could precache 10-minute-old copies of the files
                // it was meant to replace, and then keep serving them.
                return cache.addAll(PRECACHE_URLS.map(function (url) {
                    return new Request(url, { cache: "reload" });
                }));
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

    // Pages, scripts and styles: network first so field crews always get the latest
    // code when online, falling back to the cached copy offline. "no-cache" makes the
    // browser check with the server (a cheap 304 when nothing changed) instead of
    // reusing its own copy for up to 10 minutes.
    var isCode = request.mode === "navigate" ||
        request.destination === "script" || request.destination === "style";
    if (isCode && new URL(request.url).origin === self.location.origin) {
        event.respondWith(
            fetch(request.url, { cache: "no-cache", credentials: "same-origin" })
                .then(function (response) {
                    if (response && response.ok) {
                        var copy = response.clone();
                        caches.open(CACHE_NAME).then(function (cache) {
                            cache.put(request, copy);
                        });
                    }
                    return response;
                })
                .catch(function () {
                    return caches.match(request, { ignoreSearch: true }).then(function (cached) {
                        if (cached) return cached;
                        if (request.mode === "navigate") return caches.match("./index.html");
                        return Response.error();
                    });
                })
        );
        return;
    }

    // Everything else (icons, images, fonts): cache-first, filling in and
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
