'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createSuite } = require('../server/suite');
const { createLlm } = require('../server/llm');
const { stub, json } = require('./helpers');

const mkSuite = env => createSuite({ services: { cortex: { urlEnv: 'CORTEX_URL', secretEnv: 'INTERNAL_SECRET' } }, env });
const MSGS = [{ role: 'user', content: 'hi' }];

test('cortex absent: complete() RETURNS not-configured instead of throwing; available() is false', async () => {
  const llm = createLlm({ suite: mkSuite({}), env: {} });
  assert.strictEqual(await llm.available(), false);
  assert.strictEqual(llm.provider(), null);
  assert.deepStrictEqual(await llm.complete({ messages: MSGS, user: 'sam' }), { ok: false, reason: 'not-configured' });
});

test('cortex: posts the billing payload to /api/internal/llm and returns the reply', async () => {
  const s = await stub((req, res) => json(res, 200, { reply: 'hello back', model: 'm1' }));
  try {
    const env = { CORTEX_URL: s.url, INTERNAL_SECRET: 'k' };
    const llm = createLlm({ suite: mkSuite(env), env, context: 'shopper', alias: 'haiku' });
    assert.strictEqual(await llm.available(), true);
    const r = await llm.complete({ messages: MSGS, system: 'be brief', user: 'sam', maxTokens: 50 });
    assert.deepStrictEqual(r, { ok: true, text: 'hello back', provider: 'cortex', model: 'm1' });
    const hit = s.hits.find(h => h.url === '/api/internal/llm');
    assert.strictEqual(hit.headers['x-internal-secret'], 'k');
    assert.deepStrictEqual(JSON.parse(hit.body), { username: 'sam', alias: 'haiku', system: 'be brief', messages: MSGS, maxTokens: 50, context: 'shopper' });
  } finally { await s.close(); }
});

test('cortex: no user is refused (never billed to nobody); 402 is payment-required, not a fault', async () => {
  const s = await stub((req, res) => json(res, 402, { error: 'No API key or credits.' }));
  try {
    const env = { CORTEX_URL: s.url, INTERNAL_SECRET: 'k' };
    const llm = createLlm({ suite: mkSuite(env), env });
    assert.strictEqual((await llm.complete({ messages: MSGS })).reason, 'no-user');
    const r = await llm.complete({ messages: MSGS, user: 'sam' });
    assert.deepStrictEqual([r.ok, r.reason, r.status], [false, 'payment-required', 402]);
    assert.match(r.message, /credits/);
  } finally { await s.close(); }
});

test('cortex down: unreachable is returned, and the ladder does NOT slide onto the owner BYOK key', async () => {
  const byokHits = await stub((req, res) => json(res, 200, { choices: [{ message: { content: 'from byok' } }] }));
  try {
    const env = { CORTEX_URL: 'http://127.0.0.1:1', INTERNAL_SECRET: 'k', LLM_BASE_URL: byokHits.url, LLM_MODEL: 'm', LLM_API_KEY: 'owner-key' };
    const llm = createLlm({ suite: mkSuite(env), env });
    const r = await llm.complete({ messages: MSGS, user: 'sam' });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'unreachable');
    assert.strictEqual(byokHits.hits.length, 0);
  } finally { await byokHits.close(); }
});

test('BYOK rung when cortex is not configured: OpenAI-compatible, key sent as a bearer', async () => {
  const s = await stub((req, res) => json(res, 200, { choices: [{ message: { content: 'from byok' } }] }));
  try {
    const env = { LLM_BASE_URL: s.url + '/v1/', LLM_MODEL: 'tiny', LLM_API_KEY: 'sk-test' };
    const llm = createLlm({ suite: mkSuite(env), env });
    assert.strictEqual(llm.provider(), 'byok');
    const r = await llm.complete({ messages: MSGS, system: 'sys' });
    assert.deepStrictEqual(r, { ok: true, text: 'from byok', provider: 'byok', model: 'tiny' });
    assert.strictEqual(s.hits[0].url, '/v1/chat/completions');
    assert.strictEqual(s.hits[0].headers.authorization, 'Bearer sk-test');
    assert.strictEqual(JSON.parse(s.hits[0].body).messages[0].role, 'system');
  } finally { await s.close(); }
});

test('BYOK needs a base URL AND a model; nothing is defaulted', () => {
  assert.strictEqual(createLlm({ suite: mkSuite({}), env: { LLM_BASE_URL: 'http://127.0.0.1:1' } }).provider(), null);
  assert.strictEqual(createLlm({ suite: mkSuite({}), env: { LLM_MODEL: 'm' } }).provider(), null);
});

test('stub rung only when asked for', async () => {
  assert.strictEqual(createLlm({ suite: mkSuite({}), env: {} }).provider(), null);
  const llm = createLlm({ suite: mkSuite({}), env: {}, stub: true });
  const r = await llm.complete({ messages: MSGS });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.provider, 'stub'); assert.match(r.text, /^\[stub\]/);
  assert.strictEqual(createLlm({ suite: mkSuite({}), env: { LLM_PROVIDER: 'stub' } }).provider(), 'stub');
});

test('LLM_PROVIDER pins a rung; a pinned rung that is not configured does not fall to another bill', async () => {
  const env = { LLM_PROVIDER: 'cortex', LLM_BASE_URL: 'http://127.0.0.1:1', LLM_MODEL: 'm' };
  const llm = createLlm({ suite: mkSuite(env), env });
  assert.strictEqual(llm.provider(), null);
  assert.strictEqual((await llm.complete({ messages: MSGS })).reason, 'not-configured');
});

test('bad requests are returned, not thrown', async () => {
  const llm = createLlm({ suite: mkSuite({}), env: {}, stub: true });
  assert.strictEqual((await llm.complete({})).reason, 'bad-request');
  assert.strictEqual((await llm.complete({ messages: [] })).reason, 'bad-request');
  assert.strictEqual((await llm.complete()).reason, 'bad-request');
});
