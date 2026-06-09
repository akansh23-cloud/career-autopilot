/* ============================================================
   Connector — Hashnode  (public GraphQL API)
   ------------------------------------------------------------
   Surfaces technical problem patterns and tool gaps from
   developer blogs. We extract generalized pain points only and
   never copy blog ideas. Degrades safely on any error.
   ============================================================ */
import { normalizeCommunitySignal, ok, disabled } from './communityCommon.js';

const GQL = 'https://gql.hashnode.com/';

export async function fetchHashnode(ctx = {}, opts = {}) {
  const cfg = (opts.cfg && opts.cfg.hashnode) || {};
  if (!cfg.enabled) return disabled('hashnode', 'Hashnode source is disabled (set HASHNODE_DISCOVERY_ENABLED=1).');

  const tags = (ctx.communities?.hashnodeTags || []).slice(0, 3);
  const limit = Math.min(opts.limit || 10, 20);
  // feed query (public). Tag filter applied client-side to stay schema-robust.
  const query = `query Feed($first:Int!){ feed(first:$first, filter:{type: BEST}){ edges{ node{ title brief url publishedAt reactionCount responseCount tags{ name } } } } }`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 12000);
  try {
    const r = await fetch(GQL, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: cfg.apiKey } : {}) },
      body: JSON.stringify({ query, variables: { first: Math.min(limit * 2, 30) } }),
    });
    if (!r.ok) return disabled('hashnode', `Hashnode fetch failed (${r.status}).`);
    const j = await r.json();
    const edges = j?.data?.feed?.edges || [];
    let nodes = edges.map((e) => e.node).filter((n) => n && n.title);
    if (tags.length) {
      const want = new Set(tags.map((x) => x.toLowerCase()));
      const filtered = nodes.filter((n) => (n.tags || []).some((tg) => want.has((tg.name || '').toLowerCase())));
      if (filtered.length) nodes = filtered;
    }
    const signals = nodes.slice(0, limit).map((n) => normalizeCommunitySignal({
      source: 'hashnode',
      sourceUrl: n.url || '',
      sourceId: n.url || n.title,
      sourceCommunity: 'Hashnode',
      title: n.title,
      body: n.brief || n.title,
      tags: (n.tags || []).map((tg) => tg.name),
      engagement: { reactions: n.reactionCount || 0, comments: n.responseCount || 0 },
      createdAt: n.publishedAt || null,
    }));
    return ok('hashnode', signals);
  } catch (e) {
    return disabled('hashnode', `Hashnode error (${e?.name === 'AbortError' ? 'timeout' : 'fetch_failed'}).`);
  } finally { clearTimeout(t); }
}

export default { fetchHashnode };
