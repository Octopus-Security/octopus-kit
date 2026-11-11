'use strict';
/**
 * express.static options that match how assets are referenced.
 *
 *   app.use(express.static(dir, staticOptions()))
 *
 * A request carrying `?v=` or a hashed filename (name.<8+ hex>.ext, or a /<hash>/ path
 * segment) names its exact content, so it may be cached for a year and marked immutable.
 * Anything else is revalidated within a minute. Use ONLY where every reference is stamped;
 * an unstamped URL under a one-year TTL would never update.
 */

const HASHED = /[.\-_][0-9a-f]{8,}\.[a-z0-9]+$|\/[0-9a-f]{8,}\//i;
const ONE_YEAR = 'public, max-age=31536000, immutable';

function isVersioned(req, filePath) {
  const url = (req && (req.originalUrl || req.url)) || '';
  const q = url.indexOf('?');
  if (q >= 0 && /(^|[?&])v=[^&]+/.test(url.slice(q + 1))) return true;
  return HASHED.test(String(filePath || '').replace(/\\/g, '/'));
}

function staticOptions({ revalidate = 60 } = {}) {
  return {
    etag: true,
    maxAge: revalidate * 1000,
    setHeaders(res, filePath) {
      if (isVersioned(res.req, filePath)) res.setHeader('Cache-Control', ONE_YEAR);
    },
  };
}

let warned = false;
/** Logs once when NODE_ENV is not production (Express then renders slower and verbose). */
function warnIfNotProduction(log = console.warn, env = process.env) {
  if (warned || env.NODE_ENV === 'production') return false;
  warned = true;
  log(`[kit] NODE_ENV is "${env.NODE_ENV || ''}", not "production": express runs its slow development paths (view cache off, verbose errors)`);
  return true;
}
function _resetWarned() { warned = false; }

module.exports = { staticOptions, isVersioned, warnIfNotProduction, _resetWarned };
