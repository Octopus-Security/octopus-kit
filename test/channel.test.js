'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const load = () => import('../scripts/build-channel.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kit-ch-'));

test('channel builds, every file validates, manifest hashes match', async () => {
  const { buildChannel, checkChannel } = await load();
  const out = tmp();
  const { files, version } = buildChannel(out);
  assert.deepEqual(checkChannel(out), {});
  for (const need of ['tokens.css', 'accents.css', 'base.css', 'components.css', 'layout.css', 'theme-boot.js', 'blocks/o-shell.js']) assert.ok(files[need], need);
  const m = JSON.parse(fs.readFileSync(path.join(out, 'v0/manifest.json'), 'utf8'));
  assert.equal(m.version, version);
  for (const [name, f] of Object.entries(files)) {
    assert.ok(fs.existsSync(path.join(out, 'v0', f.immutable)), name);
    assert.equal(fs.readFileSync(path.join(out, 'v0', name)).toString(), fs.readFileSync(path.join(out, 'v0', f.immutable)).toString());
  }
});

test('the build is deterministic (no timestamps in the manifest)', async () => {
  const { buildChannel } = await load();
  const a = tmp(), b = tmp();
  buildChannel(a); buildChannel(b);
  assert.equal(fs.readFileSync(path.join(a, 'v0/manifest.json'), 'utf8'), fs.readFileSync(path.join(b, 'v0/manifest.json'), 'utf8'));
});

test('the validator rejects broken CSS and broken JS', async () => {
  const { validateCss, buildChannel, checkChannel } = await load();
  assert.ok(validateCss('a { color: red;').length);
  assert.ok(validateCss('a { content: "x }').length);
  assert.ok(validateCss('}').length);
  assert.ok(validateCss('/* never closed').length);
  assert.deepEqual(validateCss('a { color: red; } /* ok */ b::after { content: "}"; }'), []);
  const out = tmp();
  buildChannel(out);
  fs.mkdirSync(path.join(out, 'v0/blocks'), { recursive: true });
  fs.writeFileSync(path.join(out, 'v0/blocks/bad.js'), 'export const = ;');
  assert.ok(checkChannel(out)['blocks/bad.js']);
});
