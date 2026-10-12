# create-octopus-app

```sh
node bin/create-octopus-app.mjs <slug> --name "Kitchen" --profile ui|headless|static --dir ./octopus-kitchen \
     [--icon 🍳] [--subdomain kitchen] [--domain example.net] [--access private|open] [--kit-dep <npm spec>]
```
Refuses a non-empty `--dir`. Slug: letter first, `a-z0-9-`. Name: letters, digits, spaces and `. , & ( ) + -` only (it lands in
JS, HTML, JSON and Markdown, so nothing that needs escaping is allowed).

| Profile | Stack |
|---|---|
| `ui` | Express 4 + EJS. `views/layout.ejs` with `<html data-app>`, the theme-boot inline script, and the kit's `tokens/` + `ui/` CSS served at `/kit/...` |
| `headless` | Express, JSON only |
| `static` | nginx; the kit's CSS is *copied* into `public/kit/` at generation time; `/api/build` is written into the image from a hash of the served files |

Everything generated passes the vault checkers by default: `apk upgrade` in the runtime stage, npm stripped (the exact
estate lines, above `USER node`), multi-stage `node:22-alpine`, no host ports, `web_proxy` + `octopus_network`, named data volume,
every env var `${VAR:-}`, health and `/api/build` ahead of auth, the app gate after the login check, internal routes failing closed,
`boots.test.js` (which also *starts* the app) and `env-wiring.test.js`.

## The kit dependency

The generated `package.json` uses the **codeload tarball URL**:

```
"octopus-kit": "https://codeload.github.com/Octopus-Security/octopus-kit/tar.gz/refs/tags/v0.1.0"
```
not `github:Octopus-Security/octopus-kit#v0.1.0`. npm resolves a `github:` spec with the `git` binary; `node:22-alpine` has none
(`npm error enoent spawn git`, verified 2026-10-12). The tarball form installs with no git and no token. The tag must exist
before the first image build.

`@octopus-security/auth-client` stays an **optionalDependency** (GitHub Packages). The Dockerfile takes an optional `NPM_TOKEN`
build arg for it and removes the `.npmrc` in the same layer; the kit itself needs no token. Without the package, `AUTH_MODE=sso`
refuses to boot rather than run without auth, and `AUTH_MODE=dev` is refused when `NODE_ENV=production`.

## Accent

If the kit has `tokens/accents.cjs` exporting `nextFreeAccent(slug)`, its result is printed; otherwise the CLI prints a TODO
to add the slug to `tokens/accents.json`.

## What it does not do

Create the GitHub repo, the Portainer stack, the proxy host or DNS, the hub tile, the SHOWCASE marker, or the system-map entry.
It prints those as numbered steps at the end.
