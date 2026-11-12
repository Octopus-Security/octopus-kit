'use strict';
// The static layout checker: each rule must fire on a known-bad sample and stay quiet on the known-good one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.resolve(__dirname, '..', 'bin', 'octopus-check-layout.mjs');
function scan(files, args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-'));
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); }
  const r = spawnSync(process.execPath, [BIN, dir, '--json', ...args], { encoding: 'utf8' });
  const out = JSON.parse(r.stdout || '[]')[0];
  return { status: r.status, rules: out ? out.findings.map((f) => f.rule) : [], findings: out ? out.findings : [] };
}
const GOOD_HEAD = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
const KIT_ISH = 'html{background:#000}body{overflow-x:clip;overflow-wrap:break-word;min-height:100dvh;background:#000}code,kbd{overflow-wrap:anywhere}img,video,svg{max-width:100%}';

test('usage: no directory is exit 2', () => {
  assert.equal(spawnSync(process.execPath, [BIN], { encoding: 'utf8' }).status, 2);
});

test('a clean page with the base rules passes', () => {
  const r = scan({ 'a.css': KIT_ISH, 'v.html': `<html><head>${GOOD_HEAD}</head></html>` });
  assert.deepEqual(r.rules, []);
  assert.equal(r.status, 0);
});

test('viewport: missing viewport-fit, zoom blocking and fixed width are errors; initial-scale=1.0 is fine', () => {
  const bad = (c) => scan({ 'a.css': KIT_ISH, 'v.html': `<meta name="viewport" content="${c}">` });
  assert.ok(bad('width=device-width, initial-scale=1').rules.includes('viewport-cover'));
  assert.ok(bad('width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover').rules.includes('viewport-zoom'));
  assert.ok(bad('width=1024').rules.includes('viewport-zoom'));
  assert.equal(bad('width=device-width, initial-scale=1.0, viewport-fit=cover').rules.length, 0);
  assert.equal(bad('width=device-width, initial-scale=1').status, 1);
});

test('word-break: break-all is an error; overflow-wrap: anywhere is not', () => {
  assert.ok(scan({ 'a.css': KIT_ISH + '.x{word-break:break-all}' }).rules.includes('break-all'));
  assert.ok(!scan({ 'a.css': KIT_ISH + '.x{overflow-wrap:anywhere}' }).rules.includes('break-all'));
});

test('the squeezed-column grid: an auto track beside a flexible one warns, and layout-ok silences it', () => {
  const css = KIT_ISH + '.row{display:grid;grid-template-columns:minmax(0,1fr) auto}';
  assert.ok(scan({ 'a.css': css }).rules.includes('grid-auto-track'));
  assert.ok(!scan({ 'a.css': KIT_ISH + '/* layout-ok: grid-auto-track (children placed explicitly) */\n.row{display:grid;grid-template-columns:minmax(0,1fr) auto}' }).rules.includes('grid-auto-track'));
  assert.ok(!scan({ 'a.css': KIT_ISH + '.row{display:grid;grid-template-columns:minmax(0,1fr)}' }).rules.includes('grid-auto-track'));
});

test('fixed widths, negative margins, inputs under 16px, 100vh without dvh', () => {
  const r = scan({ 'a.css': '.a{width:480px}.ok{width:480px;max-width:100%}.b{margin-left:-24px}.c{margin:-2px}input{font-size:14px}.d{min-height:100vh}' });
  assert.ok(r.rules.includes('fixed-width'));
  assert.equal(r.findings.filter((f) => f.rule === 'fixed-width').length, 1);
  assert.equal(r.findings.filter((f) => f.rule === 'neg-margin').length, 1);
  assert.ok(r.rules.includes('input-font') && r.rules.includes('vh-no-dvh'));
});

test('project-level base rules are missing -> warnings, none of which fail the run unless --strict', () => {
  const r = scan({ 'a.css': '.x{color:red}' });
  for (const k of ['p-body-clip', 'p-html-bg', 'p-wrap', 'p-code-wrap', 'p-media-max', 'p-dvh']) assert.ok(r.rules.includes(k), k);
  assert.equal(r.status, 0);
  assert.equal(scan({ 'a.css': '.x{color:red}' }, ['--strict']).status, 1);
});

test('inline <style> in a template is scanned', () => {
  assert.ok(scan({ 'v.ejs': `${GOOD_HEAD}<style>.x{word-break:break-all}</style>`, 'a.css': KIT_ISH }).rules.includes('break-all'));
});

test('a phone-only or !important 16px input rule clears the smaller sizes; interactive-widget in the viewport is allowed', () => {
  const small = KIT_ISH + 'input{font-size:14px}.q input{font-size:13px}';
  assert.ok(scan({ 'a.css': small }).rules.includes('input-font'));
  const fixed = small + '@media (max-width:640px){input:not([type="checkbox"]), select, textarea{font-size:16px !important}}';
  assert.ok(!scan({ 'a.css': fixed }).rules.includes('input-font'));
  assert.equal(scan({ 'a.css': KIT_ISH, 'v.html': '<meta name="viewport" content="width=device-width, initial-scale=1.0, interactive-widget=resizes-content, viewport-fit=cover">' }).rules.length, 0);
});
