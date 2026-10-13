#!/usr/bin/env node
// Cut a kit release. DRY RUN by default: prints every step it would take.
//   node scripts/release.mjs                 checks + plan only
//   node scripts/release.mjs --publish       tag vX.Y.Z, push the tag, fast-forward channel/v0 to it
//   node scripts/release.mjs --publish --purge   also purge the kit host's URLs at Cloudflare (optional)
//
// THE RELEASE GATE. The kit host (channel/docker-compose.yml) is a Portainer stack that tracks the
// branch `channel/v0`. Nothing but this script moves that branch, and it only ever moves it to a
// v0.* TAG commit, with a plain (never forced) push, so it can only fast-forward. Merging to main
// changes nothing in production; running this with --publish is the deliberate release.
// The tag version must equal package.json's "version", so the number the live channel reports
// (/api/build, /v0/manifest.json) is the tag.
//
// Checks, in order, each fatal: clean tree; on main, equal to origin/main; version is 0.x.y and
// not yet tagged (locally or on origin); npm test passes; the channel builds and every CSS/JS
// file in it parses. Publishing never pushes main.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChannel, checkChannel } from './build-channel.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const PUBLISH = args.includes('--publish');
const PURGE = args.includes('--purge');
const HOST = 'kit.octopustechnology.net';
const CHANNEL_BRANCH = 'channel/v0';

const sh = (cmd, a, opts = {}) => spawnSync(cmd, a, { cwd: ROOT, encoding: 'utf8', ...opts });
const git = (...a) => { const r = sh('git', a); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${(r.stderr || '').trim()}`); return r.stdout.trim(); };
const die = (m) => { console.error(`\nRELEASE BLOCKED: ${m}`); process.exit(1); };
const step = (m) => console.log(`- ${m}`);

if (PURGE && !(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID)) {
  die('--purge needs CLOUDFLARE_API_TOKEN (scope: Zone > Cache Purge) and CLOUDFLARE_ZONE_ID in the environment. Not set; nothing was done.');
}

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
if (!/^0\.\d+\.\d+$/.test(version)) die(`package.json version "${version}" is not 0.x.y. The v0 channel only carries v0 releases; a v1 needs its own channel.`);
const tag = `v${version}`;

console.log(`${PUBLISH ? 'PUBLISHING' : 'DRY RUN (add --publish to do it)'}: ${tag}\n`);

if (git('status', '--porcelain')) die('working tree is not clean. Commit or stash first.');
step('tree is clean');
if (sh('git', ['fetch', '--tags', '--quiet', 'origin']).status !== 0) die('git fetch failed.');
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') die('not on main. Releases are cut from main only.');
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) die('local main differs from origin/main. Pull or push so they are equal.');
step('on main, equal to origin/main');
if (sh('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]).status === 0) die(`tag ${tag} already exists. Bump "version" in package.json first (through a PR).`);
if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`)) die(`tag ${tag} already exists on origin.`);
step(`${tag} is a new tag`);

const t = sh('npm', ['test'], { stdio: ['ignore', 'pipe', 'pipe'] });
if (t.status !== 0) { console.error(t.stdout.split('\n').slice(-40).join('\n')); die('npm test failed.'); }
step('npm test passes');

const out = join(ROOT, 'dist/channel');
const { files } = buildChannel(out);
const bad = checkChannel(out);
if (Object.keys(bad).length) { for (const [f, e] of Object.entries(bad)) console.error(`  INVALID ${f}: ${e.join('; ')}`); die('channel files do not parse.'); }
step(`channel builds: ${Object.keys(files).length} files, all parse`);

const urls = ['manifest.json', ...Object.keys(files)].map((f) => `https://${HOST}/${'v0'}/${f}`);

console.log('\nPlan:');
step(`git tag -a ${tag} -m "octopus-kit ${tag}"`);
step(`git push origin ${tag}`);
step(`git push origin ${tag}^{commit}:refs/heads/${CHANNEL_BRANCH}   (fast-forward only, never forced; Portainer redeploys the kit host)`);
step(PURGE ? `purge ${urls.length} URLs at Cloudflare` : 'no Cloudflare purge (the host is set to bypass cache; see docs/delivery.md). --purge to also do it');
step('then: node scripts/check-live.mjs --expect-version ' + version);

if (!PUBLISH) { console.log('\nDry run only. Nothing was changed.'); process.exit(0); }

git('tag', '-a', tag, '-m', `octopus-kit ${tag}`);
git('push', 'origin', tag);
try {
  git('push', 'origin', `${tag}^{commit}:refs/heads/${CHANNEL_BRANCH}`);
} catch (e) {
  die(`the tag was pushed, but ${CHANNEL_BRANCH} was NOT moved (${e.message}). It is not a fast-forward, or the branch is protected. Production still serves the previous release.`);
}
step(`pushed ${tag} and moved ${CHANNEL_BRANCH}`);

if (PURGE) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID}/purge_cache`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: urls }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.success) die(`Cloudflare purge failed (${res.status}): ${JSON.stringify(j.errors || j)}. The release itself is done.`);
  step('purged at Cloudflare');
}
console.log(`\nReleased ${tag}. Portainer polls; confirm with: node scripts/check-live.mjs --expect-version ${version}`);
