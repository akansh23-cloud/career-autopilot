/* ============================================================
   Connector — World Bank (documents & reports search; keyless)
   ============================================================ */
import { fetchJSON, sanitizeText } from '../util.js';
import { makeEvidence } from '../../collectiveIntelligence/normalizer.js';

const ENDPOINT = 'https://search.worldbank.org/api/v3/wds';

export async function fetchWorldBank(ctx = {}, opts = {}) {
  const query = String(ctx.query || '').trim();
  if (!query) return { ok: false, source: 'worldbank', items: [], error: 'no query' };

  const limit = Math.min(opts.limit || 4, 8);
  const url = `${ENDPOINT}?format=json&qterm=${encodeURIComponent(query.slice(0, 100))}&rows=${limit}&fl=docdt,display_title,url,abstracts,count`;
  const res = await fetchJSON(url, { timeoutMs: opts.timeoutMs || 8000, maxBytes: opts.maxBytes });
  if (!res.ok) return { ok: false, source: 'worldbank', items: [], error: `fetch failed (${res.status || res.error})` };

  let data;
  try { data = JSON.parse(res.text); } catch { return { ok: false, source: 'worldbank', items: [], error: 'malformed response' }; }

  const docs = Object.values(data?.documents || {}).filter((d) => d && typeof d === 'object' && (d.display_title || d.url));
  const items = docs.slice(0, limit).map((d) => makeEvidence({
    source: 'worldbank',
    sourceType: 'market_signal',
    title: textOf(d.display_title) || 'World Bank document',
    summary: sanitizeText(textOf(d.abstracts) || 'World Bank development research / market document.', 450),
    url: d.url || 'https://documents.worldbank.org/',
    publishedDate: d.docdt || null,
    author: 'World Bank',
    evidenceType: 'market_signal',
    metadata: { country: textOf(d.count) || '' },
    queryKeywords: ctx.queryKeywords || [],
  }));
  return { ok: true, source: 'worldbank', items };
}

/* WDS fields are sometimes nested objects like { 'cdata!': '...' }. */
function textOf(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v['cdata!'] || Object.values(v).find((x) => typeof x === 'string') || '';
  return '';
}

export default { fetchWorldBank };
