#!/usr/bin/env node
/**
 * octopus-favicon-pack — build an octopus-favicon-pack v1 JSON file, with no dependency
 * beyond this repo.
 *
 *   node bin/octopus-favicon-pack.mjs --slug health --emoji 🩺 [--name Health] [--color '#28a1c0'] --out pack.json
 *   node bin/octopus-favicon-pack.mjs --slug health --from-svg icon.svg [--name Health] [--color '#28a1c0'] --out pack.json
 *   node bin/octopus-favicon-pack.mjs --all --out packs/ [--hub <path to hub-apps.json>]
 *
 * --all is the bootstrap that seeds auth: one pack per hub-apps.json app (slug + icon + name),
 * themed with that app's dark-mode accent from tokens/accents.json. It resolves hub-apps.json
 * by walking up from this checkout looking for a sibling octopus-auth/ (the tentacles-root
 * layout) — --hub overrides that search. Either way, a hub file that cannot be found is a hard
 * failure: this never silently writes an empty packs/ directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const KIT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildPack } = require(path.join(KIT_DIR, 'brand', 'pack.js'));
const { registry: accents } = require(path.join(KIT_DIR, 'tokens', 'accents.cjs'));

// Flags that take no value. Everything else beginning "--" consumes the next argv as its value,
// so "--all --out packs/" must not let --all swallow --out.
const BOOL_FLAGS = new Set(['all', 'help']);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { args.help = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const rawKey = eq > 0 ? a.slice(2, eq) : a.slice(2);
      const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (eq > 0) { args[key] = a.slice(eq + 1); continue; }
      if (BOOL_FLAGS.has(rawKey)) { args[key] = true; continue; }
      args[key] = argv[++i];
    } else args._.push(a);
  }
  return args;
}

/** Walk up from `from` looking for <dir>/octopus-auth/hub-apps.json (the tentacles-root layout). */
function findHubFile(explicit, from = KIT_DIR) {
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!fs.existsSync(resolved)) throw new Error(`--hub ${explicit}: file not found`);
    return resolved;
  }
  let dir = from;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'octopus-auth', 'hub-apps.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`cannot find octopus-auth/hub-apps.json by walking up from ${from} — pass --hub <path> explicitly`);
}

function writeJSON(file, obj) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(obj, null, 2)}\n`);
  return target;
}

function buildOne(args) {
  if (!args.slug) throw new Error('--slug is required');
  if (!args.out) throw new Error('--out is required');
  if (Boolean(args.emoji) === Boolean(args.fromSvg)) throw new Error('pass exactly one of --emoji <emoji> or --from-svg <file>');
  const name = args.name || (args.slug.charAt(0).toUpperCase() + args.slug.slice(1));
  const theme = args.color ? { color: args.color } : undefined;
  const pack = args.emoji
    ? buildPack({ slug: args.slug, name, emoji: args.emoji, theme, generator: args.generator })
    : buildPack({ slug: args.slug, name, svg: fs.readFileSync(path.resolve(args.fromSvg), 'utf8'), theme, generator: args.generator });
  return writeJSON(args.out, pack);
}

function runAll(args) {
  const hubFile = findHubFile(args.hub);
  const hub = JSON.parse(fs.readFileSync(hubFile, 'utf8'));
  const apps = (Array.isArray(hub) ? hub : hub.apps || []).filter(a => a && a.slug && a.icon);
  if (!apps.length) throw new Error(`${hubFile}: no apps with both a slug and an icon`);
  const outDir = path.resolve(args.out || 'packs');
  const written = [];
  for (const app of apps) {
    const accent = accents[app.slug];
    const theme = accent && accent.dark && accent.dark.accent ? { color: accent.dark.accent } : undefined;
    const pack = buildPack({ slug: app.slug, name: app.name || app.slug, emoji: app.icon, theme });
    written.push(writeJSON(path.join(outDir, `${app.slug}.json`), pack));
  }
  return written;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || (!args.all && !args.slug)) {
    console.log('usage: octopus-favicon-pack --slug <slug> --emoji <emoji> [--name Name] [--color #rrggbb] --out pack.json');
    console.log('       octopus-favicon-pack --slug <slug> --from-svg <file> [--name Name] [--color #rrggbb] --out pack.json');
    console.log('       octopus-favicon-pack --all --out packs/ [--hub <path to hub-apps.json>]');
    return args.help ? 0 : 2;
  }
  try {
    if (args.all) {
      const files = runAll(args);
      console.log(`Wrote ${files.length} pack(s):`);
      for (const f of files) console.log(`  ${f}`);
    } else {
      console.log(`Wrote ${buildOne(args)}`);
    }
    return 0;
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  process.exitCode = main();
}
