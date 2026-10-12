'use strict';
// Integration through a REAL Express app. Skipped when express is not installed:
//   NODE_PATH=../octopus-shopper/node_modules node --test test/server-express.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let express; try { express = require('express'); } catch { /* skipped below */ }
const skip = !express && 'express is not installed on this machine';

const kit = require('../server');
const { stub, json } = require('./helpers');

let auth, server, base, appDir;
before(async () => {
  if (skip) return;
  appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xapp-'));
  fs.mkdirSync(path.join(appDir, 'public'));
  fs.writeFileSync(path.join(appDir, 'index.js'), '//');
  fs.writeFileSync(path.join(appDir, 'public', 'a.css'), 'a{}');
  auth = await stub((req, res) => {
    const m = /^\/api\/auth\/apps\/([^/]+)\/allowed$/.exec(req.url);
    if (!m) return json(res, 404, {});
    const who = /octopus_sso=([^;]+)/.exec(req.headers.cookie || '');
    json(res, 200, { allowed: !(who && who[1] === 'denied') });
  });
  const stamp = kit.createBuildStamp({ service: 'octopus-x', roots: [appDir] });
  const gate = kit.createAppGate({ slug: 'x', authUrl: auth.url, log: { warn() {} } });
  const suite = kit.createSuite({ services: { cortex: { urlEnv: 'CORTEX_URL', secretEnv: 'INTERNAL_SECRET' } }, env: {} });
  const app = express();
  kit.healthRoutes(app, { service: 'octopus-x', stamp, gate });                  // ahead of auth
  app.use((req, res, next) => { const t = /octopus_sso=([^;]+)/.exec(req.headers.cookie || ''); if (t) req.user = { username: t[1] }; next(); });
  app.use(suite.middleware());
  app.use(kit.prefs.middleware());
  app.use('/kit', kit.kitAssets());
  app.post('/api/internal/echo', kit.requireInternalSecret({ env: { INTERNAL_SECRET: 'k' } }), (req, res) => res.json({ user: kit.serviceUser(req, { defaultUser: 'owner' }) }));
  app.use((req, res, next) => (req.user ? gate(req, res, next) : res.status(401).json({ error: 'login' })));
  app.get('/page', (req, res) => res.json({ suite: res.locals.suite, theme: res.locals.theme.htmlAttrs, asset: stamp.asset('/a.css') }));
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) server.close(); if (auth) await auth.close(); });

test('health and build answer ahead of auth, and /api/build reports the gate', { skip }, async () => {
  assert.strictEqual((await fetch(`${base}/health?probe=1`)).status, 200);
  const b = await (await fetch(`${base}/api/build`)).json();
  assert.strictEqual(b.gate, 'x'); assert.match(b.build, /^[0-9a-f]{12}$/); assert.strictEqual(b.service, 'octopus-x');
});

test('signed-out is 401, allowed account gets the page, denied account gets 403', { skip }, async () => {
  assert.strictEqual((await fetch(`${base}/page`)).status, 401);
  const ok = await fetch(`${base}/page`, { headers: { Cookie: 'octopus_sso=sam' } });
  assert.strictEqual(ok.status, 200);
  const body = await ok.json();
  assert.deepStrictEqual(body.suite, { cortex: false });
  assert.strictEqual(body.theme, 'data-theme="dark" data-density="comfortable"');
  assert.match(body.asset, /^\/a\.css\?v=[0-9a-f]{8}$/);
  const denied = await fetch(`${base}/page`, { headers: { Cookie: 'octopus_sso=denied', Accept: 'text/html' } });
  assert.strictEqual(denied.status, 403);
  assert.match(await denied.text(), /does not include/);
  assert.strictEqual((await fetch(`${base}/health`, { headers: { Cookie: 'octopus_sso=denied' } })).status, 200);
});

test('the theme cookie reaches the template', { skip }, async () => {
  const c = encodeURIComponent(JSON.stringify({ v: 1, mode: 'light', accent: 'app', density: 'compact' }));
  const body = await (await fetch(`${base}/page`, { headers: { Cookie: `octopus_sso=sam; octopus_prefs=${c}` } })).json();
  assert.strictEqual(body.theme, 'data-theme="light" data-density="compact"');
});

test('internal routes: secret required, X-Service-User honoured only once proved', { skip }, async () => {
  const post = h => fetch(`${base}/api/internal/echo`, { method: 'POST', headers: h });
  assert.strictEqual((await post({})).status, 401);
  assert.strictEqual((await post({ 'X-Internal-Secret': 'wrong' })).status, 403);
  assert.deepStrictEqual(await (await post({ 'X-Internal-Secret': 'k', 'X-Service-User': 'riley' })).json(), { user: 'riley' });
  assert.deepStrictEqual(await (await post({ 'X-Internal-Secret': 'k' })).json(), { user: 'owner' });
});

test('kit assets: only .css under tokens/ and ui/, and nothing outside the kit', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitdir-'));
  fs.mkdirSync(path.join(dir, 'tokens')); fs.mkdirSync(path.join(dir, 'server'));
  fs.writeFileSync(path.join(dir, 'tokens', 't.css'), ':root{--o-bg:#000}');
  fs.writeFileSync(path.join(dir, 'tokens', 'tokens.json'), '{}');
  fs.writeFileSync(path.join(dir, 'server', 's.css'), 'x');
  fs.writeFileSync(path.join(dir, '..', 'kit-secret.css'), 'secret');
  const handler = kit.kitAssets({ dir });
  const app = express(); app.use('/kit', handler); app.use((req, res) => res.status(404).send('nope'));
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const b = `http://127.0.0.1:${srv.address().port}`;
  try {
    const ok = await fetch(`${b}${handler.url('/tokens/t.css')}`);
    assert.strictEqual(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /text\/css/);
    assert.match(ok.headers.get('cache-control'), /immutable/, 'a request carrying the right hash is immutable');
    assert.strictEqual((await fetch(`${b}/kit/tokens/t.css`)).headers.get('cache-control'), 'no-cache');
    for (const p of ['/kit/tokens/tokens.json', '/kit/server/s.css', '/kit/tokens/../../kit-secret.css', '/kit/%2e%2e/kit-secret.css', '/kit/tokens/%2e%2e/%2e%2e/kit-secret.css', '/kit/tokens/missing.css']) {
      assert.strictEqual((await fetch(`${b}${p}`)).status, 404, p);
    }
  } finally { srv.close(); }
});
