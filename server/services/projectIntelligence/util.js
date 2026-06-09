/* ============================================================
   Project Intelligence OS — shared utilities
   ------------------------------------------------------------
   Pure, dependency-free helpers. No network, no AI. Everything
   here is deterministic so it is fully testable with node --test
   and works with zero API keys.
   ============================================================ */
import crypto from 'crypto';

export const lc = (s) => String(s == null ? '' : s).toLowerCase();
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+n) ? +n : lo));
export const uniq = (arr) => Array.from(new Set((arr || []).filter(Boolean)));

export function asList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

export function sha1(input) {
  return crypto.createHash('sha1').update(String(input || '')).digest('hex');
}

export function fingerprint(...parts) {
  return sha1(parts.map((p) => normalizeText(p)).join('|')).slice(0, 20);
}

export function normalizeText(s) {
  return lc(s).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Slug used to build deterministic, valid Mermaid node ids. */
export function slugId(s, fallback = 'N') {
  const out = String(s || '').replace(/[^A-Za-z0-9]+/g, '').slice(0, 24);
  return out || fallback;
}

/* Mermaid label sanitiser — the in-repo renderer chokes on [] () " and ; */
export function mermaidLabel(s, max = 34) {
  return String(s || '')
    .replace(/[[\]()"'`;|<>{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max) || 'Node';
}

const STOPWORDS = new Set(('a an the and or but if then else of to in on for with without by from as at into over under is are was ' +
  'were be been being do does did have has had this that these those it its you we they them us our your not no can could ' +
  'should would may might will just very more most some any all how what why when where which who build building project ' +
  'using used use make made like new app tool system based help data real time best good using one two').split(/\s+/));

export function extractKeywords(text, n = 14) {
  const freq = new Map();
  for (const raw of normalizeText(text).split(' ')) {
    if (raw.length < 3 || STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue;
    freq.set(raw, (freq.get(raw) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

export function jaccard(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  return inter / (aSet.size + bSet.size - inter);
}

/* Token-set similarity over two strings (0..1). */
export function textSimilarity(a, b) {
  const sa = new Set(extractKeywords(a, 24));
  const sb = new Set(extractKeywords(b, 24));
  return jaccard(sa, sb);
}

/* Loose JSON parse for optional AI output (fenced / prose-wrapped). */
export function parseLooseJSON(text) {
  if (text == null) return null;
  if (typeof text === 'object') return text;
  let s = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const first = s.search(/[[{]/);
  const last = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (first >= 0 && last > first) { try { return JSON.parse(s.slice(first, last + 1)); } catch { return null; } }
  return null;
}

export function titleCase(s) {
  return String(s || '').replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}
