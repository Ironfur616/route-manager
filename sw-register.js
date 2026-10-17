// Registers the service worker that lets the Route IQ install
// as a PWA and load its pages/assets while offline.
if ("serviceWorker" in navigator) {
    // Set before a new version takes over, so the very first install doesn't trigger a reload
    var hadController = !!navigator.serviceWorker.controller;

    window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js").then(function (reg) {
            // An installed app is usually resumed from the background rather than relaunched,
            // so also look for a new version each time it comes back to the front.
            document.addEventListener("visibilitychange", function () {
                if (document.visibilityState === "visible" && reg) reg.update().catch(function () {});
            });
        }).catch(function (err) {
            console.error("Service worker registration failed:", err);
        });
    });

    // A new version just took over: reload once so the app runs it now instead of on the
    // next launch. Only the top window reloads; the form tabs inside it come back from
    // their autosaved drafts.
    var reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
        if (!hadController || reloaded || window !== window.top) return;
        reloaded = true;
        window.location.reload();
    });
}
