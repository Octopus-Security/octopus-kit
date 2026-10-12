'use strict';
// Ported from octopus-budget's test/layout.test.js (branch customizable-dashboard) as the spec,
// with the budget-specific registry replaced by a generic one, plus the module layer from
// octopus-business/server/modules.js.
const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../server/layout');
const { fakeRes, run, silent } = require('./helpers');

const REG = [
  { key: 'subscriptions', title: 'Subscriptions', icon: 'S' },
  { key: 'debts', title: 'Debts', icon: 'D' },
  { key: 'installments', title: 'Installment Plans' },
  { key: 'accounts', title: 'Accounts' },
  { key: 'income', title: 'Income' },
  { key: 'credit_scores', title: 'Credit Scores' },
  { key: 'transactions', title: 'Transactions' },
  { key: 'netWorth', title: 'Net Worth', defaultHidden: true },
];
const keys = items => items.map(i => i.key);

test('defaults with no prefs: registry order, default titles, nothing hidden (except defaultHidden)', () => {
  const s = L.resolve(REG, []);
  assert.deepStrictEqual(keys(s), keys(REG));
  assert.ok(s.every(x => !x.customTitle && x.title === x.defaultTitle));
  assert.deepStrictEqual(s.filter(x => x.hidden).map(x => x.key), ['netWorth']);
  assert.deepStrictEqual(s.map(x => x.position), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.strictEqual(L.resolve(REG, null).length, 8);
  assert.strictEqual(L.resolve(REG, undefined).length, 8);
});

test('registry extras ride along on the resolved item', () => {
  assert.strictEqual(L.resolve(REG, [])[0].icon, 'S');
});

test('prefs override title, order and hidden', () => {
  const s = L.resolve(REG, [
    { key: 'debts', title: 'Cards', position: 0, hidden: false },
    { key: 'subscriptions', title: null, position: 1, hidden: true },
  ]);
  assert.deepStrictEqual(keys(s).slice(0, 2), ['debts', 'subscriptions']);
  assert.strictEqual(s[0].title, 'Cards');
  assert.strictEqual(s[0].customTitle, true);
  assert.strictEqual(s[0].defaultTitle, 'Debts');
  assert.strictEqual(s[1].title, 'Subscriptions', 'null title falls back to default');
  assert.strictEqual(s[1].hidden, true);
});

test('prefs can be an object map keyed by item key, and may use `label`', () => {
  const s = L.resolve(REG, { debts: { label: 'Cards', position: 0 } });
  assert.strictEqual(s[0].key, 'debts'); assert.strictEqual(s[0].title, 'Cards');
});

test('a pref can reveal a defaultHidden item; unknown keys are ignored', () => {
  const s = L.resolve(REG, [{ key: 'netWorth', hidden: false, position: 0 }, { key: 'bogus', hidden: true, position: 0 }]);
  assert.strictEqual(s[0].key, 'netWorth'); assert.strictEqual(s[0].hidden, false);
  assert.ok(!keys(s).includes('bogus'));
  assert.strictEqual(s.length, 8);
});

test('an item with no pref still appears, after the ones that have a saved position', () => {
  const s = L.resolve(REG, [{ key: 'income', position: 0 }, { key: 'accounts', position: 1 }]);
  assert.deepStrictEqual(keys(s).slice(0, 2), ['income', 'accounts']);
  assert.deepStrictEqual(keys(s).slice(2), ['subscriptions', 'debts', 'installments', 'credit_scores', 'transactions', 'netWorth']);
});

test('custom items are merged in by position and use custom:<id> keys', () => {
  const prefs = REG.map((x, i) => ({ key: x.key, position: i < 2 ? i : i + 1 }));
  const s = L.resolve(REG, prefs, { custom: [{ id: 4, title: 'Pets', position: 2, hidden: false }] });
  assert.strictEqual(s[2].key, 'custom:4'); assert.strictEqual(s[2].builtin, false); assert.strictEqual(s[2].id, 4);
  assert.strictEqual(L.parseCustomKey('custom:4'), 4);
  assert.strictEqual(L.parseCustomKey('custom:x'), null);
  assert.strictEqual(L.parseCustomKey('custom:1; DROP'), null);
});

test('a locked item can never be hidden, by prefs or by input', () => {
  const reg = [{ key: 'home', title: 'Home', locked: true }, { key: 'x', title: 'X' }];
  assert.strictEqual(L.resolve(reg, [{ key: 'home', hidden: true }])[0].hidden, false);
  assert.strictEqual(L.normalisePrefs(reg, [{ key: 'home', hidden: true }])[0].hidden, false);
});

test('move up/down swaps neighbours and renormalises positions', () => {
  const s = L.resolve(REG, []);
  const down = L.moveItem(s, 'subscriptions', +1);
  assert.deepStrictEqual(keys(down).slice(0, 2), ['debts', 'subscriptions']);
  assert.deepStrictEqual(down.map(x => x.position), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepStrictEqual(keys(L.moveItem(down, 'subscriptions', -1)), keys(s));
});

test('move at the edges is a no-op, and an unknown key changes nothing', () => {
  const s = L.resolve(REG, []);
  assert.deepStrictEqual(keys(L.moveItem(s, 'subscriptions', -1)), keys(s));
  assert.deepStrictEqual(keys(L.moveItem(s, 'netWorth', +1)), keys(s));
  assert.deepStrictEqual(keys(L.moveItem(s, 'nope', +1)), keys(s));
});

test('moveItem does not mutate its input', () => {
  const s = L.resolve(REG, []);
  const before = JSON.stringify(s);
  L.moveItem(s, 'debts', -1);
  assert.strictEqual(JSON.stringify(s), before);
});

test('orderItems repairs gaps and duplicate positions', () => {
  const out = L.orderItems([{ key: 'a', position: 10, seq: 0 }, { key: 'b', position: 10, seq: 1 }, { key: 'c', position: 3, seq: 2 }]);
  assert.deepStrictEqual(keys(out), ['c', 'a', 'b']);
  assert.deepStrictEqual(out.map(x => x.position), [0, 1, 2]);
  assert.ok(out.every(x => !('seq' in x)));
});

test('normalise renumbers in the current order', () => {
  assert.deepStrictEqual(L.normalise([{ key: 'a', position: 9 }, { key: 'b', position: 2 }]).map(x => x.position), [0, 1]);
  assert.deepStrictEqual(L.normalise(undefined), []);
});

test('cleanLabel trims, caps at 60 and rejects blanks / non-strings; strips control characters', () => {
  assert.strictEqual(L.cleanLabel('  Hi  '), 'Hi');
  assert.strictEqual(L.cleanLabel('x'.repeat(100)).length, 60);
  assert.strictEqual(L.cleanLabel('x'.repeat(100), 10).length, 10);
  assert.strictEqual(L.cleanLabel('   '), null);
  assert.strictEqual(L.cleanLabel(5), null);
  assert.strictEqual(L.cleanLabel(null), null);
  assert.strictEqual(L.cleanLabel('a\u0000b\nc'), 'a b c');
});

test('normalisePrefs: drops unknown and duplicate keys, cleans labels, coerces hidden, orders by input', () => {
  const out = L.normalisePrefs(REG, [
    { key: 'debts', title: '  Cards  ', hidden: 'true' },
    { key: 'bogus', title: 'x' },
    { key: 'debts', title: 'dupe' },
    { key: 'income', title: 5, hidden: 'yes' },
    { key: 'custom:3', title: 'mine' },
    'not an object', null,
  ]);
  assert.deepStrictEqual(out, [
    { key: 'debts', title: 'Cards', hidden: true, position: 0 },
    { key: 'income', title: null, hidden: false, position: 1 },
  ]);
  assert.strictEqual(L.normalisePrefs(REG, [{ key: 'custom:3', title: 'mine' }], { allowCustom: true })[0].key, 'custom:3');
  assert.deepStrictEqual(L.normalisePrefs(REG, 'garbage'), []);
  assert.deepStrictEqual(L.normalisePrefs(REG, { __proto__: null }), []);
});

// ── modules (octopus-business/server/modules.js) ───────────────────────────

const MODS = [
  { key: 'dashboard', label: 'Dashboard', path: '/', sort: 0, locked: true },
  { key: 'reminders', label: 'Reminders', path: '/reminders', sort: 1 },
  { key: 'ledger', label: 'Ledger', path: '/ledger', sort: 4 },
  { key: 'beta', label: 'Beta', path: '/beta', sort: 5, defaultEnabled: false },
  { key: 'settings', label: 'Settings', path: '/settings', sort: 99, locked: true },
];

test('modules: defaults follow the registry, a locked module is always enabled', () => {
  const m = L.resolveModules(MODS, []);
  assert.deepStrictEqual(keys(m), ['dashboard', 'reminders', 'ledger', 'beta', 'settings']);
  assert.deepStrictEqual(m.map(x => x.enabled), [true, true, true, false, true]);
  const off = L.resolveModules(MODS, [{ key: 'dashboard', enabled: false }, { key: 'ledger', enabled: false }, { key: 'beta', enabled: true }]);
  assert.strictEqual(off.find(x => x.key === 'dashboard').enabled, true, 'locked');
  assert.strictEqual(off.find(x => x.key === 'ledger').enabled, false);
  assert.strictEqual(off.find(x => x.key === 'beta').enabled, true);
});

test('modules: rename keeps the default label available', () => {
  const m = L.resolveModules(MODS, [{ key: 'ledger', label: 'Books' }]).find(x => x.key === 'ledger');
  assert.strictEqual(m.label, 'Books'); assert.strictEqual(m.defaultLabel, 'Ledger');
  assert.strictEqual(L.resolveModules(MODS, [{ key: 'ledger', label: '  ' }]).find(x => x.key === 'ledger').label, 'Ledger');
});

test('modules: normaliseModulePrefs reads business\'s flat form body (absent checkbox = off) and a list', () => {
  const rows = L.normaliseModulePrefs(MODS, { label_ledger: ' Books ', enabled_reminders: 'on', enabled_dashboard: undefined });
  assert.deepStrictEqual(rows.find(r => r.key === 'ledger'), { key: 'ledger', label: 'Books', enabled: false, position: 2 });
  assert.strictEqual(rows.find(r => r.key === 'reminders').enabled, true);
  assert.strictEqual(rows.find(r => r.key === 'dashboard').enabled, true, 'locked stays on');
  const long = L.normaliseModulePrefs(MODS, { label_ledger: 'x'.repeat(100) });
  assert.strictEqual(long.find(r => r.key === 'ledger').label.length, 40);
  const fromList = L.normaliseModulePrefs(MODS, [{ key: 'ledger', enabled: false }]);
  assert.strictEqual(fromList.find(r => r.key === 'ledger').enabled, false);
  assert.strictEqual(fromList.find(r => r.key === 'reminders').enabled, true);
});

test('moduleGate: a disabled module 404s (page and API), an enabled one passes', async () => {
  const prefs = [{ key: 'ledger', enabled: false }];
  const off = L.moduleGate({ registry: MODS, key: 'ledger', load: async () => prefs });
  const page = await run(off, { originalUrl: '/ledger' });
  assert.strictEqual(page.nexted, false); assert.strictEqual(page.res.code, 404);
  const api = await run(off, { originalUrl: '/api/ledger' });
  assert.deepStrictEqual(api.res.body, { error: 'Not found' });
  const on = L.moduleGate({ registry: MODS, key: 'reminders', load: () => prefs });
  assert.strictEqual((await run(on, { originalUrl: '/reminders' })).nexted, true);
  const locked = L.moduleGate({ registry: MODS, key: 'settings', load: () => [{ key: 'settings', enabled: false }] });
  assert.strictEqual((await run(locked, { originalUrl: '/settings' })).nexted, true);
});

test('moduleGate: unknown key 404s; a failing load falls back to defaults; onDisabled customises', async () => {
  assert.strictEqual((await run(L.moduleGate({ registry: MODS, key: 'ghost', load: () => [] }), { originalUrl: '/g' })).res.code, 404);
  const failing = L.moduleGate({ registry: MODS, key: 'ledger', load: () => { throw new Error('db down'); }, log: silent });
  assert.strictEqual((await run(failing, { originalUrl: '/ledger' })).nexted, true, 'a prefs outage must not take a module offline');
  const custom = L.moduleGate({ registry: MODS, key: 'ledger', load: () => [{ key: 'ledger', enabled: false }], onDisabled: (req, res) => res.status(404).send('custom') });
  assert.strictEqual((await run(custom, { originalUrl: '/ledger' })).res.body, 'custom');
});

test('moduleGate.fastify', async () => {
  const gate = L.moduleGate({ registry: MODS, key: 'ledger', load: () => [{ key: 'ledger', enabled: false }] });
  const reply = { code(c) { reply.c = c; return reply; }, send(b) { reply.b = b; } };
  await gate.fastify({}, reply);
  assert.strictEqual(reply.c, 404);
});
