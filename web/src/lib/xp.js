// Skill XP profile (Part 3).
// XP is DERIVED from proof-based evidence on projects — never manually edited.
// We compute each project's earned XP from the evidence actually present, then
// attribute it to the skills that project proves. Recruiter engagement adds
// career-level XP. Because it reads from persisted projects + engagement, the
// profile is always consistent and survives refreshes with zero extra storage.

import { proofScore } from './proofScore.js';
import { engagementSignals } from './engagement.js';

export const XP_ACTIONS = {
  taskComplete: 5,
  milestoneComplete: 20,
  githubRepo: 30,
  liveDemo: 40,
  readme: 20,
  testProof: 30,
  architectureProof: 25,
  fullChecklist: 50,
  publish: 50,
  highProofScore: 100, // proof score > 80
  interviewExplanation: 25,
  recruiterInterest: 100, // per shortlist / contact-interest
};

export const LEVELS = [
  { name: 'Beginner', min: 0, max: 199 },
  { name: 'Builder', min: 200, max: 499 },
  { name: 'Job Ready', min: 500, max: 999 },
  { name: 'Advanced', min: 1000, max: 1999 },
  { name: 'Expert Proof', min: 2000, max: Infinity },
];

export function levelFor(xp = 0) {
  const lv = LEVELS.find((l) => xp >= l.min && xp <= l.max) || LEVELS[0];
  const next = LEVELS[LEVELS.indexOf(lv) + 1] || null;
  const toNext = next ? Math.max(0, next.min - xp) : 0;
  const span = next ? next.min - lv.min : 1;
  const pct = next ? Math.min(100, Math.round(((xp - lv.min) / span) * 100)) : 100;
  return { level: lv.name, next: next ? next.name : null, toNext, pct };
}

const len = (a) => (Array.isArray(a) ? a.length : 0);
const has = (s) => typeof s === 'string' && s.trim().length > 0;

/* XP a single project has earned from the evidence present on it */
export function projectXP(p = {}) {
  let xp = 0;
  const events = [];
  const add = (key, n, label) => { xp += n; events.push({ key, xp: n, label }); };

  const tasksDone = (p.tasks || []).filter((t) => t.status === 'done').length;
  if (tasksDone) add('taskComplete', tasksDone * XP_ACTIONS.taskComplete, `${tasksDone} task(s) completed`);

  const checklist = p.checklist || [];
  const milestonesDone = checklist.filter((c) => c.done).length;
  if (milestonesDone) add('milestoneComplete', milestonesDone * XP_ACTIONS.milestoneComplete, `${milestonesDone} milestone(s)`);
  if (checklist.length && milestonesDone === checklist.length) add('fullChecklist', XP_ACTIONS.fullChecklist, 'Full checklist complete');

  if (has(p.githubUrl)) add('githubRepo', XP_ACTIONS.githubRepo, 'GitHub repo added');
  if (has(p.liveDemoUrl)) add('liveDemo', XP_ACTIONS.liveDemo, 'Live demo added');
  if (has(p.readme) && p.readme.trim().length > 40) add('readme', XP_ACTIONS.readme, 'README written');
  if (len(p.screenshots) || has(p.architecture)) add('architectureProof', XP_ACTIONS.architectureProof, 'Architecture / screenshot proof');
  if (milestonesDone >= Math.ceil(checklist.length * 0.6) && checklist.length) add('testProof', XP_ACTIONS.testProof, 'Testing / checklist proof');
  if (len(p.interviewQuestions)) add('interviewExplanation', XP_ACTIONS.interviewExplanation, 'Interview explanation');
  if (p.published) add('publish', XP_ACTIONS.publish, 'Published to sandbox');
  if (proofScore(p) > 80) add('highProofScore', XP_ACTIONS.highProofScore, 'Proof score above 80');

  return { xp, events };
}

/* Build the per-skill XP profile from all projects + recruiter engagement */
export function deriveSkillXP(projects = []) {
  const skills = {};
  for (const p of projects) {
    const { xp } = projectXP(p);
    if (xp <= 0) continue;
    const cov = p.skillsCovered && p.skillsCovered.length ? p.skillsCovered : [p.type].filter(Boolean);
    for (const raw of cov) {
      const name = String(raw).trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!skills[key]) skills[key] = { skillName: name, xp: 0, evidenceCount: 0, projects: [], lastUpdated: null };
      // each proving project contributes its earned XP to the skill it proves
      skills[key].xp += xp;
      skills[key].evidenceCount += 1;
      skills[key].projects.push({ id: p.id, title: p.title, proofScore: proofScore(p) });
      const t = p.updatedAt || p.createdAt || null;
      if (t && (!skills[key].lastUpdated || t > skills[key].lastUpdated)) skills[key].lastUpdated = t;
    }
  }
  return Object.values(skills)
    .map((s) => ({ ...s, ...levelFor(s.xp) }))
    .sort((a, b) => b.xp - a.xp);
}

/* Career-level XP = sum of project XP + recruiter engagement XP */
export function careerXP(projects = []) {
  const base = projects.reduce((s, p) => s + projectXP(p).xp, 0);
  const eng = engagementSignals() * XP_ACTIONS.recruiterInterest;
  const total = base + eng;
  return { total, ...levelFor(total), engagementXP: eng };
}

export function topSkills(projects = [], n = 6) {
  return deriveSkillXP(projects).slice(0, n);
}

/* a friendly "next step to level up" string for a skill */
export function nextStepFor(skill) {
  if (!skill) return '';
  if (skill.toNext === 0) return 'Max level reached — keep adding proof to stay sharp.';
  return `Earn ${skill.toNext} more XP to reach ${skill.next} (add a deploy, tests or a recruiter-ready project).`;
}
