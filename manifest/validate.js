'use strict';
/**
 * validate.js — hand-written validator for octopus.json (no ajv: the kit has no
 * runtime dependencies). octopus.schema.json is the same contract in JSON Schema
 * for editors and other tooling; test/manifest.test.js asserts the two agree on
 * the field list, the enums and the patterns.
 *
 *   validate(obj)         -> { ok, errors: string[], warnings: string[] }
 *   fromHubJson(hub, o)   -> a manifest object from the legacy hub.json
 *   toHubJson(manifest)   -> the legacy hub.json that hub-apps.mjs reads
 *   readManifest(file)    -> parse + validate a file
 *
 * Strict on purpose, like octopus-ops/templates.js: an unknown key is an error,
 * so a typo such as "levle" cannot quietly turn a hard dependency into none.
 */

const fs = require('fs');

const SLUG_RE = /^[a-z0-9-]+$/;
const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
const SERVICE_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const TOOL_RE = /^[a-z][a-z0-9_]{0,63}$/;
const WIDGET_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const INTERNAL_PATH_RE = /^\/[A-Za-z0-9/_.:-]*$/;
const ACCESS = ['private', 'open'];
const PROFILES = ['ui', 'headless', 'static'];
const LEVELS = ['required', 'feature'];

const TOP_KEYS = ['$schema', 'slug', 'name', 'description', 'icon', 'subdomain', 'domain', 'access', 'profile', 'provides', 'uses'];
const PROVIDES_KEYS = ['internal', 'tools', 'widgets'];
const USES_KEYS = ['service', 'level', 'feature', 'why'];

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = v => typeof v === 'string';
// eslint-disable-next-line no-control-regex
const hasControl = s => /[\u0000-\u001f\u007f]/.test(s);

/** An emoji, loosely: pictographic characters/flags/keycaps and joiners, no letters or digits. */
function looksLikeEmoji(s) {
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s) && !/[A-Za-z0-9]/.test(s.replace(/[0-9#*]️?⃣/gu, ''));
}

function validate(m) {
  const errors = [];
  const warnings = [];
  const err = msg => errors.push(msg);

  if (!isObj(m)) return { ok: false, errors: ['octopus.json must be a JSON object'], warnings };
  for (const k of Object.keys(m)) if (!TOP_KEYS.includes(k)) err(`unknown key "${k}"`);

  if (!isStr(m.slug) || !SLUG_RE.test(m.slug) || m.slug.length > 40) err('slug must be 1-40 characters of a-z, 0-9 and "-"');
  if (!isStr(m.name) || !m.name.trim() || m.name.length > 60 || hasControl(m.name)) err('name must be 1-60 characters of plain text');
  if (m.description !== undefined && (!isStr(m.description) || m.description.length > 300 || hasControl(m.description))) err('description must be at most 300 characters of plain text');

  if (m.icon === undefined) warnings.push('icon is missing: the hub skips an app with no icon (an emoji is never invented)');
  else if (!isStr(m.icon) || !m.icon.length || m.icon.length > 16 || !looksLikeEmoji(m.icon)) err('icon must be an emoji');

  if (!isStr(m.subdomain) || !SUBDOMAIN_RE.test(m.subdomain)) err('subdomain must be a single DNS label (a-z, 0-9, "-")');
  if (m.domain !== undefined && (!isStr(m.domain) || !DOMAIN_RE.test(m.domain) || m.domain.includes('..'))) err('domain must be a lower-case host name');

  if (m.access !== undefined && !ACCESS.includes(m.access)) err(`access must be one of ${ACCESS.join(', ')}`);
  if (!PROFILES.includes(m.profile)) err(`profile must be one of ${PROFILES.join(', ')}`);

  if (m.provides !== undefined) {
    if (!isObj(m.provides)) err('provides must be an object');
    else {
      for (const k of Object.keys(m.provides)) if (!PROVIDES_KEYS.includes(k)) err(`provides: unknown key "${k}"`);
      const list = (key, re, max, what) => {
        const v = m.provides[key];
        if (v === undefined) return;
        if (!Array.isArray(v)) { err(`provides.${key} must be a list`); return; }
        if (v.length > max) err(`provides.${key} has more than ${max} entries`);
        const seen = new Set();
        v.forEach((x, i) => {
          if (!isStr(x) || !re.test(x) || x.length > 200) err(`provides.${key}[${i}] must be ${what}`);
          else if (seen.has(x)) err(`provides.${key}[${i}] duplicates "${x}"`);
          else seen.add(x);
        });
      };
      list('internal', INTERNAL_PATH_RE, 100, 'a path starting with "/"');
      list('tools', TOOL_RE, 100, 'a tool name (a-z, 0-9, "_")');
      list('widgets', WIDGET_RE, 50, 'a widget name (a-z, 0-9, "-", "_")');
      if (Array.isArray(m.provides.internal) && m.profile === 'static' && m.provides.internal.length) err('a static app cannot provide internal endpoints');
    }
  }

  if (m.uses !== undefined) {
    if (!Array.isArray(m.uses)) err('uses must be a list');
    else {
      if (m.uses.length > 20) err('uses has more than 20 entries');
      const ids = new Set();
      m.uses.forEach((u, i) => {
        const at = `uses[${i}]`;
        if (!isObj(u)) { err(`${at} must be an object`); return; }
        for (const k of Object.keys(u)) if (!USES_KEYS.includes(k)) err(`${at} has unknown key "${k}"`);
        if (!isStr(u.service) || !SERVICE_RE.test(u.service)) err(`${at}.service must be a service name (a-z, 0-9, "-", "_")`);
        if (!LEVELS.includes(u.level)) err(`${at}.level must be one of ${LEVELS.join(', ')}`);
        if (u.level === 'feature' && (!isStr(u.feature) || !u.feature.trim())) err(`${at}.feature is required when level is "feature" (name the feature that breaks)`);
        if (u.feature !== undefined && (!isStr(u.feature) || !u.feature.trim() || u.feature.length > 80 || hasControl(u.feature))) err(`${at}.feature must be 1-80 characters of plain text`);
        if (u.why !== undefined && (!isStr(u.why) || !u.why.trim() || u.why.length > 200 || hasControl(u.why))) err(`${at}.why must be 1-200 characters of plain text`);
        if (u.why === undefined) warnings.push(`${at}: say why (what is it for?) so an admin can decide`);
        const id = isStr(u.service) ? (u.feature ? `${u.service}:${u.feature}` : u.service) : null;
        if (id) { if (ids.has(id)) err(`${at} duplicates "${id}"`); ids.add(id); }
        if (u.service === m.slug) err(`${at}: an app cannot use itself`);
      });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Legacy hub.json -> manifest.
 *   hub.json:  { name, subdomain, domain?, icon?, access? }
 * hub.json never carried a slug (the hub keys tiles by repo/subdomain), so one is
 * supplied via `opts.slug` or defaults to the subdomain — pass the real one where
 * they differ. `profile` is not in hub.json either; it defaults to 'ui' and can
 * be overridden with `opts.profile`. Nothing else is invented: no icon, and no
 * domain (hub-apps.mjs applies its own default when none is given).
 * Unknown keys in the hub.json are reported through `opts.onWarning`, not copied.
 */
function fromHubJson(hub, opts = {}) {
  if (!isObj(hub)) throw new Error('hub.json must be a JSON object');
  const out = { slug: opts.slug || hub.slug || hub.subdomain, name: hub.name, subdomain: hub.subdomain };
  if (hub.icon !== undefined) out.icon = hub.icon;
  if (hub.domain !== undefined) out.domain = hub.domain;
  out.access = hub.access !== undefined ? hub.access : 'private';
  out.profile = opts.profile || 'ui';
  const known = ['name', 'subdomain', 'domain', 'icon', 'access', 'slug'];
  for (const k of Object.keys(hub)) if (!known.includes(k) && opts.onWarning) opts.onWarning(`hub.json key "${k}" was not carried over`);
  return out;
}

/** manifest -> hub.json (only the fields the hub scanner reads). */
function toHubJson(m) {
  const out = { name: m.name, subdomain: m.subdomain };
  if (m.domain) out.domain = m.domain;
  if (m.icon) out.icon = m.icon;
  if (m.access) out.access = m.access;
  return out;
}

function readManifest(file) {
  let obj;
  try { obj = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { ok: false, errors: [`${file}: ${e.message}`], warnings: [], manifest: null }; }
  return { ...validate(obj), manifest: obj };
}

module.exports = { validate, fromHubJson, toHubJson, readManifest, SLUG_RE, ACCESS, PROFILES, LEVELS, TOP_KEYS };
