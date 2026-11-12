#!/usr/bin/env node
/**
 * octopus-check-overflow — does a page scroll sideways on a phone?
 *
 *   node bin/octopus-check-overflow.mjs <url...> [--widths 320,360,390,412] [--json] [--settle 500] [--max 5]
 *
 * Loads each URL in headless Chromium (mobile emulation, DPR 3) at each width and reports
 * scrollWidth > innerWidth plus the elements whose right edge passes the viewport, and text elements whose boxes overlap.
 * Exit 0 clean, 1 overflow found, 2 usage error or browser unavailable (never a silent pass).
 * Playwright is an OPTIONAL dependency: install it in the app that runs this.
 * Never logs in or sends credentials; a gated app is checked on the page it serves anonymously.
 */
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';

export const DEFAULT_WIDTHS = [320, 360, 390, 412];

/** Runs inside the page. Returns plain data. */
function inPage({ max, width }) {
  // Mobile Chromium WIDENS the layout viewport to fit overflowing content (the page then looks zoomed out),
  // so innerWidth can equal scrollWidth. Compare against the device width we asked for instead.
  const vw = width;
  const doc = document.documentElement;
  const sel = (el) => {
    if (el.id) return `${el.tagName.toLowerCase()}#${el.id}`;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o !== 'visible') return true; // scrolls or clips inside its own box
    }
    return false;
  };
  const offenders = [];
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.right > vw + 1 && !clipped(el) && getComputedStyle(el).position !== 'fixed') {
      offenders.push({ selector: sel(el), right: Math.round(r.right), width: Math.round(r.width) });
    }
  }
  // Overlap: two text-bearing elements, neither inside the other, whose boxes cross by more than 2px both ways.
  // This is the "name column squeezed to 0 so the detail draws on top of it" class, which scrollWidth cannot see.
  const textual = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!/^(SCRIPT|STYLE|SVG|PATH|BR|OPTION)$/i.test(el.tagName) && !el.closest('svg') &&
        [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      // The rect of the TEXT, not the box: a squeezed 0px-wide column still paints its overflowing words.
      let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !n.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(n);
        for (const q of range.getClientRects()) { if (q.width < 1 || q.height < 1) continue; L = Math.min(L, q.left); T = Math.min(T, q.top); R = Math.max(R, q.right); B = Math.max(B, q.bottom); }
      }
      if (R > L && B > T && B > 0) textual.push({ el, r: { left: L, top: T, right: R, bottom: B } });
    }
  }
  const overlaps = [];
  for (let i = 0; i < textual.length && overlaps.length < max * 4; i++) {
    for (let j = i + 1; j < textual.length; j++) {
      const a = textual[i], b = textual[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w > 2 && h > 2) overlaps.push({ a: sel(a.el), b: sel(b.el), w: Math.round(w), h: Math.round(h), text: (a.el.textContent || '').trim().slice(0, 30) });
    }
  }
  offenders.sort((a, b) => b.right - a.right);
  const seen = new Set();
  const top = offenders.filter((o) => (seen.has(o.selector) ? false : seen.add(o.selector))).slice(0, max);
  return {
    innerWidth: vw,
    layoutWidth: window.innerWidth,
    scrollWidth: Math.max(doc.scrollWidth, document.body.scrollWidth),
    visualWidth: window.visualViewport ? Math.round(window.visualViewport.width) : vw,
    offenders: top,
    overlaps: overlaps.slice(0, max),
  };
}

export async function loadPlaywright() {
  const norm = (m) => (m && m.chromium ? m : m && m.default && m.default.chromium ? m.default : null);
  const req = createRequire(process.cwd() + '/');
  for (const name of ['playwright', 'playwright-core']) {
    try { const m = norm(await import(pathToFileURL(req.resolve(name)).href)); if (m) return m; } catch { /* try next */ }
  }
  try { return norm(await import('playwright')); } catch { /* none */ }
  return null;
}

/** Check one URL at every width using an existing browser. */
export async function checkUrl(browser, url, { widths = DEFAULT_WIDTHS, settle = 500, max = 5 } = {}) {
  const results = [];
  for (const width of widths) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const r = { width, ok: true, status: null };
    try {
      const resp = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      r.status = resp ? resp.status() : null;
      await page.waitForTimeout(settle);
      Object.assign(r, await page.evaluate(inPage, { max, width }));
      r.ok = r.scrollWidth <= width && r.layoutWidth <= width && !(r.overlaps || []).length;
    } catch (err) {
      r.ok = false; r.error = String(err.message || err).split('\n')[0];
    }
    await ctx.close();
    results.push(r);
  }
  return { url, results, ok: results.every((r) => r.ok) };
}

export async function main(argv = process.argv.slice(2)) {
  const urls = []; let widths = DEFAULT_WIDTHS; let json = false; let settle = 500; let max = 5;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--widths') widths = String(argv[++i]).split(',').map(Number).filter(Boolean);
    else if (a === '--settle') settle = Number(argv[++i]);
    else if (a === '--max') max = Number(argv[++i]);
    else if (a === '-h' || a === '--help') urls.length = 0, argv.length = 0;
    else urls.push(a);
  }
  if (!urls.length) {
    console.error('usage: octopus-check-overflow <url...> [--widths 320,360,390,412] [--json] [--settle ms] [--max n]');
    return 2;
  }
  const pw = await loadPlaywright();
  if (!pw) {
    console.error('octopus-check-overflow: Playwright is not installed (optional dependency). Run: npm i -D playwright && npx playwright install chromium');
    return 2;
  }
  let browser;
  try {
    const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH;
    browser = await pw.chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
  } catch (err) {
    console.error(`octopus-check-overflow: cannot start Chromium (${String(err.message).split('\n')[0]}). Run: npx playwright install chromium, or set PLAYWRIGHT_CHROMIUM_PATH.`);
    return 2;
  }
  const all = [];
  try { for (const u of urls) all.push(await checkUrl(browser, u, { widths, settle, max })); } finally { await browser.close(); }
  if (json) console.log(JSON.stringify(all, null, 2));
  else {
    for (const r of all) {
      console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.url}`);
      for (const w of r.results) {
        if (w.error) { console.log(`  ${w.width}px  ERROR ${w.error}`); continue; }
        const sideways = w.scrollWidth > w.width || w.layoutWidth > w.width;
        console.log(`  ${w.width}px  ${w.ok ? 'ok' : `${sideways ? `OVERFLOW scrollWidth ${w.scrollWidth} (layout viewport ${w.layoutWidth}) > ${w.width}` : ''}${(w.overlaps || []).length ? ' OVERLAP' : ''}`}${w.status && w.status >= 400 ? ` (HTTP ${w.status})` : ''}`);
        for (const o of w.overlaps || []) console.log(`      overlap ${o.a} x ${o.b}  ${o.w}x${o.h}px  "${o.text}"`);
        for (const o of w.offenders || []) if (!w.ok) console.log(`      ${o.selector}  right=${o.right}  width=${o.width}`);
      }
    }
  }
  return all.every((r) => r.ok) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main().then((c) => { process.exitCode = c; });
}
