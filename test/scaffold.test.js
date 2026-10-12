'use strict';
// The scaffold generates apps that pass the estate's conventions, and the generated apps start.
//
// Booting needs express + ejs, which the kit does not depend on. They are borrowed from a sibling
// checkout (the estate's usual lender) via NODE_PATH; set OCTOPUS_LENDER to a node_modules
// directory to override. Without them the boot tests are skipped, the static checks still run.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const KIT = path.resolve(__dirname, '..');
const BIN = path.join(KIT, 'bin', 'create-octopus-app.mjs');
const { validate, toHubJson } = require('../manifest/validate');

let gen; // the ESM generator, loaded once
const load = async () => gen || (gen = await import(path.join(KIT, 'bin', 'create-octopus-app.mjs')));
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');

function lender() {
  const cands = [process.env.OCTOPUS_LENDER, path.resolve(KIT, '..', 'octopus-shopper', 'node_modules'),
    path.resolve(KIT, '..', '..', 'octopus-shopper', 'node_modules')].filter(Boolean);
  return cands.find(c => fs.existsSync(path.join(c, 'express', 'package.json')) && fs.existsSync(path.join(c, 'ejs', 'package.json')));
}
const LENDER = lender();
const skipBoot = !LENDER && 'express + ejs are not available to borrow (set OCTOPUS_LENDER=<node_modules>)';

/** A node_modules dir whose octopus-kit is THIS checkout, as an installed kit would be. */
function nodePath() {
  const nm = path.join(tmp('kit-nm-'), 'node_modules');
  fs.mkdirSync(nm);
  fs.symlinkSync(KIT, path.join(nm, 'octopus-kit'), 'dir');
  return [nm, LENDER].join(path.delimiter);
}

// ── Dockerfile detection, ported from octopus-vault/scripts (they walk a fixed root and cannot be
//    pointed at a directory). Same logic, including the comment strip that makes a documented fix
//    not satisfy its own detector. ─────────────────────────────────────────────────────────────
function finalStage(src) {
  const lines = src.split('\n');
  let last = -1; lines.forEach((l, i) => { if (/^\s*FROM\s/i.test(l)) last = i; });
  return { from: lines[last] || '', body: lines.slice(last).filter(l => !/^\s*#/.test(l)).join('\n') };
}
const NPM_REMOVAL = /rm\s+-rf[^\n]*\/usr\/local\/lib\/node_modules\/npm/;
const patchesApk = body => /apk\s+upgrade/.test(body) || /apk\s+add[^\n]*\s(-u\b|--upgrade\b)/.test(body);

test('Dockerfile detectors flag what they should (self-test of the ported logic)', () => {
  assert.strictEqual(patchesApk(finalStage('FROM node:22-alpine\nRUN apk add --no-cache git').body), false);
  assert.strictEqual(patchesApk(finalStage('FROM node:22-alpine\n# apk upgrade\nRUN apk add git').body), false, 'a comment is not a patch');
  assert.strictEqual(patchesApk(finalStage('FROM node:22-alpine AS b\nRUN apk upgrade\nFROM node:22-alpine\nRUN true').body), false, 'builder-stage upgrade does not count');
  assert.strictEqual(NPM_REMOVAL.test(finalStage('FROM node:22-alpine\nRUN rm -rf /usr/local/lib/node_modules/npm').body), true);
});

for (const profile of ['ui', 'headless', 'static']) {
  test(`${profile}: files, Dockerfile, compose and manifest follow the conventions`, async () => {
    const { generate } = await load();
    const dir = path.join(tmp('scaf-'), 'app');
    const r = generate({ slug: 'demo', name: 'Demo App', profile, dir, icon: '🧩' });
    for (const f of ['Dockerfile', 'docker-compose.yml', 'octopus.json', 'hub.json', 'CLAUDE.md', '.gitignore', '.dockerignore']) {
      assert.ok(fs.existsSync(path.join(dir, f)), `${f} missing`);
    }
    const node = profile !== 'static';
    const nodeFiles = ['index.js', 'config.js', 'auth.js', 'package.json', '.env.example', 'test/boots.test.js', 'test/env-wiring.test.js'];
    for (const f of nodeFiles) assert.strictEqual(fs.existsSync(path.join(dir, f)), node, f);
    assert.strictEqual(fs.existsSync(path.join(dir, 'views', 'layout.ejs')), profile === 'ui');
    assert.strictEqual(fs.existsSync(path.join(dir, 'public', 'app.css')), profile !== 'headless');

    // Dockerfile
    const docker = read(dir, 'Dockerfile');
    const { from, body } = finalStage(docker);
    assert.match(docker, node ? /FROM node:22-alpine/ : /FROM nginx:alpine/);
    assert.match(from, /alpine/);
    assert.ok(patchesApk(body), 'runtime stage must apk upgrade');
    if (node) {
      assert.match(docker, /FROM node:22-alpine AS deps/, 'multi-stage');
      assert.ok(NPM_REMOVAL.test(body), 'runtime stage must remove npm');
      assert.match(body, /rm -rf \/usr\/local\/lib\/node_modules\/npm \/usr\/local\/lib\/node_modules\/corepack \\\n\s+\/usr\/local\/bin\/npm \/usr\/local\/bin\/npx \/usr\/local\/bin\/corepack/, 'the exact estate strip');
      const strip = body.indexOf('node_modules/npm'); const user = body.indexOf('USER node');
      assert.ok(strip > 0 && user > strip, 'the npm strip needs root, so it goes above USER');
      assert.match(body, /\nUSER node\n/);
      assert.doesNotMatch(docker, /ARG NPM_TOKEN\n[\s\S]*ENV NPM_TOKEN/, 'the token is never baked into the image');
      assert.match(docker, /rm -f \.npmrc/, '.npmrc is removed in the same layer');
      assert.match(docker, /CMD \[ ?"node", "index\.js" ?\]/);
    } else {
      assert.match(docker, /api\/build/);
      assert.match(read(dir, 'nginx.conf'), /location = \/health/);
    }

    // compose
    const compose = read(dir, 'docker-compose.yml');
    assert.doesNotMatch(compose, /^\s*ports:/m, 'no host ports');
    assert.match(compose, /restart: always/);
    assert.match(compose, /web_proxy:\n\s+name: web_proxy\n\s+external: true/);
    assert.match(compose, /octopus_network:\n\s+name: octopus_network\n\s+external: true/);
    if (node) {
      assert.match(compose, /demo_data:\/usr\/src\/app\/data/);
      assert.match(compose, /^volumes:\n\s+demo_data:/m);
      const envLines = compose.split('\n').filter(l => /^\s+- [A-Z_]+=/.test(l));
      const bad = envLines.filter(l => !/^\s+- (NODE_ENV=production|PORT=3000|DATA_DIR=\/usr\/src\/app\/data|[A-Z_]+=\$\{[A-Z_]+:-\})$/.test(l));
      assert.deepStrictEqual(bad, [], 'every variable is passed explicitly as ${VAR:-}');
      assert.doesNotMatch(compose, /127\.0\.0\.1|localhost|:-http/, 'no hostname defaults');
    }

    // manifest
    const manifest = JSON.parse(read(dir, 'octopus.json'));
    const v = validate(manifest);
    assert.deepStrictEqual(v.errors, []); assert.strictEqual(manifest.slug, 'demo'); assert.strictEqual(manifest.profile, profile);
    assert.deepStrictEqual(JSON.parse(read(dir, 'hub.json')), toHubJson(manifest));
    assert.ok(!('domain' in manifest), 'no estate hostname is baked in');

    // package.json: the kit comes from a tarball URL (no git binary needed)
    if (node) {
      const pkg = JSON.parse(read(dir, 'package.json'));
      assert.match(pkg.dependencies['octopus-kit'], /^https:\/\/codeload\.github\.com\/Octopus-Security\/octopus-kit\/tar\.gz\/refs\/tags\/v0\.1\.0$/);
      assert.ok(pkg.optionalDependencies['@octopus-security/auth-client'], 'auth-client is OPTIONAL');
      assert.ok(!pkg.dependencies['@octopus-security/auth-client']);
      assert.strictEqual(!!pkg.dependencies.ejs, profile === 'ui');
    }

    // public-repo hygiene: nothing real in what it wrote
    for (const f of r.files) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.doesNotMatch(text, /\bNick\b|ndiramio|psychopathy|octopustechnology|octopus-auth:\d|octopus-cortex:\d/i, `${f} leaks an estate identity or hostname`);
    }
    // placeholders all resolved
    for (const f of r.files) assert.doesNotMatch(read(dir, f), /\{\{[#/]?\w+\}\}/, `${f} has an unresolved placeholder`);
  });
}

test('ui: the layout carries data-app, the theme boot and the kit CSS, and the page is an escaped template', async () => {
  const { generate } = await load();
  const dir = path.join(tmp('scaf-'), 'app');
  generate({ slug: 'demo', name: 'Demo App', profile: 'ui', dir });
  const layout = read(dir, 'views/layout.ejs');
  assert.match(layout, /<html lang="en" data-app="demo"/);
  assert.match(layout, /<%- themeBoot %>/);
  for (const f of ['/tokens/tokens.css', '/tokens/accents.css', '/ui/base.css', '/ui/components.css']) assert.ok(layout.includes(`kit('${f}')`), f);
  const index = read(dir, 'index.js');
  assert.match(index, /require\('octopus-kit\/tokens\/theme-boot\.cjs'\)\.inlineTag\(\)/);
  assert.ok(/try \{ app\.locals\.themeBoot = require/.test(index), 'theme boot is guarded so the app renders without it');
});

test('index.js orders health ahead of auth, and the gate after the login check', async () => {
  const { generate } = await load();
  const dir = path.join(tmp('scaf-'), 'app');
  generate({ slug: 'demo', name: 'Demo App', profile: 'ui', dir });
  const src = read(dir, 'index.js');
  const at = s => src.indexOf(s);
  assert.ok(at('kit.healthRoutes(') > 0 && at('kit.healthRoutes(') < at('app.use(auth.identify)'));
  assert.ok(at('auth.requireUser') < at('app.use(gate)'));
  assert.ok(at("app.use('/api/internal'") < at('app.use(auth.identify)'), 'internal routes use their own secret, before SSO');
  // const-before-use: the 2026-09-06 outage, checked statically too.
  assert.ok(at('const stamp =') < at('stamp.express(app)'));
});

test('slug, name, profile and directory are validated', async () => {
  const { generate } = await load();
  const d = () => path.join(tmp('scaf-'), 'x');
  for (const slug of ['', 'A', 'a', '1abc', 'a_b', 'a b', '../x', 'x'.repeat(40)]) assert.throws(() => generate({ slug, name: 'N', profile: 'ui', dir: d() }), /slug/, slug);
  for (const name of ['', 'a"b', 'a<b', 'a`b', 'a${x}', 'a\\b', 'a{{SLUG}}', 'x'.repeat(61), 'a\nb']) assert.throws(() => generate({ slug: 'ok', name, profile: 'ui', dir: d() }), /name/, JSON.stringify(name));
  assert.throws(() => generate({ slug: 'ok', name: 'N', profile: 'spa', dir: d() }), /profile/);
  assert.throws(() => generate({ slug: 'ok', name: 'N', profile: 'ui', dir: d(), domain: 'Bad Domain' }), /domain/);
  const used = tmp('scaf-'); fs.writeFileSync(path.join(used, 'keep.txt'), 'x');
  assert.throws(() => generate({ slug: 'ok', name: 'N', profile: 'ui', dir: used }), /not empty/);
  assert.ok(fs.existsSync(path.join(used, 'keep.txt')), 'nothing was overwritten');
});

test('render(): flags drop whole blocks, a missing variable is an error', async () => {
  const { render } = await load();
  assert.strictEqual(render('a\n{{#ui}}\nb\n{{/ui}}\nc\n', {}, { ui: true }), 'a\nb\nc\n');
  assert.strictEqual(render('a\n{{#ui}}\nb\n{{/ui}}\nc\n', {}, {}), 'a\nc\n');
  assert.strictEqual(render('{{X}}-{{X}}', { X: 'y' }), 'y-y');
  assert.throws(() => render('{{NOPE}}', {}), /NOPE/);
});

test('the CLI: runs, lists files and the manual steps, refuses bad input with a non-zero exit', () => {
  const dir = path.join(tmp('scaf-'), 'cli');
  const ok = spawnSync(process.execPath, [BIN, 'demo', '--name', 'Demo App', '--profile', 'headless', '--dir', dir, '--icon', '🧩'], { encoding: 'utf8' });
  assert.strictEqual(ok.status, 0, ok.stderr);
  for (const s of ['Remaining manual steps', 'Portainer', 'Proxy host', 'hub-apps.mjs', 'SHOWCASE', 'system-map', 'ESTATE.md', 'accent']) assert.ok(ok.stdout.includes(s), s);
  assert.ok(fs.existsSync(path.join(dir, 'index.js')));
  const again = spawnSync(process.execPath, [BIN, 'demo', '--name', 'Demo App', '--profile', 'headless', '--dir', dir], { encoding: 'utf8' });
  assert.strictEqual(again.status, 1); assert.match(again.stderr, /not empty/);
  assert.strictEqual(spawnSync(process.execPath, [BIN, 'Bad Slug', '--dir', path.join(tmp('scaf-'), 'z')], { encoding: 'utf8' }).status, 1);
  assert.strictEqual(spawnSync(process.execPath, [BIN], { encoding: 'utf8' }).status, 2);
  const noIcon = spawnSync(process.execPath, [BIN, 'quiet', '--profile', 'static', '--dir', path.join(tmp('scaf-'), 'q')], { encoding: 'utf8' });
  assert.match(noIcon.stdout, /icon is missing/);
});

test('the accent: used when the kit can allocate one, a TODO is printed when it cannot', async () => {
  const { generate } = await load();
  const fakeKit = tmp('fakekit-'); fs.mkdirSync(path.join(fakeKit, 'tokens'));
  fs.writeFileSync(path.join(fakeKit, 'tokens', 'accents.cjs'), "exports.nextFreeAccent = (slug) => ({ slug, accent: '#123456' });");
  const withKit = generate({ slug: 'demo', name: 'Demo', profile: 'headless', dir: path.join(tmp('scaf-'), 'a'), kitDir: fakeKit });
  assert.deepStrictEqual(withKit.accent, { slug: 'demo', accent: '#123456' });
  const without = generate({ slug: 'demo', name: 'Demo', profile: 'headless', dir: path.join(tmp('scaf-'), 'b'), kitDir: tmp('nokit-') });
  assert.strictEqual(without.accent, null);
  const broken = tmp('brokenkit-'); fs.mkdirSync(path.join(broken, 'tokens'));
  fs.writeFileSync(path.join(broken, 'tokens', 'accents.cjs'), 'throw new Error("x")');
  assert.strictEqual(generate({ slug: 'demo', name: 'Demo', profile: 'headless', dir: path.join(tmp('scaf-'), 'c'), kitDir: broken }).accent, null, 'a broken allocator must not break generation');
});

test('static: the kit CSS is copied in when the kit has it, and the page links it', async () => {
  const { generate } = await load();
  const fakeKit = tmp('fakekit-');
  for (const f of ['tokens/tokens.css', 'tokens/accents.css', 'ui/base.css', 'ui/components.css']) {
    fs.mkdirSync(path.join(fakeKit, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(fakeKit, f), '/* css */');
  }
  const dir = path.join(tmp('scaf-'), 's');
  generate({ slug: 'site', name: 'Site', profile: 'static', dir, kitDir: fakeKit });
  assert.ok(fs.existsSync(path.join(dir, 'public/kit/tokens.css')));
  assert.match(read(dir, 'public/index.html'), /href="\/kit\/components\.css"/);
});

// ── Booting the generated apps ─────────────────────────────────────────────

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function boot(dir, env) {
  const port = await freePort();
  const child = spawn(process.execPath, ['index.js'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, NODE_PATH: nodePath(), PORT: String(port), ...env } });
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  let exited = false; child.on('exit', () => { exited = true; });
  const base = `http://127.0.0.1:${port}`;
  const until = Date.now() + 20000;
  while (Date.now() < until && !exited) {
    try { if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(800) })).ok) return { base, out: () => out, stop: () => child.kill('SIGKILL') }; } catch { /* not up */ }
    await new Promise(r => setTimeout(r, 120));
  }
  child.kill('SIGKILL');
  throw new Error(`generated app did not start:\n${out}`);
}

for (const profile of ['ui', 'headless']) {
  test(`${profile}: the generated app boots in dev mode and answers /health and /api/build`, { skip: skipBoot }, async () => {
    const { generate } = await load();
    const dir = path.join(tmp('scaf-'), 'app');
    generate({ slug: 'demo', name: 'Demo App', profile, dir });
    const app = await boot(dir, { AUTH_MODE: 'dev', INTERNAL_SECRET: 'test-secret' });
    try {
      const health = await (await fetch(`${app.base}/health?probe=1`)).json();
      assert.deepStrictEqual(health, { ok: true, status: 'ok', service: 'octopus-demo' });
      const build = await (await fetch(`${app.base}/api/build`)).json();
      assert.strictEqual(build.service, 'octopus-demo');
      assert.match(build.build, /^[0-9a-f]{12}$/);
      assert.ok(!('gate' in build), 'dev mode enforces no gate, so reports none');
      assert.match(build.startedAt, /^\d{4}-/);

      const home = await fetch(`${app.base}/`);
      assert.strictEqual(home.status, 200);
      if (profile === 'ui') {
        const html = await home.text();
        assert.match(html, /<html lang="en" data-app="demo" data-theme="dark" data-density="comfortable">/);
        assert.match(html, /href="\/kit\/tokens\/tokens\.css/);
        assert.match(html, /Signed in as <strong>dev<\/strong>/);
        assert.match(html, /cortex: not connected/, 'a missing partner hides its feature and says why');
        assert.match(html, /\/public\/app\.css\?v=[0-9a-f]{8}/);
        const light = encodeURIComponent(JSON.stringify({ v: 1, mode: 'light', accent: '#112233', density: 'compact' }));
        const themed = await (await fetch(`${app.base}/`, { headers: { Cookie: `octopus_prefs=${light}` } })).text();
        assert.match(themed, /data-theme="light" data-density="compact" style="--o-accent:#112233"/);
        assert.strictEqual((await fetch(`${app.base}/nope`)).status, 404);
        assert.strictEqual((await fetch(`${app.base}/public/app.css`)).status, 200);
      } else {
        assert.deepStrictEqual(await home.json(), { ok: true, service: 'octopus-demo', user: 'dev' });
        assert.strictEqual((await fetch(`${app.base}/nope`)).status, 404);
      }

      // internal routes: secret required; X-Service-User honoured only once proved
      const who = h => fetch(`${app.base}/api/internal/whoami`, { headers: h });
      assert.strictEqual((await who({})).status, 401);
      assert.strictEqual((await who({ 'X-Internal-Secret': 'wrong' })).status, 403);
      assert.strictEqual((await (await who({ 'X-Internal-Secret': 'test-secret', 'X-Service-User': 'riley' })).json()).actingFor, 'riley');
      assert.strictEqual((await fetch(`${app.base}/api/internal/missing`, { headers: { 'X-Internal-Secret': 'test-secret' } })).status, 404);
    } finally { app.stop(); }
  });

  test(`${profile}: internal routes fail CLOSED (503) when INTERNAL_SECRET is unset`, { skip: skipBoot }, async () => {
    const { generate } = await load();
    const dir = path.join(tmp('scaf-'), 'app');
    generate({ slug: 'demo', name: 'Demo App', profile, dir });
    const app = await boot(dir, { AUTH_MODE: 'dev' });
    try {
      assert.strictEqual((await fetch(`${app.base}/api/internal/whoami`, { headers: { 'X-Internal-Secret': '' } })).status, 503);
      assert.strictEqual((await fetch(`${app.base}/api/internal/whoami`, { headers: { 'X-Internal-Secret': 'guess' } })).status, 503);
    } finally { app.stop(); }
  });

  test(`${profile}: the generated app's own tests pass (boots.test.js, env-wiring.test.js)`, { skip: skipBoot }, async () => {
    const { generate } = await load();
    const dir = path.join(tmp('scaf-'), 'app');
    generate({ slug: 'demo', name: 'Demo App', profile, dir });
    const r = spawnSync(process.execPath, ['--test', 'test/*.test.js'], { cwd: dir, encoding: 'utf8', timeout: 90000, env: { PATH: process.env.PATH, NODE_PATH: nodePath() } });
    assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /# pass [4-9]/);
    assert.match(r.stdout, /# fail 0/);
  });
}

test('refuses to boot on unsafe configuration: dev in production, sso without its package or URLs', { skip: skipBoot }, async () => {
  const { generate } = await load();
  const dir = path.join(tmp('scaf-'), 'app');
  generate({ slug: 'demo', name: 'Demo App', profile: 'headless', dir });
  // The lender may or may not have the private auth-client installed; shadow it with a package that
  // cannot be loaded, which is what a laptop or CI without NPM_TOKEN looks like.
  const np = nodePath();
  const shadow = path.join(np.split(path.delimiter)[0], '@octopus-security', 'auth-client');
  fs.mkdirSync(shadow, { recursive: true });
  fs.writeFileSync(path.join(shadow, 'index.js'), "throw new Error(\"Cannot find module '@octopus-security/auth-client'\");");
  const run = env => spawnSync(process.execPath, ['index.js'], { cwd: dir, encoding: 'utf8', timeout: 20000, env: { PATH: process.env.PATH, NODE_PATH: np, PORT: '0', ...env } });
  const prod = run({ AUTH_MODE: 'dev', NODE_ENV: 'production' });
  assert.notStrictEqual(prod.status, 0); assert.match(prod.stderr, /AUTH_MODE=dev is refused when NODE_ENV=production/);
  const noUrls = run({ AUTH_MODE: 'sso' });
  assert.notStrictEqual(noUrls.status, 0); assert.match(noUrls.stderr, /AUTH_SERVICE_URL is required/);
  const noPkg = run({ AUTH_MODE: 'sso', AUTH_SERVICE_URL: 'http://127.0.0.1:1', AUTH_PUBLIC_URL: 'http://127.0.0.1:2' });
  assert.notStrictEqual(noPkg.status, 0); assert.match(noPkg.stderr, /auth-client is not installed/);
  const unknown = run({ AUTH_MODE: 'magic' });
  assert.notStrictEqual(unknown.status, 0); assert.match(unknown.stderr, /AUTH_MODE must be/);
});
