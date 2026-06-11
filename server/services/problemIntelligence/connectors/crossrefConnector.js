/* ============================================================
   Connector — Crossref (scholarly works, keyless; mailto opts
   into the polite pool for better rate limits)
   ============================================================ */
import { fetchJSON, sanitizeText } from '../util.js';
import { makeEvidence } from '../../collectiveIntelligence/normalizer.js';

const ENDPOINT = 'https://api.crossref.org/works';

export async function fetchCrossref(ctx = {}, opts = {}) {
  const query = String(ctx.query || '').trim();
  if (!query) return { ok: false, source: 'crossref', items: [], error: 'no query' };

  const limit = Math.min(opts.limit || 6, 12);
  const mailto = opts.mailto ? `&mailto=${encodeURIComponent(opts.mailto)}` : '';
  const url = `${ENDPOINT}?query=${encodeURIComponent(query.slice(0, 150))}&rows=${limit}&sort=relevance${mailto}`;
  const res = await fetchJSON(url, { timeoutMs: opts.timeoutMs || 8000, maxBytes: opts.maxBytes });
  if (!res.ok) return { ok: false, source: 'crossref', items: [], error: `fetch failed (${res.status || res.error})` };

  let data;
  try { data = JSON.parse(res.text); } catch { return { ok: false, source: 'crossref', items: [], error: 'malformed response' }; }

  const items = (data?.message?.items || []).map((w) => {
    const dateParts = w.published?.['date-parts']?.[0] || w.created?.['date-parts']?.[0] || [];
    const published = dateParts.length ? dateParts.join('-') : null;
    const authors = (w.author || []).slice(0, 3).map((a) => [a.given, a.family].filter(Boolean).join(' ')).join(', ');
    return makeEvidence({
      source: 'crossref',
      sourceType: 'research_paper',
      title: Array.isArray(w.title) ? w.title[0] : w.title,
      summary: sanitizeText(w.abstract || (Array.isArray(w['container-title']) ? w['container-title'][0] : '') || '', 500),
      url: w.URL || (w.DOI ? `https://doi.org/${w.DOI}` : ''),
      publishedDate: published,
      author: authors,
      rawScore: w['is-referenced-by-count'] || 0,
      evidenceType: 'research_paper',
      metadata: { doi: w.DOI || '', type: w.type || '', citations: w['is-referenced-by-count'] || 0 },
      queryKeywords: ctx.queryKeywords || [],
    });
  });
  return { ok: true, source: 'crossref', items };
}

export default { fetchCrossref };
