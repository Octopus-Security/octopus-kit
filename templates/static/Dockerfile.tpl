FROM nginx:alpine

# Patch the base layer's OS packages (guarded by octopus-vault/scripts/check-base-packages.mjs).
RUN apk upgrade --no-cache

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/

# ── Deploy verification ───────────────────────────────────────────────────────
# There is no application process to compute a stamp at startup, so it is computed
# HERE, from the files actually in the image, and written out as a static document.
# Derived, never typed: a stamp someone must remember to bump reports "nothing
# changed" for a deploy that did. `builtAt` rather than `startedAt`: nginx serves
# a file, there is no application start. The api/ directory is created after the
# hash is taken, so the stamp never covers its own output.
RUN set -eu; \
    BUILD="$(find /usr/share/nginx/html -type f \( -name '*.html' -o -name '*.css' -o -name '*.js' \) \
             | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -c1-12)"; \
    mkdir -p /usr/share/nginx/html/api; \
    printf '{"ok":true,"service":"octopus-{{SLUG}}","build":"%s","builtAt":"%s"}\n' \
      "$BUILD" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /usr/share/nginx/html/api/build

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/health || exit 1
