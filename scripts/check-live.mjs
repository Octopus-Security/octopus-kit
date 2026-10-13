#!/usr/bin/env node
// Ask the live kit host what it is serving.
//   node scripts/check-live.mjs [--expect-version 0.2.0] [--host kit.octopustechnology.net]
// Exit 1 if unreachable, if the version differs, or if Cloudflare is serving a cached copy
// (cf-cache-status HIT): the host is meant to bypass cache, so a HIT means the Cloudflare
// rule in docs/delivery.md is missing and releases will be stale for hours.
const args = process.argv.slice(2);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const host = val('--host', 'kit.octopustechnology.net');
const expect = val('--expect-version');
let bad = false;
const get = async (p) => { const r = await fetch(`https://${host}${p}`); return { r, body: await r.text() }; };
try {
  const { r: br, body: bb } = await get('/api/build');
  const { r: mr, body: mb } = await get('/v0/manifest.json');
  if (!br.ok || !mr.ok) throw new Error(`HTTP ${br.status} /api/build, ${mr.status} /v0/manifest.json`);
  const m = JSON.parse(mb);
  console.log(`build   ${bb.trim()}`);
  console.log(`channel ${m.channel} version ${m.version}, ${Object.keys(m.files).length} files`);
  const cache = mr.headers.get('cf-cache-status');
  console.log(`cf-cache-status: ${cache || '(none)'}  cache-control: ${mr.headers.get('cache-control')}`);
  if (cache === 'HIT' || cache === 'REVALIDATED') { console.error('PROBLEM: edge is caching the kit host. Add the bypass rule (docs/delivery.md).'); bad = true; }
  if (expect && m.version !== expect) { console.error(`PROBLEM: live is ${m.version}, expected ${expect} (Portainer may not have polled yet).`); bad = true; }
} catch (e) { console.error(`PROBLEM: ${e.message}`); bad = true; }
process.exit(bad ? 1 : 0);
