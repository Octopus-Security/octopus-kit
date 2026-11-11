# Dialogs and toasts (`ui/dialog.js` + `ui/dialog.css`, kit v0.6.0)

No app uses the browser's native `alert()`, `confirm()` or `prompt()`: they cannot be themed, block the
page and look different in every browser. Use these instead. Zero dependencies; native `<dialog>` with
`showModal()` (and a fallback for browsers without it); Esc cancels, Enter confirms, Tab is trapped, focus
returns to whatever opened the dialog; calls are queued so two dialogs never stack; a call made before
`DOMContentLoaded` waits for it and never throws.

## API

```js
oDialog.alert({ title, body })                       // Promise<void>
oDialog.confirm({ title, body, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, typeToConfirm })  // Promise<boolean>
oDialog.prompt({ title, label, value = '', inputType = 'text', placeholder, required = false, autoComplete, inputMode })  // Promise<string|null>, null on cancel
oDialog.toast(message, { kind = 'info', timeout = 4000 })   // void, non-blocking
```

- `body` is plain text and is escaped (newlines are kept). Pass `{ html: true }` only for trusted static strings.
- A bare string is accepted as the body: `oDialog.confirm('Delete it?')`.
- `danger: true` makes the confirm button red and starts focus on Cancel, so a stray Enter is safe.
- `typeToConfirm: 'name'` adds a field and keeps the confirm button disabled until the text matches exactly.
- `required: true` on a prompt keeps it open (with an inline message) while the field is empty.
- `kind` is `'info' | 'success' | 'danger'`. Toasts sit in a polite `aria-live` region, stack up to 5, and have a 44px close button.
- **Sticky toast:** `timeout: 0` never auto-dismisses; it stays until the user closes it. Use it for errors
  the user must not miss, e.g. `oDialog.toast('Your data was not saved.', { kind: 'danger', timeout: 0 })`.

## Loading it

Plain EJS / vanilla page (serve both files from `node_modules/octopus-kit/ui/` at a content-versioned URL):

```html
<link rel="stylesheet" href="/kit/dialog.css?v=<%= stamp %>">
<script src="/kit/dialog.js?v=<%= stamp %>"></script>   <!-- sets window.oDialog -->
<script>
  document.getElementById('del').addEventListener('click', async () => {
    if (await oDialog.confirm({ title: 'Delete workout?', body: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })) {
      /* ... */
    }
  });
</script>
```

React / Vite / Next (the package is CommonJS: bundlers read the named exports; the default import is the whole object):

```js
import 'octopus-kit/ui/dialog.css';                       // once, at the root
import { confirm, toast } from 'octopus-kit/ui/dialog.js';

async function onDelete() {
  if (!(await confirm({ title: 'Delete?', danger: true, confirmLabel: 'Delete' }))) return;
  toast('Deleted', { kind: 'success' });
}
```

## Theming

Built on `.o-modal` and `.o-toast`. Every colour is `var(--o-x, var(--app-var, literal))`: the kit token, then
the app's own `--surface` / `--bg` / `--text` / `--muted` / `--border` / `--accent` / `--accent-ink` /
`--danger` / `--success` / `--info`, then a literal. Light/dark follows `prefers-color-scheme` and the
`[data-theme]` the kit's `theme-boot` sets, so an app without kit tokens is still themed. Under 768px the
dialog is a bottom sheet; buttons are 44px high, inputs 16px, safe-area insets are respected.

## Converting call sites

| Native | Replace with |
|---|---|
| `alert(msg)` notice or success | `oDialog.toast(msg)` / `{ kind: 'success' }` |
| `alert(err)` error | `oDialog.toast(err, { kind: 'danger' })` (`timeout: 0` if it must not be missed) |
| `alert(msg)` that must be acknowledged before continuing | `await oDialog.alert({ title, body: msg })` |
| `if (confirm(x)) {...}` | `if (await oDialog.confirm({ title, body: x })) {...}` (handler becomes `async`) |
| delete / remove / reset / restore / cancel subscription | add `danger: true` and a clear `confirmLabel` ("Delete") |
| `const v = prompt(x)` | `const v = await oDialog.prompt({ label: x })` (still `null` on cancel) |
| `<form onsubmit="return confirm(...)">` | `preventDefault()`, `await` the confirm, then `form.requestSubmit()` (guard against re-entering the handler) |
| `onclick="confirm(...)"` | move into a script or an async helper |
| `beforeunload` confirm | leave it: it is a browser feature |
