/* Guided Project Workspace — progress calculator (deterministic).
   Honest by construction: percentDone counts user-marked work,
   percentVerified counts only system-verified evidence. Starter pack
   generation never moves either number.

   v3 additions (all additive — old plans recalculate unchanged):
   - WEIGHTED progress: a 1-hour README task no longer equals a 4-hour
     backend task. Weight is DERIVED (hours × priority × proof), never
     stored, so every plan ever generated gets weighted numbers.
   - DEPENDENCY-AWARE next action: a task whose prerequisites are not
     done is never recommended, and the blocking task is named instead.
   The original count-based percentDone/percentVerified fields keep
   their exact semantics — screens and tests that read them are safe. */
import { arr, obj } from './planUtils.js';
import { annotateDependencyState } from './dependencyPlanner.js';

const PHASE_ORDER = ['setup', 'backend', 'frontend', 'features', 'quality', 'launch'];

const PRIORITY_FACTOR = { critical: 1.5, high: 1.25, normal: 1, low: 0.75 };

/* Derived task weight. Deterministic; safe on tasks predating v3. */
export function taskWeight(t = {}) {
  const hours = Number.isFinite(Number(t.estimatedHours)) && Number(t.estimatedHours) > 0 ? Number(t.estimatedHours) : 3;
  const pf = PRIORITY_FACTOR[t.priority] || 1;
  const proof = t.proofRequired ? 1.2 : 1;
  return Math.round(hours * pf * proof * 10) / 10;
}

export function calculateProgress(plan = {}) {
  const tasks = arr(plan.tasks);
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done' || t.status === 'verified').length;
  const verified = tasks.filter((t) => t.status === 'verified').length;
  const blocked = tasks.filter((t) => t.status === 'blocked').length;

  let totalWeight = 0; let doneWeight = 0; let verifiedWeight = 0;
  for (const t of tasks) {
    const w = taskWeight(t);
    totalWeight += w;
    if (t.status === 'done' || t.status === 'verified') doneWeight += w;
    if (t.status === 'verified') verifiedWeight += w;
  }
  const r1 = (n) => Math.round(n * 10) / 10;

  return {
    totalTasks: total,
    doneTasks: done,
    verifiedTasks: verified,
    blockedTasks: blocked,
    // Legacy count-based fields — semantics unchanged on purpose.
    percentDone: total ? Math.round((done / total) * 100) : 0,
    percentVerified: total ? Math.round((verified / total) * 100) : 0,
    // Effort-weighted view (what the workspace UI shows).
    totalWeight: r1(totalWeight),
    doneWeight: r1(doneWeight),
    verifiedWeight: r1(verifiedWeight),
    weightedPercentDone: totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0,
    weightedPercentVerified: totalWeight ? Math.round((verifiedWeight / totalWeight) * 100) : 0,
  };
}

export function currentPhase(plan = {}) {
  const tasks = arr(plan.tasks);
  for (const ph of PHASE_ORDER) {
    const inPhase = tasks.filter((t) => t.phase === ph);
    if (inPhase.length && inPhase.some((t) => !['done', 'verified'].includes(t.status))) return ph;
  }
  return tasks.length ? 'launch' : 'setup';
}

/* Dependency-aware. `plan.tasks` may or may not already carry depsMet —
   we recompute here so this function is safe to call standalone. */
export function nextBestAction(plan = {}) {
  const tasks = annotateDependencyState(arr(plan.tasks)).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const open = (t) => !['done', 'verified'].includes(t.status);
  const firstUnmetDep = (t) => arr(t.dependsOn).map((id) => byId.get(id)).find((d) => d && open(d));

  const inProgress = tasks.find((t) => t.status === 'in_progress');
  if (inProgress) return { taskId: inProgress.id, title: inProgress.title, reason: 'Already in progress — finish it before starting new work.' };

  const ready = tasks.find((t) => t.status === 'ready' && t.depsMet);
  if (ready) return { taskId: ready.id, title: ready.title, reason: 'Next ready task in build order — all prerequisites are done.' };

  const backlog = tasks.find((t) => t.status === 'backlog' && t.depsMet);
  if (backlog) return { taskId: backlog.id, title: backlog.title, reason: 'First unblocked backlog task — earlier prerequisites are complete.' };

  // Everything open is dependency-blocked: recommend the frontier task that unblocks the most.
  const gated = tasks.find((t) => open(t) && t.status !== 'blocked' && !t.depsMet);
  if (gated) {
    const dep = firstUnmetDep(gated);
    if (dep) return { taskId: dep.id, title: dep.title, reason: `Prerequisite for "${gated.title}" — finish this to unblock the next milestone.` };
  }
  const blocked = tasks.find((t) => t.status === 'blocked');
  if (blocked) return { taskId: blocked.id, title: blocked.title, reason: `Unblock: ${blocked.blockerReason || 'see blocker note'}` };
  return tasks.length ? { taskId: null, title: 'All tasks done — gather proof', reason: 'Submit proof items so work can be verified.' } : { taskId: null, title: 'Generate the workspace plan', reason: 'No tasks yet.' };
}

export function detectRisks(plan = {}) {
  const risks = [];
  const tasks = arr(plan.tasks);
  const blocked = tasks.filter((t) => t.status === 'blocked');
  if (blocked.length) risks.push(`${blocked.length} blocked task${blocked.length > 1 ? 's' : ''}: ${blocked.map((t) => t.title).slice(0, 2).join('; ')}`);
  if (!obj(plan.architecture).architectureSpec) risks.push('No Architecture OS spec yet — generate one in the Architecture tab.');
  const proof = arr(plan.proofRequirements);
  const doneTasks = tasks.filter((t) => ['done', 'verified'].includes(t.status)).length;
  if (doneTasks > tasks.length / 2 && proof.every((p) => p.status === 'pending')) {
    risks.push('Over half the tasks are done but no proof items are submitted — recruiters only trust verifiable evidence.');
  }
  const doneUnverified = tasks.filter((t) => t.status === 'done').length;
  if (doneUnverified >= 5 && !tasks.some((t) => t.status === 'verified')) {
    risks.push(`${doneUnverified} tasks are marked Done but none are Verified yet — attach repo/deployment evidence and run Verify.`);
  }
  if (!obj(plan.starterPack).available && doneTasks === 0) risks.push('Starter pack not generated yet — download it to start from a runnable skeleton.');
  return risks.slice(0, 6);
}

/* Roadmap phase statuses derived from task states. */
export function refreshRoadmapStatus(plan = {}) {
  const tasks = arr(plan.tasks);
  const cur = currentPhase(plan);
  return arr(plan.roadmap).map((ph) => {
    const ts = tasks.filter((t) => t.phase === ph.phase);
    const doneCount = ts.filter((t) => ['done', 'verified'].includes(t.status)).length;
    const verifiedCount = ts.filter((t) => t.status === 'verified').length;
    const status = ts.length && doneCount === ts.length ? 'complete' : ph.phase === cur ? 'current' : doneCount > 0 ? 'in_progress' : 'pending';
    return { ...ph, status, doneCount, verifiedCount, totalCount: ts.length, blockedCount: ts.filter((t) => t.status === 'blocked').length };
  });
}
