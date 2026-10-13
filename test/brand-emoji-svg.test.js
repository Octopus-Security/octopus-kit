'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { emojiSvg } = require('../brand/emoji-svg');

// The exact template octopus-vault/scripts/hub-favicons.mjs's svgFor() emits today, pinned
// here as a literal (this repo has no dependency on the vault to import it from). Byte-for-byte
// compatibility with that script's output — INCLUDING its trailing newline — is the single most
// important property of this file: an app's baked favicon.svg must not visibly change the day
// it switches from that script's output to this function's.
const expected = emoji => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${emoji}</text></svg>\n`;

test('byte-for-byte match with hub-favicons.mjs, including the trailing newline', () => {
  for (const e of ['🩺', '💰', '🧪', '🛠️', '👩‍💻']) {
    assert.strictEqual(emojiSvg(e), expected(e), e);
  }
});

test('is stable: the same emoji produces the same bytes every time', () => {
  assert.strictEqual(emojiSvg('🩺'), emojiSvg('🩺'));
});

test('escapes & < > in the emoji', () => {
  assert.strictEqual(
    emojiSvg('<&>'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">&lt;&amp;&gt;</text></svg>\n',
  );
});

test('rejects more than 8 code points, accepts exactly 8', () => {
  assert.throws(() => emojiSvg('a'.repeat(9)), /code points/);
  assert.doesNotThrow(() => emojiSvg('a'.repeat(8)));
});

test('rejects empty string and non-strings', () => {
  for (const v of ['', null, undefined, 5, {}]) assert.throws(() => emojiSvg(v));
});
