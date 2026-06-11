/* ============================================================
   Connector — OpenStreetMap / Nominatim (local business & place
   signals; keyless, strict usage policy → low limits + cached)
   ============================================================ */
import { fetchJSON, sanitizeText } from '../util.js';
import { makeEvidence } from '../../collectiveIntelligence/normalizer.js';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

export async function fetchOpenStreetMap(ctx = {}, opts = {}) {
  const query = String(ctx.placeQuery || ctx.query || '').trim();
  if (!query) return { ok: false, source: 'openstreetmap', items: [], error: 'no query' };

  const limit = Math.min(opts.limit || 4, 6);
  const url = `${ENDPOINT}?q=${encodeURIComponent(query.slice(0, 100))}&format=jsonv2&limit=${limit}&addressdetails=0`;
  const res = await fetchJSON(url, { timeoutMs: opts.timeoutMs || 8000, maxBytes: opts.maxBytes });
  if (!res.ok) return { ok: false, source: 'openstreetmap', items: [], error: `fetch failed (${res.status || res.error})` };

  let data;
  try { data = JSON.parse(res.text); } catch { return { ok: false, source: 'openstreetmap', items: [], error: 'malformed response' }; }

  const items = (Array.isArray(data) ? data : []).slice(0, limit).map((p) => makeEvidence({
    source: 'openstreetmap',
    sourceType: 'local_business_signal',
    title: sanitizeText(p.display_name || p.name || 'OSM place', 160),
    summary: sanitizeText(`OpenStreetMap ${p.type || 'place'} (${p.category || p.class || 'feature'}) — free geodata usable for local-business analysis, maps and proximity features without paid APIs.`, 320),
    url: p.osm_type && p.osm_id ? `https://www.openstreetmap.org/${p.osm_type}/${p.osm_id}` : 'https://www.openstreetmap.org/',
    author: 'OpenStreetMap contributors',
    rawScore: Number(p.importance) || 0,
    evidenceType: 'local_business_signal',
    metadata: { lat: p.lat, lon: p.lon, category: p.category || p.class || '', type: p.type || '' },
    queryKeywords: ctx.queryKeywords || [],
  }));
  return { ok: true, source: 'openstreetmap', items };
}

export default { fetchOpenStreetMap };
