/* ============================================================
   GITHUB API CLIENT  (server-side only)
   ------------------------------------------------------------
   WHY THIS EXISTS
   Unauthenticated GitHub allows 60 requests/hour PER IP. That is
   the server's IP, shared by every student on the platform. Proof
   verification makes up to 5 calls per run, so anonymous access
   supports roughly a dozen verifications an hour across the whole
   product before everything starts returning 403.

   With a token (classic PAT, `public_repo` scope, or a GitHub App
   installation token) the limit is 5,000/hour. That is the
   difference between a feature that works and one that falls over
   the first time two students verify at once.

   DESIGN RULES
   - The token is OPTIONAL. Missing token must never fail a
     student's proof — it degrades to `unavailable`, which the
     validator turns into `pending`, never `failed`.
   - Rate-limit exhaustion is also `unavailable`, never `failed`.
     We do not punish students for our infrastructure limits.
   - Responses are cached per repo so one verification run costing
     5 calls does not cost 5 more when the student clicks again.
   ============================================================ */

import logger from '../../../logger.js';

const API = 'https://api.github.com';
const UA = 'career-autopilot-verifier';
const TIMEOUT_MS = 9000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/* token is read lazily so tests can set it per-case */
function token() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
}

export function hasGithubToken() {
  return !!token();
}

/* ---------------- tiny TTL cache ---------------- */
const cache = new Map(); // path -> { at, value }

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.value;
}

function cacheSet(key, value) {
  // Bound the cache so a long-running server cannot grow it without limit.
  if (cache.size > 500) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
    for (const [k] of oldest) cache.delete(k);
  }
  cache.set(key, { at: Date.now(), value });
}

export function clearGithubCache() { cache.clear(); }

/* ---------------- core request ---------------- */

/**
 * GET a GitHub API path.
 * Returns { ok, status, data, unavailable, reason }.
 *   unavailable=true  -> could not check (rate limit, network, no token needed
 *                        but blocked). Caller must treat as pending.
 *   ok=true, status=404 -> definitively absent. That IS a real answer.
 */
export async function ghGet(path, { allowCache = true } = {}) {
  const key = path;
  if (allowCache) {
    const hit = cacheGet(key);
    if (hit) return hit;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = {
      'User-Agent': UA,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;

    const res = await fetch(`${API}${path}`, { headers, signal: controller.signal });

    // 403 with a zero remaining header is rate limiting, not permission denial.
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (res.status === 403 || res.status === 429) {
      const isRateLimit = remaining === '0' || res.status === 429;
      if (isRateLimit) {
        logger.warn(
          `[github] rate limit hit on ${path}${t ? '' : ' (no GITHUB_TOKEN configured — anonymous limit is 60/hour for the whole server)'}`,
        );
      }
      const out = {
        ok: false, status: res.status, data: null, unavailable: true,
        reason: isRateLimit ? 'rate_limited' : 'forbidden',
      };
      return out; // never cached — we want a retry to actually retry
    }

    if (res.status === 404) {
      const out = { ok: true, status: 404, data: null, unavailable: false, reason: 'not_found' };
      if (allowCache) cacheSet(key, out);
      return out;
    }

    if (!res.ok) {
      return { ok: false, status: res.status, data: null, unavailable: true, reason: 'error' };
    }

    const data = await res.json();
    const out = { ok: true, status: res.status, data, unavailable: false, reason: '' };
    if (allowCache) cacheSet(key, out);
    return out;
  } catch (e) {
    // Timeout, DNS, offline — all "could not check", never "student failed".
    return { ok: false, status: 0, data: null, unavailable: true, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/* Fetch a raw file (README markdown etc.) rather than JSON metadata. */
export async function ghGetRaw(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { 'User-Agent': UA, Accept: 'application/vnd.github.raw' };
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;
    const res = await fetch(`${API}${path}`, { headers, signal: controller.signal });
    if (res.status === 404) return { ok: true, status: 404, text: '', unavailable: false };
    if (!res.ok) return { ok: false, status: res.status, text: '', unavailable: true };
    return { ok: true, status: res.status, text: await res.text(), unavailable: false };
  } catch {
    return { ok: false, status: 0, text: '', unavailable: true };
  } finally {
    clearTimeout(timer);
  }
}

export const UNAVAILABLE_NOTE = hasGithubToken
  ? 'The GitHub check could not run just now. This stays pending — nothing was marked failed.'
  : 'The GitHub check could not run just now. This stays pending — nothing was marked failed.';

export default { ghGet, ghGetRaw, hasGithubToken, clearGithubCache };
