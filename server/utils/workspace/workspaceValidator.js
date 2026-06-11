/* Guided Project Workspace — structural validator + v1 verify rules.
   v1 verification is HONEST and local-only:
   - `workspace_local` proof items can be checked from the plan itself
     (e.g. an Architecture OS spec exists).
   - github / deployment / manual / local_tests items are NEVER auto-passed;
     they return pending with a "verification coming next" note.
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

export function runVerification(plan = {}) {
  const p = obj(plan);
  const checks = [];
  const proof = arr(p.proofRequirements).map((item) => {
    const out = { ...item };
    if (item.verificationMethod === 'workspace_local') {
      if (item.type === 'architecture_exported') {
        const hasSpec = !!obj(p.architecture).architectureSpec;
        out.status = hasSpec ? 'verified' : 'pending';
        checks.push({ id: item.id, title: item.title, result: hasSpec ? 'verified' : 'pending', note: hasSpec ? 'Architecture spec exists in this workspace. This proves design quality only — not implementation.' : 'Generate an architecture in the Architecture tab first.' });
      } else {
        checks.push({ id: item.id, title: item.title, result: 'pending', note: 'No local rule for this item yet.' });
      }
    } else if (item.verificationMethod === 'github') {
      checks.push({ id: item.id, title: item.title, result: 'pending', note: 'GitHub verification coming next — not faked in v1.' });
    } else if (item.verificationMethod === 'deployment') {
      checks.push({ id: item.id, title: item.title, result: 'pending', note: 'Deployment verification coming next — not faked in v1.' });
    } else if (item.verificationMethod === 'local_tests') {
      checks.push({ id: item.id, title: item.title, result: 'pending', note: 'Run `npm test` locally; automated capture coming next.' });
    } else {
      checks.push({ id: item.id, title: item.title, result: 'pending', note: 'Manual evidence — attach it in the Proof tab.' });
    }
    return out;
  });

  const verifiedCount = proof.filter((x) => x.status === 'verified').length;
  return {
    proofRequirements: proof,
    verificationSummary: {
      ranAt: new Date().toISOString(),
      mode: 'local_v1',
      verifiedItems: verifiedCount,
      pendingItems: proof.length - verifiedCount,
      checks,
      note: 'v1 runs local workspace rules only. Generated starter code is not verified work; Done is not Verified; the architecture design score is not implementation proof.',
    },
  };
}
