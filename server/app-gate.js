'use strict';
/**
 * app-gate.js — may THIS signed-in account use THIS app?
 *
 * Replaces the byte-identical appAccess.js in budget, health, shopper, author and
 * kitchen, the near-copies in science, ee, marketing, games and code, the Fastify
 * ones in edm and media, and the inline one in business/server/auth.js.
 *
 * octopus-auth owns the answer (per-user override, then a runtime default, then
 * the shipped default) at GET /api/auth/apps/:slug/allowed. This is the
 * enforcing half: without it, taking a tile off someone's hub only hides it and
 * the app stays reachable by URL.
 *
 * The caller's own credential (cookie and/or Authorization) is forwarded rather
 * than parsed, so auth is asked AS the user and this file never needs to know
 * the cookie's name.
 *
 * FAILURE MODE is an explicit option, `failOpen` (default true, which is what
 * every existing copy does):
 *   - auth answers 200  -> that answer, cached `cacheMs`.
 *   - auth answers 404  -> the slug is not in its catalogue: a CONFIGURATION error
 *                          here, not a denial there. Allows, and says so loudly.
 *   - auth is unreachable / errors / times out:
 *       the LAST answer for that user is kept even when stale (a stale DENIED
 *       stays denied through an outage); with no previous answer, failOpen:true
 *       allows and failOpen:false denies (503-style 403 body, code 'gate_unavailable').
 *   Fail-open is right when the request already proved a valid estate session:
 *   the only cost of an outage is a revocation landing late, whereas failing
 *   closed locks every paying customer out during a blip. Choose failOpen:false
 *   only for an app where late revocation is worse than an outage.
 *
 * DIFFERENCES from the copies: the call to auth has a timeout (5 s default; the
 * copies could hang a request for as long as auth did), and an empty slug is a
 * pass-through (as before) — use slugFromEnv() to read it, see below.
 */

const CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE = 5000;
const OFF_WORDS = new Set(['off', 'none', 'disabled', '-']);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * The slug to gate on, from APP_ACCESS_SLUG.
 *
 * `||` semantics, deliberately. octopus-ee read it with `??`, which treats an
 * empty string as "set" and so turns the gate OFF when the compose passes
 * `${APP_ACCESS_SLUG:-}` and nobody set the Portainer variable — an unset
 * variable silently disabling an access control. With `||` an unset OR empty
 * value means "use this app's own slug". To switch the gate off on purpose
 * (a standalone/resold deployment with no octopus-auth) say so: set the
 * variable to `off`.
 */
function slugFromEnv(env, defaultSlug, name = 'APP_ACCESS_SLUG') {
  const raw = String((env || process.env)[name] || '').trim();
  if (!raw) return defaultSlug || '';
  return OFF_WORDS.has(raw.toLowerCase()) ? '' : raw;
}

function createAppGate({
  slug, authUrl, upgradeUrl = '', appName = 'this app',
  cacheMs = CACHE_TTL_MS, failOpen = true, timeoutMs = 5000, maxCache = MAX_CACHE,
  openPaths = ['/health', '/api/build'], openPrefixes = ['/api/auth/'],
  fetchImpl, now = Date.now, log = console,
} = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const base = String(authUrl || '').replace(/\/+$/, '');
  const cache = new Map(); // username -> { allowed, at }
  const message = `Your account does not include ${appName}.`;

  const isOpen = rawUrl => {
    const p = String(rawUrl || '').split('?')[0];
    return openPaths.includes(p) || openPrefixes.some(x => p.startsWith(x));
  };

  /**
   * Framework-neutral: who = { username, cookie, authorization }.
   * Resolves { allowed, reason } where reason is 'ok' | 'denied' | 'cached' |
   * 'unknown-slug' | 'stale' | 'unreachable-open' | 'unreachable-closed' | 'off'.
   */
  async function check(who = {}) {
    if (!slug) return { allowed: true, reason: 'off' };
    const key = who.username;
    const hit = key && cache.get(key);
    if (hit && now() - hit.at < cacheMs) return { allowed: hit.allowed, reason: 'cached' };

    const headers = {};
    if (who.cookie) headers.Cookie = who.cookie;
    if (who.authorization) headers.Authorization = who.authorization;

    try {
      if (!base) throw new Error('no authUrl configured');
      const res = await doFetch(`${base}/api/auth/apps/${encodeURIComponent(slug)}/allowed`, {
        headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) {
        log.warn(`[access] "${slug}" is not an app octopus-auth knows — the gate is doing nothing. Check hub-apps.json.`);
        return { allowed: true, reason: 'unknown-slug' };
      }
      if (!res.ok) throw new Error(`auth answered ${res.status}`);
      const body = await res.json();
      const ok = body.allowed !== false;
      if (key) {
        if (cache.size >= maxCache) cache.clear();
        cache.set(key, { allowed: ok, at: now() });
      }
      return { allowed: ok, reason: ok ? 'ok' : 'denied' };
    } catch (err) {
      if (hit) {
        log.warn(`[access] could not check "${slug}" access (${err.message}) — using the last answer`);
        return { allowed: hit.allowed, reason: 'stale' };
      }
      log.warn(`[access] could not check "${slug}" access (${err.message}) — ${failOpen ? 'allowing' : 'denying'}`);
      return { allowed: failOpen, reason: failOpen ? 'unreachable-open' : 'unreachable-closed' };
    }
  }

  const deniedBody = unavailable => ({
    error: unavailable ? 'Access could not be checked right now.' : message,
    code: unavailable ? 'gate_unavailable' : 'no_access',
    upgradeUrl: unavailable ? null : (upgradeUrl || null),
  });

  function deniedPage(unavailable) {
    const text = unavailable ? 'Access could not be checked right now. Try again shortly.' : message;
    const link = !unavailable && upgradeUrl ? `<p><a href="${escapeHtml(upgradeUrl)}">See plans</a></p>` : '';
    return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>No access</title>'
      + '<body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem">'
      + `<h1 style="font-size:1.4rem">No access yet</h1><p>${escapeHtml(text)}</p>${link}`
      + '<p><a href="/">Back</a></p></body>';
  }

  // Express middleware. Run it AFTER the login check, so req.user is set.
  async function gate(req, res, next) {
    try {
      if (!slug || isOpen(req.originalUrl || req.url)) return next();
      const r = await check({
        username: req.user && req.user.username,
        cookie: req.headers && req.headers.cookie,
        authorization: req.headers && req.headers.authorization,
      });
      if (r.allowed) return next();
      const unavailable = r.reason === 'unreachable-closed';
      if (String(req.originalUrl || req.url || '').startsWith('/api/')) {
        return res.status(403).json(deniedBody(unavailable));
      }
      return res.status(403).type('html').send(deniedPage(unavailable));
    } catch (err) {
      return next(err);
    }
  }

  gate.express = () => gate;

  /**
   * Fastify: registers a preHandler. Run after the hook that sets req.user.
   * Only a signed-in browser session is asked about: internal callers carry
   * role 'internal' and a shared secret and are machines, not an account.
   */
  gate.fastify = (app) => {
    app.addHook('preHandler', async (req, reply) => {
      if (!slug || !req.user || req.user.role === 'internal') return undefined;
      if (isOpen(req.url)) return undefined;
      const r = await check({
        username: req.user.username, cookie: req.headers.cookie, authorization: req.headers.authorization,
      });
      if (r.allowed) return undefined;
      return reply.code(403).send(deniedBody(r.reason === 'unreachable-closed'));
    });
    return app;
  };

  gate.check = check;
  gate.message = message;
  // What /api/build reports as `gate`: the slug this gate was actually built
  // with (null when it is a pass-through), never a separately typed constant.
  gate.slug = slug || null;
  gate.failOpen = failOpen;
  return gate;
}

module.exports = { createAppGate, slugFromEnv, CACHE_TTL_MS };
