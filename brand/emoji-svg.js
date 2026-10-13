'use strict';
/**
 * emoji-svg.js — emoji -> favicon.svg.
 *
 * Byte-for-byte what octopus-vault/scripts/hub-favicons.mjs's svgFor() emits today, so an
 * app's baked favicon.svg does not visibly change the day it starts coming from a pack
 * instead of that script. That includes the TRAILING NEWLINE: svgFor()'s template literal
 * ends in `\n` (it is written straight to a file with writeFileSync), so this does too —
 * checked deliberately, not an accident. See test/brand-emoji-svg.test.js, which pins the
 * exact byte string.
 *
 * No design here on purpose: no colour, no padding, no rasterizing. A real designed icon is
 * octopus-studio's job (it emits the same pack format from its sharp pipeline); this is only
 * ever the zero-dependency fallback.
 */

const MAX_CODE_POINTS = 8; // generous for a ZWJ sequence (e.g. "👩‍💻" is 3 code points); guards against someone passing a whole string in by mistake

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * emojiSvg('🩺') ->
 *   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🩺</text></svg>\n'
 */
function emojiSvg(emoji) {
  if (typeof emoji !== 'string' || !emoji.length) throw new Error('emojiSvg: emoji must be a non-empty string');
  const points = Array.from(emoji); // code points, not UTF-16 units — correct for surrogate-pair emoji
  if (points.length > MAX_CODE_POINTS) throw new Error(`emojiSvg: "${emoji}" is longer than ${MAX_CODE_POINTS} code points`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${escapeXml(emoji)}</text></svg>\n`;
}

module.exports = { emojiSvg, MAX_CODE_POINTS };
