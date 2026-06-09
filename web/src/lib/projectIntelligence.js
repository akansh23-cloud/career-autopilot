// Project Intelligence (client) — Career-Gap Driven Project Engine.
//
// Assembles REAL signals already held in the app (profile, resume analysis,
// verified vs claimed skills, GitHub proof from analyzed repos, saved job,
// existing projects, innovation clusters) and calls the deterministic
// /api/project-intelligence/* endpoints. Every call degrades to a small
// deterministic client fallback so panels work even offline. No AI key is
// ever required; nothing here fabricates proof or marks unverified work as
// verified.

import { api } from './api.js';
import { getProfile } from './userProfile.js';
import { getStoredResume, getSelectedJob } from './resumeStore.js';
import { getProjects } from './projectStore.js';
import { deriveSkillXP } from './xp.js';

const asList = (v) => Array.isArray(v) ? v.filter(Boolean) : (typeof v === 'string' ? v.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean) : []);
const uniq = (a) => Array.from(new Set((a || []).filter(Boolean)));

/* ---- GitHub proof rolled up from the user's analyzed projects ---- */
function githubProofFromProjects(projects) {
  let repoCount = 0; let hasCI = false; let hasTests = false; let hasDeployment = false;
  const provenSkills = [];
  for (const p of projects) {
    if (p.githubUrl) repoCount += 1;
    const f = (p.github && p.github.success && p.github.files) || {};
    if (f.tests) hasTests = true;
    if (f.githubWorkflows) hasCI = true;
    if (f.Dockerfile || f.deployment || f['docker-compose.yml'] || p.liveVerification?.reachable) hasDeployment = true;
    if (p.github && p.github.success) provenSkills.push(...asList(p.skillsCovered));
  }
  return { repoCount, hasCI, hasTests, hasDeployment, provenSkills: uniq(provenSkills) };
}

/* ---- Verified skills = skills that reached completed/verified via real proof ---- */
function verifiedSkillsFromProjects(projects) {
  return deriveSkillXP(projects)
    .filter((s) => s.state === 'verified' || s.state === 'completed')
    .map((s) => s.skillName);
}

/* Build the full signal payload the engine reasons about. */
export function assembleSignals(overrides = {}) {
  const prof = getProfile();
  const resume = getStoredResume();
  const an = resume?.analysis || {};
  const projects = getProjects();
  const job = getSelectedJob();

  const claimedSkills = uniq(
    asList(prof.skills)
      .concat(asList(an.matchedSkills))
      .concat(asList(an.presentSkills))
      .concat(asList(an.currentSkills)),
  );
  return {
    targetRole: overrides.targetRole || prof.targetRole || prof.hiringRole || resume?.targetRole || 'Software Engineer',
    userProfile: { targetRole: prof.targetRole, skills: asList(prof.skills), yearSem: prof.yearSem, branch: prof.branch },
    resumeAnalysis: {
      missingSkills: asList(an.missingSkills || an.gaps || an.skillGaps || an.missing),
      matchedSkills: asList(an.matchedSkills || an.presentSkills),
    },
    verifiedSkills: verifiedSkillsFromProjects(projects),
    claimedSkills,
    githubProof: githubProofFromProjects(projects),
    savedJobs: job ? [{ title: job.title, company: job.company, description: job.description || job.snippet || '' }] : [],
    existingProjects: projects.map((p) => ({
      id: p.id, title: p.title, skillsCovered: asList(p.skillsCovered), techStack: asList(p.techStack),
      problemStatement: p.problemStatement || p.summary || '', innovationClusterId: p.innovationClusterId || '',
    })),
    patentInnovationClusters: overrides.patentInnovationClusters || [],
    goal: overrides.goal || prof.goal || '',
    ...overrides,
  };
}

/* ---- API calls (deterministic server) with light client fallback ---- */
export async function recommendProjects(overrides = {}) {
  const signals = assembleSignals(overrides);
  try {
    const r = await api.post('/api/project-intelligence/recommend', { ...signals, max: overrides.max || 6 });
    if (r && r.ok) return r;
  } catch { /* fall through */ }
  return { ok: false, mode: 'offline', recommendedProjects: [], gapSummary: { targetRole: signals.targetRole }, signalsUsed: {} };
}

function call(path, body, key, fallback) {
  return api.post(path, body).then((r) => (r && r.ok ? r : fallback)).catch(() => fallback);
}

export const whyBuild = (recommendation, gapSummary) =>
  call('/api/project-intelligence/why-build', { recommendation, gapSummary }, 'whyBuild',
    { ok: false, whyBuild: { targetRoleSupported: recommendation?.targetRole || '', whyThisProject: recommendation?.whyRecommended || '', skillGapsFixed: recommendation?.skillGapsFixed || [], proofGapsFixed: recommendation?.proofGapsFixed || [], recommendationConfidence: recommendation?.recommendationConfidence || 'Medium' } });

export const explain = (recommendation, project = {}) =>
  call('/api/project-intelligence/explain', { recommendation, project }, 'explanation',
    { ok: false, explanation: { oneLineSummary: recommendation?.title || project?.title || '', mvpModules: [], firstWeekTasks: [], skillsNeeded: recommendation?.skills || [], confidence: 'Low' } });

export const blueprint = (recommendation, explainer, project = {}) =>
  call('/api/project-intelligence/blueprint', { recommendation, explainer, project }, 'blueprint',
    { ok: false, blueprint: null });

export const diagrams = (recommendation, explainer, project = {}) =>
  call('/api/project-intelligence/diagrams', { recommendation, explainer, project }, 'diagrams',
    { ok: false, diagrams: [] });

export const feasibility = (recommendation, project = {}) =>
  call('/api/project-intelligence/feasibility', { recommendation, project }, 'feasibility',
    { ok: false, feasibility: null });

export const proofChecklist = (recommendation, proofBreakdown, project = {}) =>
  call('/api/project-intelligence/proof-checklist', { recommendation, proofBreakdown, project }, 'proofChecklist',
    { ok: false, proofChecklist: null });

export const taskBoard = (recommendation, explainer, project = {}) =>
  call('/api/project-intelligence/task-board', { recommendation, explainer, project }, 'taskBoard',
    { ok: false, taskBoard: null });

export const resumeOutput = (recommendation, project = {}, evidence = {}) =>
  call('/api/project-intelligence/resume-output', { recommendation, project, evidence }, 'resume',
    { ok: false, resume: { draftResumeBullets: [], verifiedResumeBullets: [], verificationRequired: [], unsupportedClaimsWarning: [] } });

export const findSimilar = (candidate, existingProjects) =>
  call('/api/project-intelligence/similar', { candidate, existingProjects }, 'similar',
    { ok: false, isDuplicate: false, matches: [], suggestion: '' });

export const importInnovation = (source, existingProjects) =>
  call('/api/project-intelligence/import-innovation-project', { source, existingProjects }, 'import',
    { ok: false, imported: false, payload: null, message: 'Import unavailable offline.' });
