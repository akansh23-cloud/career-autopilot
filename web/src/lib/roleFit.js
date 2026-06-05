// Role Fit Score + candidate aggregation (Part 7) and role consistency
// guardrails for student roadmaps (Part 8).

import { proofScore } from './proofScore.js';
import { deriveSkillXP, careerXP } from './xp.js';
import { deriveBadges } from './badges.js';
import { engagementFor } from './engagement.js';
import { calculateProjectStatus, STATUS_RANK } from './projectStatus.js';

const norm = (s) => String(s || '').trim().toLowerCase();
const has = (s) => typeof s === 'string' && s.trim().length > 0;
const daysSince = (iso) => { if (!iso) return 999; const d = (Date.now() - new Date(iso).getTime()) / 86400000; return Number.isFinite(d) ? d : 999; };

/* Group published projects into candidates. Each distinct author becomes one
   candidate. With local-only data this is the signed-in user. NO dummy data:
   an empty project list yields an empty candidate list. */
export function buildCandidates(publishedProjects = [], access = null) {
  const groups = {};
  for (const p of publishedProjects) {
    const name = p.candidateName || p.authorName || access?.candidateName || 'You';
    const key = norm(name);
    if (!groups[key]) groups[key] = { name, projects: [] };
    groups[key].projects.push(p);
  }
  return Object.values(groups).map((g) => {
    const skillXP = deriveSkillXP(g.projects);
    const badges = deriveBadges(g.projects, access);
    const proof = g.projects.map(proofScore);
    const avgProof = proof.length ? Math.round(proof.reduce((a, b) => a + b, 0) / proof.length) : 0;
    const career = careerXP(g.projects);
    const recent = Math.min(...g.projects.map((p) => daysSince(p.updatedAt || p.createdAt)));
    const engaged = g.projects.reduce((n, p) => { const e = engagementFor(p.id); return n + (e.shortlisted ? 1 : 0) + (e.contacted ? 1 : 0); }, 0);
    const hasGithub = g.projects.some((p) => has(p.githubUrl));
    const hasDemo = g.projects.some((p) => has(p.liveDemoUrl));
    const hasInterview = g.projects.some((p) => (p.interviewQuestions || []).length);
    const targetRole = g.projects[0]?.targetRole || '';
    const ranked = rankProjects(g.projects);
    const bestStatus = ranked.length ? calculateProjectStatus(ranked[0]).status : 'Draft';
    return {
      id: norm(g.name),
      name: g.name,
      targetRole,
      projects: ranked,
      bestStatus,
      skillXP, badges, avgProof, career,
      recentDays: recent, engaged, hasGithub, hasDemo, hasInterview,
      topSkillNames: skillXP.slice(0, 6).map((s) => s.skillName),
    };
  });
}

/* Role Fit Score out of 100 for one candidate against a recruiter query.
   query: { role, skills: [..], minScore, badgeLevel } */
export function roleFitScore(candidate, query = {}) {
  const wanted = (query.skills || []).map(norm).filter(Boolean);

  // Skill XP match (30) — fraction of required skills proven, weighted by XP depth
  let skillPart = 30;
  if (wanted.length) {
    const owned = new Map(candidate.skillXP.map((s) => [norm(s.skillName), s.xp]));
    let matched = 0, depth = 0;
    for (const w of wanted) {
      const xp = [...owned.entries()].find(([k]) => k.includes(w) || w.includes(k));
      if (xp) { matched += 1; depth += Math.min(1, xp[1] / 500); }
    }
    skillPart = 30 * (0.6 * (matched / wanted.length) + 0.4 * (depth / wanted.length));
  } else {
    skillPart = 30 * Math.min(1, candidate.career.total / 1500);
  }

  const proofPart = 25 * (candidate.avgProof / 100);
  const proofLinks = 15 * ((candidate.hasGithub ? 0.6 : 0) + (candidate.hasDemo ? 0.4 : 0));
  // Resume match (10) — role alignment as a light proxy
  const roleMatch = query.role && candidate.targetRole ? (norm(candidate.targetRole).includes(norm(query.role)) || norm(query.role).includes(norm(candidate.targetRole)) ? 1 : 0.4) : 0.6;
  const resumePart = 10 * roleMatch;
  const interviewPart = 10 * (candidate.hasInterview ? 1 : 0);
  const recentPart = 5 * (candidate.recentDays <= 14 ? 1 : candidate.recentDays <= 45 ? 0.5 : 0.1);
  const engagePart = 5 * Math.min(1, candidate.engaged / 2);

  const total = skillPart + proofPart + proofLinks + resumePart + interviewPart + recentPart + engagePart;
  return {
    score: Math.round(Math.max(0, Math.min(100, total))),
    parts: {
      'Skill XP match': Math.round(skillPart),
      'Project proof': Math.round(proofPart),
      'GitHub / demo': Math.round(proofLinks),
      'Resume match': Math.round(resumePart),
      'Interview prep': Math.round(interviewPart),
      'Recent activity': Math.round(recentPart),
      'Recruiter signal': Math.round(engagePart),
    },
  };
}

export function rankCandidates(candidates = [], query = {}) {
  return candidates
    .map((c) => ({ candidate: c, fit: roleFitScore(c, query) }))
    .filter(({ candidate, fit }) => {
      if (query.minScore && fit.score < query.minScore) return false;
      if (query.minProof && candidate.avgProof < query.minProof) return false;
      return true;
    })
    .sort((a, b) => b.fit.score - a.fit.score);
}

/* ---------------- Sandbox ranking (Part 6/7) ----------------
   Priority: 1) status (Recruiter Ready > Verified > ...), 2) proof score,
   3) GitHub/live verified evidence, 4) skill badges, 5) recruiter signal,
   6) recent activity. */
export function rankProjects(projects = []) {
  const badgeCount = (p) => deriveBadges([p]).filter((b) => b.rawLevel && b.rawLevel !== 'Practiced').length;
  return projects.slice().sort((a, b) => {
    const ra = STATUS_RANK[calculateProjectStatus(a).status] || 0;
    const rb = STATUS_RANK[calculateProjectStatus(b).status] || 0;
    if (rb !== ra) return rb - ra;
    const sa = proofScore(a), sb = proofScore(b);
    if (sb !== sa) return sb - sa;
    const la = (a.github?.success ? 2 : a.githubUrl ? 1 : 0) + (a.liveVerification?.reachable ? 2 : a.liveDemoUrl ? 1 : 0);
    const lb = (b.github?.success ? 2 : b.githubUrl ? 1 : 0) + (b.liveVerification?.reachable ? 2 : b.liveDemoUrl ? 1 : 0);
    if (lb !== la) return lb - la;
    const ba = badgeCount(a), bb = badgeCount(b);
    if (bb !== ba) return bb - ba;
    const ea = engagementFor(a.id), eb = engagementFor(b.id);
    const ena = (ea.shortlisted ? 1 : 0) + (ea.contacted ? 1 : 0);
    const enb = (eb.shortlisted ? 1 : 0) + (eb.contacted ? 1 : 0);
    if (enb !== ena) return enb - ena;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
}

/* ---------------- Role consistency guardrails (Part 8) ---------------- */
const ROLE_REQUIREMENTS = {
  DevOps: { needs: ['docker', 'ci/cd', 'cicd', 'kubernetes', 'k8s', 'deploy', 'jenkins', 'terraform'], label: 'DevOps', why: 'it lacks CI/CD and deployment proof' },
  Backend: { needs: ['api', 'database', 'db', 'auth', 'test', 'postgres', 'mongodb', 'express', 'spring'], label: 'Backend', why: 'it lacks APIs, a database, auth or tests' },
  Frontend: { needs: ['responsive', 'ui', 'state', 'react', 'api', 'deploy'], label: 'Frontend', why: 'it lacks responsive UI, state management, API integration or deployment' },
  'AI/ML': { needs: ['dataset', 'model', 'evaluation', 'notebook', 'api', 'deploy', 'pytorch', 'tensorflow'], label: 'AI/ML', why: 'it lacks a dataset, model, evaluation, or deployment' },
};

export function roleConsistency(project = {}) {
  const role = norm(project.targetRole) + ' ' + norm(project.type);
  let req = null;
  if (role.includes('devops')) req = ROLE_REQUIREMENTS.DevOps;
  else if (role.includes('backend')) req = ROLE_REQUIREMENTS.Backend;
  else if (role.includes('frontend')) req = ROLE_REQUIREMENTS.Frontend;
  else if (role.includes('ai') || role.includes('ml') || role.includes('machine learning') || role.includes('data scien')) req = ROLE_REQUIREMENTS['AI/ML'];
  if (!req) return { ok: true, warning: '' };

  const hay = [
    (project.skillsCovered || []).join(' '),
    (project.techStack || []).join(' '),
    project.architecture || '', project.useCase || '',
    project.githubUrl ? 'github' : '', project.liveDemoUrl ? 'deploy' : '',
  ].join(' ').toLowerCase();

  const hits = req.needs.filter((k) => hay.includes(k)).length;
  if (hits >= 2) return { ok: true, warning: '' };
  return { ok: false, warning: `This project is weak for ${req.label} roles because ${req.why}.` };
}
