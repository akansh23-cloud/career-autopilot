/* ============================================================
   Connector — US Census Bureau (dataset discovery; key optional,
   disabled by default via CENSUS_DISCOVERY_ENABLED)
   ------------------------------------------------------------
   We query the small per-vintage discovery documents instead of
   the multi-MB master data.json, and surface matching dataset
   descriptions as government_data evidence.
   ============================================================ */
import { fetchJSON, sanitizeText, lc } from '../util.js';
import { makeEvidence } from '../../collectiveIntelligence/normalizer.js';

const ENDPOINT = 'https://api.census.gov/data/2022.json';

export async function fetchCensus(ctx = {}, opts = {}) {
  const query = String(ctx.query || '').trim();
  if (!query) return { ok: false, source: 'census', items: [], error: 'no query' };

  const res = await fetchJSON(ENDPOINT, { timeoutMs: opts.timeoutMs || 8000, maxBytes: Math.min(opts.maxBytes || 2_000_000, 2_000_000) });
  if (!res.ok) return { ok: false, source: 'census', items: [], error: `fetch failed (${res.status || res.error})` };

  let data;
  try { data = JSON.parse(res.text); } catch { return { ok: false, source: 'census', items: [], error: 'malformed response (likely truncated catalog)' }; }

  const terms = lc(query).split(/\s+/).filter((t) => t.length > 3);
  const limit = Math.min(opts.limit || 5, 8);
  const matches = (data?.dataset || [])
    .filter((d) => {
      const hay = lc(`${d.title || ''} ${d.description || ''}`);
      return terms.some((t) => hay.includes(t));
    })
    .slice(0, limit);

  const items = matches.map((d) => makeEvidence({
    source: 'census',
    sourceType: 'government_data',
    title: d.title,
    summary: sanitizeText(d.description || '', 500),
    url: (Array.isArray(d.distribution) ? d.distribution[0]?.accessURL : '') || 'https://api.census.gov/data.html',
    publishedDate: d.c_vintage ? String(d.c_vintage) : null,
    author: 'US Census Bureau',
    evidenceType: 'government_data',
    metadata: { vintage: d.c_vintage || '', keyRequired: !opts.apiKey ? 'recommended for heavy use' : 'configured' },
    queryKeywords: ctx.queryKeywords || [],
  }));
  return { ok: true, source: 'census', items };
}

export default { fetchCensus };
