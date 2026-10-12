#!/usr/bin/env node
/**
 * create-octopus-app — emit a new app of the octopus suite that passes the
 * estate's conventions by default.
 *
 *   node bin/create-octopus-app.mjs <slug> --name "Kitchen" --profile ui|headless|static --dir ./octopus-kitchen
 *     [--icon 🍳] [--subdomain kitchen] [--domain example.net] [--access private|open]
 *     [--kit-dep <npm spec>]   override the octopus-kit dependency line
 *
 * Profiles
 *   ui        Express 4 + EJS, the kit's tokens/ui CSS, theme boot, app gate, SSO
 *   headless  Express, JSON only (no views)
 *   static    nginx, hand-maintained files, /health and a build stamp written at image build
 *
 * What it writes (node profiles): index.js config.js auth.js package.json Dockerfile
 * docker-compose.yml .env.example .gitignore .dockerignore octopus.json hub.json CLAUDE.md
 * test/boots.test.js test/env-wiring.test.js (+ views/ and public/ for ui).
 *
 * The octopus-kit dependency is the codeload TARBALL URL, not `github:owner/repo#tag`:
 * npm resolves the `github:` form with the git binary, and node:22-alpine has none
 * (verified 2026-10-12: "npm error enoent spawn git"). The tarball form installs
 * with no git and no token.
 *
 * This file is also importable: `generate()` is what test/scaffold.test.js drives.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const KIT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = path.join(KIT_DIR, 'templates');
const { validate, toHubJson } = require('../manifest/validate.js');

export const KIT_REF = 'v0.1.0';
export const KIT_DEP = `https://codeload.github.com/Octopus-Security/octopus-kit/tar.gz/refs/tags/${KIT_REF}`;
export const PROFILES = ['ui', 'headless', 'static'];

const SLUG_RE = /^[a-z][a-z0-9-]{1,38}$/;
// Printable text only: the name lands in JS strings, HTML, JSON and Markdown, so quotes, angle
// brackets, backslashes, backticks, braces and `$` are not allowed rather than escaped per context.
const NAME_RE = /^[\p{L}\p{N} .,&()+-]{1,60}$/u;

/** {{VAR}} substitution plus {{#flag}}...{{/flag}} blocks (marker lines are removed with the block). */
export function render(text, vars, flags = {}) {
  let out = text.replace(/^[ \t]*\{\{#(\w+)\}\}[ \t]*\n([\s\S]*?)^[ \t]*\{\{\/\1\}\}[ \t]*\n?/gm, (_, flag, body) => (flags[flag] ? body : ''));
  out = out.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in vars)) throw new Error(`template variable ${m} has no value`);
    return vars[k];
  });
  return out;
}

function listTemplateFiles(dir, prefix = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(TEMPLATES, dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listTemplateFiles(dir, rel));
    else if (e.name.endsWith('.tpl')) out.push(rel);
  }
  return out;
}

function validateInputs({ slug, name, profile, subdomain, domain, access, icon }) {
  if (!SLUG_RE.test(slug || '')) throw new Error('slug must start with a letter and use a-z, 0-9 and "-" (2-39 characters). It is permanent: it keys the app\'s accent, its access rows and its hub tile.');
  if (!NAME_RE.test(name || '')) throw new Error('--name must be 1-60 letters, digits, spaces and . , & ( ) + -');
  if (!PROFILES.includes(profile)) throw new Error(`--profile must be one of ${PROFILES.join(', ')}`);
  if (subdomain && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) throw new Error('--subdomain must be a single DNS label');
  if (domain && !/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/.test(domain)) throw new Error('--domain must be a lower-case host name');
  if (access && !['private', 'open'].includes(access)) throw new Error('--access must be private or open');
  void icon;
}

/** Ask the kit for the next unused accent, if this kit version can. Never throws. */
function allocateAccent(slug, kitDir) {
  try {
    const mod = require(path.join(kitDir, 'tokens', 'accents.cjs'));
    if (typeof mod.nextFreeAccent !== 'function') return null;
    return mod.nextFreeAccent(slug) || null;
  } catch { return null; }
}

/**
 * Generate an app. Returns { dir, files, manifest, accent, warnings }.
 * Refuses to write into a directory that already has anything in it.
 */
export function generate({ slug, name, profile = 'ui', dir, icon, subdomain, domain, access = 'private', kitDep = KIT_DEP, kitDir = KIT_DIR } = {}) {
  validateInputs({ slug, name, profile, subdomain, domain, access, icon });
  const out = path.resolve(dir || `octopus-${slug}`);
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error(`${out} already exists and is not empty`);

  const warnings = [];
  const isNode = profile !== 'static';
  const manifest = {
    slug, name,
    ...(icon ? { icon } : {}),
    subdomain: subdomain || slug,
    ...(domain ? { domain } : {}),
    access, profile,
    ...(isNode ? {
      provides: { internal: ['/api/internal/whoami'] },
      uses: [{ service: 'cortex', level: 'feature', feature: 'model calls', why: 'Optional: when configured, model calls are billed through cortex; without it the feature is hidden.' }],
    } : {}),
  };
  const check = validate(manifest);
  if (!check.ok) throw new Error(`generated octopus.json is invalid: ${check.errors.join('; ')}`);
  warnings.push(...check.warnings.filter(w => !/^uses\[/.test(w)));

  const vars = {
    SLUG: slug, NAME: name,
    PROFILE_LINE: profile === 'ui' ? 'A server-rendered app (Express 4 + EJS).' : 'A JSON-only service (Express).',
    KIT_HEAD: '',
  };
  const flags = { ui: profile === 'ui', headless: profile === 'headless' };

  const sources = profile === 'static' ? ['static', 'common'] : (profile === 'ui' ? ['node', 'node-ui', 'common'] : ['node', 'common']);
  const files = [];
  const write = (rel, content) => {
    const target = path.join(out, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    files.push(rel);
  };

  // Static sites have no server to serve the kit from node_modules, so copy its CSS in.
  if (profile === 'static') {
    const copied = [];
    for (const f of ['tokens/tokens.css', 'tokens/accents.css', 'ui/base.css', 'ui/components.css']) {
      const src = path.join(kitDir, f);
      if (fs.existsSync(src)) { write(`public/kit/${path.basename(f)}`, fs.readFileSync(src)); copied.push(path.basename(f)); }
    }
    let boot = '';
    try { boot = require(path.join(kitDir, 'tokens', 'theme-boot.cjs')).inlineTag(); } catch { /* kit without tokens */ }
    if (!copied.length) warnings.push('the kit has no tokens/ or ui/ CSS yet, so public/index.html is unthemed');
    vars.KIT_HEAD = [boot && `  ${boot}`, ...copied.map(c => `  <link rel="stylesheet" href="/kit/${c}">`)].filter(Boolean).join('\n');
  }

  for (const src of sources) {
    for (const rel of listTemplateFiles(src)) {
      const outRel = rel.replace(/\.tpl$/, '');
      write(outRel, render(fs.readFileSync(path.join(TEMPLATES, src, rel), 'utf8'), vars, flags));
    }
  }

  if (isNode) {
    const pkg = {
      name: `octopus-${slug}`,
      version: '0.1.0',
      description: `${name}, an app of the octopus suite`,
      private: true,
      main: 'index.js',
      scripts: { start: 'node index.js', dev: 'AUTH_MODE=dev node --watch index.js', test: 'node --test "test/*.test.js"' },
      dependencies: { 'octopus-kit': kitDep, express: '^4.21.2', ...(profile === 'ui' ? { ejs: '^3.1.10' } : {}) },
      optionalDependencies: { '@octopus-security/auth-client': '^1.3.0' },
      engines: { node: '>=20' },
    };
    write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  }
  write('octopus.json', `${JSON.stringify(manifest, null, 2)}\n`);
  write('hub.json', `${JSON.stringify(toHubJson(manifest), null, 2)}\n`);

  const accent = allocateAccent(slug, kitDir);
  return { dir: out, files: files.sort(), manifest, accent, warnings };
}

function steps({ slug, manifest, profile, accent }) {
  const port = profile === 'static' ? 80 : 3000;
  const host = manifest.domain ? `${manifest.subdomain}.${manifest.domain}` : `${manifest.subdomain}.<your domain>`;
  const out = [];
  if (profile !== 'static') out.push('npm install, commit the package-lock.json it creates, then npm test.');
  out.push('Create the GitHub repo and push (decide public/private first: check octopus-vault/memory/system-map-repos.md; pushing to main ships to production).');
  out.push(`Portainer: add a git stack for the repo. Set ${profile === 'static' ? 'nothing (no environment)' : 'AUTH_SERVICE_URL, AUTH_PUBLIC_URL, INTERNAL_SECRET (if it talks to partners), and NPM_TOKEN (only for sso)'}.`);
  out.push(`Proxy host + DNS: ${host} -> container octopus-${slug}:${port} on web_proxy.`);
  out.push(`Hub tile: from octopus-vault run  node scripts/hub-apps.mjs --write , then commit octopus-auth. (An app with no icon is skipped: ${manifest.icon ? 'icon is set' : 'pass --icon or add one to octopus.json + hub.json'}.)`);
  out.push(`SHOWCASE: add one line plus the marker <!-- showcase:octopus-${slug}:public|private --> to octopus-vault/SHOWCASE.md, or list the repo in HIDDEN in scripts/check-showcase.mjs with a reason.`);
  out.push('System map: node octopus-vault/scripts/system-map.mjs');
  out.push('ESTATE.md: if the app adds a capability others should know about, add a line to "What already exists".');
  if (!accent) out.push(`TODO accent: this kit version cannot allocate one. Add "${slug}" to octopus-kit/tokens/accents.json with an unused colour (the distinctness test enforces it), then redeploy with the new kit tag.`);
  out.push(`Tag the kit release your package.json points at (${KIT_REF}) before the first image build.`);
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { args.help = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = (eq > 0 ? a.slice(2, eq) : a.slice(2)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = eq > 0 ? a.slice(eq + 1) : argv[++i];
    } else args._.push(a);
  }
  if (args.help || !args._[0]) {
    console.log('usage: create-octopus-app <slug> --name "Name" --profile ui|headless|static --dir <path> [--icon 🧩] [--subdomain x] [--domain example.net] [--access private|open] [--kit-dep spec]');
    return args.help ? 0 : 2;
  }
  const slug = args._[0];
  try {
    const r = generate({
      slug, name: args.name || slug.charAt(0).toUpperCase() + slug.slice(1), profile: args.profile || 'ui',
      dir: args.dir, icon: args.icon, subdomain: args.subdomain, domain: args.domain, access: args.access || 'private',
      kitDep: args.kitDep || KIT_DEP,
    });
    console.log(`Created ${r.manifest.name} (${r.manifest.profile}) in ${r.dir}\n`);
    for (const f of r.files) console.log(`  ${f}`);
    if (r.accent) console.log(`\nAccent allocated by the kit: ${JSON.stringify(r.accent)}`);
    for (const w of r.warnings) console.log(`\nwarning: ${w}`);
    console.log('\nRemaining manual steps:');
    steps({ slug, manifest: r.manifest, profile: r.manifest.profile, accent: r.accent }).forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
    return 0;
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  process.exitCode = main();
}
