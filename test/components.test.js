'use strict';
// Guards for the component set documented in docs/components.md: every class a demo fragment uses is
// styled, every demo is documented and in the generated preview, and the shared rules hold.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const css = ['base.css', 'components.css', 'layout.css'].map((f) => strip(read(`ui/${f}`))).join('\n');
const demoDir = path.join(root, 'scripts/demos');
const demos = fs.readdirSync(demoDir).filter((f) => f.endsWith('.html')).sort();
const docs = read('docs/components.md');
const preview = read('docs/preview.html');

const classesOf = (html) => new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => /^o-/.test(c)));

test('every demo fragment has a title, uses only styled o- classes, and is documented', () => {
  assert.ok(demos.length >= 1);
  for (const f of demos) {
    const html = read(`scripts/demos/${f}`);
    const title = html.match(/^<!--\s*title:\s*(.+?)\s*-->/);
    assert.ok(title, `${f}: first line must be <!-- title: ... -->`);
    assert.ok(preview.includes(title[1].replace(/&/g, '&amp;').replace(/</g, '&lt;')), `${f}: not in docs/preview.html (run node scripts/build-tokens.mjs)`);
    const used = classesOf(html);
    assert.ok(used.size > 0, `${f}: no o- classes`);
    for (const c of used) {
      assert.ok(css.includes(`.${c}`), `${f}: .${c} is not styled`);
      const mod = c.includes('--') ? `--${c.split('--')[1]}` : c; // modifiers are documented as `--name`
      assert.ok(docs.includes(c) || docs.includes(mod), `${f}: ${c} is not mentioned in docs/components.md`);
    }
  }
});

test('the docs show real markup: every class in a docs html block is styled', () => {
  for (const m of docs.matchAll(/```html\n([\s\S]*?)```/g)) {
    for (const c of classesOf(m[1])) assert.ok(css.includes(`.${c}`), `docs/components.md uses unstyled .${c}`);
  }
});

test('any @keyframes in the ui comes with a prefers-reduced-motion guard', () => {
  if (/@keyframes/.test(css)) assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
