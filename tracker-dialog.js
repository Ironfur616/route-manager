/* Shared add / edit dialog for the tracking pages (Missed Collections, New Customers,
   Bulk Pickup Requests). Each page keeps its own form logic and calls:

     var dialog = TrackerDialog(dialogEl, { onClose: fn, focus: inputEl });
     dialog.open();   // shows it and focuses `focus`
     dialog.close();  // or the user taps Close / the X / presses Escape -> onClose runs

   Buttons inside the dialog with [data-dialog-close] close it.

   The on-screen keyboard covers the page without shrinking it (always on iPad; on Android
   unless the browser honors interactive-widget=resizes-content), so the dialog would keep its
   full height and its lower fields would sit under the keyboard. While it's open, it is fit to
   the part of this frame that's still visible above the keyboard. */
(function () {
    "use strict";

    function topViewport() {
        try {
            return window.top.visualViewport || window.visualViewport;
        } catch (e) {
            return window.visualViewport;
        }
    }

    function clearFit(dialog) {
        dialog.style.marginTop = "";
        dialog.style.marginBottom = "";
        dialog.style.maxHeight = "";
    }

    window.TrackerDialog = function (dialog, options) {
        options = options || {};

        function fit() {
            var vv = topViewport();
            if (!dialog.open || !vv) return;
            var frameTop = 0;
            try {
                if (window.frameElement) frameTop = window.frameElement.getBoundingClientRect().top;
            } catch (e) { /* not framed by this app */ }
            var visibleTop = Math.max(0, vv.offsetTop - frameTop);
            var visibleBottom = Math.min(window.innerHeight, vv.offsetTop + vv.height - frameTop);
            var room = visibleBottom - visibleTop;

            if (room >= window.innerHeight - 1) {
                // Nothing covered: let the stylesheet center it as usual
                clearFit(dialog);
            } else {
                dialog.style.marginTop = (visibleTop + 8) + "px";
                dialog.style.marginBottom = "auto";
                dialog.style.maxHeight = Math.max(160, room - 16) + "px";
            }

            // Keep the field being typed in above the keyboard and clear of the pinned Save bar
            var active = document.activeElement;
            if (active && active !== dialog && dialog.contains(active) && active.scrollIntoView) {
                active.scrollIntoView({ block: "nearest" });
            }
        }

        function watchViewport(on) {
            var vv = topViewport();
            if (!vv) return;
            var method = on ? "addEventListener" : "removeEventListener";
            vv[method]("resize", fit);
            vv[method]("scroll", fit);
            window[method]("resize", fit);
        }

        dialog.addEventListener("focusin", function () { setTimeout(fit, 300); });

        // Close buttons, the X and Escape all land here
        dialog.addEventListener("close", function () {
            watchViewport(false);
            clearFit(dialog);
            if (options.onClose) options.onClose();
        });

        Array.prototype.forEach.call(dialog.querySelectorAll("[data-dialog-close]"), function (btn) {
            btn.addEventListener("click", function () { dialog.close(); });
        });

        return {
            open: function () {
                if (!dialog.open) {
                    dialog.showModal();
                    watchViewport(true);
                }
                dialog.scrollTop = 0;
                if (options.focus) options.focus.focus();
            },
            close: function () {
                if (dialog.open) dialog.close();
            },
            scrollToTop: function () {
                dialog.scrollTop = 0;
            }
        };
    };

    /* In-app confirmation before something is deleted, in place of the browser's confirm():
       that box is easy to tap through by mistake and isn't always shown inside an installed
       app. Cancel has focus, so a stray tap or Enter never deletes anything.

         TrackerDialog.confirmDelete({ title, message, confirmLabel, requireCheck }, function () { ...delete... });

       requireCheck (optional) is a checkbox label; the delete button stays disabled until it's
       ticked. Used where a mistaken delete would be costly (the handicap & elderly service list).
    */
    var confirmEl = null;
    var onConfirm = null;

    function buildConfirm() {
        confirmEl = document.createElement("dialog");
        confirmEl.className = "send-dialog mt-confirm";
        confirmEl.setAttribute("aria-labelledby", "mt-confirm-title");
        confirmEl.setAttribute("aria-describedby", "mt-confirm-message");
        confirmEl.innerHTML =
            '<h2 id="mt-confirm-title"></h2>' +
            '<p class="send-help" id="mt-confirm-message"></p>' +
            '<label class="mt-confirm-check" hidden><input type="checkbox"><span></span></label>' +
            '<div class="send-actions">' +
                '<button type="button" class="send-cancel" data-confirm="cancel">Cancel</button>' +
                '<button type="button" class="send-submit mt-confirm-delete" data-confirm="ok"></button>' +
            "</div>";
        document.body.appendChild(confirmEl);

        confirmEl.addEventListener("click", function (ev) {
            var choice = ev.target.getAttribute && ev.target.getAttribute("data-confirm");
            // A tap on the dimmed backdrop lands on the dialog itself: treat it as Cancel
            if (ev.target === confirmEl || choice === "cancel") {
                confirmEl.close();
            } else if (choice === "ok" && !ev.target.disabled) {
                var run = onConfirm;
                confirmEl.close();
                if (run) run();
            }
        });
        confirmEl.addEventListener("close", function () { onConfirm = null; });

        var box = confirmEl.querySelector(".mt-confirm-check input");
        box.addEventListener("change", function () {
            confirmEl.querySelector(".mt-confirm-delete").disabled = !box.checked;
        });
    }

    window.TrackerDialog.confirmDelete = function (options, callback) {
        if (!confirmEl) buildConfirm();
        confirmEl.querySelector("#mt-confirm-title").textContent = options.title || "Delete?";
        confirmEl.querySelector("#mt-confirm-message").textContent = options.message || "";
        var deleteBtn = confirmEl.querySelector(".mt-confirm-delete");
        deleteBtn.textContent = options.confirmLabel || "Delete";

        // Unticked every time it opens, so an earlier confirmation never carries over
        var check = confirmEl.querySelector(".mt-confirm-check");
        check.hidden = !options.requireCheck;
        check.querySelector("input").checked = false;
        check.querySelector("span").textContent = options.requireCheck || "";
        deleteBtn.disabled = !!options.requireCheck;

        onConfirm = callback;
        confirmEl.showModal();
        confirmEl.querySelector('[data-confirm="cancel"]').focus();
    };
})();
