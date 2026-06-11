/* ============================================================
   Connector — OpenAlex (open scholarly index, keyless; mailto
   opts into the polite pool)
   ============================================================ */
import { fetchJSON, sanitizeText } from '../util.js';
import { makeEvidence } from '../../collectiveIntelligence/normalizer.js';

const ENDPOINT = 'https://api.openalex.org/works';

export async function fetchOpenAlex(ctx = {}, opts = {}) {
  const query = String(ctx.query || '').trim();
  if (!query) return { ok: false, source: 'openalex', items: [], error: 'no query' };

  const limit = Math.min(opts.limit || 6, 12);
  const mailto = opts.mailto ? `&mailto=${encodeURIComponent(opts.mailto)}` : '';
  const url = `${ENDPOINT}?search=${encodeURIComponent(query.slice(0, 150))}&per-page=${limit}&sort=relevance_score:desc${mailto}`;
  const res = await fetchJSON(url, { timeoutMs: opts.timeoutMs || 8000, maxBytes: opts.maxBytes });
  if (!res.ok) return { ok: false, source: 'openalex', items: [], error: `fetch failed (${res.status || res.error})` };

  let data;
  try { data = JSON.parse(res.text); } catch { return { ok: false, source: 'openalex', items: [], error: 'malformed response' }; }

  const items = (data?.results || []).map((w) => makeEvidence({
    source: 'openalex',
    sourceType: 'research_paper',
    title: w.display_name || w.title,
    summary: sanitizeText(reconstructAbstract(w.abstract_inverted_index) || (w.primary_topic?.display_name || ''), 500),
    url: w.doi || w.id || '',
    publishedDate: w.publication_date || null,
    author: (w.authorships || []).slice(0, 3).map((a) => a.author?.display_name).filter(Boolean).join(', '),
    rawScore: w.cited_by_count || 0,
    evidenceType: 'research_paper',
    metadata: { citations: w.cited_by_count || 0, openAccess: !!w.open_access?.is_oa, topic: w.primary_topic?.display_name || '' },
    queryKeywords: ctx.queryKeywords || [],
  }));
  return { ok: true, source: 'openalex', items };
}

/* OpenAlex ships abstracts as an inverted index; rebuild the first ~60 words. */
function reconstructAbstract(inv) {
  if (!inv || typeof inv !== 'object') return '';
  const words = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions || []) if (p < 60) words[p] = word;
  }
  return words.filter(Boolean).join(' ');
}

export default { fetchOpenAlex };
