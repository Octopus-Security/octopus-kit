# Brand packs — `octopus-favicon-pack` v1

Replaces the push model where `octopus-vault/scripts/hub-favicons.mjs` writes a baked
`favicon.svg` into every app repo (commit, redeploy, repeat per app). The new model is a
**pull**: `octopus-auth` hosts the brand assets; an app holds exactly one per-app value —
its `hub-apps.json` slug — and resolves everything else from auth at runtime. Changing an
icon becomes one import into auth and zero app redeploys.

`octopus-kit` owns the **format**, a **zero-dependency builder** (emoji → SVG, SVG → pack),
the **validator**, and the `<head>` helper apps import. It does **not** store, assign or
serve anything — that is `octopus-auth` — and it does **not** rasterize — a designed
PNG/ICO/social set is `octopus-studio`'s job, from its existing `sharp` pipeline, through
this same module so the id comes out identical everywhere.

```js
const kit = require('octopus-kit/server');       // kit.brand.*
// or, directly:
const brand = require('octopus-kit/brand');
```

## The format

One JSON object:

```jsonc
{
  "format": "octopus-favicon-pack",
  "version": 1,
  "slug": "health",                         // ^[a-z][a-z0-9-]{0,39}$ — the hub-apps.json slug
  "name": "Health",
  "source":  { "kind": "emoji", "value": "🩺" },   // kind: emoji | svg | raster
  "theme":   { "color": "#28a1c0", "background": "#0b0d10" },   // both optional, #rrggbb
  "generator": "octopus-kit@0.4.0",         // or octopus-studio@<version>
  "createdAt": "2026-10-13T21:00:00.000Z",
  "files": [
    { "path": "favicon.svg", "role": "favicon", "type": "image/svg+xml",
      "bytes": 123, "sha256": "…", "encoding": "utf8",  "data": "<svg …/>" },
    { "path": "icon-192.png", "role": "icon-192", "type": "image/png",
      "width": 192, "height": 192, "bytes": 4096, "sha256": "…",
      "encoding": "base64", "data": "iVBORw0…" }
  ]
}
```

`brand/pack.schema.json` is the same contract in JSON Schema, in the style of
`manifest/octopus.schema.json`; `validatePack` is its executable form and adds the
cross-field rules a schema cannot.

### Roles — a closed vocabulary

| Role | Type | Fixed size | Required |
|---|---|---|---|
| `favicon` | `image/svg+xml` | — | **yes, the only one** |
| `favicon-16` | `image/png` | 16×16 | no |
| `favicon-32` | `image/png` | 32×32 | no |
| `favicon-48` | `image/png` | 48×48 | no |
| `ico` | `image/x-icon` | — (bundles several sizes) | no |
| `apple-touch` | `image/png` | 180×180 | no |
| `icon-192` | `image/png` | 192×192 | no |
| `icon-512` | `image/png` | 512×512 | no |
| `maskable-512` | `image/png` | 512×512 | no |
| `social` | `image/png` | 1200×630 | no |

At most one file per role. **A pack is valid with only `favicon`.** This is deliberate and
load-bearing: kit's zero-dependency emoji pack carries exactly that one file, studio's sharp
pack carries the full set, and auth serves whatever each pack has and falls back for what it
lacks. Neither producer is special, and neither is "incomplete" for lacking the other's roles.

`brand.PUBLIC_FILENAME` maps each role to its canonical public filename (`favicon.svg`,
`apple-touch-icon.png`, `icon-192.png`, …) — the names auth's `/brand/:slug/<file>` routes use
and the names `webmanifest()` builds URLs from.

### `files[].encoding`

`"utf8"` for the one text format (`favicon`'s SVG); `"base64"` for everything else. `data` is
always a string; decode it according to `encoding` before writing it to disk or serving it.

### `packId`

```
canonicalForm(pack) =
  "slug=" + pack.slug + "\n" +
  "version=" + pack.version + "\n" +
  sorted(pack.files.map(f => f.role + "\0" + f.path + "\0" + f.sha256)).join("\n")

packId(pack) = sha256_hex( utf8_bytes( canonicalForm(pack) ) )     // 64 lower-case hex chars
```

A pure function of `slug`, `version`, and each file's `role` + `path` + `sha256` — `name`,
`theme`, `generator`, `createdAt`, `source` and the files' original array order never affect
it, and neither does `data` directly. The same pack, computed twice, or with its top-level
keys in a different order, or with its `files` array reversed, gives the same id.

**`packId` trusts the recorded `sha256`; it does not re-hash `data`.** That is exactly why
the order of operations matters everywhere this is used: **`validatePack` first** (which
*does* check `sha256` against `data`, and `bytes` against `data`), and only then compute or
trust a `packId`. A pack that skips validation could carry a `sha256` that lies about its
`data`, and `packId` would not catch that on its own — it isn't meant to; that is
`validatePack`'s job, once, at import time. octopus-auth's admin import route validates
before touching disk for exactly this reason.

Both `octopus-auth` and `octopus-studio` are Node, so the practical answer to "reproduce
`packId`" is **import `octopus-kit/brand/pack.js`** and call `packId()` directly, rather than
re-implementing the algorithm — studio already depends on the kit by codeload tarball for
other reasons. The algorithm above is documented precisely anyway, as the spec and as an
audit trail if a reimplementation is ever needed.

### Directory form

For a zip download, the same object minus each file's `data` — the bytes are sibling files
instead:

```
pack.json          # the pack object, files[].data omitted
favicon.svg
icon-192.png
…
```

`packToDir(pack, dir)` / `packFromDir(dir)` convert between the two; both refuse a `path`
that would resolve outside `dir` (the same traversal guard as `kit-assets.js`'s
`resolveFile`).

## API (`octopus-kit/brand`, also `kit.brand` from `octopus-kit/server`)

```js
brand.emojiSvg(emoji)                 // -> SVG string, byte-for-byte what hub-favicons.mjs emitted
brand.buildPack({ slug, name, emoji | svg, theme?, generator?, createdAt? })  // -> a v1 pack, one `favicon` file
brand.validatePack(pack)              // -> { ok, errors: string[] }
brand.canonicalForm(pack)             // -> string (see packId above)
brand.packId(pack)                    // -> 64 lower-case hex chars
brand.packToDir(pack, dir) / brand.packFromDir(dir)
brand.webmanifest(pack, { baseUrl, name?, themeColor? })   // -> a site.webmanifest object
brand.brandHead(slug, { origin? })    // -> the <head> HTML string (below)
brand.brandLinks(slug, { origin? })   // -> the same three links as an array of objects, for JSX
```

`buildPack` takes **exactly one** of `emoji` or `svg`:

- **`emoji`** → `emojiSvg(emoji)`, verbatim. Escapes `&`, `<`, `>`; rejects more than 8 code
  points (comfortably covers a ZWJ sequence like `👩‍💻`, which is 3).
- **`svg`** → sanitised first. The sanitiser is a conservative regex blocklist, not an XML
  parser (the kit has no dependency to parse XML with): rejects `<script>`, any `on*=`
  handler, `<foreignObject>`, and any `href`/`xlink:href`/`url(...)` that is not a
  same-document `#fragment` — including a `data:` URI, rejected by the same rule rather than
  special-cased, since the goal is "nothing that reaches outside this one file," not "nothing
  that reaches the network." It rejects more than the strict minimum on purpose.

`webmanifest`'s `baseUrl` is opaque to the kit — pass it already pointed at wherever the pack
is served (auth passes its **versioned** `/brand/:slug/v/:packId` URL, per the app-rollout
spec, so the manifest's icon URLs are the immutable ones). Only roles actually present in the
pack are listed.

### `<head>` wiring

```js
const { brandHead } = require('octopus-kit/brand');
brandHead('health')
```

produces, byte for byte, the block every app wires in:

```html
<link rel="icon" type="image/svg+xml" href="https://auth.octopustechnology.net/brand/health/favicon.svg">
<link rel="apple-touch-icon" href="https://auth.octopustechnology.net/brand/health/apple-touch-icon.png">
<link rel="manifest" href="https://auth.octopustechnology.net/brand/health/site.webmanifest" crossorigin="use-credentials">
```

An Express/EJS app that already depends on the kit renders `brandHead(slug)` from its layout
partial so the slug is the only per-app value; an app with no kit dependency pastes the
literal block above with its own slug substituted. `brandLinks(slug)` returns the same three
links as plain objects (`{ rel, href, type?, crossorigin? }`, in render order) for JSX/Next
apps that cannot take a raw string. Both validate and reject a slug that fails
`^[a-z][a-z0-9-]{0,39}$` **before** building a URL from it, and `brandHead`'s HTML renderer
escapes every attribute value it writes (defence in depth — the slug check alone already
stops anything attribute-breaking from reaching it).

## CLI — `bin/octopus-favicon-pack.mjs`

```sh
node bin/octopus-favicon-pack.mjs --slug health --emoji 🩺 [--name Health] [--color '#28a1c0'] --out pack.json
node bin/octopus-favicon-pack.mjs --slug health --from-svg icon.svg [--name Health] [--color '#28a1c0'] --out pack.json
node bin/octopus-favicon-pack.mjs --all --out packs/ [--hub <path to hub-apps.json>]
```

`--all` is the bootstrap that seeds auth: one pack per `hub-apps.json` app (`slug` + `icon` +
`name`), themed from that app's **dark** accent in `tokens/accents.json`. It resolves
`hub-apps.json` by walking up from the kit checkout looking for a sibling `octopus-auth/`
(the tentacles-root layout); `--hub <path>` overrides the search. Either way, a hub file
that cannot be found, or one with no app carrying both a `slug` and an `icon`, is a **hard
failure** — this never silently writes an empty `packs/` directory.

## What's on disk, for completeness (not imported by this module)

`octopus-vault/scripts/hub-favicons.mjs` is the script this format replaces. Its `svgFor()`
is the literal `emojiSvg` is pinned against — see `test/brand-emoji-svg.test.js` — but this
module does not require or read that script; the byte-for-byte match is verified once, in the
test, and the retirement of that script (deleting it, once auth and the apps are wired) is
tracked in the vault's own docs, not here.

## A note on the trailing newline

`emojiSvg`'s output ends in `\n`. That is not an accident: `hub-favicons.mjs`'s `svgFor()`
template literal ends in `\n` because it is written straight to disk with `writeFileSync`,
and matching it byte-for-byte — including that newline — is the whole point of this function.
Checked deliberately; see the comment at the top of `brand/emoji-svg.js`.
