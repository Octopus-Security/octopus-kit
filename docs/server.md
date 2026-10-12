# octopus-kit/server

CommonJS, Node >= 20, **zero runtime dependencies**. Uses the global `fetch`. Express and Fastify are
adapted by being passed in; the kit never requires either.

```js
const kit = require('octopus-kit/server');   // or require('octopus-kit/server/app-gate') etc.
```

| Export | File | Replaces |
|---|---|---|
| `createBuildStamp` | `build-stamp.js` | the `build.js` copies in budget, shopper, planner, edm, media, science, ee |
| `createAppGate`, `slugFromEnv` | `app-gate.js` | `appAccess.js` (budget, health, shopper, author, kitchen, science, ee, marketing, games, code, media, edm) and the inline copy in business |
| `healthRoutes` | `health.js` | the hand-written `/health` + `/api/build` pairs |
| `requireInternalSecret`, `serviceUser` | `internal.js` | `X-Internal-Secret` checks (media, cortex, budget) and `X-Service-Token`/`X-Service-User` (health, shopper, kitchen) |
| `createSuite` | `suite.js` | hard-coded `CORTEX_URL` fetches that throw |
| `createLlm` | `llm.js` | `llm.js` in shopper, author, math; follows octopus-ecom's `server/llm/` ladder |
| `layout.*`, `modules.*` | `layout.js` | budget's `layout.js` (branch `customizable-dashboard`) and business's `server/modules.js` |
| `prefs.*` | `prefs.js` | new: the suite theme cookie |
| `kitAssets` | `kit-assets.js` | new: serve the kit's CSS from node_modules |
| `testing` (lazy) | `testing.js` | `test/boots.test.js` and `test/env-wiring.test.js` copies |

`testing` is a lazy getter: it needs `node:test`, which a running service must never load.

---

## Build stamp

```js
const stamp = kit.createBuildStamp({ service: 'octopus-x', roots: [__dirname] });
stamp.build        // 12 hex, or the literal 'unknown'
stamp.startedAt
stamp.asset('/app.css')   // '/app.css?v=ab12cd34'  (hash of THAT file)
stamp.express(app)        // makes asset() a template global
```

- **Derived, never a constant.** The directories are *walked* (a written list stops covering the file you
  just added, silently). Skipped by default: `node_modules`, `.git`, `data`, `test`, `tests`, dot-directories,
  `package-lock.json`. `exclude: ['public/uploads']` adds more.
- **`unknown` is the failure value** and is deliberately not hash-shaped. Never `current`.
- `asset()` reads once and caches; an unreadable path (or one escaping `public/`) comes back bare.
- Options for the two apps with extras: `dirVersioned: ['/js/']` gives ee's `/js/<hash>/canvas.js` (a module
  graph is not one file; serve with `stamp.stripDirVersion(req.path)`), and `clientDirs: ['public/js','public/css']`
  reports a separate `client` stamp for apps whose browser code carries its own copy (ee, science).
  `source` is an alias of `build`.

## App gate

```js
const gate = kit.createAppGate({
  slug: kit.slugFromEnv(process.env, 'myapp'),   // APP_ACCESS_SLUG
  authUrl: process.env.AUTH_SERVICE_URL,
  upgradeUrl: process.env.UPGRADE_URL,
  failOpen: true,          // default, as every existing copy
});
app.use(gate);             // gate.express() is the same function
gate.fastify(app);         // preHandler; skips machines (role 'internal') and open paths
```

Asks octopus-auth `GET /api/auth/apps/:slug/allowed` **as the user** (their cookie/Authorization is forwarded),
caches the answer `cacheMs` (60 s), denies with 403 JSON for `/api/*` and an HTML page otherwise.

| Auth says | Result |
|---|---|
| 200 `{allowed}` | that answer, cached |
| 404 | slug unknown to auth: a config error, **allows** and warns loudly |
| down / non-2xx / timeout | the **last answer** for that user even if stale (stale DENIED stays denied); with none: `failOpen` true allows, false denies with code `gate_unavailable` |

`gate.slug` is what `/api/build` reports as `gate`. An empty slug makes the gate a pass-through.

**`??` vs `||` for the slug.** octopus-ee reads `APP_ACCESS_SLUG ?? 'ee'`, the others `|| 'slug'`. `slugFromEnv`
uses `||`: an unset **or empty** value means "this app's own slug". With `??` and a compose line
`${APP_ACCESS_SLUG:-}` (which yields an empty string when nobody set the stack variable) the gate would be
switched **off** by an unset variable. (ee's compose happens to default to `ee`, so it is not live there; marketing
uses `${VAR-default}` precisely to make empty mean off.) Turning the gate off must be said out loud:
`APP_ACCESS_SLUG=off` (or `none`/`disabled`/`-`).

## Health

```js
kit.healthRoutes(app, { service: 'octopus-x', stamp, gate });   // BEFORE auth
// GET /health     -> { ok: true, status: 'ok', service }
// GET /api/build  -> { ok, service, build, startedAt, gate? }   (Cache-Control: no-store)
```
Express or Fastify (detected by `app.addHook`). `gate` is read off the mounted gate at request time.
`extra: () => ({...})` adds fields; a throwing `extra` cannot break the probe.

## Internal auth

```js
app.use('/api/internal', kit.requireInternalSecret(), router);   // fastify: preHandler: mw.fastify
kit.serviceUser(req, { defaultUser: 'owner' })
```
- Secret unset -> **503** (fail closed; a header cannot satisfy an unset secret). Missing header 401, wrong 403.
  Constant-time. Read per request, so rotation needs no restart.
- Sets `req.serviceCall = true`. `serviceUser` honours `X-Service-User` **only then** (otherwise `null`), validates the
  name against auth's registration shape and throws `statusCode: 400` on a bad one rather than quietly using the default.

## Suite: optional integration

```js
const suite = kit.createSuite({ services: {
  cortex:  { urlEnv: 'CORTEX_URL',  secretEnv: 'INTERNAL_SECRET', probe: '/api/build' },
  shopper: { urlEnv: 'SHOPPER_URL' },
} });
suite.has('cortex')              // configured? sync. URL set, valid http(s), and (if secretEnv declared) secret set
await suite.available('cortex')  // configured AND a probe answered recently (cached, shared in-flight)
const r = await suite.call('cortex', '/api/x', { method: 'POST', body, user: 'sam', timeoutMs: 3000 });
// { ok: true, status, data } | { ok: false, reason: 'not-configured'|'unreachable'|'timeout'|'http'|'error', status?, data? }
await suite.status()             // per service { configured, available, reason? }
app.use(suite.middleware())      // res.locals.suite = { cortex: true, shopper: false }   (fastify: suite.fastify(app))
```
`call` never throws. URLs/secrets come from env only; the secret goes to that service's own URL only; redirects are
**not followed**; paths must start with a single `/`; `user` is validated before it becomes `X-Service-User`.
`middleware()` never waits on a partner: it is "configured and not known to be down", refreshed in the background.

## LLM

```js
const llm = kit.createLlm({ suite, context: 'shopper', alias: 'haiku' });
const r = await llm.complete({ messages, system, user: req.user.username });
// { ok: true, text, provider, model } | { ok: false, reason: 'not-configured'|'no-user'|'payment-required'|'unreachable'|'timeout'|'http'|'bad-request'|'error' }
if (!(await llm.available())) { /* hide the button */ }
```
Ladder: **cortex** (billed to `user`) -> **BYOK** (`LLM_BASE_URL` + `LLM_MODEL` [+ `LLM_API_KEY`], OpenAI-compatible,
nothing defaulted) -> **stub** (`stub: true` or `LLM_PROVIDER=stub`). The *first configured* rung is used and the ladder
is **not** walked on failure: a cortex outage must not move requests onto the owner's own key. `LLM_PROVIDER` pins a rung.
No streaming in v0.1 (math's `stream()` is not ported).

## Layout and modules

Pure functions; storage stays with the app. See the header of `layout.js` for shapes.
`layout.resolve(registry, prefs, { custom })`, `moveItem`, `orderItems`, `normalise`, `normalisePrefs` (untrusted input -> storable rows),
`cleanLabel`; modules: `modules.resolve`, `modules.normalise`, `modules.isEnabled`, `modules.gate({ registry, key, load })`
(disabled module -> 404; a failing `load` falls back to defaults rather than taking the module offline).

## Prefs

`prefs.middleware()` sets `res.locals.theme = { mode, accent, density, htmlAttrs, accentStyle }` from the `octopus_prefs` cookie
(`{"v":1,"mode":"dark|light|system","accent":"app"|"#rrggbb","density":"comfortable|compact"}`, URL-encoded). Strict: hex is
`^#[0-9a-fA-F]{6}$`, others are whitelists, anything malformed defaults per field. `prefs.serializePrefsCookie(prefs, { domain })`
is for octopus-auth: non-HttpOnly, Secure, SameSite=Lax, Max-Age one year.

## Kit assets

`app.use('/kit', kit.kitAssets())` serves only `.css` under the package's `tokens/` and `ui/`, with traversal refused;
`kitAssets().url('/tokens/tokens.css')` gives a content-hashed URL (immutable caching only when the hash matches).

## Testing helpers

```js
// test/boots.test.js
require('octopus-kit/server/testing').bootsTest({ entry: 'index.js', root: __dirname + '/..', env: { AUTH_MODE: 'dev' }, listen: true });
// test/env-wiring.test.js
require('octopus-kit/server/testing').envWiringTest({ root: __dirname + '/..', required: ['INTERNAL_SECRET'] });
```
`bootsTest` loads the entrypoint in a subprocess (so a throw at load cannot take the runner down), names the
"const before initialization" bug, and tolerates only two machine-specific failures (an uninstalled non-relative
module, an absolute path outside the repo). `listen: true` also starts it for real and waits for `/health`.
`envWiringTest` fails on any `process.env.X` / `env.X` the code reads that the compose never passes.
Lower-level: `checkBoots`, `startServer`, `checkEnvWiring`.
