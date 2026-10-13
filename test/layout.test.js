'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = JSON.parse(read('tokens/tokens.json'));
const BP = { sm: 480, md: 768, lg: 1024, xl: 1280 };
const UI = ['base.css', 'components.css', 'layout.css'].map((f) => `ui/${f}`);

/** Flatten CSS into [{ selector, body, ctx }] where ctx is the chain of enclosing at-rule preludes. */
function rules(css) {
  const out = []; const stack = []; let buf = ''; let i = 0;
  const text = strip(css);
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      const head = buf.trim(); buf = '';
      if (head.startsWith('@')) { stack.push({ at: head, body: null }); } else { stack.push({ rule: head, body: '' }); }
    } else if (c === '}') {
      const top = stack.pop();
      if (top && top.rule !== undefined) out.push({ selector: top.rule, body: top.body, ctx: stack.map((s) => s.at).filter(Boolean) });
      buf = '';
    } else {
      const top = stack[stack.length - 1];
      if (top && top.rule !== undefined) top.body += c; else buf += c;
    }
  }
  return out;
}

test('layout.css, o-shell.js and the preview exist and the CSS tokenises (braces balanced)', async () => {
  const { validateCss } = await import('../scripts/build-channel.mjs');
  for (const f of UI) assert.deepEqual(validateCss(read(f)), [], f);
  const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: read('blocks/o-shell.js'), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(read('docs/preview.html').includes('../ui/layout.css'));
  for (const cls of ['o-shell', 'o-page', 'o-grid', 'o-cluster', 'o-table--cards', 'o-table-wrap', 'o-fixed-bar', 'o-modal']) assert.ok(read('docs/preview.html').includes(cls), cls);
  assert.match(read('docs/preview.html'), /390, 768 and 1280/);
});

test('breakpoint tokens, custom-media comments, media queries, preset and script all agree', () => {
  for (const [n, v] of Object.entries(BP)) {
    assert.equal(tokens.shared[`bp-${n}`], `${v}px`, `tokens.json bp-${n}`);
    assert.match(read('tokens/tokens.css'), new RegExp(`--o-bp-${n}: ${v}px;`));
  }
  const layout = read('ui/layout.css');
  const cm = Object.fromEntries([...layout.matchAll(/@custom-media --o-(\w+) \(min-width: (\d+)px\)/g)].map((m) => [m[1], +m[2]]));
  assert.deepEqual(cm, BP);
  const preset = require('../tokens/tailwind-preset.cjs').theme.extend.screens;
  assert.deepEqual(preset, { sm: '480px', md: '768px', lg: '1024px', xl: '1280px' });
  const allowed = new Set(Object.values(BP));
  for (const f of [...UI, 'blocks/o-shell.js', 'docs/layout.md', 'docs/theming.md', 'docs/delivery.md']) {
    const text = read(f);
    for (const m of text.matchAll(/\(\s*(min|max)-width:\s*([\d.]+)px\s*\)/g)) {
      if (f.endsWith('.md') && m[1] === 'max') continue;
      assert.equal(m[1], 'min', `${f}: only min-width queries (${m[0]})`);
      assert.ok(allowed.has(+m[2]), `${f}: ${m[0]} is not a kit breakpoint`);
    }
  }
  assert.ok(read('blocks/o-shell.js').includes('(min-width: 768px)'));
  assert.ok(read('docs/layout.md').includes('480') && read('docs/layout.md').includes('1280'));
});

test('form controls have the 16px floor and a 44px target; touch bump exists', () => {
  const comp = strip(read('ui/components.css'));
  const ctl = rules(comp).find((r) => r.selector.startsWith('.o-input, .o-select, .o-textarea'));
  assert.match(ctl.body, /font-size:\s*max\(16px,\s*1rem\)/);
  assert.match(ctl.body, /min-height:\s*var\(--o-tap\)/);
  assert.equal(tokens.shared.tap, '44px');
  assert.match(rules(comp).find((r) => r.selector === '.o-btn').body, /min-height:\s*var\(--o-tap\)/);
  assert.ok(rules(comp).some((r) => r.ctx.some((c) => /pointer:\s*coarse/.test(c)) && /\.o-btn--icon/.test(r.selector)));
});

test('every :hover rule sits inside @media (hover: hover)', () => {
  let n = 0;
  for (const f of UI) {
    for (const r of rules(read(f))) {
      if (!/:hover/.test(r.selector)) continue;
      n++;
      assert.ok(r.ctx.some((c) => /\(\s*hover:\s*hover\s*\)/.test(c)), `${f}: ${r.selector} is hover-only`);
    }
  }
  assert.ok(n > 5, 'expected hover rules to exist');
});

test('every position:fixed rule carries env(safe-area-inset-*) (full-bleed scrim excepted)', () => {
  const EXEMPT = new Set(['.o-shell__scrim']); // a content-less overlay: nothing to inset
  let n = 0;
  for (const f of UI) {
    for (const r of rules(read(f))) {
      if (!/position:\s*fixed/.test(r.body) || EXEMPT.has(r.selector)) continue;
      n++;
      assert.match(r.body, /env\(safe-area-inset-/, `${f}: ${r.selector} is fixed without a safe-area inset`);
    }
  }
  assert.ok(n >= 4, `expected the nav, bar, toast region and modal scrim, saw ${n}`);
});

test('100vh is always paired with a 100dvh declaration', () => {
  for (const f of UI) {
    for (const r of rules(read(f))) {
      if (/100vh/.test(r.body)) assert.match(r.body, /100dvh/, `${f}: ${r.selector} uses 100vh with no dvh`);
    }
  }
});

test('layout.css provides every documented class', () => {
  const css = read('ui/layout.css');
  for (const sel of ['.o-shell', '.o-shell__toggle', '.o-shell__header', '.o-shell__nav', '.o-shell__scrim', '.o-shell__main', '.o-shell--top',
    '.o-page', '.o-nofit', '.o-stack--sm', '.o-cluster', '.o-grid', '.o-table-wrap', '.o-table--cards', 'dialog.o-modal', '.o-fixed-bar', '.o-toast-region', '.o-screen']) {
    assert.ok(css.includes(sel), sel);
  }
  assert.match(css, /min-height:\s*100vh;\s*min-height:\s*100dvh/);
  assert.match(css, /\.o-page :where\(img, video, svg\)\s*\{\s*max-width:\s*100%/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
});

test('the drawer is reachable without JS: checkbox + labels, no script required', () => {
  const css = read('ui/layout.css');
  assert.match(css, /\.o-shell__toggle:checked ~ \.o-shell__nav/);
  assert.match(css, /visibility:\s*hidden/);
  assert.doesNotMatch(read('docs/layout.md'), /<script[^>]*o-shell[^>]*>\s*<\/script>\s*<!--\s*required/i);
});

test('the kit serves layout.css (kitAssets) and the channel publishes it with the shell script', async () => {
  const { kitAssets } = require('../server/kit-assets.js');
  const h = kitAssets();
  assert.match(h.url('/ui/layout.css'), /^\/kit\/ui\/layout\.css\?v=[0-9a-f]{8}$/);
  const res = await new Promise((resolve) => {
    const headers = {}; let body = '';
    h({ method: 'GET', url: '/ui/layout.css', path: '/ui/layout.css' }, { setHeader: (k, v) => { headers[k] = v; }, end: (b) => resolve({ headers, body: String(b) }) }, () => resolve(null));
  });
  assert.ok(res && res.body.includes('.o-shell'));
  assert.match(res.headers['Content-Type'], /text\/css/);
  const { channelFiles } = await import('../scripts/build-channel.mjs');
  const pub = channelFiles().map((p) => p[0]);
  assert.ok(pub.includes('layout.css') && pub.includes('blocks/o-shell.js'));
  const pkg = require('../package.json');
  assert.ok(pkg.files.includes('ui') && pkg.files.includes('blocks'));
  assert.ok(read('docs/delivery.md').includes('/v0/layout.css') && read('docs/delivery.md').includes('/v0/blocks/o-shell.js'));
});
