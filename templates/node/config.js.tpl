'use strict';

/**
 * config.js — everything the environment decides, validated once at boot.
 *
 * Refuses to start on a combination that would be unsafe rather than running
 * quietly in the wrong mode:
 *   - AUTH_MODE=dev with NODE_ENV=production: dev lets every request in.
 *   - AUTH_MODE=sso without AUTH_SERVICE_URL / AUTH_PUBLIC_URL: nothing to verify against.
 * There are no hostname defaults here; URLs come from the environment only.
 */

const kit = require('octopus-kit/server');

function loadConfig(env = process.env) {
  const errors = [];
  const nodeEnv = env.NODE_ENV || 'development';
  const authMode = (env.AUTH_MODE || 'sso').toLowerCase();
  if (!['sso', 'dev'].includes(authMode)) errors.push(`AUTH_MODE must be "sso" or "dev", got "${authMode}".`);
  if (authMode === 'dev' && nodeEnv === 'production') {
    errors.push('AUTH_MODE=dev is refused when NODE_ENV=production: it would let anyone in unauthenticated.');
  }
  const authUrl = (env.AUTH_SERVICE_URL || '').replace(/\/+$/, '');
  const authPublicUrl = (env.AUTH_PUBLIC_URL || '').replace(/\/+$/, '');
  if (authMode === 'sso') {
    if (!authUrl) errors.push('AUTH_SERVICE_URL is required when AUTH_MODE=sso.');
    if (!authPublicUrl) errors.push('AUTH_PUBLIC_URL is required when AUTH_MODE=sso (where the browser is sent to sign in).');
  }
  const port = Number(env.PORT === undefined || env.PORT === '' ? 3000 : env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) errors.push(`PORT must be 0-65535, got "${env.PORT}".`);
  if (errors.length) throw new Error(`Refusing to boot:\n  - ${errors.join('\n  - ')}`);
  return {
    nodeEnv,
    authMode,
    authUrl,
    authPublicUrl,
    // `||` semantics: unset or empty means this app's own slug; "off" disables the gate on purpose.
    appAccessSlug: kit.slugFromEnv(env, '{{SLUG}}', 'APP_ACCESS_SLUG'),
    upgradeUrl: env.UPGRADE_URL || '',
    devUser: env.DEV_USER || 'dev',
    dataDir: env.DATA_DIR || require('path').join(__dirname, 'data'),
    port,
  };
}

module.exports = { loadConfig };
