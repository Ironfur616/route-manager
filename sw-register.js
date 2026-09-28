// Registers the service worker that lets the Route IQ install
// as a PWA and load its pages/assets while offline.
if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js").catch(function (err) {
            console.error("Service worker registration failed:", err);
        });
    });
}
