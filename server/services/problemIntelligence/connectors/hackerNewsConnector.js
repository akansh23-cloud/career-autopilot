/* ============================================================
   Connector — Hacker News  (public Algolia Search API, keyless)
   ------------------------------------------------------------
   Developer pain points, tool gaps, workflow frustrations and
   emerging trends. Discussion themes are summarized; raw comments
   are NOT stored. Treated as an early signal, never as truth.
   ============================================================ */
import { fetchJSON } from '../util.js';
import { normalizeCommunitySignal, ok, disabled } from './communityCommon.js';

const ENDPOINT = 'https://hn.algolia.com/api/v1/search_by_date';

export async function fetchHackerNews(ctx = {}, opts = {}) {
  const cfg = opts.cfg || {};
  if (cfg.hackernews && cfg.hackernews.enabled === false) return disabled('hackernews', 'Hacker News source is disabled.');

  const query = (ctx.communities?.hackerNewsQuery || [ctx.goal, ctx.technology, ctx.domain].filter(Boolean).join(' ') || ctx.keywords || '').trim();
  if (!query) return disabled('hackernews', 'No query terms for Hacker News.');

  const limit = Math.min(opts.limit || 12, 25);
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}&tags=(story,comment)&hitsPerPage=${limit}`;
  const res = await fetchJSON(url, { timeoutMs: opts.timeoutMs || 12000, maxBytes: opts.maxBytes });
  if (!res.ok) return disabled('hackernews', `Hacker News fetch failed (${res.status || res.error}).`);

  let data;
  try { data = JSON.parse(res.text); } catch { return disabled('hackernews', 'Hacker News returned malformed data.'); }
  const hits = Array.isArray(data.hits) ? data.hits : [];

  const signals = hits.filter((h) => h.title || h.comment_text || h.story_title).map((h) => normalizeCommunitySignal({
    source: 'hackernews',
    sourceUrl: h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : (h.url || ''),
    sourceId: h.objectID,
    sourceCommunity: 'Hacker News',
    title: h.title || h.story_title || 'HN discussion',
    body: h.comment_text || h.story_text || h.title || '',
    tags: (h._tags || []).filter((t) => !/^(story|comment|author_|front_page)/.test(t)).slice(0, 6),
    engagement: { score: h.points || 0, comments: h.num_comments || 0 },
    createdAt: h.created_at || null,
    lastActivityAt: h.created_at || null,
  }));

  return ok('hackernews', signals.slice(0, limit));
}

export default { fetchHackerNews };
