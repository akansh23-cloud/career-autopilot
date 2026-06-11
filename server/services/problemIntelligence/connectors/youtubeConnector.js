/* ============================================================
   Connector — YouTube Data API v3 (learning signals; REQUIRES
   key; OFF by default because of quota cost)
   ============================================================ */
import { fetchJSON, sanitizeText } from '../util.js';
import { makeEvidence } from '../../collectiveIntelligence/normalizer.js';

const ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';

export async function fetchYouTube(ctx = {}, opts = {}) {
  if (!opts.apiKey) return { ok: false, source: 'youtube', items: [], error: 'YouTube API key not configured', disabled: true };
  const query = String(ctx.query || '').trim();
  if (!query) return { ok: false, source: 'youtube', items: [], error: 'no query' };

  const limit = Math.min(opts.limit || 4, 6);
  const url = `${ENDPOINT}?part=snippet&type=video&maxResults=${limit}&q=${encodeURIComponent(query.slice(0, 100))}&key=${encodeURIComponent(opts.apiKey)}`;
  const res = await fetchJSON(url, { timeoutMs: opts.timeoutMs || 8000, maxBytes: opts.maxBytes });
  if (!res.ok) return { ok: false, source: 'youtube', items: [], error: `fetch failed (${res.status || res.error})` };

  let data;
  try { data = JSON.parse(res.text); } catch { return { ok: false, source: 'youtube', items: [], error: 'malformed response' }; }

  const items = (data?.items || []).map((v) => makeEvidence({
    source: 'youtube',
    sourceType: 'tutorial_or_learning',
    title: sanitizeText(v.snippet?.title || 'YouTube video', 160),
    summary: sanitizeText(v.snippet?.description || '', 300),
    url: v.id?.videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(v.id.videoId)}` : '',
    publishedDate: v.snippet?.publishedAt || null,
    author: sanitizeText(v.snippet?.channelTitle || '', 80),
    evidenceType: 'tutorial_or_learning',
    metadata: { channel: v.snippet?.channelTitle || '' },
    queryKeywords: ctx.queryKeywords || [],
  }));
  return { ok: true, source: 'youtube', items };
}

export default { fetchYouTube };
