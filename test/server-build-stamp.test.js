'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBuildStamp } = require('../server/build-stamp');

function app() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
  const w = (rel, s) => { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), s); };
  w('index.js', 'module.exports = 1;');
  w('views/a.ejs', '<p>a</p>');
  w('public/app.css', 'body{color:red}');
  w('public/js/a.js', 'export const a = 1;');
  w('public/js/b.mjs', 'import "./a.js";');
  w('data/live.json', '{}');
  w('test/t.test.js', '//');
  w('node_modules/x/index.js', '//');
  w('package-lock.json', '{}');
  return { d, w };
}

test('the stamp is a real hash, not the failure value', () => {
  const { d } = app();
  const s = createBuildStamp({ service: 's', roots: [d] });
  assert.match(s.build, /^[0-9a-f]{12}$/);
  assert.notStrictEqual(s.build, 'unknown');
  assert.match(s.startedAt, /^\d{4}-\d\d-\d\dT/);
});

test('it is derived from the files: editing code or a template moves it', () => {
  const { d, w } = app();
  const before = createBuildStamp({ service: 's', roots: [d] }).build;
  w('index.js', 'module.exports = 2;');
  const code = createBuildStamp({ service: 's', roots: [d] }).build;
  assert.notStrictEqual(code, before);
  w('views/a.ejs', '<p>changed</p>');
  assert.notStrictEqual(createBuildStamp({ service: 's', roots: [d] }).build, code);
});

test('a NEW file is picked up by discovery, with no list to edit', () => {
  const { d, w } = app();
  const before = createBuildStamp({ service: 's', roots: [d] });
  w('lib/new.js', 'x');
  const after = createBuildStamp({ service: 's', roots: [d] });
  assert.ok(after.files().includes('lib/new.js'));
  assert.notStrictEqual(after.build, before.build);
});

test('dependencies, live data, tests and the lockfile do not move it', () => {
  const { d, w } = app();
  const before = createBuildStamp({ service: 's', roots: [d] });
  w('data/live.json', '{"changed":true}');
  w('test/t.test.js', '// changed');
  w('node_modules/x/index.js', '// changed');
  w('package-lock.json', '{"changed":1}');
  const after = createBuildStamp({ service: 's', roots: [d] });
  assert.strictEqual(after.build, before.build);
  const files = after.files();
  assert.ok(!files.some(f => /^(data|test|node_modules)\//.test(f)) && !files.includes('package-lock.json'));
});

test('exclude leaves a path out', () => {
  const { d, w } = app();
  const a = createBuildStamp({ service: 's', roots: [d], exclude: ['public/js'] });
  assert.ok(!a.files().some(f => f.startsWith('public/js/')));
  w('public/js/a.js', 'export const a = 2;');
  assert.strictEqual(createBuildStamp({ service: 's', roots: [d], exclude: ['public/js'] }).build, a.build);
});

test('failure is the literal "unknown", never hash-shaped', () => {
  const s = createBuildStamp({ service: 's', roots: [path.join(os.tmpdir(), 'does-not-exist-' + Date.now())] });
  assert.strictEqual(s.build, 'unknown');
  assert.doesNotMatch(s.build, /^[0-9a-f]{12}$/);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
  assert.strictEqual(createBuildStamp({ service: 's', roots: [empty] }).build, 'unknown');
});

test('asset(): a per-file content hash, changing only when that file does', () => {
  const { d, w } = app();
  const s = createBuildStamp({ service: 's', roots: [d] });
  const a = s.asset('/app.css');
  assert.match(a, /^\/app\.css\?v=[0-9a-f]{8}$/);
  assert.strictEqual(s.asset('/app.css'), a, 'cached');
  w('index.js', 'module.exports = 3;'); // BUILD moves, the asset must not
  assert.strictEqual(createBuildStamp({ service: 's', roots: [d] }).asset('/app.css'), a);
  w('public/app.css', 'body{color:blue}');
  assert.notStrictEqual(createBuildStamp({ service: 's', roots: [d] }).asset('/app.css'), a);
});

test('asset(): unreadable or escaping paths come back bare, never throwing', () => {
  const { d } = app();
  const s = createBuildStamp({ service: 's', roots: [d] });
  assert.strictEqual(s.asset('/missing.css'), '/missing.css');
  assert.strictEqual(s.asset('/../index.js'), '/../index.js', 'must not read outside public/');
  assert.strictEqual(s.asset('/../../etc/passwd'), '/../../etc/passwd');
});

test('dirVersioned: /js/ is versioned by directory so the import graph is covered, and stripDirVersion undoes it', () => {
  const { d, w } = app();
  const s = createBuildStamp({ service: 's', roots: [d], dirVersioned: ['/js/'] });
  const u = s.asset('/js/a.js');
  assert.match(u, /^\/js\/[0-9a-f]{8}\/a\.js$/);
  assert.strictEqual(s.asset('/js/b.mjs').split('/')[2], u.split('/')[2], 'siblings share one prefix');
  assert.strictEqual(s.stripDirVersion(u), '/js/a.js');
  assert.strictEqual(s.stripDirVersion('/js/a.js'), '/js/a.js');
  w('public/js/b.mjs', 'import "./a.js"; // changed');
  assert.notStrictEqual(createBuildStamp({ service: 's', roots: [d], dirVersioned: ['/js/'] }).asset('/js/a.js'), u);
  assert.match(s.asset('/app.css'), /\?v=/, 'other assets still use the query form');
});

test('clientDirs reports a separate client stamp (ee/science)', () => {
  const { d, w } = app();
  const a = createBuildStamp({ service: 's', roots: [d], clientDirs: ['public'] });
  assert.match(a.client, /^[0-9a-f]{12}$/);
  w('index.js', 'module.exports = 9;');
  const b = createBuildStamp({ service: 's', roots: [d], clientDirs: ['public'] });
  assert.strictEqual(b.client, a.client, 'a server-only change does not move the client stamp');
  assert.notStrictEqual(b.build, a.build);
  assert.ok('client' in b.info());
});
