'use strict';
/**
 * suite.js — the optional-integration layer.
 *
 * Apps in the suite CAN work together but never HAVE to. An app declares the
 * partners it can use; every one is optional, and a missing, down or slow partner
 * hides the feature and says why. It never throws out of a request handler.
 *
 *   const suite = createSuite({ services: {
 *     cortex:  { urlEnv: 'CORTEX_URL',  secretEnv: 'INTERNAL_SECRET', probe: '/api/build' },
 *     shopper: { urlEnv: 'SHOPPER_URL', secretEnv: 'SHOPPER_SECRET' },
 *   } });
 *   suite.has('cortex')                 // configured? (sync)
 *   await suite.available('cortex')     // configured AND answered a probe recently (cached)
 *   await suite.call('cortex', '/api/internal/foo', { method: 'POST', body, user: 'sam' })
 *     // -> { ok: true, status, data } | { ok: false, reason, status?, data? }
 *
 * `call` NEVER throws. reason is one of:
 *   'not-configured'  no URL (or no secret, when a secretEnv is declared) — or an unknown service name
 *   'unreachable'     connection refused / DNS / reset
 *   'timeout'         no answer inside timeoutMs
 *   'http'            the partner answered non-2xx (status and data are included)
 *   'error'           the request could not be built (bad body, bad user name)
 *
 * URLs and secrets come from the environment ONLY — nothing here knows a
 * hostname. The secret is sent as X-Internal-Secret, only to that service's own
 * URL, and redirects are not followed (a custom header would otherwise be
 * forwarded to wherever a 3xx points).
 *
 * Availability is cached: a probe result lasts `probeTtlMs` when up and the
 * shorter `probeFailTtlMs` when down, concurrent probes share one request, and
 * a call that fails to connect marks the service down at once so views stop
 * offering the feature without waiting for the next probe.
 */

const DEFAULTS = { timeoutMs: 5000, probeTtlMs: 30000, probeFailTtlMs: 10000 };
const USER_RE = /^[A-Za-z0-9_.@-]{1,64}$/;
const SERVICE_RE = /^[a-z][a-z0-9_-]{0,31}$/;

function createSuite({
  services = {}, env = process.env, fetchImpl, now = Date.now,
  timeoutMs = DEFAULTS.timeoutMs, probeTtlMs = DEFAULTS.probeTtlMs, probeFailTtlMs = DEFAULTS.probeFailTtlMs,
} = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const names = Object.keys(services);
  for (const n of names) if (!SERVICE_RE.test(n)) throw new Error(`suite: bad service name "${n}"`);

  const avail = new Map();      // name -> { ok, at, reason? }
  const inflight = new Map();   // name -> Promise<boolean>

  function target(name) {
    const def = Object.prototype.hasOwnProperty.call(services, name) ? services[name] : null;
    if (!def) return null;
    const raw = String(env[def.urlEnv] || '').trim();
    if (!raw) return null;
    let u;
    try { u = new URL(raw); } catch { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const secret = def.secretEnv ? String(env[def.secretEnv] || '') : '';
    if (def.secretEnv && !def.secretOptional && !secret) return null;
    return { def, base: raw.replace(/\/+$/, ''), secret };
  }

  const has = name => target(name) !== null;

  async function request(t, path, { method = 'GET', body, user, headers = {}, timeout, secret = true } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\r\n]/.test(path)) {
      return { ok: false, reason: 'error', error: 'path must start with a single "/"' };
    }
    const h = { Accept: 'application/json', ...headers };
    if (secret && t.secret) h['X-Internal-Secret'] = t.secret;
    if (user !== undefined && user !== null && user !== '') {
      const u = String(user).trim();
      if (!USER_RE.test(u)) return { ok: false, reason: 'error', error: 'invalid user' };
      h['X-Service-User'] = u;
    }
    let payload;
    if (body !== undefined && body !== null) {
      try { payload = typeof body === 'string' ? body : JSON.stringify(body); } catch { return { ok: false, reason: 'error', error: 'body is not serialisable' }; }
      if (!h['Content-Type']) h['Content-Type'] = typeof body === 'string' ? 'text/plain' : 'application/json';
    }
    let res;
    try {
      res = await doFetch(t.base + path, {
        method, headers: h, body: payload, redirect: 'manual',
        signal: AbortSignal.timeout(timeout || timeoutMs),
      });
    } catch (err) {
      const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
      return { ok: false, reason: timedOut ? 'timeout' : 'unreachable', error: String((err && err.message) || err) };
    }
    let data = null;
    try {
      const text = await res.text();
      const type = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
      data = /json/i.test(type) && text ? JSON.parse(text) : text;
    } catch { data = null; }
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, data };
    return { ok: false, reason: 'http', status: res.status, data };
  }

  async function call(name, path, opts = {}) {
    try {
      const t = target(name);
      if (!t) return { ok: false, reason: 'not-configured' };
      const r = await request(t, path, opts);
      if (r.reason === 'unreachable' || r.reason === 'timeout') avail.set(name, { ok: false, at: now(), reason: r.reason });
      else if (r.ok) avail.set(name, { ok: true, at: now() });
      return r;
    } catch (err) {                                   // belt and braces: this function must not throw
      return { ok: false, reason: 'error', error: String((err && err.message) || err) };
    }
  }

  function probe(name) {
    if (inflight.has(name)) return inflight.get(name);
    const t = target(name);
    const p = (async () => {
      const r = await request(t, t.def.probe || '/api/build', { secret: !!t.def.probeAuth });
      // A probe only asks "is something answering"; a 401/403 still means up.
      const up = r.ok || (r.reason === 'http' && r.status < 500);
      avail.set(name, { ok: up, at: now(), reason: up ? undefined : (r.reason === 'http' ? 'http' : r.reason) });
      return up;
    })().catch(() => { avail.set(name, { ok: false, at: now(), reason: 'error' }); return false; })
      .finally(() => inflight.delete(name));
    inflight.set(name, p);
    return p;
  }

  async function available(name) {
    if (!has(name)) return false;
    const hit = avail.get(name);
    if (hit && now() - hit.at < (hit.ok ? probeTtlMs : probeFailTtlMs)) return hit.ok;
    return probe(name);
  }

  /** Per-service view: { configured, available, reason? }. Probes whatever is stale. */
  async function status() {
    const out = {};
    await Promise.all(names.map(async n => {
      if (!has(n)) { out[n] = { configured: false, available: false, reason: 'not-configured' }; return; }
      const up = await available(n);
      const hit = avail.get(n);
      out[n] = { configured: true, available: up, ...(up ? {} : { reason: (hit && hit.reason) || 'unreachable' }) };
    }));
    return out;
  }

  /** What a template may consult right now, without waiting: configured, and not known to be down. */
  function snapshot() {
    const out = {};
    for (const n of names) {
      const hit = avail.get(n);
      const fresh = hit && now() - hit.at < (hit.ok ? probeTtlMs : probeFailTtlMs);
      out[n] = has(n) && !(fresh && !hit.ok);
    }
    return out;
  }

  function refreshStale() {
    for (const n of names) {
      if (!has(n)) continue;
      const hit = avail.get(n);
      if (!hit || now() - hit.at >= (hit.ok ? probeTtlMs : probeFailTtlMs)) available(n).catch(() => {});
    }
  }

  /**
   * Express middleware: res.locals.suite = { cortex: true, shopper: false, … },
   * so a template can `<% if (suite.cortex) { %>` and hide a feature whose
   * partner is missing. It never waits on a partner: configured-and-not-known-down
   * is true, and stale entries are refreshed in the background.
   */
  function middleware() {
    return (req, res, next) => {
      try { res.locals.suite = snapshot(); refreshStale(); } catch { res.locals.suite = {}; }
      next();
    };
  }

  /** Fastify: req.suite = the same map. */
  function fastify(app) {
    app.decorateRequest('suite', null);
    app.addHook('onRequest', async (req) => { req.suite = snapshot(); refreshStale(); });
    return app;
  }

  return { has, available, call, status, snapshot, refresh: () => status(), middleware, fastify, names: () => names.slice() };
}

module.exports = { createSuite };
