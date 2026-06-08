import { normalizeSignal, sanitizeText } from '../utils.js';

const API = 'https://api.github.com/search/issues';

function buildGitHubQuery(input = {}) {
  const parts = [input.problem, input.domain, input.technology, input.goal].filter(Boolean).join(' ');
  const q = parts || 'developer productivity automation';
  return `${q} is:issue (label:enhancement OR label:bug OR label:feature OR label:feature-request) comments:>1`;
}

export async function fetchGitHubIssueSignals(input = {}, { limit = 12, timeoutMs = 9000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${API}?q=${encodeURIComponent(buildGitHubQuery(input))}&sort=updated&order=desc&per_page=${Math.min(30, Math.max(5, limit))}`;
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'career-autopilot-problem-intelligence' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`github_${res.status}`);
    const data = await res.json();
    return (data.items || []).slice(0, limit).map((it) => normalizeSignal({
      source: 'github',
      sourceId: String(it.id || it.node_id || it.html_url),
      sourceUrl: it.html_url,
      title: it.title,
      contentSummary: sanitizeText(it.body || '', 1400),
      tags: (it.labels || []).map((l) => l.name).filter(Boolean),
      engagement: { comments: it.comments || 0, reactions: it.reactions?.total_count || 0, score: it.score || 0 },
      sourceCreatedAt: it.created_at,
      lastActivityAt: it.updated_at,
      domain: input.domain,
      technology: input.technology,
      targetUser: input.targetUser,
    }));
  } finally {
    clearTimeout(timer);
  }
}
