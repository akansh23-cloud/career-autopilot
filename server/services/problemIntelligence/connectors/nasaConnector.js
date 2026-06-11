/* ============================================================
   Connector — NASA (images & open data search; keyless. The
   optional api.nasa.gov key only matters for other endpoints.)
   ============================================================ */
import { fetchJSON, sanitizeText } from '../util.js';
import { makeEvidence } from '../../collectiveIntelligence/normalizer.js';

const ENDPOINT = 'https://images-api.nasa.gov/search';

export async function fetchNASA(ctx = {}, opts = {}) {
  const query = String(ctx.query || '').trim();
  if (!query) return { ok: false, source: 'nasa', items: [], error: 'no query' };

  const limit = Math.min(opts.limit || 4, 8);
  const url = `${ENDPOINT}?q=${encodeURIComponent(query.slice(0, 100))}&page_size=${limit}`;
  const res = await fetchJSON(url, { timeoutMs: opts.timeoutMs || 8000, maxBytes: opts.maxBytes });
  if (!res.ok) return { ok: false, source: 'nasa', items: [], error: `fetch failed (${res.status || res.error})` };

  let data;
  try { data = JSON.parse(res.text); } catch { return { ok: false, source: 'nasa', items: [], error: 'malformed response' }; }

  const items = (data?.collection?.items || []).slice(0, limit).map((it) => {
    const d = (it.data || [])[0] || {};
    return makeEvidence({
      source: 'nasa',
      sourceType: 'public_dataset',
      title: d.title || 'NASA media/data record',
      summary: sanitizeText(d.description || '', 400),
      url: it.href || 'https://images.nasa.gov/',
      publishedDate: d.date_created || null,
      author: d.center || 'NASA',
      tags: (d.keywords || []).slice(0, 6),
      evidenceType: 'public_dataset',
      metadata: { mediaType: d.media_type || '', nasaId: d.nasa_id || '' },
      queryKeywords: ctx.queryKeywords || [],
    });
  });
  return { ok: true, source: 'nasa', items };
}

export default { fetchNASA };
