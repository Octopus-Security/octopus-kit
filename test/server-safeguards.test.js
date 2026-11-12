'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const kit = require('../server');

function res() {
  const h = {}; const cookies = [];
  return { h, cookies, statusCode: 200, ended: false,
    setHeader(k, v) { h[k.toLowerCase()] = v; }, append(k, v) { if (k === 'Set-Cookie') cookies.push(v); },
    status(c) { this.statusCode = c; return this; }, end() { this.ended = true; } };
}

test('secureHeaders sets the set, HSTS only on https, no-store on request', () => {
  const m = kit.secureHeaders({ noStore: true });
  const r = res(); let nexted = false;
  m({ secure: true }, r, () => { nexted = true; });
  assert.ok(nexted);
  assert.equal(r.h['x-content-type-options'], 'nosniff');
  assert.equal(r.h['x-frame-options'], 'DENY');
  assert.match(r.h['content-security-policy'], /frame-ancestors 'none'/);
  assert.ok(!/script-src/.test(r.h['content-security-policy']), 'must not restrict scripts');
  assert.match(r.h['strict-transport-security'], /max-age=/);
  assert.equal(r.h['cache-control'], 'no-store');
  const plain = res(); m({ secure: false }, plain, () => {});
  assert.equal(plain.h['strict-transport-security'], undefined);
});

test('idleTimeout: starts a window, keeps it, expires after idleMs, rejects forgery and other users', () => {
  let t = 1_000_000; let expired = 0;
  const m = kit.idleTimeout({ idleMs: 60_000, secret: 's', now: () => t, onExpire: (q, s) => { expired++; s.status(401).end(); } });
  const cookieOf = r => r.cookies.at(-1).split(';')[0];
  const call = (user, cookie) => { const r = res(); let n = false; m({ user: user && { username: user }, headers: { cookie }, secure: true }, r, () => { n = true; }); return { r, n }; };

  const first = call('a'); assert.ok(first.n); const c1 = cookieOf(first.r);
  t += 20_000; const second = call('a', c1); assert.ok(second.n);
  assert.equal(second.r.cookies.length, 0, 'inside the refresh interval nothing is re-sent');
  t += 61_000; const late = call('a', c1); assert.equal(late.n, false); assert.equal(expired, 1);
  assert.match(late.r.cookies[0], /Max-Age=0/);
  // someone else's cookie, and a tampered one, are not honoured: they just start a fresh window
  const other = call('b', c1); assert.ok(other.n); assert.notEqual(cookieOf(other.r), c1);
  const forged = call('a', 'o_idle=1.AAAA'); assert.ok(forged.n);
  // anonymous requests are untouched
  const anon = call(null); assert.ok(anon.n); assert.equal(anon.r.cookies.length, 0);
});

test('safeError drops the message, which may quote client data', () => {
  const e = new Error('UNIQUE constraint failed: Client.name = "Jane Doe"'); e.code = 'SQLITE_CONSTRAINT';
  const out = kit.safeError(e);
  assert.ok(!out.includes('Jane'));
  assert.match(out, /^Error SQLITE_CONSTRAINT/);
  assert.equal(kit.safeError(null), 'non-error thrown');
});

test('auditLine is one JSON line with no content field', () => {
  const lines = []; kit.auditLine({ actor: 'u', action: 'client.view', target: 'abc' }, l => lines.push(l), () => 0);
  assert.equal(lines.length, 1);
  const j = JSON.parse(lines[0].replace('[audit] ', ''));
  assert.deepEqual(Object.keys(j).sort(), ['action', 'actor', 'at', 'ok', 'target']);
});
