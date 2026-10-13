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

## Link tile

A whole-tile link for launchers, tool pickers and chapter lists. The anchor is the tile, so the entire
box is the tap target and the title is the link text. Wrap tiles in `<ul class="o-tiles">` (auto-fills
columns, one per row on the narrowest phones). `aria-current="page"` marks the current one,
`aria-disabled="true"` greys one out and stops clicks. `--row` puts the icon beside the text.

```html
<ul class="o-tiles">
  <li><a class="o-tile" href="/budget"><span class="o-tile__icon" aria-hidden="true">&#9889;</span><span class="o-tile__title">Budget</span><span class="o-tile__text">Track spending</span></a></li>
  <li><a class="o-tile o-tile--row" href="/ch1"><span class="o-tile__icon" aria-hidden="true">&#128218;</span><span class="o-tile__body"><span class="o-tile__title">Chapter 1</span><span class="o-tile__text">12 problems</span></span></a></li>
</ul>
```

## Code input

A one-time or recovery code field. It is an ordinary `.o-input` (16px, 44px tall) with `.o-code` added for
the monospaced, widely spaced, centred look. For a numeric 2FA code use `inputmode="numeric"`,
`autocomplete="one-time-code"` (so phones offer the code from a message) and `maxlength`. `--wide` tightens the
spacing for longer alphanumeric codes.

```html
<label class="o-label" for="otp">Authenticator code</label>
<input class="o-input o-code" id="otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" placeholder="000000">
```

## Full-width button

`.o-btn--block` makes a button (or a link styled as one) fill its container: the submit button of a
sign-in form, the action at the bottom of a card or a phone sheet. Combine with any other button modifier.
To go full width only on a phone, put the button in a container that narrows, or add the class from your own
breakpoint rule.

```html
<button class="o-btn o-btn--primary o-btn--block" type="submit">Continue</button>
```

## File dropzone

A dashed box around a real `<input type="file">`, which is stretched invisibly over the whole box. Tapping
opens the picker, dropping a file onto it selects it, the box shows the focus ring from the keyboard, and it
all works with no JavaScript. The optional `blocks/o-dropzone.js` adds the `.is-over` highlight while a file
is dragged over and writes the chosen file names into `.o-dropzone__files`. Add `multiple` to the input to
accept several. `.is-disabled` greys it out (also disable the input).

```html
<label class="o-dropzone">
  <input class="o-dropzone__input" type="file" accept="image/*" aria-describedby="dz-hint">
  <span class="o-dropzone__title">Drop a file here or tap to choose</span>
  <span class="o-dropzone__hint" id="dz-hint">PNG or JPG, up to 5 MB</span>
  <span class="o-dropzone__files" aria-live="polite"></span>
</label>
<script type="module" src="https://kit.octopustechnology.net/v0/blocks/o-dropzone.js"></script>
```

## Copy box

A value (invite code, link, token you must show once) in a mono box with a Copy button beside it. The text
is `user-select: all`, so one tap or click selects it even without JavaScript. The optional
`blocks/o-copy.js` makes the button copy it and show "Copied" for two seconds: point `data-o-copy` at the
text's `#id`, or leave it bare to use the `.o-copy__text` in the same box; `data-o-copied="Done"` changes the
message. `--wrap` lets a long value wrap instead of scrolling.

```html
<div class="o-copy">
  <code class="o-copy__text" id="invite">octo-4F7K-92QX</code>
  <button class="o-btn o-copy__btn" type="button" data-o-copy="#invite">Copy</button>
</div>
<script type="module" src="https://kit.octopustechnology.net/v0/blocks/o-copy.js"></script>
```
