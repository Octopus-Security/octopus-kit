'use strict';
// Ported from octopus-budget/test/appAccess.test.js (the spec) plus the options the kit adds.
const { test } = require('node:test');
const assert = require('node:assert');
const { createAppGate, slugFromEnv } = require('../server/app-gate');
const { fakeRes, fakeReq, run, silent } = require('./helpers');

const answer = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const make = (fetchImpl, extra = {}) => createAppGate({ authUrl: 'http://auth', slug: 'budget', fetchImpl, log: silent, ...extra });

test('allowed passes through', async () => {
  assert.strictEqual((await run(make(answer(200, { allowed: true })), fakeReq())).nexted, true);
});

test('denied is a 403 JSON for the API and carries the upgrade link', async () => {
  const { res, nexted } = await run(make(answer(200, { allowed: false }), { upgradeUrl: 'https://x.test/learn' }), fakeReq({ originalUrl: '/api/me' }));
  assert.strictEqual(nexted, false);
  assert.strictEqual(res.code, 403);
  assert.strictEqual(res.body.code, 'no_access');
  assert.strictEqual(res.body.upgradeUrl, 'https://x.test/learn');
});

test('denied is denied on a page too, not only on the API', async () => {
  const { res, nexted } = await run(make(answer(200, { allowed: false })), fakeReq({ originalUrl: '/lesson/3' }));
  assert.strictEqual(nexted, false);
  assert.strictEqual(res.code, 403);
  assert.match(String(res.body), /No access/);
});

test('the upgrade link is escaped into the page', async () => {
  const { res } = await run(make(answer(200, { allowed: false }), { upgradeUrl: 'https://x.test/?a="><script>' }), fakeReq());
  assert.ok(!String(res.body).includes('<script>'));
});

test("it forwards the caller's credential and asks about its own slug", async () => {
  let seen;
  const f = async (url, opts) => { seen = { url, opts }; return { status: 200, ok: true, json: async () => ({ allowed: true }) }; };
  await run(make(f), fakeReq());
  assert.strictEqual(seen.url, 'http://auth/api/auth/apps/budget/allowed');
  assert.strictEqual(seen.opts.headers.Cookie, 'octopus_sso=abc');
  assert.strictEqual(seen.opts.redirect, 'manual', 'a credential must not follow a redirect');
  assert.ok(seen.opts.signal, 'the call has a timeout');
});

test('the answer is cached, and a revocation lands after the TTL', async () => {
  let t = 1000, calls = 0, allowed = true;
  const f = async () => { calls++; return { status: 200, ok: true, json: async () => ({ allowed }) }; };
  const gate = make(f, { now: () => t });
  assert.strictEqual((await run(gate, fakeReq())).nexted, true);
  allowed = false;
  assert.strictEqual((await run(gate, fakeReq())).nexted, true, 'still cached');
  assert.strictEqual(calls, 1);
  t += 61 * 1000;
  assert.strictEqual((await run(gate, fakeReq())).nexted, false, 'revocation lands after the TTL');
});

test('cacheMs is an option', async () => {
  let t = 0, calls = 0;
  const f = async () => { calls++; return { status: 200, ok: true, json: async () => ({ allowed: true }) }; };
  const gate = make(f, { now: () => t, cacheMs: 1000 });
  await run(gate, fakeReq()); t += 1500; await run(gate, fakeReq());
  assert.strictEqual(calls, 2);
});

test('an unreachable auth uses the last answer, and fails open with none', async () => {
  let t = 0, up = true;
  const f = async () => { if (!up) throw new Error('ECONNREFUSED'); return { status: 200, ok: true, json: async () => ({ allowed: false }) }; };
  const gate = make(f, { now: () => t });
  assert.strictEqual((await run(gate, fakeReq())).nexted, false);
  up = false; t += 120 * 1000;
  assert.strictEqual((await run(gate, fakeReq())).nexted, false, 'stale DENIED must stay denied through an outage');
  assert.strictEqual((await run(gate, fakeReq({ user: { username: 'new' } }))).nexted, true, 'no previous answer => open');
});

test('failOpen:false denies when auth cannot be asked and there is no previous answer', async () => {
  const down = async () => { throw new Error('ECONNREFUSED'); };
  const gate = make(down, { failOpen: false });
  const page = await run(gate, fakeReq({ originalUrl: '/x' }));
  assert.strictEqual(page.nexted, false);
  assert.strictEqual(page.res.code, 403);
  const api = await run(gate, fakeReq({ originalUrl: '/api/x' }));
  assert.strictEqual(api.res.body.code, 'gate_unavailable', 'an outage is not reported as "you have no access"');
  assert.strictEqual(gate.failOpen, false);
});

test('failOpen:false still honours a stale ALLOWED answer from before the outage', async () => {
  let t = 0, up = true;
  const f = async () => { if (!up) throw new Error('down'); return { status: 200, ok: true, json: async () => ({ allowed: true }) }; };
  const gate = make(f, { now: () => t, failOpen: false });
  await run(gate, fakeReq()); up = false; t += 120000;
  assert.strictEqual((await run(gate, fakeReq())).nexted, true);
});

test('a slow auth times out instead of hanging the request', async () => {
  // AbortSignal.timeout's timer is unref'd (a real socket keeps the loop alive); this double has none.
  const keepAlive = setTimeout(() => {}, 5000);
  const slow = (url, opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))));
  const t0 = Date.now();
  const { nexted } = await run(make(slow, { timeoutMs: 50 }), fakeReq());
  clearTimeout(keepAlive);
  assert.strictEqual(nexted, true);
  assert.ok(Date.now() - t0 < 2000);
});

test('a 404 (slug unknown to auth) allows, because it is a config error and not a denial', async () => {
  assert.strictEqual((await run(make(answer(404, {})), fakeReq())).nexted, true);
});

test('a non-2xx other than 404 is an outage, not a denial', async () => {
  assert.strictEqual((await run(make(answer(500, {})), fakeReq())).nexted, true);
});

test('an empty slug disables the gate and never calls auth', async () => {
  let called = false;
  const gate = createAppGate({ authUrl: 'http://auth', slug: '', fetchImpl: async () => { called = true; }, log: silent });
  assert.strictEqual((await run(gate, fakeReq())).nexted, true);
  assert.strictEqual(called, false);
  assert.strictEqual(gate.slug, null, '/api/build reports no gate for a pass-through');
});

test('/health and /api/build are never gated, even for a denied account', async () => {
  const gate = make(answer(200, { allowed: false }));
  assert.strictEqual((await run(gate, fakeReq({ originalUrl: '/health?probe=1' }))).nexted, true);
  assert.strictEqual((await run(gate, fakeReq({ originalUrl: '/api/build' }))).nexted, true);
  assert.strictEqual((await run(gate, fakeReq({ originalUrl: '/api/other' }))).nexted, false);
});

test('gate.express() is the middleware and gate.slug is what was built with', () => {
  const gate = make(answer(200, {}));
  assert.strictEqual(gate.express(), gate);
  assert.strictEqual(gate.slug, 'budget');
});

test('fastify(): a preHandler that 403s a denied account, skips machines and open paths', async () => {
  const hooks = [];
  const app = { addHook: (name, fn) => hooks.push([name, fn]) };
  make(answer(200, { allowed: false }), { upgradeUrl: 'u' }).fastify(app);
  assert.strictEqual(hooks[0][0], 'preHandler');
  const hook = hooks[0][1];
  const reply = { code(c) { reply.c = c; return reply; }, send(b) { reply.b = b; return reply; } };
  await hook({ user: { username: 'sam' }, url: '/things', headers: {} }, reply);
  assert.strictEqual(reply.c, 403); assert.strictEqual(reply.b.code, 'no_access');
  const r2 = { code() { throw new Error('should not reply'); } };
  assert.strictEqual(await hook({ user: { username: 'svc', role: 'internal' }, url: '/api/internal/x', headers: {} }, r2), undefined);
  assert.strictEqual(await hook({ user: { username: 'sam' }, url: '/health', headers: {} }, r2), undefined);
  assert.strictEqual(await hook({ url: '/x', headers: {} }, r2), undefined, 'no user => not this hook\'s job');
});

test('slugFromEnv: unset or EMPTY means the default (never an accidental off); "off" disables', () => {
  assert.strictEqual(slugFromEnv({}, 'ee'), 'ee');
  assert.strictEqual(slugFromEnv({ APP_ACCESS_SLUG: '' }, 'ee'), 'ee', 'the ee `??` bug: an empty compose passthrough must not switch the gate off');
  assert.strictEqual(slugFromEnv({ APP_ACCESS_SLUG: '  ' }, 'ee'), 'ee');
  assert.strictEqual(slugFromEnv({ APP_ACCESS_SLUG: 'custom' }, 'ee'), 'custom');
  assert.strictEqual(slugFromEnv({ APP_ACCESS_SLUG: 'off' }, 'ee'), '');
  assert.strictEqual(slugFromEnv({ APP_ACCESS_SLUG: 'OFF' }, 'ee'), '');
});
