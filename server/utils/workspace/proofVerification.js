/* ============================================================
   PROOF VERIFICATION
   ------------------------------------------------------------
   Turns student-supplied evidence into observations. It does NOT
   decide status — workspaceValidator does that. This file only
   reports what was seen.

   THREE OUTCOMES, always distinguishable:
     present/reachable  -> a real positive observation
     absent             -> a real negative observation (e.g. 404)
     unavailable        -> we could not check (rate limit, timeout,
                           network). Must become `pending`, never
                           `failed`. Never punish a student for our
                           infrastructure.

   Everything that fetches a student-supplied URL goes through
   ssrfGuard.
   ============================================================ */

import { ghGet, ghGetRaw, hasGithubToken } from './githubClient.js';
import { safeFetch } from './ssrfGuard.js';
import { parseTestOutput } from './testOutputParser.js';

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;
const SCREENSHOT_DIRS = ['docs/screenshots', 'screenshots', 'docs/images', 'assets/screenshots'];

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
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try { return new URL(s).toString(); } catch { return null; }
}

/* ---------------- GitHub: repo, README, screenshots, CI ---------------- */

export async function verifyGithubRepo(repoUrl) {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    return { checked: true, unavailable: false, present: false, reason: 'bad_url',
      note: 'That does not look like a GitHub repository URL. Use https://github.com/your-name/your-repo.' };
  }

  const r = await ghGet(`/repos/${parsed.fullName}`);
  if (r.unavailable) {
    return { checked: false, unavailable: true, fullName: parsed.fullName, reason: r.reason,
      note: r.reason === 'rate_limited'
        ? 'GitHub rate-limited this check. It stays pending — try again shortly.'
        : 'The GitHub check could not run just now. It stays pending — nothing was marked failed.' };
  }
  if (r.status === 404) {
    return { checked: true, unavailable: false, present: false, fullName: parsed.fullName, reason: 'not_found',
      note: 'That repository is private or does not exist. Make it public so recruiters (and we) can read it.' };
  }

  const repo = r.data || {};
  const out = {
    checked: true, unavailable: false, present: true,
    fullName: repo.full_name || parsed.fullName,
    htmlUrl: repo.html_url || `https://github.com/${parsed.fullName}`,
    isPrivate: !!repo.private,
    defaultBranch: repo.default_branch || 'main',
    pushedAt: repo.pushed_at || null,
    language: repo.language || '',
    size: Number(repo.size || 0),
    checkedAt: new Date().toISOString(),
  };
  // A repo containing only a README is not a project. `size` is in KB.
  out.hasSource = out.size > 20;
  out.note = `Public repository ${out.fullName} read successfully${out.pushedAt ? `, last pushed ${String(out.pushedAt).slice(0, 10)}` : ''}.`;
  return out;
}

/** README must be substantial AND actually explain how to run the thing. */
export async function verifyReadme(repoUrl) {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) return { checked: true, unavailable: false, present: false, note: 'No valid repository URL attached.' };

  const meta = await ghGet(`/repos/${parsed.fullName}/readme`);
  if (meta.unavailable) return { checked: false, unavailable: true, note: 'The README check could not run just now. It stays pending.' };
  if (meta.status === 404) {
    return { checked: true, unavailable: false, present: false,
      note: 'No README.md found in the repository root. Add one covering what the project does, why, and how to run it.' };
  }

  const raw = await ghGetRaw(`/repos/${parsed.fullName}/readme`);
  const text = raw.text || '';
  const bytes = Number(meta.data?.size || text.length || 0);

  // Size alone is a weak signal — a wall of boilerplate passes it. Look for
  // structure and a run instruction instead.
  const headings = (text.match(/^#{2,3}\s+\S/gm) || []).length;
  const hasRunInstructions = /npm\s+(install|i|run|start|test)|yarn\s+|pnpm\s+|docker\s+(run|compose)|pip\s+install|getting started|how to run|quick ?start/i.test(text);
  const imageRefs = (text.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length;

  const meaningful = bytes >= 400 && headings >= 2 && hasRunInstructions;
  const missing = [];
  if (bytes < 400) missing.push('more detail');
  if (headings < 2) missing.push('section headings');
  if (!hasRunInstructions) missing.push('setup / run instructions');

  return {
    checked: true, unavailable: false, present: true, meaningful,
    bytes, headings, hasRunInstructions, imageRefs,
    note: meaningful
      ? `README.md looks substantial (${bytes} bytes, ${headings} sections, run instructions present).`
      : `README.md exists but needs ${missing.join(' and ')}.`,
  };
}

/** Screenshots live in the repo — verifiable, and recruiters see them. */
export async function verifyScreenshots(repoUrl, readmeResult = null) {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) return { checked: true, unavailable: false, present: false, count: 0, note: 'No valid repository URL attached.' };

  // Checked in PARALLEL, not in sequence. Four sequential lookups at 4s each
  // is 16s of wall clock — on its own more than a serverless function gets.
  const results = await Promise.all(
    SCREENSHOT_DIRS.map((dir) => ghGet(`/repos/${parsed.fullName}/contents/${dir}`).then((r) => ({ dir, r }))),
  );

  let images = [];
  let foundDir = '';
  let sawUnavailable = results.some(({ r }) => r.unavailable);

  for (const { dir, r } of results) {           // preserve preference order
    if (r.unavailable || r.status === 404 || !Array.isArray(r.data)) continue;
    const found = r.data.filter((f) => f.type === 'file' && IMAGE_RE.test(f.name || '') && Number(f.size || 0) > 1024);
    if (found.length) {
      foundDir = dir;
      images = found.map((f) => ({ name: f.name, size: f.size, url: f.html_url }));
      break;
    }
  }

  if (!images.length && sawUnavailable) {
    return { checked: false, unavailable: true, note: 'The screenshot check could not run just now. It stays pending.' };
  }

  const inReadme = readmeResult?.imageRefs || 0;
  const count = images.length;
  const enough = count >= 2;
  const embedded = inReadme >= 1;

  let note;
  if (!count) {
    note = 'No screenshots found. Commit at least 2 images to docs/screenshots/ and embed one in your README so recruiters see the app immediately.';
  } else if (!enough) {
    note = `Only ${count} screenshot found in ${foundDir}/. Add at least 2 showing real flows.`;
  } else if (!embedded) {
    note = `${count} screenshots found in ${foundDir}/, but none are embedded in the README. Add one so it renders on the repo page.`;
  } else {
    note = `${count} screenshots in ${foundDir}/ and ${inReadme} embedded in the README.`;
  }

  return { checked: true, unavailable: false, present: count > 0, count, enough, embedded, dir: foundDir, images, note };
}

/** A green CI run is the only path from "pasted output" to real proof. */
export async function verifyCiRun(repoUrl) {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) return { checked: true, unavailable: false, present: false, note: 'No valid repository URL attached.' };

  const wf = await ghGet(`/repos/${parsed.fullName}/contents/.github/workflows`);
  if (wf.unavailable) return { checked: false, unavailable: true, note: 'The CI check could not run just now.' };
  const hasWorkflow = wf.status !== 404 && Array.isArray(wf.data) && wf.data.some((f) => /\.ya?ml$/i.test(f.name || ''));
  if (!hasWorkflow) {
    return { checked: true, unavailable: false, present: false, hasWorkflow: false,
      note: 'No workflow found under .github/workflows. Add one that runs your tests on every push and this becomes automatically verified.' };
  }

  const runs = await ghGet(`/repos/${parsed.fullName}/actions/runs?per_page=10`, { allowCache: false });
  if (runs.unavailable) return { checked: false, unavailable: true, hasWorkflow: true, note: 'The CI run check could not complete. It stays pending.' };

  const list = runs.data?.workflow_runs || [];
  const success = list.find((x) => x.conclusion === 'success' && x.status === 'completed');
  if (!success) {
    const latest = list[0];
    return { checked: true, unavailable: false, present: false, hasWorkflow: true,
      note: latest
        ? `A workflow exists but the most recent run finished as "${latest.conclusion || latest.status}". Get it green and this verifies automatically.`
        : 'A workflow exists but has not run yet. Push a commit to trigger it.' };
  }

  return {
    checked: true, unavailable: false, present: true, hasWorkflow: true,
    runUrl: success.html_url, sha: success.head_sha, branch: success.head_branch,
    finishedAt: success.updated_at,
    note: `CI run passed on ${success.head_branch || 'default branch'} (${String(success.head_sha || '').slice(0, 7)}).`,
  };
}

/* ---------------- Deployment ---------------- */

/* Hosting-platform failure pages return HTTP 200 with real HTML. Without
   these signatures a dead deployment verifies clean — the bug in v6, whose
   check was only `body.length > 400 && /<div|script/`. */
const FAILURE_SIGNATURES = [
  [/DEPLOYMENT_NOT_FOUND|The deployment could not be found/i, 'Vercel reports that this deployment does not exist.'],
  [/Page Not Found[\s\S]{0,200}Netlify|Netlify[\s\S]{0,200}Page Not Found/i, 'Netlify is serving its 404 page.'],
  [/no-such-app|herokucdn\.com\/error-pages/i, 'Heroku reports there is no such app.'],
  [/Service Suspended|This service has been suspended/i, 'The hosting service has suspended this deployment.'],
  [/There isn't a GitHub Pages site here/i, 'GitHub Pages has no site at that address.'],
  [/Application error[\s\S]{0,120}client-side exception/i, 'The app loaded but crashed with a client-side exception.'],
  [/This domain is (parked|for sale)|Buy this domain/i, 'That is a parked domain, not a deployment.'],
  [/Welcome to nginx|Apache2 [\s\S]{0,40}Default Page|Default Web Site Page/i, 'That is a default web-server page — nothing is deployed on it.'],
  [/Build failed|Deployment failed/i, 'The hosting platform reports a failed build.'],
];

export async function verifyDeployment(liveUrl) {
  const url = normalizeUrl(liveUrl);
  if (!url) {
    return { checked: true, unavailable: false, reachable: false, reason: 'bad_url',
      note: 'That does not look like a valid URL. Include the full address, e.g. https://your-app.vercel.app' };
  }

  const started = Date.now();
  const r = await safeFetch(url);
  const responseTimeMs = Date.now() - started;

  if (!r.ok) {
    if (r.reason === 'private_address') {
      return { checked: true, unavailable: false, reachable: false, reason: 'private_address',
        note: 'That address points to a private or internal network, so it cannot be a public demo. Use your public deployment URL.' };
    }
    if (r.reason === 'bad_url' || r.reason === 'bad_scheme') {
      return { checked: true, unavailable: false, reachable: false, reason: r.reason,
        note: 'That URL could not be parsed. Use the full https:// address.' };
    }
    if (r.reason === 'too_many_redirects') {
      return { checked: true, unavailable: false, reachable: false, reason: r.reason,
        note: 'That URL redirects too many times to follow.' };
    }
    return { checked: true, unavailable: false, reachable: false, reason: 'unreachable', responseTimeMs,
      note: 'Could not reach that URL — it may be down, asleep on a free tier, or the address may be wrong.' };
  }

  const res = r.response;
  const statusCode = res.status;
  const contentType = res.headers.get('content-type') || '';
  const ok2xx = statusCode >= 200 && statusCode < 400;

  if (!ok2xx) {
    return { checked: true, unavailable: false, reachable: false, statusCode, responseTimeMs, finalUrl: r.finalUrl,
      note: `The deployment responded with HTTP ${statusCode}.` };
  }

  let title = '';
  let failureNote = '';
  let looksLikeApp = false;
  let bodyLength = 0;

  if (/text\/html/i.test(contentType)) {
    const body = (await res.text().catch(() => '')).slice(0, 200000);
    bodyLength = body.length;
    const m = body.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (m) title = m[1].trim().slice(0, 160);

    for (const [re, msg] of FAILURE_SIGNATURES) {
      if (re.test(body)) { failureNote = msg; break; }
    }
    // A client-rendered SPA legitimately returns a near-empty shell, so a short
    // body is NOT proof of failure — but a script bundle is a decent positive
    // signal that something real is deployed. This is why the status we award
    // is "reachable", not "working": a plain fetch cannot execute JS.
    const hasBundle = /<script[^>]+src=/i.test(body);
    const hasMarkup = /<(main|section|header|nav|article|form|table)/i.test(body);
    looksLikeApp = !failureNote && (hasBundle || hasMarkup || body.length > 1500);
  } else if (contentType) {
    looksLikeApp = true;
    bodyLength = Number(res.headers.get('content-length') || 0);
  }

  return {
    checked: true, unavailable: false,
    reachable: ok2xx && !failureNote && looksLikeApp,
    statusCode, finalUrl: r.finalUrl, responseTimeMs, contentType, title,
    looksLikeApp, bodyLength, failureNote,
    redirected: r.hops.length > 0,
    checkedAt: new Date().toISOString(),
    note: failureNote
      || (looksLikeApp
        ? `Reachable at ${r.finalUrl} (HTTP ${statusCode}, ${responseTimeMs}ms)${title ? ` — “${title}”` : ''}.`
        : `The URL responded (HTTP ${statusCode}) but served no recognisable page.`),
  };
}

/** /api/health is the strongest deployment signal — JSON, not a rendered SPA. */
export async function verifyApiHealth(liveUrl, healthPath = '/api/health') {
  const base = normalizeUrl(liveUrl);
  if (!base) return { checked: true, unavailable: false, reachable: false, note: 'No deployed URL attached.' };

  let target;
  try { target = new URL(healthPath, base).toString(); } catch {
    return { checked: true, unavailable: false, reachable: false, note: 'Could not build the health-check URL.' };
  }

  const r = await safeFetch(target);
  if (!r.ok) {
    return { checked: true, unavailable: false, reachable: false, target,
      note: `No response from ${healthPath}. Add a health endpoint that returns JSON, or leave this optional item pending.` };
  }
  const res = r.response;
  if (res.status < 200 || res.status >= 300) {
    return { checked: true, unavailable: false, reachable: false, statusCode: res.status, target,
      note: `${healthPath} responded with HTTP ${res.status}.` };
  }
  const text = (await res.text().catch(() => '')).slice(0, 4000);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }

  return {
    checked: true, unavailable: false,
    reachable: !!json,
    statusCode: res.status, target, isJson: !!json,
    note: json
      ? `${healthPath} responded HTTP ${res.status} with valid JSON.`
      : `${healthPath} responded HTTP ${res.status} but did not return JSON. A health endpoint should return a JSON body.`,
  };
}

/* ---------------- orchestration ---------------- */

/**
 * evidence: { repoUrl, liveUrl, testOutput }
 * Returns every observation the attached evidence supports.
 */
/* Wall-clock ceiling for one verification run. Serverless platforms kill the
   function at a fixed limit and the caller gets a 504 with no explanation, so
   we stop first and report honestly instead: anything unfinished comes back as
   `unavailable`, which the validator renders as `pending`, never a failure.
   Override with PROOF_VERIFY_BUDGET_MS (a long-running host can afford more). */
const BUDGET_MS = Number(process.env.PROOF_VERIFY_BUDGET_MS || 8000);

const TIMED_OUT = Symbol('timed_out');

/* Resolve to TIMED_OUT rather than reject, so one slow check cannot take the
   whole run down with it. */
function withBudget(promise, deadlineMs) {
  let timer;
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, deadlineMs));
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

const unfinished = (what) => ({
  checked: false,
  unavailable: true,
  note: `The ${what} check did not finish in time. It stays pending — nothing was marked failed. Try again in a moment.`,
});

export async function gatherProofEvidence(evidence = {}) {
  const repoUrl = String(evidence.repoUrl || '').trim();
  const liveUrl = String(evidence.liveUrl || '').trim();
  const testOutput = String(evidence.testOutput || '');

  const startedAt = Date.now();
  const left = () => BUDGET_MS - (Date.now() - startedAt);
  const settle = (value, what) => (value === TIMED_OUT ? unfinished(what) : value);

  // The deployment checks are independent of the GitHub ones, so they run
  // alongside rather than after — on a serverless host the two chains sharing
  // wall clock is the difference between finishing and being killed.
  const deployWork = liveUrl
    ? withBudget(Promise.all([verifyDeployment(liveUrl), verifyApiHealth(liveUrl)]), BUDGET_MS)
    : Promise.resolve([null, null]);

  const githubRaw = repoUrl ? await withBudget(verifyGithubRepo(repoUrl), left()) : null;
  const github = repoUrl ? settle(githubRaw, 'repository') : null;

  // Only spend further GitHub calls when the repo itself resolved — keeps a
  // typo'd URL from burning five requests against the hourly limit.
  const canDrillIn = !!(github && github.present);
  let readme = null; let ci = null; let screenshots = null;
  if (canDrillIn && left() > 500) {
    const pair = await withBudget(Promise.all([verifyReadme(repoUrl), verifyCiRun(repoUrl)]), left());
    [readme, ci] = pair === TIMED_OUT ? [unfinished('README'), unfinished('CI')] : pair;
    if (left() > 500) {
      screenshots = settle(await withBudget(verifyScreenshots(repoUrl, readme), left()), 'screenshot');
    } else {
      screenshots = unfinished('screenshot');
    }
  } else if (canDrillIn) {
    readme = unfinished('README'); ci = unfinished('CI'); screenshots = unfinished('screenshot');
  }

  const deployPair = await deployWork;
  const [deployment, apiHealth] = deployPair === TIMED_OUT
    ? [unfinished('deployment'), unfinished('API health')]
    : deployPair;

  const tests = testOutput.trim() ? parseTestOutput(testOutput) : null;

  return {
    repoUrl: repoUrl || null,
    liveUrl: liveUrl || null,
    hasTestOutput: !!testOutput.trim(),
    github, readme, screenshots, ci, deployment, apiHealth, tests,
    githubTokenConfigured: hasGithubToken(),
    elapsedMs: Date.now() - startedAt,
    budgetMs: BUDGET_MS,
  };
}

export default {
  gatherProofEvidence, verifyGithubRepo, verifyReadme, verifyScreenshots,
  verifyCiRun, verifyDeployment, verifyApiHealth, parseRepoUrl, normalizeUrl,
};
