/* ============================================================
   PROOF VERIFICATION  —  GitHub + deployment evidence
   ------------------------------------------------------------
   Turns the two "coming next" proof types into real, honest checks.

   Design rules (unchanged from v1's spirit):
     - Nothing is auto-passed. A check passes only when a live network
       observation supports it.
     - No evidence attached  ->  status stays `pending` with an
       instruction telling the student exactly what to attach.
     - A check that cannot run (network blocked, timeout, rate limit)
       returns `pending`, never `failed` and never `verified`. We do not
       punish a student for our outage, and we never fake a pass.
     - Only public, unauthenticated GitHub data is read here. The
       authenticated GitHub App path (githubIntegrationEngine.js) stays
       the source of truth for private repos.
   ============================================================ */

const UA = 'career-autopilot-verifier';
const TIMEOUT_MS = 9000;

async function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...options,
      signal: controller.signal,
      headers: { 'User-Agent': UA, ...(options.headers || {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

export function parseRepoUrl(raw = '') {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2], fullName: `${m[1]}/${m[2]}` };
}

export function normalizeUrl(raw = '') {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { return new URL(s).toString(); } catch { return null; }
}

/* ---------------- GitHub ---------------- */

/**
 * Check a public repo: does it exist, is it reachable, does it have a
 * meaningful README, does it have CI workflows, when was it last pushed.
 * Returns { ok, reachable, ...signals, note }.
 */
export async function verifyGithubRepo(repoUrl) {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    return { ok: false, reachable: false, reason: 'bad_url', note: 'That does not look like a GitHub repository URL. Use the form https://github.com/your-name/your-repo.' };
  }
  try {
    const r = await timedFetch(`https://api.github.com/repos/${parsed.fullName}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (r.status === 404) {
      return { ok: true, reachable: false, fullName: parsed.fullName, reason: 'not_found', note: 'That repository is private or does not exist. Make it public, or connect the GitHub App so we can read it with your permission.' };
    }
    if (r.status === 403) {
      return { ok: false, reachable: false, fullName: parsed.fullName, reason: 'rate_limited', note: 'GitHub rate-limited the check. This stays pending — try again in a few minutes.' };
    }
    if (!r.ok) {
      return { ok: false, reachable: false, fullName: parsed.fullName, reason: 'error', note: 'GitHub could not be reached for this check. It stays pending.' };
    }
    const repo = await r.json();

    /* README presence + substance. A one-line README is not proof. */
    let readmePresent = false;
    let readmeBytes = 0;
    let readmeMeaningful = false;
    try {
      const rr = await timedFetch(`https://api.github.com/repos/${parsed.fullName}/readme`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (rr.ok) {
        const meta = await rr.json();
        readmePresent = true;
        readmeBytes = Number(meta.size || 0);
        readmeMeaningful = readmeBytes >= 400; // ~a real intro + how-to-run
      }
    } catch { /* readme check is best-effort */ }

    /* CI workflows. */
    let ciPresent = false;
    try {
      const cr = await timedFetch(`https://api.github.com/repos/${parsed.fullName}/contents/.github/workflows`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (cr.ok) {
        const files = await cr.json();
        ciPresent = Array.isArray(files) && files.some((f) => /\.ya?ml$/i.test(f.name || ''));
      }
    } catch { /* best-effort */ }

    return {
      ok: true,
      reachable: true,
      fullName: repo.full_name || parsed.fullName,
      htmlUrl: repo.html_url || `https://github.com/${parsed.fullName}`,
      isPrivate: !!repo.private,
      defaultBranch: repo.default_branch || 'main',
      pushedAt: repo.pushed_at || null,
      stars: Number(repo.stargazers_count || 0),
      language: repo.language || '',
      readmePresent,
      readmeBytes,
      readmeMeaningful,
      ciPresent,
      checkedAt: new Date().toISOString(),
      note: 'Public repository read successfully.',
    };
  } catch (e) {
    return { ok: false, reachable: false, fullName: parsed.fullName, reason: 'network', note: 'The GitHub check could not complete (network or timeout). It stays pending — nothing was marked verified.' };
  }
}

/* ---------------- Deployment ---------------- */

/**
 * Check a deployed URL is actually serving something. Mirrors the logic of
 * POST /api/projects/verify-live-link so both paths agree.
 */
export async function verifyDeployment(liveUrl) {
  const url = normalizeUrl(liveUrl);
  if (!url) {
    return { ok: false, reachable: false, reason: 'bad_url', note: 'That does not look like a valid URL. Include the full address, e.g. https://your-app.vercel.app' };
  }
  const started = Date.now();
  try {
    const r = await timedFetch(url, { method: 'GET' });
    const responseTimeMs = Date.now() - started;
    const statusCode = r.status;
    const contentType = r.headers.get('content-type') || '';
    const reachable = statusCode >= 200 && statusCode < 400;
    let title = '';
    let looksLikeApp = false;
    if (/text\/html/i.test(contentType)) {
      const body = await r.text().catch(() => '');
      const m = body.match(/<title[^>]*>([^<]*)<\/title>/i);
      if (m) title = m[1].trim().slice(0, 160);
      looksLikeApp = body.length > 400 && /<(div|main|section|app|script|header)/i.test(body);
    } else if (contentType) {
      looksLikeApp = true;
    }
    return {
      ok: true,
      reachable,
      statusCode,
      finalUrl: r.url || url,
      responseTimeMs,
      contentType,
      title,
      looksLikeApp,
      checkedAt: new Date().toISOString(),
      note: reachable
        ? (looksLikeApp ? 'The deployment responded with a real page.' : 'The page loaded but looks empty — confirm the deployment is actually serving your app.')
        : `The deployment responded with HTTP ${statusCode}.`,
    };
  } catch {
    return {
      ok: false, reachable: false, reason: 'unreachable', finalUrl: url,
      responseTimeMs: Date.now() - started,
      note: 'Could not reach that URL (timeout, DNS or network restriction). It stays pending — nothing was marked verified.',
    };
  }
}

/**
 * Run whatever checks the attached evidence supports.
 * evidence: { repoUrl, liveUrl }
 * Returns { github, deployment } — either may be null when no evidence given.
 */
export async function gatherProofEvidence(evidence = {}) {
  const repoUrl = String(evidence.repoUrl || '').trim();
  const liveUrl = String(evidence.liveUrl || '').trim();
  const [github, deployment] = await Promise.all([
    repoUrl ? verifyGithubRepo(repoUrl) : Promise.resolve(null),
    liveUrl ? verifyDeployment(liveUrl) : Promise.resolve(null),
  ]);
  return { github, deployment, repoUrl: repoUrl || null, liveUrl: liveUrl || null };
}

export default { verifyGithubRepo, verifyDeployment, gatherProofEvidence, parseRepoUrl, normalizeUrl };
