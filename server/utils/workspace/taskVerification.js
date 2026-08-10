/* ============================================================
   TASK VERIFICATION  (Verification V3 — requirement-aware)
   ------------------------------------------------------------
   Connects TASK → ACCEPTANCE CRITERIA → EVIDENCE → VERIFICATION
   → SKILL on top of the existing honest proof stack. This module
   ADDS a per-task matrix; it never replaces runVerification or
   the proofRequirements flow.

   Discipline inherited from proofVerification/workspaceValidator:
   - three outcomes per criterion: verified / self_reported /
     pending (unavailable ⇒ pending, never a failure);
   - a task is promoted to `verified` ONLY when the student already
     marked it done AND every machine-checkable rule verified;
   - partial results are named, with the exact next evidence to
     submit — "partially verified" is a state, not a failure;
   - confidence is capped by evidence kind (independent CI /
     deployment > repo presence > self-report) and never exceeds
     the credential engine's artifact ceiling (medium) without an
     assessment.
   ============================================================ */
import { arr, obj, str } from './planUtils.js';

const CONF_RANK = { high: 3, medium: 2, low: 1, none: 0 };
const maxConf = (a, b) => (CONF_RANK[a] >= CONF_RANK[b] ? a : b);

/* ---- one machine rule → one criterion verdict ------------------- */
function judgeRule(rule, ev, plan) {
  const type = str(rule.type);
  const pendingNoEvidence = (what) => ({ result: 'pending', note: `Attach ${what} in the Proof tab, then run Verify.` });

  if (type === 'github') {
    const gh = ev?.github;
    if (!gh) return pendingNoEvidence('your public repository URL');
    if (gh.unavailable) return { result: 'pending', note: gh.note };
    if (!gh.present) return { result: 'pending', note: gh.note };
    if (!gh.hasSource) return { result: 'pending', note: `${gh.fullName} is reachable but nearly empty — push your source code.` };
    return { result: 'verified', note: gh.note, evidenceRef: 'github' };
  }
  if (type === 'deployment') {
    const dep = ev?.deployment; const api = ev?.apiHealth;
    if (!dep) return pendingNoEvidence('your deployed URL');
    if (dep.unavailable) return { result: 'pending', note: dep.note };
    if (!dep.reachable) return { result: 'pending', note: dep.note };
    const apiOk = !!(api && !api.unavailable && api.reachable);
    return {
      result: 'verified',
      note: apiOk ? `${dep.note} API health endpoint responded.` : dep.note,
      evidenceRef: apiOk ? 'deployment+api' : 'deployment',
    };
  }
  if (type === 'local_tests') {
    const ci = ev?.ci;
    if (ci && !ci.unavailable && ci.present) return { result: 'verified', note: ci.note, evidenceRef: 'ci' };
    const t = ev?.tests;
    if (t && t.ok) return { result: 'self_reported', note: t.message, evidenceRef: 'test_output' };
    if (t && !t.ok) return { result: 'pending', note: t.message };
    return pendingNoEvidence('your test run output (a green CI workflow upgrades this to fully verified)');
  }
  if (type === 'workspace_local') {
    const hasSpec = !!obj(obj(plan).architecture).architectureSpec;
    return hasSpec
      ? { result: 'verified', note: 'Architecture spec exists in this workspace (design evidence only).', evidenceRef: 'architecture' }
      : { result: 'pending', note: 'Generate an architecture in the Architecture tab first.' };
  }
  // manual + unknown types stay human.
  return { result: 'pending', note: rule.rule || 'Manual evidence — attach it in the Proof tab.' };
}

const confidenceFor = (evidenceRef) => {
  if (evidenceRef === 'ci' || evidenceRef === 'deployment+api') return 'medium';
  if (evidenceRef === 'github' || evidenceRef === 'deployment' || evidenceRef === 'architecture') return 'medium';
  if (evidenceRef === 'test_output') return 'low';
  return 'none';
};

/* ---- verify one task -------------------------------------------- */
export function verifyTask(task = {}, evidence = null, plan = {}) {
  const machineRules = arr(task.verificationRules).filter((r) => r && str(r.type) && str(r.type) !== 'manual');
  const criteria = [];

  // 1) Machine-checkable rules → real evidence verdicts.
  machineRules.forEach((rule, i) => {
    const v = judgeRule(rule, evidence, plan);
    criteria.push({
      id: `${task.id}:rule:${i}`, kind: 'rule', type: str(rule.type),
      label: str(rule.rule) || str(rule.type),
      result: v.result, note: v.note, evidenceRef: v.evidenceRef || null,
    });
  });

  // 2) Acceptance criteria are the student's own definition of done. They are
  //    attributed as self_reported once the student marks the task done —
  //    never silently upgraded to verified.
  const selfDone = task.status === 'done' || task.status === 'verified';
  arr(task.acceptanceCriteria).forEach((label, i) => {
    criteria.push({
      id: `${task.id}:accept:${i}`, kind: 'acceptance', type: 'self_check',
      label: str(label),
      result: selfDone ? 'self_reported' : 'pending',
      note: selfDone ? 'Student-attested when the task was marked done.' : 'Attested when you mark the task done.',
      evidenceRef: selfDone ? 'self' : null,
    });
  });

  const machine = criteria.filter((c) => c.kind === 'rule');
  const mVerified = machine.filter((c) => c.result === 'verified').length;
  const mSelf = machine.filter((c) => c.result === 'self_reported').length;
  const evidenceAttached = !!(evidence && (evidence.repoUrl || evidence.liveUrl || evidence.hasTestOutput));

  /* Roll-up. Only machine rules can make a task `verified`; acceptance
     criteria alone can never exceed self-report. */
  let status;
  if (machine.length && mVerified === machine.length) status = 'verified';
  else if (mVerified > 0 || mSelf > 0) status = 'partially_verified';
  else if (machine.length && evidenceAttached) status = 'insufficient_evidence';
  else status = 'pending';

  let confidence = 'none';
  for (const c of machine) if (c.result === 'verified' || c.result === 'self_reported') confidence = maxConf(confidence, confidenceFor(c.evidenceRef));

  const missing = machine.filter((c) => c.result === 'pending');
  const remediation = status === 'verified' ? null
    : missing.length ? { title: `Submit evidence: ${missing[0].label}`, note: missing[0].note, criterionId: missing[0].id }
    : !machine.length ? null
    : { title: 'Attach evidence in the Proof tab', note: 'Add your repository / deployed URL / test output, then run Verify.', criterionId: null };

  return {
    taskId: task.id, title: task.title, phase: task.phase,
    skills: arr(task.skills).map(str).filter(Boolean),
    status, confidence, criteria, remediation,
    machineRuleCount: machine.length, machineVerified: mVerified,
  };
}

/* ---- verify the whole plan -------------------------------------- */
export function verifyPlanTasks(plan = {}, evidence = null, { now } = {}) {
  const p = obj(plan);
  const results = arr(p.tasks)
    .filter((t) => arr(t.verificationRules).some((r) => r && str(r.type) !== 'manual') || arr(t.acceptanceCriteria).length)
    .map((t) => verifyTask(t, evidence, p));

  /* Promotion: done + all machine rules verified → verified. Nothing else
     changes a stored status; a task the student has not finished is never
     verified on their behalf. */
  const promoteIds = new Set(results
    .filter((r) => r.status === 'verified' && r.machineRuleCount > 0)
    .map((r) => r.taskId));
  const promoted = [];
  const tasks = arr(p.tasks).map((t) => {
    if (t.status === 'done' && promoteIds.has(t.id)) {
      promoted.push(t.id);
      return { ...t, status: 'verified', updatedAt: (now ? new Date(now) : new Date()).toISOString() };
    }
    return t;
  });

  /* Skill attribution — only from tasks that actually got promoted, so a
     verified skill always traces to a verified task and its evidence. */
  const skillMap = new Map();
  for (const r of results) {
    if (!promoted.includes(r.taskId)) continue;
    for (const skill of r.skills) {
      const key = skill.toLowerCase();
      const cur = skillMap.get(key) || { skill, taskIds: [], evidence: [], confidence: 'none' };
      cur.taskIds.push(r.taskId);
      cur.evidence.push(...r.criteria.filter((c) => c.result === 'verified').map((c) => c.label).slice(0, 3));
      cur.confidence = maxConf(cur.confidence, r.confidence);
      skillMap.set(key, cur);
    }
  }
  const skillEvidence = Array.from(skillMap.values()).map((s) => ({
    ...s, taskIds: [...new Set(s.taskIds)], evidence: [...new Set(s.evidence)].slice(0, 5),
  }));

  const counts = {
    checkedTasks: results.length,
    verified: results.filter((r) => r.status === 'verified').length,
    partiallyVerified: results.filter((r) => r.status === 'partially_verified').length,
    insufficientEvidence: results.filter((r) => r.status === 'insufficient_evidence').length,
    pending: results.filter((r) => r.status === 'pending').length,
    promotedTasks: promoted.length,
  };
  const nextRemediation = results
    .map((r) => r.remediation).filter(Boolean).slice(0, 3);

  return {
    tasks,
    taskVerification: {
      ranAt: (now ? new Date(now) : new Date()).toISOString(),
      version: 'task-verify-v1',
      results, counts, skillEvidence, promotedTaskIds: promoted,
      nextActions: nextRemediation,
      note: 'Per-task verification against acceptance criteria and real evidence. Partially verified names exactly what is missing; unavailable checks stay pending and are never counted against you.',
    },
  };
}

export default { verifyTask, verifyPlanTasks };
