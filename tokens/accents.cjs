'use strict';
// The accent registry and its rules, as code. The CSS is generated from accents.json;
// this module is what the tests and the scaffold use to keep that file honest.
//
//   const { registry, validate, nextFreeAccent } = require('octopus-kit/tokens/accents.cjs');
const fs = require('node:fs');
const path = require('node:path');
const color = require('./color.cjs');

const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, 'tokens.json'), 'utf8'));

// The rules. Documented in docs/theming.md; change them here and the tests follow.
const THRESHOLDS = {
  // OKLab distance x100 between any two accents, and between an accent and success/danger,
  // separately in dark and in light. ~1 is just noticeable; ~4.5 reads as a different colour
  // when two swatches sit side by side (a hub tile next to another tile).
  minDeltaE: 4.5,
  // WCAG contrast of the accent against --o-bg in the same mode. One rule: accents are used
  // as link/text colour, so they meet the TEXT threshold, 4.5:1 (not the 3:1 UI-only one).
  minTextContrast: 4.5,
  // WCAG contrast of --o-accent-ink on --o-accent (button label on a filled button).
  minInkContrast: 4.5,
};
// The allocator aims a little past the minimum so a new colour is not borderline.
const ALLOC_MARGIN = 0.4;

function load(file) {
  const raw = JSON.parse(fs.readFileSync(file || path.join(__dirname, 'accents.json'), 'utf8'));
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
}
const registry = load();

const bg = { dark: tokens.dark.bg, light: tokens.light.bg };
const semantic = {
  dark: { success: tokens.dark.success, danger: tokens.dark.danger },
  light: { success: tokens.light.success, danger: tokens.light.danger },
};

// Returns a list of human-readable problems; empty means the registry is valid.
function validate(reg = registry) {
  const T = THRESHOLDS, out = [];
  const slugs = Object.keys(reg);
  for (const s of slugs) {
    for (const mode of ['dark', 'light']) {
      const v = reg[s] && reg[s][mode];
      if (!v || !color.HEX.test(v.accent) || !color.HEX.test(v.hover) || !color.HEX.test(v.ink)) {
        out.push(`${s}.${mode}: accent/hover/ink must be #rrggbb`);
        continue;
      }
      const c = color.contrast(v.accent, bg[mode]);
      if (c < T.minTextContrast) out.push(`${s}.${mode}: accent ${v.accent} is ${c.toFixed(2)}:1 on bg, needs ${T.minTextContrast}`);
      const ci = color.contrast(v.ink, v.accent);
      if (ci < T.minInkContrast) out.push(`${s}.${mode}: ink ${v.ink} on ${v.accent} is ${ci.toFixed(2)}:1, needs ${T.minInkContrast}`);
      for (const [name, hex] of Object.entries(semantic[mode])) {
        const d = color.deltaE(v.accent, hex);
        if (d < T.minDeltaE) out.push(`${s}.${mode}: accent ${v.accent} is too close to ${name} ${hex} (dE ${d.toFixed(2)})`);
      }
    }
  }
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      for (const mode of ['dark', 'light']) {
        const a = reg[slugs[i]][mode], b = reg[slugs[j]][mode];
        if (!a || !b || !color.HEX.test(a.accent) || !color.HEX.test(b.accent)) continue;
        if (a.accent.toLowerCase() === b.accent.toLowerCase()) {
          out.push(`${slugs[i]} and ${slugs[j]} share the ${mode} accent ${a.accent}`);
          continue;
        }
        const d = color.deltaE(a.accent, b.accent);
        if (d < T.minDeltaE) out.push(`${slugs[i]} and ${slugs[j]} are too close in ${mode} (dE ${d.toFixed(2)} < ${T.minDeltaE})`);
      }
    }
  }
  return out;
}

// Build a full registry entry from a dark accent (and optionally a hand-picked light one).
function makeEntry(name, darkAccent, lightAccent) {
  const light = lightAccent || color.darkenToContrast(darkAccent, bg.light, 4.6);
  const part = (accent, mode) => ({ accent, hover: color.hoverFor(accent, mode), ink: color.inkFor(accent) });
  return { name, dark: part(darkAccent, 'dark'), light: part(light, 'light') };
}

// Pick a free colour for a new app: the candidate that is furthest from every existing accent
// and from success/danger, in both modes. Returns { dark, light, name } or null if the wheel
// is full (no candidate clears minDeltaE + margin). Deterministic: same input, same answer.
//   existing: a registry object (slug -> entry); default is the committed registry.
//   opts.hue: prefer the free colour nearest this hue (degrees) among those that qualify.
function nextFreeAccent(existing = registry, opts = {}) {
  const used = { dark: [], light: [] };
  for (const e of Object.values(existing)) {
    used.dark.push(e.dark.accent);
    used.light.push(e.light.accent);
  }
  used.dark.push(...Object.values(semantic.dark));
  used.light.push(...Object.values(semantic.light));
  const need = THRESHOLDS.minDeltaE + ALLOC_MARGIN;

  let best = null;
  for (let h = 0; h < 360; h += 2) {
    for (const L of [0.7, 0.74, 0.78, 0.82]) {
      for (const C of [0.1, 0.12, 0.14]) {
        const dark = color.oklchToHex(L, C, h);
        if (color.contrast(dark, bg.dark) < THRESHOLDS.minTextContrast) continue;
        const light = color.darkenToContrast(dark, bg.light, 4.6);
        let m = Infinity;
        for (const x of used.dark) m = Math.min(m, color.deltaE(dark, x));
        for (const x of used.light) m = Math.min(m, color.deltaE(light, x));
        if (m < need) continue;
        let score = m;
        if (opts.hue !== undefined) {
          const dh = Math.abs(((h - opts.hue + 540) % 360) - 180);
          score = -dh * 1000 + m; // nearest hue first, then furthest from the rest
        }
        if (!best || score > best.score) best = { score, dark, light };
      }
    }
  }
  if (!best) return null;
  return makeEntry(opts.name || '', best.dark, best.light);
}

module.exports = { registry, load, validate, makeEntry, nextFreeAccent, THRESHOLDS, semantic, bg };
