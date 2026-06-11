/* ============================================================
   Connector — Wikipedia (REST search API, keyless)
   ------------------------------------------------------------
   Encyclopedia context for any domain. Summaries only — never
   full article dumps. Gracefully degrades on any failure.
   ============================================================ */
import { fetchJSON, sanitizeText } from '../util.js';
import { makeEvidence } from '../../collectiveIntelligence/normalizer.js';

const ENDPOINT = 'https://en.wikipedia.org/w/rest.php/v1/search/page';

export async function fetchWikipedia(ctx = {}, opts = {}) {
  const query = String(ctx.query || ctx.keywordsText || '').trim();
  if (!query) return { ok: false, source: 'wikipedia', items: [], error: 'no query' };

  const limit = Math.min(opts.limit || 5, 10);
  const url = `${ENDPOINT}?q=${encodeURIComponent(query.slice(0, 120))}&limit=${limit}`;
  const res = await fetchJSON(url, { timeoutMs: opts.timeoutMs || 8000, maxBytes: opts.maxBytes });
  if (!res.ok) return { ok: false, source: 'wikipedia', items: [], error: `fetch failed (${res.status || res.error})` };

  let data;
  try { data = JSON.parse(res.text); } catch { return { ok: false, source: 'wikipedia', items: [], error: 'malformed response' }; }

  const items = (Array.isArray(data.pages) ? data.pages : []).map((p) => makeEvidence({
    source: 'wikipedia',
    sourceType: 'encyclopedia_context',
    title: p.title,
    summary: sanitizeText(p.description || p.excerpt || '', 400),
    url: p.key ? `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key)}` : '',
    publishedDate: null,
    evidenceType: 'encyclopedia_context',
    metadata: { wikiId: p.id || '' },
    queryKeywords: ctx.queryKeywords || [],
  }));
  return { ok: true, source: 'wikipedia', items };
}

export default { fetchWikipedia };
