'use strict';
/**
 * pack.js — the octopus-favicon-pack v1 format: build one from an emoji or an SVG,
 * validate one, compute its packId, and move it to/from the directory form.
 *
 * No rasterizing lives here (no sharp, no PNG/ICO encoding) — kit stays zero-runtime-
 * dependency on purpose, because it installs into node:22-alpine by codeload tarball.
 * octopus-studio emits the full role set (PNG/ICO/social) from its existing sharp
 * pipeline through this SAME module (buildPack/validatePack/packId), so the id is
 * computed identically everywhere; it never reimplements the hash.
 *
 * Strict validation on purpose, like manifest/validate.js: an unknown key is an error
 * and at most one file per role, so a producer bug (two "icon-192"s, a typo'd role)
 * cannot quietly ship a broken pack.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { emojiSvg } = require('./emoji-svg');

const FORMAT = 'octopus-favicon-pack';
const VERSION = 1;

const SLUG_RE = /^[a-z][a-z0-9-]{0,39}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

const SOURCE_KINDS = ['emoji', 'svg', 'raster'];
const ENCODINGS = ['utf8', 'base64'];

// The closed role vocabulary. `type` is what a file's declared `type` must equal; `width`/`height`
// are checked only when the file carries its own width/height (kit never rasterizes, so it never
// knows these for anything but the SVG `favicon` role — studio's producer sets them).
const ROLES = {
  favicon: { type: 'image/svg+xml' },
  'favicon-16': { type: 'image/png', width: 16, height: 16 },
  'favicon-32': { type: 'image/png', width: 32, height: 32 },
  'favicon-48': { type: 'image/png', width: 48, height: 48 },
  ico: { type: 'image/x-icon' },
  'apple-touch': { type: 'image/png', width: 180, height: 180 },
  'icon-192': { type: 'image/png', width: 192, height: 192 },
  'icon-512': { type: 'image/png', width: 512, height: 512 },
  'maskable-512': { type: 'image/png', width: 512, height: 512 },
  social: { type: 'image/png', width: 1200, height: 630 },
};
const ROLE_NAMES = Object.keys(ROLES);

// The canonical public filename for each role — used by webmanifest() and documented in
// docs/brand.md for whatever serves these roles (octopus-auth's /brand/:slug/<file> routes).
const PUBLIC_FILENAME = {
  favicon: 'favicon.svg',
  'favicon-16': 'favicon-16.png',
  'favicon-32': 'favicon-32.png',
  'favicon-48': 'favicon-48.png',
  ico: 'favicon.ico',
  'apple-touch': 'apple-touch-icon.png',
  'icon-192': 'icon-192.png',
  'icon-512': 'icon-512.png',
  'maskable-512': 'maskable-512.png',
  social: 'social.png',
};

const TOP_KEYS = ['format', 'version', 'slug', 'name', 'source', 'theme', 'generator', 'createdAt', 'files'];
const SOURCE_KEYS = ['kind', 'value'];
const THEME_KEYS = ['color', 'background'];
const FILE_KEYS = ['path', 'role', 'type', 'width', 'height', 'bytes', 'sha256', 'encoding', 'data'];

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = v => typeof v === 'string';

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * A conservative blocklist, not an SVG parser (kit has no dependency to parse XML with).
 * Rejects more than the strict minimum rather than less: no <script>, no on*= handler, no
 * <foreignObject>, and no href/xlink:href/url(...) that points anywhere but a same-document
 * fragment (#id). A data: URI is also rejected — simplest rule that cannot be bypassed by
 * nesting an http(s) reference inside one.
 */
function sanitiseSvg(svg) {
  if (!isStr(svg) || !svg.trim()) throw new Error('buildPack: svg must be a non-empty string');
  if (!/^\s*<svg[\s>]/i.test(svg)) throw new Error('buildPack: svg must start with an <svg> element');
  if (/<script[\s>]/i.test(svg)) throw new Error('buildPack: svg must not contain <script>');
  if (/<foreignObject[\s>]/i.test(svg)) throw new Error('buildPack: svg must not contain <foreignObject>');
  if (/\son\w+\s*=/i.test(svg)) throw new Error('buildPack: svg must not contain an on*= event handler');
  if (/\b(?:xlink:href|href)\s*=\s*(["'])(?!#)/i.test(svg)) throw new Error('buildPack: svg must not reference an external resource (href must be a same-document #fragment)');
  if (/\burl\(\s*(["']?)(?!#)/i.test(svg)) throw new Error('buildPack: svg must not contain an external url(...)');
  return svg;
}

function fileRecord({ path: filePath, role, type, data, encoding, width, height }) {
  if (!ROLE_NAMES.includes(role)) throw new Error(`buildPack: unknown role "${role}"`);
  const enc = encoding || (ROLES[role].type === 'image/svg+xml' ? 'utf8' : 'base64');
  const buf = enc === 'base64' ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf8');
  const rec = {
    path: filePath, role, type: type || ROLES[role].type,
    bytes: buf.length, sha256: sha256Hex(buf), encoding: enc, data,
  };
  if (width !== undefined) rec.width = width;
  if (height !== undefined) rec.height = height;
  return rec;
}

/**
 * buildPack({ slug, name, emoji, theme, generator, createdAt })  — the one-file emoji pack
 * buildPack({ slug, name, svg,   theme, generator, createdAt })  — a sanitised-SVG pack
 *
 * Produces exactly one file, role "favicon". A producer that can rasterize (studio, via
 * sharp) builds the rest of the role set by calling the EXPORTED `fileRecord` and pushing
 * the results onto `.files`, then runs the whole thing through validatePack. Use that
 * export rather than assembling the record by hand: `bytes`, `sha256` and `encoding` feed
 * `packId`, so a second implementation that drifts produces packs this one rejects.
 */
function buildPack({ slug, name, emoji, svg, theme, generator, createdAt } = {}) {
  if (!isStr(slug) || !SLUG_RE.test(slug)) throw new Error(`buildPack: slug must match ${SLUG_RE}`);
  if (!isStr(name) || !name.trim()) throw new Error('buildPack: name is required');
  if ((emoji !== undefined) === (svg !== undefined)) throw new Error('buildPack: pass exactly one of emoji or svg');
  if (theme !== undefined) {
    if (!isObj(theme)) throw new Error('buildPack: theme must be an object');
    for (const k of Object.keys(theme)) if (!THEME_KEYS.includes(k)) throw new Error(`buildPack: theme: unknown key "${k}"`);
    for (const k of THEME_KEYS) if (theme[k] !== undefined && !HEX_COLOR_RE.test(theme[k])) throw new Error(`buildPack: theme.${k} must be #rrggbb`);
  }

  let source, svgText;
  if (emoji !== undefined) { svgText = emojiSvg(emoji); source = { kind: 'emoji', value: emoji }; }
  else { svgText = sanitiseSvg(svg); source = { kind: 'svg', value: svgText }; }

  const favicon = fileRecord({ path: 'favicon.svg', role: 'favicon', data: svgText, encoding: 'utf8' });

  const pack = {
    format: FORMAT,
    version: VERSION,
    slug,
    name,
    source,
    generator: generator || `octopus-kit@${require('../package.json').version}`,
    createdAt: createdAt || new Date().toISOString(),
    files: [favicon],
  };
  if (theme) pack.theme = theme;
  return pack;
}

/**
 * validatePack(pack) -> { ok, errors: string[] }
 * Strict and self-contained: format/version, slug shape, source/theme shape, the role
 * vocabulary, at most one file per role and the required `favicon` role, sha256/bytes/base64
 * actually matching `data`, and a declared `type` matching its role.
 */
function validatePack(pack) {
  const errors = [];
  const err = m => errors.push(m);
  if (!isObj(pack)) return { ok: false, errors: ['pack must be a JSON object'] };

  for (const k of Object.keys(pack)) if (!TOP_KEYS.includes(k)) err(`unknown key "${k}"`);

  if (pack.format !== FORMAT) err(`format must be "${FORMAT}"`);
  if (pack.version !== VERSION) err(`version must be ${VERSION}`);
  if (!isStr(pack.slug) || !SLUG_RE.test(pack.slug)) err(`slug must match ${SLUG_RE}`);
  if (!isStr(pack.name) || !pack.name.trim()) err('name must be a non-empty string');

  if (pack.source !== undefined) {
    if (!isObj(pack.source)) err('source must be an object');
    else {
      for (const k of Object.keys(pack.source)) if (!SOURCE_KEYS.includes(k)) err(`source: unknown key "${k}"`);
      if (!SOURCE_KINDS.includes(pack.source.kind)) err(`source.kind must be one of ${SOURCE_KINDS.join(', ')}`);
      if (pack.source.value !== undefined && !isStr(pack.source.value)) err('source.value must be a string');
    }
  }

  if (pack.theme !== undefined) {
    if (!isObj(pack.theme)) err('theme must be an object');
    else {
      for (const k of Object.keys(pack.theme)) if (!THEME_KEYS.includes(k)) err(`theme: unknown key "${k}"`);
      for (const k of THEME_KEYS) if (pack.theme[k] !== undefined && !HEX_COLOR_RE.test(pack.theme[k])) err(`theme.${k} must be #rrggbb`);
    }
  }

  if (pack.generator !== undefined && !isStr(pack.generator)) err('generator must be a string');
  if (pack.createdAt !== undefined && (!isStr(pack.createdAt) || Number.isNaN(Date.parse(pack.createdAt)))) err('createdAt must be an ISO timestamp string');

  if (!Array.isArray(pack.files) || !pack.files.length) {
    err('files must be a non-empty list');
    return { ok: false, errors };
  }

  const seenRoles = new Set();
  const seenPaths = new Set();
  let hasFavicon = false;

  pack.files.forEach((f, i) => {
    const at = `files[${i}]`;
    if (!isObj(f)) { err(`${at} must be an object`); return; }
    for (const k of Object.keys(f)) if (!FILE_KEYS.includes(k)) err(`${at}: unknown key "${k}"`);

    if (!isStr(f.path) || !f.path) err(`${at}.path must be a non-empty string`);
    else if (seenPaths.has(f.path)) err(`${at}: duplicate path "${f.path}"`);
    else seenPaths.add(f.path);

    let roleInfo = null;
    if (!isStr(f.role) || !ROLE_NAMES.includes(f.role)) {
      err(`${at}.role must be one of ${ROLE_NAMES.join(', ')}`);
    } else if (seenRoles.has(f.role)) {
      err(`${at}: duplicate role "${f.role}" (at most one file per role)`);
    } else {
      seenRoles.add(f.role);
      if (f.role === 'favicon') hasFavicon = true;
      roleInfo = ROLES[f.role];
    }

    if (!isStr(f.type)) err(`${at}.type must be a string`);
    else if (roleInfo && f.type !== roleInfo.type) err(`${at}.type "${f.type}" does not match role "${f.role}" (expected "${roleInfo.type}")`);

    if (roleInfo && roleInfo.width !== undefined) {
      if (f.width !== undefined && f.width !== roleInfo.width) err(`${at}.width must be ${roleInfo.width} for role "${f.role}"`);
      if (f.height !== undefined && f.height !== roleInfo.height) err(`${at}.height must be ${roleInfo.height} for role "${f.role}"`);
    }

    if (!ENCODINGS.includes(f.encoding)) err(`${at}.encoding must be one of ${ENCODINGS.join(', ')}`);
    if (!isStr(f.data) || !f.data.length) { err(`${at}.data must be a non-empty string`); return; }
    if (!Number.isInteger(f.bytes) || f.bytes < 0) err(`${at}.bytes must be a non-negative integer`);
    const shaOk = isStr(f.sha256) && SHA256_RE.test(f.sha256);
    if (!shaOk) err(`${at}.sha256 must be 64 lower-case hex characters`);

    let buf;
    if (f.encoding === 'base64') {
      if (!BASE64_RE.test(f.data) || f.data.length % 4 !== 0) { err(`${at}.data is not valid base64`); return; }
      buf = Buffer.from(f.data, 'base64');
      if (buf.toString('base64') !== f.data) { err(`${at}.data is not valid base64`); return; } // catches stray/mispadded chars Buffer silently tolerates
    } else if (f.encoding === 'utf8') {
      buf = Buffer.from(f.data, 'utf8');
    } else {
      return; // encoding already reported invalid above
    }

    if (shaOk && sha256Hex(buf) !== f.sha256) err(`${at}.sha256 does not match data`);
    if (Number.isInteger(f.bytes) && buf.length !== f.bytes) err(`${at}.bytes does not match data`);
  });

  if (!hasFavicon) err('files must include a "favicon" role (the only required one)');

  return { ok: errors.length === 0, errors };
}

/**
 * canonicalForm(pack) -> string
 *
 * `slug=<slug>\nversion=<version>\n` followed by one `role\0path\0sha256` line per file,
 * SORTED lexicographically, joined by `\n`. A pure function of {slug, version, files[].role,
 * .path, .sha256} — name/theme/generator/createdAt/source/data never affect it, and neither
 * does the files array's original order.
 *
 * Trusts the recorded sha256 rather than re-hashing `data` — callers MUST run validatePack
 * (which checks sha256 against data) before trusting a packId computed this way. That
 * ordering, not a re-hash here, is what keeps a tampered file from getting a false id.
 */
function canonicalForm(pack) {
  const lines = (pack.files || []).map(f => `${f.role}\0${f.path}\0${f.sha256}`).sort();
  return `slug=${pack.slug}\nversion=${pack.version}\n${lines.join('\n')}`;
}

/** sha256 hex digest (64 lower-case hex chars) of canonicalForm(pack). */
function packId(pack) {
  return sha256Hex(Buffer.from(canonicalForm(pack), 'utf8'));
}

/**
 * The directory form, for a zip download: `pack.json` holds everything the JSON form has
 * EXCEPT each file's `data` (the bytes are the sibling file at `path` instead), and
 * packFromDir reads them back in to reconstruct the exact same in-memory pack.
 */
function packToDir(pack, dir) {
  const root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });
  const meta = { ...pack, files: pack.files.map(({ data, ...rest }) => rest) };
  fs.writeFileSync(path.join(root, 'pack.json'), `${JSON.stringify(meta, null, 2)}\n`);
  for (const f of pack.files) {
    const target = path.resolve(root, f.path);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`packToDir: file path "${f.path}" escapes the directory`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(f.data, f.encoding === 'base64' ? 'base64' : 'utf8'));
  }
}

function packFromDir(dir) {
  const root = path.resolve(dir);
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'pack.json'), 'utf8'));
  const files = meta.files.map(f => {
    const target = path.resolve(root, f.path);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`packFromDir: file path "${f.path}" escapes the directory`);
    const buf = fs.readFileSync(target);
    return { ...f, data: f.encoding === 'base64' ? buf.toString('base64') : buf.toString('utf8') };
  });
  return { ...meta, files };
}

/**
 * webmanifest(pack, { baseUrl, name, themeColor }) -> a site.webmanifest object.
 *
 * `baseUrl` is opaque to this module (e.g. an auth URL already versioned with /v/:packId/);
 * each present role is appended as `${baseUrl}/${PUBLIC_FILENAME[role]}`. Lists only the
 * roles the pack actually has — a pack with only `favicon` gets a one-icon manifest.
 */
function webmanifest(pack, { baseUrl, name, themeColor } = {}) {
  if (!isStr(baseUrl) || !baseUrl) throw new Error('webmanifest: baseUrl is required');
  const base = baseUrl.replace(/\/+$/, '');
  const byRole = new Map((pack.files || []).map(f => [f.role, f]));
  const icons = [];
  const add = (role, sizes, purpose) => {
    const f = byRole.get(role);
    if (!f) return;
    const entry = { src: `${base}/${PUBLIC_FILENAME[role]}`, sizes, type: f.type };
    if (purpose) entry.purpose = purpose;
    icons.push(entry);
  };
  add('favicon', 'any');
  add('icon-192', '192x192');
  add('icon-512', '512x512');
  add('maskable-512', '512x512', 'maskable');

  const manifest = { name: name || pack.name, icons };
  const color = themeColor || (pack.theme && pack.theme.color);
  const background = pack.theme && pack.theme.background;
  if (color) manifest.theme_color = color;
  if (background) manifest.background_color = background;
  return manifest;
}

module.exports = {
  FORMAT, VERSION, SLUG_RE, ROLES, ROLE_NAMES, PUBLIC_FILENAME,
  buildPack, fileRecord, validatePack, canonicalForm, packId, packToDir, packFromDir,
  webmanifest, sanitiseSvg,
};
