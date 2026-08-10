/* ============================================================
   TASK DEPENDENCY PLANNER  (deterministic; pure)
   ------------------------------------------------------------
   Derives a build-order dependency graph over a planned task list
   so "what should I do next" can respect real prerequisites
   (schema → model → API → screen → tests → deploy) instead of raw
   list order.

   Rules (in priority order, all deterministic):
     R1 ARTIFACT  a task depends on the nearest earlier task that
                  touches one of the same models / APIs / files.
                  (You cannot harden an API before the API exists.)
     R2 PHASE GATE the first task of a phase depends on the last
                  task of the previous phase, so milestones stay
                  ordered even when tasks share no artifacts.
     R3 CRITICAL  deployment depends on the tests-green task and
                  the database task when those exist — shipping
                  unverified work is never the recommended path.

   Guarantees:
     - edges only point to earlier `order` values → acyclic by
       construction;
     - at most MAX_DEPS edges per task (closest wins);
     - plans generated before this module existed simply have no
       `dependsOn` and behave exactly as before (treated as []).
   ============================================================ */
import { arr, str } from './planUtils.js';

const MAX_DEPS = 3;

const overlap = (a = [], b = []) => {
  if (!a.length || !b.length) return false;
  const set = new Set(a.map(String));
  return b.some((x) => set.has(String(x)));
};

function sharesArtifact(a, b) {
  return overlap(arr(a.linkedModels), arr(b.linkedModels))
    || overlap(arr(a.linkedApis), arr(b.linkedApis))
    || overlap(arr(a.linkedFiles), arr(b.linkedFiles));
}

/* Attach `dependsOn: [taskId]` to every task. Never mutates input. */
export function deriveDependencies(tasks = []) {
  const list = arr(tasks).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const byPhaseFirst = new Map(); // phase -> first task
  const byPhaseLast = new Map();  // phase -> last task (running)
  const phaseSeq = [];
  for (const t of list) {
    if (!byPhaseFirst.has(t.phase)) { byPhaseFirst.set(t.phase, t); phaseSeq.push(t.phase); }
    byPhaseLast.set(t.phase, t);
  }
  const prevPhaseOf = new Map();
  phaseSeq.forEach((p, i) => { if (i > 0) prevPhaseOf.set(p, phaseSeq[i - 1]); });

  const isTestsTask = (t) => /test green|every test/i.test(str(t.title)) || arr(t.verificationRules).some((v) => v.type === 'local_tests');
  const isDbTask = (t) => /real database|connect a real/i.test(str(t.title));
  const isDeployTask = (t) => arr(t.verificationRules).some((v) => v.type === 'deployment') || /deploy/i.test(str(t.title));

  return list.map((t, idx) => {
    const deps = [];
    // R1 — nearest earlier artifact-sharing tasks (closest first).
    for (let j = idx - 1; j >= 0 && deps.length < MAX_DEPS; j--) {
      if (sharesArtifact(t, list[j])) deps.push(list[j].id);
    }
    // R2 — phase gate for the first task of each phase.
    const prevPhase = prevPhaseOf.get(t.phase);
    if (prevPhase && byPhaseFirst.get(t.phase)?.id === t.id) {
      const gate = byPhaseLast.get(prevPhase);
      if (gate && !deps.includes(gate.id)) deps.push(gate.id);
    }
    // R3 — critical path into deployment.
    if (isDeployTask(t)) {
      for (const c of list.slice(0, idx)) {
        if ((isTestsTask(c) || isDbTask(c)) && !deps.includes(c.id) && deps.length < MAX_DEPS + 1) deps.push(c.id);
      }
    }
    return { ...t, dependsOn: deps.slice(0, MAX_DEPS + 1) };
  });
}

/* depsMet for one task given a status lookup. Missing deps (deleted
   tasks after a regenerate) never block — a ghost cannot gate work. */
export function depsMet(task, statusById) {
  const deps = arr(task && task.dependsOn);
  if (!deps.length) return true;
  return deps.every((id) => {
    const s = statusById.get(id);
    return s == null || s === 'done' || s === 'verified';
  });
}

/* Annotate every task with `depsMet` (derived, recomputed each recalc). */
export function annotateDependencyState(tasks = []) {
  const list = arr(tasks);
  const statusById = new Map(list.map((t) => [t.id, t.status]));
  return list.map((t) => ({ ...t, depsMet: depsMet(t, statusById) }));
}

export default { deriveDependencies, depsMet, annotateDependencyState };
