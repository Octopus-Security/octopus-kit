'use strict';
/**
 * kit-assets.js — serve the kit's own stylesheets from the installed package.
 *
 * An app that installs octopus-kit does not copy tokens/ or ui/ into its tree;
 * it serves them from node_modules under /kit/…, so a kit bump is the only
 * thing that changes them.
 *
 *   app.use('/kit', kitAssets());                   // GET /kit/tokens/tokens.css
 *   <link rel="stylesheet" href="<%= kit('/tokens/tokens.css') %>">   // …?v=<content hash>
 *
 * Only .css files under `dirs` are ever served (default tokens/ and ui/); a
 * request is resolved and checked to stay inside the kit directory, so `..`,
 * encoded separators and absolute paths are refused. No framework needed: it is
 * a plain (req, res, next) handler and works on Express.
 *
 * The URL carries a per-file content hash (see build-stamp.js for why) and the
 * response is `immutable` only when the request carries that hash.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function kitDir() {
  // server/ sits one level below the package root.
  return path.resolve(__dirname, '..');
}

function kitAssets({ dir = kitDir(), dirs = ['tokens', 'ui'], allow = /\.css$/i, prefix = '/kit' } = {}) {
  const root = path.resolve(dir);
  const hashes = new Map();

  function resolveFile(urlPath) {
    let rel;
    try { rel = decodeURIComponent(String(urlPath).split('?')[0]); } catch { return null; }
    if (rel.includes('\0') || rel.includes('\\')) return null;
    rel = rel.replace(/^\/+/, '');
    const top = rel.split('/')[0];
    if (!dirs.includes(top) || !allow.test(rel)) return null;
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return null;
    return file;
  }

  function hashOf(file) {
    if (!hashes.has(file)) {
      let h = null;
      try { h = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8); } catch { /* unstamped */ }
      hashes.set(file, h);
    }
    return hashes.get(file);
  }

  function handler(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const file = resolveFile(req.path !== undefined ? req.path : String(req.url).split('?')[0]);
    if (!file) return next();
    fs.readFile(file, (err, buf) => {
      if (err) return next();
      const wanted = /[?&]v=([0-9a-f]{8})\b/.exec(String(req.url || req.originalUrl || ''));
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.setHeader('Cache-Control', wanted && wanted[1] === hashOf(file) ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.end(req.method === 'HEAD' ? undefined : buf);
    });
  }

  /** '/tokens/tokens.css' -> '/kit/tokens/tokens.css?v=ab12cd34' (bare path if unreadable). */
  handler.url = (p) => {
    const file = resolveFile(p);
    const h = file && hashOf(file);
    return `${prefix}/${String(p).replace(/^\/+/, '')}${h ? `?v=${h}` : ''}`;
  };
  return handler;
}

module.exports = { kitAssets, kitDir };
