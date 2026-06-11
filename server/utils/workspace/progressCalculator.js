/* Guided Project Workspace — progress calculator (deterministic).
   Honest by construction: percentDone counts user-marked work,
   percentVerified counts only system-verified evidence. Starter pack
   generation never moves either number. */
import { arr, obj } from './planUtils.js';

const PHASE_ORDER = ['setup', 'backend', 'frontend', 'features', 'quality', 'launch'];

export function calculateProgress(plan = {}) {
  const tasks = arr(plan.tasks);
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done' || t.status === 'verified').length;
  const verified = tasks.filter((t) => t.status === 'verified').length;
  const blocked = tasks.filter((t) => t.status === 'blocked').length;
  return {
    totalTasks: total,
    doneTasks: done,
    verifiedTasks: verified,
    blockedTasks: blocked,
    percentDone: total ? Math.round((done / total) * 100) : 0,
    percentVerified: total ? Math.round((verified / total) * 100) : 0,
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

export function nextBestAction(plan = {}) {
  const tasks = arr(plan.tasks).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const inProgress = tasks.find((t) => t.status === 'in_progress');
  if (inProgress) return { taskId: inProgress.id, title: inProgress.title, reason: 'Already in progress — finish it before starting new work.' };
  const ready = tasks.find((t) => t.status === 'ready');
  if (ready) return { taskId: ready.id, title: ready.title, reason: 'Next ready task in phase order.' };
  const backlog = tasks.find((t) => t.status === 'backlog');
  if (backlog) return { taskId: backlog.id, title: backlog.title, reason: 'First backlog task — earlier phases are complete.' };
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
    const status = ts.length && doneCount === ts.length ? 'complete' : ph.phase === cur ? 'current' : doneCount > 0 ? 'in_progress' : 'pending';
    return { ...ph, status, doneCount, totalCount: ts.length, blockedCount: ts.filter((t) => t.status === 'blocked').length };
  });
}
