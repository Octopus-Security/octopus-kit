'use strict';
/**
 * octopus-kit/server — the shared backend pieces of the octopus suite.
 * CommonJS, Node >= 20, zero runtime dependencies (global fetch; Express and
 * Fastify are adapted by being PASSED IN, never required here).
 *
 * `testing` is exposed lazily: it needs node:test, which a running service must
 * never load.
 */

const buildStamp = require('./build-stamp');
const appGate = require('./app-gate');
const health = require('./health');
const internal = require('./internal');
const suite = require('./suite');
const llm = require('./llm');
const layout = require('./layout');
const prefs = require('./prefs');
const kitAssets = require('./kit-assets');
const brand = require('../brand');

const api = {
  createBuildStamp: buildStamp.createBuildStamp,
  createAppGate: appGate.createAppGate,
  slugFromEnv: appGate.slugFromEnv,
  healthRoutes: health.healthRoutes,
  requireInternalSecret: internal.requireInternalSecret,
  serviceUser: internal.serviceUser,
  createSuite: suite.createSuite,
  createLlm: llm.createLlm,
  layout,
  prefs,
  kitAssets: kitAssets.kitAssets,
  brand,
  modules: {
    resolve: layout.resolveModules, normalise: layout.normaliseModulePrefs,
    isEnabled: layout.isModuleEnabled, gate: layout.moduleGate,
  },
};

Object.defineProperty(api, 'testing', { enumerable: true, get: () => require('./testing') });

module.exports = api;
