import { sanitizeText } from '../utils.js';

function extractJSON(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

async function anthropic(prompt, maxTokens = 1600) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-3-5-sonnet-20241022', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`anthropic_${r.status}`);
  const j = await r.json();
  return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

async function openai(prompt, maxTokens = 1600) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: process.env.AI_MODEL || 'gpt-4o-mini', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`openai_${r.status}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content || '';
}

async function gemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.AI_MODEL || 'gemini-1.5-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!r.ok) throw new Error(`gemini_${r.status}`);
  const j = await r.json();
  return j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
}

export function configuredProviderName() {
  const p = String(process.env.AI_PROVIDER || '').toLowerCase();
  if (p && p !== 'fallback') return p;
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return 'fallback';
}

export async function askJSON(prompt, { maxTokens = 1800 } = {}) {
  const provider = configuredProviderName();
  if (provider === 'fallback') return { provider, json: null, text: '' };
  try {
    const text = provider === 'openai' ? await openai(prompt, maxTokens)
      : provider === 'gemini' ? await gemini(prompt, maxTokens)
      : await anthropic(prompt, maxTokens);
    return { provider, text: sanitizeText(text, 12000), json: extractJSON(text) };
  } catch (err) {
    return { provider, json: null, text: '', error: err.message };
  }
}
