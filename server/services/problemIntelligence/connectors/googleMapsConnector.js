/* ============================================================
   Connector — Google Maps Places (local business signals;
   REQUIRES key; OFF by default — billed API)
   ============================================================ */
import { fetchJSON, sanitizeText } from '../util.js';
import { makeEvidence } from '../../collectiveIntelligence/normalizer.js';

const ENDPOINT = 'https://maps.googleapis.com/maps/api/place/textsearch/json';

export async function fetchGoogleMaps(ctx = {}, opts = {}) {
  if (!opts.apiKey) return { ok: false, source: 'googlemaps', items: [], error: 'Google Maps API key not configured', disabled: true };
  const query = String(ctx.placeQuery || ctx.query || '').trim();
  if (!query) return { ok: false, source: 'googlemaps', items: [], error: 'no query' };

  const url = `${ENDPOINT}?query=${encodeURIComponent(query.slice(0, 100))}&key=${encodeURIComponent(opts.apiKey)}`;
  const res = await fetchJSON(url, { timeoutMs: opts.timeoutMs || 8000, maxBytes: opts.maxBytes });
  if (!res.ok) return { ok: false, source: 'googlemaps', items: [], error: `fetch failed (${res.status || res.error})` };

  let data;
  try { data = JSON.parse(res.text); } catch { return { ok: false, source: 'googlemaps', items: [], error: 'malformed response' }; }
  if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    return { ok: false, source: 'googlemaps', items: [], error: `API status ${data.status}` };
  }

  const limit = Math.min(opts.limit || 4, 6);
  const items = (data?.results || []).slice(0, limit).map((p) => makeEvidence({
    source: 'googlemaps',
    sourceType: 'local_business_signal',
    title: sanitizeText(p.name || 'Place', 120),
    summary: sanitizeText(`${p.formatted_address || ''}${p.rating ? ` · rating ${p.rating} (${p.user_ratings_total || 0} reviews)` : ''}`, 240),
    url: p.place_id ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(p.place_id)}` : '',
    author: 'Google Maps',
    rawScore: p.user_ratings_total || 0,
    tags: (p.types || []).slice(0, 4),
    evidenceType: 'local_business_signal',
    metadata: { rating: p.rating || 0, reviews: p.user_ratings_total || 0 },
    queryKeywords: ctx.queryKeywords || [],
  }));
  return { ok: true, source: 'googlemaps', items };
}

export default { fetchGoogleMaps };
