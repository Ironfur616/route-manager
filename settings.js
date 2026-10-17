/* Settings, opened from the gear in the app header. For now it holds Appearance: automatic
   light/dark by time of day (the default), or always light, or always dark (theme.js does the
   work). Loaded only by the shell (index.html), after nav.js has built the header and before
   recycle-calendar.js adds its button, so the gear sits to the left of the calendar. */
(function () {
    "use strict";

    var header = document.querySelector(".app-header");
    if (!header || !window.RouteIQTheme) return;

    var OPTIONS = [
        { value: "auto", title: "Automatic", hint: "Dark from 7 PM to 8 AM, light the rest of the day." },
        { value: "light", title: "Always light", hint: "Light at any time of day." },
        { value: "dark", title: "Always dark", hint: "Dark at any time of day." }
    ];

    var openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "settings-open";
    openBtn.setAttribute("aria-label", "Settings");
    openBtn.title = "Settings";
    openBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">' +
            '<path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4z" ' +
                'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
            '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
        "</svg>";
    header.appendChild(openBtn);

    var dialog = document.createElement("dialog");
    dialog.className = "send-dialog mt-dialog settings-dialog";
    dialog.setAttribute("aria-labelledby", "settings-title");
    dialog.innerHTML =
        '<div class="mt-dialog-head">' +
            '<h2 id="settings-title">Settings</h2>' +
            '<button type="button" class="mt-dialog-close" aria-label="Close" data-dialog-close>&times;</button>' +
        "</div>" +
        '<div class="settings-body">' +
            '<fieldset class="settings-group">' +
                "<legend>Appearance</legend>" +
                '<div class="settings-options"></div>' +
            "</fieldset>" +
            '<p class="settings-now" aria-live="polite"></p>' +
        "</div>" +
        '<div class="form-actions mt-dialog-actions">' +
            '<button type="button" class="generate-pdf" data-dialog-close>Done</button>' +
        "</div>";
    document.body.appendChild(dialog);

    var optionsEl = dialog.querySelector(".settings-options");
    var nowEl = dialog.querySelector(".settings-now");

    OPTIONS.forEach(function (o) {
        var label = document.createElement("label");
        label.className = "settings-option";
        var input = document.createElement("input");
        input.type = "radio";
        input.name = "theme";
        input.value = o.value;
        // Picking an option applies it straight away, everywhere in the app
        input.addEventListener("change", function () {
            if (input.checked) {
                RouteIQTheme.set(o.value);
                describe();
            }
        });
        var text = document.createElement("span");
        text.className = "settings-option-text";
        var title = document.createElement("span");
        title.className = "settings-option-title";
        title.textContent = o.title;
        var hint = document.createElement("span");
        hint.className = "settings-option-hint";
        hint.textContent = o.hint;
        text.appendChild(title);
        text.appendChild(hint);
        label.appendChild(input);
        label.appendChild(text);
        optionsEl.appendChild(label);
    });

    function describe() {
        var pref = RouteIQTheme.preference();
        var mode = RouteIQTheme.resolved() === "dark" ? "Dark" : "Light";
        nowEl.textContent = pref === "auto"
            ? "Right now: " + mode + (mode === "Dark" ? " (7 PM – 8 AM)" : " (8 AM – 7 PM)") + "."
            : "Right now: " + mode + ", until you change it here.";
    }

    var settingsDialog = TrackerDialog(dialog, {});

    openBtn.addEventListener("click", function () {
        var pref = RouteIQTheme.preference();
        Array.prototype.forEach.call(optionsEl.querySelectorAll("input"), function (i) { i.checked = i.value === pref; });
        describe();
        settingsDialog.open();
    });

    // Automatic switching while Settings is open keeps the "Right now" line true
    window.addEventListener("themechange", function () { if (dialog.open) describe(); });
})();
