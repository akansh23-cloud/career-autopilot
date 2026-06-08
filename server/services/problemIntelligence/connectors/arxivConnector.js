import { normalizeSignal, sanitizeText } from '../utils.js';

function tagValue(entry, tag) {
  const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? sanitizeText(m[1], tag === 'summary' ? 1600 : 300) : '';
}
function links(entry) {
  const hrefs = [...entry.matchAll(/<link[^>]+href="([^"]+)"[^>]*>/gi)].map((m) => m[1]);
  return hrefs.find((h) => /abs\//.test(h)) || hrefs[0] || '';
}

export async function fetchArxivSignals(input = {}, { limit = 8, timeoutMs = 9000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const query = [input.problem, input.domain, input.technology].filter(Boolean).join(' ') || 'machine learning automation system';
    const params = new URLSearchParams({ search_query: `all:${query}`, start: '0', max_results: String(Math.min(20, Math.max(3, limit))), sortBy: 'lastUpdatedDate', sortOrder: 'descending' });
    const res = await fetch(`https://export.arxiv.org/api/query?${params}`, { signal: controller.signal, headers: { 'User-Agent': 'career-autopilot-problem-intelligence' } });
    if (!res.ok) throw new Error(`arxiv_${res.status}`);
    const xml = await res.text();
    const entries = xml.split(/<entry>/i).slice(1).map((x) => x.split(/<\/entry>/i)[0]);
    return entries.slice(0, limit).map((e) => {
      const id = tagValue(e, 'id');
      return normalizeSignal({
        source: 'arxiv', sourceId: id || links(e), sourceUrl: links(e) || id,
        title: tagValue(e, 'title'), contentSummary: tagValue(e, 'summary'),
        tags: ['research', input.technology || input.domain].filter(Boolean),
        engagement: { research: 1 },
        sourceCreatedAt: tagValue(e, 'published'), lastActivityAt: tagValue(e, 'updated'),
        domain: input.domain, technology: input.technology, targetUser: input.targetUser,
      });
    });
  } finally { clearTimeout(timer); }
}
