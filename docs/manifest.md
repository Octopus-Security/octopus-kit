# octopus.json — the app manifest

Supersedes `hub.json`. `octopus-vault/scripts/hub-apps.mjs` should read either during the transition (it still only
reads `hub.json`; scaffolded apps write both).

```json
{ "slug": "kitchen", "name": "Kitchen", "icon": "🍳", "subdomain": "kitchen", "domain": "example.net",
  "access": "private", "profile": "ui",
  "provides": { "internal": ["/api/internal/recipes"], "tools": ["recipe_search"], "widgets": [] },
  "uses": [ { "service": "shopper", "level": "feature", "feature": "price check", "why": "Prices ingredients." },
            { "service": "cortex",  "level": "feature", "feature": "AI suggestions", "why": "Suggests recipes." } ] }
```

| Field | Rule |
|---|---|
| `slug` | required, `^[a-z0-9-]+$`, <= 40. **Permanent**: it keys the accent, the access rows and the hub tile. |
| `name` | required, 1-60 chars of plain text |
| `icon` | an emoji. Optional, but the hub skips an app with none (a warning, never invented). |
| `subdomain` | required, one DNS label |
| `domain` | optional host name. **No default**: the hub tooling supplies its own. |
| `access` | `private` (default) or `open` |
| `profile` | required: `ui`, `headless`, `static` |
| `provides.internal` | paths starting `/`; `provides.tools` snake_case names; `provides.widgets` reserved. A static app cannot provide internal endpoints. |
| `uses[]` | `{ service, level: required|feature, feature, why }`. Same vocabulary as `requires` in `octopus-template.json`. `feature` is required when `level` is `feature`; `why` <= 200 chars; no duplicates; not itself. |
| `env[]` | `{ name, required, kind, description, howTo, deriveFrom, panel }`, <= 64. Tells the New app flow in cortex Admin what to do with each variable the compose references. `kind`: `copy` (other stacks hold it), `generate` (a new secret this app owns; ops makes it, nobody sees it), `derive` (computed: `deriveFrom` is a template over `{slug}`, `{subdomain}`, `{domain}`), `manual` (external value; `howTo` says how to get it, `panel` links the cortex panel that creates it: billing, secrets, users, deploy), `leave-empty` (dangerous local default, or the app default is right). `deriveFrom` only with `derive`. Variables not listed are classified from `.env.example` comments (`# @kind generate`, `# @howto ...`, `# @required`), then by name. |

Unknown keys are errors at every level, so a typo like `levle` cannot quietly turn a hard dependency into none.

```js
const { validate, fromHubJson, toHubJson, readManifest } = require('octopus-kit/manifest');
validate(obj)                         // { ok, errors, warnings }
fromHubJson({ name, subdomain, domain?, icon?, access? }, { slug, profile })
toHubJson(manifest)
readManifest('octopus.json')          // { ok, errors, warnings, manifest }
```
`fromHubJson`: hub.json has no slug or profile, so the slug defaults to the subdomain (pass the real one where they
differ) and the profile to `ui`; nothing else is invented.

`octopus.schema.json` is the same contract for editors; `test/manifest.test.js` checks the two agree.
