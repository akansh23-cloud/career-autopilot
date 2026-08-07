// Team projects — end-to-end against a real booted server, DB-less with
// DEMO_MODE on. That is the exact configuration the pilot demo runs in, so
// these tests exercise the code path a placement cell actually sees:
// team formation, skill-matched project generation, assignment, the student's
// own view, submission of a live hosted link, and verification.
//
// No network is required: verification runs against unreachable .invalid /
// .test hosts, which is itself the assertion — the engine must report a dead
// deployment as NOT verified rather than passing it.
process.env.NODE_ENV = 'test';
process.env.ALLOW_DEV_LOGIN = '1';
process.env.DEMO_MODE = '1';
process.env.ADMIN_EMAILS = 'team-admin@test.dev';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeClient } from './helpers.js';
import engine from '../server/utils/teamProjectEngine.js';

let server, base, client;

before(async () => {
  ({ server, base } = await startServer());
  client = makeClient(base);
  await client.devLogin('Team Admin', 'team-admin@test.dev');
});
after(async () => { await stopServer(server); });

const GET = async (p) => (await client.get(p)).json;
const POST = async (p, b) => (await client.post(p, b)).json;
const PATCH = async (p, b) => (await client.patch(p, b)).json;
const DEL = async (p) => (await client.del(p)).json;
const ok = (r, label) => { assert.equal(r?.ok, true, `${label}: ${JSON.stringify(r).slice(0, 300)}`); return r; };

/* ============================================================
   Engine — pure, no server needed
   ============================================================ */

test('skills map to capability areas, including multi-word skills', () => {
  assert.equal(engine.areaForSkill('React'), 'frontend');
  assert.equal(engine.areaForSkill('Spring Boot'), 'backend');
  assert.equal(engine.areaForSkill('Machine Learning'), 'ml');
  assert.equal(engine.areaForSkill('Kubernetes'), 'devops');
  assert.equal(engine.areaForSkill('Embedded C'), 'hardware');
  assert.equal(engine.areaForSkill('completely made up skill'), '');
});

test('team analysis weights a verified skill above a merely declared one', () => {
  const declaredOnly = engine.analyzeTeamSkills([{ id: 'a', skills: ['React'], verifiedSkills: [] }]);
  const verified = engine.analyzeTeamSkills([{ id: 'b', skills: ['React'], verifiedSkills: ['React'] }]);
  const depth = (a) => a.areas.find((x) => x.id === 'frontend').depth;
  assert.ok(depth(verified) > depth(declaredOnly), 'verified skills count for more');
});

test('team analysis reports gaps, not just coverage', () => {
  const a = engine.analyzeTeamSkills([{ id: 'a', skills: ['React', 'Tailwind'], verifiedSkills: [] }]);
  assert.ok(a.covered.includes('frontend'));
  assert.ok(a.gaps.includes('backend'), 'an uncovered area is named as a gap');
  assert.ok(a.coverageScore < 100, 'a frontend-only team is not fully covered');
});

test('balanced formation is deterministic and spreads readiness across teams', () => {
  const students = Array.from({ length: 8 }, (_, i) => ({
    id: `s${i}`, name: `S${i}`, skills: ['React', 'Node.js'], verifiedSkills: [], readinessScore: 90 - i * 10,
  }));
  const first = engine.suggestTeams({ students, teamSize: 4 });
  const second = engine.suggestTeams({ students, teamSize: 4 });
  assert.deepEqual(
    first.teams.map((t) => t.memberIds),
    second.teams.map((t) => t.memberIds),
    'the same cohort always produces the same teams'
  );
  assert.equal(first.teams.length, 2);
  const avg = (t) => t.members.reduce((s, m) => s + m.readinessScore, 0) / t.members.length;
  assert.ok(Math.abs(avg(first.teams[0]) - avg(first.teams[1])) <= 10, 'teams are not top-heavy vs bottom-heavy');
});

test('every selected student is placed on a team, even with an uneven split', () => {
  const students = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, skills: ['Python'], readinessScore: 50 }));
  const { teams } = engine.suggestTeams({ students, teamSize: 3 });
  const placed = teams.flatMap((t) => t.memberIds);
  assert.equal(new Set(placed).size, 7, 'nobody is dropped');
});

test('the generated stack only contains skills the team actually has', () => {
  const brief = engine.generateTeamProject({
    members: [
      { id: 'a', name: 'A', skills: ['React', 'JavaScript'], verifiedSkills: ['React'], readinessScore: 70 },
      { id: 'b', name: 'B', skills: ['Node.js', 'MongoDB'], verifiedSkills: [], readinessScore: 60 },
    ].map(engine.shapeMember),
    options: {},
  });
  const listed = Object.entries(brief.stack)
    .filter(([area]) => area !== 'devops') // devops is the explicit "to be learned" case
    .flatMap(([, v]) => v)
    .map((s) => s.toLowerCase());
  const owned = new Set(['react', 'javascript', 'node.js', 'mongodb']);
  for (const s of listed) assert.ok(owned.has(s), `${s} is a skill someone on the team listed`);
});

test('deployment is always required even when nobody on the team knows it', () => {
  const brief = engine.generateTeamProject({
    members: [{ id: 'a', name: 'A', skills: ['React'], readinessScore: 50 }].map(engine.shapeMember),
    options: {},
  });
  assert.ok(brief.stack.devops, 'a deployment line always exists');
  assert.ok(brief.proofRequirements.some((p) => p.key === 'live_url' && p.required), 'the live URL is a required proof');
});

test('every member gets exactly one role and owned modules', () => {
  const members = [
    { id: 'a', name: 'A', skills: ['React'], readinessScore: 80 },
    { id: 'b', name: 'B', skills: ['Node.js'], readinessScore: 70 },
    { id: 'c', name: 'C', skills: ['SQL'], readinessScore: 60 },
  ].map(engine.shapeMember);
  const brief = engine.generateTeamProject({ members, options: {} });
  assert.equal(brief.assignments.length, 3);
  assert.equal(new Set(brief.assignments.map((a) => a.role)).size, 3, 'no two members share a lead role');
  for (const a of brief.assignments) assert.ok(a.modules.length > 0, `${a.name} owns something concrete`);
});

/* ============================================================
   Coordinator flow
   ============================================================ */

let teamStudentIds = [];
let projectId = '';

test('the archetype catalogue is served rather than hardcoded in the UI', async () => {
  const r = ok(await GET('/api/college/team-projects/catalog'), 'catalog');
  assert.ok(r.archetypes.length >= 5);
  assert.ok(r.areas.some((a) => a.id === 'devops'));
});

test('the engine proposes teams from the cohort with a project already matched', async () => {
  const r = ok(await POST('/api/college/team-projects/suggest', { teamSize: 4, strategy: 'balanced', limit: 12 }), 'suggest');
  assert.ok(r.teams.length >= 2, 'more than one team is proposed');
  const team = r.teams[0];
  assert.ok(team.members.length >= 2);
  assert.ok(team.preview?.title, 'each proposed team arrives with a matched project');
  assert.ok(team.analysis?.coverageScore >= 0);
  teamStudentIds = team.memberIds.slice(0, 4);
});

test('a preview explains why THIS team got THIS project', async () => {
  const r = ok(await POST('/api/college/team-projects/preview', { studentIds: teamStudentIds }), 'preview');
  assert.ok(r.brief.whyThisTeam.length > 40, 'the rationale is a real sentence');
  assert.ok(Array.isArray(r.brief.milestones) && r.brief.milestones.length >= 4);
  assert.ok(r.brief.acceptanceCriteria.length >= 3);
});

test('a preview with student ids outside the college is refused', async () => {
  const r = await POST('/api/college/team-projects/preview', { studentIds: ['not_a_student_1', 'not_a_student_2'] });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'no_targets_in_scope');
});

test('a team of one is rejected with a usable message', async () => {
  const r = await POST('/api/college/team-projects/preview', { studentIds: [teamStudentIds[0]] });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'invalid_input');
});

test('assigning creates the project, denormalises members and reports delivery honestly', async () => {
  const dueAt = new Date(Date.now() + 21 * 86400000).toISOString();
  const r = ok(await POST('/api/college/team-projects', {
    studentIds: teamStudentIds, teamName: 'Alpha Squad', domain: 'campus placements', dueAt,
  }), 'assign');
  projectId = r.project.id;
  assert.equal(r.project.teamName, 'Alpha Squad');
  assert.equal(r.project.members.length, teamStudentIds.length);
  assert.equal(r.project.summary.status, 'assigned');
  // No database in this configuration — the response must SAY so rather than
  // claiming notifications that were never stored.
  assert.equal(r.delivery.inApp, 0);
  assert.match(r.delivery.message, /need the database|not configured/i);
});

test('the coordinator list carries a decision-ready roll-up', async () => {
  const r = ok(await GET('/api/college/team-projects'), 'list');
  assert.ok(r.projects.some((p) => p.id === projectId));
  assert.ok(r.summary.total >= 1);
  assert.ok(r.summary.studentsEngaged >= teamStudentIds.length);
});

test('the detail view returns live student profiles alongside the project', async () => {
  const r = ok(await GET(`/api/college/team-projects/${projectId}`), 'detail');
  assert.equal(r.profiles.length, teamStudentIds.length);
  for (const p of r.profiles) {
    assert.equal(p.stillInCohort, true);
    assert.ok(p.live, 'the profile is re-read live, not served stale');
    assert.ok(typeof p.live.readinessScore === 'number');
  }
});

test('requesting the live link is recorded against the project', async () => {
  const r = ok(await POST(`/api/college/team-projects/${projectId}/request-link`, { message: 'Please deploy by Friday.' }), 'request-link');
  assert.equal(r.requested, 1);
  const detail = ok(await GET(`/api/college/team-projects/${projectId}`), 'detail after request');
  assert.equal(detail.project.linkRequests.length, 1);
  assert.match(detail.project.linkRequests[0].message, /Friday/);
});

test('verifying before anything is submitted says exactly that', async () => {
  const r = ok(await POST(`/api/college/team-projects/${projectId}/verify`, {}), 'verify empty');
  assert.equal(r.verification.passed, false);
  assert.match(r.verification.summary, /Nothing has been submitted/i);
});

/* ============================================================
   Student flow
   ============================================================ */

let studentClient;

test('a student sees only the team project they are a member of', async () => {
  const member = (await GET(`/api/college/team-projects/${projectId}`)).project.members[0];
  studentClient = makeClient(base);
  await studentClient.devLogin(member.name, member.email);

  const r = (await studentClient.get('/api/my/team-projects')).json;
  assert.equal(r.ok, true);
  assert.equal(r.projects.length, 1);
  assert.equal(r.projects[0].id, projectId);
  assert.ok(r.projects[0].myAssignment, 'the student sees their OWN role, not just the team brief');
  assert.ok(r.projects[0].myAssignment.modules.length > 0);
});

test('a student who is not on the team sees nothing', async () => {
  const outsider = makeClient(base);
  await outsider.devLogin('Outsider', 'outsider@nowhere.test');
  const r = (await outsider.get('/api/my/team-projects')).json;
  assert.equal(r.projects.length, 0);
  const direct = await outsider.get(`/api/my/team-projects/${projectId}`);
  assert.equal(direct.status, 404);
});

test('an empty submission is refused', async () => {
  const r = (await studentClient.post(`/api/my/team-projects/${projectId}/submit`, { notes: 'nothing yet' })).json;
  assert.equal(r.ok, false);
  assert.equal(r.error, 'nothing_submitted');
});

test('a student submits the live hosted link for the whole team', async () => {
  const r = (await studentClient.post(`/api/my/team-projects/${projectId}/submit`, {
    liveUrl: 'https://alpha-squad-demo.invalid',
    repoUrl: 'https://github.com/alpha-squad/campus-ops',
    notes: 'Deployed on a free tier.',
  })).json;
  assert.equal(r.ok, true);
  assert.equal(r.project.summary.status, 'submitted');
  assert.equal(r.project.submission.liveUrl, 'https://alpha-squad-demo.invalid');
  assert.ok(r.project.submission.submittedBy, 'the submitter is recorded');
});

test('the coordinator sees the submission on their side immediately', async () => {
  const r = ok(await GET(`/api/college/team-projects/${projectId}`), 'detail after submit');
  assert.equal(r.project.submission.repoUrl, 'https://github.com/alpha-squad/campus-ops');
  assert.equal(r.project.summary.hasSubmission, true);
});

test('a dead deployment does not verify', async () => {
  const r = ok(await POST(`/api/college/team-projects/${projectId}/verify`, {}), 'verify dead link');
  assert.equal(r.verification.passed, false, 'an unreachable host must never pass');
  const live = r.verification.checks.find((c) => c.key === 'live_url');
  assert.ok(live, 'the live URL was checked');
  assert.ok(['fail', 'unavailable'].includes(live.state), `unreachable host reported as ${live.state}`);
  assert.ok(r.verification.checkedAt, 'the check is timestamped');
});

test('resubmitting clears a previous verdict rather than keeping a stale badge', async () => {
  const before = ok(await GET(`/api/college/team-projects/${projectId}`), 'before resubmit');
  assert.ok(before.project.verification, 'a verdict exists');
  const r = (await studentClient.post(`/api/my/team-projects/${projectId}/submit`, {
    liveUrl: 'https://alpha-squad-v2.invalid',
    repoUrl: 'https://github.com/alpha-squad/campus-ops',
  })).json;
  assert.equal(r.ok, true);
  assert.equal(r.project.verification, null, 'the old verdict does not survive a new submission');
  assert.equal(r.project.submissionHistory.length >= 2, true, 'submission history is kept');
});

/* ============================================================
   Tenancy and lifecycle
   ============================================================ */

test('a student cannot reach the coordinator surface', async () => {
  const r = await studentClient.get('/api/college/team-projects');
  assert.equal(r.status, 403);
});

test('the coordinator can rename and reschedule an assignment', async () => {
  const r = ok(await PATCH(`/api/college/team-projects/${projectId}`, {
    teamName: 'Alpha Squad (renamed)', coordinatorNotes: 'Reviewed in the Tuesday standup.',
  }), 'patch');
  assert.equal(r.project.teamName, 'Alpha Squad (renamed)');
  assert.match(r.project.coordinatorNotes, /Tuesday/);
});

test('patching a project that does not exist is a 404, not a silent create', async () => {
  const r = await client.patch('/api/college/team-projects/tp_doesnotexist', { teamName: 'Ghost' });
  assert.equal(r.status, 404);
});

test('a project can be deleted and then no longer appears', async () => {
  ok(await DEL(`/api/college/team-projects/${projectId}`), 'delete');
  const list = ok(await GET('/api/college/team-projects'), 'list after delete');
  assert.equal(list.projects.some((p) => p.id === projectId), false);
});

/* ============================================================
   Skill mapping — regressions
   ------------------------------------------------------------
   The first cut matched skills by naive substring, so the one-letter
   'r' token in the ML list captured Grafana, Prometheus, Apache Spark
   and Operating Systems and filed all four as machine learning. A
   DevOps team therefore came back staffed with an "ML / Analytics
   Owner" and a Big Data team's core tools counted for nothing.
   Matching is whole-word now; these lock that in.
   ============================================================ */

test('short tokens no longer swallow unrelated skills', () => {
  assert.equal(engine.areaForSkill('Grafana'), 'devops');
  assert.equal(engine.areaForSkill('Prometheus'), 'devops');
  assert.equal(engine.areaForSkill('Apache Spark'), 'data');
  assert.equal(engine.areaForSkill('Operating Systems'), 'backend');
  assert.equal(engine.areaForSkill('Serverless'), 'backend');
  // ...while the language R itself still resolves, as a whole word.
  assert.equal(engine.areaForSkill('R'), 'ml');
});

test('the demo college\u2019s specialisation vocabularies are all recognised', () => {
  const expected = {
    // AI & ML
    'Machine Learning': 'ml', 'PyTorch': 'ml', 'scikit-learn': 'ml', 'OpenCV': 'ml',
    // Big Data
    Hadoop: 'data', Kafka: 'data', Hive: 'data', 'Power BI': 'data',
    // Cloud
    AWS: 'devops', Kubernetes: 'devops', Terraform: 'devops', Microservices: 'backend',
    // DevOps
    Jenkins: 'devops', Helm: 'devops', Bash: 'devops', 'CI/CD': 'devops',
    // Shared fundamentals
    Python: 'backend', 'C++': 'backend', SQL: 'data', Git: 'devops', JavaScript: 'frontend',
  };
  for (const [skill, area] of Object.entries(expected)) {
    assert.equal(engine.areaForSkill(skill), area, `${skill} should map to ${area}`);
  }
});

test('longer skill names win over their own fragments', () => {
  assert.equal(engine.areaForSkill('React Native'), 'mobile');
  assert.equal(engine.areaForSkill('React'), 'frontend');
  assert.equal(engine.areaForSkill('Spring Boot'), 'backend');
  assert.equal(engine.areaForSkill('Embedded C'), 'hardware');
});

test('a single-specialisation team still gets one distinct role each', () => {
  // Four students who all listed the same narrow stack. Before the fix the
  // fourth fell through to a role a teammate already held.
  const members = ['a', 'b', 'c', 'd'].map((id, i) => engine.shapeMember({
    id, name: `Member ${id.toUpperCase()}`,
    skills: ['Hadoop', 'Apache Spark', 'SQL'], verifiedSkills: ['SQL'],
    readinessScore: 70 - i,
  }));
  const brief = engine.generateTeamProject({ members, options: {} });
  const roles = brief.assignments.map((a) => a.role);
  assert.equal(new Set(roles).size, 4, `duplicate roles: ${roles.join(', ')}`);
});
