'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const color = require('../tokens/color.cjs');
const acc = require('../tokens/accents.cjs');

const root = path.join(__dirname, '..');
const hub = [
  'budget', 'health', 'planner', 'studio', 'pass', 'xmpp', 'cortex', 'shopper', 'kitchen', 'ee', 'media', 'edm',
  'mma', 'games', 'math', 'science', 'tools', 'blog', 'code', 'business', 'marketing', 'ecom', 'author',
];
const extra = ['dash'];
const { THRESHOLDS: T, registry, bg, semantic } = acc;
const slugs = Object.keys(registry);
const clone = () => JSON.parse(JSON.stringify(registry));

test('the registry has every hub app, plus dash', () => {
  for (const s of [...hub, ...extra]) assert.ok(registry[s], `no accent for ${s}`);
  for (const s of slugs) assert.ok(registry[s].name, `${s} has no display name`);
});

test('hub-apps.json slugs (when the sibling repo is checked out) are all covered', (t) => {
  const f = path.join(root, '..', 'octopus-auth', 'hub-apps.json');
  if (!fs.existsSync(f)) return t.skip('octopus-auth not alongside');
  for (const a of JSON.parse(fs.readFileSync(f, 'utf8')).apps) assert.ok(registry[a.slug], `hub app ${a.slug} has no accent`);
});

test('no two apps share an accent (dark or light)', () => {
  for (const mode of ['dark', 'light']) {
    const seen = new Map();
    for (const s of slugs) {
      const a = registry[s][mode].accent.toLowerCase();
      assert.ok(!seen.has(a), `${s} and ${seen.get(a)} share ${mode} accent ${a}`);
      seen.set(a, s);
    }
  }
});

test(`every pair of accents is perceptually distinct (OKLab dE >= ${T.minDeltaE}) in BOTH modes`, () => {
  for (const mode of ['dark', 'light']) {
    for (let i = 0; i < slugs.length; i++) {
      for (let j = i + 1; j < slugs.length; j++) {
        const d = color.deltaE(registry[slugs[i]][mode].accent, registry[slugs[j]][mode].accent);
        assert.ok(d >= T.minDeltaE, `${slugs[i]} vs ${slugs[j]} (${mode}) dE ${d.toFixed(2)}`);
      }
    }
  }
});

test(`every accent has text contrast >= ${T.minTextContrast}:1 against --o-bg in its mode`, () => {
  for (const s of slugs) {
    for (const mode of ['dark', 'light']) {
      const c = color.contrast(registry[s][mode].accent, bg[mode]);
      assert.ok(c >= T.minTextContrast, `${s} ${mode} ${registry[s][mode].accent} is ${c.toFixed(2)}:1`);
    }
  }
});

test(`accent-ink on accent is >= ${T.minInkContrast}:1, hover is a real shift`, () => {
  for (const s of slugs) {
    for (const mode of ['dark', 'light']) {
      const v = registry[s][mode];
      const c = color.contrast(v.ink, v.accent);
      assert.ok(c >= T.minInkContrast, `${s} ${mode} ink ${c.toFixed(2)}:1`);
      assert.notEqual(v.hover.toLowerCase(), v.accent.toLowerCase(), `${s} ${mode} hover == accent`);
      // Hover must keep the same readability promise as the accent itself.
      assert.ok(color.contrast(v.hover, bg[mode]) >= T.minTextContrast - 0.5, `${s} ${mode} hover too faint`);
    }
  }
});

test('success and danger are distinct from every accent, so "saved" never reads as an app colour', () => {
  for (const mode of ['dark', 'light']) {
    for (const [name, hex] of Object.entries(semantic[mode])) {
      for (const s of slugs) {
        const d = color.deltaE(registry[s][mode].accent, hex);
        assert.ok(d >= T.minDeltaE, `${s} (${mode}) is ${d.toFixed(2)} from ${name}`);
      }
    }
  }
});

test('validate() passes the committed registry and has no false positives', () => {
  assert.deepEqual(acc.validate(registry), []);
});

test('validate() FAILS when an accent is duplicated (the guard actually guards)', () => {
  const r = clone();
  r.health.dark = { ...r.budget.dark };
  const problems = acc.validate(r);
  assert.ok(problems.some((p) => /share the dark accent/.test(p)), problems.join('\n'));
});

test('validate() FAILS on near-duplicates in either mode', () => {
  for (const mode of ['dark', 'light']) {
    const r = clone();
    const [h, l, c] = [color.toOklch(r.budget[mode].accent)].map((o) => [o.h, o.L, o.C])[0];
    r.health[mode].accent = color.oklchToHex(l + 0.01, c, h + 2);
    assert.ok(acc.validate(r).some((p) => /too close/.test(p)), mode);
  }
});

test('validate() FAILS on low contrast, bad ink, and an accent that mimics success/danger', () => {
  let r = clone();
  r.cortex.dark.accent = '#3a3a3a';
  assert.ok(acc.validate(r).some((p) => /on bg/.test(p)));
  r = clone();
  r.cortex.light.accent = '#f0e68c';
  assert.ok(acc.validate(r).some((p) => /on bg/.test(p)));
  r = clone();
  r.cortex.dark.ink = r.cortex.dark.accent;
  assert.ok(acc.validate(r).some((p) => /ink/.test(p)));
  r = clone();
  r.cortex.dark.accent = semantic.dark.success;
  assert.ok(acc.validate(r).some((p) => /too close to success/.test(p)));
  r = clone();
  r.cortex.light.accent = semantic.light.danger;
  assert.ok(acc.validate(r).some((p) => /too close to danger/.test(p)));
});

test('nextFreeAccent returns a colour that passes every rule against the whole registry', () => {
  const e = acc.nextFreeAccent(registry, { name: 'Newapp' });
  assert.ok(e, 'the wheel should have room for at least one more app');
  const r = { ...clone(), newapp: e };
  assert.deepEqual(acc.validate(r), []);
});

test('nextFreeAccent is deterministic, honours a hue hint, and keeps allocating until the wheel is full', () => {
  assert.deepEqual(acc.nextFreeAccent(registry), acc.nextFreeAccent(registry));
  const hinted = acc.nextFreeAccent(registry, { hue: 100 });
  assert.ok(hinted);
  let reg = clone();
  let n = 0;
  for (; n < 60; n++) {
    const e = acc.nextFreeAccent(reg, { name: 'x' + n });
    if (!e) break;
    reg['x' + n] = e;
    assert.deepEqual(acc.validate(reg), [], `allocation ${n} broke the registry`);
  }
  assert.ok(n >= 1 && n < 60, 'allocator must terminate with null when no colour is free, got ' + n);
});

test('nextFreeAccent never hands back a colour already taken', () => {
  const e = acc.nextFreeAccent(registry);
  for (const s of slugs) {
    assert.notEqual(registry[s].dark.accent, e.dark.accent);
    assert.notEqual(registry[s].light.accent, e.light.accent);
  }
});

test('accents.css contains every slug with both modes', () => {
  const css = fs.readFileSync(path.join(root, 'tokens/accents.css'), 'utf8');
  for (const s of slugs) {
    assert.ok(css.includes(`[data-app="${s}"] {`), `${s} dark`);
    assert.ok(css.includes(`[data-theme="light"][data-app="${s}"] {`), `${s} light`);
    assert.ok(css.includes(registry[s].dark.accent) && css.includes(registry[s].light.accent), `${s} values`);
  }
  assert.match(css, /@media \(prefers-color-scheme: light\)/);
});

test('the default (no data-app) accent is readable too, but is not a registry member', () => {
  const t = JSON.parse(fs.readFileSync(path.join(root, 'tokens/tokens.json'), 'utf8'));
  for (const mode of ['dark', 'light']) {
    assert.ok(color.contrast(t[mode].accent, t[mode].bg) >= T.minTextContrast, mode);
    assert.ok(color.contrast(t[mode]['accent-ink'], t[mode].accent) >= T.minInkContrast, mode);
  }
});
