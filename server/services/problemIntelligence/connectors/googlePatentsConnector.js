/* ============================================================
   Connector — Google Patents (public XHR query endpoint, keyless)
   ------------------------------------------------------------
   Same shape as the other problemIntelligence connectors: pure fetch,
   timeout via fetchJSON, returns { ok, source, items[] }. Results are
   CANDIDATE prior art only — titles/links for a human to review, never
   a patentability signal. Callers (livePriorArtService) own caching and
   the NODE_ENV=test network ban.
   ============================================================ */
import { fetchJSON, sanitizeText } from '../util.js';

const ENDPOINT = 'https://patents.google.com/xhr/query';

export async function fetchGooglePatents(ctx = {}, opts = {}) {
  const query = String(ctx.query || '').trim();
  if (!query) return { ok: false, source: 'google_patents', items: [], error: 'no query' };

  const limit = Math.min(opts.limit || 5, 10);
  const url = `${ENDPOINT}?url=${encodeURIComponent(`q=${query.slice(0, 120)}`)}&exp=`;
  const res = await fetchJSON(url, { timeoutMs: opts.timeoutMs || 6000, maxBytes: opts.maxBytes || 1_500_000 });
  if (!res.ok) return { ok: false, source: 'google_patents', items: [], error: `fetch failed (${res.status || res.error})` };

  let data;
  try { data = JSON.parse(res.text); } catch { return { ok: false, source: 'google_patents', items: [], error: 'malformed response' }; }

  const clusters = data?.results?.cluster || [];
  const rawResults = clusters.flatMap((c) => c?.result || []).slice(0, limit);
  const items = rawResults.map((r) => {
    const p = r?.patent || {};
    const id = String(p.publication_number || '').trim();
    return {
      source: 'google_patents',
      id,
      title: sanitizeText(String(p.title || '').replace(/<[^>]*>/g, ''), 200),
      url: id ? `https://patents.google.com/patent/${encodeURIComponent(id)}` : '',
      assignee: sanitizeText(p.assignee || '', 120),
      publishedDate: p.publication_date || p.filing_date || null,
      verified: false, // ALWAYS unverified — a human must read the document
    };
  }).filter((x) => x.title && x.url);

  return { ok: true, source: 'google_patents', items };
}

export default { fetchGooglePatents };
