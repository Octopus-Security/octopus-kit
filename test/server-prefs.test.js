'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../server/prefs');
const { fakeRes } = require('./helpers');

const cookie = obj => `octopus_prefs=${encodeURIComponent(JSON.stringify(obj))}`;
const DEF = { v: 1, mode: 'dark', accent: 'app', density: 'comfortable' };

test('a valid cookie is read back', () => {
  const p = P.parseCookieHeader(`a=b; ${cookie({ v: 1, mode: 'light', accent: '#AABBCC', density: 'compact' })}; c=d`);
  assert.deepStrictEqual(p, { v: 1, mode: 'light', accent: '#aabbcc', density: 'compact' });
});

test('no cookie, no header, other cookies: defaults', () => {
  for (const h of [undefined, '', 'a=b', 'octopus_prefs_x=1']) assert.deepStrictEqual(P.parseCookieHeader(h), DEF);
  assert.deepStrictEqual(P.readPrefs({}), DEF);
});

test('malformed input falls back to defaults — never an error, never an echo', () => {
  const bad = [
    'octopus_prefs=%E0%A4%A',                       // bad percent-encoding
    'octopus_prefs=not-json',
    `octopus_prefs=${encodeURIComponent('[1,2]')}`,
    `octopus_prefs=${encodeURIComponent('"str"')}`,
    `octopus_prefs=${encodeURIComponent('null')}`,
    `octopus_prefs=${encodeURIComponent(JSON.stringify({ v: 2, mode: 'light' }))}`,
    `octopus_prefs=${'a'.repeat(600)}`,
    `octopus_prefs=${encodeURIComponent(JSON.stringify({ v: 1, mode: 'x'.repeat(5000) }))}`,
  ];
  for (const h of bad) assert.deepStrictEqual(P.parseCookieHeader(h), DEF, h.slice(0, 40));
});

test('each field is validated independently: a bad one defaults, the good ones survive', () => {
  assert.deepStrictEqual(P.sanitize({ v: 1, mode: 'neon', accent: '#12345', density: 'compact' }),
    { v: 1, mode: 'dark', accent: 'app', density: 'compact' });
  assert.deepStrictEqual(P.sanitize({ mode: 'system', accent: 'red', density: 'huge' }), { v: 1, mode: 'system', accent: 'app', density: 'comfortable' });
});

test('hex accent is exactly #rrggbb: no short form, no alpha, no css injection', () => {
  for (const a of ['#fff', '#ffffffff', 'ffffff', '#gggggg', '#12345g', 'red', 'url(x)', '#aabbcc;color:red', '#aabbcc"><script>', 7, null, {}]) {
    assert.strictEqual(P.sanitize({ accent: a }).accent, 'app', String(a));
  }
  assert.strictEqual(P.sanitize({ accent: '#0A1b2C' }).accent, '#0a1b2c');
});

test('themeLocals only ever emits whitelisted values', () => {
  const t = P.themeLocals({ mode: 'light', accent: '#112233', density: 'compact' });
  assert.strictEqual(t.htmlAttrs, 'data-theme="light" data-density="compact"');
  assert.strictEqual(t.accentStyle, '--o-accent:#112233');
  const evil = P.themeLocals({ mode: '"><script>', accent: '"><script>', density: '"><script>' });
  assert.ok(!/[<>"]{2}/.test(evil.htmlAttrs.replace(/="[a-z]+"/g, '')));
  assert.strictEqual(evil.htmlAttrs, 'data-theme="dark" data-density="comfortable"');
  assert.strictEqual(evil.accentStyle, '', 'accent "app" leaves the app colour alone');
});

test('middleware sets res.locals.theme, and survives a throwing cookie reader', () => {
  const res = fakeRes(); let n = 0;
  P.middleware()({ headers: { cookie: cookie({ v: 1, mode: 'light' }) } }, res, () => n++);
  assert.strictEqual(res.locals.theme.dataTheme, 'light'); assert.strictEqual(n, 1);
  const res2 = fakeRes();
  P.middleware()({ get headers() { throw new Error('boom'); } }, res2, () => n++);
  assert.strictEqual(res2.locals.theme.dataTheme, 'dark'); assert.strictEqual(n, 2);
});

test('serializePrefsCookie: non-HttpOnly, Secure, SameSite=Lax, long Max-Age, domain; round-trips', () => {
  const c = P.serializePrefsCookie({ mode: 'light', accent: '#aabbcc', density: 'compact' }, { domain: '.example.test' });
  assert.match(c, /^octopus_prefs=/);
  assert.match(c, /; Path=\//);
  assert.match(c, /; Domain=\.example\.test/);
  assert.match(c, /; Max-Age=31536000/);
  assert.match(c, /; Secure/);
  assert.match(c, /; SameSite=Lax$/);
  assert.doesNotMatch(c, /HttpOnly/i);
  assert.deepStrictEqual(P.parseCookieHeader(c.split(';')[0]), { v: 1, mode: 'light', accent: '#aabbcc', density: 'compact' });
});

test('serializePrefsCookie: invalid prefs are sanitised, invalid domains refused, secure can be off for dev', () => {
  const c = P.serializePrefsCookie({ mode: 'x' });
  assert.deepStrictEqual(P.parseCookieHeader(c.split(';')[0]), DEF);
  assert.ok(!/Domain=/.test(c));
  for (const d of ['evil.test; Path=/x', 'a b', 'x\r\nSet-Cookie: y=1', '.', '-bad']) assert.throws(() => P.serializePrefsCookie({}, { domain: d }), /invalid domain/, d);
  assert.ok(!/Secure/.test(P.serializePrefsCookie({}, { secure: false })));
  assert.match(P.serializePrefsCookie({}, { maxAge: 60 }), /Max-Age=60/);
});
