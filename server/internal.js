'use strict';
/**
 * internal.js — service-to-service authentication.
 *
 * Replaces the X-Internal-Secret checks in media, cortex, budget and the
 * X-Service-Token variants in health, shopper and kitchen (one scheme is enough:
 * a shared secret in X-Internal-Secret).
 *
 * An internal network is a boundary, not a permission: anything that can reach a
 * service could otherwise use it, so internal routes carry a shared secret.
 *
 * FAIL CLOSED. If the secret is not configured the middleware answers 503, never
 * "open". A missing header is 401, a wrong one 403. The comparison is
 * constant-time (hashing first so unequal lengths do not leak through timing).
 * The secret is read PER REQUEST from `env`, so rotating it in the environment
 * needs no restart and a test can set it late.
 *
 * serviceUser(req): X-Service-User names the account a machine caller is acting
 * for. It is unauthenticated text, so it is honoured ONLY when the secret proved
 * the caller (`req.serviceCall`, set by this middleware). Read ahead of the
 * session unconditionally, any signed-in account could act as any other by adding
 * one header — octopus-shopper found that on 2026-08-11.
 */

const crypto = require('crypto');

const USERNAME_RE = /^[A-Za-z0-9_-]{3,30}$/;     // same shape octopus-auth enforces at registration

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function check({ env, name, header, secret }, req) {
  const expected = secret !== undefined ? secret : String((env || process.env)[name] || '');
  if (!expected) return { status: 503, error: `${name} not configured` };
  const given = req.headers && req.headers[header];
  if (!given) return { status: 401, error: 'Internal secret required.' };
  if (!safeEqual(given, expected)) return { status: 403, error: 'Forbidden' };
  return null;
}

/**
 * Express middleware; `.fastify` is the matching Fastify preHandler.
 * @param {object} [o]
 * @param {object} [o.env]     default process.env
 * @param {string} [o.name]    variable holding the secret (default INTERNAL_SECRET)
 * @param {string} [o.header]  default 'x-internal-secret'
 */
function requireInternalSecret({ env, name = 'INTERNAL_SECRET', header = 'x-internal-secret', secret } = {}) {
  const cfg = { env, name, header: header.toLowerCase(), secret };
  const mw = (req, res, next) => {
    const bad = check(cfg, req);
    if (bad) return res.status(bad.status).json({ error: bad.error });
    req.serviceCall = true;
    return next();
  };
  mw.fastify = async (req, reply) => {
    const bad = check(cfg, req);
    if (bad) return reply.code(bad.status).send({ error: bad.error });
    req.serviceCall = true;
    return undefined;
  };
  return mw;
}

/**
 * The account an internal call is acting for, or `defaultUser` (null when none).
 * Returns null/default unless the secret proved the caller. A name that could not
 * have been registered throws an Error with statusCode 400 — it must NOT quietly
 * fall back to the default, which would write someone's data into the owner's.
 *
 * `allowBody` also reads `username`/`user` from the body or query (octopus-media's
 * older convention); off by default.
 */
function serviceUser(req, { defaultUser = null, allowBody = false } = {}) {
  if (!req || !req.serviceCall) return null;
  let raw = req.headers && req.headers['x-service-user'];
  if (!raw && allowBody) {
    raw = (req.body && (req.body.username || req.body.user)) || (req.query && (req.query.username || req.query.user));
  }
  const name = String(raw || '').trim();
  if (!name) return defaultUser;
  if (!USERNAME_RE.test(name)) {
    throw Object.assign(new Error('invalid user'), { statusCode: 400 });
  }
  return name;
}

module.exports = { requireInternalSecret, serviceUser, safeEqual, USERNAME_RE };
