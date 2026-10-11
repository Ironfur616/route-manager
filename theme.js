/* Light / dark mode. Loaded (not deferred) at the top of every page's <head>, so the page is
   painted in the right colors from the start instead of flashing light first.

   The choice is kept in localStorage ("fleetMgrTheme"):
     "auto"  (default)  dark from 7 PM to 8 AM, light the rest of the day
     "light" / "dark"   always that, whatever the time
   It sets data-theme="light" | "dark" on <html>; styles.css swaps its color roles on that.
   Every open tab is its own page, so each one follows along: a change made in Settings reaches
   the others through the storage event, and "auto" re-checks the clock once a minute. */
(function () {
    "use strict";

    var KEY = "fleetMgrTheme";
    var DARK_FROM = 19; // 7 PM
    var DARK_UNTIL = 8; // 8 AM

    function preference() {
        try {
            var v = localStorage.getItem(KEY);
            return v === "light" || v === "dark" ? v : "auto";
        } catch (e) {
            return "auto";
        }
    }

    function isNight(date) {
        var h = date.getHours();
        return h >= DARK_FROM || h < DARK_UNTIL;
    }

    function resolved() {
        var p = preference();
        if (p !== "auto") return p;
        return isNight(new Date()) ? "dark" : "light";
    }

    function apply() {
        var mode = resolved();
        if (document.documentElement.getAttribute("data-theme") !== mode) {
            document.documentElement.setAttribute("data-theme", mode);
            try { window.dispatchEvent(new CustomEvent("themechange", { detail: mode })); } catch (e) { /* old browser */ }
        }
    }

    apply();

    window.addEventListener("storage", function (ev) {
        if (ev.key === KEY || ev.key === null) apply();
    });
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") apply();
    });

    // Switch right on 7 PM and 8 AM while the app stays open: a timer set for the next of those,
    // re-set each time it fires. The once-a-minute check backs it up in case the tablet slept
    // through the timer.
    var switchTimer = null;
    function scheduleNextSwitch() {
        clearTimeout(switchTimer);
        var now = new Date();
        var next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), isNight(now) ? DARK_UNTIL : DARK_FROM, 0, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        switchTimer = setTimeout(function () {
            apply();
            scheduleNextSwitch();
        }, next - now + 500);
    }
    scheduleNextSwitch();
    setInterval(apply, 60000);

    window.RouteIQTheme = {
        preference: preference,
        resolved: resolved,
        isNight: isNight,
        set: function (value) {
            try {
                if (value === "auto") localStorage.removeItem(KEY);
                else localStorage.setItem(KEY, value);
            } catch (e) { /* storage unavailable: applies to this page until it reloads */ }
            apply();
        }
    };
})();
