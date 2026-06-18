/* ============================================================
   Connector — arXiv research metadata  (official Atom API)
   ------------------------------------------------------------
   GET export.arxiv.org/api/query. No key required. Returns Atom
   XML which we parse with light regex (no XML dependency). Used
   for research-potential signal, not as a "problem" per se —
   downstream services weight it toward the research route.
   Returns [] on any error.
   ============================================================ */
import { fetchJSON, sanitizeText, sha1, extractKeywords } from '../util.js';

const API = 'https://export.arxiv.org/api/query';

function buildSearch({ domain, technology, goal, keywords }) {
  const terms = [keywords, technology, domain, goal].filter(Boolean).join(' ').trim() || 'machine learning systems';
  return `all:${terms}`.slice(0, 240);
}

export async function fetchArxiv(input = {}, { timeoutMs = 12000, limit = 8, maxBytes = 2_000_000 } = {}) {
  const params = new URLSearchParams({
    search_query: buildSearch(input),
    start: '0',
    max_results: String(Math.min(Number(limit) || 8, 20)),
    sortBy: 'relevance',
    sortOrder: 'descending',
  });
  const res = await fetchJSON(`${API}?${params.toString()}`, { timeoutMs, maxBytes, accept: 'application/atom+xml' });
  if (!res.ok || !res.text) {
    return { ok: false, source: 'arxiv', mode: 'public', signals: [], warning: res.error === 'timeout' ? 'arXiv request timed out.' : `arXiv unavailable (status ${res.status}).` };
  }
  const signals = parseEntries(res.text).filter(Boolean);
  return { ok: true, source: 'arxiv', mode: 'public', signals };
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

function parseEntries(xml) {
  const out = [];
  const entries = xml.split(/<entry[\s>]/i).slice(1);
  for (const raw of entries) {
    const block = `<entry ${raw}`;
    const title = sanitizeText(tag(block, 'title'), 280);
    if (!title) continue;
    const summary = sanitizeText(tag(block, 'summary'), 1200);
    const id = sanitizeText(tag(block, 'id'), 500);
    const published = tag(block, 'published').trim();
    const updated = tag(block, 'updated').trim();
    const cats = [...block.matchAll(/<category[^>]*term="([^"]+)"/gi)].map((m) => sanitizeText(m[1], 40));
    out.push({
      source: 'arxiv',
      sourceId: id || sha1(title),
      sourceUrl: id,
      title,
      contentSummary: summary || title,
      rawTextHash: sha1(`${title}\n${summary}`),
      tags: [...cats, ...extractKeywords(`${title} ${summary}`, 6)].filter(Boolean).slice(0, 12),
      engagement: { type: 'research_paper', categories: cats },
      sourceCreatedAt: published ? new Date(published) : null,
      lastActivityAt: updated ? new Date(updated) : null,
    });
  }
  return out;
}

export default { fetchArxiv };

// Back-compat alias used by the legacy problem-intelligence index.
export const fetchArxivSignals = fetchArxiv;
