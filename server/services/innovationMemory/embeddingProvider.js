/* ============================================================
   Innovation memory — embedding provider
   ------------------------------------------------------------
   Returns real embeddings ONLY when an embedding provider + key
   are configured AND vector search is enabled. Otherwise returns
   null vectors, and the retrieval layer transparently falls back
   to deterministic keyword similarity. Never throws, never blocks
   the app when keys are missing.
   ============================================================ */
import { piConfig } from '../problemIntelligence/config.js';

export function getEmbedder(cfg = piConfig()) {
  const m = cfg.memory || {};
  const provider = m.embeddingProvider || 'fallback';
  const usable = m.vectorSearchEnabled && (
    (provider === 'openai' && cfg.openaiKey) ||
    (provider === 'gemini' && cfg.geminiKey)
  );

  return {
    mode: usable ? provider : 'keyword',
    enabled: !!usable,
    async embed(texts = []) {
      const arr = Array.isArray(texts) ? texts : [texts];
      if (!usable) return arr.map(() => null);
      try {
        if (provider === 'openai') return await embedOpenAI(arr, cfg);
        if (provider === 'gemini') return await embedGemini(arr, cfg);
      } catch { /* fall through */ }
      return arr.map(() => null);
    },
  };
}

async function embedOpenAI(texts, cfg) {
  const r = await fetch(`${cfg.openaiBaseUrl.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.openaiKey}` },
    body: JSON.stringify({ model: cfg.memory.openaiEmbeddingModel, input: texts.map((t) => String(t).slice(0, 8000)) }),
  });
  if (!r.ok) return texts.map(() => null);
  const j = await r.json();
  return (j.data || []).map((d) => d.embedding || null);
}

async function embedGemini(texts, cfg) {
  // Batch one-by-one for schema simplicity.
  const out = [];
  for (const t of texts) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${cfg.geminiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text: String(t).slice(0, 8000) }] } }),
    });
    if (!r.ok) { out.push(null); continue; }
    const j = await r.json();
    out.push(j?.embedding?.values || null);
  }
  return out;
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export default { getEmbedder, cosine };
