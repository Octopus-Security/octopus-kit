// o-copy: optional enhancement for ui/components.css's .o-copy box. Loaded as a module, see docs/delivery.md.
//
// A button with data-o-copy="#id" copies the text of the element with that id (or, with a bare
// data-o-copy, of the .o-copy__text beside it), then shows data-o-copied (default "Copied") for two seconds.
// Without this script the text is still select-all, so people can copy it by hand. It adds no markup and
// no styles; with it missing or failing, nothing breaks.
async function write(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('copy failed');
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest && e.target.closest('[data-o-copy]');
    if (!btn) return;
    const sel = btn.getAttribute('data-o-copy');
    const src = sel ? document.querySelector(sel) : btn.closest('.o-copy')?.querySelector('.o-copy__text');
    if (!src) return;
    const label = btn.textContent;
    try {
      await write(src.value !== undefined ? src.value : src.textContent.trim());
      btn.textContent = btn.getAttribute('data-o-copied') || 'Copied';
    } catch {
      btn.textContent = 'Press Ctrl+C';
      const range = document.createRange();
      range.selectNodeContents(src);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
    }
    clearTimeout(btn._oCopyTimer);
    btn._oCopyTimer = setTimeout(() => { btn.textContent = label; }, 2000);
  });
}
