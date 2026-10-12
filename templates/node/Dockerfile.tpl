# ── Build stage: dependencies only ────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /usr/src/app
RUN apk upgrade --no-cache

# octopus-kit installs from a public tarball: no token. NPM_TOKEN is optional and
# only for @octopus-security/auth-client (GitHub Packages), which sso mode needs;
# without it the build still succeeds and sso mode REFUSES to boot rather than
# run without auth. The .npmrc is written and removed in ONE layer.
ARG NPM_TOKEN
COPY package*.json ./
RUN if [ -n "$NPM_TOKEN" ]; then \
      printf '@octopus-security:registry=https://npm.pkg.github.com/\n//npm.pkg.github.com/:_authToken=%s\n' "$NPM_TOKEN" > .npmrc; \
    fi && \
    npm install --omit=dev --no-audit --no-fund && \
    rm -f .npmrc

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /usr/src/app

# Patch the base layer's OS packages (a re-pull only delivers what the tag holds).
# Guarded by octopus-vault/scripts/check-base-packages.mjs.
RUN apk upgrade --no-cache

COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .

RUN mkdir -p /usr/src/app/data && chown -R node:node /usr/src/app

# Strip npm from the runtime image. Nothing here runs it — the CMD is a bare
# `node` — but Trivy reports what is PRESENT, not what is reachable, and npm
# bundles its own vulnerable tree: tar 7.5.11 (CVE-2026-59873, CRITICAL),
# pacote, sigstore, brace-expansion, picomatch, ip-address. Measured against
# node:22-alpine on 2026-09-21: 1 CRITICAL / 12 HIGH with npm, 0 / 2 without —
# 11 of those 13 findings were npm's, not Alpine's.
#
# Must run as root, so it goes above any USER line.
# Guarded by octopus-vault/scripts/check-no-npm.mjs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

USER node

ENV NODE_ENV=production PORT=3000 DATA_DIR=/usr/src/app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD [ "node", "index.js" ]
