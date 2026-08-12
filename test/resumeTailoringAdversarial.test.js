/* ============================================================
   ADVERSARIAL TRUTH SUITE  (P2.23, P2.24)
   ------------------------------------------------------------
   Each test encodes a specific way a resume engine lies. They are
   written as attacks rather than as feature checks, because the
   failure mode that matters is not "the code path is missing" but
   "the code path exists and the lie got through anyway".
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runTailoring } from '../server/services/resumeTailoring/canonicalTailoringService.js';
import { AUDIT_FIXTURES, auditFixtureById } from './fixtures/tailoringAuditFixtures.js';

const textOf = (r) => [r.summary?.chosen, ...(r.bullets || []).map((b) => b.text)]
  .filter(Boolean).join(' \n ');

const has = (t, word) => new RegExp(`(?<![a-z0-9])${word}(?![a-z0-9])`, 'i').test(t);

async function tailor(fixture, opts = {}) {
  return runTailoring({
    operation: fixture.jd ? 'job-tailor' : 'enhance',
    doc: fixture.doc,
    jobDescription: fixture.jd || '',
    job: fixture.job || {},
    userKey: `adv-${fixture.id}`,
    ...opts,
  });
}

/* ============================================================
   FIXTURE A — Strong DevOps  (the live audit scenario)
   ============================================================ */

test('Fixture A: OpenShift satisfies the OR group and Kubernetes is never claimed', async () => {
  const f = auditFixtureById('audit_strong_devops');
  const r = await tailor(f);
  assert.equal(r.ok, true);
  const t = textOf(r);

  /* The candidate's real technologies survive. */
  assert.ok(has(t, 'openshift') || has(t, 'helm') || has(t, 'gitlab'),
    'supported technologies should still appear');

  /* The sibling alternative must not appear anywhere. */
  assert.ok(!has(t, 'kubernetes'), 'Kubernetes has no candidate evidence');
  assert.ok(!has(t, 'k8s'), 'nor via its abbreviation');

  /* Preferred-but-absent technologies must not appear. */
  for (const absent of ['terraform', 'prometheus', 'grafana']) {
    assert.ok(!has(t, absent), `${absent} is a JD preference with no evidence`);
  }

  /* The OR group is still recorded as satisfied — we lose nothing by being honest. */
  const orGroup = (r.requirementGraph?.groups || [])
    .find((g) => g.members.some((m) => /openshift/i.test(m.term))
      && g.members.some((m) => /kubernetes/i.test(m.term)));
  if (orGroup) {
    assert.equal(orGroup.status, 'SUPPORTED');
    assert.match(String(orGroup.matchedAlternative), /openshift/i);
  }
});

test('Fixture A: the 80% metric stays attached to its own achievement', async () => {
  const f = auditFixtureById('audit_strong_devops');
  const r = await tailor(f);
  const carriers = [
    ...(r.bullets || []).map((b) => b.text),
    r.summary?.chosen || '',
  ].filter((s) => s.includes('80%'));

  for (const s of carriers) {
    /* Wherever 80% appears it must still be about manual verification /
       post-deployment validation — never re-pointed at reliability, uptime,
       cost or "efficiency". */
    assert.ok(/manual|verification|validation|sanity|test/i.test(s),
      `80% was re-pointed at a different claim: "${s}"`);
  }
});

test('Fixture A: rewriting is more than synonym replacement where evidence allows', async () => {
  const f = auditFixtureById('audit_strong_devops');
  const r = await tailor(f);
  assert.ok(r.rewriteStats.improvableBullets > 0, 'fixture must contain improvable bullets');
  assert.ok(r.rewriteStats.usefulRewriteRate >= 0.5,
    `expected meaningful rewriting, got ${r.rewriteStats.usefulRewriteRate}`);
});

/* ============================================================
   FIXTURE B — Partial DevOps
   ============================================================ */

test('Fixture B: container adjacency never becomes an orchestration claim', async () => {
  const f = auditFixtureById('audit_partial_devops');
  const r = await tailor(f);
  assert.equal(r.ok, true);
  const t = textOf(r);

  /* Has Docker; JD wants Kubernetes. Adjacent is not equal. */
  for (const absent of ['kubernetes', 'k8s', 'openshift', 'helm', 'terraform', 'prometheus', 'grafana']) {
    assert.ok(!has(t, absent), `${absent} must not be claimed from adjacency alone`);
  }
  /* CI/CD IS genuinely supported — Jenkins and GitHub Actions are CI/CD. */
  assert.ok(has(t, 'jenkins') || has(t, 'github actions') || has(t, 'docker'),
    'real evidence should still be used');
});

test('Fixture B: a weaker profile still receives safe language improvement', async () => {
  const f = auditFixtureById('audit_partial_devops');
  const r = await tailor(f);
  assert.ok(r.rewriteStats.usefullyRewritten > 0,
    'a partial-match candidate must not be left entirely untouched');
  assert.equal(r.truth.unsupportedClaimCount, 0);
});

/* ============================================================
   FIXTURE C — Fresher
   ============================================================ */

test('Fixture C: fresher output carries no seniority, ownership or production claims', async () => {
  const f = auditFixtureById('audit_fresher');
  const r = await tailor(f, { mode: 'fresher' });
  assert.equal(r.ok, true);
  const t = textOf(r).toLowerCase();

  for (const phrase of [
    'architected', 'spearheaded', 'led a team', 'owned the', 'managed a team',
    'enterprise-wide', 'company-wide', 'set the strategy', 'directed',
    'senior', 'production ownership',
  ]) {
    assert.ok(!t.includes(phrase), `fresher output must not contain "${phrase}"`);
  }
  assert.equal(r.truth.unsupportedClaimCount, 0);
});

/* ============================================================
   Named attacks (P2.24)
   ============================================================ */

test('attack: cross-record skill leakage — AWS in role B does not enter role A', async () => {
  const f = auditFixtureById('attack_skill_leakage');
  const r = await tailor(f);
  const roleA = (r.bullets || []).filter((b) => /jenkins/i.test(b.original));
  assert.ok(roleA.length, 'fixture should contain the Jenkins-only role');
  for (const b of roleA) {
    assert.ok(!has(b.text, 'aws') && !has(b.text, 'amazon web services'),
      `AWS leaked into a bullet whose own evidence has none: "${b.text}"`);
  }
});

test('attack: cross-bullet metric leakage — 40% cannot migrate to another claim', async () => {
  const f = auditFixtureById('attack_metric_leakage');
  const r = await tailor(f);
  const carriers = (r.bullets || []).filter((b) => b.text.includes('40%'));
  for (const b of carriers) {
    assert.ok(/deploy/i.test(b.text),
      `40% belongs to deployment time and appeared elsewhere: "${b.text}"`);
    assert.ok(!/stabilit|reliabilit|uptime/i.test(b.text),
      `40% was re-pointed at reliability: "${b.text}"`);
  }
  assert.equal((r.untracedMetrics || []).length, 0);
});

test('attack: ownership inflation — "assisted" cannot become "led"', async () => {
  const f = auditFixtureById('attack_ownership_inflation');
  const r = await tailor(f);
  const t = textOf(r).toLowerCase();
  for (const verb of ['led ', 'owned ', 'architected ', 'directed ', 'headed ']) {
    assert.ok(!t.includes(verb), `assisted-level evidence produced "${verb.trim()}"`);
  }
});

test('attack: certification inflation — training completed is not certification', async () => {
  const f = auditFixtureById('attack_certification_inflation');
  const r = await tailor(f);
  const t = textOf(r);
  assert.ok(!/\bcertified\b/i.test(t) && !/\bcertification\b/i.test(t),
    'completing training must not be rewritten as being certified');
});

test('attack: external company knowledge never becomes candidate experience', async () => {
  const f = auditFixtureById('attack_company_knowledge');
  /* The JD and company context both talk about Kafka; the candidate has none. */
  const r = await tailor(f);
  const t = textOf(r);
  assert.ok(!has(t, 'kafka'), 'employer technology is not candidate experience');
});

test('attack: similar projects are not merged and their metrics stay separate', async () => {
  const f = auditFixtureById('attack_project_merging');
  const r = await tailor(f);
  for (const b of r.bullets || []) {
    const nums = (b.text.match(/\d+%/g) || []);
    assert.ok(nums.length <= 1,
      `two projects' metrics were merged into one sentence: "${b.text}"`);
  }
  assert.equal((r.untracedMetrics || []).length, 0);
});

test('attack: years of experience are computed from real dates, not invented', async () => {
  const f = auditFixtureById('attack_incomplete_dates');
  const r = await tailor(f);
  const summary = r.summary?.chosen || '';
  const claimed = summary.match(/(\d+)\+?\s*years?/i);
  if (claimed) {
    const years = Number(claimed[1]);
    assert.ok(years > 0 && years <= 6,
      `summary claims ${years} years from incomplete/short date evidence`);
  }
  assert.equal(r.truth.unsupportedClaimCount, 0);
});

/* ============================================================
   Sweep
   ============================================================ */

test('every audit fixture is safe in both depths', async () => {
  for (const f of AUDIT_FIXTURES) {
    for (const depth of ['standard', 'deep']) {
      const r = await tailor(f, { depth, plan: 'premium' });
      assert.equal(r.ok, true, `${f.id}/${depth} failed to run`);
      assert.equal(r.truth.unsupportedClaimCount, 0, `${f.id}/${depth} unsupported claim`);
      assert.equal((r.untracedMetrics || []).length, 0, `${f.id}/${depth} untraced metric`);
      assert.equal(r.telemetry.ai?.totalCalls ?? 0, 0, `${f.id}/${depth} made an AI call`);
    }
  }
});
