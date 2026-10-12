'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const uiDir = path.join(root, 'ui');
const files = fs.readdirSync(uiDir).filter((f) => f.endsWith('.css'));
const tokensCss = fs.readFileSync(path.join(root, 'tokens/tokens.css'), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

test('ui css files exist', () => {
  assert.ok(files.includes('base.css') && files.includes('components.css'));
});

test('no raw colour literals in ui/*.css (hex, rgb(a), hsl(a), named colours)', () => {
  const named = /(?<![\w-])(white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|cyan|magenta|teal|navy)(?![\w-])\s*[;,)}]/i;
  for (const f of files) {
    const css = strip(fs.readFileSync(path.join(uiDir, f), 'utf8'));
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, `${f}: hex literal`);
    assert.doesNotMatch(css, /\b(rgb|rgba|hsl|hsla|hwb|oklch|oklab|lab|lch)\(/i, `${f}: colour function`);
    assert.doesNotMatch(css, named, `${f}: named colour`);
  }
});

test('every --o-* token the ui uses is defined by tokens.css', () => {
  const defined = new Set([...tokensCss.matchAll(/--o-([a-z0-9-]+):/g)].map((m) => m[1]));
  for (const f of files) {
    const css = fs.readFileSync(path.join(uiDir, f), 'utf8');
    for (const m of css.matchAll(/var\(--o-([a-z0-9-]+)/g)) {
      assert.ok(defined.has(m[1]), `${f} uses undefined --o-${m[1]}`);
    }
  }
});

test('ui uses no non-kit custom properties', () => {
  for (const f of files) {
    const css = fs.readFileSync(path.join(uiDir, f), 'utf8');
    for (const m of css.matchAll(/var\(--(?!o-)([a-z0-9-]+)/g)) assert.fail(`${f} uses var(--${m[1]})`);
  }
});

test('all required components are present with their variants', () => {
  const css = files.map((f) => fs.readFileSync(path.join(uiDir, f), 'utf8')).join('\n');
  for (const sel of ['.o-btn', '.o-btn--primary', '.o-btn--danger', '.o-btn--ghost', '.o-card', '.o-input',
    '.o-select', '.o-textarea', '.o-nav', '.o-table', '.o-badge', '.o-badge--success', '.o-badge--warn',
    '.o-badge--danger', '.o-badge--info', '.o-modal', '.o-toast', '.o-tabs']) {
    assert.ok(css.includes(sel + ' ') || css.includes(sel + ',') || css.includes(sel + '{') || css.includes(sel + ':'), `missing ${sel}`);
  }
});

test('accessible focus: :focus-visible is defined globally and for form controls', () => {
  const base = fs.readFileSync(path.join(uiDir, 'base.css'), 'utf8');
  const comp = fs.readFileSync(path.join(uiDir, 'components.css'), 'utf8');
  assert.match(base, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--o-accent\)/);
  assert.match(comp, /\.o-input:focus-visible/);
  // No rule may remove an outline without replacing it.
  assert.doesNotMatch(strip(comp), /outline:\s*(none|0)\b/);
});

test('base styles the body from tokens and honours reduced motion', () => {
  const base = fs.readFileSync(path.join(uiDir, 'base.css'), 'utf8');
  assert.match(base, /body\s*\{[^}]*background:\s*var\(--o-bg\)/);
  assert.match(base, /body\s*\{[^}]*color:\s*var\(--o-text\)/);
  assert.match(base, /prefers-reduced-motion/);
});

test('the preview page links the kit CSS and shows every component', () => {
  const html = fs.readFileSync(path.join(root, 'docs/preview.html'), 'utf8');
  for (const href of ['../tokens/tokens.css', '../tokens/accents.css', '../ui/base.css', '../ui/components.css']) {
    assert.ok(html.includes(href), href);
  }
  for (const cls of ['o-btn--primary', 'o-btn--danger', 'o-btn--ghost', 'o-card', 'o-input', 'o-select', 'o-textarea',
    'o-nav', 'o-table', 'o-badge--success', 'o-badge--info', 'o-modal', 'o-toast', 'o-tabs']) {
    assert.ok(html.includes(cls), cls);
  }
});
