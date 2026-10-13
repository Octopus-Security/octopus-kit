#!/usr/bin/env node
// Builds the static LIVE CHANNEL output: everything an app loads from the kit host.
//   node scripts/build-channel.mjs --out dist/channel     write <out>/v0/...
//   node scripts/build-channel.mjs --check                build into a temp dir and validate only
// Layout under /v0/: tokens.css accents.css base.css components.css layout.css theme-boot.js aliases/*.css
//   blocks/** manifest.json _/<hash8>/<name> (immutable, content-hashed copies)
// Validation: every CSS file must tokenise (balanced braces/strings/comments) and every JS file
// must parse (`node --check`; blocks as ES modules, theme-boot as a classic script).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, mkdtempSync, copyFileSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CHANNEL = 'v0';

function walk(dir, base = dir) {
  let out = [];
  let names = [];
  try { names = readdirSync(dir).sort(); } catch { return out; }
  for (const n of names) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out = out.concat(walk(p, base));
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

/** [published path under /v0/, source path] pairs. */
export function channelFiles(root = ROOT) {
  const list = [
    ['tokens.css', 'tokens/tokens.css'],
    ['accents.css', 'tokens/accents.css'],
    ['base.css', 'ui/base.css'],
    ['components.css', 'ui/components.css'],
    ['layout.css', 'ui/layout.css'],
    ['theme-boot.js', 'tokens/theme-boot.js'],
  ];
  for (const f of walk(join(root, 'tokens/aliases'))) if (f.endsWith('.css')) list.push([`aliases/${f}`, `tokens/aliases/${f}`]);
  for (const f of walk(join(root, 'blocks'))) if (/\.(m?js|css)$/.test(f)) list.push([`blocks/${f}`, `blocks/${f}`]);
  return list;
}

const hash8 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);

export function validateCss(text) {
  const errors = [];
  let depth = 0, i = 0, line = 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') line++;
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) { errors.push(`unterminated comment at line ${line}`); break; }
      line += (text.slice(i, end).match(/\n/g) || []).length; i = end + 2; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      if (text[j] !== c) { errors.push(`unterminated string at line ${line}`); break; }
      i = j + 1; continue;
    }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth < 0) { errors.push(`unbalanced } at line ${line}`); break; } }
    i++;
  }
  if (depth > 0) errors.push(`${depth} unclosed {`);
  if (!text.replace(/\/\*[\s\S]*?\*\//g, '').trim()) errors.push('file is empty');
  return errors;
}

function validateJs(text, module) {
  const dir = mkdtempSync(join(tmpdir(), 'kit-js-'));
  const tmp = join(dir, module ? 'x.mjs' : 'x.cjs');
  try {
    writeFileSync(tmp, text);
    const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    return r.status === 0 ? [] : [(r.stderr || 'syntax error').split('\n').slice(0, 4).join(' | ')];
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Returns {file: [errors]} for every invalid file under outDir/v0. */
export function checkChannel(outDir) {
  const base = join(outDir, CHANNEL);
  const bad = {};
  for (const f of walk(base)) {
    if (f.startsWith('_/') || f === 'manifest.json') continue;
    const text = readFileSync(join(base, f), 'utf8');
    const errs = extname(f) === '.css' ? validateCss(text) : validateJs(text, f !== 'theme-boot.js');
    if (errs.length) bad[f] = errs;
  }
  return bad;
}

export function buildChannel(outDir, root = ROOT) {
  const base = join(outDir, CHANNEL);
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const files = {};
  for (const [pub, src] of channelFiles(root)) {
    const buf = readFileSync(join(root, src));
    const h = hash8(buf);
    for (const dest of [pub, `_/${h}/${pub}`]) {
      mkdirSync(dirname(join(base, dest)), { recursive: true });
      copyFileSync(join(root, src), join(base, dest));
    }
    files[pub] = { hash: h, immutable: `_/${h}/${pub}` };
  }
  // No timestamp: the manifest is a pure function of the sources.
  writeFileSync(join(base, 'manifest.json'), JSON.stringify({ channel: CHANNEL, version, files }, null, 2) + '\n');
  return { version, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const oi = args.indexOf('--out');
  const out = check ? mkdtempSync(join(tmpdir(), 'kit-channel-')) : (oi >= 0 ? args[oi + 1] : join(ROOT, 'dist/channel'));
  const { version, files } = buildChannel(out);
  const bad = checkChannel(out);
  if (check) rmSync(out, { recursive: true, force: true });
  for (const [f, errs] of Object.entries(bad)) console.error(`INVALID ${f}: ${errs.join('; ')}`);
  if (Object.keys(bad).length) process.exit(1);
  console.log(`channel ${CHANNEL} @ ${version}: ${Object.keys(files).length} files OK${check ? '' : ` -> ${out}`}`);
}
