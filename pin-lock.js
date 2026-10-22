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
    var PIN_HASH = "5d1e5acacc61854b530e4286e85e48beed133cdee37faf5149a2643976cdc067";
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

    // A phone-style keypad: dots that fill as digits go in, round buttons 0-9 and backspace.
    // It unlocks on its own once every digit is in; a physical keyboard works too.
    function buildOverlay() {
        var overlay = document.createElement("div");
        overlay.id = "pin-lock-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-labelledby", "pin-lock-title");

        var dots = "";
        for (var d = 0; d < PIN_LENGTH; d++) dots += '<span class="pin-lock-dot"></span>';
        var keys = "";
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"].forEach(function (k) {
            if (!k) keys += '<span class="pin-lock-key-gap" aria-hidden="true"></span>';
            else if (k === "back") keys += '<button type="button" class="pin-lock-key pin-lock-key-back" data-key="back" aria-label="Delete">&#x232B;</button>';
            else keys += '<button type="button" class="pin-lock-key" data-key="' + k + '">' + k + "</button>";
        });

        overlay.innerHTML =
            '<div class="pin-lock-card">' +
                '<img class="pin-lock-logo" src="assets/ew-logo.svg" alt="Earthwise" width="130" height="82">' +
                '<h2 id="pin-lock-title">Enter PIN</h2>' +
                '<div class="pin-lock-dots" id="pin-lock-dots" role="status" aria-live="polite" aria-label="0 of ' + PIN_LENGTH + ' digits entered">' + dots + "</div>" +
                '<p class="pin-lock-error" id="pin-lock-error" aria-live="assertive"></p>' +
                '<div class="pin-lock-keys">' + keys + "</div>" +
            "</div>";

        document.body.appendChild(overlay);

        var dotsEl = document.getElementById("pin-lock-dots");
        var dotEls = dotsEl.querySelectorAll(".pin-lock-dot");
        var error = document.getElementById("pin-lock-error");
        var entered = "";

        function paint() {
            Array.prototype.forEach.call(dotEls, function (dot, i) {
                dot.classList.toggle("is-filled", i < entered.length);
            });
            dotsEl.setAttribute("aria-label", entered.length + " of " + PIN_LENGTH + " digits entered");
        }

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
            hashOf(entered).then(function (hash) {
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
            if (navigator.vibrate) navigator.vibrate(150);
            dotsEl.classList.remove("pin-lock-shake");
            // restart the shake animation
            void dotsEl.offsetWidth;
            dotsEl.classList.add("pin-lock-shake");
            // Let the full row of dots show for a moment before it clears
            setTimeout(function () {
                entered = "";
                paint();
            }, 300);
        }

        function press(key) {
            if (checking) return;
            if (key === "back") {
                entered = entered.slice(0, -1);
            } else if (entered.length < PIN_LENGTH) {
                entered += key;
                error.textContent = "";
            }
            paint();
            if (entered.length === PIN_LENGTH) tryUnlock();
        }

        overlay.querySelector(".pin-lock-keys").addEventListener("click", function (event) {
            var key = event.target.closest("[data-key]");
            if (key) press(key.getAttribute("data-key"));
        });

        document.addEventListener("keydown", function onKey(event) {
            if (!document.getElementById("pin-lock-overlay")) {
                document.removeEventListener("keydown", onKey);
                return;
            }
            if (/^[0-9]$/.test(event.key)) press(event.key);
            else if (event.key === "Backspace") press("back");
            else if (event.key === "Enter" && entered.length === PIN_LENGTH) tryUnlock();
            else return;
            event.preventDefault();
        });

        paint();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", buildOverlay);
    } else {
        buildOverlay();
    }
})();
