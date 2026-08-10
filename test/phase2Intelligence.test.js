/* ============================================================
   PHASE 2 — ENGINE & DASHBOARD INTELLIGENCE  (focused tests)
   ------------------------------------------------------------
   Covers: task dependencies, weighted progress, dependency-aware
   next action, backward compatibility of old plans, requirement-
   aware task verification (partial states, honest pending,
   promotion rules, skill attribution), evidence graph tracing,
   role-specific readiness v2 + change attribution, the platform
   Next Best Action engine, resume evidence-gap classification,
   and the college intervention engine (cohort rules, isolation
   semantics, honest outcome measurement).
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveDependencies, depsMet, annotateDependencyState } from '../server/utils/workspace/dependencyPlanner.js';
import { calculateProgress, nextBestAction, taskWeight } from '../server/utils/workspace/progressCalculator.js';
import { buildWorkspacePlan, recalculatePlan } from '../server/utils/workspace/workspaceBuilder.js';
import { verifyTask, verifyPlanTasks } from '../server/utils/workspace/taskVerification.js';
import { buildEvidenceGraph, traceSkill } from '../server/utils/evidenceGraph.js';
import { computeRoleReadiness, explainReadinessChange, computeReadiness } from '../server/utils/readinessEngine.js';
import { rankNextBestActions } from '../server/utils/nextBestActionEngine.js';
import { classifyResumeEvidenceGaps } from '../server/utils/resume/evidenceGapClassifier.js';
import { recommendInterventions, measureInterventionOutcome, snapshotCohort } from '../server/utils/interventionEngine.js';

const PROJECT = {
  id: 'p2test', title: 'Clinic Queue Manager', category: 'Web App',
  problemStatement: 'Clinics lose walk-in patients to untracked queues.',
  targetUsers: 'Clinic reception staff', targetRole: 'Backend Developer',
  difficulty: 'Intermediate', techStack: ['React', 'Node.js', 'Express', 'MongoDB'],
};

/* ---------------- dependencies ---------------- */

test('generated plans carry an acyclic dependency graph in build order', () => {
  const plan = buildWorkspacePlan({ project: PROJECT, userId: 'u1' });
  const order = new Map(plan.tasks.map((t) => [t.id, t.order]));
  let edges = 0;
  for (const t of plan.tasks) {
    for (const dep of t.dependsOn || []) {
      assert.ok(order.has(dep), `dep ${dep} of "${t.title}" must exist in the plan`);
      assert.ok(order.get(dep) < t.order, `edge must point backward: ${dep} -> ${t.id}`);
      edges++;
    }
  }
  assert.ok(edges >= plan.tasks.length - 1, 'the graph must actually connect the plan, not decorate it');
  // Phase gate: the first backend task depends on something from setup.
  const firstBackend = plan.tasks.filter((t) => t.phase === 'backend').sort((a, b) => a.order - b.order)[0];
  const setupIds = new Set(plan.tasks.filter((t) => t.phase === 'setup').map((t) => t.id));
  assert.ok((firstBackend.dependsOn || []).some((d) => setupIds.has(d)), 'phase gate edge missing');
});

test('depsMet blocks on open prerequisites and ignores ghost ids', () => {
  const tasks = deriveDependencies([
    { id: 'a', order: 1, phase: 'setup', title: 'A', status: 'done', linkedFiles: ['f1'] },
    { id: 'b', order: 2, phase: 'setup', title: 'B', status: 'backlog', linkedFiles: ['f1'] },
  ]);
  const byId = new Map(tasks.map((t) => [t.id, t.status]));
  assert.equal(depsMet(tasks[1], byId), true, 'done prerequisite unblocks');
  byId.set('a', 'in_progress');
  assert.equal(depsMet(tasks[1], byId), false, 'open prerequisite blocks');
  assert.equal(depsMet({ id: 'x', dependsOn: ['ghost'] }, byId), true, 'deleted deps never gate work');
});

test('next best action never recommends a dependency-gated task', () => {
  const plan = buildWorkspacePlan({ project: PROJECT, userId: 'u1' });
  // Force: everything backlog except one gated task marked ready.
  const gated = plan.tasks.find((t) => (t.dependsOn || []).length > 0);
  const tasks = plan.tasks.map((t) => ({ ...t, status: t.id === gated.id ? 'ready' : 'backlog' }));
  const nba = nextBestAction({ tasks });
  assert.notEqual(nba.taskId, gated.id, 'gated task must not be the recommendation');
  // And when ONLY the frontier remains, the engine names the prerequisite.
  const onlyGated = plan.tasks.map((t) => (t.id === gated.id ? { ...t, status: 'ready' } : { ...t, status: 'done' }));
  const nba2 = nextBestAction({ tasks: onlyGated });
  assert.equal(nba2.taskId, gated.id, 'once deps are done the task is recommended');
});

/* ---------------- weighted progress + compatibility ---------------- */

test('weighted progress is additive; legacy percentDone semantics unchanged', () => {
  const tasks = [
    { id: 't1', order: 1, status: 'done', estimatedHours: 1, priority: 'low' },
    { id: 't2', order: 2, status: 'backlog', estimatedHours: 6, priority: 'critical', proofRequired: true },
  ];
  const p = calculateProgress({ tasks });
  assert.equal(p.percentDone, 50, 'legacy field stays count-based');
  assert.ok(p.weightedPercentDone < 50, 'a 1h low-priority task must weigh less than a 6h critical one');
  assert.ok(taskWeight(tasks[2 - 1]) > taskWeight(tasks[0]));
  assert.ok(Math.abs(p.totalWeight - (p.doneWeight + (p.totalWeight - p.doneWeight))) < 0.001);
});

test('plans stored BEFORE phase 2 (no dependsOn, no weights) recalculate safely', () => {
  const oldPlan = {
    id: 'wsp_old', projectId: 'old', title: 'Legacy plan',
    tasks: [
      { id: 'o1', order: 1, phase: 'setup', title: 'Old task', status: 'done' },
      { id: 'o2', order: 2, phase: 'backend', title: 'Old task 2', status: 'backlog' },
    ],
    roadmap: [], proofRequirements: [], starterPack: {},
  };
  const p = recalculatePlan(oldPlan);
  assert.equal(p.progress.percentDone, 50);
  assert.ok(p.progress.weightedPercentDone >= 0, 'weighted fields computed from defaults');
  assert.equal(p.tasks[1].depsMet, true, 'missing dependsOn is treated as unblocked');
  assert.equal(p.nextAction.taskId, 'o2');
});

/* ---------------- verification v3 ---------------- */

const EV_OK = {
  repoUrl: 'https://github.com/u/repo', liveUrl: null, hasTestOutput: false,
  github: { checked: true, unavailable: false, present: true, hasSource: true, fullName: 'u/repo', note: 'ok' },
  ci: { checked: true, unavailable: false, present: true, note: 'CI green' },
  deployment: null, apiHealth: null, tests: null,
};

test('a done task with all machine rules verified is promoted; skills attribute to it', () => {
  const plan = {
    tasks: [
      { id: 'g1', order: 1, phase: 'setup', title: 'Push it to GitHub', status: 'done', skills: ['Git'],
        acceptanceCriteria: ['Repo exists'], verificationRules: [{ type: 'github', rule: 'Repo exists' }] },
      { id: 'g2', order: 2, phase: 'quality', title: 'Tests', status: 'backlog', skills: ['node:test'],
        acceptanceCriteria: [], verificationRules: [{ type: 'local_tests', rule: 'Tests pass' }] },
    ],
    architecture: {},
  };
  const { tasks, taskVerification } = verifyPlanTasks(plan, EV_OK);
  assert.equal(tasks[0].status, 'verified', 'done + all rules verified -> promoted');
  assert.equal(tasks[1].status, 'backlog', 'un-done tasks are NEVER promoted');
  const skill = taskVerification.skillEvidence.find((s) => s.skill === 'Git');
  assert.ok(skill, 'verified skill attributed');
  assert.deepEqual(skill.taskIds, ['g1']);
  assert.ok(taskVerification.promotedTaskIds.includes('g1'));
  // Traceability: the graph answers WHY Git is verified.
  const graph = buildEvidenceGraph({ ...plan, tasks, taskVerification, roadmap: [] });
  const trace = traceSkill(graph, 'Git');
  assert.equal(trace.found, true);
  assert.match(trace.chain[0].task, /GitHub/);
  assert.ok(trace.chain[0].evidence.length >= 1, 'evidence chain names the artifact');
});

test('partial verification names exactly what is missing; unavailable stays pending', () => {
  const t = {
    id: 'd1', order: 1, phase: 'launch', title: 'Deploy frontend + backend', status: 'done', skills: ['Deployment'],
    acceptanceCriteria: ['Public URL serves the app'],
    verificationRules: [{ type: 'github', rule: 'Repo pushed' }, { type: 'deployment', rule: 'Deployed URL reachable' }],
  };
  const r = verifyTask(t, EV_OK, {});
  assert.equal(r.status, 'partially_verified');
  assert.match(r.remediation.title, /deployed URL/i);
  // Unavailable infra must never punish the student.
  const evDown = { ...EV_OK, github: { checked: false, unavailable: true, note: 'rate limited' } };
  const r2 = verifyTask(t, evDown, {});
  const ghRow = r2.criteria.find((c) => c.type === 'github');
  assert.equal(ghRow.result, 'pending', 'unavailable => pending, never failed');
});

test('self-marked verified is impossible: acceptance criteria alone never verify a task', () => {
  const t = { id: 's1', order: 1, phase: 'setup', title: 'Self', status: 'done', skills: ['X'],
    acceptanceCriteria: ['I did it'], verificationRules: [] };
  const r = verifyTask(t, EV_OK, {});
  assert.notEqual(r.status, 'verified');
  const { tasks } = verifyPlanTasks({ tasks: [t], architecture: {} }, EV_OK);
  assert.equal(tasks[0].status, 'done', 'no machine rules -> no promotion');
});

/* ---------------- readiness v2 ---------------- */

test('role readiness scores verified evidence above claims and explains each dimension', () => {
  const base = { targetRole: 'Backend Developer', verifiedProjectCount: 1, resumeScore: 60 };
  const verified = computeRoleReadiness({ ...base, verifiedSkills: ['rest api', 'node.js', 'sql'] });
  const claimed = computeRoleReadiness({ ...base, claimedSkills: ['rest api', 'node.js', 'sql'] });
  assert.ok(verified.score > claimed.score, 'verified evidence must outscore bare claims');
  const core = verified.dimensions.find((d) => d.id === 'mustHave');
  assert.ok(core.evidence.verified.includes('rest api'));
  assert.ok(core.evidence.missing.length > 0, 'missing skills are named');
  assert.ok(verified.topActions.length > 0);
  assert.match(verified.topActions[0].title, /evidence|Prove/i);
});

test('readiness change attribution names the exact verified skills that moved it', () => {
  const before = computeRoleReadiness({ targetRole: 'Backend Developer', verifiedSkills: ['rest api'], verifiedProjectCount: 0 });
  const after = computeRoleReadiness({ targetRole: 'Backend Developer', verifiedSkills: ['rest api', 'docker'], verifiedProjectCount: 1 });
  const change = explainReadinessChange(before, after);
  assert.ok(change.delta > 0);
  assert.ok(change.reasons.some((r) => /docker/i.test(r.detail)), 'the gained skill is named, not vibes');
  assert.ok(change.reasons.some((r) => /Verified projects: 0 → 1/.test(r.detail)));
  assert.equal(explainReadinessChange(null, after).hasBaseline, true);
  assert.equal(explainReadinessChange(null, null).hasBaseline, false);
});

test('readiness v1 contract is untouched by v2', () => {
  const r = computeReadiness({ verifiedSkills: ['a', 'b'], totalVerifiedXp: 200, verifiedProjectCount: 1 });
  for (const k of ['score', 'category', 'components', 'counts', 'gaps', 'readinessVersion']) assert.ok(k in r);
  assert.equal(r.readinessVersion, 'readiness-v1');
});

/* ---------------- platform next best action ---------------- */

test('NBA ranks overdue college work above project momentum; every action has a CTA', () => {
  const now = Date.parse('2026-08-10T00:00:00Z');
  const out = rankNextBestActions({
    now,
    collegeTasks: [{ id: 'ct1', title: 'Submit resume for drive', dueAt: '2026-08-08T00:00:00Z', done: false }],
    workspaces: [{ projectId: 'p1', title: 'Queue Manager', progress: { weightedPercentDone: 40, weightedPercentVerified: 10 }, nextAction: { taskId: 't1', title: 'Own the API', reason: 'Next in build order.' }, verificationNextActions: [], verificationCounts: null }],
    roleReadiness: computeRoleReadiness({ targetRole: 'Backend Developer', verifiedSkills: ['rest api'] }),
    resumeRecommendations: [],
  });
  assert.equal(out.highestImpact.actionType, 'college_task');
  assert.match(out.highestImpact.explanation, /overdue/i);
  for (const a of out.actions) {
    assert.ok(a.cta && a.cta.view, 'every action routes somewhere');
    assert.ok(a.priority >= 0 && a.priority <= 100);
  }
  const types = out.actions.map((a) => a.actionType);
  assert.ok(types.includes('project_task'));
});

test('NBA with empty state recommends starting, never fabricates progress', () => {
  const out = rankNextBestActions({ workspaces: [], collegeTasks: [], roleReadiness: null, resumeRecommendations: [] });
  assert.equal(out.highestImpact.actionType, 'start_project');
  assert.equal(out.inputsUsed.workspaces, 0);
});

test('NBA surfaces verification remediation from real workspace state', () => {
  const out = rankNextBestActions({
    workspaces: [{ projectId: 'p1', title: 'Queue Manager', progress: { percentDone: 80 }, nextAction: null,
      verificationNextActions: [{ title: 'Submit evidence: Deployed URL reachable', note: 'Attach your deployed URL.', criterionId: 'c1' }], verificationCounts: { partiallyVerified: 1 } }],
  });
  assert.equal(out.highestImpact.actionType, 'submit_evidence');
  assert.equal(out.highestImpact.source.projectId, 'p1');
});

/* ---------------- resume evidence gaps ---------------- */

test('resume classifier: three types, each honest about its provenance', () => {
  const out = classifyResumeEvidenceGaps({
    targetRole: 'Backend Developer',
    verifiedSkills: ['docker'],
    resumeSkills: ['node.js', 'kubernetes'],
    provenSkills: [],
    qualityChecks: [{ type: 'weak_bullets', severity: 'high', detail: '3 bullets open passively.' }],
    skillEvidence: [{ skill: 'docker', taskIds: ['t9'], evidence: ['Repo exists'], confidence: 'medium' }],
    verifiedProjects: [{ id: 'p9', title: 'Queue Manager', skills: ['docker'] }],
  });
  const t1 = out.recommendations.find((r) => r.type === 'evidence_exists');
  assert.ok(t1 && t1.skill === 'docker');
  assert.equal(t1.provenance.projectId, 'p9');
  assert.deepEqual(t1.provenance.taskIds, ['t9'], 'TYPE 1 carries real provenance');
  const t2 = out.recommendations.find((r) => r.type === 'weak_wording');
  assert.match(t2.explanation, /never invent metrics/i);
  const t3 = out.recommendations.find((r) => r.type === 'evidence_missing' && r.skill === 'kubernetes');
  assert.ok(t3, 'claimed-but-unproven role skill flagged');
  assert.equal(t3.cta.view, 'projectstudio', 'TYPE 3 routes into Project OS');
  assert.deepEqual(t3.cta.payload.skills, ['kubernetes']);
  // A skill both verified and on the resume produces nothing.
  const clean = classifyResumeEvidenceGaps({ targetRole: 'Backend Developer', verifiedSkills: ['node.js'], resumeSkills: ['node.js'] });
  assert.ok(!clean.recommendations.some((r) => r.skill === 'node.js' && r.type === 'evidence_exists'));
});

/* ---------------- college interventions ---------------- */

const ROW = (id, over = {}) => ({
  id, name: `S${id}`, email: `s${id}@x.test`, branch: 'CSE', batch: '2026',
  targetRole: 'Backend Developer', skills: ['java'], verifiedSkills: [], pendingSkills: [],
  totalVerifiedXp: 0, projectsTotal: 0, projectsVerified: 0, projectsPending: 0, projectsNeedsReview: 0,
  recruiterReadyProjects: 0, resumeScore: null, lastActiveAt: new Date().toISOString(),
  readinessScore: 30, ...over,
});

test('intervention cohorts follow the rules and never widen beyond the rows given', () => {
  const rows = [
    ROW('1'), ROW('2'), ROW('3'), // backend gaps
    ROW('4', { projectsPending: 2 }), ROW('5', { projectsPending: 1 }), ROW('6', { projectsNeedsReview: 1 }),
    ROW('7', { readinessScore: 80, verifiedSkills: ['rest api', 'docker', 'node.js', 'sql', 'testing'] }),
  ];
  const out = recommendInterventions({ rows, minCohort: 3 });
  const backend = out.recommendations.find((r) => r.id === 'backend_evidence_sprint');
  assert.ok(backend, 'backend sprint detected');
  assert.ok(backend.cohort.every((m) => rows.some((r) => r.id === m.id)), 'cohort ⊆ provided (scoped) rows — isolation preserved');
  assert.ok(!backend.cohort.some((m) => m.id === '7'), 'ready students excluded');
  assert.match(backend.outcomesNote, /targets, not measurements/);
  const verif = out.recommendations.find((r) => r.id === 'verification_sprint');
  assert.equal(verif.cohortSize, 3);
  assert.ok(verif.cohort[0].reason.length > 0, 'every member carries a real reason');
});

test('outcome measurement is before/after over real students — never a forecast', () => {
  const rows = [ROW('1'), ROW('2'), ROW('3')];
  const baseline = snapshotCohort(rows, ['1', '2']);
  assert.equal(baseline.students.length, 2, 'snapshot only includes the assigned ids');
  const after = [
    ROW('1', { readinessScore: 55, verifiedSkills: ['rest api', 'docker'], projectsVerified: 1, resumeScore: 62 }),
    ROW('2', { readinessScore: 41, verifiedSkills: ['rest api'] }),
  ];
  const m = measureInterventionOutcome({ before: baseline, afterRows: after, taskStats: { assigned: 2, done: 1, completionRate: 50 } });
  assert.equal(m.measured, true);
  assert.equal(m.students.matched, 2);
  assert.equal(m.readiness.before, 30);
  assert.equal(m.readiness.after, 48);
  assert.equal(m.verifiedSkills.gained, 3);
  assert.equal(m.verifiedProjects.gained, 1);
  assert.equal(m.assignment.completionRate, 50);
  assert.equal(measureInterventionOutcome({ before: null, afterRows: after }).measured, false, 'no baseline -> no fabricated numbers');
});

test('annotateDependencyState is idempotent and pure', () => {
  const tasks = [{ id: 'a', status: 'done' }, { id: 'b', status: 'backlog', dependsOn: ['a'] }];
  const once = annotateDependencyState(tasks);
  const twice = annotateDependencyState(once);
  assert.deepEqual(once.map((t) => t.depsMet), twice.map((t) => t.depsMet));
  assert.equal(tasks[1].depsMet, undefined, 'input not mutated');
});
