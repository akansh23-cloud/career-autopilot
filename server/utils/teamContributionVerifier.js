/* ============================================================
   TEAM CONTRIBUTION VERIFIER
   ------------------------------------------------------------
   Reads real commit attribution for a team repository, so per-member
   progress rests on evidence rather than self-report.

   Reuses the existing GitHub client (server/utils/workspace/githubClient.js)
   so it inherits the installation token, rate-limit handling and the
   three-outcome contract used everywhere else in the proof pipeline:

       present      -> we read it
       absent       -> we read it and there is nothing there
       unavailable  -> we could NOT read it (rate limit / private / no token)

   `unavailable` must never be scored as zero contribution. A student is
   never penalised for our infrastructure — teamProgressEngine drops the
   commit term entirely in that case and lets modules carry full weight.
   ============================================================ */

import { ghGet } from './workspace/githubClient.js';
import { parseRepoUrl } from './workspace/proofVerification.js';

const lower = (s) => String(s || '').trim().toLowerCase();

/**
 * Fetch per-contributor commit counts for a repo.
 * Returns { unavailable, contributors: [{ login, count, avatarUrl, htmlUrl }], reason }.
 *
 * Uses /contributors rather than /stats/contributors: the stats endpoint
 * returns 202 while GitHub computes the cache, which makes a coordinator's
 * "sync" button non-deterministic on a fresh repo.
 */
export async function fetchContributors(repoUrl) {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    return { unavailable: false, contributors: [], reason: 'bad_url',
      note: 'That does not look like a GitHub repository URL.' };
  }

  const r = await ghGet(`/repos/${parsed.fullName}/contributors?per_page=100&anon=0`);

  if (r.unavailable) {
    return { unavailable: true, contributors: [], reason: r.reason, fullName: parsed.fullName,
      note: r.reason === 'rate_limited'
        ? 'GitHub rate-limited this read. Commit attribution stays pending — nobody was marked as inactive.'
        : 'Commit attribution could not be read just now. It stays pending — nothing was marked failed.' };
  }
  if (r.status === 404) {
    return { unavailable: false, contributors: [], reason: 'not_found', fullName: parsed.fullName,
      note: 'The repository is private or does not exist, so per-member commits cannot be read. Ask the team to make it public.' };
  }
  if (r.status === 204 || !Array.isArray(r.data)) {
    return { unavailable: false, contributors: [], reason: 'empty', fullName: parsed.fullName,
      note: 'The repository has no commit history yet.' };
  }

  const contributors = r.data
    .filter((c) => c && c.login)
    .map((c) => ({
      login: c.login,
      count: Number(c.contributions || 0),
      avatarUrl: c.avatar_url || '',
      htmlUrl: c.html_url || `https://github.com/${c.login}`,
    }))
    .sort((a, b) => b.count - a.count);

  return { unavailable: false, contributors, reason: '', fullName: parsed.fullName,
    note: `Read ${contributors.length} contributor${contributors.length === 1 ? '' : 's'} from ${parsed.fullName}.` };
}

/**
 * Best-effort last-commit timestamp per author. One extra call, capped, so a
 * coordinator can see "last active" rather than only a total. Failure here is
 * non-fatal — counts alone are still useful.
 */
export async function fetchLastCommitDates(repoUrl, logins = [], { max = 8 } = {}) {
  const parsed = parseRepoUrl(repoUrl);
  const out = {};
  if (!parsed) return out;
  for (const login of logins.slice(0, max)) {
    try {
      const r = await ghGet(`/repos/${parsed.fullName}/commits?author=${encodeURIComponent(login)}&per_page=1`);
      if (r.unavailable || !Array.isArray(r.data) || !r.data.length) continue;
      const when = r.data[0]?.commit?.author?.date || r.data[0]?.commit?.committer?.date || null;
      if (when) out[login] = when;
    } catch { /* non-fatal */ }
  }
  return out;
}

/* ---------------------------------------------------------------- */
/* Login -> student matching                                         */
/* ---------------------------------------------------------------- */

/**
 * Build a resolver mapping a GitHub contributor to a studentId.
 *
 * Match order (most reliable first):
 *   1. An explicitly linked GitHub username on the student record
 *      (githubUsername / githubLogin / github.login) — the only exact match.
 *   2. A previously-confirmed login already stored in memberProgress.
 *   3. Email local-part equals the login.
 *   4. Name slug equals the login (e.g. "Akansh Sharma" -> "akanshsharma").
 *
 * Anything unmatched is REPORTED, not guessed. A wrong attribution is worse
 * than a missing one — it tells a coordinator a student contributed nothing
 * when in fact we just failed to identify them.
 */
export function buildMemberMatcher(project = {}) {
  const members = project.members || [];
  const progress = project.memberProgress || {};

  const byLogin = new Map();
  const byEmailLocal = new Map();
  const byNameSlug = new Map();

  for (const m of members) {
    const id = String(m.studentId || '');
    if (!id) continue;
    const explicit = lower(m.githubUsername || m.githubLogin || m.github?.login || '');
    if (explicit) byLogin.set(explicit, id);

    const confirmed = lower(progress[id]?.commits?.login || '');
    if (confirmed) byLogin.set(confirmed, id);

    const local = lower(String(m.email || '').split('@')[0]);
    if (local) byEmailLocal.set(local, id);

    const slug = lower(m.name).replace(/[^a-z0-9]/g, '');
    if (slug) byNameSlug.set(slug, id);
  }

  return function matchMember(contributor) {
    const login = lower(contributor?.login);
    if (!login) return null;
    return byLogin.get(login)
      || byEmailLocal.get(login)
      || byNameSlug.get(login.replace(/[^a-z0-9]/g, ''))
      || null;
  };
}

/**
 * One call the route can use: read contributors, attach last-commit dates,
 * and return everything the engine needs.
 */
export async function readTeamContributions(project = {}) {
  const repoUrl = project.submission?.repoUrl || '';
  if (!repoUrl) {
    return { unavailable: false, contributors: [], reason: 'no_repo',
      note: 'The team has not submitted a repository URL yet, so commits cannot be attributed.' };
  }

  const base = await fetchContributors(repoUrl);
  if (base.unavailable || !base.contributors.length) return base;

  const dates = await fetchLastCommitDates(repoUrl, base.contributors.map((c) => c.login));
  return {
    ...base,
    contributors: base.contributors.map((c) => ({ ...c, lastCommitAt: dates[c.login] || null })),
  };
}

export default { fetchContributors, fetchLastCommitDates, buildMemberMatcher, readTeamContributions };
