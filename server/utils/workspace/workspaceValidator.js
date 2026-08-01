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

/* Decide a github proof item from a real repo observation. */
function judgeGithub(item, gh) {
  if (!gh) return { result: 'pending', note: 'Attach your public repository URL in the Proof tab, then run Verify.' };
  if (!gh.ok) return { result: 'pending', note: gh.note || 'The GitHub check could not run. Nothing was marked verified.' };
  if (!gh.reachable) return { result: 'pending', note: gh.note || 'That repository is not publicly readable.' };

  if (item.type === 'readme_present' || /readme/i.test(item.title || '')) {
    if (!gh.readmePresent) return { result: 'pending', note: 'No README.md found in the repository root. Add one that explains what the project does, why, and how to run it.' };
    if (!gh.readmeMeaningful) return { result: 'pending', note: `A README exists but is only ${gh.readmeBytes} bytes. Expand it to cover what it does, why it exists, and how to run it locally.` };
    return { result: 'verified', note: `README.md found (${gh.readmeBytes} bytes) in ${gh.fullName}.` };
  }
  if (item.type === 'ci_workflow' || /ci\/cd|workflow|pipeline/i.test(item.title || '')) {
    return gh.ciPresent
      ? { result: 'verified', note: `CI workflow found under .github/workflows in ${gh.fullName}.` }
      : { result: 'pending', note: 'No workflow file found under .github/workflows. Add a CI workflow that runs your tests on push.' };
  }
  // Default github proof: the repo itself exists, is public and has commits.
  return {
    result: 'verified',
    note: `Public repository ${gh.fullName} verified${gh.pushedAt ? `, last pushed ${String(gh.pushedAt).slice(0, 10)}` : ''}.`,
  };
}

/* Decide a deployment proof item from a real HTTP observation. */
function judgeDeployment(item, dep) {
  if (!dep) return { result: 'pending', note: 'Attach your deployed URL in the Proof tab, then run Verify.' };
  if (!dep.ok || !dep.reachable) return { result: 'pending', note: dep.note || 'The deployed URL could not be reached.' };
  if (!dep.looksLikeApp) return { result: 'pending', note: dep.note || 'The URL responded but the page looks empty. Confirm the deployment serves your app.' };
  return {
    result: 'verified',
    note: `Reachable at ${dep.finalUrl} (HTTP ${dep.statusCode}, ${dep.responseTimeMs}ms)${dep.title ? ` — “${dep.title}”` : ''}.`,
  };
}

/**
 * runVerification(plan, evidence)
 * evidence: { github, deployment, repoUrl, liveUrl } from
 * utils/workspace/proofVerification.gatherProofEvidence(). Omitted entirely,
 * every network-backed item simply stays pending with a clear instruction.
 */
export function runVerification(plan = {}, evidence = null) {
  const p = obj(plan);
  const gh = evidence?.github || null;
  const dep = evidence?.deployment || null;
  const checks = [];
  const proof = arr(p.proofRequirements).map((item) => {
    const out = { ...item };
    let verdict;

    if (item.verificationMethod === 'workspace_local') {
      if (item.type === 'architecture_exported') {
        const hasSpec = !!obj(p.architecture).architectureSpec;
        verdict = {
          result: hasSpec ? 'verified' : 'pending',
          note: hasSpec
            ? 'Architecture spec exists in this workspace. This proves design quality only — not implementation.'
            : 'Generate an architecture in the Architecture tab first.',
        };
      } else {
        verdict = { result: 'pending', note: 'No local rule for this item yet.' };
      }
    } else if (item.verificationMethod === 'github') {
      verdict = judgeGithub(item, gh);
    } else if (item.verificationMethod === 'deployment') {
      verdict = judgeDeployment(item, dep);
    } else if (item.verificationMethod === 'local_tests') {
      verdict = { result: 'pending', note: 'Run `npm test` locally and paste the output in the Proof tab. Add a CI workflow and this becomes verifiable from your repo.' };
    } else {
      verdict = { result: 'pending', note: 'Manual evidence — attach it in the Proof tab.' };
    }

    out.status = verdict.result;
    out.verificationNote = verdict.note;
    out.lastCheckedAt = new Date().toISOString();
    checks.push({ id: item.id, title: item.title, method: item.verificationMethod, result: verdict.result, note: verdict.note });
    return out;
  });

  const verifiedCount = proof.filter((x) => x.status === 'verified').length;
  const requiredPending = proof.filter((x) => x.required && x.status !== 'verified').length;
  return {
    proofRequirements: proof,
    verificationSummary: {
      ranAt: new Date().toISOString(),
      mode: evidence ? 'evidence_backed' : 'local_only',
      evidenceUsed: {
        repoUrl: evidence?.repoUrl || null,
        liveUrl: evidence?.liveUrl || null,
        githubReachable: gh ? !!gh.reachable : null,
        deploymentReachable: dep ? !!dep.reachable : null,
      },
      verifiedItems: verifiedCount,
      pendingItems: proof.length - verifiedCount,
      requiredPending,
      checks,
      note: 'Checks run against real evidence you attach. Anything we could not observe stays pending — it is never auto-passed. Generated starter code is not verified work; Done is not Verified; the architecture design score is not implementation proof.',
    },
  };
}
