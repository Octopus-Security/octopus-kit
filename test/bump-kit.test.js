'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../scripts/bump-kit.mjs');

test('rewriteDep handles tarball and github: forms and leaves other deps alone', async () => {
  const { rewriteDep, currentTag, TARBALL } = await load();
  const a = '{"dependencies":{"express":"^4","octopus-kit":"https://codeload.github.com/Octopus-Security/octopus-kit/tar.gz/refs/tags/v0.1.0"}}';
  const out = rewriteDep(a, 'v0.2.0');
  assert.ok(out.includes(TARBALL('v0.2.0')) && out.includes('"express":"^4"'));
  assert.equal(currentTag(a), 'v0.1.0');
  const b = '{"dependencies":{"octopus-kit": "github:Octopus-Security/octopus-kit#v0.1.0"}}';
  assert.ok(rewriteDep(b, 'v0.2.0').includes('codeload.github.com'));
  assert.equal(rewriteDep('{"dependencies":{"express":"^4"}}', 'v0.2.0'), null);
});
