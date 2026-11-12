'use strict';
// The overflow checker: argument handling always; the browser run only where Playwright + Chromium exist.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.resolve(__dirname, '..', 'bin', 'octopus-check-overflow.mjs');
const run = (args, env = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

test('no URL: usage and exit 2', () => {
  const r = run([]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage/);
});

test('a missing browser is an error (exit 2), never a pass', () => {
  const r = run(['file:///nonexistent.html'], { NODE_PATH: '', PLAYWRIGHT_CHROMIUM_PATH: '/nonexistent/chrome' });
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /Playwright is not installed|cannot start Chromium/);
});

function findPlaywright() {
  const kit = path.resolve(__dirname, '..');
  for (const c of [process.env.OCTOPUS_LENDER, path.join(kit, '..', 'octopus-shopper', 'node_modules')].filter(Boolean)) {
    if (fs.existsSync(path.join(c, 'playwright', 'package.json'))) return c;
  }
  return null;
}
const PW = findPlaywright();
const probe = PW && spawnSync(process.execPath, ['-e', `require('playwright').chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH}:{}).then(b=>b.close()).then(()=>process.exit(0),()=>process.exit(1))`], { env: { ...process.env, NODE_PATH: PW } });
const skip = !(PW && probe && probe.status === 0) && 'Playwright + Chromium are not available (set OCTOPUS_LENDER=<node_modules with playwright>)';

test('flags a wide element and passes a contained page', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovf-'));
  const head = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
  // html overflow visible and a hard-wide box: scrollWidth must exceed the viewport.
  fs.writeFileSync(path.join(dir, 'bad.html'), `<!doctype html><html>${head}<body><div id="wide" style="width:600px;height:20px">x</div></body></html>`);
  fs.writeFileSync(path.join(dir, 'good.html'), `<!doctype html><html>${head}<body><div style="max-width:100%;overflow-x:auto"><div style="width:600px">x</div></div><p>hi</p></body></html>`);
  const env = { NODE_PATH: PW };
  const bad = run(['--widths', '320,390', pathToUrl(path.join(dir, 'bad.html'))], env);
  assert.strictEqual(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /OVERFLOW/);
  assert.match(bad.stdout, /div#wide/);
  const good = run(['--widths', '320,390', pathToUrl(path.join(dir, 'good.html'))], env);
  assert.strictEqual(good.status, 0, good.stdout + good.stderr);
});

test('flags text that draws over other text (a squeezed column), and passes the stacked version', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-'));
  const head = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
  const row = (css) => `<!doctype html><html>${head}<body><ul style="list-style:none;padding:0;margin:0"><li style="display:grid;gap:2px 8px;${css}"><button id="name" style="border:0;background:none;padding:0;font:inherit">Figure-4 stretch standing</button><span id="detail">30 s each side - Full-body massage ball session - Swapped for the pigeon pose</span></li></ul></body></html>`;
  fs.writeFileSync(path.join(dir, 'bad.html'), row('grid-template-columns:minmax(0,1fr) auto'));
  fs.writeFileSync(path.join(dir, 'good.html'), row('grid-template-columns:minmax(0,1fr)'));
  const env = { NODE_PATH: PW };
  const bad = run(['--widths', '375', pathToUrl(path.join(dir, 'bad.html'))], env);
  assert.strictEqual(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /OVERLAP/);
  const good = run(['--widths', '375', pathToUrl(path.join(dir, 'good.html'))], env);
  assert.strictEqual(good.status, 0, good.stdout + good.stderr);
});

function pathToUrl(p) { return 'file://' + p; }
