'use strict';
// ui/dialog.js + ui/dialog.css: loading modes, escaping, CSS rules (node), and real behaviour in Chromium (Playwright, skipped when absent).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const jsPath = path.join(root, 'ui/dialog.js');
const src = fs.readFileSync(jsPath, 'utf8');
const css = fs.readFileSync(path.join(root, 'ui/dialog.css'), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const code = (s) => strip(s).replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

test('require(): named functions and the object itself', async () => {
  const d = require(jsPath);
  for (const k of ['alert', 'confirm', 'prompt', 'toast']) assert.equal(typeof d[k], 'function', k);
  // No document here: calls resolve to the safe default and never throw.
  assert.equal(await d.confirm({ title: 'x' }), false);
  assert.equal(await d.prompt({ label: 'x' }), null);
  assert.equal(await d.alert('x'), undefined);
  assert.equal(d.toast('x'), undefined);
});

test('ES import: default object and named exports', async () => {
  const m = await import(jsPath);
  assert.equal(typeof m.confirm, 'function');
  assert.equal(typeof m.toast, 'function');
  assert.equal(typeof m.default.prompt, 'function');
});

test('classic script: sets window.oDialog and does not need module/exports', () => {
  const win = {};
  vm.runInNewContext(src, { window: win, Promise, console });
  assert.deepEqual(['alert', 'confirm', 'prompt', 'toast'].filter((k) => typeof win.oDialog[k] === 'function').length, 4);
});

test('escapeHtml', () => {
  const { esc } = require(jsPath)._test;
  assert.equal(esc('<img src=x onerror="a()">&\''), '&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
});

test('dialog.js source has no native dialogs, no dependencies, innerHTML only behind html:true', () => {
  const c = code(src);
  assert.doesNotMatch(c, /(?<![\w.$])(?:window\.)?(alert|confirm|prompt)\s*\(/);
  assert.doesNotMatch(c, /\brequire\(|\bimport\s|@import/);
  assert.equal((c.match(/\.innerHTML\s*=/g) || []).length, 1);
  assert.match(c, /if \(html\) node\.innerHTML/);
});

test('kit ui contains no native alert/confirm/prompt calls (code or docs examples)', () => {
  for (const dir of ['ui', 'blocks', 'server']) {
    const d = path.join(root, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((n) => /\.(js|mjs|html)$/.test(n))) {
      const t = code(fs.readFileSync(path.join(d, f), 'utf8'));
      assert.doesNotMatch(t, /(?<![\w.$])(?:window\.)?(alert|confirm|prompt)\s*\(/, `${dir}/${f}`);
    }
  }
});

test('dialog.css: every colour is var(--o-x, var(--app, literal)); no bare literal outside the palette blocks', () => {
  const c = strip(css);
  // Every --od-* palette entry is a three-level chain ending in a literal.
  const entries = [...c.matchAll(/--od-([a-z]+):\s*([^;]+);/g)];
  assert.ok(entries.length >= 13 * 4);
  for (const [, k, v] of entries) assert.match(v, /^var\(--o-[a-z0-9-]+, var\(--[a-z-]+, (#[0-9a-f]{3,8}|rgba?\([^)]*\)|0 8px 24px rgba\([^)]*\))\)\)$/, k);
  // Outside the palette blocks, no literal colours at all: rules use --od-*.
  const rest = c.replace(/--od-[a-z]+:[^;]+;/g, '');
  assert.doesNotMatch(rest, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(rest, /\b(rgb|rgba|hsl|hsla)\(/);
});

test('dialog.css: light, dark (media + data-theme), bottom sheet, 44px targets, 16px inputs, safe areas', () => {
  assert.match(css, /@media \(prefers-color-scheme: dark\)[\s\S]*?:not\(\[data-theme="light"\]\)/);
  assert.match(css, /\[data-theme="dark"\] \.o-dialog/);
  assert.match(css, /\[data-theme="light"\] \.o-dialog/);
  assert.match(css, /@media \(max-width: 767\.98px\)[\s\S]*?\.o-modal\.o-dialog/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /font-size: max\(16px, 1rem\)/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /prefers-reduced-motion: no-preference/);
});

test('package: dialog files are shipped and the version is 0.6.0', () => {
  const pkg = require('../package.json');
  assert.ok(pkg.files.includes('ui'));
  assert.equal(pkg.version, '0.6.0');
  assert.ok(fs.existsSync(path.join(root, 'ui/dialog.js')) && fs.existsSync(path.join(root, 'ui/dialog.css')));
});

// ---- Browser behaviour --------------------------------------------------------------
function findPlaywright() {
  for (const c of [process.env.OCTOPUS_LENDER, path.join(root, '..', 'octopus-shopper', 'node_modules')].filter(Boolean)) {
    if (fs.existsSync(path.join(c, 'playwright', 'package.json'))) return c;
  }
  return null;
}
const PW = findPlaywright();
const probe = PW && spawnSync(process.execPath, ['-e', `require('playwright').chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH}:{}).then(b=>b.close()).then(()=>process.exit(0),()=>process.exit(1))`], { env: { ...process.env, NODE_PATH: PW } });
const skip = !(PW && probe && probe.status === 0) && 'Playwright + Chromium are not available (set OCTOPUS_LENDER=<node_modules with playwright>)';

test('browser: Esc, Enter, focus return, queueing, typeToConfirm, escaping, toast region, mobile sheet', { skip }, async () => {
  module.paths.unshift(PW);
  const { chromium } = require(path.join(PW, 'playwright'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlg-'));
  fs.copyFileSync(jsPath, path.join(dir, 'dialog.js'));
  fs.copyFileSync(path.join(root, 'ui/dialog.css'), path.join(dir, 'dialog.css'));
  fs.writeFileSync(path.join(dir, 'p.html'), `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="dialog.css"><body><button id="t">trigger</button><script src="dialog.js"></script>`);
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('file://' + path.join(dir, 'p.html'));
    const focusId = () => page.evaluate(() => document.activeElement && document.activeElement.id);

    // Esc cancels confirm, focus returns to the trigger.
    await page.focus('#t');
    await page.evaluate(() => { window.r = oDialog.confirm({ title: 'Del?', body: '<b>x</b>' }); });
    await page.waitForSelector('dialog[open]');
    assert.equal(await page.textContent('.o-dialog__body'), '<b>x</b>');
    assert.equal(await page.locator('.o-dialog__body b').count(), 0, 'body escaped');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.r), false);
    assert.equal(await focusId(), 't');
    assert.equal(await page.locator('dialog').count(), 0);

    // Enter confirms (focus starts on OK); html:true renders markup.
    await page.evaluate(() => { window.r = oDialog.confirm({ body: '<b>x</b>', html: true }); });
    await page.waitForSelector('dialog[open]');
    assert.equal(await page.locator('.o-dialog__body b').count(), 1);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.r), true);

    // prompt: value on Enter, null on Esc, required blocks empty.
    await page.evaluate(() => { window.r = oDialog.prompt({ label: 'Name', value: 'ab', required: true }); });
    await page.waitForSelector('dialog[open] input');
    await page.fill('dialog input', '');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('dialog[open]').count(), 1, 'required keeps it open');
    await page.fill('dialog input', 'zed');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.r), 'zed');
    await page.evaluate(() => { window.r = oDialog.prompt({ label: 'Name' }); });
    await page.waitForSelector('dialog[open] input');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.r), null);

    // Queue: two calls, never two dialogs at once; answered in order.
    await page.evaluate(() => { window.q = [oDialog.confirm({ title: 'one' }), oDialog.confirm({ title: 'two' })]; });
    await page.waitForSelector('dialog[open]');
    assert.equal(await page.locator('dialog').count(), 1);
    assert.equal(await page.textContent('.o-dialog__title'), 'one');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.o-dialog__title') && document.querySelector('.o-dialog__title').textContent === 'two');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => Promise.all(window.q)), [true, false]);

    // typeToConfirm gates the confirm button.
    await page.evaluate(() => { window.r = oDialog.confirm({ title: 'Nuke', danger: true, confirmLabel: 'Delete', typeToConfirm: 'nuke' }); });
    await page.waitForSelector('dialog[open]');
    assert.equal(await page.isDisabled('.o-dialog__ok'), true);
    await page.keyboard.type('nuk');
    assert.equal(await page.isDisabled('.o-dialog__ok'), true);
    await page.keyboard.type('e');
    assert.equal(await page.isDisabled('.o-dialog__ok'), false);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.r), true);

    // Focus is trapped: Tab never leaves the dialog.
    await page.evaluate(() => { window.r = oDialog.confirm({ title: 't' }); });
    await page.waitForSelector('dialog[open]');
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true);
    }
    await page.keyboard.press('Escape');

    // Toast: polite live region, escaped, auto-removes, button to dismiss.
    await page.evaluate(() => oDialog.toast('<i>hi</i>', { kind: 'danger', timeout: 300 }));
    await page.waitForSelector('.o-toast');
    assert.equal(await page.getAttribute('.o-toast-region', 'aria-live'), 'polite');
    assert.equal(await page.textContent('.o-dialog-toast__msg'), '<i>hi</i>');
    await page.waitForFunction(() => !document.querySelector('.o-toast'));

    // Sticky toast (timeout 0) stays until its 44px close button is used.
    await page.evaluate(() => oDialog.toast('not saved', { kind: 'danger', timeout: 0 }));
    await page.waitForSelector('.o-toast');
    await page.waitForTimeout(600);
    assert.equal(await page.locator('.o-toast').count(), 1);
    assert.ok((await page.locator('.o-dialog-toast__close').boundingBox()).height >= 44);
    await page.click('.o-dialog-toast__close');
    assert.equal(await page.locator('.o-toast').count(), 0);

    // Mobile: bottom sheet, 44px buttons, 16px input.
    await page.setViewportSize({ width: 390, height: 800 });
    await page.evaluate(() => { window.r = oDialog.prompt({ label: 'L' }); });
    await page.waitForSelector('dialog[open] input');
    await page.waitForTimeout(400); // slide-in animation
    const m = await page.evaluate(() => {
      const d = document.querySelector('dialog').getBoundingClientRect();
      const b = document.querySelector('.o-dialog__ok').getBoundingClientRect();
      return { bottom: d.bottom, vh: innerHeight, w: d.width, bh: b.height, fs: getComputedStyle(document.querySelector('dialog input')).fontSize };
    });
    assert.ok(Math.abs(m.bottom - m.vh) < 2 && m.w >= 389, JSON.stringify(m));
    assert.ok(m.bh >= 44);
    assert.equal(m.fs, '16px');
    await page.keyboard.press('Escape');

    // Theme: forcing data-theme changes the dialog colours.
    const bg = async (t) => page.evaluate(async (t) => {
      document.documentElement.setAttribute('data-theme', t);
      const p = oDialog.alert('x');
      await new Promise((r) => setTimeout(r, 50));
      const c = getComputedStyle(document.querySelector('dialog')).backgroundColor;
      document.querySelector('.o-dialog__ok').click(); await p; return c;
    }, t);
    assert.equal(await bg('light'), 'rgb(255, 255, 255)');
    assert.equal(await bg('dark'), 'rgb(22, 26, 33)');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

// ---- ES module build ----------------------------------------------------------------
test('ui/dialog.mjs is up to date with ui/dialog.js and has real named exports', async () => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/build-dialog.mjs'), '--check']);
  assert.equal(r.status, 0, String(r.stderr));
  const m = await import(path.join(root, 'ui/dialog.mjs'));
  for (const k of ['alert', 'confirm', 'prompt', 'toast']) assert.equal(typeof m[k], 'function', k);
  assert.equal(m.default.confirm, m.confirm);
  assert.equal(await m.confirm('x'), false);
});

const viteDir = ['octopus-code', 'octopus-ecom', 'octopus-math', 'octopus-planner']
  .map((r) => path.join(root, '..', r, 'node_modules', 'vite')).find((d) => fs.existsSync(path.join(d, 'package.json')));
test('a real Vite production build resolves the named exports from octopus-kit/ui/dialog.mjs', { skip: !viteDir && 'no vite in a sibling repo' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitedlg-'));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.symlinkSync(root, path.join(dir, 'node_modules', 'octopus-kit'), 'dir');
  fs.writeFileSync(path.join(dir, 'main.js'), "import { alert, confirm, prompt, toast } from 'octopus-kit/ui/dialog.mjs';\nglobalThis.__x = [alert, confirm, prompt, toast].length;\n");
  fs.writeFileSync(path.join(dir, 'index.html'), '<script type="module" src="/main.js"></script>');
  const script = path.join(os.tmpdir(), `vb-${process.pid}.mjs`);
  fs.writeFileSync(script, `import { build } from ${JSON.stringify(path.join(viteDir, 'dist/node/index.js'))};
await build({ root: ${JSON.stringify(dir)}, logLevel: 'error', configFile: false, build: { outDir: 'out', minify: false } });`);
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  fs.unlinkSync(script);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const outs = fs.readdirSync(path.join(dir, 'out/assets')).filter((f) => f.endsWith('.js'));
  assert.ok(outs.length >= 1);
  assert.match(fs.readFileSync(path.join(dir, 'out/assets', outs[0]), 'utf8'), /o-dialog/);
});
