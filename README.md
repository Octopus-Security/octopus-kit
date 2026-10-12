# octopus-kit

Shared base for the octopus app suite: design tokens and per-app accents, framework-agnostic
UI CSS, server helpers (build stamp, app gate, health routes, optional cross-app integration),
the `octopus.json` app manifest, and a scaffold for new apps.

Apps install it from a git tag — no registry token needed:

```json
"octopus-kit": "github:Octopus-Security/octopus-kit#v0.1.0"
```

Every integration is optional: an app works on its own, and lights up features when its
partners are present.
