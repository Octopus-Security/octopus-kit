'use strict';
/**
 * testing.js — the two tests every service in the estate carries.
 *
 * LOAD THIS ONLY FROM TESTS. It pulls in node:test; server/index.js exposes it
 * lazily so a running service never does.
 *
 *   bootsTest({ entry: 'index.js' })      // test/boots.test.js
 *   envWiringTest({ required: ['INTERNAL_SECRET'] })   // test/env-wiring.test.js
 *
 * bootsTest exists because of 2026-09-06: one line (`app.locals.asset = asset;`
 * above the `const { asset } = require('./build')` that declares it) threw at
 * MODULE LOAD and took two services down — a container that never starts, which
 * behind the proxy is a 502 on every route. Both repos were green, because every
 * test imported the pieces and none loaded the entrypoint.
 *
 * The check is a SUBPROCESS: loading the entrypoint in-process would bind a
 * port and leave a listener behind, and a throw during load is exactly what is
 * being detected, so it must not take the runner with it.
 *
 * Failures that are the MACHINE's fault are tolerated, narrowly (widening them
 * would make this a test that passes whatever happens): a non-relative module
 * that is not installed here, and an absolute path outside the repo.
 *
 * envWiringTest: a Portainer stack variable interpolates into the compose FILE;
 * it is not injected into the container. So a name the code reads but the compose
 * never passes is simply absent at runtime, however set the UI says it is.
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

/**
 * Load `entry` in a subprocess and classify the outcome.
 * -> { status: 'loaded'|'machine'|'failed', output, detail }
 *    'machine' = could not load for something this machine lacks (see above).
 */
function checkBoots({ entry = 'index.js', root = process.cwd(), env = {}, timeoutMs = 30000 } = {}) {
  const r = spawnSync(
    process.execPath,
    ['-e', `process.env.PORT='0'; require(${JSON.stringify(path.resolve(root, entry))}); console.log('LOADED'); process.exit(0);`],
    { cwd: root, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, PORT: '0', ...env } },
  );
  const output = `${r.stdout || ''}${r.stderr || ''}`;
  const excerpt = output.slice(0, 700);
  if (/before initialization/.test(output)) {
    return { status: 'failed', output, detail: `${entry} reads a const before it is declared. The container will not start and every route 502s — move the use below the require:\n${excerpt}` };
  }
  if (/LOADED/.test(output)) {
    return r.status === 0
      ? { status: 'loaded', output }
      : { status: 'failed', output, detail: `${entry} loaded then exited ${r.status}:\n${excerpt}` };
  }
  const missingDep = /Cannot find module '([^']+)'/.exec(output);
  if (missingDep && !missingDep[1].startsWith('.') && !path.isAbsolute(missingDep[1])) {
    return { status: 'machine', output, detail: `${missingDep[1]} is not installed on this machine` };
  }
  const fsDenied = /(?:EACCES|EPERM|EROFS|ENOENT)[^\n]*'(\/[^']*)'/.exec(output);
  if (fsDenied && !fsDenied[1].startsWith(path.resolve(root))) {
    return { status: 'machine', output, detail: `${fsDenied[1]} exists in the container, not in a checkout` };
  }
  return { status: 'failed', output, detail: `${entry} failed to load, and not for anything this machine is missing:\n${excerpt}` };
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/**
 * Start `entry` for real on a free port and wait until `path` answers.
 * -> { ok, port, output, stop() }. `stop()` must always be called.
 */
async function startServer({ entry = 'index.js', root = process.cwd(), env = {}, path: probe = '/health', timeoutMs = 30000 } = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [entry], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: String(port), ...env } });
  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });
  let exited = false; child.on('exit', () => { exited = true; });
  const stop = () => { try { child.kill('SIGKILL'); } catch { /* gone */ } };
  const until = Date.now() + timeoutMs;
  while (Date.now() < until && !exited) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${probe}`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return { ok: true, port, base: `http://127.0.0.1:${port}`, output, stop };
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  stop();
  return { ok: false, port, output, stop };
}

/** Registers the boots tests. Call at the top level of test/boots.test.js. */
function bootsTest({ entry = 'index.js', root = process.cwd(), env = {}, listen = false, path: probe = '/health', staticOrder } = {}) {
  const { test } = require('node:test');
  const assert = require('node:assert');
  test('the entrypoint loads, or fails only for something this machine lacks', () => {
    const r = checkBoots({ entry, root, env });
    if (r.status === 'machine') { console.log(`  (not loaded here: ${r.detail})`); return; }
    assert.strictEqual(r.status, 'loaded', r.detail);
  });
  if (listen) {
    test(`the entrypoint listens and answers ${probe}`, async (t) => {
      const s = await startServer({ entry, root, env, path: probe });
      t.after(s.stop);
      if (!s.ok && /Cannot find module '(?![./])/.test(s.output)) { t.skip('a dependency is not installed on this machine'); return; }
      assert.ok(s.ok, `${entry} did not answer ${probe}:\n${s.output.slice(0, 700) || '(no output)'}`);
    });
  }
  if (staticOrder) {
    // The same bug caught statically and by name: `use` must come after `declaration`.
    test(`${staticOrder.use} is used after the const that declares it`, () => {
      const src = fs.readFileSync(path.join(root, entry), 'utf8');
      const declared = src.search(staticOrder.declaration);
      const used = src.indexOf(staticOrder.use);
      assert.ok(declared >= 0, 'the declaration is gone');
      assert.ok(used >= 0, `${staticOrder.use} is gone`);
      assert.ok(declared < used, `${staticOrder.use} is used before the const that declares it — throws at module load`);
    });
  }
}

// ── env wiring ──────────────────────────────────────────────────────────────

const AMBIENT = ['NODE_ENV', 'PORT', 'HOME', 'PATH', 'TZ', 'PWD', 'HOSTNAME'];

/** Every process.env.X the app's own source reads. */
function envReads(root, { skipDirs = ['node_modules', '.git', 'test', 'tests', 'data'] } = {}) {
  const names = new Set();
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skipDirs.includes(e.name) || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(c|m)?js$/.test(e.name)) {
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
        for (const m of src.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
        for (const m of src.matchAll(/\benv\[['"]([A-Z][A-Z0-9_]*)['"]\]/g)) names.add(m[1]);
      }
    }
  })(root);
  return names;
}

/** Variables the compose passes through (`- NAME=…` or `NAME: …` under environment). */
function composeVars(composeText) {
  const names = new Set();
  for (const m of composeText.matchAll(/^\s*-\s*([A-Z][A-Z0-9_]*)=/gm)) names.add(m[1]);
  for (const m of composeText.matchAll(/^\s+([A-Z][A-Z0-9_]*):\s/gm)) names.add(m[1]);
  return names;
}

/** -> { missing: string[], found: number } */
function checkEnvWiring({ root = process.cwd(), compose = 'docker-compose.yml', ambient = [], exclude = [] } = {}) {
  const text = fs.readFileSync(path.resolve(root, compose), 'utf8');
  const passed = composeVars(text);
  const skip = new Set([...AMBIENT, ...ambient, ...exclude]);
  const reads = envReads(root);
  return { missing: [...reads].filter(n => !skip.has(n) && !passed.has(n)).sort(), found: reads.size, passed };
}

/** Registers the env-wiring tests. Call at the top level of test/env-wiring.test.js. */
function envWiringTest({ root = process.cwd(), compose = 'docker-compose.yml', ambient = [], exclude = [], required = [], minReads = 1 } = {}) {
  const { test } = require('node:test');
  const assert = require('node:assert');
  test('the scan finds something — it has not silently stopped matching', () => {
    const r = checkEnvWiring({ root, compose, ambient, exclude });
    assert.ok(r.found >= minReads, `only found ${r.found} env reads, which suggests the scan broke`);
  });
  test('every env var the code reads is passed through in docker-compose.yml', () => {
    const r = checkEnvWiring({ root, compose, ambient, exclude });
    assert.deepStrictEqual(r.missing, [],
      'read at runtime but never reaching the container — setting these in Portainer will look like it worked and do nothing');
  });
  for (const name of required) {
    test(`${name} is wired in docker-compose.yml`, () => {
      const r = checkEnvWiring({ root, compose, ambient, exclude });
      assert.ok(r.passed.has(name), `${name} is not passed through by the compose`);
    });
  }
}

module.exports = { checkBoots, startServer, bootsTest, envWiringTest, checkEnvWiring, envReads, composeVars };
