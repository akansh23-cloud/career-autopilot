/* ============================================================
   Connector — Dev.to  (public Forem API)
   ------------------------------------------------------------
   Used to identify what developers struggle with and which tools
   are missing — NOT to copy tutorials. We extract generalized
   pain points only.
   ============================================================ */
import { fetchJSON } from '../util.js';
import { normalizeCommunitySignal, ok, disabled } from './communityCommon.js';

export async function fetchDevto(ctx = {}, opts = {}) {
  const cfg = (opts.cfg && opts.cfg.devto) || {};
  if (!cfg.enabled) return disabled('devto', 'Dev.to source is disabled (set DEVTO_DISCOVERY_ENABLED=1).');

  const tags = (ctx.communities?.devtoTags || []).slice(0, 3);
  const limit = Math.min(opts.limit || 10, 20);
  const tag = tags[0] || (ctx.technology || ctx.domain || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const url = `https://dev.to/api/articles?per_page=${limit}&top=30${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`;
  const headers = cfg.apiKey ? { 'api-key': cfg.apiKey } : {};

  const res = await fetchJSON(url, { timeoutMs: opts.timeoutMs || 12000, maxBytes: opts.maxBytes, headers });
  if (!res.ok) return disabled('devto', `Dev.to fetch failed (${res.status || res.error}).`);
  let data; try { data = JSON.parse(res.text); } catch { return disabled('devto', 'Dev.to returned malformed data.'); }
  if (!Array.isArray(data)) return disabled('devto', 'Dev.to returned no articles.');

  const signals = data.filter((a) => a.title).map((a) => normalizeCommunitySignal({
    source: 'devto',
    sourceUrl: a.url || '',
    sourceId: String(a.id || ''),
    sourceCommunity: 'dev.to',
    title: a.title,
    body: a.description || a.title,
    tags: a.tag_list || [],
    engagement: { reactions: a.public_reactions_count || 0, comments: a.comments_count || 0 },
    createdAt: a.published_at || null,
  }));

  return ok('devto', signals.slice(0, limit));
}

export default { fetchDevto };
