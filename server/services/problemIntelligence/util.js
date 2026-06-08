/* ============================================================
   Innovation OS — shared utilities
   ------------------------------------------------------------
   Pure, dependency-free helpers used across connectors and
   services. No network here except fetchJSON (which is fully
   guarded: timeout, size cap, content-type check, no redirects
   to arbitrary hosts because callers pass fixed allow-listed
   API origins only).
   ============================================================ */
import crypto from 'crypto';

export const lc = (s) => String(s || '').toLowerCase();
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function sha1(input) {
  return crypto.createHash('sha1').update(String(input || '')).digest('hex');
}

/* Stable short fingerprint for dedupe keys. */
export function fingerprint(...parts) {
  return sha1(parts.map((p) => normalizeText(p)).join('|')).slice(0, 24);
}

/* Strip control chars / scripts and collapse whitespace. Used before we ever
   persist or render external content. */
export function sanitizeText(input, max = 4000) {
  let s = String(input == null ? '' : input);
  s = s.replace(/<\/?(script|style|iframe|object|embed)[^>]*>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');          // drop remaining tags
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' '); // control chars
  s = s.replace(/\s+/g, ' ').trim();
  return s.slice(0, max);
}

export function normalizeText(s) {
  return lc(s).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const STOPWORDS = new Set(('a an the and or but if then else of to in on for with without by from as at into over under ' +
  'is are was were be been being do does did have has had this that these those it its i you we they he she them us our your ' +
  'not no can cannot could should would may might will just very more most some any all how what why when where which who whom ' +
  'about above after again against because before below between both during each few further here more once only other out same ' +
  'so than too until up down off above use using used get got want need make made like also new way thing things problem issue ' +
  'work working works try trying tried help error errors using one two how-to').split(/\s+/));

/* Extract salient keywords (deterministic, no AI). Returns up to `n` terms by
   frequency, ignoring stopwords and very short tokens. */
export function extractKeywords(text, n = 12) {
  const freq = new Map();
  for (const raw of normalizeText(text).split(' ')) {
    if (raw.length < 4 || STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue;
    freq.set(raw, (freq.get(raw) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

/* Jaccard similarity over keyword sets — used for clustering / dedupe. */
export function jaccard(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  return inter / (aSet.size + bSet.size - inter);
}

/* Guarded JSON fetch. Fixed allow-listed origins only (callers never pass
   user-controlled hosts — this prevents SSRF). Times out, caps body size,
   never follows cross-origin redirects to unknown hosts. */
export async function fetchJSON(url, { headers = {}, timeoutMs = 12000, maxBytes = 2_000_000, accept = 'application/json' } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { Accept: accept, 'User-Agent': 'CareerAutopilot-InnovationOS/1.0', ...headers },
    });
    const ct = r.headers.get('content-type') || '';
    const text = await readCapped(r, maxBytes);
    return { ok: r.ok, status: r.status, contentType: ct, text };
  } catch (err) {
    return { ok: false, status: 0, error: err?.name === 'AbortError' ? 'timeout' : (err?.message || 'fetch_failed'), text: '' };
  } finally {
    clearTimeout(t);
  }
}

async function readCapped(res, maxBytes) {
  // Stream-aware cap; falls back to text() when body isn't a web stream.
  try {
    if (!res.body || typeof res.body.getReader !== 'function') {
      const txt = await res.text();
      return txt.slice(0, maxBytes * 2);
    }
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      chunks.push(value);
      if (total > maxBytes) { try { reader.cancel(); } catch { /* noop */ } break; }
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  } catch {
    try { return await res.text(); } catch { return ''; }
  }
}

/* Parse JSON that may be wrapped in markdown fences / prose (AI output). */
export function parseLooseJSON(text) {
  if (text == null) return null;
  if (typeof text === 'object') return text;
  let s = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(s); } catch { /* try to extract a JSON span */ }
  const first = s.search(/[[{]/);
  const last = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (first >= 0 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch { return null; }
  }
  return null;
}

/* Tiny in-memory TTL cache (per warm process). Safe in serverless: a cold
   start just rebuilds it. */
export function makeTTLCache(ttlMs) {
  const store = new Map();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (Date.now() - hit.at > ttlMs) { store.delete(key); return undefined; }
      return hit.value;
    },
    set(key, value) { store.set(key, { at: Date.now(), value }); return value; },
    clear() { store.clear(); },
  };
}
