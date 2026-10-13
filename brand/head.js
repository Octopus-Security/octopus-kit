'use strict';
/**
 * head.js — the only thing an app imports. One slug in, the three <head> lines from the
 * favicon-pack rollout out, pointed at auth's public (deliberately unauthenticated) /brand
 * routes. An app that cannot run this (no kit dependency, or a template that needs a plain
 * string) pastes the literal from docs/brand.md instead — brandHead's output IS that literal.
 */

const { SLUG_RE } = require('./pack');

const DEFAULT_ORIGIN = 'https://auth.octopustechnology.net';

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function checkSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) throw new Error(`brandHead: slug "${slug}" must match ${SLUG_RE}`);
  return slug;
}

/**
 * brandLinks(slug, { origin }) -> the three <link> tags as plain objects (attr name -> value,
 * in render order), for JSX/Next apps that cannot take an HTML string.
 */
function brandLinks(slug, { origin = DEFAULT_ORIGIN } = {}) {
  checkSlug(slug);
  const base = `${String(origin).replace(/\/+$/, '')}/brand/${slug}`;
  return [
    { rel: 'icon', type: 'image/svg+xml', href: `${base}/favicon.svg` },
    { rel: 'apple-touch-icon', href: `${base}/apple-touch-icon.png` },
    { rel: 'manifest', href: `${base}/site.webmanifest`, crossorigin: 'use-credentials' },
  ];
}

function linkTag(attrs) {
  return `<link ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ')}>`;
}

/**
 * brandHead(slug, { origin }) -> the three <link> lines, newline-joined, exactly as in
 * docs/brand.md and the app-rollout spec:
 *
 *   <link rel="icon" type="image/svg+xml" href="https://auth.octopustechnology.net/brand/health/favicon.svg">
 *   <link rel="apple-touch-icon" href="https://auth.octopustechnology.net/brand/health/apple-touch-icon.png">
 *   <link rel="manifest" href="https://auth.octopustechnology.net/brand/health/site.webmanifest" crossorigin="use-credentials">
 */
function brandHead(slug, opts = {}) {
  return brandLinks(slug, opts).map(linkTag).join('\n');
}

module.exports = { brandHead, brandLinks, DEFAULT_ORIGIN };
