'use strict';
/**
 * prefs.js — the suite theme preference, read server-side.
 *
 * octopus-auth stores { mode, accent, density } per user and sets a NON-HttpOnly
 * cookie `octopus_prefs` on the parent domain holding only those three values
 * (nothing sensitive). The client applies it before paint with the kit's
 * theme-boot snippet; this module lets a server render the same attributes into
 * the first byte of HTML, so there is no flash and no server call.
 *
 * Cookie value: URL-encoded JSON  {"v":1,"mode":"dark|light|system",
 *   "accent":"app"|"#rrggbb","density":"comfortable|compact"}
 *
 * VALIDATION IS STRICT and mirrors the client's rules: a hex colour must match
 * ^#[0-9a-fA-F]{6}$, the other fields are whitelists, and anything malformed —
 * bad JSON, wrong version, oversized, a field that is not on its list — falls
 * back to that field's DEFAULT (never an error, never an echo of the input). The
 * cookie is user-controlled text; only whitelisted values ever reach a template.
 */

const COOKIE_NAME = 'octopus_prefs';
const MODES = ['dark', 'light', 'system'];
const DENSITIES = ['comfortable', 'compact'];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_COOKIE_CHARS = 512;
const DEFAULTS = Object.freeze({ v: 1, mode: 'dark', accent: 'app', density: 'comfortable' });
const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** Validate arbitrary input (an object) into a complete, safe prefs object. */
function sanitize(input) {
  const o = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (o.v !== undefined && o.v !== 1) return { ...DEFAULTS };
  return {
    v: 1,
    mode: MODES.includes(o.mode) ? o.mode : DEFAULTS.mode,
    accent: o.accent === 'app' ? 'app' : (typeof o.accent === 'string' && HEX_RE.test(o.accent) ? o.accent.toLowerCase() : DEFAULTS.accent),
    density: DENSITIES.includes(o.density) ? o.density : DEFAULTS.density,
  };
}

/** Parse a cookie VALUE (still URL-encoded) into prefs; defaults on anything wrong. */
function parsePrefsValue(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_COOKIE_CHARS) return { ...DEFAULTS };
  try { return sanitize(JSON.parse(decodeURIComponent(value))); } catch { return { ...DEFAULTS }; }
}

/** Pull `octopus_prefs` out of a Cookie header and parse it. */
function parseCookieHeader(header) {
  if (typeof header !== 'string' || !header) return { ...DEFAULTS };
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === COOKIE_NAME) return parsePrefsValue(part.slice(i + 1).trim());
  }
  return { ...DEFAULTS };
}

/** Prefs for a request (Express or Fastify — only headers.cookie is read). */
function readPrefs(req) {
  return parseCookieHeader(req && req.headers ? req.headers.cookie : '');
}

/** What a template needs. Every value is whitelisted or a validated hex. */
function themeLocals(prefs) {
  const p = sanitize(prefs);
  const attrs = [`data-theme="${p.mode}"`, `data-density="${p.density}"`];
  return {
    ...p,
    dataTheme: p.mode,
    dataDensity: p.density,
    // Only when the user picked their own colour; 'app' keeps the app's accent.
    accentStyle: p.accent === 'app' ? '' : `--o-accent:${p.accent}`,
    htmlAttrs: attrs.join(' '),
  };
}

/** Express middleware: res.locals.theme. Fastify: use readPrefs/themeLocals in a hook. */
function middleware() {
  return (req, res, next) => {
    try { res.locals.theme = themeLocals(readPrefs(req)); } catch { res.locals.theme = themeLocals(DEFAULTS); }
    next();
  };
}

/**
 * A Set-Cookie value for octopus-auth to send. Non-HttpOnly (the client reads
 * it before paint), Secure, SameSite=Lax, long Max-Age. `domain` is the parent
 * domain so every app sees it; it is validated, never concatenated blindly.
 */
function serializePrefsCookie(prefs, { domain, maxAge = ONE_YEAR_S, secure = true } = {}) {
  const p = sanitize(prefs);
  const value = encodeURIComponent(JSON.stringify({ v: 1, mode: p.mode, accent: p.accent, density: p.density }));
  const parts = [`${COOKIE_NAME}=${value}`, 'Path=/'];
  if (domain !== undefined && domain !== null && domain !== '') {
    if (typeof domain !== 'string' || !/^\.?[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(domain) || domain.length > 253) {
      throw new Error('serializePrefsCookie: invalid domain');
    }
    parts.push(`Domain=${domain}`);
  }
  parts.push(`Max-Age=${Math.max(0, Math.floor(Number(maxAge) || 0))}`);
  if (secure) parts.push('Secure');
  parts.push('SameSite=Lax');
  return parts.join('; ');
}

module.exports = {
  COOKIE_NAME, MODES, DENSITIES, DEFAULTS, HEX_RE,
  sanitize, parsePrefsValue, parseCookieHeader, readPrefs, themeLocals, middleware, serializePrefsCookie,
};
