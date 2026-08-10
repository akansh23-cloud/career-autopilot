/* ============================================================
   COLLEGE INTERVENTION ENGINE  (deterministic; pure functions)
   ------------------------------------------------------------
   Moves the college command center from DESCRIPTIVE ("42 students
   lack backend readiness") to PRESCRIPTIVE ("run a 14-day Backend
   Evidence Sprint for these 42 — here's why, here's the expected
   outcome, assign it").

   INVARIANTS (inherited from collegeObservability):
   - Pure + deterministic: rows in → recommendations out; `now` is
     injected; no I/O, no AI in any cohort membership decision.
   - Rows arrive ALREADY college-scoped (collegeStudentsDeep);
     this module never widens a cohort beyond the rows it is
     handed, so tenant isolation cannot be broken here.
   - Expected outcomes are labelled targets/forecasts. Measured
     outcomes come only from real before/after snapshots.
   ============================================================ */
import { engagementBucket } from './collegeObservability.js';

export const INTERVENTION_ENGINE_VERSION = 'intervention-v1';

const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const lc = (s) => String(s || '').toLowerCase();
const DAY = 24 * 60 * 60 * 1000;

const has = (skills, needle) => arr(skills).some((s) => lc(s).includes(needle));

/* ---------------- cohort rules ----------------
   Each rule returns { match, reason } for one student row. Rules read only
   verified/recorded signals. Membership thresholds mirror the observability
   engine so a coordinator sees consistent numbers across tabs. */
const RULES = [
  {
    id: 'backend_evidence_sprint',
    type: 'Project Sprint',
    title: 'Backend Evidence Sprint',
    gapLabel: 'REST/API + Docker verification gaps',
    durationDays: 14,
    describe: (n) => `${n} students target backend-family roles but hold no verified API or Docker evidence.`,
    expectedOutcomes: [
      'Complete a backend project milestone', 'Generate verified API evidence',
      'Generate Docker/deployment evidence', 'Improve resume evidence',
    ],
    match(r) {
      const roleIsBackend = /backend|full ?stack|software|devops/i.test(String(r.targetRole || ''));
      if (!roleIsBackend) return null;
      const verified = arr(r.verifiedSkills);
      const missingApi = !has(verified, 'api') && !has(verified, 'node') && !has(verified, 'express');
      const missingDocker = !has(verified, 'docker');
      if (!(missingApi || missingDocker)) return null;
      if (num(r.readinessScore) >= 65) return null;
      return { reason: [missingApi && 'no verified API evidence', missingDocker && 'no verified Docker evidence'].filter(Boolean).join(', ') };
    },
  },
  {
    id: 'verification_sprint',
    type: 'Verification Sprint',
    title: 'Pending Verification Sprint',
    gapLabel: 'Submitted work stuck before verification',
    durationDays: 7,
    describe: (n) => `${n} students have project submissions waiting on evidence or review — built work that earns nothing until verified.`,
    expectedOutcomes: ['Convert pending submissions to verified', 'Unlock verified skills + XP', 'Raise recruiter-ready count'],
    match(r) {
      const pending = num(r.projectsPending) + num(r.projectsNeedsReview);
      if (pending < 1) return null;
      return { reason: `${pending} submission(s) pending verification` };
    },
  },
  {
    id: 'resume_evidence_sprint',
    type: 'Resume Evidence Sprint',
    title: 'Resume Evidence Sprint',
    gapLabel: 'Verified skills missing from resumes',
    durationDays: 7,
    describe: (n) => `${n} students hold verified skills but score under 60 on their resume — proof exists, the document doesn't show it.`,
    expectedOutcomes: ['Add evidence-backed resume content', 'Raise average resume score', 'Improve ATS keyword coverage'],
    match(r) {
      if (arr(r.verifiedSkills).length < 2) return null;
      const rs = r.resumeScore;
      if (rs == null || num(rs) >= 60) return null;
      return { reason: `${arr(r.verifiedSkills).length} verified skills, resume score ${num(rs)}` };
    },
  },
  {
    id: 'inactive_recovery',
    type: 'Inactive Student Recovery',
    title: 'Inactive Student Recovery',
    gapLabel: 'No platform activity for 30+ days',
    durationDays: 7,
    describe: (n) => `${n} students have been inactive for 30+ days — evidence pipelines stall fastest here.`,
    expectedOutcomes: ['Re-engage dormant students', 'Restart stalled projects', 'Prevent placement-season scramble'],
    match(r, now) {
      const bucket = engagementBucket(r.lastActiveAt, now);
      if (bucket !== 'dormant' && bucket !== 'never') return null;
      return { reason: bucket === 'never' ? 'never active' : 'inactive 30+ days' };
    },
  },
  {
    id: 'application_readiness',
    type: 'Application Readiness',
    title: 'Application Readiness Push',
    gapLabel: 'Interview-ready students not yet recruiter-visible',
    durationDays: 7,
    describe: (n) => `${n} students are at readiness 65+ but have no recruiter-ready project — one proof step from discoverable.`,
    expectedOutcomes: ['Publish recruiter-ready proof', 'Increase recruiter-visible cohort'],
    match(r) {
      if (num(r.readinessScore) < 65) return null;
      if (num(r.recruiterReadyProjects) > 0) return null;
      return { reason: `readiness ${num(r.readinessScore)}, no recruiter-ready project` };
    },
  },
];

/* ---------------- recommendation builder ---------------- */
export function recommendInterventions({ rows = [], now = Date.now(), minCohort = 3, maxPerType = 60 } = {}) {
  const recommendations = [];
  for (const rule of RULES) {
    const members = [];
    for (const r of arr(rows)) {
      const m = rule.match(r, now);
      if (m) members.push({ id: r.id, name: r.name, email: r.email, branch: r.branch, batch: r.batch, readinessScore: num(r.readinessScore), reason: m.reason });
    }
    if (members.length < minCohort) continue;
    members.sort((a, b) => a.readinessScore - b.readinessScore);
    const cohort = members.slice(0, maxPerType);
    const avgReadiness = Math.round(cohort.reduce((s, m) => s + m.readinessScore, 0) / cohort.length);
    recommendations.push({
      id: rule.id,
      type: rule.type,
      title: rule.title,
      gapLabel: rule.gapLabel,
      description: rule.describe(cohort.length),
      cohortSize: cohort.length,
      cohort,
      avgReadinessBefore: avgReadiness,
      suggestedDurationDays: rule.durationDays,
      expectedOutcomes: rule.expectedOutcomes,
      outcomesNote: 'Expected outcomes are targets, not measurements. Measured impact appears only after real before/after data exists.',
      engineVersion: INTERVENTION_ENGINE_VERSION,
    });
  }
  recommendations.sort((a, b) => b.cohortSize - a.cohortSize);
  return { generatedAt: new Date(now).toISOString(), recommendations, version: INTERVENTION_ENGINE_VERSION };
}

/* ---------------- outcome measurement ----------------
   before: snapshot stored at assignment time
   afterRows: current scoped rows for the SAME student ids
   Only students present in both sets are measured — nobody is
   fabricated in or silently dropped without being counted. */
export function measureInterventionOutcome({ before = null, afterRows = [], taskStats = null } = {}) {
  if (!before || !arr(before.students).length) return { measured: false, reason: 'no_baseline' };
  const afterById = new Map(arr(afterRows).map((r) => [String(r.id), r]));
  const pairs = arr(before.students)
    .map((b) => ({ before: b, after: afterById.get(String(b.id)) }))
    .filter((p) => p.after);
  if (!pairs.length) return { measured: false, reason: 'no_matched_students' };

  const avg = (xs) => Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10;
  const readinessBefore = avg(pairs.map((p) => num(p.before.readinessScore)));
  const readinessAfter = avg(pairs.map((p) => num(p.after.readinessScore)));
  const verifiedSkillsBefore = pairs.reduce((s, p) => s + num(p.before.verifiedSkillCount), 0);
  const verifiedSkillsAfter = pairs.reduce((s, p) => s + arr(p.after.verifiedSkills).length, 0);
  const resumePairs = pairs.filter((p) => p.before.resumeScore != null && p.after.resumeScore != null);
  const verifiedProjectsBefore = pairs.reduce((s, p) => s + num(p.before.projectsVerified), 0);
  const verifiedProjectsAfter = pairs.reduce((s, p) => s + num(p.after.projectsVerified), 0);

  return {
    measured: true,
    students: { baseline: arr(before.students).length, matched: pairs.length },
    assignment: taskStats ? { assigned: num(taskStats.assigned), done: num(taskStats.done), completionRate: num(taskStats.completionRate) } : null,
    readiness: { before: readinessBefore, after: readinessAfter, delta: Math.round((readinessAfter - readinessBefore) * 10) / 10 },
    verifiedSkills: { before: verifiedSkillsBefore, after: verifiedSkillsAfter, gained: Math.max(0, verifiedSkillsAfter - verifiedSkillsBefore) },
    verifiedProjects: { before: verifiedProjectsBefore, after: verifiedProjectsAfter, gained: Math.max(0, verifiedProjectsAfter - verifiedProjectsBefore) },
    resumeScore: resumePairs.length ? {
      before: avg(resumePairs.map((p) => num(p.before.resumeScore))),
      after: avg(resumePairs.map((p) => num(p.after.resumeScore))),
      sampled: resumePairs.length,
    } : null,
    note: 'Measured from real student state at assignment vs now — never forecast.',
  };
}

/* Snapshot a cohort at assignment time (small, id-keyed). */
export function snapshotCohort(rows = [], studentIds = []) {
  const ids = new Set(arr(studentIds).map(String));
  return {
    at: new Date().toISOString(),
    students: arr(rows).filter((r) => ids.has(String(r.id))).map((r) => ({
      id: r.id,
      readinessScore: num(r.readinessScore),
      verifiedSkillCount: arr(r.verifiedSkills).length,
      projectsVerified: num(r.projectsVerified),
      resumeScore: r.resumeScore == null ? null : num(r.resumeScore),
    })),
  };
}

export default { recommendInterventions, measureInterventionOutcome, snapshotCohort, INTERVENTION_ENGINE_VERSION };
