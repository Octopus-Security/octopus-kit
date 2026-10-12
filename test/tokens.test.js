'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const tokens = JSON.parse(read('tokens/tokens.json'));
const css = read('tokens/tokens.css');

const COLOUR_ROLES = ['bg', 'surface', 'surface-2', 'surface-3', 'border', 'text', 'muted', 'dim',
  'accent', 'accent-hover', 'accent-ink', 'success', 'warn', 'danger', 'info'];
const SCALE = ['radius-sm', 'radius-md', 'radius-lg', 'space-1', 'space-2', 'space-3', 'space-4',
  'space-5', 'space-6', 'font-sans', 'font-mono', 'ease', 'dur'];

test('every contract role exists in both modes', () => {
  for (const mode of ['dark', 'light']) {
    for (const r of [...COLOUR_ROLES, 'shadow-1', 'shadow-2']) {
      assert.ok(tokens[mode][r], `${mode} is missing ${r}`);
    }
  }
  for (const r of SCALE) assert.ok(tokens.shared[r], `shared is missing ${r}`);
});

test('colours are hex (not named, not rgb) so contrast can be computed', () => {
  for (const mode of ['dark', 'light']) {
    for (const r of COLOUR_ROLES) assert.match(tokens[mode][r], /^#[0-9a-f]{6}$/, `${mode}.${r}`);
  }
});

test('committed CSS equals a fresh generation (no drift)', async () => {
  const { generate } = await import(pathToFileURL(path.join(root, 'scripts/build-tokens.mjs')).href);
  const fresh = generate();
  for (const [file, body] of Object.entries(fresh)) {
    assert.equal(read(file), body, `${file} is stale: run node scripts/build-tokens.mjs`);
  }
});

test('tokens.css: dark on :root, light under data-theme, system/unset follow the media query', () => {
  const rootBlock = css.slice(css.indexOf(':root,'), css.indexOf('}', css.indexOf(':root,')));
  assert.match(rootBlock, /--o-bg: #0f1115/);
  assert.match(rootBlock, /color-scheme: dark/);
  assert.match(css, /\n\[data-theme="light"\] \{/);
  assert.match(css, /@media \(prefers-color-scheme: light\) \{\s*:root:not\(\[data-theme="dark"\]\):not\(\[data-theme="light"\]\)/);
  assert.match(css, /\n\[data-density="compact"\] \{/);
});

test('the explicit-dark choice is not overridden by the media query', () => {
  // The auto-light selector must exclude data-theme="dark", or a dark pick on a light OS would flip.
  const media = css.slice(css.indexOf('@media'), css.indexOf('\n[data-theme="light"]'));
  assert.ok(media.includes(':not([data-theme="dark"])'));
});

test('light block redefines every colour role the dark block defines', () => {
  const light = css.slice(css.indexOf('\n[data-theme="light"] {'));
  const block = light.slice(0, light.indexOf('}'));
  for (const r of [...COLOUR_ROLES, 'shadow-1', 'shadow-2']) {
    assert.ok(block.includes(`--o-${r}:`), `light block lacks --o-${r}`);
  }
});

test('compact density tightens space and radius, and only those', () => {
  const i = css.indexOf('\n[data-density="compact"]');
  const block = css.slice(i, css.indexOf('}', i));
  const names = [...block.matchAll(/--o-([a-z0-9-]+):/g)].map((m) => m[1]);
  assert.ok(names.length > 0);
  for (const n of names) assert.match(n, /^(space|radius)-/);
  const px = (v) => parseInt(v, 10);
  for (const n of names) assert.ok(px(tokens.compact[n]) < px(tokens.shared[n]), `${n} not tighter`);
});

test('base dark palette stays close to the suite look', () => {
  const { toOklab } = require('../tokens/color.cjs');
  assert.ok(toOklab(tokens.dark.bg)[0] < 0.2, 'dark bg should be near black');
  assert.equal(tokens.light.bg, '#f5f5f0');
  assert.equal(tokens.light.surface, '#ffffff');
  assert.equal(tokens.light.text, '#1a1a1a');
});

test('text roles meet WCAG AA on their own background in both modes', () => {
  const { contrast } = require('../tokens/color.cjs');
  for (const mode of ['dark', 'light']) {
    const t = tokens[mode];
    for (const bg of ['bg', 'surface', 'surface-2']) {
      assert.ok(contrast(t.text, t[bg]) >= 7, `${mode} text on ${bg}`);
      assert.ok(contrast(t.muted, t[bg]) >= 4.5, `${mode} muted on ${bg}`);
    }
    for (const r of ['success', 'warn', 'danger', 'info']) {
      assert.ok(contrast(t[r], t.bg) >= 4.5, `${mode} ${r} on bg`);
      assert.ok(contrast(t[r], t.surface) >= 4.5, `${mode} ${r} on surface`);
    }
  }
});

test('tailwind preset maps the named colours to --o-* variables', () => {
  const preset = require('../tokens/tailwind-preset.cjs');
  const c = preset.theme.extend.colors;
  for (const k of ['bg', 'surface', 'border', 'text', 'muted', 'accent', 'success', 'warn', 'danger', 'info']) {
    const v = c[k];
    const s = typeof v === 'string' ? v : v.DEFAULT;
    assert.match(s, /^var\(--o-[a-z0-9-]+\)$/, k);
    assert.ok(css.includes(s.slice(4, -1) + ':'), `${k} points at a token tokens.css does not define`);
  }
});
