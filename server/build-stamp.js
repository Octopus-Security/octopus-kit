'use strict';
/**
 * build-stamp.js — one string identifying the code a container is running, and
 * content-hashed URLs for the assets it serves.
 *
 * Replaces the build.js copies in budget, shopper, planner, edm, media, science
 * and ee. The common core is here; the two extras those last two carry are
 * options (`clientDirs`, `dirVersioned`).
 *
 * WHY IT EXISTS. Portainer polls and deploys on its own and reports back to
 * nobody, so a deploy that never landed and one that landed without helping look
 * identical from outside. A value that moves when the code moves is the only
 * way to tell them apart.
 *
 * DERIVED, NEVER A CONSTANT. A stamp you must remember to bump reports "nothing
 * changed" for a deploy that did. So `build` is computed at startup from the
 * files that ship, found by WALKING the directories (a written list stops
 * covering the file just added, silently, and always for the newest code).
 *
 * `unknown` IS THE FAILURE VALUE. Every step is guarded and the fallback is the
 * literal string 'unknown' — deliberately not hash-shaped, so it cannot be read
 * as an answer. `unknown` is never `current`. A stamp must never be the reason a
 * service fails to boot.
 *
 * asset(): Cloudflare caches CSS/JS for four hours and overrides the origin's
 * Cache-Control, so a front-end fix is invisible for that long and looks like a
 * failed deploy. A per-FILE content hash in the URL changes when and only when
 * that asset does (BUILD would re-download everything on every deploy). An asset
 * that cannot be read returns the bare path: a missing stamp is a stale cache, a
 * thrown error is a blank page.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_SKIP_DIRS = ['node_modules', '.git', 'data', 'test', 'tests'];
const DEFAULT_KEEP_EXT = ['.js', '.mjs', '.cjs', '.json', '.ejs', '.css', '.html'];
const DEFAULT_SKIP_FILES = ['package-lock.json'];
const MAX_ASSET_CACHE = 2000;

const hex = (buf, n) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, n);

/**
 * Relative paths (posix separators) of every shipped file under `root`, sorted.
 * Directories starting with '.' are skipped, as are `skipDirs` by name and
 * `exclude` entries by relative path or prefix ("public/uploads").
 */
function sourceFiles(root, { skipDirs, keepExt, skipFiles, exclude = [] } = {}) {
  const skipD = new Set(skipDirs || DEFAULT_SKIP_DIRS);
  const keepE = new Set(keepExt || DEFAULT_KEEP_EXT);
  const skipF = new Set(skipFiles || DEFAULT_SKIP_FILES);
  const excl = exclude.map(e => String(e).replace(/^\/+|\/+$/g, ''));
  const excluded = rel => excl.some(e => rel === e || rel.startsWith(e + '/'));
  const out = [];
  (function walk(dir, prefix) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    // Sorted explicitly: readdir order is not promised, and a hash depending on
    // it would differ between a laptop and the image.
    for (const e of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (excluded(rel)) continue;
      if (e.isDirectory()) {
        if (!skipD.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), rel);
      } else if (e.isFile() && keepE.has(path.extname(e.name)) && !skipF.has(e.name)) {
        out.push(rel);
      }
    }
  })(root, '');
  return out;
}

function hashFiles(roots, opts) {
  try {
    const h = crypto.createHash('sha256');
    let count = 0;
    roots.forEach((root, i) => {
      for (const rel of sourceFiles(root, opts)) {
        let src;
        try { src = fs.readFileSync(path.join(root, rel)); } catch { continue; }
        h.update(roots.length > 1 ? `${i}:${rel}` : rel);
        h.update(src);
        count++;
      }
    });
    return count ? h.digest('hex').slice(0, 12) : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * @param {object}   o
 * @param {string}   o.service      name reported by /api/build
 * @param {string[]} [o.roots]      directories to hash. Default: the directory of
 *                                  the entrypoint (require.main), else cwd.
 * @param {string[]} [o.exclude]    extra relative paths/prefixes to leave out
 * @param {string[]} [o.skipDirs]   replace the default skipped directory names
 * @param {string[]} [o.keepExt]    replace the default hashed extensions
 * @param {string}   [o.publicDir]  where asset() reads from (default <roots[0]>/public)
 * @param {string[]} [o.dirVersioned] URL prefixes versioned by DIRECTORY, e.g. ['/js/'].
 *        A module graph is not one file: a relative import resolves against the
 *        importer's URL WITHOUT its query, so `?v=` on an entry module leaves every
 *        sibling stale. `/js/<hash>/canvas.js` fixes the whole graph. (octopus-ee.)
 *        The server must strip the segment — see stamp.stripDirVersion().
 * @param {string[]} [o.clientDirs] directories (relative to roots[0]) whose
 *        content is the CLIENT stamp, reported as `client` — for apps whose
 *        browser code carries its own copy of the stamp (octopus-ee, -science).
 */
function createBuildStamp(o = {}) {
  const service = o.service || 'unknown-service';
  const main = require.main && require.main.filename ? path.dirname(require.main.filename) : process.cwd();
  const roots = (o.roots && o.roots.length ? o.roots : [main]).map(r => path.resolve(r));
  const opts = { skipDirs: o.skipDirs, keepExt: o.keepExt, exclude: o.exclude || [] };
  const publicDir = path.resolve(o.publicDir || path.join(roots[0], 'public'));
  const dirVersioned = (o.dirVersioned || []).map(p => `/${String(p).replace(/^\/+|\/+$/g, '')}/`);

  const build = hashFiles(roots, opts);
  const startedAt = new Date().toISOString();

  let client;
  if (o.clientDirs && o.clientDirs.length) {
    client = hashFiles(o.clientDirs.map(d => path.resolve(roots[0], d)), { ...opts, skipDirs: o.skipDirs || DEFAULT_SKIP_DIRS });
  }

  const cache = new Map();
  const dirHashes = new Map();

  function dirHash(prefix) {
    if (dirHashes.has(prefix)) return dirHashes.get(prefix);
    let v = null;
    try {
      const dir = path.join(publicDir, prefix);
      const names = fs.readdirSync(dir).filter(n => /\.(m?js|cjs)$/.test(n)).sort();
      if (names.length) {
        const h = crypto.createHash('sha256');
        for (const n of names) { h.update(n); h.update(fs.readFileSync(path.join(dir, n))); }
        v = h.digest('hex').slice(0, 8);
      }
    } catch { /* leave null: served unversioned */ }
    dirHashes.set(prefix, v);
    return v;
  }

  function computeAsset(urlPath) {
    const clean = String(urlPath).split('?')[0].split('#')[0];
    try {
      for (const prefix of dirVersioned) {
        if (clean.startsWith(prefix)) {
          const stamp = dirHash(prefix.slice(1));
          return stamp ? `${prefix}${stamp}/${clean.slice(prefix.length)}` : clean;
        }
      }
      const file = path.resolve(publicDir, clean.replace(/^\/+/, ''));
      // Never read outside publicDir, whatever a template passed in.
      if (file !== publicDir && !file.startsWith(publicDir + path.sep)) return clean;
      return `${clean}?v=${hex(fs.readFileSync(file), 8)}`;
    } catch {
      return clean; // not on disk — unstamped rather than a thrown render
    }
  }

  /** `/css/app.css` -> `/css/app.css?v=ab12cd34`. Read once, then cached. */
  function asset(urlPath) {
    const key = String(urlPath);
    let v = cache.get(key);
    if (v === undefined) {
      v = computeAsset(key);
      if (cache.size < MAX_ASSET_CACHE) cache.set(key, v);
    }
    return v;
  }

  /**
   * Inverse of the directory versioning: '/js/ab12cd34/canvas.js' -> '/js/canvas.js'.
   * Anything not of that shape comes back unchanged. Use it in the static route.
   */
  function stripDirVersion(urlPath) {
    for (const prefix of dirVersioned) {
      if (String(urlPath).startsWith(prefix)) {
        const m = new RegExp(`^${prefix}[0-9a-f]{8}/`).exec(urlPath);
        if (m) return prefix + String(urlPath).slice(m[0].length);
      }
    }
    return urlPath;
  }

  return {
    service,
    build,
    startedAt,
    source: build,
    client,
    asset,
    stripDirVersion,
    /** Files the stamp covers, so a test can assert nothing was missed. */
    files: () => roots.flatMap(r => sourceFiles(r, opts)),
    /** Fields for /api/build. */
    info: () => ({ ok: true, service, build, startedAt, ...(client ? { client } : {}) }),
    /** Express: makes asset() available to every template as `asset(...)`. */
    express(app) { app.locals.asset = asset; return app; },
  };
}

module.exports = { createBuildStamp, sourceFiles, DEFAULT_SKIP_DIRS, DEFAULT_KEEP_EXT };
