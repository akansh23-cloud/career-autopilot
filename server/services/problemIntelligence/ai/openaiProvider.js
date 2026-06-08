/* ============================================================
   AI provider — OpenAI-compatible (Chat Completions)
   ------------------------------------------------------------
   Works against api.openai.com or any OpenAI-compatible endpoint
   via OPENAI_BASE_URL (e.g. self-hosted / proxy gateways).
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

export function createOpenAIClient(cfg) {
  const key = cfg.openaiKey;
  const base = (cfg.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = cfg.aiModel || 'gpt-4o-mini';
  const timeoutMs = Math.max(cfg.timeoutMs || 0, 20000);
  return {
    name: 'openai',
    available: !!key,
    async complete(system, user, maxTokens = 1500) {
      if (!key) return null;
      const data = await postJSON(
        `${base}/chat/completions`,
        { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        {
          model, max_tokens: maxTokens, temperature: 0,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        },
        timeoutMs,
      );
      if (!data) return null;
      return data?.choices?.[0]?.message?.content || null;
    },
  };
}

export default { createOpenAIClient };
