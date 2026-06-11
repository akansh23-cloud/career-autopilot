/* ============================================================
   Guided Project Workspace — plan builder (orchestrator).
   Deterministic only: same project in → same plan out. Uses the
   Architecture OS spec as the source of truth when present.
   Regeneration preserves user task progress by merging statuses
   back in by stable task id.
   ============================================================ */
import { arr, str, obj, nowIso } from './planUtils.js';
import { detectStack } from '../codegen/stackDetector.js';
import { derivePrimaryEntity, deriveFeatures } from './customProjectBuilder.js';
import { buildMvpScope } from './mvpScopeBuilder.js';
import { planScreens } from './screenPlanner.js';
import { planApis } from './apiPlanner.js';
import { planDatabaseModels, linkPlan } from './databasePlanner.js';
import { planFileTree } from './fileTreePlanner.js';
import { planTasks } from './taskPlanner.js';
import { planTests, planDeployment, planProof, planPatent } from './proofAndPlanners.js';
import { calculateProgress, currentPhase, nextBestAction, detectRisks, refreshRoadmapStatus } from './progressCalculator.js';
import { validateWorkspacePlan } from './workspaceValidator.js';

const PLAN_VERSION = 1;

/* Link tasks <-> files (a file's relatedTasks come from tasks' linkedFiles). */
function linkFiles(fileTree, tasks) {
  const byId = new Map(fileTree.map((f) => [f.id, f]));
  for (const t of tasks) {
    for (const fid of arr(t.linkedFiles)) {
      const f = byId.get(fid);
      if (f && !f.relatedTasks.includes(t.id)) f.relatedTasks.push(t.id);
    }
  }
}

/* Merge user progress from an existing plan into a regenerated one. */
function mergeProgress(nextPlan, prevPlan) {
  if (!prevPlan) return nextPlan;
  const prevTasks = new Map(arr(prevPlan.tasks).map((t) => [t.id, t]));
  nextPlan.tasks = nextPlan.tasks.map((t) => {
    const prev = prevTasks.get(t.id);
    return prev ? { ...t, status: prev.status, blockerReason: prev.blockerReason || '', updatedAt: prev.updatedAt || null } : t;
  });
  const prevProof = new Map(arr(prevPlan.proofRequirements).map((p) => [p.id, p]));
  nextPlan.proofRequirements = nextPlan.proofRequirements.map((p) => {
    const prev = prevProof.get(p.id);
    return prev ? { ...p, status: prev.status } : p;
  });
  if (obj(prevPlan.starterPack).available) nextPlan.starterPack = prevPlan.starterPack;
  return nextPlan;
}

export function buildWorkspacePlan({ project = {}, architecture = null, existingPlan = null, userId = '', now } = {}) {
  const p = obj(project);
  const architectureSpec = architecture && typeof architecture === 'object'
    ? (architecture.architectureSpec || architecture)
    : (p.architectureSpec || null);
  const stack = detectStack(p, architectureSpec);
  const entity = derivePrimaryEntity(p);
  const features = deriveFeatures(p);

  const mvpScope = buildMvpScope(p, stack, features);
  const { screens, userJourneys } = planScreens(p, stack, features, entity);
  const apis = planApis(p, stack, entity);
  const models = planDatabaseModels(p, stack, entity);
  const fileTree = planFileTree(p, stack, { screens, apis, models, entity });
  const { tasks, roadmap } = planTasks(p, stack, { screens, apis, models, fileTree, features, entity });
  linkPlan({ screens, apis, models, tasks });
  linkFiles(fileTree, tasks);

  const at = nowIso(now);
  let plan = {
    id: `wsp_${str(p.id) || 'project'}`,
    projectId: str(p.id),
    userId: str(userId),
    title: str(p.title) || 'Project workspace',
    generatedAt: at,
    updatedAt: at,
    version: PLAN_VERSION,
    stack: { frontend: stack.frontend, backend: stack.backend, database: stack.database, isMern: stack.isMern, warnings: stack.warnings },
    primaryEntity: entity,
    projectSummary: {
      title: str(p.title),
      problemStatement: str(p.problemStatement || p.useCase),
      targetUsers: str(p.targetUsers),
      category: str(p.category || p.type),
      targetRole: str(p.targetRole),
      difficulty: str(p.difficulty) || 'Intermediate',
      techStack: arr(p.techStack).map(str),
      cloudProvider: stack.cloudProvider,
      shortDescription: `${str(p.title) || 'This project'} — a ${str(p.category || p.type) || 'web app'} for ${str(p.targetUsers) || 'its users'}, built with ${arr(p.techStack).slice(0, 4).join(', ') || 'a MERN stack'}.`.slice(0, 300),
    },
    mvpScope,
    visualPreview: { userJourneys, screens },
    architecture: {
      architectureSpec: architectureSpec || null,
      mermaidViews: obj(architecture).mermaidViews || null,
      validation: obj(architecture).validation || p.architectureValidation || null,
      designScore: Number.isFinite(obj(architecture).designScore) ? architecture.designScore
        : Number.isFinite(obj(p.architectureValidation).score) ? p.architectureValidation.score : null,
    },
    roadmap,
    tasks,
    fileTree,
    apiPlan: apis,
    databaseModels: models,
    testPlan: planTests(p, stack, { entity, tasks }),
    deploymentPlan: planDeployment(p, stack),
    proofRequirements: planProof(p, stack),
    patentAssets: planPatent(p, stack, architectureSpec),
    starterPack: { available: false, lastGeneratedAt: null, packId: null, includedFiles: [], setupCommands: [], warnings: [] },
    progress: { totalTasks: 0, doneTasks: 0, verifiedTasks: 0, blockedTasks: 0, percentDone: 0, percentVerified: 0 },
  };

  plan = mergeProgress(plan, existingPlan);
  return recalculatePlan(plan, { now });
}

/* Refresh all derived fields (progress, phase status, next action, risks). */
export function recalculatePlan(plan = {}, { now } = {}) {
  const p = { ...obj(plan) };
  p.progress = calculateProgress(p);
  p.roadmap = refreshRoadmapStatus(p);
  p.currentPhase = currentPhase(p);
  p.nextAction = nextBestAction(p);
  p.risks = detectRisks(p);
  p.validation = validateWorkspacePlan(p);
  p.updatedAt = nowIso(now);
  return p;
}

/* Apply a task status/details patch. Done and Verified stay separate:
   `verified` can only be set by the (future) verification flow, so a user
   patch requesting `verified` is downgraded to `done` with a note. */
export function applyTaskPatch(plan = {}, taskId = '', patch = {}, { allowVerified = false, now } = {}) {
  const p = { ...obj(plan) };
  const notes = [];
  p.tasks = arr(p.tasks).map((t) => {
    if (t.id !== taskId) return t;
    const next = { ...t };
    if (patch.status) {
      let s = str(patch.status);
      if (s === 'verified' && !allowVerified) { s = 'done'; notes.push('Tasks cannot be self-marked Verified — saved as Done. Verification will come from evidence (GitHub/tests/deployment).'); }
      if (['backlog', 'ready', 'in_progress', 'blocked', 'done', 'verified'].includes(s)) next.status = s;
    }
    if (patch.blockerReason != null) next.blockerReason = str(patch.blockerReason).slice(0, 400);
    if (next.status !== 'blocked') next.blockerReason = '';
    next.updatedAt = nowIso(now);
    return next;
  });
  return { plan: recalculatePlan(p, { now }), notes };
}
