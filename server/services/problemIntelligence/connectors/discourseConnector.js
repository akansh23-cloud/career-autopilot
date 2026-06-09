/* ============================================================
   Connector — Discourse forums  (ALLOWLISTED base URLs only)
   ------------------------------------------------------------
   Never crawls arbitrary Discourse sites. Only base URLs present
   in DISCOURSE_ALLOWED_BASE_URLS are queried, via the public
   /search.json endpoint (API key used if configured).
   ============================================================ */
import { fetchJSON } from '../util.js';
import { normalizeCommunitySignal, ok, disabled } from './communityCommon.js';

function isAllowed(base, allowed) {
  try { const h = new URL(base).host; return allowed.some((a) => { try { return new URL(a).host === h; } catch { return false; } }); }
  catch { return false; }
}

export async function fetchDiscourse(ctx = {}, opts = {}) {
  const d = (opts.cfg && opts.cfg.discourse) || {};
  if (!d.enabled) return disabled('discourse', 'Discourse source is disabled (set DISCOURSE_DISCOVERY_ENABLED=1).');
  const allowed = d.allowedBaseUrls || [];
  if (!allowed.length) return disabled('discourse', 'No allowlisted Discourse base URLs configured (DISCOURSE_ALLOWED_BASE_URLS).');

  const requested = (ctx.communities?.discourseForums || []).filter((u) => isAllowed(u, allowed));
  const targets = (requested.length ? requested : allowed).slice(0, 3);
  const query = [ctx.goal, ctx.technology, ctx.domain].filter(Boolean).join(' ') || ctx.keywords || '';
  if (!query) return disabled('discourse', 'No query terms for Discourse.');

  const headers = (d.apiKey && d.apiUsername) ? { 'Api-Key': d.apiKey, 'Api-Username': d.apiUsername } : {};
  const limit = Math.min(opts.limit || 8, 15);
  const all = [];
  const warnings = [];

  for (const base of targets) {
    const url = `${base.replace(/\/$/, '')}/search.json?q=${encodeURIComponent(query)}`;
    const res = await fetchJSON(url, { timeoutMs: opts.timeoutMs || 12000, maxBytes: opts.maxBytes, headers });
    if (!res.ok) { warnings.push(`Discourse ${base} failed (${res.status || res.error}).`); continue; }
    let data; try { data = JSON.parse(res.text); } catch { warnings.push(`Discourse ${base} malformed.`); continue; }
    const topics = data.topics || [];
    const posts = data.posts || [];
    const postByTopic = {};
    for (const p of posts) if (!postByTopic[p.topic_id]) postByTopic[p.topic_id] = p;
    for (const t of topics.slice(0, limit)) {
      all.push(normalizeCommunitySignal({
        source: 'discourse',
        sourceUrl: `${base.replace(/\/$/, '')}/t/${t.slug || ''}/${t.id}`,
        sourceId: String(t.id),
        sourceCommunity: new URL(base).host,
        title: t.title || t.fancy_title || 'Forum topic',
        body: (postByTopic[t.id]?.blurb) || t.title || '',
        tags: t.tags || [],
        engagement: { comments: t.posts_count || t.reply_count || 0, views: t.views || 0, score: t.like_count || 0 },
        createdAt: t.created_at || null,
        lastActivityAt: t.last_posted_at || t.bumped_at || null,
      }));
    }
  }

  return ok('discourse', all.slice(0, limit), warnings.join(' ') || '');
}

export default { fetchDiscourse };
