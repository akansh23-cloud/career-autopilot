/* ============================================================
   AI provider — Google Gemini (generateContent REST)
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

export function createGeminiClient(cfg) {
  const key = cfg.geminiKey;
  const model = cfg.aiModel || 'gemini-1.5-flash';
  const timeoutMs = Math.max(cfg.timeoutMs || 0, 20000);
  return {
    name: 'gemini',
    available: !!key,
    async complete(system, user, maxTokens = 1500) {
      if (!key) return null;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
      const data = await postJSON(
        url,
        { 'Content-Type': 'application/json' },
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0, maxOutputTokens: maxTokens },
        },
        timeoutMs,
      );
      if (!data) return null;
      const parts = data?.candidates?.[0]?.content?.parts || [];
      return parts.map((p) => p?.text || '').join('\n') || null;
    },
  };
}

export default { createGeminiClient };
