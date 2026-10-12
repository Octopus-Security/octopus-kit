'use strict';
// Colour maths shared by the accent registry, the scaffold allocator and the tests.
// Zero dependencies. All colours are '#rrggbb' strings.

const HEX = /^#[0-9a-fA-F]{6}$/;

function parseHex(hex) {
  if (!HEX.test(hex)) throw new Error('bad hex colour: ' + hex);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function toHex(rgb) {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const delin = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function luminance(hex) {
  const [r, g, b] = parseHex(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// WCAG 2.x contrast ratio.
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// sRGB hex -> OKLab [L, a, b] (Bjorn Ottosson).
function toOklab(hex) {
  const [r, g, b] = parseHex(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
// OKLab -> unclamped linear-ish rgb; returns { rgb:[0..255], inGamut }.
function fromOklabRaw(L, a, b) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const e = 1e-4;
  const inGamut = [r, g, bl].every((v) => v >= -e && v <= 1 + e);
  return { rgb: [r, g, bl].map((v) => delin(Math.max(0, Math.min(1, v)))), inGamut };
}
function oklchToHex(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  let c = C;
  // Reduce chroma until the colour fits sRGB (keeps lightness and hue).
  for (let i = 0; i < 40; i++) {
    const { rgb, inGamut } = fromOklabRaw(L, c * Math.cos(h), c * Math.sin(h));
    if (inGamut) return toHex(rgb);
    c *= 0.96;
  }
  return toHex(fromOklabRaw(L, c * Math.cos(h), c * Math.sin(h)).rgb);
}
function toOklch(hex) {
  const [L, a, b] = toOklab(hex);
  return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

// Perceptual distance: Euclidean distance in OKLab, scaled x100 so 1 is roughly
// "a trained eye can just tell", ~5 is "clearly different side by side".
function deltaE(a, b) {
  const x = toOklab(a), y = toOklab(b);
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// Ink (text on an accent fill): near-black or white, whichever contrasts more.
const INK_DARK = '#0b0d10';
const INK_LIGHT = '#ffffff';
function inkFor(accent) {
  return contrast(INK_DARK, accent) >= contrast(INK_LIGHT, accent) ? INK_DARK : INK_LIGHT;
}
// Hover: lighten on dark, darken on light, by a fixed OKLab lightness step.
function hoverFor(accent, mode) {
  const { L, C, h } = toOklch(accent);
  const dL = mode === 'light' ? -0.07 : 0.07;
  return oklchToHex(Math.max(0.05, Math.min(0.98, L + dL)), C, h);
}
// Darken an accent (same hue/chroma) until it reaches `min` contrast on `bg`.
function darkenToContrast(accent, bg, min) {
  const { L, C, h } = toOklch(accent);
  let l = L;
  while (l > 0.05) {
    const hex = oklchToHex(l, C, h);
    if (contrast(hex, bg) >= min) return hex;
    l -= 0.005;
  }
  return oklchToHex(0.05, C, h);
}
function lightenToContrast(accent, bg, min) {
  const { L, C, h } = toOklch(accent);
  let l = L;
  while (l < 0.98) {
    const hex = oklchToHex(l, C, h);
    if (contrast(hex, bg) >= min) return hex;
    l += 0.005;
  }
  return oklchToHex(0.98, C, h);
}

module.exports = {
  HEX, parseHex, toHex, luminance, contrast, toOklab, toOklch, oklchToHex, deltaE,
  inkFor, hoverFor, darkenToContrast, lightenToContrast, INK_DARK, INK_LIGHT,
};
