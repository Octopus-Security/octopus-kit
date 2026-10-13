# How the kit reaches an app (decided 2026-10-13: hybrid)

| Half | What | How it arrives | When an app changes |
|---|---|---|---|
| Live | tokens, accents, aliases, base/components CSS, `blocks/` components, a copy of theme-boot | `https://kit.octopustechnology.net/v0/...` | when a kit release is cut; **no app redeploy** |
| Pinned | `octopus-kit/server` (and the scaffold) | codeload tarball at a tag, in `package.json` | when `scripts/bump-kit.mjs` is run and the app is merged and rebuilt |

Breaking changes to the live half go to a new channel (`/v1/`), which an app opts into by changing
its URLs. `/v0/` only ever receives backwards-compatible changes. The pinned form is:

```json
"octopus-kit": "https://codeload.github.com/Octopus-Security/octopus-kit/tar.gz/refs/tags/v0.1.0"
```

(never `github:`, which needs `git`; `node:alpine` has none).

## What an app puts in `<head>`

Order matters: theme-boot first (inline, runs before paint), then tokens, then accents, then the
optional files, then the app's own CSS.

```html
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!-- and data-app="myapp" on the <html> element, as today -->

  <!-- 1. INLINE, never from the kit host. Express: <%- themeBoot %>.  Vite: themeBoot() plugin. -->
  <script>/* contents of tokens/theme-boot.js */</script>

  <!-- 2. LIVE, with the pinned copy as fallback if the kit host is down or blocked -->
  <link rel="stylesheet" href="https://kit.octopustechnology.net/v0/tokens.css"
        onerror="this.onerror=null;this.href='/kit/tokens/tokens.css'">
  <link rel="stylesheet" href="https://kit.octopustechnology.net/v0/accents.css"
        onerror="this.onerror=null;this.href='/kit/tokens/accents.css'">
  <link rel="stylesheet" href="https://kit.octopustechnology.net/v0/base.css"
        onerror="this.onerror=null;this.href='/kit/ui/base.css'">
  <link rel="stylesheet" href="https://kit.octopustechnology.net/v0/components.css"
        onerror="this.onerror=null;this.href='/kit/ui/components.css'">
  <link rel="stylesheet" href="/app.css">

  <!-- 3. LIVE blocks, progressive enhancement only (an unknown custom element renders its children) -->
  <script type="module" src="https://kit.octopustechnology.net/v0/blocks/example.js"></script>
</head>
```

Notes:

- The theme-boot is **inline in every app** because it must run before first paint and a
  render-blocking network fetch from another host is the failure mode it exists to avoid. Express
  apps use `inlineTag(nonce)` from `octopus-kit/tokens/theme-boot.cjs`; Vite apps use
  `octopus-kit/tokens/vite-plugin.cjs` (`themeBoot()` replaces `<!-- octopus-kit:theme-boot -->`
  or is inserted after the leading `<meta>` tags). It is also published at `/v0/theme-boot.js` for
  the odd page that cannot inline.
- **Fallback = the pinned copy.** The installed package carries the same files. Express apps
  already serve them at `/kit/...` via `kitAssets()`; a static site copies `tokens/` and `ui/` in at
  build. The fallback is as old as the app's pin, which is acceptable: it is the degraded path.
  Vite apps can instead `import 'octopus-kit/tokens/tokens.css'` (bundled, so always available) and
  keep the live `<link>`s after it so live wins.
- `onerror` is an inline handler. An app whose CSP forbids those must allow it with a nonce/hash or
  use the bundled-import form. CSP must allow `style-src`, `script-src` and `font-src` for
  `https://kit.octopustechnology.net`.
- **Unstyled-but-usable.** If both the live and fallback files fail, the page must still be
  readable: give the few critical custom properties fallbacks in app CSS
  (`background: var(--o-bg, #0f1115)`), keep layout in the app's own CSS, and never hide content
  until the kit has loaded. Blocks must be enhancements over plain markup.
- Pick the channel in the URL: `/v0/` now; `/v1/` when it exists and the app is ready.

## Release gate: a push to main changes nothing

The kit host is a Portainer stack (`channel/docker-compose.yml`) that tracks the **branch
`channel/v0`**, not main. Only `scripts/release.mjs --publish` moves that branch, and only to a
`v0.*` tag commit, with a plain push (a fast-forward; it fails rather than force). So:

- merge to main: nothing happens in production;
- cut a release: `package.json` version bumped via PR, merged, then `node scripts/release.mjs`
  (dry run: checks and prints the plan), then `--publish`.

Why a branch and not the tag itself: Portainer's git auto-update polls a branch/ref and redeploys when
it moves; a moving branch pointer is the thing it can already watch. The branch carries no commits of
its own, so it is exactly the tag's tree. The image build (`channel/Dockerfile`) runs
`scripts/build-channel.mjs`, which validates every CSS/JS file again and fails the build (Portainer
keeps the old container) if one does not parse.

`release.mjs` refuses unless: tree clean; on main and equal to origin/main; version is `0.x.y`
and untagged; `npm test` passes; the channel builds and every file parses. Afterwards run
`node scripts/check-live.mjs --expect-version X.Y.Z`.

## Caching: Cloudflare must bypass the kit host

Cloudflare caches CSS and JS for four hours and overrides the origin's `Cache-Control`
(ESTATE.md, "Versioned client URLs"). Apps cannot version these URLs (that would need an app
redeploy, the thing this design removes), so the edge cache must be switched off for this host.

**Chosen: a Cloudflare Cache Rule, "Bypass cache" for hostname `kit.octopustechnology.net`** (owner
step, no token needed). Why this and not the others:

- Purge-on-release (needs an API token, and breaks silently if a URL is missed, a token expires or
  the purge fails after the push) is kept only as an optional extra: `release.mjs --publish --purge`
  with `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID`; it fails loudly without them.
- A manifest loader (apps read `/v0/manifest.json` and write hashed URLs) needs JavaScript before
  styles, which is the flash-of-unstyled-content problem theme-boot exists to avoid.
- Bypass is host-wide, so a new file can never be missed. The files are small, nginx answers
  with `ETag` and `Cache-Control: no-cache`, so browsers revalidate with a cheap 304.
- The nginx CORS header varies by `Origin`, and a CDN cache would hand one site's header to
  another. Bypass avoids that class of bug entirely.

`/v0/manifest.json` (name -> content hash) and immutable hashed copies under `/v0/_/<hash>/...`
are still published: tools can pin an exact file, and they are the zero-purge path should the owner
ever want edge caching for a specific app. `check-live.mjs` reports a Cloudflare `HIT` as a problem.

## Owner steps (once)

1. **DNS**: `kit.octopustechnology.net`, proxied, pointing where the other app hosts point.
2. **Portainer stack**: repository `Octopus-Security/octopus-kit`, reference `refs/heads/channel/v0`,
   compose path `channel/docker-compose.yml`, git credentials as for the other stacks, auto-update
   ON (polling, as the other stacks). The branch exists after the first `release.mjs --publish`.
3. **Proxy host**: Nginx Proxy Manager host `kit.octopustechnology.net` -> the stack's service on
   `web_proxy` port 80 (service name `kit-host`, container `octopus_kit_host_internal`), TLS as the
   other hosts. No host ports.
4. **Cloudflare Cache Rule**: if hostname equals `kit.octopustechnology.net` -> Cache eligibility:
   Bypass cache.
5. Optional: a `Cache Purge` API token + zone id, only if `--purge` is wanted.
6. Per app, when adopting: the `<head>` above, and `scripts/bump-kit.mjs` for the pinned half.

## Bumping the pinned half

```sh
node scripts/bump-kit.mjs --to v0.2.0            # dry run: lists consumers
node scripts/bump-kit.mjs --to v0.2.0 --apply    # local branch + commit per repo
node scripts/bump-kit.mjs --to v0.2.0 --push     # push branches (never main) and open draft PRs
```

Lockfiles are reported, not edited; run `npm install` in the repo to refresh them.
