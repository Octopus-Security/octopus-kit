'use strict';
/**
 * health.js — /health and /api/build, mounted AHEAD of auth.
 *
 * Both have to answer when a login is exactly what is broken, and a monitor that
 * appends a cache-buster (/health?probe=1) must not fall through to a 401 — the
 * routers below match on the path without its query.
 *
 *   GET /health     -> { ok: true, status: 'ok', service }
 *   GET /api/build  -> { ok, service, build, startedAt, gate? }
 *
 * `gate` is read off the mounted gate object at request time (absent when none is
 * mounted or it is a pass-through), never a typed constant, so it cannot disagree
 * with what is actually enforced. `unknown` in `build` is never `current`.
 *
 * `app` is an Express app or a Fastify instance; the flavour is detected.
 * Replaces the hand-written pairs in every service.
 */

function healthRoutes(app, { service, stamp, gate, extra } = {}) {
  const name = service || (stamp && stamp.service) || 'unknown-service';
  const healthBody = () => ({ ok: true, status: 'ok', service: name });
  const buildBody = () => {
    const base = stamp && typeof stamp.info === 'function'
      ? stamp.info()
      : { ok: true, service: name, build: stamp ? stamp.build : 'unknown', startedAt: stamp ? stamp.startedAt : undefined };
    const body = { ...base, service: name };
    if (!body.build) body.build = 'unknown';
    if (gate && gate.slug) body.gate = gate.slug;
    if (typeof extra === 'function') {
      try { Object.assign(body, extra() || {}); } catch { /* a stamp field must never break the probe */ }
    }
    return body;
  };

  if (typeof app.addHook === 'function') {                       // Fastify
    app.get('/health', async () => healthBody());
    app.get('/api/build', async (req, reply) => { reply.header('Cache-Control', 'no-store'); return buildBody(); });
  } else {                                                        // Express
    app.get('/health', (req, res) => res.json(healthBody()));
    app.get('/api/build', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(buildBody()); });
  }
  return app;
}

module.exports = { healthRoutes };
