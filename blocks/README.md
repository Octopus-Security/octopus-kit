# blocks/

Browser-side components for the live channel. Every `.js`/`.mjs` file here is published at
`https://kit.octopustechnology.net/v0/blocks/<name>` and must be a self-contained ES module
(web components registering themselves). `.css` files are copied too. Nothing here is imported
by server code. This README is not published.

Rules: no build step, no bare imports (a relative `import './x.js'` works), no network access
at import time, and degrade to nothing if the browser lacks a feature. Breaking changes go in a
new major channel (`v1`), never in `v0`.
