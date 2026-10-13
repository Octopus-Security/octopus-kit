# octopus-kit

Shared base for the octopus app suite: design tokens and per-app accents, framework-agnostic
UI CSS, server helpers (build stamp, app gate, health routes, optional cross-app integration),
the `octopus.json` app manifest, and a scaffold for new apps.

Delivery is a hybrid (see `docs/delivery.md`):

- **Browser-side UI** (tokens, theme-boot, UI CSS, `blocks/`) is served live from
  `https://kit.octopustechnology.net/v0/`. A kit release updates every app with no app redeploy.
- **Server-side logic** (`octopus-kit/server`) is pinned by tag in each app, installed from the
  codeload tarball (no git binary, no registry token):

```json
"octopus-kit": "https://codeload.github.com/Octopus-Security/octopus-kit/tar.gz/refs/tags/v0.1.0"
```

Not `github:Octopus-Security/octopus-kit#...`: npm resolves that with `git`, which `node:alpine`
images do not have. `scripts/bump-kit.mjs` moves every consumer to a new tag together.

Every integration is optional: an app works on its own, and lights up features when its
partners are present.
