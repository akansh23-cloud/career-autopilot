import crypto from 'crypto';

export const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Number(n) || 0));
export const round = (n) => Math.round(Number(n) || 0);
export const lc = (v) => String(v || '').toLowerCase();
export const nowIso = () => new Date().toISOString();

export function sanitizeText(value, max = 1200) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[#a-z0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function stableHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

export function uniqueStrings(items = [], max = 20) {
  const out = [];
  const seen = new Set();
  for (const item of items.map((x) => String(x || '').trim()).filter(Boolean)) {
    const k = item.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

export function keywordTokens(input = '', max = 12) {
  const stop = new Set('the a an and or for with from into that this are was were can should could would using use uses used what how why when where who whom their your our has have had not but about above below within without across after before current existing problem issue error failure request feature support integration system app tool platform user users team teams'.split(' '));
  const counts = new Map();
  for (const raw of lc(input).match(/[a-z][a-z0-9+.#-]{2,}/g) || []) {
    const t = raw.replace(/^[#.-]+|[#.-]+$/g, '');
    if (!t || stop.has(t)) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, max);
}

export function normalizeSignal(signal = {}) {
  const source = String(signal.source || 'manual').toLowerCase();
  const title = sanitizeText(signal.title, 300) || 'Untitled problem signal';
  const contentSummary = sanitizeText(signal.contentSummary || signal.body || signal.summary, 1600);
  const sourceUrl = String(signal.sourceUrl || '').slice(0, 1000);
  const sourceId = String(signal.sourceId || sourceUrl || stableHash(`${source}:${title}:${contentSummary}`).slice(0, 18));
  const rawTextHash = stableHash(`${source}:${sourceId}:${title}:${contentSummary}`);
  return {
    source, sourceId, sourceUrl, title, contentSummary, rawTextHash,
    tags: uniqueStrings(signal.tags || keywordTokens(`${title} ${contentSummary}`, 8), 12),
    engagement: signal.engagement || {},
    sourceCreatedAt: signal.sourceCreatedAt || null,
    lastActivityAt: signal.lastActivityAt || signal.sourceCreatedAt || null,
    domain: signal.domain || '', technology: signal.technology || '', targetUser: signal.targetUser || '',
    extractedPainPoints: signal.extractedPainPoints || [],
  };
}

export function dedupeByHash(items = [], keyFn = (x) => x.rawTextHash) {
  const seen = new Set();
  const out = [];
  let skipped = 0;
  for (const item of items) {
    const key = keyFn(item);
    if (key && seen.has(key)) { skipped += 1; continue; }
    if (key) seen.add(key);
    out.push(item);
  }
  return { items: out, skipped };
}

export function confidenceLabel(score) {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  if (score >= 40) return 'low';
  return 'very-low';
}
