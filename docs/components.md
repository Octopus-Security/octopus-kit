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

## Alert / callout

One box for banners, flash messages, inline errors and note callouts. Tone edge on the left, tinted
background, text in the normal text colour. Put `role="alert"` on `--warn` and `--danger` (announced at
once) and `role="status"` on the rest (announced politely). A message that is always on the page and not
a reaction to something (a disclosure, a legal note) needs no role.

```html
<div class="o-alert o-alert--danger" role="alert">
  <div class="o-alert__body"><strong class="o-alert__title">Could not save.</strong> Weight must be a number.</div>
  <div class="o-alert__actions"><button class="o-btn o-btn--sm" type="button">Retry</button></div>
</div>
```

Tones: default (info), `--success`, `--warn`, `--danger`. `__title` and `__actions` are optional; with no
actions the body fills the row. Use `.o-toast` for a message that appears over the page and goes away.

## Segmented control

One choice from a few, as a single joined pill. Three markups, one look: radios (works with no JS and
submits with a form), buttons (you toggle `aria-pressed` yourself) and links (`aria-current="page"` on
the current one). For radios the `<input>` comes **before** its `<label>`, which is what lets CSS style the
label from `:checked`. `.o-seg--block` stretches it to the full width with equal segments. More than
about four options, or long labels, should be a `.o-select` instead; the strip scrolls rather than wraps.

```html
<div class="o-seg" role="group" aria-label="Effort">
  <input class="o-seg__input" type="radio" name="effort" id="e1" checked><label class="o-seg__opt" for="e1">Easy</label>
  <input class="o-seg__input" type="radio" name="effort" id="e2"><label class="o-seg__opt" for="e2">Hard</label>
</div>

<div class="o-seg o-seg--block" role="group" aria-label="View">
  <button class="o-seg__opt" type="button" aria-pressed="true">List</button>
  <button class="o-seg__opt" type="button" aria-pressed="false">Grid</button>
</div>
```

## Meter

A labelled bar for budgets, allowances, upload progress and strength. It is a native `<progress>`, so
the value is an attribute (`value`, `max`), there is no inline style, and a screen reader announces it.
Link the label with `for`/`id`. Leave `value` off for an indeterminate "working" bar. Pick the tone on the
wrapper (`--success`, `--warn`, `--danger`, `--info`; default is the app accent) and size with `--sm`/`--lg`.
Colour follows your data, not the component: choose the tone in your own code (for example warn above 80%),
and always put the figure in `.o-meter__value`.

```html
<div class="o-meter o-meter--warn">
  <div class="o-meter__head"><label class="o-meter__label" for="budget">Monthly budget</label><span class="o-meter__value">$18 of $25</span></div>
  <progress class="o-meter__bar" id="budget" value="18" max="25"></progress>
</div>
```

## Empty state

Centred "nothing here yet" with a reason and the action that fixes it. Everything but the title is optional.
`--box` draws a dashed container for an empty list inside a page; `--sm` is for a narrow panel.

```html
<div class="o-empty o-empty--box">
  <div class="o-empty__icon" aria-hidden="true">&#9744;</div>
  <h3 class="o-empty__title">No entries yet</h3>
  <p class="o-empty__text">Log your first one and it will show up here.</p>
  <div class="o-empty__actions"><button class="o-btn o-btn--primary" type="button">Add entry</button></div>
</div>
```

## Accordion

Native `<details>`, so it opens with Enter/Space, is announced correctly and needs no JavaScript. Give
every item the same `name` and the browser keeps one open at a time; omit `name` to let several stay open.
Put `open` on an item to start it expanded. The summary is a full 44px tap target.

```html
<div class="o-accordion">
  <details class="o-accordion__item" name="steps" open>
    <summary class="o-accordion__summary">Check the 3.3V rail</summary>
    <div class="o-accordion__body"><p>Set the meter to DC volts.</p></div>
  </details>
  <details class="o-accordion__item" name="steps">
    <summary class="o-accordion__summary">Continuity test</summary>
    <div class="o-accordion__body"><p>Touch the leads together.</p></div>
  </details>
</div>
```

## Spinner

A ring in the accent colour. Always give it a text alternative: `role="status"` with `aria-label`, or put
it beside visible text and mark the ring `aria-hidden="true"`. Sizes `--sm`, default, `--lg`. Under
`prefers-reduced-motion` it pulses instead of spinning. `.o-loading` centres a spinner with a message;
`.o-loading--overlay` covers a `position: relative` region while it loads.

```html
<span class="o-spinner" role="status" aria-label="Loading"></span>
<div class="o-loading" role="status"><span class="o-spinner" aria-hidden="true"></span> Loading results...</div>
```
