/* ============================================================
   JOB DISCOVERY OS — TEXT / HASH / DATE / URL PRIMITIVES
   ------------------------------------------------------------
   Deterministic only. No LLM anywhere in this file, and none in
   the dedupe path that consumes it (§20: "Do not introduce an LLM
   just to deduplicate jobs").
   ============================================================ */

import crypto from 'node:crypto';

export function sha256(input) {
  return crypto.createHash('sha256').update(String(input ?? ''), 'utf8').digest('hex');
}

export function shortHash(input, len = 16) {
  return sha256(input).slice(0, len);
}

/** Strip HTML to readable text without inventing content. */
export function stripHtml(html) {
  if (html == null) return '';
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|br|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lowercase, punctuation-flattened token stream. */
export function tokens(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]/g, ' ')
    .split(/[\s/]+/)
    .map((t) => t.replace(/^[-.]+|[-.]+$/g, ''))
    .filter(Boolean);
}

export function normalizeWhitespace(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Description text normalized for content hashing (formatting-insensitive). */
export function contentNormalize(s) {
  return tokens(stripHtml(s)).join(' ');
}

/** Word k-shingles used by the similarity stage of dedupe. */
export function shingles(text, k = 5) {
  const t = tokens(text);
  if (t.length < k) return t.length ? [t.join(' ')] : [];
  const out = [];
  for (let i = 0; i + k <= t.length; i += 1) out.push(t.slice(i, i + k).join(' '));
  return out;
}

export function jaccard(aSet, bSet) {
  const a = aSet instanceof Set ? aSet : new Set(aSet);
  const b = bSet instanceof Set ? bSet : new Set(bSet);
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const v of small) if (large.has(v)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/* 32-bit FNV-1a — stable across processes, unlike Math.random seeds. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic MinHash-style signature. `bands` independent hash seeds; the
 * fraction of matching positions estimates Jaccard similarity in O(bands).
 */
export function minhashSignature(text, { k = 5, bands = 32 } = {}) {
  const grams = shingles(text, k);
  if (!grams.length) return [];
  const sig = new Array(bands).fill(0xffffffff);
  for (const g of grams) {
    const base = fnv1a(g);
    for (let i = 0; i < bands; i += 1) {
      const h = (Math.imul(base ^ (i * 0x9e3779b1), 0x85ebca6b) >>> 0);
      if (h < sig[i]) sig[i] = h;
    }
  }
  return sig;
}

export function signatureSimilarity(a = [], b = []) {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] === b[i]) same += 1;
  return same / a.length;
}

/* ------------------------------- dates ------------------------------- */

/**
 * Parse a source-supplied date. Returns an ISO string or null.
 * NEVER returns "now" as a fallback — an unparseable date is unknown data,
 * and a fabricated postedAt is exactly the failure mode §37/§58 forbid.
 */
export function parseSourceDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'number') {
    // Heuristic only on MAGNITUDE, not on content: seconds vs milliseconds.
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getUTCFullYear();
    return y >= 1995 && y <= 2100 ? d.toISOString() : null;
  }
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{10}$/.test(s)) return parseSourceDate(Number(s));
  if (/^\d{13}$/.test(s)) return parseSourceDate(Number(s));
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 1995 || y > 2100) return null;
  return d.toISOString();
}

export function ageDays(iso, now = Date.now()) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86400000));
}

export function ageMinutes(iso, now = Date.now()) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 60000));
}

/* -------------------------------- urls -------------------------------- */

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'gh_src', 'gh_jid_src', 'ref', 'referrer', 'source', 'src', 'fbclid', 'gclid',
  'mc_cid', 'mc_eid', 'trk', 'trackingId',
]);

/** Canonical URL form for comparison/dedupe. Returns null when unusable. */
export function normalizeUrl(url) {
  if (!url) return null;
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/\.$/, '');
  const keep = [];
  for (const [k, v] of u.searchParams.entries()) {
    if (!TRACKING_PARAMS.has(k)) keep.push([k, v]);
  }
  keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  u.search = '';
  for (const [k, v] of keep) u.searchParams.append(k, v);
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

export function hostOf(url) {
  try { return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

/** Registrable-ish domain (last two labels; handles common two-part TLDs). */
const TWO_PART_TLDS = new Set([
  'co.uk', 'co.in', 'co.jp', 'co.nz', 'co.za', 'com.au', 'com.br', 'com.sg',
  'com.mx', 'com.tr', 'ac.uk', 'org.uk', 'net.au', 'org.in', 'net.in', 'gov.in',
]);

export function registrableDomain(hostOrUrl) {
  const h = hostOrUrl && hostOrUrl.includes('://') ? hostOf(hostOrUrl) : String(hostOrUrl || '').toLowerCase().replace(/^www\./, '');
  if (!h) return null;
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return h;
  const lastTwo = parts.slice(-2).join('.');
  if (TWO_PART_TLDS.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

export default {
  sha256, shortHash, stripHtml, tokens, normalizeWhitespace, contentNormalize,
  shingles, jaccard, fnv1a, minhashSignature, signatureSimilarity,
  parseSourceDate, ageDays, ageMinutes, normalizeUrl, hostOf, registrableDomain,
};
