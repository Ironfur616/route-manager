/*
 * Real login gate, replacing the old shared-PIN lock (pin-lock.js) now that Firestore
 * requires an actual signed-in user. Reuses the PIN lock's overlay markup/CSS classes
 * (#pin-lock-overlay, .pin-lock-card, etc.) so styles.css didn't need to change, and keeps
 * the same sessionStorage fast-path so the page doesn't flash unlocked content before
 * Firebase's (async) auth check resolves - this script just corrects that optimistic guess
 * once the real answer comes back.
 *
 * Pairs with the inline snippet in each page's <head> that adds the "pin-locked" class to
 * <html> before first paint (see styles.css for the rule that hides the page while that
 * class is present).
 */
(function () {
    "use strict";

    var STORAGE_KEY = "fleetMgrUnlocked";
    var root = document.documentElement;
    var overlay = null;
    var errorEl = null;
    var form = null;

    function setUnlockedHint(isUnlocked) {
        try {
            if (isUnlocked) sessionStorage.setItem(STORAGE_KEY, "yes");
            else sessionStorage.removeItem(STORAGE_KEY);
        } catch (e) {
            /* sessionStorage unavailable (e.g. private mode); auth state itself still works */
        }
    }

    function buildOverlay() {
        overlay = document.createElement("div");
        overlay.id = "pin-lock-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-labelledby", "pin-lock-title");

        overlay.innerHTML =
            '<form class="pin-lock-card" id="auth-gate-form" autocomplete="on">' +
                '<img class="pin-lock-logo" src="assets/ew-logo.svg" alt="" width="130" height="82">' +
                '<h2 id="pin-lock-title">Sign In</h2>' +
                '<p class="pin-lock-hint">Use your Route IQ account.</p>' +
                '<div class="auth-gate-field">' +
                    '<label for="auth-gate-email">Email</label>' +
                    '<input type="email" autocomplete="username" id="auth-gate-email" ' +
                        'name="email" class="auth-gate-input" required>' +
                '</div>' +
                '<div class="auth-gate-field">' +
                    '<label for="auth-gate-password">Password</label>' +
                    '<input type="password" autocomplete="current-password" id="auth-gate-password" ' +
                        'name="password" class="auth-gate-input" required>' +
                '</div>' +
                '<p class="pin-lock-error" id="pin-lock-error" aria-live="polite"></p>' +
                '<button type="submit" class="pin-lock-submit">Sign In</button>' +
            "</form>";

        document.body.appendChild(overlay);

        form = document.getElementById("auth-gate-form");
        errorEl = document.getElementById("pin-lock-error");

        form.addEventListener("submit", function (event) {
            event.preventDefault();
            var email = document.getElementById("auth-gate-email").value.trim();
            var password = document.getElementById("auth-gate-password").value;
            var submitBtn = form.querySelector(".pin-lock-submit");

            errorEl.textContent = "";
            submitBtn.disabled = true;
            submitBtn.textContent = "Signing In…";

            var fb = window.RouteIQFirebase;
            fb.signInWithEmailAndPassword(fb.auth, email, password)
                .catch(function (err) {
                    errorEl.textContent = friendlyAuthError(err);
                    overlay.classList.remove("pin-lock-shake");
                    void overlay.offsetWidth;
                    overlay.classList.add("pin-lock-shake");
                })
                .then(function () {
                    submitBtn.disabled = false;
                    submitBtn.textContent = "Sign In";
                });
        });
    }

    function friendlyAuthError(err) {
        var code = err && err.code;
        if (code === "auth/invalid-email") return "Enter a valid email address.";
        if (code === "auth/user-not-found" || code === "auth/invalid-credential" || code === "auth/wrong-password") {
            return "Incorrect email or password.";
        }
        if (code === "auth/too-many-requests") return "Too many attempts. Try again later.";
        if (code === "auth/network-request-failed") return "No connection - check your signal and try again.";
        return "Couldn't sign in. Try again.";
    }

    function lock() {
        root.classList.add("pin-locked");
        setUnlockedHint(false);
        if (!overlay) buildOverlay();
        // #pin-lock-overlay sets "display: flex" by ID selector, which beats the browser's
        // default [hidden] { display: none } rule on specificity - toggle the inline style
        // directly instead of the hidden property, or this silently has no visual effect.
        overlay.style.display = "";
        var emailInput = document.getElementById("auth-gate-email");
        if (emailInput) emailInput.focus();
    }

    function unlock() {
        root.classList.remove("pin-locked");
        setUnlockedHint(true);
        if (overlay) overlay.style.display = "none";
    }

    function onFirebaseReady() {
        var fb = window.RouteIQFirebase;
        fb.onAuthStateChanged(fb.auth, function (user) {
            if (user) unlock();
            else lock();
        });
    }

    if (window.RouteIQFirebase) {
        onFirebaseReady();
    } else {
        document.addEventListener("firebase-ready", onFirebaseReady, { once: true });
    }
})();
