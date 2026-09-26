/* Signature pads: draw with finger, stylus or mouse.
   The drawing is stored as a PNG data URL in the hidden input next to the canvas. */
(function () {
    function initPad(field) {
        var canvas = field.querySelector("canvas");
        var input = field.querySelector("input[type=hidden]");
        var clearBtn = field.querySelector(".signature-clear");
        var ctx = canvas.getContext("2d");
        var drawing = false;
        var hasInk = false;
        var saved = null; // signature restored from an autosaved draft, painted once the canvas is sized

        function paint(data) {
            var img = new Image();
            img.onload = function () {
                var rect = canvas.getBoundingClientRect();
                ctx.drawImage(img, 0, 0, rect.width, rect.height);
                hasInk = true;
                input.value = data;
            };
            img.src = data;
        }

        function setup() {
            // Size the bitmap to the displayed size so lines aren't blurry or offset
            var ratio = window.devicePixelRatio || 1;
            var rect = canvas.getBoundingClientRect();
            if (!rect.width) return;
            canvas.width = Math.round(rect.width * ratio);
            canvas.height = Math.round(rect.height * ratio);
            ctx.scale(ratio, ratio);
            ctx.lineWidth = 2.5;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.strokeStyle = "#1A1A1A";
            hasInk = false;
            input.value = "";
            if (saved) paint(saved);
        }

        function point(e) {
            var rect = canvas.getBoundingClientRect();
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }

        canvas.addEventListener("pointerdown", function (e) {
            drawing = true;
            canvas.setPointerCapture(e.pointerId);
            var p = point(e);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            // A tap leaves a dot
            ctx.lineTo(p.x + 0.01, p.y + 0.01);
            ctx.stroke();
            hasInk = true;
            e.preventDefault();
        });

        canvas.addEventListener("pointermove", function (e) {
            if (!drawing) return;
            var p = point(e);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            e.preventDefault();
        });

        function end() {
            if (!drawing) return;
            drawing = false;
            if (hasInk) input.value = canvas.toDataURL("image/png");
        }
        canvas.addEventListener("pointerup", end);
        canvas.addEventListener("pointercancel", end);

        clearBtn.addEventListener("click", function () {
            saved = null;
            setup();
        });

        // Lets the draft autosave (tabs.js) put a signature back. If the tab is hidden the
        // canvas has no size yet, so the drawing waits for the next setup() when it is shown.
        field.restoreSignature = function (data) {
            saved = data;
            input.value = data;
            setup();
        };

        setup();
        window.addEventListener("resize", function () {
            // Resizing wipes the bitmap; only redo it when nothing is signed yet
            if (!hasInk) setup();
        });
    }

    document.querySelectorAll("[data-signature]").forEach(initPad);

    // Read-only fields under the signatures mirror the Employee Information field named in data-mirror
    document.querySelectorAll("[data-mirror]").forEach(function (mirror) {
        var source = document.getElementById(mirror.getAttribute("data-mirror"));
        if (!source) return;
        var sync = function () { mirror.value = source.value; };
        source.addEventListener("input", sync);
        source.addEventListener("change", sync);
        sync();
    });
})();
