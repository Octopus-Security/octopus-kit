'use strict';
// Exposes the theme-boot snippet so a server can inline it in <head> before any CSS paints.
//   const { inlineTag } = require('octopus-kit/tokens/theme-boot.cjs');
//   res.locals.themeBoot = inlineTag(res.locals.cspNonce);
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'theme-boot.js'), 'utf8').trim();
const NONCE = /^[A-Za-z0-9+/=_-]{1,128}$/;

function inlineTag(nonce) {
  if (nonce !== undefined && nonce !== null && nonce !== '') {
    // A nonce is interpolated into markup; refuse anything that is not plain base64/url-safe.
    if (typeof nonce !== 'string' || !NONCE.test(nonce)) throw new TypeError('invalid CSP nonce');
    return `<script nonce="${nonce}">${source}</script>`;
  }
  return `<script>${source}</script>`;
}

module.exports = { source, inlineTag };
