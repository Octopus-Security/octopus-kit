# Portainer git stack. Pushing to main ships to production (estate rule).
#
# A Portainer stack variable reaches the container ONLY if it is listed under
# `environment:` here — it interpolates into this file, it is not injected.
# test/env-wiring.test.js fails if the code reads a variable that is not listed.
# Every variable is passed as ${VAR:-} so an unset stack variable is an empty
# string the code treats as "not configured", never a baked-in default.
#
# No `ports:`: the reverse proxy reaches this over web_proxy by container name.
services:
  octopus-{{SLUG}}:
    build:
      context: .
      args:
        NPM_TOKEN: ${NPM_TOKEN:-}
    container_name: octopus-{{SLUG}}
    restart: always
    volumes:
      - {{SLUG}}_data:/usr/src/app/data
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATA_DIR=/usr/src/app/data
      # sso (default) or dev. dev is refused when NODE_ENV=production.
      - AUTH_MODE=${AUTH_MODE:-}
      # Where this container verifies sessions, and where the BROWSER signs in.
      - AUTH_SERVICE_URL=${AUTH_SERVICE_URL:-}
      - AUTH_PUBLIC_URL=${AUTH_PUBLIC_URL:-}
      # Per-app access (octopus-auth). Empty = this app's own slug; "off" disables.
      - APP_ACCESS_SLUG=${APP_ACCESS_SLUG:-}
      - UPGRADE_URL=${UPGRADE_URL:-}
      # Optional partners. Unset = the feature that needs them is hidden.
      - CORTEX_URL=${CORTEX_URL:-}
      # Shared secret for /api/internal/* and for calling partners. Unset = internal routes answer 503.
      - INTERNAL_SECRET=${INTERNAL_SECRET:-}
    networks:
      - web_proxy
      - octopus_network

networks:
  web_proxy:
    name: web_proxy
    external: true
  octopus_network:
    name: octopus_network
    external: true

volumes:
  {{SLUG}}_data:
