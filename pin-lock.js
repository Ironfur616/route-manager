/*
 * Simple client-side PIN gate.
 *
 * This is a convenience lock to keep the app from being casually opened
 * on a shared device, not real access control — the check lives in this
 * file, so anyone who opens dev tools can bypass it. Don't put anything
 * sensitive behind it.
 *
 * The PIN itself isn't written here, only its SHA-256 hash (salted with
 * SALT), so reading the code doesn't show it. With only 10,000 possible
 * 4-digit PINs, a determined person could still find it by trying them all.
 * To change the PIN, set PIN_HASH to the output of:
 *   node -e 'console.log(require("crypto").createHash("sha256").update("routeiq-pin:" + "NEWPIN").digest("hex"))'
 * and PIN_LENGTH to its number of digits.
 *
 * Pairs with the inline snippet in each page's <head> that adds the
 * "pin-locked" class to <html> before first paint (see styles.css for the
 * rule that hides the page while that class is present).
 */
(function () {
    "use strict";

    var SALT = "routeiq-pin:";
    var PIN_HASH = "70af690c2d9100f4a018bc3bf3419b12fb4b50527775d268e1c62e95fd3d5101";
    var PIN_LENGTH = 4;
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
                '<p class="pin-lock-hint">Enter the ' + PIN_LENGTH + '-digit code.</p>' +
                '<input type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" ' +
                    'maxlength="' + PIN_LENGTH + '" id="pin-lock-input" name="pin" aria-label="' + PIN_LENGTH + '-digit PIN" ' +
                    'aria-describedby="pin-lock-error">' +
                '<p class="pin-lock-error" id="pin-lock-error" aria-live="polite"></p>' +
                '<button type="submit" class="pin-lock-submit">Unlock</button>' +
            "</form>";

        document.body.appendChild(overlay);

        var form = document.getElementById("pin-lock-form");
        var input = document.getElementById("pin-lock-input");
        var error = document.getElementById("pin-lock-error");

        function hashOf(text) {
            var bytes = new TextEncoder().encode(SALT + text);
            return crypto.subtle.digest("SHA-256", bytes).then(function (buffer) {
                return Array.prototype.map.call(new Uint8Array(buffer), function (b) {
                    return (b < 16 ? "0" : "") + b.toString(16);
                }).join("");
            });
        }

        var checking = false;
        function tryUnlock() {
            if (checking) return;
            // crypto.subtle only exists on https (and localhost); GitHub Pages is https
            if (!window.crypto || !crypto.subtle) {
                error.textContent = "This page must be opened over https to unlock.";
                return;
            }
            checking = true;
            hashOf(input.value).then(function (hash) {
                checking = false;
                if (hash === PIN_HASH) unlock();
                else wrong();
            }, function () {
                checking = false;
                wrong();
            });
        }

        function wrong() {
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

        // Auto-submit once every digit is entered, for quick entry on mobile
        input.addEventListener("input", function () {
            input.value = input.value.replace(/[^0-9]/g, "").slice(0, PIN_LENGTH);
            error.textContent = "";
            if (input.value.length === PIN_LENGTH) {
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
