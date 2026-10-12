'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createSuite } = require('../server/suite');
const { stub, json, fakeRes } = require('./helpers');

const services = (extra = {}) => ({
  cortex: { urlEnv: 'CORTEX_URL', secretEnv: 'INTERNAL_SECRET', probe: '/api/build' },
  shopper: { urlEnv: 'SHOPPER_URL' },
  ...extra,
});

test('not configured: has() is false, available() is false, call() returns instead of throwing', async () => {
  const suite = createSuite({ services: services(), env: {} });
  assert.strictEqual(suite.has('cortex'), false);
  assert.strictEqual(await suite.available('cortex'), false);
  assert.deepStrictEqual(await suite.call('cortex', '/x'), { ok: false, reason: 'not-configured' });
  assert.deepStrictEqual(await suite.call('nope', '/x'), { ok: false, reason: 'not-configured' }, 'unknown service name');
  assert.deepStrictEqual(await suite.call('__proto__', '/x'), { ok: false, reason: 'not-configured' });
});

test('a URL without its secret is NOT configured when a secretEnv is declared (fail closed)', async () => {
  const suite = createSuite({ services: services(), env: { CORTEX_URL: 'http://127.0.0.1:1' } });
  assert.strictEqual(suite.has('cortex'), false);
  assert.strictEqual(suite.has('shopper'), false);
  assert.strictEqual(createSuite({ services: services(), env: { SHOPPER_URL: 'http://127.0.0.1:1' } }).has('shopper'), true);
});

test('garbage URLs are not configured', () => {
  for (const u of ['not a url', 'ftp://x', 'file:///etc/passwd', 'javascript:alert(1)']) {
    assert.strictEqual(createSuite({ services: services(), env: { SHOPPER_URL: u } }).has('shopper'), false, u);
  }
});

test('ok: returns status and parsed data, sends the secret and the acting user', async () => {
  const s = await stub((req, res) => json(res, 200, { hello: 'world' }));
  try {
    const suite = createSuite({ services: services(), env: { CORTEX_URL: s.url + '/', INTERNAL_SECRET: 'k' } });
    const r = await suite.call('cortex', '/api/thing', { method: 'POST', body: { a: 1 }, user: 'sam' });
    assert.deepStrictEqual(r, { ok: true, status: 200, data: { hello: 'world' } });
    const hit = s.hits[0];
    assert.strictEqual(hit.method, 'POST');
    assert.strictEqual(hit.url, '/api/thing');
    assert.strictEqual(hit.headers['x-internal-secret'], 'k');
    assert.strictEqual(hit.headers['x-service-user'], 'sam');
    assert.strictEqual(hit.headers['content-type'], 'application/json');
    assert.deepStrictEqual(JSON.parse(hit.body), { a: 1 });
  } finally { await s.close(); }
});

test('no user -> no X-Service-User header; a hostile user name is refused before any request', async () => {
  const s = await stub((req, res) => json(res, 200, {}));
  try {
    const suite = createSuite({ services: services(), env: { SHOPPER_URL: s.url } });
    await suite.call('shopper', '/x');
    assert.ok(!('x-service-user' in s.hits[0].headers));
    assert.ok(!('x-internal-secret' in s.hits[0].headers));
    const bad = await suite.call('shopper', '/x', { user: 'a\r\nX-Evil: 1' });
    assert.strictEqual(bad.ok, false); assert.strictEqual(bad.reason, 'error');
    assert.strictEqual(s.hits.length, 1);
  } finally { await s.close(); }
});

test('a path cannot redirect the request to another host', async () => {
  const suite = createSuite({ services: services(), env: { SHOPPER_URL: 'http://127.0.0.1:1' } });
  for (const p of ['//evil.test/x', 'http://evil.test/x', 'x', '/ok\r\nHost: evil']) {
    const r = await suite.call('shopper', p);
    assert.strictEqual(r.reason, 'error', p);
  }
});

test('down: connection refused is "unreachable", and marks the service unavailable at once', async () => {
  const s = await stub((req, res) => json(res, 200, {}));
  const url = s.url; await s.close();
  const suite = createSuite({ services: services(), env: { SHOPPER_URL: url } });
  const r = await suite.call('shopper', '/x');
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'unreachable');
  assert.strictEqual(suite.snapshot().shopper, false, 'views stop offering the feature');
  assert.strictEqual(await suite.available('shopper'), false);
});

test('slow: a partner that does not answer is "timeout"', async () => {
  const timers = [];
  const s = await stub((req, res) => { timers.push(setTimeout(() => json(res, 200, {}), 1500)); });
  try {
    const suite = createSuite({ services: services(), env: { SHOPPER_URL: s.url }, timeoutMs: 80 });
    const t0 = Date.now();
    const r = await suite.call('shopper', '/slow');
    assert.deepStrictEqual([r.ok, r.reason], [false, 'timeout']);
    assert.ok(Date.now() - t0 < 1200);
    const per = await suite.call('shopper', '/slow', { timeoutMs: 30 });
    assert.strictEqual(per.reason, 'timeout', 'per-call timeout');
  } finally { timers.forEach(clearTimeout); await s.close(); }
});

test('500 and 404 are reason "http" with the status and body', async () => {
  const s = await stub((req, res) => (req.url === '/boom' ? json(res, 500, { error: 'kaput' }) : json(res, 404, { error: 'none' })));
  try {
    const suite = createSuite({ services: services(), env: { SHOPPER_URL: s.url } });
    const r = await suite.call('shopper', '/boom');
    assert.deepStrictEqual([r.ok, r.reason, r.status], [false, 'http', 500]);
    assert.deepStrictEqual(r.data, { error: 'kaput' });
    assert.strictEqual((await suite.call('shopper', '/gone')).status, 404);
  } finally { await s.close(); }
});

test('redirects are not followed (the secret must not travel to wherever a 3xx points)', async () => {
  const other = await stub((req, res) => json(res, 200, {}));
  const s = await stub((req, res) => { res.writeHead(302, { Location: other.url + '/steal' }); res.end(); });
  try {
    const suite = createSuite({ services: services(), env: { CORTEX_URL: s.url, INTERNAL_SECRET: 'k' } });
    const r = await suite.call('cortex', '/x');
    assert.strictEqual(r.reason, 'http'); assert.strictEqual(r.status, 302);
    assert.strictEqual(other.hits.length, 0);
  } finally { await s.close(); await other.close(); }
});

test('non-JSON bodies come back as text, not a throw', async () => {
  const s = await stub((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('plain'); });
  try {
    const suite = createSuite({ services: services(), env: { SHOPPER_URL: s.url } });
    assert.deepStrictEqual(await suite.call('shopper', '/t'), { ok: true, status: 200, data: 'plain' });
    const circular = {}; circular.self = circular;
    assert.strictEqual((await suite.call('shopper', '/t', { method: 'POST', body: circular })).reason, 'error');
  } finally { await s.close(); }
});

test('available(): probes, caches the answer, and re-probes after the TTL', async () => {
  let t = 0;
  const s = await stub((req, res) => json(res, 200, { build: 'x' }));
  try {
    const suite = createSuite({ services: services(), env: { CORTEX_URL: s.url, INTERNAL_SECRET: 'k' }, now: () => t, probeTtlMs: 1000 });
    assert.strictEqual(await suite.available('cortex'), true);
    assert.strictEqual(await suite.available('cortex'), true);
    assert.strictEqual(s.hits.length, 1, 'cached');
    assert.strictEqual(s.hits[0].url, '/api/build');
    assert.ok(!('x-internal-secret' in s.hits[0].headers), 'the probe does not carry the secret unless probeAuth');
    t += 1500;
    await suite.available('cortex');
    assert.strictEqual(s.hits.length, 2);
  } finally { await s.close(); }
});

test('available(): concurrent probes share one request; a down partner is re-probed sooner', async () => {
  let t = 0;
  const s = await stub((req, res) => setTimeout(() => json(res, 200, {}), 50));
  try {
    const suite = createSuite({ services: services(), env: { SHOPPER_URL: s.url }, now: () => t });
    await Promise.all([suite.available('shopper'), suite.available('shopper'), suite.available('shopper')]);
    assert.strictEqual(s.hits.length, 1);
  } finally { await s.close(); }
  const down = createSuite({ services: services(), env: { SHOPPER_URL: 'http://127.0.0.1:1' }, now: () => t, probeTtlMs: 60000, probeFailTtlMs: 100 });
  assert.strictEqual(await down.available('shopper'), false);
  assert.strictEqual(down.snapshot().shopper, false);
  t += 200;
  assert.strictEqual(down.snapshot().shopper, true, 'after the short fail TTL it is optimistic again, and re-probed');
});

test('status(): per-service view for admin pages', async () => {
  const s = await stub((req, res) => json(res, 200, {}));
  try {
    const suite = createSuite({ services: services(), env: { SHOPPER_URL: s.url } });
    const st = await suite.status();
    assert.deepStrictEqual(st.cortex, { configured: false, available: false, reason: 'not-configured' });
    assert.deepStrictEqual(st.shopper, { configured: true, available: true });
  } finally { await s.close(); }
});

test('middleware(): res.locals.suite hides features whose partner is missing, without waiting on anyone', async () => {
  const suite = createSuite({ services: services(), env: { SHOPPER_URL: 'http://127.0.0.1:1' } });
  const res = fakeRes(); let called = false;
  const t0 = Date.now();
  suite.middleware()({}, res, () => { called = true; });
  assert.ok(called && Date.now() - t0 < 50, 'synchronous');
  assert.deepStrictEqual(res.locals.suite, { cortex: false, shopper: true }, 'configured and not yet known down');
  await new Promise(r => setTimeout(r, 300));              // background probe lands
  const res2 = fakeRes(); suite.middleware()({}, res2, () => {});
  assert.deepStrictEqual(res2.locals.suite, { cortex: false, shopper: false });
});

test('fastify(): decorates the request', async () => {
  const suite = createSuite({ services: services(), env: {} });
  const calls = {}; const app = { decorateRequest: (k, v) => { calls.deco = [k, v]; }, addHook: (n, fn) => { calls.hook = [n, fn]; } };
  suite.fastify(app);
  assert.deepStrictEqual(calls.deco, ['suite', null]);
  const req = {}; await calls.hook[1](req);
  assert.deepStrictEqual(req.suite, { cortex: false, shopper: false });
});

test('bad service names are rejected at construction', () => {
  assert.throws(() => createSuite({ services: { 'Bad Name': { urlEnv: 'X' } } }));
});
