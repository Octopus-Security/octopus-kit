'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { brandHead, brandLinks } = require('../brand/head');

test('brandLinks returns the three link objects from the rollout spec, in render order', () => {
  assert.deepStrictEqual(brandLinks('health'), [
    { rel: 'icon', type: 'image/svg+xml', href: 'https://auth.octopustechnology.net/brand/health/favicon.svg' },
    { rel: 'apple-touch-icon', href: 'https://auth.octopustechnology.net/brand/health/apple-touch-icon.png' },
    { rel: 'manifest', href: 'https://auth.octopustechnology.net/brand/health/site.webmanifest', crossorigin: 'use-credentials' },
  ]);
});

test('brandHead renders the exact three-line markup from the app rollout', () => {
  assert.strictEqual(brandHead('health'), [
    '<link rel="icon" type="image/svg+xml" href="https://auth.octopustechnology.net/brand/health/favicon.svg">',
    '<link rel="apple-touch-icon" href="https://auth.octopustechnology.net/brand/health/apple-touch-icon.png">',
    '<link rel="manifest" href="https://auth.octopustechnology.net/brand/health/site.webmanifest" crossorigin="use-credentials">',
  ].join('\n'));
});

test('a custom origin is honoured (trailing slash tolerated)', () => {
  const links = brandLinks('health', { origin: 'http://localhost:4000/' });
  assert.strictEqual(links[0].href, 'http://localhost:4000/brand/health/favicon.svg');
});

test('rejects a slug that fails ^[a-z][a-z0-9-]{0,39}$', () => {
  for (const s of ['Health', '../x', 'health/x', '', '1health', 'x'.repeat(41), 'a b']) {
    assert.throws(() => brandHead(s), /slug/, s);
    assert.throws(() => brandLinks(s), /slug/, s);
  }
});

test('a bad slug is rejected (slug regex), and brandHead escapes attribute values it renders to HTML', () => {
  assert.throws(() => brandHead('"><script>alert(1)</script>'));
  // brandLinks() hands back raw objects for JSX, which escapes its own output — only brandHead's
  // HTML-string rendering needs to escape. A crafted origin proves linkTag() does that escaping.
  const html = brandHead('health', { origin: 'https://auth.test/"><script>x</script>' });
  assert.ok(!html.includes('<script>'), html);
});
