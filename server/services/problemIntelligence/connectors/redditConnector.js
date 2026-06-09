/* ============================================================
   Connector — Reddit  (OFFICIAL OAuth API only)
   ------------------------------------------------------------
   Disabled unless REDDIT_DISCOVERY_ENABLED=1 AND client creds
   are present. NEVER scrapes HTML. NEVER stores usernames. Used
   purely as a community discussion signal; a Reddit-only signal
   is always labelled "needs validation" downstream.
   ============================================================ */
import { fetchJSON } from '../util.js';
import { normalizeCommunitySignal, ok, disabled } from './communityCommon.js';

const SENSITIVE_SUB = /(suicide|depression|anxiety|mentalhealth|addiction|relationship|divorce|medical|health|legaladvice|personalfinance)/i;

let tokenCache = { token: '', exp: 0 };

async function tokenViaPost(reddit, timeoutMs) {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  const basic = Buffer.from(`${reddit.clientId}:${reddit.clientSecret}`).toString('base64');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 12000);
  try {
    const r = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Basic ${basic}`, 'User-Agent': reddit.userAgent, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.access_token) return null;
    tokenCache = { token: j.access_token, exp: Date.now() + Math.max(60, (j.expires_in || 3600) - 60) * 1000 };
    return tokenCache.token;
  } catch { return null; } finally { clearTimeout(t); }
}

export async function fetchReddit(ctx = {}, opts = {}) {
  const reddit = (opts.cfg && opts.cfg.reddit) || {};
  if (!reddit.enabled) return disabled('reddit', 'Reddit source is disabled. Add official Reddit API credentials and set REDDIT_DISCOVERY_ENABLED=1.');
  if (!reddit.clientId || !reddit.clientSecret) return disabled('reddit', 'Reddit credentials missing (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET).');

  const token = await tokenViaPost(reddit, opts.timeoutMs);
  if (!token) return disabled('reddit', 'Reddit authentication failed.');

  const subs = (ctx.communities?.redditSubreddits || []).filter((s) => !SENSITIVE_SUB.test(s));
  const query = [ctx.goal, ctx.technology, ctx.domain].filter(Boolean).join(' ') || ctx.keywords || '';
  const limit = Math.min(opts.limit || 10, 20);
  const path = subs.length
    ? `https://oauth.reddit.com/r/${encodeURIComponent(subs[0])}/search?restrict_sr=1&sort=top&t=year&limit=${limit}&q=${encodeURIComponent(query)}`
    : `https://oauth.reddit.com/search?sort=top&t=year&limit=${limit}&q=${encodeURIComponent(query)}`;

  const res = await fetchJSON(path, { timeoutMs: opts.timeoutMs || 12000, maxBytes: opts.maxBytes, headers: { Authorization: `Bearer ${token}`, 'User-Agent': reddit.userAgent } });
  if (!res.ok) return disabled('reddit', `Reddit fetch failed (${res.status || res.error}).`);

  let data;
  try { data = JSON.parse(res.text); } catch { return disabled('reddit', 'Reddit returned malformed data.'); }
  const children = data?.data?.children || [];

  const signals = children
    .map((c) => c.data)
    .filter((d) => d && d.title && !SENSITIVE_SUB.test(d.subreddit || '') && !d.over_18)
    .map((d) => normalizeCommunitySignal({
      source: 'reddit',
      sourceUrl: d.permalink ? `https://www.reddit.com${d.permalink}` : '',
      sourceId: d.id,
      sourceCommunity: `r/${d.subreddit}`, // community name only — never the username
      title: d.title,
      body: (d.selftext || '').slice(0, 1000), // summarized + neutralized downstream; never the author
      tags: [d.link_flair_text].filter(Boolean),
      engagement: { score: d.score || 0, comments: d.num_comments || 0 },
      createdAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
    }));

  return ok('reddit', signals.slice(0, limit));
}

export default { fetchReddit };
