// o-dropzone: optional enhancement for ui/components.css's .o-dropzone. Loaded as a module, see docs/delivery.md.
//
// The dropzone already works with no script: a file input is stretched over the box, so tapping opens the
// picker and dropping a file onto it selects it. This adds the .is-over highlight while a file is dragged
// over, and writes the chosen file names into an element marked [data-o-files] (or .o-dropzone__files)
// inside the zone. It adds no markup and no styles; with it missing or failing, nothing breaks.
function names(input) {
  return [...(input.files || [])].map((f) => f.name).join(', ');
}

function zoneOf(el) {
  return el && el.closest ? el.closest('.o-dropzone') : null;
}

function show(zone) {
  const input = zone.querySelector('input[type="file"]');
  const out = zone.querySelector('[data-o-files], .o-dropzone__files');
  if (input && out) out.textContent = names(input);
}

if (typeof document !== 'undefined') {
  const over = (on) => (e) => {
    const zone = zoneOf(e.target);
    if (zone) zone.classList.toggle('is-over', on);
  };
  document.addEventListener('dragenter', over(true));
  document.addEventListener('dragover', over(true));
  document.addEventListener('dragleave', (e) => {
    const zone = zoneOf(e.target);
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('is-over');
  });
  document.addEventListener('drop', over(false));
  document.addEventListener('change', (e) => {
    const zone = zoneOf(e.target);
    if (zone) show(zone);
  });
}
