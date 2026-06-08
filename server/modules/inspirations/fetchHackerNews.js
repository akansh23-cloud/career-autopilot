/* Hacker News via the public Algolia API (no key required). Best-effort:
   returns [] on any failure so the engine can fall back to seed ideas. */
export async function fetchHackerNews({ timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('https://hn.algolia.com/api/v1/search?tags=story&numericFilters=points%3E150&hitsPerPage=20', {
      signal: ctrl.signal, headers: { 'User-Agent': 'career-autopilot' },
    });
    if (!r.ok) return [];
    const data = await r.json().catch(() => null);
    const hits = (data && data.hits) || [];
    return hits.filter((h) => h.title).map((h) => ({
      source: 'hackernews',
      sourceId: String(h.objectID),
      sourceUrl: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      sourceTitle: h.title,
      sourceDescription: (h.story_text || '').slice(0, 600),
      points: h.points || 0,
      numComments: h.num_comments || 0,
      createdAt: h.created_at || null,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

export default { fetchHackerNews };
