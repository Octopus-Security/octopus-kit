'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { sqlitePragmas, createUserDbCache, pragmaSql } = require('../server/sqlite');
const { staticOptions, isVersioned, warnIfNotProduction, _resetWarned } = require('../server/static');
const kit = require('../server');

test('pragma SQL: wal on, and wal off keeps only busy_timeout', () => {
  assert.match(pragmaSql(), /journal_mode=WAL.*busy_timeout=5000.*synchronous=NORMAL/);
  assert.strictEqual(pragmaSql({ wal: false, busyMs: 100 }), 'PRAGMA busy_timeout=100;');
});

test('sqlitePragmas runs on every connection through afterConnect', async () => {
  let hook; const ran = [];
  const seq = { addHook: (n, f) => { assert.strictEqual(n, 'afterConnect'); hook = f; } };
  sqlitePragmas(seq);
  for (let i = 0; i < 2; i++) await hook({ exec: (sql, cb) => { ran.push(sql); cb(null); } });
  assert.strictEqual(ran.length, 2);
  await assert.rejects(hook({ exec: (s, cb) => cb(new Error('x')) }), /x/);
});

const mk = () => { const closed = []; return { closed, factory: (k) => ({ k, close: async () => { closed.push(k); } }) }; };

test('cache reuses instances and evicts the least recently used idle one', async () => {
  const { closed, factory } = mk();
  const c = createUserDbCache(factory, { max: 2 });
  const a = await c.get('a'); await c.get('b');
  assert.strictEqual(await c.get('a'), a);
  await c.get('c'); // evicts b
  assert.deepStrictEqual(closed, ['b']);
  assert.strictEqual(c.size, 2);
});

test('an in-flight instance is not closed until released', async () => {
  const { closed, factory } = mk();
  const c = createUserDbCache(factory, { max: 1 });
  const { release } = await c.acquire('a');
  await c.get('b'); // evicts a while held
  assert.deepStrictEqual(closed, []);
  release();
  assert.deepStrictEqual(closed, ['a']);
});

test('use() releases on throw; failed factory is not cached; concurrent builds share', async () => {
  let n = 0;
  const c = createUserDbCache(async () => { n++; if (n === 1) throw new Error('boom'); return { close() {} }; });
  await assert.rejects(c.get('u'), /boom/);
  const [x, y] = await Promise.all([c.get('u'), c.get('u')]);
  assert.strictEqual(x, y); assert.strictEqual(n, 2);
  await assert.rejects(c.use('u', () => { throw new Error('in'); }), /in/);
});

test('static: versioned requests are immutable, others revalidate', () => {
  assert.ok(isVersioned({ originalUrl: '/a.css?v=abc123' }, '/x/a.css'));
  assert.ok(isVersioned({ originalUrl: '/a.css?x=1&v=1' }, '/x/a.css'));
  assert.ok(isVersioned({ originalUrl: '/app.3fa9c1d2e4.js' }, '/x/app.3fa9c1d2e4.js'));
  assert.ok(isVersioned({ originalUrl: '/js/0123456789ab/c.js' }, '/x/js/0123456789ab/c.js'));
  assert.ok(!isVersioned({ originalUrl: '/a.css' }, '/x/a.css'));
  assert.ok(!isVersioned({ originalUrl: '/a.css?dev=1' }, '/x/a.css'));
  const o = staticOptions(); const h = {};
  o.setHeaders({ req: { originalUrl: '/a.css?v=1' }, setHeader: (k, v) => { h[k] = v; } }, '/x/a.css');
  assert.match(h['Cache-Control'], /max-age=31536000, immutable/);
  assert.strictEqual(o.maxAge, 60000);
});

test('warnIfNotProduction logs once and stays quiet in production', () => {
  _resetWarned(); const l = [];
  assert.strictEqual(warnIfNotProduction((m) => l.push(m), { NODE_ENV: 'production' }), false);
  assert.strictEqual(warnIfNotProduction((m) => l.push(m), {}), true);
  assert.strictEqual(warnIfNotProduction((m) => l.push(m), {}), false);
  assert.strictEqual(l.length, 1);
  assert.strictEqual(typeof kit.createUserDbCache, 'function');
});
