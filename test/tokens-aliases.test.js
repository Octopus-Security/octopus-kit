'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'tokens', 'aliases');
const tokensCss = fs.readFileSync(path.join(__dirname, '..', 'tokens', 'tokens.css'), 'utf8');
const defined = new Set([...tokensCss.matchAll(/--o-([a-z0-9-]+):/g)].map((m) => m[1]));
const CLUSTERS = ['shopper', 'science', 'planner', 'cortex', 'edm', 'kitchen', 'code', 'ecom', 'blog', 'tools', 'dash'];
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

test('every cluster has an alias sheet, and budget/health deliberately have none', () => {
  for (const c of CLUSTERS) assert.ok(fs.existsSync(path.join(dir, c + '.css')), c);
  assert.ok(!fs.existsSync(path.join(dir, 'budget.css')));
  assert.ok(!fs.existsSync(path.join(dir, 'health.css')));
});

for (const c of CLUSTERS) {
  test(`aliases/${c}.css is one :root block that only points at defined --o-* tokens`, () => {
    const css = strip(fs.readFileSync(path.join(dir, c + '.css'), 'utf8'));
    assert.equal((css.match(/\{/g) || []).length, 1, 'exactly one rule');
    assert.match(css.trim(), /^:root\s*\{[\s\S]*\}$/);
    const body = css.slice(css.indexOf('{') + 1, css.lastIndexOf('}'));
    const decls = body.split(';').map((s) => s.trim()).filter(Boolean);
    assert.ok(decls.length >= 5, 'has declarations');
    for (const d of decls) {
      const m = /^(--[a-z0-9-]+)\s*:\s*([\s\S]+)$/.exec(d);
      assert.ok(m, 'declaration: ' + d);
      assert.ok(!m[1].startsWith('--o-'), 'alias sheets must not redefine kit tokens: ' + m[1]);
    }
    for (const m of css.matchAll(/var\(--o-([a-z0-9-]+)/g)) {
      assert.ok(defined.has(m[1]), `${c}: --o-${m[1]} is not defined`);
    }
    // No stray references to the app's own names that would loop (--x: var(--x)).
    for (const d of decls) {
      const [, name, val] = /^(--[a-z0-9-]+)\s*:\s*([\s\S]+)$/.exec(d);
      assert.ok(!new RegExp(`var\\(${name}[,)]`).test(val), 'self-reference: ' + name);
    }
  });
}

test('alias sheets use the colour literals only inside light-dark() pairs or data colours', () => {
  for (const c of CLUSTERS) {
    const css = strip(fs.readFileSync(path.join(dir, c + '.css'), 'utf8'));
    for (const line of css.split('\n')) {
      if (!/#[0-9a-fA-F]{6}\b/.test(line)) continue;
      const ok = /light-dark\(/.test(line) || /--(track|tok)-/.test(line);
      assert.ok(ok, `${c}: literal colour outside light-dark()/data colour: ${line.trim()}`);
    }
  }
});
