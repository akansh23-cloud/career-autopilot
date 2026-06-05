// Verified skill badges (Part 4).
// Badges are awarded ONLY from project evidence — never from a manually
// selected skill. Each badge records its level, a confidence score, the
// concrete evidence behind it, and the project that earned it. Plan tier caps
// the maximum badge level a user can display.

import { proofScore } from './proofScore.js';
import { engagementFor } from './engagement.js';

export const BADGE_LEVELS = [
  'Practiced',
  'Project Verified',
  'GitHub Verified',
  'Deployment Verified',
  'Interview Ready',
  'Recruiter Ready',
];
const RANK = Object.fromEntries(BADGE_LEVELS.map((l, i) => [l, i]));

// Highest badge level each plan may display.
export const PLAN_BADGE_CAP = {
  free: 'Practiced',
  pro: 'Project Verified',
  premium: 'Recruiter Ready',
  admin: 'Recruiter Ready',
};

const has = (s) => typeof s === 'string' && s.trim().length > 0;
const len = (a) => (Array.isArray(a) ? a.length : 0);

function checklistPct(p = {}) {
  const c = p.checklist || [];
  return c.length ? c.filter((x) => x.done).length / c.length : 0;
}

/* Determine the highest evidence-backed level for a project + the evidence list */
function evaluateProject(p = {}) {
  const evidence = [];
  let level = null;

  const pct = checklistPct(p);
  const score = proofScore(p);
  const eng = engagementFor(p.id);

  // Practiced: the project exists and has some real progress
  if (pct > 0 || len(p.tasks)) { level = 'Practiced'; evidence.push('Project work started'); }
  // Project Verified: meaningful checklist completion
  if (pct >= 0.6) { level = 'Project Verified'; evidence.push(`Checklist ${Math.round(pct * 100)}% complete`); }
  // GitHub Verified
  if (has(p.githubUrl)) { level = 'GitHub Verified'; evidence.push('Public GitHub repo'); }
  // Deployment Verified
  if (has(p.liveDemoUrl)) { level = 'Deployment Verified'; evidence.push('Live deployment'); }
  // Interview Ready
  if (len(p.interviewQuestions)) { level = 'Interview Ready'; evidence.push('Interview explanation prepared'); }
  // Recruiter Ready: strong proof + a recruiter signal OR an excellent fully-proven project
  const stronglyProven = score >= 80 && has(p.githubUrl) && has(p.liveDemoUrl);
  if (stronglyProven && (eng.shortlisted || eng.contacted || score >= 90)) {
    level = 'Recruiter Ready';
    evidence.push(eng.shortlisted || eng.contacted ? 'Recruiter interest recorded' : `Proof score ${score}/100`);
  }

  if (has(p.readme) && p.readme.trim().length > 40) evidence.push('README documented');
  if (len(p.screenshots)) evidence.push('Screenshots / demo proof');
  if (has(p.architecture)) evidence.push('Architecture documented');

  return { level, evidence, score, pct };
}

// Confidence (0–100) scales with how much evidence backs the level.
function confidenceFor(level, evidence, score) {
  const base = { Practiced: 35, 'Project Verified': 55, 'GitHub Verified': 70, 'Deployment Verified': 80, 'Interview Ready': 85, 'Recruiter Ready': 92 }[level] || 30;
  const bonus = Math.min(15, evidence.length * 2) + Math.round(score * 0.05);
  return Math.max(20, Math.min(99, base + bonus - 5));
}

/* Build every badge a candidate has earned across their projects.
   access: result of getAccessForUser (used for the plan cap). */
export function deriveBadges(projects = [], access = null) {
  const capLevel = (access && PLAN_BADGE_CAP[access.effectivePlan]) || 'Project Verified';
  const cap = RANK[capLevel];

  // best badge per skill
  const bySkill = {};
  for (const p of projects) {
    const ev = evaluateProject(p);
    if (!ev.level) continue;
    const displayRank = Math.min(RANK[ev.level], cap);
    const displayLevel = BADGE_LEVELS[displayRank];
    const skills = p.skillsCovered && p.skillsCovered.length ? p.skillsCovered : [p.type].filter(Boolean);

    for (const raw of skills) {
      const skillName = String(raw).trim();
      if (!skillName) continue;
      const key = skillName.toLowerCase();
      const confidence = confidenceFor(displayLevel, ev.evidence, ev.score);
      const candidate = {
        badgeName: `${skillName} — ${displayLevel}`,
        skillName,
        level: displayLevel,
        rawLevel: ev.level,
        confidence,
        evidence: ev.evidence,
        projectId: p.id,
        projectTitle: p.title,
        githubUrl: p.githubUrl || '',
        liveDemoUrl: p.liveDemoUrl || '',
        checklist: p.checklist || [],
        awardedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
        gated: RANK[ev.level] > cap,
      };
      const prev = bySkill[key];
      if (!prev || RANK[candidate.level] > RANK[prev.level] || (RANK[candidate.level] === RANK[prev.level] && candidate.confidence > prev.confidence)) {
        bySkill[key] = candidate;
      }
    }
  }
  return Object.values(bySkill).sort((a, b) => RANK[b.level] - RANK[a.level] || b.confidence - a.confidence);
}

export function badgeTone(level) {
  return {
    'Practiced': 'default',
    'Project Verified': 'cyan',
    'GitHub Verified': 'violet',
    'Deployment Verified': 'violet',
    'Interview Ready': 'mint',
    'Recruiter Ready': 'amber',
  }[level] || 'default';
}
