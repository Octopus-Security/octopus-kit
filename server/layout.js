'use strict';
/**
 * layout.js — customisation as pure functions. No database, no framework.
 *
 * Generalises two things that existed side by side:
 *   - octopus-budget's dashboard layout layer (branch customizable-dashboard):
 *     a built-in registry + saved prefs -> the resolved, ordered list, with
 *     rename / reorder / hide and user-made ("custom") items;
 *   - octopus-business's module registry (server/modules.js): whole modules that
 *     can be renamed or switched off, where a disabled module's routes 404.
 *
 * STORAGE STAYS WITH THE APP — a per-user database, an owner column, a JSON file.
 * An app loads its saved rows however it likes and hands them here; it saves
 * whatever normalisePrefs()/normaliseModulePrefs() return. This file never
 * decides whose preferences a request gets: that is the app's isolation style
 * and stays untouched.
 *
 * Shapes
 *   registry  [{ key, title|label, icon?, defaultHidden?, locked?, ...anything }]
 *             order in the array IS the default order. `locked` items cannot be
 *             hidden or disabled.
 *   prefs     [{ key, title|label?, position?, hidden? }]   (or { [key]: row })
 *   custom    [{ id, title, position?, hidden? }]            user-made items, key 'custom:<id>'
 *   resolved  [{ key, builtin, title, defaultTitle, customTitle, hidden, position, locked, ...registry fields }]
 */

const MAX_LABEL = 60;

// ── Validation ──────────────────────────────────────────────────────────────

/** Trim and cap a label. The string, or null when empty / not a string. */
function cleanLabel(raw, max = MAX_LABEL) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return s || null;
}

const customKey = id => `custom:${id}`;
function parseCustomKey(key) {
  const m = /^custom:(\d{1,12})$/.exec(String(key));
  return m ? Number(m[1]) : null;
}

const labelOf = def => (def.title !== undefined ? def.title : def.label);
const hasPos = it => Number.isInteger(it.position);

function rowsOf(prefs) {
  if (!prefs) return [];
  if (Array.isArray(prefs)) return prefs.filter(r => r && typeof r === 'object');
  if (typeof prefs === 'object') return Object.entries(prefs).filter(([, r]) => r && typeof r === 'object').map(([key, r]) => ({ key, ...r }));
  return [];
}

// ── Ordering ────────────────────────────────────────────────────────────────

/**
 * Items with a saved integer position come first, in that order; items without
 * one (a built-in added in a later release, say) follow in default order.
 * Positions are rewritten 0..n-1, which also repairs gaps and duplicates.
 * Items carry `seq` (their default order) in; it is removed on the way out.
 */
function orderItems(items) {
  const positioned = items.filter(hasPos).sort((a, b) => a.position - b.position || a.seq - b.seq);
  const rest = items.filter(it => !hasPos(it)).sort((a, b) => a.seq - b.seq);
  return [...positioned, ...rest].map((it, i) => {
    const { seq, ...out } = it; // eslint-disable-line no-unused-vars
    return { ...out, position: i };
  });
}

/**
 * Move the item with `key` one step (dir < 0 earlier, otherwise later). Returns
 * a NEW array, positions renormalised. At the edges, or for an unknown key, the
 * order is unchanged. Never mutates its input.
 */
function moveItem(items, key, dir) {
  const list = items.slice();
  const i = list.findIndex(it => it.key === key);
  const j = i + (dir < 0 ? -1 : 1);
  if (i !== -1 && j >= 0 && j < list.length) { const t = list[i]; list[i] = list[j]; list[j] = t; }
  return list.map((it, n) => ({ ...it, position: n }));
}

/** Renumber positions 0..n-1 in the current order, without otherwise changing items. */
function normalise(items) {
  return (items || []).map((it, n) => ({ ...it, position: n }));
}

// ── Resolving ───────────────────────────────────────────────────────────────

/**
 * Registry + saved prefs (+ custom items) -> the resolved, ordered list.
 * Prefs for keys not in the registry are ignored; a built-in with no pref still
 * appears. A pref title that is blank falls back to the default title.
 */
function resolve(registry, prefs, { custom = [] } = {}) {
  const byKey = new Map();
  for (const p of rowsOf(prefs)) if (p.key !== undefined) byKey.set(String(p.key), p);
  const items = [];
  (registry || []).forEach((def, seq) => {
    const p = byKey.get(def.key);
    const saved = p ? (p.title !== undefined ? p.title : p.label) : undefined;
    const own = typeof saved === 'string' && saved.trim() !== '';
    items.push({
      ...def,
      key: def.key, builtin: true, locked: !!def.locked,
      defaultTitle: labelOf(def),
      title: own ? saved : labelOf(def),
      customTitle: !!own,
      hidden: def.locked ? false : (p && p.hidden !== undefined ? !!p.hidden : !!def.defaultHidden),
      position: p && Number.isInteger(p.position) ? p.position : null,
      seq,
    });
  });
  for (const c of custom || []) {
    if (!c) continue;
    items.push({
      key: c.key || customKey(c.id), id: c.id, builtin: false, locked: false,
      defaultTitle: c.title, title: c.title, customTitle: true,
      hidden: !!c.hidden,
      position: Number.isInteger(c.position) ? c.position : null,
      seq: 1000 + (Number(c.id) || 0),
    });
  }
  return orderItems(items);
}

/**
 * Untrusted client input -> prefs rows safe to store.
 * Accepts [{ key, title|label, hidden, position }]. Unknown keys are dropped
 * (custom keys survive only when `allowCustom`), duplicates keep the first,
 * labels are cleaned, `hidden` is coerced to boolean (never true for a locked
 * item), and positions are renumbered to the order received.
 */
function normalisePrefs(registry, input, { allowCustom = false, maxLabel = MAX_LABEL } = {}) {
  const defs = new Map((registry || []).map(d => [d.key, d]));
  const seen = new Set();
  const out = [];
  for (const r of rowsOf(input)) {
    const key = typeof r.key === 'string' ? r.key : null;
    if (!key || seen.has(key)) continue;
    const def = defs.get(key);
    if (!def && !(allowCustom && parseCustomKey(key) !== null)) continue;
    seen.add(key);
    const raw = r.title !== undefined ? r.title : r.label;
    out.push({
      key,
      title: cleanLabel(raw, maxLabel),
      hidden: def && def.locked ? false : r.hidden === true || r.hidden === 'true' || r.hidden === 'on' || r.hidden === 1,
      position: out.length,
    });
  }
  return out;
}

// ── Modules: whole sections of an app that can be renamed or switched off ──

/**
 * registry  [{ key, label, path?, locked?, defaultEnabled? }]
 * prefs     [{ key, label?, enabled?, position? }]
 * -> [{ key, label, defaultLabel, path, enabled, locked, position, ...rest }]
 * A locked module is always enabled.
 */
function resolveModules(registry, prefs) {
  const byKey = new Map(rowsOf(prefs).map(p => [String(p.key), p]));
  const items = (registry || []).map((def, seq) => {
    const p = byKey.get(def.key);
    const saved = p ? (p.label !== undefined ? p.label : p.title) : undefined;
    const own = typeof saved === 'string' && saved.trim() !== '';
    const enabledDefault = def.defaultEnabled !== false;
    return {
      ...def,
      key: def.key, locked: !!def.locked,
      defaultLabel: labelOf(def), label: own ? saved : labelOf(def),
      enabled: def.locked ? true : (p && p.enabled !== undefined ? !!p.enabled : enabledDefault),
      position: p && Number.isInteger(p.position) ? p.position : (Number.isFinite(def.sort) ? def.sort : null),
      seq,
    };
  });
  return orderItems(items);
}

/**
 * Untrusted input -> module prefs rows. `input` is either a list of
 * { key, label, enabled } or a flat form body in business's style:
 * { label_<key>: '…', enabled_<key>: 'on' } (a checkbox that is absent is off).
 */
function normaliseModulePrefs(registry, input, { maxLabel = 40 } = {}) {
  const list = Array.isArray(input) ? input : null;
  const get = k => (list ? list.find(r => r && r.key === k) : null);
  return (registry || []).map((def, position) => {
    let label; let enabled;
    if (list) {
      const r = get(def.key) || {};
      label = r.label; enabled = r.enabled === undefined ? true : (r.enabled === true || r.enabled === 'on' || r.enabled === 'true');
    } else {
      const body = input || {};
      label = body[`label_${def.key}`]; enabled = body[`enabled_${def.key}`] === 'on';
    }
    return { key: def.key, label: cleanLabel(label, maxLabel), enabled: def.locked ? true : !!enabled, position };
  });
}

const isModuleEnabled = (registry, prefs, key) => {
  const m = resolveModules(registry, prefs).find(x => x.key === key);
  return !!(m && m.enabled);
};

/**
 * Route guard: a disabled module's routes 404, so hiding it really hides it.
 *   app.use('/ledger', moduleGate({ registry, key: 'ledger', load: req => loadPrefs(req.user) }), ledgerRouter)
 * `load(req)` returns the saved prefs (sync or async). If loading FAILS the
 * defaults are used — a preferences outage must not take a module offline.
 * An unknown key 404s. `onDisabled(req, res)` customises the response.
 */
function moduleGate({ registry, key, load, onDisabled, log = console }) {
  async function enabled(req) {
    let prefs = [];
    try { prefs = load ? await load(req) : []; } catch (err) { log.warn(`[modules] could not load prefs (${err.message}) — using defaults`); }
    return isModuleEnabled(registry, prefs, key);
  }
  const mw = async (req, res, next) => {
    try {
      if (await enabled(req)) return next();
      if (onDisabled) return onDisabled(req, res);
      if (String(req.originalUrl || req.url || '').startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
      return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Not found</title><p>That module is turned off.</p>');
    } catch (err) { return next(err); }
  };
  mw.fastify = async (req, reply) => {
    if (await enabled(req)) return undefined;
    return reply.code(404).send({ error: 'Not found' });
  };
  return mw;
}

module.exports = {
  MAX_LABEL, cleanLabel, customKey, parseCustomKey,
  orderItems, moveItem, normalise, resolve, normalisePrefs,
  resolveModules, normaliseModulePrefs, isModuleEnabled, moduleGate,
};
