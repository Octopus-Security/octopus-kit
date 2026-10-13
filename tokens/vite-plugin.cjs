'use strict';
// Vite plugin: inline theme-boot into index.html so it runs before first paint.
//   // vite.config.ts
//   import { createRequire } from 'node:module';
//   const { themeBoot } = createRequire(import.meta.url)('octopus-kit/tokens/vite-plugin.cjs');
//   export default defineConfig({ plugins: [react(), themeBoot()] });
//
// Put `<!-- octopus-kit:theme-boot -->` in <head> where the snippet should go (after <meta charset>
// and <meta viewport>, before any stylesheet). If the marker is missing the snippet is inserted right
// after the last <meta ...> tag at the start of <head>, else right after <head>. It is never added
// with head-prepend: ~2 KB in front of <meta charset> pushes it past the 1024 bytes the browser
// sniffs for the encoding. The snippet is NOT served from the kit host: it must be inline.
const { inlineTag } = require('./theme-boot.cjs');

const MARKER = '<!-- octopus-kit:theme-boot -->';

function inject(html, tag) {
  if (html.includes(MARKER)) return html.split(MARKER).join(tag);
  if (html.includes('data-octopus-kit-theme-boot')) return html;
  const head = /<head[^>]*>/i.exec(html);
  if (!head) return html;
  const afterHead = head.index + head[0].length;
  const metas = /^(\s*<meta\b[^>]*>)+/i.exec(html.slice(afterHead));
  const at = afterHead + (metas ? metas[0].length : 0);
  return html.slice(0, at) + '\n' + tag + html.slice(at);
}

function themeBoot({ nonce } = {}) {
  return {
    name: 'octopus-kit-theme-boot',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => inject(html, inlineTag(nonce)),
    },
  };
}

module.exports = { themeBoot, inject, MARKER };
