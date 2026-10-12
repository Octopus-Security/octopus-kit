# {{NAME}}

{{PROFILE_LINE}} Started from `create-octopus-app` (octopus-kit).

> This file is safe to publish: keep it to what is true of THIS code. Anything about
> the wider estate (hosts, credentials, accounts) belongs in the private estate notes.

## Run it

```sh
npm install        # installs octopus-kit from a public tarball, no token
cp .env.example .env
AUTH_MODE=dev node index.js      # dev: every request is DEV_USER. Refused in production.
npm test
```

`AUTH_MODE=sso` (the default) needs `@octopus-security/auth-client`, a private optional
dependency; without it the app refuses to boot rather than run without auth.

## Shape

- `index.js` — middleware order is the convention: **health + `/api/build` ahead of auth**,
  static assets, internal routes (shared secret, fail closed), then identify -> login -> app gate.
- `config.js` — all environment decisions, validated at boot. No hostname defaults: URLs come
  from the environment only.
- `auth.js` — sso (lazy, optional dependency) or dev.
- `octopus.json` — the app manifest (slug is permanent). `hub.json` — the legacy file the hub
  scanner still reads; keep the two in step.
{{#ui}}
- `views/layout.ejs` — `<html data-app="{{SLUG}}">`, the theme-boot script, and the kit's tokens
  and ui CSS served from `/kit/...`. Use the `--o-*` tokens and `.o-*` classes; do not redefine them.
{{/ui}}

## Rules this app keeps

- Every integration is optional. Use `suite.call()` / `res.locals.suite`; a missing partner hides
  the feature, it never throws out of a handler.
- Every env var the code reads is passed in `docker-compose.yml` (`test/env-wiring.test.js`).
- The entrypoint is loaded and started under test (`test/boots.test.js`).
- Docker: `apk upgrade` in the runtime stage and npm removed from the runtime image.
- Additive migrations only; never reset a database.
- ET is the only clock for anything a person sees as a date.
