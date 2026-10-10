/*
 * Simple client-side PIN gate.
 *
 * This is a convenience lock to keep the app from being casually opened
 * on a shared device, not real access control — the PIN and the check both
 * live in this file, so anyone who opens dev tools can bypass it. Don't put
 * anything sensitive behind it.
 *
 * Pairs with the inline snippet in each page's <head> that adds the
 * "pin-locked" class to <html> before first paint (see styles.css for the
 * rule that hides the page while that class is present).
 */
(function () {
    "use strict";

    var PIN = "151515";
    var STORAGE_KEY = "fleetMgrUnlocked";
    var root = document.documentElement;

    function isUnlocked() {
        try {
            return sessionStorage.getItem(STORAGE_KEY) === "yes";
        } catch (e) {
            return false;
        }
    }

    function unlock() {
        try {
            sessionStorage.setItem(STORAGE_KEY, "yes");
        } catch (e) {
            /* sessionStorage unavailable (e.g. private mode); the gate will
                just reappear on the next page load, which is an acceptable
                fallback rather than a hard failure. */
        }
        root.classList.remove("pin-locked");
        var overlay = document.getElementById("pin-lock-overlay");
        if (overlay) {
            overlay.remove();
        }
        unlockFrames();
    }

    /* Tabs that reopen at start (pinned tabs, autosaved drafts) load behind the PIN screen,
       see the session as locked, and hide themselves. Unlocking only checks once per page load,
       so without this they stayed blank until the app was reloaded. Each open tab is same-origin,
       so it can be unlocked in place. */
    function unlockFrames() {
        Array.prototype.forEach.call(document.querySelectorAll("iframe"), function (frame) {
            try {
                var doc = frame.contentDocument;
                if (!doc || !doc.documentElement) return;
                doc.documentElement.classList.remove("pin-locked");
                var inner = doc.getElementById("pin-lock-overlay");
                if (inner) inner.remove();
                // Lets the page lay itself out now that it can be seen (signature pads, charts)
                frame.contentWindow.dispatchEvent(new Event("resize"));
            } catch (e) { /* not this app's page */ }
        });
    }

    if (isUnlocked()) {
        root.classList.remove("pin-locked");
        return;
    }

    function buildOverlay() {
        var overlay = document.createElement("div");
        overlay.id = "pin-lock-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-labelledby", "pin-lock-title");

        overlay.innerHTML =
            '<form class="pin-lock-card" id="pin-lock-form" autocomplete="off">' +
                '<img class="pin-lock-logo" src="assets/ew-logo.svg" alt="" width="130" height="82">' +
                '<h2 id="pin-lock-title">Enter PIN</h2>' +
                '<p class="pin-lock-hint">Enter the 6-digit code.</p>' +
                '<input type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" ' +
                    'maxlength="6" id="pin-lock-input" name="pin" aria-label="6-digit PIN" ' +
                    'aria-describedby="pin-lock-error">' +
                '<p class="pin-lock-error" id="pin-lock-error" aria-live="polite"></p>' +
                '<button type="submit" class="pin-lock-submit">Unlock</button>' +
            "</form>";

        document.body.appendChild(overlay);

        var form = document.getElementById("pin-lock-form");
        var input = document.getElementById("pin-lock-input");
        var error = document.getElementById("pin-lock-error");

        function tryUnlock() {
            if (input.value === PIN) {
                unlock();
                return;
            }
            error.textContent = "Incorrect PIN. Try again.";
            input.value = "";
            input.focus();
            overlay.classList.remove("pin-lock-shake");
            // restart the shake animation
            void overlay.offsetWidth;
            overlay.classList.add("pin-lock-shake");
        }

        form.addEventListener("submit", function (event) {
            event.preventDefault();
            tryUnlock();
        });

        // Auto-submit once all 6 digits are entered, for quick entry on mobile
        input.addEventListener("input", function () {
            input.value = input.value.replace(/[^0-9]/g, "").slice(0, 6);
            error.textContent = "";
            if (input.value.length === 6) {
                tryUnlock();
            }
        });

        input.focus();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", buildOverlay);
    } else {
        buildOverlay();
    }
})();
