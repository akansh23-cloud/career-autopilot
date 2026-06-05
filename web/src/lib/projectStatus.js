// Part 3 — project completion & verification rules.
// A project is NEVER "completed" because a checkbox is ticked. Status is derived
// from real evidence. calculateProjectStatus(project) returns the level plus the
// concrete reasons it has not yet reached the next one.

import { proofScore } from './proofScore.js';

const has = (s) => typeof s === 'string' && s.trim().length > 0;
const len = (a) => (Array.isArray(a) ? a.length : 0);

export const STATUS_ORDER = ['Draft', 'In Progress', 'Completed', 'Verified', 'Recruiter Ready'];
export const STATUS_RANK = Object.fromEntries(STATUS_ORDER.map((s, i) => [s, i]));

export function checklistPct(p = {}) {
  const c = p.checklist || [];
  return c.length ? Math.round((c.filter((x) => x.done).length / c.length) * 100) : 0;
}
export function taskPct(p = {}) {
  const t = p.tasks || [];
  return t.length ? Math.round((t.filter((x) => x.status === 'done').length / t.length) * 100) : 0;
}

/* evidence helpers shared with proofScore/badges */
export function githubAnalysisOk(p = {}) { return !!(p.github && p.github.success); }
export function githubScoreOf(p = {}) { return githubAnalysisOk(p) ? Number(p.github.githubScore || 0) : 0; }
export function liveVerified(p = {}) { return !!(p.liveVerification && p.liveVerification.reachable); }
export function readmeOk(p = {}) {
  if (githubAnalysisOk(p) && p.github.readme && p.github.readme.exists) return true;
  return has(p.readme) && p.readme.trim().length > 120;
}
export function hasManualProof(p = {}) { return len(p.screenshots) > 0; }
export function hasArchitecture(p = {}) { return has(p.architectureDiagram) || has(p.architecture); }
export function hasDemoProof(p = {}) { return liveVerified(p) || hasManualProof(p) || hasArchitecture(p); }
export function recruiterSummaryOk(p = {}) { return has(p.recruiterSummary); }
export function interviewOk(p = {}) { return len(p.interviewQuestions) > 0; }
export function resumeBulletsOk(p = {}) { return len(p.resumeBullets) > 0; }

export function calculateProjectStatus(p = {}) {
  const reasons = [];
  const cl = checklistPct(p);
  const score = proofScore(p);
  const ghAdded = has(p.githubUrl);
  const ghOk = githubAnalysisOk(p);
  const ghScore = githubScoreOf(p);

  // ---- Completed gate ----
  const completedReqs = [];
  if (cl < 80) completedReqs.push('complete at least 80% of the checklist');
  if (!ghAdded && !hasManualProof(p)) completedReqs.push('add a GitHub repo (or manual proof)');
  if (ghAdded && !ghOk && !hasManualProof(p)) completedReqs.push('run a successful GitHub analysis (or add manual proof)');
  if (!readmeOk(p)) completedReqs.push('add/generate a README');
  if (!hasDemoProof(p)) completedReqs.push('add a verified live demo, screenshots, or an architecture diagram');
  const isCompleted = completedReqs.length === 0;

  // ---- Verified gate ----
  const verifiedReqs = [];
  if (ghOk && ghScore < 60) verifiedReqs.push('reach a GitHub score of 60+');
  if (!ghOk) verifiedReqs.push('run a successful GitHub analysis');
  if (score < 70) verifiedReqs.push(`raise the proof score to 70+ (now ${score})`);
  const isVerified = isCompleted && verifiedReqs.length === 0;

  // ---- Recruiter Ready gate ----
  const rrReqs = [];
  if (score < 85) rrReqs.push(`raise the proof score to 85+ (now ${score})`);
  if (!(liveVerified(p) || hasManualProof(p))) rrReqs.push('verify a live demo or add strong screenshots');
  if (!resumeBulletsOk(p)) rrReqs.push('generate resume bullets');
  if (!interviewOk(p)) rrReqs.push('generate an interview explanation');
  if (!recruiterSummaryOk(p)) rrReqs.push('generate a recruiter summary');
  const isRecruiterReady = isVerified && rrReqs.length === 0;

  // ---- In Progress vs Draft ----
  const started = cl > 0 || taskPct(p) > 0 || ghAdded || has(p.liveDemoUrl);

  let status = 'Draft';
  if (isRecruiterReady) status = 'Recruiter Ready';
  else if (isVerified) status = 'Verified';
  else if (isCompleted) status = 'Completed';
  else if (started) status = 'In Progress';

  // next-step reasons toward the next level
  let next = null;
  if (status === 'Draft' || status === 'In Progress') { next = 'Completed'; reasons.push(...completedReqs); }
  else if (status === 'Completed') { next = 'Verified'; reasons.push(...verifiedReqs); }
  else if (status === 'Verified') { next = 'Recruiter Ready'; reasons.push(...rrReqs); }

  return { status, rank: STATUS_RANK[status], next, reasons, proofScore: score, githubScore: ghScore, checklistPct: cl };
}

export function statusTone(status) {
  return {
    'Draft': 'default',
    'In Progress': 'cyan',
    'Completed': 'violet',
    'Verified': 'mint',
    'Recruiter Ready': 'amber',
  }[status] || 'default';
}

/* one-line "why not verified" sentence for cards */
export function whyNotVerified(p = {}) {
  const s = calculateProjectStatus(p);
  if (s.status === 'Recruiter Ready') return 'Recruiter Ready — fully proven.';
  if (!s.reasons.length) return `On track to ${s.next || 'next level'}.`;
  return `To reach ${s.next}: ${s.reasons.slice(0, 3).join('; ')}.`;
}
