/* GitHub trending repos via the public Search API. GITHUB_TOKEN (optional)
   raises rate limits. Best-effort: returns [] on failure. */
export async function fetchGithubTrends({ timeoutMs = 8000, days = 14 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const headers = { 'User-Agent': 'career-autopilot', Accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const r = await fetch(
      `https://api.github.com/search/repositories?q=created:%3E${since}&sort=stars&order=desc&per_page=20`,
      { signal: ctrl.signal, headers }
    );
    if (!r.ok) return [];
    const data = await r.json().catch(() => null);
    const items = (data && data.items) || [];
    return items.filter((it) => it.full_name).map((it) => ({
      source: 'github',
      sourceId: String(it.id),
      sourceUrl: it.html_url,
      sourceTitle: it.full_name,
      sourceDescription: (it.description || '').slice(0, 600),
      stars: it.stargazers_count || 0,
      language: it.language || '',
      topics: it.topics || [],
      createdAt: it.created_at || null,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

export default { fetchGithubTrends };
