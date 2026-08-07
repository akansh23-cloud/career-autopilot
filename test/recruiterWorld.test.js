/* Tests for the persistable recruiter world — server/utils/recruiterWorld.js.
   -----------------------------------------------------------------
   The bridge's whole claim is that the student a placement cell verifies is
   the student a recruiter can open. On a real deployment that means every
   candidate reference has to be a REAL user id, not the generator's synthetic
   `demo_007`. These tests pin that projection. No database is involved: the
   builder is pure, which is why it is a separate module from the seed.        */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEMO_MODE = '1';

const { buildRecruiterWorld, DEMO_ORG_KEY } = await import('../server/utils/recruiterWorld.js');
const { default: demoTalent } = await import('../server/utils/demoTalentData.js');
const { computeSummary, computeSkillGap, computeMatches } = await import('../server/utils/recruiterAnalytics.js');

const COLLEGE = 'demo-institute-of-technology';

/** Stand-in for the ObjectIds the college seed mints. */
const fakeId = (demoId) => `64${String(Math.abs([...demoId].reduce((h, c) => h * 31 + c.charCodeAt(0), 7))).padStart(22, '0')}`.slice(0, 24);

function fullMap() {
  const m = new Map();
  demoTalent.demoTalentProfiles().forEach((p) => m.set(p.userId, fakeId(p.userId)));
  return m;
}

test('every candidate reference is remapped to a real user id', () => {
  const idFor = fullMap();
  const w = buildRecruiterWorld({ idFor, collegeKey: COLLEGE, cohortSize: 200 });

  assert.ok(w.profiles.length > 0, 'expected a non-empty talent pool');
  const ids = new Set([...idFor.values()]);

  w.profiles.forEach((p) => {
    assert.ok(ids.has(p.userId), `profile ${p.userId} is not a mapped id`);
    assert.ok(!/^demo_/.test(p.userId));
  });
  w.pipeline.forEach((row) => {
    assert.ok(ids.has(row.candidateId), `pipeline row ${row.id} points at an unmapped candidate`);
  });
  w.interviews.forEach((iv) => {
    assert.ok(ids.has(iv.candidateId), `interview ${iv.id} points at an unmapped candidate`);
  });
});

test('the original synthetic id is kept for traceability, not for linking', () => {
  const w = buildRecruiterWorld({ idFor: fullMap(), collegeKey: COLLEGE });
  const p = w.profiles[0];
  assert.match(p.demoUserId, /^demo_/);
  assert.notEqual(p.userId, p.demoUserId);
});

test('a smaller cohort drops rows instead of leaving them dangling', () => {
  /* A resized seed writes fewer students. Nothing may reference the ones that
     were not written — an orphaned pipeline row would render a candidate card
     that opens nothing. */
  const all = [...fullMap().entries()];
  const half = new Map(all.slice(0, Math.floor(all.length / 2)));
  const w = buildRecruiterWorld({ idFor: half, collegeKey: COLLEGE, cohortSize: half.size });

  const kept = new Set([...half.values()]);
  assert.ok(w.profiles.length <= all.length);
  assert.ok(w.profiles.length > 0);
  w.pipeline.forEach((row) => assert.ok(kept.has(row.candidateId)));
  w.interviews.forEach((iv) => assert.ok(kept.has(iv.candidateId)));
});

test('interviews never reference a pipeline row that was dropped', () => {
  const all = [...fullMap().entries()];
  const partial = new Map(all.slice(0, Math.max(3, Math.floor(all.length / 3))));
  const w = buildRecruiterWorld({ idFor: partial, collegeKey: COLLEGE });

  const pipelineIds = new Set(w.pipeline.map((p) => p.id));
  w.interviews.forEach((iv) => assert.ok(pipelineIds.has(iv.pipelineId)));
});

test('campus scope is rewritten to the seeded college key', () => {
  const w = buildRecruiterWorld({ idFor: fullMap(), collegeKey: COLLEGE, cohortSize: 200 });

  w.profiles.forEach((p) => assert.equal(p.campus.collegeId, COLLEGE));
  const connected = w.partners.find((c) => c.status === 'connected');
  assert.equal(connected.id, COLLEGE);
  assert.equal(connected.cohortSize, 200);
  // Campus requisitions keep their college link; off-campus ones stay null.
  w.requisitions.filter((r) => r.type !== 'off_campus').forEach((r) => {
    assert.equal(r.collegeId, COLLEGE);
  });
});

test('the org record is scoped by its own key, separate from the college', () => {
  const w = buildRecruiterWorld({ idFor: fullMap(), collegeKey: COLLEGE });
  assert.equal(w.org.key, DEMO_ORG_KEY);
  assert.notEqual(w.org.key, COLLEGE);
  assert.match(w.org.domain, /\.test$/);
  assert.equal(w.org.demo, true);
});

test('a fully mapped world reports the same KPIs as the in-memory one', () => {
  /* The seeded dashboard must not read differently from the local one just
     because the ids changed. Same inputs, same maths, same numbers. */
  const w = buildRecruiterWorld({ idFor: fullMap(), collegeKey: COLLEGE, cohortSize: 200 });
  const seeded = computeSummary({
    org: w.org, profiles: w.profiles, requisitions: w.requisitions,
    pipeline: w.pipeline, partners: w.partners,
  });
  const local = demoTalent.demoTalentSummary();

  assert.equal(seeded.kpis.talentPool, local.kpis.talentPool);
  assert.equal(seeded.kpis.openRequisitions, local.kpis.openRequisitions);
  assert.equal(seeded.kpis.hires, local.kpis.hires);
  assert.equal(seeded.kpis.avgMatchScore, local.kpis.avgMatchScore);
  assert.equal(seeded.kpis.avgTrustScore, local.kpis.avgTrustScore);
});

test('matching and skill gap survive the projection unchanged', () => {
  const w = buildRecruiterWorld({ idFor: fullMap(), collegeKey: COLLEGE });
  const req = w.requisitions.find((r) => r.type === 'campus');

  const seeded = computeMatches({ requisition: req, profiles: w.profiles, limit: 25 });
  const local = demoTalent.demoMatchesForRequisition(req.id, { limit: 25 });
  assert.equal(seeded.matches.length, local.matches.length);
  assert.deepEqual(
    seeded.matches.map((m) => m.match.score),
    local.matches.map((m) => m.match.score),
  );

  assert.deepEqual(
    computeSkillGap({ requisitions: w.requisitions, profiles: w.profiles }),
    demoTalent.demoSkillGap(),
  );
});

test('an empty id map produces an empty world rather than synthetic ids', () => {
  /* Guard against the worst failure mode: seeding a recruiter pipeline into a
     production database that has no matching cohort at all. */
  const w = buildRecruiterWorld({ idFor: new Map(), collegeKey: COLLEGE });
  assert.equal(w.profiles.length, 0);
  assert.equal(w.pipeline.length, 0);
  assert.equal(w.interviews.length, 0);
  // Requisitions and partners are org-level records and still exist.
  assert.ok(w.requisitions.length > 0);
});
