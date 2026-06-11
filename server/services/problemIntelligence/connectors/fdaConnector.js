/* ============================================================
   Connector — openFDA (drug / device public data; keyless,
   optional key raises rate limits)
   ============================================================ */
import { fetchJSON, sanitizeText, lc } from '../util.js';
import { makeEvidence } from '../../collectiveIntelligence/normalizer.js';

export async function fetchFDA(ctx = {}, opts = {}) {
  const query = String(ctx.query || '').trim();
  if (!query) return { ok: false, source: 'fda', items: [], error: 'no query' };

  /* Pick the most relevant openFDA endpoint from the query. */
  const isDevice = /\bdevice|implant|monitor|wearable|diagnostic\b/.test(lc(query));
  const endpoint = isDevice ? 'https://api.fda.gov/device/event.json' : 'https://api.fda.gov/drug/label.json';

  const limit = Math.min(opts.limit || 4, 8);
  const terms = query.replace(/["\\]/g, '').split(/\s+/).filter((t) => t.length > 3).slice(0, 4).join('+');
  if (!terms) return { ok: false, source: 'fda', items: [], error: 'no usable search terms' };
  const key = opts.apiKey ? `&api_key=${encodeURIComponent(opts.apiKey)}` : '';
  const url = `${endpoint}?search=${encodeURIComponent(terms)}&limit=${limit}${key}`;

  const res = await fetchJSON(url, { timeoutMs: opts.timeoutMs || 8000, maxBytes: opts.maxBytes });
  if (!res.ok) return { ok: res.status === 404, source: 'fda', items: [], error: res.status === 404 ? '' : `fetch failed (${res.status || res.error})` };

  let data;
  try { data = JSON.parse(res.text); } catch { return { ok: false, source: 'fda', items: [], error: 'malformed response' }; }

  const items = (data?.results || []).slice(0, limit).map((r, i) => {
    const title = isDevice
      ? (r.device?.[0]?.brand_name || r.device?.[0]?.generic_name || 'FDA device event')
      : (r.openfda?.brand_name?.[0] || r.openfda?.generic_name?.[0] || 'FDA drug label');
    const summary = isDevice
      ? sanitizeText(r.event_type ? `Reported device event type: ${r.event_type}.` : 'Public device adverse-event record.', 300)
      : sanitizeText((r.indications_and_usage?.[0] || r.description?.[0] || 'Public drug label record.'), 400);
    return makeEvidence({
      source: 'fda',
      sourceType: 'government_data',
      title: `${title} (openFDA)`,
      summary,
      url: 'https://open.fda.gov/apis/',
      publishedDate: r.effective_time ? fmtDate(r.effective_time) : (r.date_received ? fmtDate(r.date_received) : null),
      author: 'US FDA (openFDA)',
      evidenceType: 'government_data',
      metadata: { endpoint: isDevice ? 'device/event' : 'drug/label', recordIndex: i },
      queryKeywords: ctx.queryKeywords || [],
    });
  });
  return { ok: true, source: 'fda', items };
}

function fmtDate(s) {
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export default { fetchFDA };
