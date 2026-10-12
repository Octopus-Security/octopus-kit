'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { healthRoutes } = require('../server/health');
const { requireInternalSecret, serviceUser } = require('../server/internal');
const { fakeRes, run } = require('./helpers');

function fakeExpress() {
  const routes = {};
  return { routes, get: (p, fn) => { routes[p] = fn; } };
}
function fakeFastify() {
  const routes = {};
  return { routes, addHook() {}, get: (p, fn) => { routes[p] = fn; } };
}
const stamp = { service: 'octopus-x', build: 'abc123def456', startedAt: '2026-01-01T00:00:00.000Z', info() { return { ok: true, service: this.service, build: this.build, startedAt: this.startedAt }; } };

test('express: /health and /api/build, with gate read off the mounted gate', () => {
  const app = fakeExpress();
  healthRoutes(app, { service: 'octopus-x', stamp, gate: { slug: 'x' } });
  const h = fakeRes(); app.routes['/health']({}, h);
  assert.deepStrictEqual(h.body, { ok: true, status: 'ok', service: 'octopus-x' });
  const b = fakeRes(); app.routes['/api/build']({}, b);
  assert.deepStrictEqual(b.body, { ok: true, service: 'octopus-x', build: 'abc123def456', startedAt: stamp.startedAt, gate: 'x' });
  assert.strictEqual(b.headers['Cache-Control'], 'no-store');
});

test('gate is absent when none is mounted or the gate is a pass-through', () => {
  for (const gate of [undefined, { slug: null }]) {
    const app = fakeExpress();
    healthRoutes(app, { service: 's', stamp, gate });
    const b = fakeRes(); app.routes['/api/build']({}, b);
    assert.ok(!('gate' in b.body));
  }
});

test('a stamp that failed reports "unknown", which is not hash-shaped', () => {
  const app = fakeExpress();
  healthRoutes(app, { service: 's', stamp: { build: 'unknown', startedAt: 't' } });
  const b = fakeRes(); app.routes['/api/build']({}, b);
  assert.strictEqual(b.body.build, 'unknown');
  const none = fakeExpress(); healthRoutes(none, { service: 's' });
  const b2 = fakeRes(); none.routes['/api/build']({}, b2);
  assert.strictEqual(b2.body.build, 'unknown');
});

test('fastify flavour is detected and returns bodies', async () => {
  const app = fakeFastify();
  healthRoutes(app, { service: 's', stamp, gate: { slug: 'g' } });
  assert.strictEqual((await app.routes['/health']()).ok, true);
  const headers = {};
  const body = await app.routes['/api/build']({}, { header: (k, v) => { headers[k] = v; } });
  assert.strictEqual(body.gate, 'g');
  assert.strictEqual(headers['Cache-Control'], 'no-store');
});

test('extra() can add fields and cannot break the probe', () => {
  const app = fakeExpress();
  healthRoutes(app, { service: 's', stamp, extra: () => ({ source: 'zzz' }) });
  const b = fakeRes(); app.routes['/api/build']({}, b);
  assert.strictEqual(b.body.source, 'zzz');
  const bad = fakeExpress();
  healthRoutes(bad, { service: 's', stamp, extra: () => { throw new Error('x'); } });
  const b2 = fakeRes(); bad.routes['/api/build']({}, b2);
  assert.strictEqual(b2.body.ok, true);
});

// ── internal ────────────────────────────────────────────────────────────────

const rq = (headers = {}) => ({ headers, body: {}, query: {} });

test('requireInternalSecret fails CLOSED with 503 when no secret is configured', async () => {
  const mw = requireInternalSecret({ env: {} });
  const { res, nexted } = await run(mw, rq({ 'x-internal-secret': '' }));
  assert.strictEqual(nexted, false); assert.strictEqual(res.code, 503);
  const r2 = await run(mw, rq({ 'x-internal-secret': 'anything' }));
  assert.strictEqual(r2.res.code, 503, 'a header cannot satisfy an unset secret');
});

test('missing header is 401, wrong is 403, right passes and marks the call', async () => {
  const env = { INTERNAL_SECRET: 's3cret' };
  const mw = requireInternalSecret({ env });
  assert.strictEqual((await run(mw, rq())).res.code, 401);
  assert.strictEqual((await run(mw, rq({ 'x-internal-secret': 'nope' }))).res.code, 403);
  assert.strictEqual((await run(mw, rq({ 'x-internal-secret': 's3cre' }))).res.code, 403, 'prefix is not a match');
  const req = rq({ 'x-internal-secret': 's3cret' });
  const ok = await run(mw, req);
  assert.strictEqual(ok.nexted, true); assert.strictEqual(req.serviceCall, true);
});

test('the secret is read per request, so rotation needs no restart', async () => {
  const env = {};
  const mw = requireInternalSecret({ env });
  assert.strictEqual((await run(mw, rq({ 'x-internal-secret': 'a' }))).res.code, 503);
  env.INTERNAL_SECRET = 'a';
  assert.strictEqual((await run(mw, rq({ 'x-internal-secret': 'a' }))).nexted, true);
});

test('name and header are configurable; fastify flavour answers the same', async () => {
  const mw = requireInternalSecret({ env: { MY_SECRET: 'k' }, name: 'MY_SECRET', header: 'X-Other' });
  assert.strictEqual((await run(mw, rq({ 'x-other': 'k' }))).nexted, true);
  const sent = {}; const reply = { code(c) { sent.c = c; return reply; }, send(b) { sent.b = b; return reply; } };
  assert.strictEqual(await mw.fastify(rq({ 'x-other': 'bad' }), reply) !== undefined, true);
  assert.strictEqual(sent.c, 403);
  const req = rq({ 'x-other': 'k' });
  assert.strictEqual(await mw.fastify(req, reply), undefined);
  assert.strictEqual(req.serviceCall, true);
});

test('serviceUser honours X-Service-User ONLY after the secret proved the caller', () => {
  const forged = rq({ 'x-service-user': 'victim' });           // a browser session adding the header
  assert.strictEqual(serviceUser(forged), null);
  assert.strictEqual(serviceUser(forged, { defaultUser: 'owner' }), null, 'not even the default: it is not a service call');
  const proved = { ...rq({ 'x-service-user': 'victim' }), serviceCall: true };
  assert.strictEqual(serviceUser(proved), 'victim');
});

test('serviceUser: unnamed service call gets the default; an invalid name is a 400, not a fallback', () => {
  const unnamed = { ...rq(), serviceCall: true };
  assert.strictEqual(serviceUser(unnamed), null);
  assert.strictEqual(serviceUser(unnamed, { defaultUser: 'owner' }), 'owner');
  const bad = { ...rq({ 'x-service-user': 'a b; DROP' }), serviceCall: true };
  assert.throws(() => serviceUser(bad, { defaultUser: 'owner' }), e => e.statusCode === 400);
  const body = { ...rq(), serviceCall: true, body: { username: 'fromBody' } };
  assert.strictEqual(serviceUser(body), null, 'body is ignored by default');
  assert.strictEqual(serviceUser(body, { allowBody: true }), 'fromBody');
});
