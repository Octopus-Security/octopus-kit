# Layout

`ui/layout.css` (live at `/v0/layout.css`, pinned at `/kit/ui/layout.css`) is the responsive layer:
mobile-first, plain CSS, tokens only. It is optional and goes after `components.css`.
`blocks/o-shell.js` is an optional enhancement for the drawer. `docs/preview.html` shows every piece;
**view it at 390, 768 and 1280 px wide**.

## Breakpoints

Always `min-width`, always one of these four. A custom property cannot be used in a media query, so the
values are constants, mirrored as tokens (`--o-bp-sm|md|lg|xl` in `tokens.css`, for scripts) and as
`@custom-media` comments at the top of `layout.css`. A test keeps every copy equal.

| Name | px | Means | In this layer |
|---|---|---|---|
| `sm` | 480 | large phone | `.o-table--cards` becomes a table; toasts stop spanning the width |
| `md` | 768 | tablet; the phone/desktop switch | the shell drawer becomes a sidebar; the sheet becomes a dialog |
| `lg` | 1024 | desktop | (free for apps) |
| `xl` | 1280 | wide | (free for apps) |

```css
@media (min-width: 768px) { /* md and up */ }
/* with postcss-custom-media:  @custom-media --o-md (min-width: 768px);  @media (--o-md) { } */
```

Replace an app's private values with the nearest one: 340-560 -> sm, 600-860 -> md, 900-1100 -> lg,
1200 and up -> xl. **Tailwind**: `tokens/tailwind-preset.cjs` sets `screens` to these (it moves `sm` from 640
to 480; `2xl` stays 1536). Without the preset:

```js
theme: { extend: { screens: { sm: '480px', md: '768px', lg: '1024px', xl: '1280px' } } }
```

Also: `(hover: hover)` for hover-only styling, `(pointer: coarse)` for finger-sized targets.

## Page head

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

`viewport-fit=cover` is what makes `env(safe-area-inset-*)` non-zero on a notched phone; without it every
inset in this layer is simply 0. Link `layout.css` after `components.css` (see `docs/delivery.md`).

## `.o-shell`: header, nav, main

Below md the nav is an off-canvas drawer opened by a hidden checkbox, so it works **with no JavaScript**.
From md it is a sidebar (`.o-shell--top` makes it a top bar instead).

```html
<div class="o-shell">
  <input type="checkbox" id="nav-toggle" class="o-shell__toggle" aria-label="Menu" autocomplete="off">
  <header class="o-shell__header">
    <label class="o-shell__menu-btn" for="nav-toggle">
      <span class="o-shell__menu-icon" aria-hidden="true"></span><span class="o-sr-only">Menu</span>
    </label>
    <a class="o-shell__brand" href="/">Octopus</a>
    <span class="o-shell__spacer"></span>
    <button class="o-btn o-btn--sm">Account</button>
  </header>
  <nav class="o-shell__nav" aria-label="Main">
    <div class="o-shell__nav-head"><strong>Menu</strong>
      <label class="o-shell__close" for="nav-toggle"><span class="o-sr-only">Close menu</span></label></div>
    <a class="o-nav__link is-active" href="/" aria-current="page">Home</a>
    <a class="o-nav__link" href="/things">Things</a>
  </nav>
  <label class="o-shell__scrim" for="nav-toggle"></label>
  <main class="o-shell__main" id="main"><div class="o-page"> ... </div></main>
</div>
```

- The checkbox must be the first child, before header, nav and scrim (the CSS uses `~`). Keep
  `autocomplete="off"` so a reload does not restore it checked.
- The shell is `100vh` with a `100dvh` override, and header, drawer and sidebar pad themselves with the
  safe-area insets. `.o-nav` and `.o-nav__link` work inside the nav (they stack) and inside the header (a row).
- `.o-shell--contained` draws the shell inside a sized box instead of the viewport (previews, iframes).
- `.o-shell--top`: top bar from md.

**Optional JS** (`blocks/o-shell.js`, a module, see `docs/delivery.md`) adds: Escape closes the drawer, focus
moves into it and back to the toggle, Tab stays inside it while open, following a link closes it, and it closes
when the window grows past md. It adds no markup. Without it everything above still works except those five.
Single-page apps that add the shell later call `import { enhance } from '.../blocks/o-shell.js'; enhance(el)`.

## `.o-page`: the content container

```html
<div class="o-page"> ... </div>
```

`max-width: var(--o-page-max)` (72rem), centred, fluid side gutters (`clamp`, never under the safe-area inset),
`min-width: 0` (so it can shrink inside a flex or grid parent), `overflow-wrap: anywhere` (long URLs wrap), `pre`
scrolls sideways, and `img, video, svg` get `max-width: 100%` (`height: auto` for img and video).

A canvas or drawing library that sizes its own SVG needs the opt-out, or the library's drawing is squeezed
(tldraw does): `<div class="o-nofit"> ...editor... </div>`. Tables keep whole words, so a wide one scrolls
(below) rather than squeezing letter by letter.

## `.o-stack`, `.o-cluster`, `.o-grid`

```html
<div class="o-stack"> <p>..</p> <p>..</p> </div>              <!-- vertical rhythm; also .o-stack--sm, .o-stack--lg -->
<div class="o-cluster o-cluster--between"> <span>..</span> <button class="o-btn">..</button> </div>
                                                              <!-- wrapping row; also --end -->
<div class="o-grid"> <div class="o-card">..</div> <div class="o-card">..</div> </div>
                                                              <!-- auto-fit, min 16rem; also .o-grid--sm (11rem), --lg (24rem) -->
```

Children get `min-width: 0`. The grid minimum is `min(16rem, 100%)`, so it never overflows a 320px screen.

## Tables

```html
<!-- scroll sideways with an edge shadow wherever more is hidden -->
<div class="o-table-wrap" tabindex="0" role="region" aria-label="Orders">
  <table class="o-table"> ... </table>
</div>

<!-- cards below sm: a data-label on every cell, from the header text -->
<table class="o-table o-table--cards">
  <thead><tr><th>Name</th><th>Status</th></tr></thead>
  <tbody><tr><td data-label="Name">Alpha</td><td data-label="Status">ok</td></tr></tbody>
</table>
```

Use the wrapper when the columns matter side by side, the cards when each row is a record. Do not combine them.
The header row is hidden visually below sm but stays for screen readers.

## `.o-modal`: sheet below md, dialog from md

```html
<dialog class="o-modal" id="confirm" aria-labelledby="confirm-t">
  <h3 class="o-modal__title" id="confirm-t">Delete it?</h3>
  <p>...</p>
  <div class="o-modal__actions">
    <button class="o-btn o-btn--ghost" onclick="this.closest('dialog').close()">Cancel</button>
    <button class="o-btn o-btn--danger">Delete</button>
  </div>
</dialog>
<script>document.getElementById('confirm').showModal()</script>
```

`showModal()` gives the backdrop, focus trap, Escape and inert page for free. The box has a `max-height`
(`100dvh` minus gutters) and scrolls inside; below md it is a bottom sheet with the home-bar inset.
`.o-modal--wide` for 48rem. The older `.o-modal-scrim > .o-modal` wrapper form gets the same treatment.

## Fixed bars and toasts

```html
<div class="o-fixed-bar"> <span>3 unsaved changes</span> <button class="o-btn o-btn--primary">Save</button> </div>
<div class="o-fixed-bar o-fixed-bar--top"> ... </div>
<div class="o-toast-region"> <div class="o-toast o-toast--success" role="status">Saved.</div> </div>
```

Both clear the notch and home indicator. Give the page bottom padding the height of a bar so it never hides the
last row. A bar is z-index 900, the drawer 1150-1200, modals and toasts above the bar.

## `.o-screen`

`.o-screen { min-height: 100vh; min-height: 100dvh }`: a full-height box that does not jump when the mobile
URL bar moves. `.o-screen--fixed` fixes the height instead (app-like views that scroll internally).

## Form controls and touch (components.css)

- `.o-input`, `.o-select`, `.o-textarea`: `font-size: max(16px, 1rem)` so iOS does not zoom on focus; 44px tall (`--o-tap`).
- `.o-btn` and `.o-nav__link`, `.o-tab`: 44px tall. `.o-btn--sm` and `.o-btn--icon` stay small for a mouse and become 44px under `(pointer: coarse)`.
- `.o-check`: a label wrapping a checkbox or radio with a full-size hit area.
- Hover styling is inside `@media (hover: hover)`, so a tap never leaves a stuck hover state.
- `:focus-visible` rings on every control.

## What an app must do beyond adding classes

1. `viewport-fit=cover` in the viewport meta (safe-area insets are 0 without it).
2. Link `layout.css` (and optionally `o-shell.js`).
3. Delete its own `100vh`, private breakpoints, per-page modal and `.rest-banner`-style fixed-bar CSS as it moves to the kit classes.
4. Nothing in layout.css fires on its own: unclassed markup is unchanged. The one global change is components.css:
   controls are now 44px tall and inputs 16px, which can alter dense screens; use `.o-btn--sm` where a compact one is intended.
