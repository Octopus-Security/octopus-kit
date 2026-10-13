# kit host image. Build context is the REPO ROOT (see docker-compose.yml), checked out at the
# `channel/v0` branch, which the release script only ever moves to a v0.* TAG. A push to main
# therefore changes nothing here.

# Stage 1: build and validate the static channel from the checked-out tag. A file that does not
# parse fails the build, so Portainer keeps the previous container running.
FROM node:22-alpine AS build
WORKDIR /kit
COPY package.json ./
COPY tokens ./tokens
COPY ui ./ui
COPY blocks ./blocks
COPY scripts/build-channel.mjs ./scripts/build-channel.mjs
RUN node scripts/build-channel.mjs --out /out

# Stage 2: static nginx.
FROM nginx:alpine
# Patch the base layer's OS packages (guarded by octopus-vault/scripts/check-base-packages.mjs).
RUN apk upgrade --no-cache
RUN rm -rf /usr/share/nginx/html/*
COPY channel/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /out/ /usr/share/nginx/html/

# Deploy verification, derived from the files actually in the image (never typed). `builtAt`
# rather than `startedAt`: nginx serves files, there is no application start. api/ is created
# after the hash is taken so the stamp never covers its own output.
RUN set -eu; \
    BUILD="$(find /usr/share/nginx/html -type f | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -c1-12)"; \
    VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' /usr/share/nginx/html/v0/manifest.json | head -1)"; \
    mkdir -p /usr/share/nginx/html/api; \
    printf '{"ok":true,"service":"octopus-kit-host","build":"%s","version":"%s","builtAt":"%s"}\n' \
      "$BUILD" "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /usr/share/nginx/html/api/build

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/health || exit 1
