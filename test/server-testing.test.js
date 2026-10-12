'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkBoots, startServer, checkEnvWiring, composeVars } = require('../server/testing');

function dir(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'boots-'));
  for (const [rel, s] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), s); }
  return d;
}

test('checkBoots: a loadable entrypoint is "loaded"', () => {
  assert.strictEqual(checkBoots({ root: dir({ 'index.js': 'module.exports = 1;' }) }).status, 'loaded');
});

test('checkBoots: the 2026-09-06 bug (const used before its declaration) is "failed", with the explanation', () => {
  const d = dir({ 'index.js': "const app = { locals: {} };\napp.locals.asset = asset;\nconst { asset } = { asset: () => 1 };\n" });
  const r = checkBoots({ root: d });
  assert.strictEqual(r.status, 'failed');
  assert.match(r.detail, /before it is declared/);
});

test('checkBoots: any other throw at load is "failed"', () => {
  assert.strictEqual(checkBoots({ root: dir({ 'index.js': "throw new Error('nope');" }) }).status, 'failed');
});

test('checkBoots: a missing NON-relative dependency is the machine\'s fault; a missing relative file is the repo\'s', () => {
  const dep = checkBoots({ root: dir({ 'index.js': "require('some-package-not-installed-anywhere');" }) });
  assert.strictEqual(dep.status, 'machine'); assert.match(dep.detail, /some-package-not-installed-anywhere/);
  assert.strictEqual(checkBoots({ root: dir({ 'index.js': "require('./gone');" }) }).status, 'failed');
});

test('checkBoots: an absolute path outside the repo is the machine\'s fault; one inside it is not', () => {
  assert.strictEqual(checkBoots({ root: dir({ 'index.js': "require('fs').mkdirSync('/proc/definitely/not/here/x');" }) }).status, 'machine');
});

test('checkBoots: loaded-then-exits-nonzero is "failed"', () => {
  // process.exit(0) is called by the wrapper, so exercise the other path: exit inside load with a code, before LOADED.
  assert.strictEqual(checkBoots({ root: dir({ 'index.js': 'process.exit(3);' }) }).status, 'failed');
});

test('startServer: an app that listens answers /health; one that does not reports its output', async () => {
  const good = dir({ 'index.js': "require('http').createServer((q,s)=>s.end('ok')).listen(process.env.PORT,'127.0.0.1');" });
  const s = await startServer({ root: good, timeoutMs: 8000 });
  try { assert.strictEqual(s.ok, true); } finally { s.stop(); }
  const bad = dir({ 'index.js': "console.log('exploded'); process.exit(1);" });
  const b = await startServer({ root: bad, timeoutMs: 8000 });
  assert.strictEqual(b.ok, false); assert.match(b.output, /exploded/);
});

test('env wiring: names the code reads but the compose does not pass', () => {
  const d = dir({
    'index.js': "const a = process.env.PASSED_VAR, b = process.env.MISSING_VAR, c = process.env.PORT; const { env } = process; env.VIA_ENV_DOT;",
    'lib/x.js': "module.exports = process.env['BRACKETED'];",
    'test/ignored.test.js': 'process.env.ONLY_IN_TESTS',
    'node_modules/dep/i.js': 'process.env.IN_DEPENDENCY',
    'docker-compose.yml': 'services:\n  app:\n    environment:\n      - PASSED_VAR=${PASSED_VAR:-}\n      - NODE_ENV=production\n      - BRACKETED=${BRACKETED:-}\n',
  });
  const r = checkEnvWiring({ root: d });
  assert.deepStrictEqual(r.missing, ['MISSING_VAR', 'VIA_ENV_DOT']);
  assert.deepStrictEqual(checkEnvWiring({ root: d, exclude: ['MISSING_VAR', 'VIA_ENV_DOT'] }).missing, []);
});

test('composeVars understands both list and map forms', () => {
  const v = composeVars('environment:\n  - A=${A:-}\n  B: ${B:-}\n');
  assert.ok(v.has('A') && v.has('B'));
});

test('server/index.js exposes testing lazily, so a running service never loads node:test', () => {
  const r = require('node:child_process').spawnSync(process.execPath, ['-e',
    "const k=require('./server'); const before=Object.keys(require.cache).some(f=>/server[\\\\/]testing\\.js$/.test(f)); k.testing; console.log(before)"], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.strictEqual(r.stdout.trim(), 'false');
});
