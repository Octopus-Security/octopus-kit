'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { themeBoot, inject, MARKER } = require('../tokens/vite-plugin.cjs');
const { source } = require('../tokens/theme-boot.cjs');

test('marker is replaced by the inline snippet', () => {
  const out = inject(`<head><meta charset="utf-8">${MARKER}<link rel="stylesheet" href="a.css"></head>`, `<script>${source}</script>`);
  assert.ok(out.includes(source));
  assert.ok(!out.includes(MARKER));
  assert.ok(out.indexOf(source) < out.indexOf('a.css'));
});

test('without a marker it lands after the leading meta tags, before the stylesheet', () => {
  const out = inject('<html><head>\n<meta charset="utf-8">\n<meta name="viewport" content="x">\n<link rel="stylesheet" href="a.css"></head>', '<script>BOOT</script>');
  assert.ok(out.indexOf('charset') < out.indexOf('BOOT'));
  assert.ok(out.indexOf('BOOT') < out.indexOf('a.css'));
});

test('the plugin hook runs pre and honours a CSP nonce', () => {
  const p = themeBoot({ nonce: 'abc123' });
  assert.equal(p.transformIndexHtml.order, 'pre');
  assert.match(p.transformIndexHtml.handler(`<head>${MARKER}</head>`), /<script nonce="abc123">/);
});

test('a page without <head> is returned unchanged', () => {
  assert.equal(inject('<p>x</p>', '<script></script>'), '<p>x</p>');
});
