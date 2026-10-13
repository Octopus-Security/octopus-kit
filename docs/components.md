# Components

Copy-paste markup for the components in `ui/components.css` that are not obvious from the class name.
Everything uses `--o-*` tokens only, so it follows light, dark, compact and each app's accent.
`docs/preview.html` shows each one in dark and light; **view it at 390, 768 and 1280 px wide**.

Rules every component here follows: tap targets at least 44px (`--o-tap`), form text at least 16px, hover
styles only inside `@media (hover: hover)`, motion guarded by `prefers-reduced-motion`, and no JavaScript
unless a section says so (the two optional scripts are in `blocks/`, see `docs/delivery.md`).

## Stat tile

`.o-stats` is a grid (two-up on a phone, more as space allows); `.o-stat` is one tile. A `<dl>` gives a
screen reader the label and value as a pair. A tile also works standalone in a `<div>` with `<span>`s.

```html
<dl class="o-stats">
  <div class="o-stat"><dt class="o-stat__label">Spend</dt><dd class="o-stat__value">$12.40</dd><dd class="o-stat__sub">this month</dd></div>
  <div class="o-stat o-stat--pos"><dt class="o-stat__label">Net</dt><dd class="o-stat__value">$35.60</dd></div>
</dl>
```

Modifiers on `.o-stat`: `--accent`, `--pos`, `--warn`, `--neg` (colour the value), `--center`, `--flat` (no box).
Colour is never the only signal: put the sign or a word in the value or `__sub` (`-$4.00`, `late`).
