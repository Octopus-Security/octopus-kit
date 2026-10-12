'use strict';
/**
 * llm.js — model calls built on the suite, with a provider ladder.
 *
 * Replaces the llm.js copies in shopper, author and math. Those THROW when
 * cortex is not configured or reachable, taking a whole feature (and sometimes
 * the route) down. This one returns { ok: false, reason } and lets the caller
 * hide the button, following octopus-ecom's ladder:
 *
 *   cortex  (configured in the suite, billed by cortex to the signed-in account)
 *   -> byok (an OpenAI-compatible endpoint the OWNER configured: LLM_BASE_URL,
 *            LLM_API_KEY, LLM_MODEL — nothing is defaulted)
 *   -> stub (only when asked for: `stub: true` or LLM_PROVIDER=stub — an offline
 *            canned reply for development)
 *   -> { ok: false, reason: 'not-configured' }
 *
 * The FIRST configured rung is used; the ladder is not walked on failure (a
 * cortex outage must not silently move requests onto the owner's own key).
 * `LLM_PROVIDER` (cortex|byok|stub) pins a rung; if it is not configured the
 * result is not-configured rather than a different bill.
 *
 * Cortex bills the account in `user`, so a cortex call with no user is refused
 * ('no-user') rather than billed to nobody/the owner. A 402 from cortex (no key
 * and no credits) is reason 'payment-required', not a fault.
 */

const TIERS_NOTE = 'alias is a cortex model alias or tier (cheap|standard|deep|auto), passed through unchanged';

function createLlm({
  suite, service = 'cortex', context = 'app', alias = 'haiku', timeoutMs = 120000,
  byok, stub = false, env = process.env, fetchImpl,
} = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const pinned = String(env.LLM_PROVIDER || '').trim().toLowerCase();

  function byokCfg() {
    const c = byok || {};
    const baseUrl = String(c.baseUrl || env.LLM_BASE_URL || '').trim().replace(/\/+$/, '');
    const apiKey = String(c.apiKey || env.LLM_API_KEY || '');
    const model = String(c.model || env.LLM_MODEL || '').trim();
    if (!baseUrl || !model) return null;
    try { const u = new URL(baseUrl); if (!/^https?:$/.test(u.protocol)) return null; } catch { return null; }
    return { baseUrl, apiKey, model };
  }

  function rungs() {
    const out = [];
    if (suite && suite.has(service)) out.push('cortex');
    if (byokCfg()) out.push('byok');
    if (stub || pinned === 'stub') out.push('stub');
    return pinned ? out.filter(r => r === pinned) : out;
  }

  /** Which provider a call would use right now (sync; does not probe). */
  function provider() { return rungs()[0] || null; }

  /** Is there any provider a call could use? Probes cortex if it is first. */
  async function available() {
    const rs = rungs();
    if (!rs.length) return false;
    if (rs[0] === 'cortex') return suite.available(service);
    return true;
  }

  async function viaCortex({ messages, system, user, alias: a, maxTokens, timeoutMs: t, context: ctx }) {
    if (!user) return { ok: false, reason: 'no-user', message: 'Sign in to use this.' };
    const r = await suite.call(service, '/api/internal/llm', {
      method: 'POST', timeoutMs: t || timeoutMs,
      body: { username: user, alias: a || alias, system, messages, maxTokens, context: ctx || context },
    });
    if (r.ok) {
      const text = r.data && typeof r.data === 'object' ? (r.data.reply || '') : '';
      return { ok: true, text, provider: 'cortex', model: (r.data && r.data.model) || null };
    }
    const msg = r.data && typeof r.data === 'object' && r.data.error ? String(r.data.error) : undefined;
    if (r.reason === 'http' && r.status === 402) return { ok: false, reason: 'payment-required', status: 402, message: msg || 'No API key or credits.' };
    return { ok: false, reason: r.reason, ...(r.status ? { status: r.status } : {}), ...(msg ? { message: msg } : {}) };
  }

  async function viaByok({ messages, system, maxTokens, timeoutMs: t }) {
    const c = byokCfg();
    const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
    let res;
    try {
      res = await doFetch(`${c.baseUrl}/chat/completions`, {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/json', ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) },
        body: JSON.stringify({ model: c.model, messages: msgs, ...(maxTokens ? { max_tokens: maxTokens } : {}) }),
        signal: AbortSignal.timeout(t || timeoutMs),
      });
    } catch (err) {
      const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
      return { ok: false, reason: timedOut ? 'timeout' : 'unreachable' };
    }
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    if (!res.ok) return { ok: false, reason: 'http', status: res.status };
    const text = data && data.choices && data.choices[0] && data.choices[0].message ? String(data.choices[0].message.content || '') : '';
    return { ok: true, text, provider: 'byok', model: c.model };
  }

  /**
   * @param {object} a
   * @param {{role:string,content:string}[]} a.messages
   * @param {string} [a.system]
   * @param {string} [a.user]  the signed-in account to bill — req.user.username, never browser input
   * @returns {Promise<{ok:true,text:string,provider:string,model:string|null}|{ok:false,reason:string,status?:number,message?:string}>}
   */
  async function complete(a = {}) {
    try {
      if (!Array.isArray(a.messages) || !a.messages.length) return { ok: false, reason: 'bad-request', message: 'messages required' };
      const rs = rungs();
      if (!rs.length) return { ok: false, reason: 'not-configured' };
      // The FIRST configured rung is used and the ladder is not walked on failure:
      // a cortex outage silently moving the request onto the owner's own API key
      // would be a bill nobody chose.
      const r = rs[0];
      if (r === 'stub') {
        const lastMsg = a.messages[a.messages.length - 1].content;
        return { ok: true, text: `[stub] No model is connected. You said: ${String(lastMsg).slice(0, 120)}`, provider: 'stub', model: 'stub' };
      }
      return r === 'cortex' ? await viaCortex(a) : await viaByok(a);
    } catch (err) {
      return { ok: false, reason: 'error', message: String((err && err.message) || err) };
    }
  }

  function describe() { return { provider: provider(), ladder: rungs(), note: TIERS_NOTE }; }

  return { available, complete, provider, describe };
}

module.exports = { createLlm };
