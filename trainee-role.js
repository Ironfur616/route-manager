/* Trainee form: the Driver / Helper choice locks the other role's sections.
   Locked sections are disabled here and print as N/A in the PDF (generate-pdf.js). */
(function () {
    var form = document.querySelector("form.emp-info");
    if (!form) return;
    var radios = form.querySelectorAll('input[name="role"]');

    function apply() {
        var picked = form.querySelector('input[name="role"]:checked');
        var role = picked ? picked.value : "";
        form.querySelectorAll("fieldset[data-role]").forEach(function (fs) {
            var locked = !!role && fs.getAttribute("data-role") !== role;
            fs.disabled = locked;
            fs.classList.toggle("role-locked", locked);
            if (locked) {
                fs.querySelectorAll("input[type=checkbox]").forEach(function (box) { box.checked = false; });
            }
        });
    }

    radios.forEach(function (r) { r.addEventListener("change", apply); });
    apply();
})();
