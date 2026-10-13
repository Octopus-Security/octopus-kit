'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  buildPack, validatePack, canonicalForm, packId, packToDir, packFromDir, webmanifest,
} = require('../brand/pack');

const build = () => buildPack({ slug: 'health', name: 'Health', emoji: '🩺', theme: { color: '#28a1c0', background: '#0b0d10' } });
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('a built pack validates and carries exactly one file, role favicon', () => {
  const pack = build();
  const r = validatePack(pack);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(pack.files.length, 1);
  assert.strictEqual(pack.files[0].role, 'favicon');
  assert.strictEqual(pack.files[0].type, 'image/svg+xml');
});

test('exactly one of emoji/svg is required', () => {
  assert.throws(() => buildPack({ slug: 'x', name: 'X' }), /exactly one/);
  assert.throws(() => buildPack({ slug: 'x', name: 'X', emoji: '🩺', svg: '<svg/>' }), /exactly one/);
});

test('a pack missing the favicon role fails validation', () => {
  const pack = build();
  pack.files = [];
  const r = validatePack(pack);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /files must be a non-empty list/.test(e)));
});

test('a tampered sha256 fails', () => {
  const pack = build();
  pack.files[0].sha256 = '0'.repeat(64);
  const r = validatePack(pack);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /sha256 does not match/.test(e)), r.errors.join('; '));
});

test('tampered bytes fails', () => {
  const pack = build();
  pack.files[0].bytes += 1;
  const r = validatePack(pack);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /bytes does not match/.test(e)), r.errors.join('; '));
});

test('an unknown role fails', () => {
  const pack = build();
  pack.files[0].role = 'banner';
  const r = validatePack(pack);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /role must be one of/.test(e)));
});

test('two files of the same role fails (at most one file per role)', () => {
  const pack = build();
  pack.files.push({ ...pack.files[0], path: 'favicon2.svg' });
  const r = validatePack(pack);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /duplicate role "favicon"/.test(e)));
});

test('a declared type that does not match the role fails', () => {
  const pack = build();
  pack.files[0].type = 'image/png';
  const r = validatePack(pack);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /does not match role/.test(e)));
});

test('invalid base64 fails without throwing', () => {
  const pack = build();
  pack.files.push({
    path: 'icon-192.png', role: 'icon-192', type: 'image/png', width: 192, height: 192,
    bytes: 4, sha256: crypto.createHash('sha256').update('x').digest('hex'), encoding: 'base64', data: 'not-base64!!',
  });
  const r = validatePack(pack);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /not valid base64/.test(e)));
});

test('an unknown top-level or file key is an error', () => {
  const pack = build();
  pack.colour = 'red';
  assert.ok(validatePack(pack).errors.some(e => /unknown key "colour"/.test(e)));
  const pack2 = build();
  pack2.files[0].extra = 1;
  assert.ok(validatePack(pack2).errors.some(e => /unknown key "extra"/.test(e)));
});

test('SVG sanitising rejects <script>, on*= handlers, <foreignObject> and external references', () => {
  const base = { slug: 'x', name: 'X' };
  assert.throws(() => buildPack({ ...base, svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' }), /script/);
  assert.throws(() => buildPack({ ...base, svg: '<svg onload="alert(1)"></svg>' }), /on\*=/);
  assert.throws(() => buildPack({ ...base, svg: '<svg><foreignObject></foreignObject></svg>' }), /foreignObject/);
  assert.throws(() => buildPack({ ...base, svg: '<svg><image href="https://evil.test/x.png"/></svg>' }), /external/);
  assert.throws(() => buildPack({ ...base, svg: '<svg><rect style="fill:url(http://evil.test/x.png)"/></svg>' }), /external/);
});

test('a clean SVG is kept verbatim and recorded as source kind "svg"', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';
  const pack = buildPack({ slug: 'x', name: 'X', svg });
  assert.strictEqual(pack.files[0].data, svg);
  assert.strictEqual(pack.source.kind, 'svg');
  assert.strictEqual(validatePack(pack).ok, true);
});

test('canonicalForm sorts files regardless of input order, and ignores name/theme/generator/createdAt', () => {
  const pack = build();
  pack.files.push({
    path: 'icon-192.png', role: 'icon-192', type: 'image/png', width: 192, height: 192,
    bytes: 1, sha256: '2'.repeat(64), encoding: 'base64', data: 'AA==',
  });
  const reversedFiles = { ...pack, files: [...pack.files].reverse() };
  assert.strictEqual(canonicalForm(pack), canonicalForm(reversedFiles));

  const differentMetadata = { ...pack, name: 'Something Else', theme: undefined, generator: 'x', createdAt: '2000-01-01T00:00:00.000Z' };
  assert.strictEqual(canonicalForm(pack), canonicalForm(differentMetadata));
});

test('packId is stable across key order and changes only when slug/version/role/path/sha256 change', () => {
  const a = build();
  const reordered = { files: a.files, version: a.version, name: a.name, slug: a.slug, source: a.source, theme: a.theme, generator: a.generator, createdAt: a.createdAt, format: a.format };
  assert.strictEqual(packId(a), packId(reordered), 'key order must not matter');

  const b = build();
  assert.strictEqual(packId(a), packId(b), 'same content, same id, computed twice');

  const c = build();
  c.files[0].sha256 = '1'.repeat(64);
  assert.notStrictEqual(packId(a), packId(c), 'a different sha256 changes the id');

  const d = build();
  d.slug = 'budget';
  assert.notStrictEqual(packId(a), packId(d), 'a different slug changes the id');

  assert.match(packId(a), /^[0-9a-f]{64}$/);
});

test('packToDir / packFromDir round-trip to the identical in-memory pack', () => {
  const dir = tmp('pack-dir-');
  const pack = build();
  packToDir(pack, dir);
  assert.ok(fs.existsSync(path.join(dir, 'pack.json')));
  assert.ok(fs.existsSync(path.join(dir, 'favicon.svg')));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'favicon.svg'), 'utf8'), pack.files[0].data);
  const back = packFromDir(dir);
  assert.deepStrictEqual(back, pack);
});

test('packToDir refuses a file path that escapes the directory', () => {
  const dir = tmp('pack-escape-');
  const pack = build();
  pack.files[0].path = '../escape.svg';
  assert.throws(() => packToDir(pack, dir), /escapes the directory/);
});

test('webmanifest lists only the roles present, and only an existing theme colour', () => {
  const pack = build();
  const m = webmanifest(pack, { baseUrl: 'https://auth.test/brand/health/v/abc123/' });
  assert.strictEqual(m.icons.length, 1);
  assert.strictEqual(m.icons[0].src, 'https://auth.test/brand/health/v/abc123/favicon.svg');
  assert.strictEqual(m.icons[0].type, 'image/svg+xml');
  assert.strictEqual(m.theme_color, '#28a1c0');
  assert.strictEqual(m.background_color, '#0b0d10');
  assert.strictEqual(m.name, 'Health');
});

test('webmanifest: a themeColor override wins over the pack theme', () => {
  const pack = build();
  const m = webmanifest(pack, { baseUrl: 'https://auth.test/brand/health', themeColor: '#ff0000' });
  assert.strictEqual(m.theme_color, '#ff0000');
});

test('webmanifest requires a baseUrl', () => {
  assert.throws(() => webmanifest(build(), {}), /baseUrl/);
});
