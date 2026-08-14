/* ============================================================
   RESPONSIBILITY CEILING + EVIDENCE SCOPE
   ------------------------------------------------------------
   Two bugs that shared a root cause: authorisation was being
   granted at the wrong scope.

   Responsibility was authorised by the CANDIDATE ("this person is
   senior"), so a senior profile licensed "Owned" on a bullet whose
   own words said "Responsible for".

   Technologies were authorised by the DOCUMENT ("this resume
   mentions Terraform somewhere"), so a Terraform role licensed
   Terraform inside an unrelated Jenkins bullet.

   Both were true of the person and false of the sentence.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RESPONSIBILITY, evidenceResponsibilityLevel, claimedResponsibilityLevel,
  validateResponsibility, ceilingForSeniority,
} from '../server/utils/resume/narrative/responsibilityScale.js';
import { validateAgainstEvidence } from '../server/utils/resume/narrative/truthValidator.js';
import { parseEvidenceText } from '../server/utils/resume/narrative/evidenceGraph.js';
import { composeCandidates } from '../server/utils/resume/narrative/bulletComposer.js';

const rec = (text, over = {}) => ({
  ...parseEvidenceText(text), id: 'e1', tense: 'past', hasConcreteAnchor: true, ...over,
});

/* ================= Part 3 — responsibility ceiling ================= */

test('responsibility: the three examples the brief calls out by name', () => {
  const cases = [
    ['Responsible for deployment configuration.', 'Owned deployment configuration.'],
    ['Worked on the payments migration.', 'Led the payments migration.'],
    ['Helped implement the ledger service.', 'Architected the ledger service.'],
  ];
  for (const [source, rewrite] of cases) {
    const v = validateResponsibility(rewrite, { rawText: source });
    assert.equal(v.status, 'FAIL', `"${source}" must not license "${rewrite}"`);
    assert.equal(v.violations[0].code, 'responsibility_inflation');
  }
});

test('responsibility: seniority makes strong language plausible, not true', () => {
  const source = 'Responsible for deployment configuration of Java 17 services.';
  /* Even at the very top of the scale, the STATEMENT still binds. */
  const v = validateResponsibility('Owned deployment configuration of Java 17 services.',
    { rawText: source }, { candidateCeiling: RESPONSIBILITY.STRATEGY });
  assert.equal(v.status, 'FAIL');
  assert.equal(v.violations[0].evidenced, 'RESPONSIBLE');
  assert.equal(v.violations[0].claimed, 'OWNED');
});

test('responsibility: language may still be improved WITHIN the evidenced level', () => {
  const source = 'Responsible for deployment configuration of Java 17 services.';
  for (const ok of [
    'Ran deployment configuration of Java 17 services.',
    'Maintained deployment configuration of Java 17 services.',
    'Configured Java 17 service deployments.',
  ]) {
    assert.equal(validateResponsibility(ok, { rawText: source }).status, 'PASS', ok);
  }
});

test('responsibility: genuine ownership evidence is not suppressed', () => {
  assert.equal(validateResponsibility('Owned the release process end to end.',
    { rawText: 'Owned the release process.' }).status, 'PASS');
  assert.equal(validateResponsibility('Led the platform team through the migration.',
    { rawText: 'Led the platform team.' }).status, 'PASS');
});

test('responsibility: authority claimed against a silent source fails closed', () => {
  /* No responsibility stated anywhere — silence is not evidence. */
  const v = validateResponsibility('Owned the invoice service.', { rawText: 'The invoice service.' });
  assert.equal(v.status, 'FAIL');
  assert.equal(v.violations[0].evidenced, 'UNSTATED');
});

test('responsibility: execution verbs are not authority claims', () => {
  /* "worked on" → "implemented" describes the work more precisely; it does
     not promote the person. Action semantics governs it, not this check. */
  assert.equal(validateResponsibility('Implemented GitLab CI pipelines.',
    { rawText: 'Worked on GitLab CI pipelines.' }).status, 'PASS');
});

test('responsibility: level parsing prefers the longest matching phrase', () => {
  assert.equal(evidenceResponsibilityLevel('Helped implement the service.'), RESPONSIBILITY.ASSISTED);
  assert.equal(evidenceResponsibilityLevel('Responsible for the service.'), RESPONSIBILITY.RESPONSIBLE);
  assert.equal(evidenceResponsibilityLevel('Led the service.'), RESPONSIBILITY.LED);
  assert.equal(claimedResponsibilityLevel('Owned the service.'), RESPONSIBILITY.OWNED);
});

test('responsibility: a student ceiling caps the whole scale', () => {
  assert.equal(ceilingForSeniority('student'), RESPONSIBILITY.CONTRIBUTED);
  assert.equal(ceilingForSeniority('senior'), RESPONSIBILITY.LED);
});

test('responsibility: the composer no longer emits the inflated candidate', () => {
  const evidence = rec('Responsible for deployment configuration of Java 17 services.');
  const out = composeCandidates(evidence, {
    roleFamily: 'devops', seniority: 'senior', intent: 'ownership',
    userKey: 'resp', ownershipCeiling: 8,
  });
  for (const c of out.accepted) {
    assert.ok(!/^Owned\b/i.test(c.text), `inflated candidate accepted: "${c.text}"`);
  }
  assert.ok(
    out.rejected.some((r) => (r.violations || []).some((v) => v.code === 'responsibility_inflation')),
    'the inflated candidate should be generated and then rejected, proving the gate fired',
  );
});

/* ================= Part 4 — evidence scope ================= */

test('scope: a technology from another record cannot enter this one', () => {
  const evidence = rec('Built Jenkins pipelines for nightly builds.');
  /* Terraform is genuinely on this resume — in a DIFFERENT role. */
  const documentWide = new Set(['jenkins', 'terraform', 'aws']);
  const v = validateAgainstEvidence(
    'Built Jenkins pipelines using Terraform for nightly builds.',
    evidence, { ownershipCeiling: 5, globalPermittedSkills: documentWide },
  );
  assert.equal(v.ok, false);
  assert.equal(v.verdicts.skillContext, 'FAIL', 'skillContext must fail independently');
  assert.ok(v.blocking.some((b) => b.code === 'cross_record_skill_leakage'));
});

test('scope: the failure is attributed to skillContext, not caught by accident', () => {
  const evidence = rec('Built Jenkins pipelines for nightly builds.');
  const v = validateAgainstEvidence(
    'Built Jenkins pipelines using Terraform.',
    evidence, { ownershipCeiling: 5, globalPermittedSkills: new Set(['jenkins', 'terraform']) },
  );
  const leak = v.blocking.find((b) => b.code === 'cross_record_skill_leakage');
  assert.ok(leak);
  assert.equal(leak.scope, 'RECORD');
});

test('scope: an umbrella term for THIS record stays permitted', () => {
  const evidence = rec('Built GitLab CI pipelines for nightly builds.');
  const v = validateAgainstEvidence(
    'Built GitLab CI/CD pipelines for nightly builds.',
    evidence, { ownershipCeiling: 5, globalPermittedSkills: new Set(['gitlab ci', 'ci/cd', 'terraform']) },
  );
  assert.equal(v.ok, true, 'CI/CD restates what this record already evidences');
  assert.equal(v.verdicts.skillContext, 'PASS');
});

test('scope: a technology this record does evidence is untouched', () => {
  const evidence = rec('Built Jenkins pipelines for nightly builds.');
  /* Rephrased around the SAME technology — no new technology introduced. */
  const v = validateAgainstEvidence('Built nightly build pipelines in Jenkins.',
    evidence, { ownershipCeiling: 5, globalPermittedSkills: new Set(['jenkins']) });
  assert.equal(v.verdicts.skillContext, 'PASS');
});

test('scope: a technology on no record at all is still fabrication, not leakage', () => {
  const evidence = rec('Built Jenkins pipelines for nightly builds.');
  const v = validateAgainstEvidence('Built Jenkins and Kubernetes pipelines.',
    evidence, { ownershipCeiling: 5, globalPermittedSkills: new Set(['jenkins']) });
  assert.equal(v.ok, false);
  assert.ok(v.blocking.some((b) => b.code === 'fabricated_technology'),
    'a skill nowhere on the resume is fabrication; the two cases stay distinguishable');
});
