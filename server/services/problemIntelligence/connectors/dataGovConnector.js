/* ============================================================
   Connector — Data.gov (CKAN package_search, keyless; optional
   api.data.gov key raises limits)
   ============================================================ */
import { fetchJSON, sanitizeText } from '../util.js';
import { makeEvidence } from '../../collectiveIntelligence/normalizer.js';

const ENDPOINT = 'https://catalog.data.gov/api/3/action/package_search';

export async function fetchDataGov(ctx = {}, opts = {}) {
  const query = String(ctx.query || '').trim();
  if (!query) return { ok: false, source: 'datagov', items: [], error: 'no query' };

  const limit = Math.min(opts.limit || 5, 10);
  const url = `${ENDPOINT}?q=${encodeURIComponent(query.slice(0, 120))}&rows=${limit}`;
  const headers = opts.apiKey ? { 'X-Api-Key': opts.apiKey } : {};
  const res = await fetchJSON(url, { headers, timeoutMs: opts.timeoutMs || 8000, maxBytes: opts.maxBytes });
  if (!res.ok) return { ok: false, source: 'datagov', items: [], error: `fetch failed (${res.status || res.error})` };

  let data;
  try { data = JSON.parse(res.text); } catch { return { ok: false, source: 'datagov', items: [], error: 'malformed response' }; }

  const items = (data?.result?.results || []).map((d) => makeEvidence({
    source: 'datagov',
    sourceType: 'public_dataset',
    title: d.title || d.name,
    summary: sanitizeText(d.notes || '', 500),
    url: d.name ? `https://catalog.data.gov/dataset/${encodeURIComponent(d.name)}` : '',
    publishedDate: d.metadata_modified || d.metadata_created || null,
    author: d.organization?.title || '',
    rawScore: (d.resources || []).length,
    tags: (d.tags || []).slice(0, 6).map((t) => t.display_name || t.name),
    evidenceType: 'public_dataset',
    metadata: { formats: [...new Set((d.resources || []).map((r) => r.format).filter(Boolean))].slice(0, 6), resourceCount: (d.resources || []).length },
    queryKeywords: ctx.queryKeywords || [],
  }));
  return { ok: true, source: 'datagov', items };
}

export default { fetchDataGov };
