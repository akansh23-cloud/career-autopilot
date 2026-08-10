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
import { modelDomain } from '../domain/domainModeler.js';
import { compileFeatures } from './featureCompiler.js';
import { buildMvpScope } from './mvpScopeBuilder.js';
import { planScreens } from './screenPlanner.js';
import { planApis } from './apiPlanner.js';
import { planDatabaseModels, linkPlan } from './databasePlanner.js';
import { planFileTree } from './fileTreePlanner.js';
import { planTasks } from './taskPlanner.js';
import { planTests, planDeployment, planProof, planPatent } from './proofAndPlanners.js';
import { calculateProgress, currentPhase, nextBestAction, detectRisks, refreshRoadmapStatus } from './progressCalculator.js';
import { annotateDependencyState } from './dependencyPlanner.js';
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
  /* v2: the domain model is the source of truth for entity naming and
     fields. derivePrimaryEntity now delegates to it, so the whole plan
     speaks the student's vocabulary instead of "Record". */
  const domain = modelDomain(p, { auth: !!stack.features?.auth });
  const entity = domain.primary.name;
  const features = deriveFeatures(p);
  const featureSpecs = compileFeatures(p, domain, stack);

  const mvpScope = buildMvpScope(p, stack, features);
  const { screens, userJourneys } = planScreens(p, stack, features, entity);
  const apis = planApis(p, stack, entity, domain);
  const models = planDatabaseModels(p, stack, entity, domain);
  const fileTree = planFileTree(p, stack, { screens, apis, models, entity, domain, featureSpecs });
  const { tasks, roadmap } = planTasks(p, stack, { screens, apis, models, fileTree, features, entity, domain, featureSpecs });
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
    stack: { frontend: stack.frontend, backend: stack.backend, database: stack.database, isMern: stack.isMern, features: stack.features, cloudProvider: stack.cloudProvider, warnings: stack.warnings },
    primaryEntity: entity,
    domain,
    featureSpecs,
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
        : Number.isFinite(obj(architecture).validation?.score?.overallScore) ? architecture.validation.score.overallScore
        : Number.isFinite(obj(p.architectureValidation).score?.overallScore) ? p.architectureValidation.score.overallScore
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
  p.tasks = annotateDependencyState(arr(p.tasks));
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

/* ------------------------------------------------------------------
   applyArchitecturePatch — sync architecture refinements back into the
   workspace plan. Marks derived artifacts (starter pack, patent assets,
   docs) stale instead of silently leaving them outdated.
   ------------------------------------------------------------------ */
export function applyArchitecturePatch(plan = {}, archPatch = {}, { now } = {}) {
  const p = { ...obj(plan) };
  const cur = obj(p.architecture);
  const a = obj(archPatch);
  const validation = a.validation || a.architectureValidation || cur.validation || null;
  const next = {
    architectureSpec: a.architectureSpec || cur.architectureSpec || null,
    mermaidViews: a.mermaidViews || cur.mermaidViews || null,
    validation,
    designScore: Number.isFinite(a.designScore) ? a.designScore
      : Number.isFinite(validation?.score?.overallScore) ? validation.score.overallScore
      : cur.designScore ?? null,
  };
  const changed = JSON.stringify(next.architectureSpec) !== JSON.stringify(cur.architectureSpec || null)
    || JSON.stringify(next.validation) !== JSON.stringify(cur.validation || null);
  p.architecture = next;
  if (changed) {
    p.architectureUpdatedAt = nowIso(now);
    if (obj(p.starterPack).available) p.starterPack = { ...p.starterPack, stale: true };
    if (obj(p.patentAssets).enabled) p.patentAssets = { ...p.patentAssets, stale: true };
    p.docsStale = true;
  }
  return { plan: recalculatePlan(p, { now }), changed };
}
