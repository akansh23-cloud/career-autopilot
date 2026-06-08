/* ============================================================
   AI provider — Anthropic (Messages API)
   ------------------------------------------------------------
   Implements a single complete(system, user, maxTokens) that
   returns text or null. Higher-level JSON shaping + fallback is
   handled by aiProvider.js, so this stays thin.
   ============================================================ */

async function postJSON(url, headers, body, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch { return null; } finally { clearTimeout(t); }
}

export function createAnthropicClient(cfg) {
  const key = cfg.anthropicKey;
  const model = cfg.aiModel || 'claude-sonnet-4-20250514';
  const timeoutMs = Math.max(cfg.timeoutMs || 0, 20000);
  return {
    name: 'anthropic',
    available: !!key,
    async complete(system, user, maxTokens = 1500) {
      if (!key) return null;
      const data = await postJSON(
        'https://api.anthropic.com/v1/messages',
        { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        { model, max_tokens: maxTokens, temperature: 0, system, messages: [{ role: 'user', content: user }] },
        timeoutMs,
      );
      if (!data) return null;
      return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n') || null;
    },
  };
}

export default { createAnthropicClient };
