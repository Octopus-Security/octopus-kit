'use strict';
// Drives bin/octopus-favicon-pack.mjs's exported main() directly (same pattern as
// test/scaffold.test.js for create-octopus-app.mjs), rather than spawning a subprocess.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KIT = path.resolve(__dirname, '..');
const { registry: accents } = require(path.join(KIT, 'tokens', 'accents.cjs'));

let mod;
const load = async () => mod || (mod = await import(path.join(KIT, 'bin', 'octopus-favicon-pack.mjs')));
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('builds a single pack from an emoji', async () => {
  const { main } = await load();
  const out = path.join(tmp('fp-'), 'pack.json');
  const code = main(['--slug', 'health', '--emoji', '🩺', '--name', 'Health', '--color', '#28a1c0', '--out', out]);
  assert.strictEqual(code, 0);
  const pack = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(pack.slug, 'health');
  assert.strictEqual(pack.theme.color, '#28a1c0');
  assert.strictEqual(pack.files[0].role, 'favicon');
});

test('builds a single pack from an SVG file', async () => {
  const { main } = await load();
  const dir = tmp('fp-svg-');
  const svgFile = path.join(dir, 'icon.svg');
  fs.writeFileSync(svgFile, '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>');
  const out = path.join(dir, 'pack.json');
  const code = main(['--slug', 'ee', '--from-svg', svgFile, '--out', out]);
  assert.strictEqual(code, 0);
  const pack = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(pack.source.kind, 'svg');
});

test('rejects passing both --emoji and --from-svg, and missing --slug/--out', async () => {
  const { main } = await load();
  const out = path.join(tmp('fp-bad-'), 'pack.json');
  assert.strictEqual(main(['--slug', 'x', '--emoji', '🩺', '--from-svg', 'x.svg', '--out', out]), 1);
  assert.strictEqual(main(['--emoji', '🩺', '--out', out]), 2, 'no --slug and no --all falls to usage');
  assert.strictEqual(main(['--slug', 'x', '--emoji', '🩺']), 1, 'missing --out');
});

test('--all produces one pack per hub app, themed from the dark accent registry', async () => {
  const { main } = await load();
  const dir = tmp('fp-all-');
  const hubFile = path.join(dir, 'hub-apps.json');
  fs.writeFileSync(hubFile, JSON.stringify({
    apps: [
      { name: 'Health', slug: 'health', icon: '🩺', repo: 'octopus-health' },
      { name: 'Budget', slug: 'budget', icon: '💰', repo: 'octopus-budget' },
    ],
  }));
  const outDir = path.join(dir, 'packs');
  const code = main(['--all', '--hub', hubFile, '--out', outDir]);
  assert.strictEqual(code, 0);

  const health = JSON.parse(fs.readFileSync(path.join(outDir, 'health.json'), 'utf8'));
  const budget = JSON.parse(fs.readFileSync(path.join(outDir, 'budget.json'), 'utf8'));
  assert.strictEqual(health.slug, 'health');
  assert.strictEqual(budget.slug, 'budget');
  assert.strictEqual(health.theme.color, accents.health.dark.accent);
  assert.strictEqual(budget.theme.color, accents.budget.dark.accent);
});

test('--all fails loudly on a missing --hub path rather than silently writing nothing', async () => {
  const { main } = await load();
  const code = main(['--all', '--hub', '/does/not/exist/hub-apps.json', '--out', path.join(tmp('fp-missing-'), 'packs')]);
  assert.strictEqual(code, 1);
});

test('--all fails loudly when the hub file has no apps with a slug and an icon', async () => {
  const { main } = await load();
  const dir = tmp('fp-empty-');
  const hubFile = path.join(dir, 'hub-apps.json');
  fs.writeFileSync(hubFile, JSON.stringify({ apps: [{ name: 'NoIcon', slug: 'noicon' }] }));
  const code = main(['--all', '--hub', hubFile, '--out', path.join(dir, 'packs')]);
  assert.strictEqual(code, 1);
});
