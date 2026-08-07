/* Recruiter ↔ Campus bridge — API + demo-world tests.
   -----------------------------------------------------------------
   Two things are being protected here.

   1. ACCESS. Every /api/recruiter/* endpoint is candidate data. It
      must be unreachable while signed out and unreachable to a
      signed-in non-recruiter. These are the tests that fail loudly
      if someone later drops a guard.

   2. INTERNAL CONSISTENCY. The recruiter world is a projection of
      the college cohort, not a second fixture. So the numbers have
      to close: the talent pool must be a subset of the cohort, the
      pipeline must reference real requisitions and real candidates,
      a candidate must never appear in a requisition whose
      eligibility gate they fail, and nobody may hold two accepted
      offers. A demo that contradicts itself on stage is worse than
      no demo. */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Admin authority in the test env comes only from ADMIN_EMAILS, and the demo
// world is only served when DEMO_MODE is on with no database attached.
process.env.ADMIN_EMAILS = 'bridge-admin@careerautopilot.local';
process.env.DEMO_MODE = '1';

import { startServer, stopServer, makeClient } from './helpers.js';
import demoTalent from '../server/utils/demoTalentData.js';
import { demoStudentsDeep } from '../server/utils/demoCollegeData.js';

const ADMIN = 'bridge-admin@careerautopilot.local';

let server; let base; let admin;
before(async () => {
  ({ server, base } = await startServer());
  admin = makeClient(base);
  await admin.devLogin('Bridge Admin', ADMIN);
});
after(async () => { await stopServer(server); });

const ENDPOINTS = [
  '/api/recruiter/summary',
  '/api/recruiter/requisitions',
  '/api/recruiter/pipeline',
  '/api/recruiter/campus-partners',
  '/api/recruiter/skill-gap',
  '/api/recruiter/interviews',
];

/* ---------------- access control ---------------- */

test('every bridge endpoint refuses an unauthenticated caller', async () => {
  const anon = makeClient(base);
  await anon.bootstrap();
  for (const path of ENDPOINTS) {
    const r = await anon.get(path);
    assert.equal(r.status, 401, `${path} should be 401 when signed out`);
  }
});

test('a signed-in non-recruiter is forbidden, not merely empty-handed', async () => {
  const student = makeClient(base);
  await student.devLogin('Ordinary Student', 'student@demo-institute.test');
  for (const path of ENDPOINTS) {
    const r = await student.get(path);
    assert.equal(r.status, 403, `${path} should be 403 for a non-recruiter`);
  }
});

test('requisition matches are gated the same way as the rest', async () => {
  const anon = makeClient(base);
  await anon.bootstrap();
  const r = await anon.get('/api/recruiter/requisitions/demo_req_1/matches');
  assert.equal(r.status, 401);
});

/* ---------------- shape ---------------- */

test('summary returns KPIs, a funnel and an at-risk list', async () => {
  const r = await admin.get('/api/recruiter/summary');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  const s = r.json.summary;
  assert.ok(s, 'summary present in demo mode');
  assert.ok(s.kpis.openRequisitions > 0);
  assert.ok(s.kpis.talentPool > 0);
  assert.ok(Array.isArray(s.funnel) && s.funnel.length >= 5);
  assert.ok(Array.isArray(s.atRisk));
  assert.ok(Array.isArray(s.trend) && s.trend.length > 0);
});

test('requisitions can be filtered by status', async () => {
  const all = await admin.get('/api/recruiter/requisitions');
  const open = await admin.get('/api/recruiter/requisitions?status=open');
  assert.equal(all.status, 200);
  assert.ok(all.json.requisitions.length > 0);
  assert.ok(open.json.requisitions.length <= all.json.requisitions.length);
  assert.ok(open.json.requisitions.every((r) => r.status === 'open'));
});

test('pipeline can be filtered by requisition and by stage', async () => {
  const all = await admin.get('/api/recruiter/pipeline');
  assert.equal(all.status, 200);
  assert.ok(all.json.pipeline.length > 0);
  assert.ok(all.json.stages.length >= 5);

  const one = await admin.get('/api/recruiter/pipeline?requisitionId=demo_req_1');
  assert.ok(one.json.pipeline.every((p) => p.requisitionId === 'demo_req_1'));

  const offered = await admin.get('/api/recruiter/pipeline?stage=offered');
  assert.ok(offered.json.pipeline.every((p) => p.stage === 'offered'));
});

test('an unknown requisition returns 404 rather than an empty success', async () => {
  const r = await admin.get('/api/recruiter/requisitions/not_a_real_req/matches');
  assert.equal(r.status, 404);
});

test('campus partners include exactly one connected college with live counts', async () => {
  const r = await admin.get('/api/recruiter/campus-partners');
  assert.equal(r.status, 200);
  const connected = r.json.partners.filter((p) => p.status === 'connected');
  assert.equal(connected.length, 1);
  assert.ok(connected[0].cohortSize > 0);
  assert.ok(connected[0].recruiterReadyCount > 0);
  // The unconnected ones must not carry invented cohort numbers.
  r.json.partners.filter((p) => p.status !== 'connected').forEach((p) => {
    assert.equal(p.cohortSize, 0, `${p.name} should not report a cohort before connecting`);
    assert.equal(p.recruiterReadyCount, 0);
  });
});

/* ---------------- internal consistency ---------------- */

test('the talent pool is a strict subset of the college cohort', async () => {
  const { rows } = demoStudentsDeep();
  const cohortIds = new Set(rows.map((r) => r.id));
  const pool = demoTalent.demoTalentProfiles();

  assert.ok(pool.length > 0);
  assert.ok(pool.length < rows.length, 'not every student is exposed to recruiters');
  pool.forEach((p) => {
    assert.ok(cohortIds.has(p.userId), `${p.userId} must exist in the college cohort`);
  });
});

test('only students with recruiter-openable proof are exposed', async () => {
  const { rows } = demoStudentsDeep();
  const byId = new Map(rows.map((r) => [r.id, r]));
  demoTalent.demoTalentProfiles().forEach((p) => {
    const row = byId.get(p.userId);
    assert.ok(row.recruiterReadyProjects > 0, `${p.name} has no recruiter-ready project and must not be listed`);
    assert.ok(p.metrics.hasGithub || p.metrics.hasLive, `${p.name} must have something a recruiter can open`);
  });
});

test('both consent postures are represented so the UI can exercise each path', async () => {
  const pool = demoTalent.demoTalentProfiles();
  assert.ok(pool.some((p) => p.openToRecruiters), 'some candidates allow direct contact');
  assert.ok(pool.some((p) => !p.openToRecruiters), 'some candidates are introduction-only');
});

test('no pipeline entry violates its requisition eligibility gate', async () => {
  const reqs = new Map(demoTalent.demoRequisitions().map((r) => [r.id, r]));
  const profiles = new Map(demoTalent.demoTalentProfiles().map((p) => [p.userId, p]));

  demoTalent.demoPipeline().forEach((p) => {
    const req = reqs.get(p.requisitionId);
    const profile = profiles.get(p.candidateId);
    assert.ok(req, `pipeline references a real requisition (${p.requisitionId})`);
    assert.ok(profile, `pipeline references a real candidate (${p.candidateId})`);
    assert.ok(
      demoTalent.meetsEligibility(profile, req),
      `${profile.name} is in the funnel for "${req.title}" without clearing its eligibility gate`,
    );
  });
});

test('nobody holds two accepted offers', async () => {
  const accepted = demoTalent.demoPipeline().filter((p) => p.stage === 'accepted');
  const ids = accepted.map((p) => p.candidateId);
  assert.equal(new Set(ids).size, ids.length, 'a candidate who accepted is off the market');
});

test('a role requiring industry experience finds nobody on campus', async () => {
  // This is the honest case: a graduating cohort cannot satisfy a lateral hire.
  // If it ever starts returning matches, the eligibility gate has broken.
  const lateral = demoTalent.demoRequisitions().find((r) => r.eligibility?.minExperienceYears > 0);
  assert.ok(lateral, 'the demo includes at least one experienced-hire requisition');
  const { matches } = demoTalent.demoMatchesForRequisition(lateral.id);
  assert.equal(matches.length, 0);
});

test('campus requisitions do find eligible candidates', async () => {
  const campus = demoTalent.demoRequisitions().filter((r) => r.type === 'campus');
  assert.ok(campus.length >= 2);
  campus.forEach((r) => {
    const { matches } = demoTalent.demoMatchesForRequisition(r.id);
    assert.ok(matches.length > 0, `"${r.title}" should have eligible campus candidates`);
    // Ranked descending, and every score explained by its parts.
    matches.forEach(({ match }) => {
      assert.ok(match.score >= 0 && match.score <= 100);
      assert.ok(Object.keys(match.parts).length >= 4);
    });
    const scores = matches.map((m) => m.match.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'matches are ranked');
  });
});

test('skill gap never reports more proven supply than claimed supply', async () => {
  const gaps = demoTalent.demoSkillGap();
  assert.ok(gaps.length > 0);
  gaps.forEach((g) => {
    assert.ok(
      g.provenSupply <= g.claimedSupply,
      `${g.skill}: proven (${g.provenSupply}) cannot exceed claimed (${g.claimedSupply})`,
    );
    assert.equal(g.gap, g.demand - g.provenSupply);
  });
});

test('every bridge endpoint answers 200 for a verified caller', async () => {
  // Module-level tests exercise the generators directly, which cannot catch a
  // function missing from the module's default export — the route would throw
  // a 500 while every unit test still passed. This walks the real HTTP surface.
  for (const path of ENDPOINTS) {
    const r = await admin.get(path);
    assert.equal(r.status, 200, `${path} should answer 200 for an admin`);
    assert.equal(r.json.ok, true, `${path} should report ok`);
  }
});

test('interviews only exist for candidates at a stage where one makes sense', async () => {
  const stageById = new Map(demoTalent.demoPipeline().map((p) => [p.id, p.stage]));
  const valid = new Set(['shortlisted', 'interviewed', 'offered', 'accepted']);
  const interviews = demoTalent.demoInterviews();
  assert.ok(interviews.length > 0);
  interviews.forEach((iv) => {
    const stage = stageById.get(iv.pipelineId);
    assert.ok(stage, 'every interview maps to a real pipeline entry');
    assert.ok(valid.has(stage), `an interview exists for a candidate at stage "${stage}"`);
    // A shortlisted candidate's round is still ahead of them; a later stage
    // means it already happened and must carry a scorecard.
    if (stage === 'shortlisted') assert.equal(iv.status, 'scheduled');
    else { assert.equal(iv.status, 'completed'); assert.ok(iv.score >= 1 && iv.score <= 5); }
  });
});

test('the demo world is deterministic across repeated calls', async () => {
  const a = JSON.stringify(demoTalent.demoTalentSummary().kpis);
  const b = JSON.stringify(demoTalent.demoTalentSummary().kpis);
  assert.equal(a, b);
});

test('candidate discovery serves the same people as the bridge', async () => {
  // /api/network/candidates is the pre-existing search endpoint. It and the new
  // bridge must not disagree about who exists.
  const r = await admin.get('/api/network/candidates');
  assert.equal(r.status, 200);
  const searchIds = new Set((r.json.profiles || []).map((p) => p.userId));
  const bridgeIds = demoTalent.demoTalentProfiles().map((p) => p.userId);
  assert.ok(searchIds.size > 0, 'demo mode populates candidate search');
  bridgeIds.forEach((id) => assert.ok(searchIds.has(id), `${id} is in the bridge but missing from search`));
});
