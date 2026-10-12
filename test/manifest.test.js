'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../manifest');
const schema = JSON.parse(fs.readFileSync(M.schemaPath, 'utf8'));

const good = () => ({
  slug: 'kitchen', name: 'Kitchen', icon: '🍳', subdomain: 'kitchen', domain: 'example.test', access: 'private', profile: 'ui',
  provides: { internal: ['/api/internal/recipes'], tools: ['recipe_search'], widgets: [] },
  uses: [{ service: 'shopper', level: 'feature', feature: 'price check', why: 'Prices ingredients.' },
         { service: 'cortex', level: 'feature', feature: 'AI suggestions', why: 'Suggests recipes.' }],
});
const errs = o => M.validate(o).errors;

test('the example manifest from the design doc is valid', () => {
  const r = M.validate(good());
  assert.deepStrictEqual(r.errors, []); assert.strictEqual(r.ok, true);
});

test('minimal manifest: slug, name, subdomain, profile — icon missing is a warning, not an error', () => {
  const r = M.validate({ slug: 'a', name: 'A', subdomain: 'a', profile: 'static' });
  assert.strictEqual(r.ok, true); assert.ok(r.warnings.some(w => /icon/.test(w)));
});

test('not an object / unknown keys are errors (a typo must not become no dependency)', () => {
  for (const v of [null, [], 'x', 3]) assert.strictEqual(M.validate(v).ok, false);
  assert.ok(errs({ ...good(), colour: 'red' }).some(e => /unknown key "colour"/.test(e)));
  const g = good(); g.uses[0].levle = 'required';
  assert.ok(errs(g).some(e => /unknown key "levle"/.test(e)));
  const p = good(); p.provides.widget = [];
  assert.ok(errs(p).some(e => /provides: unknown key/.test(e)));
});

test('slug is permanent-safe: ^[a-z0-9-]+$', () => {
  for (const s of ['Kitchen', 'a b', 'a_b', '', 'a/b', '../x', 'x'.repeat(41), 5, undefined]) assert.ok(errs({ ...good(), slug: s }).some(e => /slug/.test(e)), String(s));
  for (const s of ['kitchen', 'a-1', '9']) assert.deepStrictEqual(errs({ ...good(), slug: s }), []);
});

test('name, subdomain, domain, access, profile are checked', () => {
  assert.ok(errs({ ...good(), name: '' }).length);
  assert.ok(errs({ ...good(), name: 'x'.repeat(61) }).length);
  assert.ok(errs({ ...good(), name: 'a\nb' }).length);
  for (const s of ['A', 'a.b', '-a', 'a-', 'a b', '']) assert.ok(errs({ ...good(), subdomain: s }).some(e => /subdomain/.test(e)), s);
  for (const d of ['Example.test', 'a..b', 'a b', '-x.test', 'x.test/']) assert.ok(errs({ ...good(), domain: d }).some(e => /domain/.test(e)), d);
  assert.ok(errs({ ...good(), access: 'public' }).some(e => /access/.test(e)));
  assert.ok(errs({ ...good(), profile: 'spa' }).some(e => /profile/.test(e)));
  assert.ok(errs({ ...good(), profile: undefined }).some(e => /profile/.test(e)));
});

test('icon must be an emoji', () => {
  for (const i of ['🍳', '💸', '🧪', '🇺🇸', '❤️', '👩‍💻']) assert.deepStrictEqual(errs({ ...good(), icon: i }), [], i);
  for (const i of ['K', 'kitchen', '1', '', '<b>', 'x🍳']) assert.ok(errs({ ...good(), icon: i }).some(e => /icon/.test(e)), JSON.stringify(i));
});

test('provides: paths start with "/", tool names are snake_case, duplicates and non-lists are rejected', () => {
  const p = (provides) => errs({ ...good(), provides });
  assert.ok(p({ internal: ['api/x'] }).length);
  assert.ok(p({ internal: ['/a b'] }).length);
  assert.ok(p({ internal: ['/x', '/x'] }).some(e => /duplicates/.test(e)));
  assert.ok(p({ tools: ['Recipe-Search'] }).length);
  assert.ok(p({ tools: 'recipe_search' }).some(e => /must be a list/.test(e)));
  assert.ok(errs({ ...good(), provides: [] }).some(e => /provides must be an object/.test(e)));
  assert.ok(errs({ ...good(), profile: 'static', provides: { internal: ['/x'] } }).some(e => /static/.test(e)));
  assert.deepStrictEqual(p({}), []);
});

test('uses: same vocabulary as octopus-template.json requires', () => {
  const u = (uses) => errs({ ...good(), uses });
  assert.deepStrictEqual(u([{ service: 'cortex', level: 'required', why: 'Everything goes through it.' }]), []);
  assert.ok(u([{ service: 'cortex', level: 'optional' }]).some(e => /level/.test(e)));
  assert.ok(u([{ service: 'cortex', level: 'feature' }]).some(e => /feature is required/.test(e)), 'feature level names its feature');
  assert.ok(u([{ service: 'Cortex!', level: 'required' }]).some(e => /service/.test(e)));
  assert.ok(u([{ level: 'required' }]).some(e => /service/.test(e)));
  assert.ok(u([{ service: 'a', level: 'required', why: '' }]).some(e => /why/.test(e)));
  assert.ok(u([{ service: 'a', level: 'required', why: 'x'.repeat(201) }]).some(e => /why/.test(e)));
  assert.ok(u([{ service: 'a', level: 'required' }, { service: 'a', level: 'required' }]).some(e => /duplicates/.test(e)));
  assert.deepStrictEqual(u([{ service: 'a', level: 'feature', feature: 'x' }, { service: 'a', level: 'feature', feature: 'y' }]), [], 'one service for two features is two entries');
  assert.ok(u([{ service: 'kitchen', level: 'required' }]).some(e => /itself/.test(e)));
  assert.ok(u(Array.from({ length: 21 }, (_, i) => ({ service: `s${i}`, level: 'required' }))).some(e => /more than 20/.test(e)));
  assert.ok(u('cortex').some(e => /must be a list/.test(e)));
});

test('schema and validator agree on fields, enums and patterns', () => {
  assert.deepStrictEqual(Object.keys(schema.properties).sort(), [...M.TOP_KEYS].sort());
  assert.deepStrictEqual(schema.properties.access.enum, M.ACCESS);
  assert.deepStrictEqual(schema.properties.profile.enum, M.PROFILES);
  assert.deepStrictEqual(schema.properties.uses.items.properties.level.enum, M.LEVELS);
  assert.deepStrictEqual(schema.required.sort(), ['name', 'profile', 'slug', 'subdomain']);
  assert.strictEqual(schema.properties.slug.pattern, M.SLUG_RE.source);
  assert.strictEqual(schema.additionalProperties, false);
  assert.strictEqual(schema.properties.uses.items.additionalProperties, false);
  assert.strictEqual(schema.properties.provides.additionalProperties, false);
});

test('a tiny JSON-Schema subset check agrees with the validator on good() and a bad one', () => {
  // Not a full validator: required, additionalProperties, enum and pattern — the parts the schema
  // is relied on for by editors — so a hand edit that breaks the schema file is caught.
  const check = (o) => {
    const bad = [];
    for (const r of schema.required) if (!(r in o)) bad.push(r);
    for (const k of Object.keys(o)) if (!(k in schema.properties)) bad.push(k);
    for (const [k, p] of Object.entries(schema.properties)) {
      if (!(k in o)) continue;
      if (p.enum && !p.enum.includes(o[k])) bad.push(k);
      if (p.pattern && !new RegExp(p.pattern).test(o[k])) bad.push(k);
    }
    return bad;
  };
  assert.deepStrictEqual(check(good()), []);
  assert.ok(check({ ...good(), slug: 'Bad Slug', profile: 'x' }).length >= 2);
});

// ── legacy hub.json ─────────────────────────────────────────────────────────

test('fromHubJson: slug defaults to the subdomain, access to private, profile to ui; nothing is invented', () => {
  const m = M.fromHubJson({ name: 'Blog', subdomain: 'blog', domain: 'example.test' });
  assert.deepStrictEqual(m, { slug: 'blog', name: 'Blog', subdomain: 'blog', domain: 'example.test', access: 'private', profile: 'ui' });
  assert.ok(!('icon' in m));
  const full = M.fromHubJson({ name: 'Shop', subdomain: 'ecom', icon: '💸', access: 'open' }, { slug: 'shop', profile: 'headless' });
  assert.deepStrictEqual(full, { slug: 'shop', name: 'Shop', subdomain: 'ecom', icon: '💸', access: 'open', profile: 'headless' });
  assert.ok(!('domain' in full), 'the estate default domain is not baked into a public library');
  const warned = []; M.fromHubJson({ name: 'A', subdomain: 'a', extra: 1 }, { onWarning: w => warned.push(w) });
  assert.strictEqual(warned.length, 1);
  assert.throws(() => M.fromHubJson(null));
});

test('toHubJson round-trips what the hub scanner reads', () => {
  const hub = { name: 'Shop', subdomain: 'ecom', domain: 'example.test', icon: '💸', access: 'private' };
  assert.deepStrictEqual(M.toHubJson(M.fromHubJson(hub)), hub);
  assert.deepStrictEqual(M.toHubJson({ name: 'A', subdomain: 'a', slug: 'a', profile: 'ui' }), { name: 'A', subdomain: 'a' });
});

// Every hub.json that exists in this estate checkout converts cleanly. Skipped when the kit is
// not sitting inside the estate tree (CI, the public repo): there is nothing to read.
function findHubJsons() {
  const roots = [path.resolve(__dirname, '..', '..'), path.resolve(__dirname, '..', '..', '..')];
  for (const root of roots) {
    let entries; try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    const found = entries.filter(e => e.isDirectory() && e.name !== 'node_modules')
      .map(e => path.join(root, e.name, 'hub.json')).filter(f => fs.existsSync(f));
    if (found.length) return found;
  }
  return [];
}
const hubs = process.env.OCTOPUS_HUB_JSON_DIR
  ? fs.readdirSync(process.env.OCTOPUS_HUB_JSON_DIR).map(n => path.join(process.env.OCTOPUS_HUB_JSON_DIR, n, 'hub.json')).filter(f => fs.existsSync(f))
  : findHubJsons();

test('every hub.json in the estate converts to a valid manifest and back', { skip: hubs.length ? false : 'no hub.json files found next to the kit' }, () => {
  for (const f of hubs) {
    const hub = JSON.parse(fs.readFileSync(f, 'utf8'));
    const m = M.fromHubJson(hub);
    const r = M.validate(m);
    assert.deepStrictEqual(r.errors, [], `${f}: ${r.errors.join('; ')}`);
    // access gains its explicit default (hub-apps.mjs defaults a missing one to private too).
    assert.deepStrictEqual(M.toHubJson(m), { ...hub, access: hub.access || 'private' }, `${f} did not round-trip`);
  }
  console.log(`  (${hubs.length} hub.json files converted)`);
});

test('readManifest reads and validates a file; bad JSON is an error result, not a throw', () => {
  const os = require('node:os');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'man-'));
  fs.writeFileSync(path.join(d, 'octopus.json'), JSON.stringify(good()));
  assert.strictEqual(M.readManifest(path.join(d, 'octopus.json')).ok, true);
  fs.writeFileSync(path.join(d, 'bad.json'), '{nope');
  assert.strictEqual(M.readManifest(path.join(d, 'bad.json')).ok, false);
  assert.strictEqual(M.readManifest(path.join(d, 'missing.json')).ok, false);
});
