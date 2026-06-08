/* ============================================================
   Connector — GitHub public issues  (official REST Search API)
   ------------------------------------------------------------
   Uses GET /search/issues. Authenticated when GITHUB_TOKEN is
   set (higher rate limit); otherwise falls back to public,
   unauthenticated mode. NEVER requests repo/public_repo OAuth
   scopes and never reads private repositories — public search
   only. Returns NORMALIZED signal objects; on any error / bad
   response it returns [] so discovery degrades gracefully.
   ============================================================ */
import { fetchJSON, sanitizeText, sha1, extractKeywords, parseLooseJSON } from '../util.js';

const API = 'https://api.github.com/search/issues';

function buildQuery({ domain, technology, goal, keywords }) {
  const terms = [domain, technology, goal, keywords].filter(Boolean).join(' ').trim();
  // Public issues only, exclude pull requests, ignore closed-and-stale noise.
  const q = `${terms || 'developer tooling'} is:issue is:public`;
  return q.slice(0, 240);
}

export async function fetchGithubIssues(input = {}, { token = '', timeoutMs = 12000, limit = 12, maxBytes = 2_000_000 } = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const q = buildQuery(input);
  const url = `${API}?q=${encodeURIComponent(q)}&sort=reactions&order=desc&per_page=${Math.min(Number(limit) || 12, 30)}`;

  const res = await fetchJSON(url, { headers, timeoutMs, maxBytes });
  if (!res.ok) {
    return { ok: false, source: 'github', mode: token ? 'authenticated' : 'public', signals: [], warning: githubWarning(res, token) };
  }
  const data = parseLooseJSON(res.text);
  const items = Array.isArray(data?.items) ? data.items : [];
  const signals = items
    .filter((it) => it && !it.pull_request) // exclude PRs defensively
    .map((it) => normalize(it))
    .filter(Boolean);
  return { ok: true, source: 'github', mode: token ? 'authenticated' : 'public', signals, rateRemaining: res.text ? null : null };
}

function normalize(it) {
  const title = sanitizeText(it.title, 280);
  if (!title) return null;
  const body = sanitizeText(it.body, 1200);
  const tags = [
    ...(Array.isArray(it.labels) ? it.labels.map((l) => sanitizeText(typeof l === 'string' ? l : l?.name, 40)) : []),
    ...extractKeywords(`${title} ${body}`, 6),
  ].filter(Boolean).slice(0, 12);
  return {
    source: 'github',
    sourceId: String(it.id || it.number || sha1(it.html_url || title)),
    sourceUrl: typeof it.html_url === 'string' ? it.html_url.slice(0, 500) : '',
    title,
    contentSummary: body || title,
    rawTextHash: sha1(`${title}\n${body}`),
    tags,
    engagement: {
      comments: Number(it.comments) || 0,
      reactions: Number(it.reactions?.total_count) || 0,
      state: it.state || 'open',
    },
    sourceCreatedAt: it.created_at ? new Date(it.created_at) : null,
    lastActivityAt: it.updated_at ? new Date(it.updated_at) : null,
  };
}

function githubWarning(res, token) {
  if (res.status === 403) return token ? 'GitHub rate limit hit — try again shortly.' : 'GitHub public rate limit reached. Add GITHUB_TOKEN for higher limits.';
  if (res.status === 422) return 'GitHub rejected the search query.';
  if (res.error === 'timeout') return 'GitHub request timed out.';
  return `GitHub source unavailable (status ${res.status}).`;
}

export default { fetchGithubIssues };
