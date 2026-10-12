# {{NAME}}

A static site (nginx) started from `create-octopus-app` (octopus-kit).

> This file is safe to publish: keep it to what is true of THIS code.

## Shape

- `public/` — everything served. `public/kit/` holds a COPY of the kit's tokens and ui CSS taken
  when the site was generated (a static site has no server to serve them from node_modules);
  refresh it when you bump the kit.
- `nginx.conf` — cache policy, `/health`, `/api/build`.
- `Dockerfile` — `apk upgrade`, and writes `/api/build` from a hash of the served files at build time.
- `octopus.json` — the app manifest (slug is permanent). `hub.json` — legacy, read by the hub scanner.

## Rules

- No `ports:` in the compose; the proxy reaches the container over `web_proxy`.
- `/api/build` is derived from the files, never typed.
