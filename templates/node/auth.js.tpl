'use strict';

/**
 * auth.js — who is asking.
 *
 * sso: the estate's @octopus-security/auth-client, an optionalDependency because
 *      it lives in GitHub Packages. It is required lazily, and in sso mode a
 *      missing package is a BOOT REFUSAL, never a silent fallback to "no auth".
 * dev: every request is DEV_USER. config.js refuses this in production.
 *
 * The per-app access gate (octopus-kit's createAppGate) runs AFTER requireUser.
 */

function buildAuth(cfg, { ssoFactory } = {}) {
  let identify;
  if (cfg.authMode === 'dev') {
    identify = (req, _res, next) => { req.user = { username: cfg.devUser, role: 'dev' }; next(); };
  } else {
    let factory = ssoFactory;
    if (!factory) {
      try {
        factory = require('@octopus-security/auth-client').createSSOMiddleware;
      } catch {
        throw new Error('Refusing to boot: AUTH_MODE=sso but @octopus-security/auth-client is not installed. '
          + 'Build with NPM_TOKEN (see the Dockerfile), or use AUTH_MODE=dev locally.');
      }
    }
    identify = factory({
      baseUrl: cfg.authUrl,
      cacheTtlMs: 5 * 60 * 1000,
      onUser: (user) => ({ username: user.username, role: user.role }),
    });
  }

  function requireUser(req, res, next) {
    if (req.user && req.user.username) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
    const back = encodeURIComponent(`${req.protocol}://${req.get('host')}${req.originalUrl}`);
    return res.redirect(`${cfg.authPublicUrl}/login?redirect=${back}`);
  }

  return { identify, requireUser };
}

/**
 * Same-origin check for state-changing requests. The estate SSO cookie is scoped
 * to the parent domain, so it would ride along on a POST from any other site if
 * the browser allowed it; this does not depend on how auth sets its cookie.
 */
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin') || req.get('referer');
  if (!origin) return next(); // non-browser client; the session is still required
  try { if (new URL(origin).host === req.get('host')) return next(); } catch { /* refuse */ }
  return res.status(403).send('Cross-origin request refused');
}

module.exports = { buildAuth, sameOrigin };
