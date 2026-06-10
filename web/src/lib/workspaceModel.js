// Project OS — consolidated Workspace view-model (pure + defensive).
//
// One place that turns a saved project into the data each consolidated
// Workspace tab needs (Overview, Why Build This, Architecture, Builder,
// Proof & Verification, Resume Output, Publish) and that groups projects for
// the Project OS Dashboard. Keeping this logic pure means the consolidation is
// unit-testable under `node --test` without a DOM, and every tab gets the same
// safe fallbacks for missing/old/malformed project shapes.

import { generateBuildGuide, computeProgress } from './buildGuide.js';
import { normalizeArchitecture, hasArchitectureData } from './architectureToBuildGuide.js';
import { calculateProjectStatus } from './projectStatus.js';
import { proofScore } from './proofScore.js';

const isArr = Array.isArray;
const arr = (v) => (isArr(v) ? v.filter((x) => x != null) : []);
const str = (v) => (v == null ? '' : (typeof v === 'string' ? v : (typeof v === 'number' || typeof v === 'boolean') ? String(v) : ''));
const obj = (v) => (v && typeof v === 'object' && !isArr(v) ? v : {});

/* The 7 consolidated workspace tabs (id + label), in display order. */
export const WORKSPACE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'whybuild', label: 'Why Build This' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'builder', label: 'Builder' },
  { id: 'proof', label: 'Proof & Verification' },
  { id: 'resume', label: 'Resume Output' },
  { id: 'publish', label: 'Publish' },
];

/* Proof statuses are independent of build progress. */
export const PROOF_STATUSES = ['Missing', 'Submitted', 'System Verified', 'Reviewer Verified', 'Rejected'];

function safeStatus(p) {
  try { return calculateProjectStatus(p); } catch { return { status: 'Draft', proofScore: 0, next: null, reasons: [] }; }
}
function safeProof(p) { try { return proofScore(p); } catch { return 0; } }
function safeBuild(p) {
  try { return computeProgress(generateBuildGuide(p || {}, { progress: obj(p).buildProgress })); }
  catch { return { progressPercent: 0, completedTasks: 0, totalTasks: 0, completedStages: 0, totalStages: 0, currentStageTitle: '—', nextAction: '' }; }
}
function safeGuide(p) {
  try { return generateBuildGuide(p || {}, { progress: obj(p).buildProgress }); }
  catch { return null; }
}
function safeArch(p) {
  try { return normalizeArchitecture(p || {}); }
  catch { return { components: [], screens: [], apis: [], entities: [], deployment: { frontend: '', backend: '', database: '', steps: [] } }; }
}

export function buildStarted(p) {
  const bp = obj(p).buildProgress;
  if (!bp) return false;
  return Object.values(bp.tasks || {}).some(Boolean) || Object.values(bp.prerequisites || {}).some(Boolean) || Object.values(bp.stages || {}).some(Boolean);
}

/* Builder CTA label, architecture-aware. */
export function builderCtaLabel(p) {
  if (buildStarted(p)) return 'Continue Build';
  try { return hasArchitectureData(p) ? 'Start Architecture-backed Build' : 'Start Build Guide'; }
  catch { return 'Start Build Guide'; }
}

/* ---- evidence-gated resume bullets ---- */
function isProofVerified(p) {
  const pj = obj(p);
  const ghOk = !!(pj.github && pj.github.success && Number(pj.github.githubScore || 0) >= 60);
  const liveOk = !!(pj.liveVerification && pj.liveVerification.reachable);
  return ghOk || liveOk;
}

export function buildWorkspaceModel(project) {
  const p = obj(project);
  const status = safeStatus(p);
  const proof = safeProof(p);
  const build = safeBuild(p);
  const guide = safeGuide(p);
  const arch = safeArch(p);
  const architectureBacked = !!(guide && guide.architectureBacked);
  const confidence = (guide && guide.confidence) || 'Low';

  const skills = arr(p.skillsCovered).map(str).filter(Boolean);
  const verified = isProofVerified(p);

  const missing = [];
  if (!arch.components.length) missing.push('No architecture components found');
  if (!arch.apis.length) missing.push('No API design found');
  if (!arch.entities.length) missing.push('No database schema found');
  if (!(arch.deployment.frontend || arch.deployment.backend || arch.deployment.database || arch.deployment.steps.length)) missing.push('No deployment target found');

  const draftBullets = arr(p.resumeBullets).map(str).filter(Boolean);

  return {
    tabs: WORKSPACE_TABS,
    title: str(p.title, 'Untitled project'),
    status: str(status.status, 'Draft'),

    overview: {
      title: str(p.title, 'Untitled project'),
      summary: str(p.summary || p.useCase || p.problemStatement, '—'),
      targetRole: str(p.targetRole || p.role, '—'),
      difficulty: str(p.difficulty, 'Intermediate'),
      status: str(status.status, 'Draft'),
      proofScore: proof,
      buildProgress: build.progressPercent,
      skillsProven: skills,
      nextBestAction: str(arr(status.reasons)[0] || build.nextAction || 'Open the Builder tab to start building.'),
      similarWarning: str(p.similarWarning || (obj(p.similar).note) || ''),
    },

    whyBuild: {
      targetRole: str(p.targetRole || p.role, '—'),
      whyItMatters: str(p.whyBuild || (obj(p.industry).overview && obj(p.industry).overview.realWorldProblem) || p.problemStatement, 'This project produces recruiter-visible proof of real, shippable work.'),
      skillGapsClosed: skills,
      jobReadiness: str(p.jobReadiness || `Demonstrates ${skills.slice(0, 3).join(', ') || 'core skills'} end-to-end.`),
      recruiterSignal: str(p.recruiterSignal || 'A deployed, documented project a recruiter can open in 60 seconds.'),
      evidenceNeeded: ['A public GitHub repo with real commit history', 'A working deployment (or strong screenshots/architecture)', 'A clear README'],
    },

    architecture: {
      summary: str(p.architecture || (obj(p.industry).technicalArchitecture && 'See system design below.') || '', ''),
      architectureBacked,
      components: arch.components,
      apis: arch.apis.map((a) => (a && a.path ? `${a.method || 'POST'} ${a.path}` : str(a))).filter(Boolean),
      entities: arch.entities.map((e) => str(e && e.entity)).filter(Boolean),
      deployment: [arch.deployment.frontend, arch.deployment.backend, arch.deployment.database].filter(Boolean),
      hasDiagrams: !!(str(p.architectureDiagram) || arr(p.diagrams).length),
      missing,
    },

    builder: {
      buildProgress: build.progressPercent,
      currentStage: str(build.currentStageTitle, '—'),
      nextTask: str(build.nextAction, ''),
      mvpScope: arr(p.mvpScope).map(str).filter(Boolean),
      architectureBacked,
      confidence,
      started: buildStarted(p),
      ctaLabel: builderCtaLabel(p),
      totalTasks: build.totalTasks,
      completedTasks: build.completedTasks,
    },

    proof: {
      // Build progress is execution; proof is evidence — kept explicitly separate.
      buildProgressPercent: build.progressPercent,
      proofScore: proof,
      verified,
      note: 'Build progress measures execution. Verified proof depends on real evidence (synced GitHub repo and/or a verified live demo) — not on completing build tasks.',
      statuses: PROOF_STATUSES,
      currentProofStatus: verified ? (Number(proof) >= 70 ? 'System Verified' : 'Submitted') : (str(p.githubUrl) || arr(p.screenshots).length ? 'Submitted' : 'Missing'),
      evidenceChecklist: [
        { label: 'Public GitHub repo', done: !!(p.github && p.github.success) },
        { label: 'GitHub analysis score 60+', done: !!(p.github && p.github.success && Number(p.github.githubScore || 0) >= 60) },
        { label: 'Verified live demo', done: !!(p.liveVerification && p.liveVerification.reachable) },
        { label: 'README present', done: !!(str(p.readme) || (p.github && p.github.readme && p.github.readme.exists)) },
      ],
    },

    resume: {
      // Verified bullets require evidence, NOT task completion.
      draftBullets,
      verifiedBullets: verified ? draftBullets : [],
      verifiedUnlocked: verified,
      recruiterSummary: str(p.recruiterSummary, ''),
      interview: arr(p.interviewQuestions).map((q) => (typeof q === 'string' ? q : str(obj(q).q || obj(q).question))).filter(Boolean),
      linkedinPost: str(p.linkedinPost || p.buildInPublicPost, ''),
    },

    publish: {
      githubUrl: str(p.githubUrl, ''),
      liveUrl: str(p.liveDemoUrl || p.liveUrl, ''),
      readmeStatus: (str(p.readme) || (p.github && p.github.readme && p.github.readme.exists)) ? 'Present' : 'Missing',
      portfolioVisible: !!p.published,
      recruiterVisible: status.status === 'Recruiter Ready',
      published: !!p.published,
      checklist: [
        { label: 'GitHub repo linked', done: !!str(p.githubUrl) },
        { label: 'Live demo linked', done: !!str(p.liveDemoUrl || p.liveUrl) },
        { label: 'README present', done: (str(p.readme) || (p.github && p.github.readme && p.github.readme.exists)) ? true : false },
        { label: 'Proof score 70+', done: Number(proof) >= 70 },
        { label: 'Published to portfolio', done: !!p.published },
      ],
    },
  };
}

/* ---- Dashboard grouping ---- */
export function dashboardGroups(projects = []) {
  const list = arr(projects);
  const groups = { active: [], recommended: [], draft: [], verified: [], published: [] };
  for (const p of list) {
    const st = safeStatus(p).status;
    if (p && p.published) groups.published.push(p);
    if (p && p.recommended) groups.recommended.push(p);
    if (st === 'Verified' || st === 'Recruiter Ready') groups.verified.push(p);
    if (st === 'Draft') groups.draft.push(p);
    if (st === 'In Progress' || st === 'Completed' || buildStarted(p)) groups.active.push(p);
  }
  return groups;
}

/* Compact card model for the dashboard. */
export function projectCardModel(project) {
  const p = obj(project);
  const status = safeStatus(p);
  const build = safeBuild(p);
  return {
    id: str(p.id),
    title: str(p.title, 'Untitled project'),
    targetRole: str(p.targetRole || p.role, '—'),
    skillsProven: arr(p.skillsCovered).map(str).filter(Boolean).slice(0, 5),
    buildProgress: build.progressPercent,
    proofScore: safeProof(p),
    status: str(status.status, 'Draft'),
    nextBestAction: str(arr(status.reasons)[0] || build.nextAction || 'Open the workspace to continue.'),
    ctaLabel: builderCtaLabel(p),
  };
}

export default { WORKSPACE_TABS, PROOF_STATUSES, buildWorkspaceModel, dashboardGroups, projectCardModel, builderCtaLabel, buildStarted };
