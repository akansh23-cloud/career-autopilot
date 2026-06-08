/* Product Hunt via GraphQL API. ONLY runs when PRODUCTHUNT_TOKEN (or
   PRODUCT_HUNT_TOKEN) is set — otherwise returns [] so the engine falls back
   to other sources / seed ideas. Never called from the frontend. */
export async function fetchProductHunt({ timeoutMs = 8000 } = {}) {
  const token = process.env.PRODUCTHUNT_TOKEN || process.env.PRODUCT_HUNT_TOKEN;
  if (!token) return [];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const query = `query { posts(order: VOTES, first: 20) { edges { node { id name tagline description url votesCount topics { edges { node { name } } } } } } }`;
    const r = await fetch('https://api.producthunt.com/v2/api/graphql', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'career-autopilot' },
      body: JSON.stringify({ query }),
    });
    if (!r.ok) return [];
    const data = await r.json().catch(() => null);
    const edges = data?.data?.posts?.edges || [];
    return edges.map((e) => e.node).filter((n) => n && n.name).map((n) => ({
      source: 'producthunt',
      sourceId: String(n.id),
      sourceUrl: n.url || '',
      sourceTitle: n.name,
      sourceDescription: (n.description || n.tagline || '').slice(0, 600),
      votes: n.votesCount || 0,
      topics: (n.topics?.edges || []).map((te) => te.node?.name).filter(Boolean),
      createdAt: null,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

export default { fetchProductHunt };
