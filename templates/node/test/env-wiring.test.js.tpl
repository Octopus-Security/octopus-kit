'use strict';

// Every env var the code reads must be passed through in docker-compose.yml.
// A Portainer stack variable interpolates into the compose FILE; a name the
// compose never mentions is absent at runtime however set the UI says it is.
const path = require('path');
const { envWiringTest } = require('octopus-kit/server/testing');

envWiringTest({
  root: path.join(__dirname, '..'),
  compose: 'docker-compose.yml',
  // DEV_USER only exists in dev mode, which production refuses.
  exclude: ['DEV_USER'],
  // The kit reads these by name on the app's behalf, so a grep of this repo cannot see them.
  required: ['AUTH_SERVICE_URL', 'AUTH_PUBLIC_URL', 'APP_ACCESS_SLUG', 'CORTEX_URL', 'INTERNAL_SECRET'],
});
