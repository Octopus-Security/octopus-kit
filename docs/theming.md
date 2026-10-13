# Theming

One set of role tokens (`--o-*`), one accent per app, and a per-user preference
(mode, accent, density) that every app applies before first paint. `docs/preview.html`
shows all of it; open it directly in a browser.

## What an app links

```html
<html lang="en" data-app="kitchen">
<head>
  <!-- inline before any CSS, so there is no flash of the wrong theme -->
  <script>/* tokens/theme-boot.js */</script>
  <link rel="stylesheet" href="/kit/tokens.css">
  <link rel="stylesheet" href="/kit/accents.css">   <!-- after tokens.css: ties are won by order -->
  <link rel="stylesheet" href="/kit/aliases/kitchen.css">  <!-- optional, see below -->
  <link rel="stylesheet" href="/kit/base.css">      <!-- optional -->
  <link rel="stylesheet" href="/kit/components.css"><!-- optional -->
```

| Attribute on `<html>` | Values | Set by |
|---|---|---|
| `data-app` | the app's slug (`tokens/accents.json`) | the app, in its layout |
| `data-theme` | `dark`, `light`, `system` (or unset = system) | theme-boot, from the cookie |
| `data-density` | `comfortable`, `compact` | theme-boot, from the cookie |

Dark is the default. `light` is explicit; `system` and unset follow
`prefers-color-scheme`. An explicit `dark` is never flipped by a light OS.

A region can be themed on its own by putting `data-theme` (and `data-app`, on the same
element) on a `<div>`; that is how `preview.html` shows both modes on one page.

## The cookie

Auth sets a non-HttpOnly `octopus_prefs` cookie on the parent domain. Value is
URL-encoded JSON, and nothing in it is sensitive:

```json
{"v":1,"mode":"dark|light|system","accent":"app","density":"comfortable|compact"}
```

- `accent` is `"app"` (the default: keep the app's own colour) or `"#rrggbb"`.
  A hex sets `--o-accent`, `--o-accent-hover` and `--o-accent-ink` inline on `<html>`
  (hover is the accent mixed 18% toward white on dark / black on light; ink is near-black or
  white, whichever reads better).
- `theme-boot.js` is strict: accent must match `^#[0-9a-fA-F]{6}$`, mode and density are
  whitelisted, `v` must be `1`, anything else is ignored, and every step is in `try/catch`.
  It never throws and never touches the page beyond those two attributes and three properties.
- A user-chosen hex is the user's responsibility for contrast; the registry accents are the
  ones checked.

## Getting the snippet into a page

- **Express/EJS**: `const { inlineTag } = require('octopus-kit/tokens/theme-boot.cjs');`
  then `res.locals.themeBoot = inlineTag(res.locals.cspNonce)` and print
  `<%- themeBoot %>` first in `<head>`. The nonce is validated (base64/url-safe only); an
  invalid one throws rather than producing broken markup.
  If the app has a CSP without nonces, serve `theme-boot.js` as a same-origin script
  (`<script src="/kit/theme-boot.js">`) and keep it first in `<head>` and not `async`.
- **React/Vite**: use the kit's plugin, which inlines it in `index.html`
  (`const { themeBoot } = createRequire(import.meta.url)('octopus-kit/tokens/vite-plugin.cjs')`,
  `plugins: [react(), themeBoot()]`, and `<!-- octopus-kit:theme-boot -->` in `<head>`), then import the CSS in `main.jsx`: `import 'octopus-kit/tokens/tokens.css'` etc.
  Set `data-app` in `index.html`.
- **Tailwind**: `presets: [require('octopus-kit/tokens/tailwind-preset.cjs')]`. It maps `bg`,
  `surface` (+ `-2`, `-3`), `border`, `text`, `muted`, `accent`, `success`, `warn`, `danger`,
  `info` to `var(--o-*)`. Opacity modifiers (`bg-accent/20`) do not work on CSS-variable
  colours. **octopus-math remaps Tailwind's own `blue` and `green` to its palette and must not
  take this preset blindly**: it would not collide by name, but it changes which colours the
  app can say; adopt tokens there by hand, one component at a time. octopus-media uses the same
  hex values as edm in its Tailwind config; take the preset, then delete those hex values.
- **Static nginx / Astro**: copy or serve `tokens/` and `ui/`, inline the boot snippet in the
  layout (for Astro, `set:html`). Version the URLs with the estate's stamping script.

## Alias sheets (adopt without rewriting the CSS)

`tokens/aliases/<cluster>.css` maps an app's existing variable names to `--o-*`. To adopt:
link `tokens.css`, `accents.css` and the alias sheet, set `data-app`, then **delete the app's
own `:root` and `[data-theme="light"]` blocks**. Nothing else in the CSS changes, and the app
gains light mode, density and the user's accent.

| Sheet | Apps | Notes |
|---|---|---|
| `shopper.css` | shopper, author | `--green` **is** the brand accent in both apps (buttons, active tab, borders), so it maps to `--o-accent`. `--red`/`--blue`/`--orange`/`--yellow` map to danger/info/warn. author's `--purple` has no role and stays a fixed `light-dark()` pair. |
| `science.css` | science, ee | `--acc` is the accent, `--acc2` (science's secondary blue) maps to `--o-info`. |
| `planner.css` | planner | `--accent-2` maps to the hover token. |
| `cortex.css` | cortex, business, marketing | Includes the names only some of the three use (`--ok`, `--bad`, `--bg-input`, ...). business/marketing's runtime brand override in `head.ejs` still wins if kept; otherwise use `data-app`. |
| `edm.css` | edm | Radii change slightly (4/8/12 to 6/10/14). The `--track-*` lane colours are data colours and stay fixed. |
| `kitchen.css`, `code.css`, `ecom.css`, `blog.css`, `tools.css`, `dash.css` | one app each | code keeps its syntax colours as `light-dark()` pairs; dash's `--green/--yellow/--red` are status colours (success/warn/danger), not the accent. |

Aliases use `color-mix()` and `light-dark()` (Chrome 123+, Safari 17.5+, Firefox 120+).
Alias sheets never define `--o-*` names; a test enforces that every `var(--o-x)` they use exists.

Colour names that do not map cleanly are the app's own business. If the old name was used for
both "brand" and "good" (shopper's green is), decide per use as you touch it: brand uses go to
`var(--o-accent)`, status uses to `var(--o-success)`.

## budget and health: converting

Neither app has CSS variables: `public/theme.css` is about 500 lines of literal hex (`#0d0d0d`
page, `#111`/`#141414`/`#1e1e1e` surfaces, `#d4d4d4`/`#e8e8e8` text, `#2ecc71` and `#5df59a` as
accent, `#ff7878` danger, `#f0c060` warning, `#5c2a2a`/`#162d1e` tinted fills). There is no
alias sheet because there is nothing to alias. The conversion is mechanical and can be done in
one pass per file:

1. Link tokens, accents, set `data-app="budget"` / `"health"`, add the boot snippet.
2. Replace by role, not by value, in `theme.css` (search and replace is safe once you have the
   table; do the longest hex first):

   | Literal | Role |
   |---|---|
   | page background (`#0d0d0d`) | `var(--o-bg)` |
   | nav / card backgrounds (`#111`, `#141414`, `#161616`) | `var(--o-surface)` |
   | raised fills, borders-as-fills (`#1e1e1e`) | `var(--o-surface-2)` (fills) or `var(--o-border)` (lines) |
   | body text (`#d4d4d4`, `#e8e8e8`, `#aaa`) | `var(--o-text)` / `var(--o-muted)` |
   | `#2ecc71`, `#5df59a`, `#1e6e3e` | `var(--o-accent)`, `var(--o-accent-hover)`, a `color-mix` of the accent |
   | `#ff7878`, `#5c2a2a` | `var(--o-danger)`, `color-mix(in srgb, var(--o-danger) 25%, var(--o-bg))` |
   | `#f0c060` | `var(--o-warn)` |
   | `#162d1e`-style tinted fills | `color-mix(in srgb, var(--o-accent) 14%, var(--o-bg))` |

3. A green that means "saved / ok / income" must become `--o-success`, not the accent: in
   budget the two are different greens on purpose (see below).
4. Replace literal `rgba(...)` shadows with `var(--o-shadow-1|2)`.
5. Check the result in light: `rgba(255,255,255,...)` hover overlays and white-on-dark
   assumptions are the usual breakage.

Do health first: it is the smaller surface and has no money on it.

## Accent registry

`tokens/accents.json` is the registry: `slug -> { name, dark: {accent, hover, ink}, light: {...} }`.
`tokens/accents.css` is generated from it. **Apps default to colours unique from each other.**
The suite-wide override is opt-in, via the cookie.

The rules (enforced by `test/tokens-accents.test.js`, implemented in `tokens/accents.cjs`):

| Rule | Threshold |
|---|---|
| Any two accents differ, in dark **and** in light | OKLab distance x100 >= **4.5** (about 1 is just noticeable; 4.5 reads as a different colour when two swatches sit side by side). The committed palette's closest pair is 5.2 (dark) and 4.7 (light). |
| Accent vs `--o-success` and `--o-danger`, both modes | same **4.5**, so "saved" or "failed" never reads as an app colour |
| Accent on `--o-bg`, both modes | WCAG contrast >= **4.5:1**. One rule: accents are used as link and text colour, so they meet the text threshold, not the 3:1 UI-only one. |
| `ink` on `accent`, both modes | >= **4.5:1** |
| Same slug in the hub | every slug in `octopus-auth/hub-apps.json` has an entry |

Light accents are not the dark ones darkened blindly: they are tuned (same hue family, within a
few degrees) so the pairs stay distinct in light too, where lightness is squeezed into a narrow band.

### Adding an app

1. Add the slug to the app's manifest / hub tile (slugs never change once shipped).
2. Allocate a colour:
   ```js
   const { nextFreeAccent, registry } = require('./tokens/accents.cjs');
   nextFreeAccent(registry, { name: 'Newapp', hue: 120 }); // hue is optional: nearest free hue
   ```
   It returns a full entry (`dark`, `light`, `name`) that clears every rule above with margin,
   or `null` when the wheel is full (about two more apps at the current 23; then the palette
   needs a deliberate re-tune, which the tests will force).
3. Paste it into `accents.json` under the slug, run `node scripts/build-tokens.mjs`, commit
   `accents.json`, `accents.css` and `docs/preview.html` together. Tests fail on any drift.
4. Set `data-app="<slug>"` in the app.

Never reuse or recolour another app's accent to fit yours in. Changing an existing app's
accent is a registry change and must keep the whole test file green.

### Why some apps moved

Green (`#2ecc71`) was shared by budget, health, edm, media, math and blog, teal by code,
business and shopper. Budget keeps a green (money); the rest got their own hue. Budget's green
is a little deeper than before so it stays clear of `--o-success`.

## Regenerating

```sh
node scripts/build-tokens.mjs          # writes tokens.css, accents.css, docs/preview.html
node scripts/build-tokens.mjs --check  # exits 1 if the committed files are stale
node --test                            # the whole suite
```

Edit `tokens/tokens.json` or `tokens/accents.json`; never the generated files.
