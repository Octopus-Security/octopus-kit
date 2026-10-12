# Local development only. Copy to .env; never commit real values.
# NODE_ENV is left unset locally; AUTH_MODE=dev is refused when it is "production".
AUTH_MODE=dev
DEV_USER=dev
PORT=3000

# Production-style (sso) — values come from the stack, not from this file:
# AUTH_MODE=sso
# AUTH_SERVICE_URL=
# AUTH_PUBLIC_URL=
# APP_ACCESS_SLUG=
# UPGRADE_URL=

# Optional partners (each unset = its feature is hidden):
# CORTEX_URL=
# INTERNAL_SECRET=
