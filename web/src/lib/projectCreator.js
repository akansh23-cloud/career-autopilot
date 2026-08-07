// Project Creator — Product Building Operating System (orchestration layer).
//
// This module does NOT reinvent project generation. It orchestrates the
// existing rich, deterministic engine (lib/projectGen.buildProject, the proof
// engine, projectStatus, architecture/mermaid, githubSync) into a guided
// 6-step flow: Discover -> Validate -> Blueprint -> Build -> Verify -> Publish.
//
// Server AI endpoints (/api/creator/*) enhance each step when the deployment has
// AI credentials configured; every call falls back to deterministic output so
// the UI always works.
// AI keys never reach the client. Created projects are saved into the SAME
// projectStore used by XP/badges/sandbox/recruiter, so all downstream features
// keep working unchanged.

import { api } from './api.js';
import { buildProject, generateRoadmap as genRoadmap } from './projectGen.js';
import { getProfile } from './userProfile.js';
import { getStoredResume, getSelectedJob } from './resumeStore.js';
import { saveProject, saveProjectDetailed, getProject, getProjects, uid, savePartnerRequest, findDuplicateProject } from './projectStore.js';
import { canCreateWorkspace, workspaceAllowance, isUnlimited, effectivePlan, PLAN_LABELS_FULL } from './plan.js';
import { calculateProjectStatus } from './projectStatus.js';
import { proofBreakdown } from './proofScore.js';
import { generateIdeas, bucketIdeas } from './ideaEngine.js';
import { assessPatentability, canRegisterPatent as _canRegister, PATENT_STAGES, PATENT_DISCLAIMER } from './patentEngine.js';

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */
export const CREATOR_STEPS = [
  { id: 'discover', label: 'Discover' },
  { id: 'validate', label: 'Validate' },
  { id: 'blueprint', label: 'Blueprint' },
  { id: 'build', label: 'Build Roadmap' },
  { id: 'verify', label: 'Verify' },
  { id: 'publish', label: 'Publish' },
];
export const CREATOR_TYPES = ['Career Project', 'Portfolio Project', 'Startup Experiment', 'SaaS MVP', 'Hackathon Project', 'Open Source Tool'];
export const START_SOURCES = [
  { id: 'role', label: 'My target role' },
  { id: 'resume', label: 'My resume gaps' },
  { id: 'job', label: 'A saved job' },
  { id: 'marketplace', label: 'A marketplace idea' },
  { id: 'startup', label: 'A startup problem' },
  { id: 'github', label: 'GitHub inspiration' },
  { id: 'producthunt', label: 'Product Hunt trend' },
  { id: 'kaggle', label: 'A Kaggle dataset' },
  { id: 'custom', label: 'My own idea' },
];
export const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced'];
export const DURATIONS = ['Weekend', '1 week', '2 weeks', '1 month'];
export const CATEGORY_ORDER = ['Best Career Fit', 'Best Quick Win', 'Best Portfolio Impact', 'Best Startup Potential', 'Best Beginner-Friendly'];

/* Curated, internal idea/problem bank (no fake USER projects — these are clearly
   labelled inspiration ideas, used by the marketplace + "start from" sources). */
export const IDEA_BANK = [
  { id: 'idea-attendance-ai', title: 'AI attendance + engagement analytics for coaching centres', type: 'SaaS MVP', category: 'Data/AI Ideas',
    problem: 'Small coaching institutes track attendance on paper and have no view of student engagement or drop-off risk.',
    skills: ['React', 'Node.js', 'Postgres', 'Computer Vision or CSV import', 'Analytics'], difficulty: 'Intermediate', startupPotential: 78 },
  { id: 'idea-clinic-followup', title: 'Patient follow-up + reminder system for small clinics', type: 'Startup Experiment', category: 'Startup Problems',
    problem: 'Clinics lose repeat patients because follow-ups, reminders and history are managed manually.',
    skills: ['Auth', 'WhatsApp/SMS API', 'Scheduling', 'Dashboard'], difficulty: 'Intermediate', startupPotential: 80 },
  { id: 'idea-resume-jd-match', title: 'Resume ↔ JD gap analyzer with proof suggestions', type: 'Portfolio Project', category: 'Data/AI Ideas',
    problem: 'Candidates do not know which exact skills their resume is missing for a target job.',
    skills: ['NLP', 'LLM integration', 'React', 'APIs'], difficulty: 'Intermediate', startupPotential: 60 },
  { id: 'idea-local-logistics', title: 'Route + delivery optimizer for local stores', type: 'Startup Experiment', category: 'Startup Problems',
    problem: 'Local shops doing home delivery plan routes by hand, wasting time and fuel.',
    skills: ['Maps API', 'Optimization', 'Node.js', 'Mobile-friendly UI'], difficulty: 'Advanced', startupPotential: 72 },
  { id: 'idea-hackathon-civic', title: '24-hour civic issue reporting + heatmap', type: 'Hackathon Project', category: 'Hackathon Style',
    problem: 'Citizens have no quick way to report and visualise local civic issues.',
    skills: ['React', 'Geolocation', 'Maps', 'Realtime DB'], difficulty: 'Beginner', startupPotential: 40 },
  { id: 'idea-oss-env', title: 'Open-source .env validator + secret scanner CLI', type: 'Open Source Tool', category: 'Product Ideas',
    problem: 'Developers ship broken configs and leak secrets because there is no lightweight pre-commit check.',
    skills: ['Node.js/Python', 'CLI', 'Testing', 'Packaging'], difficulty: 'Beginner', startupPotential: 30 },
  { id: 'idea-finance-ledger', title: 'Multi-tenant expense + invoice tool for freelancers', type: 'SaaS MVP', category: 'Product Ideas',
    problem: 'Freelancers juggle invoices, expenses and taxes across spreadsheets and apps.',
    skills: ['Auth', 'Multi-tenant', 'Postgres', 'PDF generation', 'Payments'], difficulty: 'Advanced', startupPotential: 74 },
  { id: 'idea-data-pipeline', title: 'End-to-end ELT pipeline with data-quality dashboard', type: 'Career Project', category: 'Data/AI Ideas',
    problem: 'Data roles require proof of building reliable pipelines with quality checks, not just notebooks.',
    skills: ['Python', 'Airflow', 'dbt', 'Postgres', 'Great Expectations'], difficulty: 'Advanced', startupPotential: 45 },
];
export const MARKETPLACE_TABS = ['Published Projects', 'Product Ideas', 'Startup Problems', 'Trending from GitHub', 'Product Hunt Inspired', 'Data/AI Ideas', 'Hackathon Style'];

/* ------------------------------------------------------------------ */
/* Persistence (creator workspace: recommendations + selection + ctx) */
/* ------------------------------------------------------------------ */
const CREATOR_KEY = 'careerAutopilot.creator.v1';
let userKey = 'guest';
const EV = 'career-creator-updated';
function normKey(user) { const r = user?.email || user?.id || 'guest'; return String(r).trim().toLowerCase().replace(/[^a-z0-9@._-]+/g, '_') || 'guest'; }
export function setCreatorUser(user) { userKey = normKey(user); }
function scoped() { return `${CREATOR_KEY}:${userKey}`; }
function readLocal() {
  if (typeof window === 'undefined') return {};
  try { const r = window.localStorage.getItem(scoped()) || (userKey !== 'guest' ? window.localStorage.getItem(CREATOR_KEY) : null); return r ? JSON.parse(r) : {}; } catch { return {}; }
}
function writeLocal(state) {
  if (typeof window === 'undefined') return state;
  try { window.localStorage.setItem(scoped(), JSON.stringify(state)); } catch {}
  window.dispatchEvent(new CustomEvent(EV, { detail: state }));
  return state;
}
async function patchServer(creator) {
  try { await api.patch('/api/user/state', { creator }); } catch {}
}
export const CREATOR_EVENT = EV;

export function getCreatorState() {
  const s = readLocal();
  return { recommendations: [], selectedId: null, context: {}, lastSource: 'role', ...s };
}
export function saveCreatorState(patch) {
  const next = { ...getCreatorState(), ...patch, updatedAt: new Date().toISOString() };
  writeLocal(next);
  patchServer(next);
  return next;
}
export async function hydrateCreatorFromServer() {
  try {
    const r = await api.get('/api/user/state');
    const c = r?.state?.creator;
    if (c && typeof c === 'object' && Object.keys(c).length) writeLocal({ ...getCreatorState(), ...c });
  } catch {}
  return getCreatorState();
}

/* ------------------------------------------------------------------ */
/* Context assembly — real signals from profile + resume + saved job  */
/* ------------------------------------------------------------------ */
const asList = (v) => Array.isArray(v) ? v.filter(Boolean) : (typeof v === 'string' ? v.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean) : []);

export function assembleContext(overrides = {}) {
  const prof = getProfile();
  const resume = getStoredResume();
  const an = resume?.analysis || {};
  const job = getSelectedJob();
  const missing = asList(an.missingSkills || an.gaps || an.skillGaps || an.missing || []);
  const current = asList(prof.skills || an.matchedSkills || an.currentSkills || an.presentSkills || []);
  return {
    role: prof.role || 'student',
    targetRole: overrides.targetRole || prof.targetRole || prof.hiringRole || resume?.targetRole || 'Software Engineer',
    yearSem: prof.yearSem || '',
    branch: prof.branch || '',
    currentSkills: current,
    missingSkills: missing,
    weeklyTime: prof.weeklyTime || overrides.weeklyTime || '6–10 hrs',
    difficulty: overrides.difficulty || (prof.yearSem && /1|2/.test(prof.yearSem) ? 'Beginner' : 'Intermediate'),
    duration: overrides.duration || '2 weeks',
    preferredType: overrides.preferredType || '',
    startFrom: overrides.startFrom || 'role',
    customIdea: overrides.customIdea || '',
    savedJob: job ? `${job.title || ''} — ${job.company || ''}\n${(job.description || job.snippet || '').slice(0, 500)}` : '',
    hasResume: !!(an && Object.keys(an).length),
    hasSavedJob: !!job,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Part 3 — Project Fit Score (transparent, client-side, always shown) */
/* ------------------------------------------------------------------ */
const FIT_WEIGHTS = {
  targetRoleMatch: 20, missingSkillCoverage: 20, resumeGapImprovement: 15,
  jobMarketRelevance: 15, userLevelFit: 10, proofPotential: 10, startupPotential: 10,
};
const HOT_SKILLS = ['ai', 'ml', 'llm', 'cloud', 'aws', 'kubernetes', 'docker', 'react', 'typescript', 'data', 'spark', 'analytics', 'security', 'devops', 'api'];
function roleMatch(recRole = '', ctxRole = '') {
  const a = recRole.toLowerCase(), b = ctxRole.toLowerCase();
  if (!a || !b) return 0.6;
  if (a === b) return 1;
  return (a.includes(b) || b.includes(a) || a.split(' ')[0] === b.split(' ')[0]) ? 0.7 : 0.35;
}
const lower = (arr) => (arr || []).map((s) => String(s).toLowerCase());

export function projectFitScore(rec = {}, ctx = {}) {
  const recSkills = lower(rec.skillsCovered || rec.skills);
  const missing = lower(ctx.missingSkills);
  const covered = missing.filter((m) => recSkills.some((s) => s.includes(m) || m.includes(s)));
  const parts = {
    targetRoleMatch: roleMatch(rec.targetRoleFit || rec.targetRole, ctx.targetRole),
    missingSkillCoverage: missing.length ? Math.min(1, covered.length / missing.length) : Math.min(1, recSkills.length / 6),
    resumeGapImprovement: ctx.hasResume ? (missing.length ? Math.min(1, covered.length / Math.max(2, missing.length) + 0.15) : 0.5) : 0.55,
    jobMarketRelevance: Math.min(1, (recSkills.filter((s) => HOT_SKILLS.some((h) => s.includes(h))).length / 4) + roleMatch(rec.targetRoleFit, ctx.targetRole) * 0.3),
    userLevelFit: (() => { const d = (rec.difficulty || '').toLowerCase(), c = (ctx.difficulty || '').toLowerCase(); if (!d || !c) return 0.7; if (d === c) return 1; const order = ['beginner', 'intermediate', 'advanced']; return Math.abs(order.indexOf(d) - order.indexOf(c)) === 1 ? 0.6 : 0.35; })(),
    proofPotential: Math.min(1, (rec.proofPotential ?? 70) / 100),
    startupPotential: Math.min(1, (rec.startupPotential ?? 40) / 100),
  };
  const rows = Object.keys(FIT_WEIGHTS).map((k) => ({ key: k, weight: FIT_WEIGHTS[k], pct: parts[k], score: Math.round(parts[k] * FIT_WEIGHTS[k]) }));
  const score = Math.min(100, rows.reduce((s, r) => s + r.score, 0));
  return { score, confidence: score >= 80 ? 'High' : score >= 60 ? 'Medium' : 'Low', rows, coveredCount: covered.length, missingTotal: missing.length };
}

export const FIT_LABELS = {
  targetRoleMatch: 'Target role match', missingSkillCoverage: 'Missing-skill coverage', resumeGapImprovement: 'Resume-gap improvement',
  jobMarketRelevance: 'Job-market relevance', userLevelFit: 'Your level fit', proofPotential: 'Proof potential', startupPotential: 'Startup/business potential',
};

/* ------------------------------------------------------------------ */
/* Part 2 — Discovery                                                  */
/* ------------------------------------------------------------------ */
export async function discover(ctx = {}, opts = {}) {
  // 1) OUR engine is the authoritative source — it always produces concrete,
  //    personalized, ranked ideas offline (no AI prompt required).
  const engineIdeas = generateIdeas(ctx, { count: opts.count || 9, salt: opts.salt != null ? opts.salt : 0 });
  let recs = [...engineIdeas];
  let generatedBy = 'engine';
  // 2) Optional AI augmentation: ADD any novel server ideas; never replace ours.
  try {
    const r = await api.post('/api/creator/discover', ctx);
    if (r && r.ok && Array.isArray(r.recommendations) && r.recommendations.length) {
      const have = new Set(recs.map((x) => String(x.title || '').toLowerCase()));
      const extra = r.recommendations.filter((x) => x && x.title && !have.has(String(x.title).toLowerCase()));
      if (extra.length) { recs = [...recs, ...extra]; generatedBy = 'engine+ai'; }
    }
  } catch {}
  // transparent fit score, rank, then bucket into the UI's category sections
  const withFit = recs.map((rec) => ({ ...rec, id: rec.id || uid('rec'), fit: projectFitScore(rec, ctx) }));
  withFit.sort((a, b) => b.fit.score - a.fit.score);
  return { recommendations: bucketIdeas(withFit), generatedBy };
}

export async function fetchTrends() {
  try { const r = await api.get('/api/creator/trends'); if (r && r.ok) return r; } catch {}
  return { github: [], productHunt: [], sources: { github: false, productHunt: false } };
}

/* ------------------------------------------------------------------ */
/* Create a real project from a recommendation (into the shared store) */
/* ------------------------------------------------------------------ */
export async function createProjectFromRec(rec = {}, ctx = {}) {
  // Use the existing deterministic+AI engine for the heavy lifting, then attach creator metadata.
  const input = {
    title: rec.title,
    targetRole: rec.targetRoleFit || ctx.targetRole,
    difficulty: rec.difficulty || ctx.difficulty,
    duration: rec.estimatedDuration || ctx.duration,
    type: mapTypeToEngine(rec.type),
    sourceMissingSkills: rec.missingSkillsCovered && rec.missingSkillsCovered.length ? rec.missingSkillsCovered : ctx.missingSkills,
    problemStatement: rec.summary,
  };
  let project;
  try { project = await genRoadmap(input); } catch { project = buildProject(input); }
  project.id = project.id || uid('proj');
  /* Final authority on identity: the card the student clicked. Whatever the
     generation layer returns, THIS project is the recommendation they chose. */
  if (String(rec.title || '').trim()) project.title = String(rec.title).trim();
  if (String(rec.summary || '').trim()) project.problemStatement = String(rec.summary).trim();
  project.creator = {
    fromRecommendation: rec,
    productType: rec.type,
    category: rec.category,
    targetUsers: rec.targetUsers,
    summary: rec.summary,
    fitScore: rec.fit?.score ?? projectFitScore(rec, ctx).score,
    startupPotential: rec.startupPotential ?? 40,
    proofPotential: rec.proofPotential ?? 70,
    expectedProofOutputs: rec.expectedProofOutputs || [],
    createdVia: 'project-creator',
    step: 'validate',
  };
  // keep a human summary used by sandbox cards
  project.summary = rec.summary;

  // Workspace cap: previously declared in plan.js and never checked, so a
  // capped student got no project and no explanation. Now it fails loudly.
  const existingCount = getProjects().length;
  const wouldBeNew = !findDuplicateProject(project);
  if (wouldBeNew && !canCreateWorkspace(existingCount)) {
    const cap = workspaceAllowance();
    const err = new Error(
      `Your ${PLAN_LABELS_FULL[effectivePlan()] || 'current'} plan keeps ${isUnlimited(cap) ? 'unlimited' : cap} active project workspace${cap === 1 ? '' : 's'}. `
      + 'Delete or archive one from Project Studio, or upgrade to build more in parallel.',
    );
    err.code = 'workspace_limit';
    err.workspaceLimit = { cap, existingCount };
    throw err;
  }

  const outcome = saveProjectDetailed(project);
  // Surface the dedupe fold so the caller can tell the student their build
  // went into an existing workspace rather than silently vanishing.
  return Object.assign(outcome.project, {
    __merged: outcome.merged,
    __mergedWith: outcome.mergedWith,
  });
}
function mapTypeToEngine(t = '') {
  const s = t.toLowerCase();
  if (s.includes('data') || s.includes('ai') || s.includes('ml')) return 'AI/ML';
  if (s.includes('open source')) return 'Backend';
  if (s.includes('saas') || s.includes('startup') || s.includes('career') || s.includes('portfolio')) return 'Full Stack';
  if (s.includes('hackathon')) return 'Frontend';
  return 'Full Stack';
}

/* ------------------------------------------------------------------ */
/* Part 4 — Validation                                                 */
/* ------------------------------------------------------------------ */
const VAL_WEIGHTS = { problemClarity: 20, userNeed: 20, feasibility: 15, differentiation: 15, careerValue: 10, startupPotential: 12, proofPotential: 13 };
export const VAL_LABELS = { problemClarity: 'Problem clarity', userNeed: 'User need', feasibility: 'Feasibility', differentiation: 'Differentiation', careerValue: 'Career value', startupPotential: 'Startup potential', proofPotential: 'Proof potential' };
export function validationTotal(score = {}) {
  return Math.min(100, Object.keys(VAL_WEIGHTS).reduce((s, k) => s + Math.min(VAL_WEIGHTS[k], Number(score[k] || 0)), 0));
}
function deterministicValidationReport(idea = {}) {
  const skills = idea.skillsCovered || idea.skills || [];
  const startup = Number(idea.startupPotential ?? 50);
  const proof = Number(idea.proofPotential ?? 72);
  const hasProblem = String(idea.summary || idea.problemStatement || '').trim().length >= 20;
  const score = {
    problemClarity: hasProblem ? 17 : 9,
    userNeed: idea.targetUsers ? 16 : 11,
    feasibility: skills.length ? 13 : 9,
    differentiation: idea.novelty?.inventiveAngle ? 13 : 9,
    careerValue: 8,
    startupPotential: Math.round((startup / 100) * 12),
    proofPotential: Math.round((proof / 100) * 13),
  };
  return {
    problemSeverity: startup >= 70 ? 'High — users actively feel this pain.' : 'Medium — a real but not yet urgent pain.',
    targetUsers: idea.targetUsers || 'Users who experience the stated problem',
    userPainPoints: [idea.problem || idea.summary || 'Manual, error-prone current workflow', 'No single tool that closes the loop', 'Time and money lost to the status quo'],
    existingAlternatives: ['Spreadsheets / manual process', 'Generic horizontal tools not built for this niche', 'Point solutions that solve only part of it'],
    whyAlternativesWeak: ['Not tailored to the specific workflow', 'No automation of the key step', idea.novelty?.inventiveAngle ? `None offer ${idea.novelty.inventiveAngle}` : 'Poor fit for the target users'],
    firstTenUsersStrategy: ['Hand-recruit 10 users from the exact niche', 'Offer to set it up for them personally', 'Iterate weekly on their feedback'],
    differentiator: idea.novelty?.inventiveAngle || 'A focused, automated workflow for one underserved niche',
    score,
  };
}
export async function validateIdea(idea = {}) {
  const base = deterministicValidationReport(idea);
  let report = base;
  let generatedBy = 'engine';
  try {
    const r = await api.post('/api/creator/validate', { idea });
    if (r && r.ok && r.report) { report = { ...base, ...r.report, score: { ...base.score, ...(r.report.score || {}) } }; generatedBy = r.generatedBy || 'ai'; }
  } catch {}
  const total = validationTotal(report.score || {});
  return { report, total, generatedBy };
}

/* ------------------------------------------------------------------ */
/* Deterministic validation (#6) — objective, reproducible checks that  */
/* do NOT depend on the AI. These are the AUTHORITATIVE gate; the AI    */
/* report is only ever shown as a suggestion alongside these.          */
/* ------------------------------------------------------------------ */
function durationToDays(d = '') {
  const s = String(d).toLowerCase().trim();
  if (!s) return null;
  if (s.includes('weekend')) return 2;
  const m = s.match(/(\d+(?:\.\d+)?)\s*(day|week|month)/);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 'day' ? n : m[2] === 'week' ? n * 7 : n * 30;
}

export function deterministicValidation(project = {}) {
  const checks = [];
  const add = (id, label, ok, detail = '') => checks.push({ id, label, ok, detail });

  const title = String(project.title || '').trim();
  const targetRole = String(project.targetRole || project.creator?.fromRecommendation?.targetRoleFit || '').trim();
  const skills = Array.isArray(project.skillsCovered) ? project.skillsCovered.filter(Boolean) : [];
  const gaps = (project.sourceMissingSkills || project.creator?.fromRecommendation?.missingSkillsCovered || []).filter(Boolean);
  const summary = project.problemStatement || project.summary || project.creator?.summary || '';
  const milestones = project.industry?.milestones || [];
  const hasArchitecture = !!(String(project.architectureDiagram || '').trim() || String(project.architecture || '').trim());
  const days = durationToDays(project.duration);

  // Required fields (blocking)
  add('title', 'Project has a title', !!title, title ? '' : 'Add a project title before validating.');
  add('targetRole', 'Target role is set', !!targetRole, targetRole ? '' : 'Set the target role this project supports.');
  add('skillGap', 'At least one skill / skill gap to build', gaps.length > 0 || skills.length > 0, (gaps.length || skills.length) ? '' : 'Add the skills or gaps this project should cover.');

  // Quality checks (non-blocking but surfaced)
  add('summary', 'Has a problem statement', String(summary).trim().length >= 20, String(summary).trim().length >= 20 ? '' : 'Describe the problem this project solves (≥20 chars).');
  const dup = findDuplicateProject(project);
  add('duplicate', 'Not a duplicate of an existing project', !dup, dup ? `Matches existing project "${dup.title}". Open that one instead of creating another.` : '');
  const durationOk = days == null ? true : days >= 2 && days <= 120;
  add('duration', 'Roadmap duration is realistic', durationOk, durationOk ? '' : `"${project.duration}" looks unrealistic — choose between a weekend and ~3 months.`);
  add('architecture', 'System architecture present', hasArchitecture, hasArchitecture ? '' : 'Generate the blueprint to produce a system architecture.');
  add('milestones', 'Roadmap has milestones', milestones.length > 0, milestones.length ? '' : 'Generate the build roadmap to produce milestones.');

  const REQUIRED = ['title', 'targetRole', 'skillGap'];
  const blocking = checks.filter((c) => !c.ok && REQUIRED.includes(c.id));
  const passed = checks.filter((c) => c.ok).length;
  return {
    checks,
    passed,
    total: checks.length,
    requiredOk: blocking.length === 0, // gates blueprint/roadmap generation
    blocking,
    duplicate: dup ? { id: dup.id, title: dup.title } : null,
  };
}

/* ------------------------------------------------------------------ */
/* Part 5 — Blueprint (reuses buildProject industry detail + mermaid)  */
/* ------------------------------------------------------------------ */
function deterministicBlueprint(project = {}) {
  const ind = project.industry || {};
  const feat = ind.features || {};
  return {
    mvpScope: (feat.mustHave || []).slice(0, 5),
    outOfScope: (feat.advanced || []).slice(0, 3),
    personas: ind.businessContext?.personas || [project.creator?.targetUsers || 'Primary user'],
    coreWorkflows: ind.businessContext?.coreWorkflows || ['Onboard', 'Perform the core task', 'Review results'],
    techStack: project.techStack || [],
    architecture: project.architecture || '',
    architectureDiagram: project.architectureDiagram || '',
    dataModel: ind.dataModel || project.databaseSchema || [],
    apiDesign: ind.apiDesign || [],
    nonFunctional: feat.nonFunctional || [],
    milestones: ind.milestones || [],
    launchChecklist: ['Deploy to a public URL', 'Write the README with screenshots', 'Add basic analytics', 'Recruit the first 10 users', 'Collect feedback and iterate'],
    successMetrics: ['Core task completion rate', 'Time saved vs the manual process', 'Weekly active users'],
  };
}
export async function buildBlueprint(project = {}) {
  const base = deterministicBlueprint(project);
  let blueprint = base;
  let generatedBy = 'engine';
  try { const r = await api.post('/api/creator/blueprint', { project }); if (r && r.ok && r.blueprint) { blueprint = { ...base, ...r.blueprint }; generatedBy = r.generatedBy || 'ai'; } } catch {}
  return { blueprint, generatedBy };
}

/* ------------------------------------------------------------------ */
/* Part 6 — Adaptive build roadmap (reuses engine milestones/tasks)    */
/* ------------------------------------------------------------------ */
export function adaptiveTasks(project = {}, level = 'Intermediate') {
  // The engine already produced rich guideTasks + milestones; adapt density by level.
  const guide = project.guideTasks || project.industry?.guideTasks || [];
  const milestones = project.industry?.milestones || [];
  // Build mentor-level tasks from milestones (each task carries the rich shape).
  const tasks = [];
  milestones.forEach((m) => {
    const baseTasks = m.tasks || [];
    const take = level === 'Beginner' ? baseTasks : level === 'Advanced' ? baseTasks.slice(0, Math.max(2, Math.ceil(baseTasks.length / 2))) : baseTasks.slice(0, Math.max(2, baseTasks.length - 1));
    take.forEach((t, i) => {
      tasks.push({
        id: uid('mt'),
        milestone: m.title,
        title: t,
        whyItMatters: m.goal,
        filesToCreateOrEdit: (guide[(tasks.length) % Math.max(1, guide.length)]?.filesToCreate) || [],
        detailedSteps: level === 'Beginner' ? [`Open the relevant file(s)`, t, 'Run it locally and confirm it works'] : [t],
        expectedOutput: m.expectedOutput,
        howToTest: (m.verification || []).join('; '),
        commonMistakes: m.commonMistakes,
        estimatedTime: level === 'Beginner' ? '45–90 min' : '30–60 min',
        skillsPracticed: (project.skillsCovered || []).slice(0, 3),
        status: 'todo',
      });
    });
  });
  if (!tasks.length && Array.isArray(project.tasks)) return project.tasks;
  return tasks;
}

export async function buildAdaptiveRoadmap(project = {}, level = 'Intermediate') {
  // Ensure the project has engine detail; if missing, regenerate.
  let p = project;
  if (!p.industry || !p.industry.milestones) {
    try { p = await genRoadmap({ title: p.title, targetRole: p.targetRole, difficulty: level, duration: p.duration, type: p.type, sourceMissingSkills: p.sourceMissingSkills }); p.id = project.id; p.creator = project.creator; } catch { /* keep */ }
  }
  const tasks = adaptiveTasks(p, level);
  const next = { ...p, tasks, creator: { ...(p.creator || {}), roadmapLevel: level, step: 'build' } };
  return saveProject(next);
}

export function roadmapProgress(project = {}) {
  const t = project.tasks || [];
  if (!t.length) return 0;
  return Math.round((t.filter((x) => x.status === 'done').length / t.length) * 100);
}
export function toggleTask(projectId, taskId) {
  const p = getProject(projectId);
  if (!p) return null;
  const tasks = (p.tasks || []).map((t) => t.id === taskId ? { ...t, status: t.status === 'done' ? 'todo' : 'done' } : t);
  return saveProject({ ...p, tasks });
}

/* ------------------------------------------------------------------ */
/* Part 7 — Verification + Startup Ready (extends projectStatus)       */
/* ------------------------------------------------------------------ */
export function creatorStatus(project = {}) {
  const base = calculateProjectStatus(project); // Draft..Recruiter Ready
  const proof = base.proofScore;
  const v = project.creator?.validation;
  const valTotal = v ? (v.total ?? validationTotal(v.report?.score || {})) : 0;
  const startupReqs = [];
  if (valTotal < 75) startupReqs.push(`raise the validation score to 75+ (now ${valTotal})`);
  if (!(project.creator?.blueprint?.mvpScope?.length)) startupReqs.push('complete the MVP scope in the blueprint');
  if (!(project.creator?.targetUsers || project.creator?.blueprint?.personas?.length)) startupReqs.push('define your target users');
  if (!(project.creator?.validation?.report?.firstTenUsersStrategy?.length)) startupReqs.push('add a first-10-users plan');
  if (!(project.creator?.blueprint?.launchChecklist?.length)) startupReqs.push('prepare the launch checklist');
  const startupReady = startupReqs.length === 0;
  return { ...base, startupReady, startupReqs, validationTotal: valTotal, proofBreakdown: proofBreakdown(project) };
}

/* ------------------------------------------------------------------ */
/* Part 8 — IP / Patent readiness                                      */
/* ------------------------------------------------------------------ */
export const IP_DISCLAIMER = PATENT_DISCLAIMER;
export { PATENT_STAGES, PATENT_DISCLAIMER };

// Deterministic patentability assessment (our own engine). `attest` carries the
// user's prior-art/disclosure confirmations. AI, if present, only augments.
export async function buildIpReadiness(project = {}, attest = {}) {
  const base = assessPatentability(project, attest);
  let report = base;
  let generatedBy = 'engine';
  try { const r = await api.post('/api/creator/ip', { project }); if (r && r.ok && r.report) { report = { ...base, ...r.report }; generatedBy = r.generatedBy || 'ai'; } } catch {}
  return { report, generatedBy };
}

/* ---- Guided patent registration workflow (criteria-gated, end-to-end) ---- */
export function canRegisterPatent(report) { return _canRegister(report); }

// Begin a patent dossier for a project once it passes the eligibility gate.
export function startPatentRegistration(projectId, attest = {}) {
  const p = getProject(projectId);
  if (!p) return null;
  const report = assessPatentability(p, attest);
  const prev = p.creator?.patent || {};
  const patent = { ...report, stageId: prev.stageId && prev.stageId !== 'assessed' ? prev.stageId : 'assessed', startedAt: prev.startedAt || new Date().toISOString(), filing: prev.filing || {} };
  return persistProjectStep(projectId, { patent, ipReadiness: report });
}
// Move the dossier along its pipeline (Assessed → … → Granted).
export function advancePatentStage(projectId, toStageId) {
  const p = getProject(projectId);
  if (!p) return null;
  const valid = PATENT_STAGES.some((s) => s.id === toStageId);
  if (!valid) return p;
  const patent = { ...(p.creator?.patent || {}), stageId: toStageId, updatedAt: new Date().toISOString() };
  return persistProjectStep(projectId, { patent });
}
// Record real filing details (application number, jurisdiction, route, date).
export function recordPatentFiling(projectId, filing = {}) {
  const p = getProject(projectId);
  if (!p) return null;
  const cur = p.creator?.patent || {};
  const patent = {
    ...cur,
    filing: { ...(cur.filing || {}), ...filing },
    stageId: filing.applicationNumber ? 'filed' : (cur.stageId || 'provisional'),
    updatedAt: new Date().toISOString(),
  };
  return persistProjectStep(projectId, { patent });
}
// Persist the user's prior-art findings and re-score (novelty depends on these).
export function recordPriorArtFindings(projectId, findings = [], attest = {}) {
  const p = getProject(projectId);
  if (!p) return null;
  const report = assessPatentability(p, attest);
  const cur = p.creator?.patent || {};
  if (report.dossier && report.dossier.priorArt) report.dossier.priorArt.findings = findings;
  const patent = { ...cur, ...report, stageId: cur.stageId === 'assessed' || !cur.stageId ? 'priorart' : cur.stageId, updatedAt: new Date().toISOString() };
  return persistProjectStep(projectId, { patent, ipReadiness: report });
}
export function getPatentDossier(project = {}) { return project?.creator?.patent || null; }

/* ------------------------------------------------------------------ */
/* Part 9 — Collaboration post draft (maps to Partner board shape)     */
/* ------------------------------------------------------------------ */
export function buildCollabDraft(project = {}) {
  const c = project.creator || {};
  const skills = project.skillsCovered || [];
  const stage = roadmapProgress(project) >= 80 ? 'Near completion' : roadmapProgress(project) > 0 ? 'In progress' : 'Just starting';
  return {
    projectId: project.id,
    title: project.title,
    hook: `Building ${project.title} — looking for collaborators to ship it faster.`,
    problemStatement: c.summary || project.problemStatement || '',
    skillsInvolved: skills.slice(0, 6),
    skillsNeeded: (project.sourceMissingSkills || []).slice(0, 5),
    rolesNeeded: ['Frontend', 'Backend', 'Designer'].slice(0, project.type === 'Frontend' ? 1 : 3),
    projectStage: stage,
    estimatedDuration: project.duration || '2 weeks',
    weeklyTime: c.weeklyTime || '6–10 hrs',
    collaborationMode: 'Remote, async-friendly',
    collaboratorGain: 'Shared proof-of-work, GitHub contributions, a deployed product and interview-ready experience.',
  };
}
// Publish to the Project Partner board ONLY when the user approves.
export function publishCollabDraft(draft = {}) {
  return savePartnerRequest({
    id: uid('req'),
    title: draft.title,
    role: (draft.rolesNeeded || []).join(', '),
    skills: (draft.skillsNeeded || draft.skillsInvolved || []).join(', '),
    description: `${draft.hook}\n\n${draft.problemStatement}\n\nStage: ${draft.projectStage} · ${draft.estimatedDuration} · ${draft.weeklyTime}\nYou gain: ${draft.collaboratorGain}`,
    stage: draft.projectStage,
    source: 'project-creator',
  });
}

/* ------------------------------------------------------------------ */
/* Generic helpers                                                     */
/* ------------------------------------------------------------------ */
export function getCreatorProjects(allProjects = []) {
  return (allProjects || []).filter((p) => p?.creator?.createdVia === 'project-creator');
}
export function persistProjectStep(projectId, patch = {}) {
  const p = getProject(projectId);
  if (!p) return null;
  return saveProject({ ...p, creator: { ...(p.creator || {}), ...patch } });
}
