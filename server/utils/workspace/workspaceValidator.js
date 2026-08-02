/* Guided Project Workspace — structural validator + verify rules.
   Verification is HONEST and evidence-driven:
   - `workspace_local` proof items are checked from the plan itself
     (e.g. an Architecture OS spec exists).
   - `github` and `deployment` items are checked against REAL evidence the
     student attaches (repo URL / deployed URL), fetched server-side by
     utils/workspace/proofVerification.js. No evidence attached, or a check
     that could not run, means `pending` — never a fake pass.
   - `manual` and `local_tests` items still need student-supplied evidence.
   - Tasks are never auto-promoted to `verified` here. */
import { arr, obj, str, TASK_STATUSES } from './planUtils.js';

export function validateWorkspacePlan(plan = {}) {
  const issues = [];
  const p = obj(plan);
  if (!str(p.title)) issues.push('Plan has no title.');
  if (!arr(p.tasks).length) issues.push('Plan has no tasks.');
  if (!arr(p.fileTree).length) issues.push('Plan has no file tree.');
  if (!arr(p.apiPlan).length) issues.push('Plan has no API plan.');
  for (const t of arr(p.tasks)) {
    if (!TASK_STATUSES.includes(t.status)) issues.push(`Task "${t.title}" has invalid status "${t.status}".`);
  }
  const ids = new Set();
  for (const t of arr(p.tasks)) {
    if (ids.has(t.id)) issues.push(`Duplicate task id ${t.id}.`);
    ids.add(t.id);
  }
  return { ok: issues.length === 0, issues };
}

/* ============================================================
   STATUS TIERS
   ------------------------------------------------------------
   verified       an independent observation supports the claim
   self_reported  the student asserted it and the assertion is
                  well-formed, but we cannot independently confirm
                  it (pasted test output). Counts toward completion,
                  but must LOOK different from verified — a
                  recruiter-facing score built on self-claims is
                  worthless.
   pending        not yet evidenced, or we could not check
   not_applicable structurally irrelevant to this project

   There is deliberately no `failed`. A check we could not run is
   the platform's problem, not the student's, and an unmet
   requirement is just "not done yet".
   ============================================================ */

/* Unavailable observations must never become a negative verdict. */
function unavailableVerdict(obs, fallback) {
  if (obs && obs.unavailable) {
    return { result: 'pending', note: obs.note || 'This check could not run just now. Nothing was marked failed.' };
  }
  return fallback;
}

function judgeGithub(item, ev) {
  const gh = ev?.github;
  if (!gh) return { result: 'pending', note: 'Attach your public repository URL in the Proof tab, then run Verify.' };
  const bail = unavailableVerdict(gh, null);
  if (bail) return bail;
  if (!gh.present) return { result: 'pending', note: gh.note };

  if (item.type === 'readme') {
    const rm = ev?.readme;
    if (!rm) return { result: 'pending', note: 'README could not be read.' };
    const b2 = unavailableVerdict(rm, null);
    if (b2) return b2;
    if (!rm.present || !rm.meaningful) return { result: 'pending', note: rm.note };
    return { result: 'verified', note: rm.note };
  }

  if (!gh.hasSource) {
    return { result: 'pending', note: `${gh.fullName} is reachable but looks nearly empty. Push your actual source code.` };
  }
  return { result: 'verified', note: gh.note };
}

function judgeScreenshots(item, ev) {
  const sc = ev?.screenshots;
  if (!ev?.github) return { result: 'pending', note: 'Attach your repository URL in the Proof tab, then run Verify.' };
  if (!sc) return { result: 'pending', note: 'Repository must be readable before screenshots can be checked.' };
  const bail = unavailableVerdict(sc, null);
  if (bail) return bail;
  if (!sc.enough || !sc.embedded) return { result: 'pending', note: sc.note };
  return { result: 'verified', note: sc.note };
}

function judgeDeployment(item, ev) {
  const dep = ev?.deployment;
  if (!dep) return { result: 'pending', note: 'Attach your deployed URL in the Proof tab, then run Verify.' };
  const bail = unavailableVerdict(dep, null);
  if (bail) return bail;
  if (!dep.reachable) return { result: 'pending', note: dep.note };
  // "reachable", not "working": a server-side fetch cannot execute the JS of a
  // client-rendered app, so we never claim more than we observed.
  return { result: 'verified', note: `${dep.note} Confirms the deployment is reachable; it does not execute your app's JavaScript.` };
}

function judgeApiHealth(item, ev) {
  const h = ev?.apiHealth;
  if (!h) return { result: 'pending', note: 'Attach your deployed URL in the Proof tab, then run Verify.' };
  const bail = unavailableVerdict(h, null);
  if (bail) return bail;
  if (!h.reachable) return { result: 'pending', note: h.note };
  return { result: 'verified', note: h.note };
}

/* Two tiers. A green CI run is independent evidence; a paste is not. */
function judgeTests(item, ev) {
  const ci = ev?.ci;
  if (ci && !ci.unavailable && ci.present) {
    return { result: 'verified', note: ci.note };
  }
  const t = ev?.tests;
  if (t && t.ok) {
    const ciHint = ci && !ci.unavailable ? ` ${ci.note}` : '';
    return { result: 'self_reported', note: `${t.message}${ciHint}` };
  }
  if (t && !t.ok) return { result: 'pending', note: t.message };
  if (ci && ci.unavailable) return { result: 'pending', note: ci.note };
  if (ci && !ci.present) return { result: 'pending', note: `Paste your test output in the Proof tab. ${ci.note}` };
  return { result: 'pending', note: 'Run your tests, then paste the console output in the Proof tab. Adding a CI workflow upgrades this to fully verified.' };
}

/**
 * runVerification(plan, evidence)
 * evidence comes from utils/workspace/proofVerification.gatherProofEvidence().
 * Omitted entirely, every network-backed item stays pending with a clear
 * instruction rather than a failure.
 */
export function runVerification(plan = {}, evidence = null) {
  const p = obj(plan);
  const checks = [];

  const proof = arr(p.proofRequirements).map((item) => {
    const out = { ...item };

    // Structurally irrelevant items are skipped, never marked pending — a
    // permanently red row on a CLI project is noise, not feedback.
    if (item.skipped || item.status === 'not_applicable') {
      out.status = 'not_applicable';
      out.verificationNote = 'Not applicable to this project type.';
      checks.push({ id: item.id, title: item.title, method: item.verificationMethod, result: 'not_applicable', note: out.verificationNote });
      return out;
    }

    let verdict;
    switch (item.verificationMethod) {
      case 'workspace_local': {
        const hasSpec = !!obj(p.architecture).architectureSpec;
        verdict = {
          result: hasSpec ? 'verified' : 'pending',
          note: hasSpec
            ? 'Architecture spec exists in this workspace. This proves design quality only — not implementation.'
            : 'Generate an architecture in the Architecture tab first.',
        };
        break;
      }
      case 'github': verdict = judgeGithub(item, evidence); break;
      case 'github_screenshots': verdict = judgeScreenshots(item, evidence); break;
      case 'deployment': verdict = judgeDeployment(item, evidence); break;
      case 'api_health': verdict = judgeApiHealth(item, evidence); break;
      case 'tests': verdict = judgeTests(item, evidence); break;
      default:
        verdict = { result: 'pending', note: 'Manual evidence — attach it in the Proof tab.' };
    }

    out.status = verdict.result;
    out.verificationNote = verdict.note;
    out.lastCheckedAt = new Date().toISOString();
    checks.push({ id: item.id, title: item.title, method: item.verificationMethod, result: verdict.result, note: verdict.note });
    return out;
  });

  const active = proof.filter((x) => x.status !== 'not_applicable');
  const verifiedCount = active.filter((x) => x.status === 'verified').length;
  const selfReportedCount = active.filter((x) => x.status === 'self_reported').length;
  const requiredPending = active.filter((x) => x.required && x.status !== 'verified' && x.status !== 'self_reported').length;

  return {
    proofRequirements: proof,
    verificationSummary: {
      ranAt: new Date().toISOString(),
      mode: evidence ? 'evidence_backed' : 'local_only',
      evidenceUsed: {
        repoUrl: evidence?.repoUrl || null,
        liveUrl: evidence?.liveUrl || null,
        testOutputProvided: !!evidence?.hasTestOutput,
        githubTokenConfigured: evidence?.githubTokenConfigured ?? null,
      },
      verifiedItems: verifiedCount,
      selfReportedItems: selfReportedCount,
      pendingItems: active.length - verifiedCount - selfReportedCount,
      notApplicableItems: proof.length - active.length,
      requiredPending,
      complete: requiredPending === 0,
      checks,
      note: 'Checks run against real evidence you attach. Anything we could not observe stays pending — it is never auto-passed, and a check we could not run is never counted against you. Self-reported items are shown separately from verified ones. Generated starter code is not verified work; Done is not Verified; the architecture design score is not implementation proof.',
    },
  };
}
