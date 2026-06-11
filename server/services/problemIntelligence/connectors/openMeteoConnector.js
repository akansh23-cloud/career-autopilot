/* ============================================================
   Connector — Open-Meteo (free weather/climate data; keyless)
   ------------------------------------------------------------
   Surfaced as dataset evidence: when a query has a location or
   climate angle we describe the forecast/history datasets that
   are freely available, so project blueprints can wire them in.
   ============================================================ */
import { fetchJSON, sanitizeText } from '../util.js';
import { makeEvidence } from '../../collectiveIntelligence/normalizer.js';

const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

export async function fetchOpenMeteo(ctx = {}, opts = {}) {
  const place = String(ctx.location || ctx.country || ctx.query || '').trim();
  if (!place) return { ok: false, source: 'openmeteo', items: [], error: 'no location/query' };

  const url = `${GEOCODE}?name=${encodeURIComponent(place.split(/\s+/).slice(0, 3).join(' ').slice(0, 60))}&count=2&language=en&format=json`;
  const res = await fetchJSON(url, { timeoutMs: opts.timeoutMs || 8000, maxBytes: opts.maxBytes });
  if (!res.ok) return { ok: false, source: 'openmeteo', items: [], error: `fetch failed (${res.status || res.error})` };

  let data;
  try { data = JSON.parse(res.text); } catch { return { ok: false, source: 'openmeteo', items: [], error: 'malformed response' }; }

  const results = data?.results || [];
  /* Even with no geocode hit, the global dataset itself is useful evidence. */
  const items = results.length
    ? results.slice(0, 2).map((g) => makeEvidence({
      source: 'openmeteo',
      sourceType: 'public_dataset',
      title: `Open-Meteo weather data — ${g.name}${g.country ? ', ' + g.country : ''}`,
      summary: sanitizeText(`Free hourly forecast + 80-year historical weather API available for ${g.name} (lat ${g.latitude}, lon ${g.longitude}). No key required; ideal for real-data dashboards, ML features and IoT projects.`, 400),
      url: 'https://open-meteo.com/',
      author: 'Open-Meteo',
      evidenceType: 'public_dataset',
      metadata: { latitude: g.latitude, longitude: g.longitude, country: g.country || '' },
      queryKeywords: ctx.queryKeywords || [],
    }))
    : [makeEvidence({
      source: 'openmeteo',
      sourceType: 'public_dataset',
      title: 'Open-Meteo global weather & climate API',
      summary: 'Free, keyless global forecast, historical and air-quality APIs — a reliable real-data backbone for climate, agri, logistics or IoT projects.',
      url: 'https://open-meteo.com/',
      author: 'Open-Meteo',
      evidenceType: 'public_dataset',
      queryKeywords: ctx.queryKeywords || [],
    })];
  return { ok: true, source: 'openmeteo', items };
}

export default { fetchOpenMeteo };
