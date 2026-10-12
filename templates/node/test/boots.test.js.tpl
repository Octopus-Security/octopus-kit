'use strict';

// The service can actually be loaded AND started. A suite that never loads the
// entrypoint says nothing about whether the container starts (octopus-kit,
// server/testing.js, explains the 2026-09-06 outage this exists for).
const path = require('path');
const { bootsTest } = require('octopus-kit/server/testing');

bootsTest({
  entry: 'index.js',
  root: path.join(__dirname, '..'),
  env: { AUTH_MODE: 'dev', NODE_ENV: 'test' },
  listen: true,
  path: '/health',
});
