'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { source, inlineTag } = require('../tokens/theme-boot.cjs');
const { contrast, parseHex } = require('../tokens/color.cjs');

// Run the boot source against a fake document; return what it did to <html>.
function run(cookie, { lightOS = false, throwing = false } = {}) {
  const attrs = {}, props = {};
  const root = {
    setAttribute: (k, v) => { if (throwing) throw new Error('boom'); attrs[k] = v; },
    style: { setProperty: (k, v) => { if (throwing) throw new Error('boom'); props[k] = v; } },
  };
  const document = { documentElement: root, cookie };
  const matchMedia = () => ({ matches: lightOS });
  vm.runInNewContext(source, { document, matchMedia });
  return { attrs, props };
}
const prefs = (o) => 'octopus_prefs=' + encodeURIComponent(JSON.stringify(o));

test('applies mode and density', () => {
  const r = run(prefs({ v: 1, mode: 'light', accent: 'app', density: 'compact' }));
  assert.deepEqual(r.attrs, { 'data-theme': 'light', 'data-density': 'compact' });
  assert.deepEqual(r.props, {});
});

test('accent "app" leaves the app colour alone', () => {
  const r = run(prefs({ v: 1, mode: 'dark', accent: 'app', density: 'comfortable' }));
  assert.equal(Object.keys(r.props).length, 0);
});

test('hex accent sets accent, hover and ink inline', () => {
  const r = run(prefs({ v: 1, mode: 'dark', accent: '#3366CC', density: 'comfortable' }));
  assert.equal(r.props['--o-accent'], '#3366cc');
  assert.match(r.props['--o-accent-hover'], /^#[0-9a-f]{6}$/);
  assert.match(r.props['--o-accent-ink'], /^#[0-9a-f]{6}$/);
  // dark mode: hover is lighter than the accent
  const sum = (h) => parseHex(h).reduce((a, b) => a + b, 0);
  assert.ok(sum(r.props['--o-accent-hover']) > sum('#3366cc'));
});

test('hover darkens in light mode, including "system" on a light OS', () => {
  const sum = (h) => parseHex(h).reduce((a, b) => a + b, 0);
  const l = run(prefs({ v: 1, mode: 'light', accent: '#3366cc' }));
  assert.ok(sum(l.props['--o-accent-hover']) < sum('#3366cc'));
  const s = run(prefs({ v: 1, mode: 'system', accent: '#3366cc' }), { lightOS: true });
  assert.ok(sum(s.props['--o-accent-hover']) < sum('#3366cc'));
  const d = run(prefs({ v: 1, mode: 'system', accent: '#3366cc' }), { lightOS: false });
  assert.ok(sum(d.props['--o-accent-hover']) > sum('#3366cc'));
});

test('ink is chosen by luminance and always readable on the accent', () => {
  for (const hex of ['#ffffff', '#000000', '#ffd400', '#102040', '#3366cc', '#e0457b']) {
    const r = run(prefs({ v: 1, mode: 'dark', accent: hex }));
    assert.ok(contrast(r.props['--o-accent-ink'], hex) >= 4.5, `ink on ${hex}`);
  }
  // Mid-greys cannot reach 4.5 with either ink; the snippet must still pick the better one.
  const grey = run(prefs({ v: 1, accent: '#777777' })).props['--o-accent-ink'];
  assert.ok(contrast(grey, '#777777') >= Math.max(contrast('#0b0d10', '#777777'), contrast('#ffffff', '#777777')) - 1e-9);
  assert.equal(run(prefs({ v: 1, accent: '#ffd400' })).props['--o-accent-ink'], '#0b0d10');
  assert.equal(run(prefs({ v: 1, accent: '#102040' })).props['--o-accent-ink'], '#ffffff');
});

test('rejects malformed accents (injection attempts included)', () => {
  const bad = ['#fff', '#12345', '#1234567', 'red', 'url(x)', '#zzzzzz', '#ffffff;}body{display:none', '#ffffff\n',
    ' #ffffff', '#ffffff ', 'javascript:1', 5, null, {}, ['#ffffff'], '"><script>', 'var(--x)', 'expression(1)'];
  for (const accent of bad) {
    const r = run(prefs({ v: 1, mode: 'dark', accent }));
    assert.equal(Object.keys(r.props).length, 0, JSON.stringify(accent));
  }
});

test('whitelists mode and density independently', () => {
  const r = run(prefs({ v: 1, mode: '"><img onerror=x>', density: 'huge', accent: '#112233' }));
  assert.deepEqual(r.attrs, {});
  assert.ok(r.props['--o-accent']);
  const r2 = run(prefs({ v: 1, mode: 'system', density: 'sparse' }));
  assert.deepEqual(r2.attrs, { 'data-theme': 'system' });
  for (const mode of ['Dark', 'LIGHT', '', null, 1, ['dark'], 'dark ']) {
    assert.deepEqual(run(prefs({ v: 1, mode })).attrs, {}, JSON.stringify(mode));
  }
});

test('never throws on junk cookies, and does nothing', () => {
  const junk = ['', 'a=b', 'octopus_prefs=', 'octopus_prefs=%E0%A4%A', 'octopus_prefs=notjson', 'octopus_prefs=' + encodeURIComponent('null'),
    'octopus_prefs=' + encodeURIComponent('[]'), 'octopus_prefs=' + encodeURIComponent('"str"'), 'octopus_prefs=' + encodeURIComponent('5'),
    prefs({ mode: 'dark' }), prefs({ v: 2, mode: 'dark' }), 'x=1; octopus_prefs=%7B', undefined];
  for (const cookie of junk) {
    const r = run(cookie);
    assert.deepEqual(r.attrs, {}, String(cookie));
    assert.deepEqual(r.props, {}, String(cookie));
  }
});

test('survives a hostile DOM (setAttribute / setProperty throwing) and a missing documentElement', () => {
  assert.doesNotThrow(() => run(prefs({ v: 1, mode: 'dark', density: 'compact', accent: '#112233' }), { throwing: true }));
  assert.doesNotThrow(() => vm.runInNewContext(source, { document: { cookie: prefs({ v: 1, mode: 'dark' }) } }));
  assert.doesNotThrow(() => vm.runInNewContext(source, {}));
});

test('reads the cookie among others and ignores lookalike names', () => {
  const c = 'a=1; xoctopus_prefs=' + encodeURIComponent('{"v":1,"mode":"light"}') + '; ' + prefs({ v: 1, mode: 'dark' }) + '; z=2';
  assert.deepEqual(run(c).attrs, { 'data-theme': 'dark' });
  assert.deepEqual(run('xoctopus_prefs=' + encodeURIComponent('{"v":1,"mode":"light"}')).attrs, {});
});

test('source is dependency-free and safe to inline', () => {
  assert.ok(source.length < 2500, 'stay tiny: ' + source.length);
  assert.doesNotMatch(source, /<\/script/i);
  assert.doesNotMatch(source, /\b(require|import|fetch|XMLHttpRequest|eval)\b/);
  assert.doesNotMatch(source, /innerHTML|document\.write/);
});

test('inlineTag builds a script, validates the nonce', () => {
  assert.equal(inlineTag(), `<script>${source}</script>`);
  assert.equal(inlineTag('abc123+/=_-'), `<script nonce="abc123+/=_-">${source}</script>`);
  for (const bad of ['a"b', '<x>', 'a b', 'a\nb', 'x'.repeat(200), 5, {}]) {
    assert.throws(() => inlineTag(bad), TypeError, JSON.stringify(bad));
  }
});
