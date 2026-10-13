'use strict';
/**
 * octopus-kit/brand — the octopus-favicon-pack v1 format: emoji -> SVG, the pack builder
 * and validator, packId, the directory form, and the <head> helper apps import.
 * CommonJS, zero runtime dependencies. See docs/brand.md.
 */

const { emojiSvg, MAX_CODE_POINTS } = require('./emoji-svg');
const pack = require('./pack');
const { brandHead, brandLinks, DEFAULT_ORIGIN } = require('./head');

module.exports = {
  emojiSvg,
  MAX_CODE_POINTS,
  buildPack: pack.buildPack,
  fileRecord: pack.fileRecord,
  validatePack: pack.validatePack,
  canonicalForm: pack.canonicalForm,
  packId: pack.packId,
  packToDir: pack.packToDir,
  packFromDir: pack.packFromDir,
  webmanifest: pack.webmanifest,
  sanitiseSvg: pack.sanitiseSvg,
  FORMAT: pack.FORMAT,
  VERSION: pack.VERSION,
  SLUG_RE: pack.SLUG_RE,
  ROLES: pack.ROLES,
  ROLE_NAMES: pack.ROLE_NAMES,
  PUBLIC_FILENAME: pack.PUBLIC_FILENAME,
  brandHead,
  brandLinks,
  DEFAULT_ORIGIN,
};
