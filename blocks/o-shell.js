// o-shell: optional enhancement for ui/layout.css's .o-shell drawer. Loaded as a module, see docs/delivery.md.
//
// The drawer already works with no script (a hidden checkbox + labels). This adds what CSS cannot:
// Escape closes it, focus moves into it on open and back to the toggle on close, Tab stays inside it
// while it is open, following a link in it closes it, and it closes when the window grows past md.
// It adds no markup and no styles; with it missing or failing, nothing breaks.
const MD = '(min-width: 768px)'; // = --o-bp-md; a test keeps it equal to tokens/tokens.json

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

export function enhance(shell) {
  if (!shell || shell.dataset.oShell === 'ready') return;
  const toggle = shell.querySelector(':scope > .o-shell__toggle');
  const nav = shell.querySelector(':scope > .o-shell__nav');
  if (!toggle || !nav || typeof window.matchMedia !== 'function') return;
  shell.dataset.oShell = 'ready';
  const wide = window.matchMedia(MD);
  const isOpen = () => toggle.checked && !wide.matches;

  function setOpen(open, { restoreFocus = false } = {}) {
    if (toggle.checked === open) return;
    toggle.checked = open;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    if (!open && restoreFocus) toggle.focus();
  }

  toggle.addEventListener('change', () => {
    if (!isOpen()) return;
    const first = [...nav.querySelectorAll(FOCUSABLE)].find(visible);
    (first || nav).focus({ preventScroll: true });
  });

  document.addEventListener('keydown', (e) => {
    if (!isOpen() || e.defaultPrevented) return;
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false, { restoreFocus: true }); return; }
    if (e.key !== 'Tab') return;
    const items = [toggle, ...[...nav.querySelectorAll(FOCUSABLE)].filter(visible)];
    const i = items.indexOf(document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
    e.preventDefault();
    items[next].focus();
  });

  nav.addEventListener('click', (e) => {
    const a = e.target instanceof Element && e.target.closest('a[href]');
    if (a && isOpen()) setOpen(false);
  });

  const reset = () => { if (wide.matches) setOpen(false); };
  if (wide.addEventListener) wide.addEventListener('change', reset); else if (wide.addListener) wide.addListener(reset);
  // A reload or back-navigation can restore the checkbox as checked; never start open.
  window.addEventListener('pageshow', () => setOpen(false));
  setOpen(false);
}

function init() { document.querySelectorAll('.o-shell').forEach(enhance); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
