#!/usr/bin/env node
// Bump the PINNED half (octopus-kit/server and friends) in every consumer at once.
//   node scripts/bump-kit.mjs --to v0.2.0              dry run: list consumers and what would change
//   node scripts/bump-kit.mjs --to v0.2.0 --apply      branch + commit in each consumer repo (local only)
//   node scripts/bump-kit.mjs --to v0.2.0 --push       --apply, then push the BRANCH and open a draft PR
// Options: --root <dir> (default: the tentacles root, the parent of this repo).
//
// Safety: never pushes to main/master (refuses any branch it did not create), never forces, needs a
// clean working tree in each consumer, branches from origin's default branch (not from whatever the
// repo has checked out), and skips repos where the tag is already pinned. A package-lock.json that
// pins octopus-kit is REPORTED, not edited: its integrity hash must come from `npm install`.
// The tag must already exist on GitHub (the tarball is what installs).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARBALL = (tag) => `https://codeload.github.com/Octopus-Security/octopus-kit/tar.gz/refs/tags/${tag}`;
// Any existing spec that points at the kit: tarball, github: shorthand, git+https.
const SPEC = /(https:\/\/codeload\.github\.com\/Octopus-Security\/octopus-kit\/tar\.gz\/refs\/tags\/[^"\s]+|github:Octopus-Security\/octopus-kit[^"\s]*|git\+https:\/\/github\.com\/Octopus-Security\/octopus-kit[^"\s]*)/;
const DEP_LINE = new RegExp(`("octopus-kit"\\s*:\\s*")${SPEC.source}(")`);

/** Pure: new package.json text pinned to tag, or null if it has no kit dependency. */
export function rewriteDep(text, tag) {
  if (!DEP_LINE.test(text)) return null;
  return text.replace(DEP_LINE, `$1${TARBALL(tag)}$3`);
}
export const currentTag = (text) => { const m = DEP_LINE.exec(text); return m && (/refs\/tags\/(v[^"\s]+)/.exec(m[0]) || /#(v?[^"\s]+)/.exec(m[0]) || [])[1] || null; };

/** package.json files up to two levels deep, skipping node_modules and dot-dirs. */
export function findManifests(repoDir) {
  const out = [];
  const visit = (dir, depth) => {
    if (existsSync(join(dir, 'package.json'))) out.push(join(dir, 'package.json'));
    if (depth >= 2) return;
    for (const n of readdirSync(dir)) {
      if (n === 'node_modules' || n.startsWith('.')) continue;
      const p = join(dir, n);
      try { if (statSync(p).isDirectory()) visit(p, depth + 1); } catch { /* ignore */ }
    }
  };
  visit(repoDir, 0);
  return out;
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const to = val('--to');
  const PUSH = args.includes('--push');
  const APPLY = args.includes('--apply') || PUSH;
  if (!to || !/^v\d+\.\d+\.\d+$/.test(to)) { console.error('usage: bump-kit.mjs --to vX.Y.Z [--apply|--push] [--root dir]'); process.exit(2); }
  const kitRoot = resolve(here, '..');
  const root = resolve(val('--root') || join(kitRoot, '..'));
  const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  const gitOk = (cwd, ...a) => { const r = git(cwd, ...a); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${(r.stderr || '').trim()}`); return r.stdout.trim(); };

  console.log(`${APPLY ? (PUSH ? 'APPLY + PUSH' : 'APPLY (local branches only)') : 'DRY RUN'}: pin octopus-kit to ${to} under ${root}\n`);
  if (APPLY && git(kitRoot, 'ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${to}`).status !== 0) {
    console.error(`Tag ${to} is not on origin. Release it first (scripts/release.mjs --publish); the tarball would 404.`); process.exit(1);
  }
  let changed = 0;
  for (const name of readdirSync(root).sort()) {
    const repo = join(root, name);
    if (repo === kitRoot || !existsSync(join(repo, '.git'))) continue;
    const manifests = findManifests(repo).filter((p) => DEP_LINE.test(readFileSync(p, 'utf8')));
    if (!manifests.length) continue;
    const rel = (p) => relative(repo, p);
    const todo = manifests.filter((p) => currentTag(readFileSync(p, 'utf8')) !== to || !readFileSync(p, 'utf8').includes('codeload'));
    const lockfiles = manifests.map((p) => join(dirname(p), 'package-lock.json')).filter((p) => existsSync(p) && readFileSync(p, 'utf8').includes('octopus-kit'));
    if (!todo.length) { console.log(`${name}: already on ${to}`); continue; }
    console.log(`${name}: ${todo.map((p) => `${rel(p)} (${currentTag(readFileSync(p, 'utf8'))} -> ${to})`).join(', ')}`);
    if (lockfiles.length) console.log(`  NOTE: refresh ${lockfiles.map(rel).join(', ')} with \`npm install octopus-kit@${TARBALL(to)}\` (the script does not edit lockfiles).`);
    if (!APPLY) continue;
    try {
      if (git(repo, 'status', '--porcelain').stdout.trim()) throw new Error('working tree is not clean');
      gitOk(repo, 'fetch', '--quiet', 'origin');
      const def = gitOk(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').replace(/^origin\//, '');
      const branch = `chore/bump-kit-${to}`;
      if (['main', 'master', def].includes(branch)) throw new Error('refusing to use a default branch name');
      gitOk(repo, 'checkout', '-q', '-B', branch, `origin/${def}`);
      for (const p of todo) writeFileSync(p, rewriteDep(readFileSync(p, 'utf8'), to));
      gitOk(repo, 'add', ...todo.map(rel));
      gitOk(repo, 'commit', '-q', '-m', `Bump octopus-kit to ${to}\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`);
      console.log(`  committed on ${branch} (from origin/${def})`);
      changed++;
      if (PUSH) {
        gitOk(repo, 'push', '-u', 'origin', branch);   // plain push, never forced, never main
        const pr = spawnSync('gh', ['pr', 'create', '--draft', '--base', def, '--head', branch, '--title', `Bump octopus-kit to ${to}`, '--body', `Pins the server half of octopus-kit to ${to}. Merging deploys this app.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)`], { cwd: repo, encoding: 'utf8' });
        console.log(`  pushed; PR: ${(pr.stdout || pr.stderr).trim()}`);
      }
    } catch (e) { console.log(`  SKIPPED: ${e.message}`); }
  }
  console.log(APPLY ? `\n${changed} repo(s) bumped.` : '\nDry run only. Nothing was changed. Add --apply (local) or --push.');
}
