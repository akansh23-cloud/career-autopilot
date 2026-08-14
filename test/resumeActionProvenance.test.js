/* ============================================================
   ACTION PROVENANCE
   ------------------------------------------------------------
   Separates two questions that Phase A had collapsed:

     "What sounds natural with this object?"   → language layer
     "What did this person actually do?"       → evidence layer

   Collocation strength was answering both, so "Worked on a Spring
   Boot service" acquired "Designed", "Developed" and "Deployed" —
   all idiomatic, none supported.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyActionProvenance, validateActionProvenance, authorizedActionsFor,
  PROVENANCE, NOMINALIZATION_MAP,
} from '../server/utils/resume/narrative/actionProvenance.js';
import { rankAuthorizedVerbs, verbObjectFit } from '../server/utils/resume/narrative/objectVerbFit.js';
import { extractClaimedPredicate, validateActionSemantics } from '../server/utils/resume/narrative/actionSemantics.js';
import { parseEvidenceText } from '../server/utils/resume/narrative/evidenceGraph.js';
import { composeCandidates } from '../server/utils/resume/narrative/bulletComposer.js';
import { validateAgainstEvidence } from '../server/utils/resume/narrative/truthValidator.js';

const ev = (text) => ({ ...parseEvidenceText(text), id: 'e1', tense: 'past', hasConcreteAnchor: true });
const verdict = (src, cand) => validateActionProvenance(cand, ev(src)).status;

/* ================= must FAIL ================= */

test('contribution openers do not authorize a specific action', () => {
  const source = 'Worked on a Spring Boot service for internal ticket routing.';
  for (const invented of [
    'Designed a Spring Boot service for internal ticket routing.',
    'Developed a Spring Boot service for internal ticket routing.',
    'Deployed a Spring Boot service for internal ticket routing.',
    'Built a Spring Boot service for internal ticket routing.',
    'Architected a Spring Boot service for internal ticket routing.',
  ]) {
    assert.equal(verdict(source, invented), 'FAIL', invented);
  }
});

test('non-engineering contribution is treated identically', () => {
  assert.equal(
    verdict('Worked on SEO content briefs for the product blog.', 'Developed SEO content briefs for the product blog.'),
    'FAIL',
  );
});

test('participating in a migration is not performing it', () => {
  assert.equal(verdict('Participated in database migration activities.', 'Migrated the database.'), 'FAIL');
});

test('helping with deployment is not deploying', () => {
  assert.equal(verdict('Helped with deployment activities.', 'Deployed applications.'), 'FAIL');
});

test('a nominalization under a CONTRIBUTION opener authorizes nothing', () => {
  /* The noun describes the project, not the candidate's act. This is the
     distinction that separates "Responsible for configuration" (theirs) from
     "Participated in configuration" (someone's). */
  const p = classifyActionProvenance(ev('Participated in database migration activities.'));
  assert.equal(p.category, PROVENANCE.CONTRIBUTION_ONLY);
  assert.ok(!p.authorized.includes('migrate'));
});

test('cross-family action switching still fails', () => {
  assert.equal(verdict('Wrote SQL validation queries.', 'Launched SQL validation queries.'), 'FAIL');
});

/* ================= must PASS ================= */

test('a nominalization under a RESPONSIBILITY opener authorizes its verb', () => {
  const p = classifyActionProvenance(ev('Responsible for deployment configuration of Java services.'));
  assert.equal(p.category, PROVENANCE.NOMINALIZED_ACTION);
  assert.ok(p.authorized.includes('configure'));
  assert.equal(verdict('Responsible for deployment configuration of Java services.',
    'Configured Java service deployments.'), 'PASS');
});

test('an explicit inner verb is a responsibility paraphrase', () => {
  const p = classifyActionProvenance(ev('Responsible for monitoring production systems.'));
  assert.equal(p.category, PROVENANCE.RESPONSIBILITY_PARAPHRASE);
  assert.equal(verdict('Responsible for monitoring production systems.',
    'Monitored production systems.'), 'PASS');
});

test('a responsibility paraphrase does not authorize neighbouring actions', () => {
  const source = 'Responsible for supporting deployments.';
  assert.equal(verdict(source, 'Supported deployments.'), 'PASS');
  /* Action claims are this validator's business. */
  for (const bad of ['Managed deployments.', 'Designed deployments.']) {
    assert.equal(verdict(source, bad), 'FAIL', bad);
  }
  /* "Owned" is a claim about STANDING, not about which action occurred, so it
     is responsibilityScale's business rather than this one's. Asserting it
     here would conflate two validators that answer different questions — but
     the combined gate must still block it. */
  const combined = validateAgainstEvidence('Owned deployments.', ev(source), { ownershipCeiling: 8 });
  assert.equal(combined.ok, false, 'the truth gate as a whole must block ownership inflation');
  assert.equal(combined.verdicts.seniority, 'FAIL');
});

test('registered equivalents pass; unregistered ones do not', () => {
  assert.equal(verdict('Wrote SQL validation queries.', 'Authored SQL validation queries.'), 'PASS');
  assert.equal(verdict('Built Jenkins pipelines.', 'Constructed Jenkins pipelines.'), 'PASS');
});

test('contribution-level rewrites stay available', () => {
  const source = 'Worked on a Spring Boot service for internal ticket routing.';
  assert.equal(verdict(source, 'Contributed to a Spring Boot service.'), 'PASS');
  assert.equal(verdict(source, 'Supported a Spring Boot service.'), 'PASS');
});

test('the nominalization map is explicit and covers the audited nouns', () => {
  for (const [noun, verb] of Object.entries({
    configuration: 'configure', migration: 'migrate', maintenance: 'maintain',
    validation: 'validate', automation: 'automate', monitoring: 'monitor',
    deployment: 'deploy', integration: 'integrate',
  })) {
    assert.equal(NOMINALIZATION_MAP[noun], verb, noun);
  }
  /* Ambiguous nouns must NOT be in the map — "service" implies no action. */
  for (const noun of ['service', 'platform', 'system', 'project', 'work', 'activity']) {
    assert.equal(NOMINALIZATION_MAP[noun], undefined, `"${noun}" must not imply an action`);
  }
});

test('technology presence never establishes an action', () => {
  const p = classifyActionProvenance(ev('Worked on Docker, Terraform and Kubernetes.'));
  assert.equal(p.category, PROVENANCE.CONTRIBUTION_ONLY);
  for (const v of ['build', 'design', 'deploy', 'migrate', 'architect']) {
    assert.ok(!p.authorized.includes(v), `technology must not authorize "${v}"`);
  }
});

/* ================= objectVerbFit is ranking-only ================= */

test('rankAuthorizedVerbs reorders but never introduces a verb', () => {
  const authorized = ['maintain', 'configure'];
  const ranked = rankAuthorizedVerbs({ object: 'deployment configuration', authorizedVerbs: authorized });
  assert.deepEqual([...ranked].sort(), [...authorized].sort(), 'the set is unchanged');
  for (const forbidden of ['own', 'design', 'architect', 'deploy']) {
    assert.ok(!ranked.includes(forbidden), `rank must not add "${forbidden}"`);
  }
});

test('rankAuthorizedVerbs still does its ranking job', () => {
  const ranked = rankAuthorizedVerbs({
    object: 'SQL queries', authorizedVerbs: ['run', 'write'],
  });
  assert.equal(ranked[0], 'write', '"wrote queries" outranks "ran queries"');
});

test('an empty authorized set yields no verbs at all', () => {
  assert.deepEqual(rankAuthorizedVerbs({ object: 'pipelines', authorizedVerbs: [] }), []);
});

test('verbObjectFit still scores collocation strength', () => {
  assert.ok(verbObjectFit('configure', 'deployment configuration').score
    > verbObjectFit('run', 'deployment configuration').score);
});

/* ================= end-to-end through the composer ================= */

test('the composer accepts no invented action for a contribution bullet', () => {
  const out = composeCandidates(ev('Worked on a Spring Boot service for internal ticket routing.'), {
    roleFamily: 'backend', seniority: 'mid', intent: 'delivery',
    userKey: 'prov', ownershipCeiling: 8,
  });
  for (const c of out.accepted) {
    assert.ok(
      !/^(Designed|Developed|Deployed|Built|Architected|Implemented|Managed)\b/i.test(c.text),
      `invented action accepted: "${c.text}"`,
    );
  }
  /* ...and the rejection is attributed to the right check. */
  assert.ok(
    out.rejected.some((r) => (r.violations || []).some((v) => v.code === 'unsupported_action_claim')),
    'inflated candidates should be generated and then rejected, proving the gate fired',
  );
});

test('the composer still offers a stronger contribution-level rewrite', () => {
  const out = composeCandidates(ev('Worked on a Spring Boot service for internal ticket routing.'), {
    roleFamily: 'backend', seniority: 'mid', intent: 'delivery',
    userKey: 'prov', ownershipCeiling: 8,
  });
  assert.ok(
    out.accepted.some((c) => /^(Contributed to|Supported)\b/i.test(c.text)),
    'a weak bullet must still be improvable without inventing an action',
  );
});

test('actionProvenance is a mandatory verdict on the truth sheet', () => {
  const v = validateAgainstEvidence(
    'Designed a Spring Boot service for internal ticket routing.',
    ev('Worked on a Spring Boot service for internal ticket routing.'),
    { ownershipCeiling: 8 },
  );
  assert.equal(v.verdicts.actionProvenance, 'FAIL');
  assert.equal(v.ok, false);
});

test('summaries are NOT_APPLICABLE, not NOT_RUN', () => {
  const v = validateActionProvenance('Backend engineer with 5 years of experience.',
    ev('Worked on services.'), { kind: 'summary' });
  assert.equal(v.status, 'NOT_APPLICABLE');
});


/* ================= A.1.1 predicate hardening ================= */

test('adverb-prefixed unsupported actions cannot hide from provenance', () => {
  const source = 'Worked on a Spring Boot service for internal ticket routing.';
  for (const invented of [
    'Successfully designed a Spring Boot service for internal ticket routing.',
    'Effectively developed a Spring Boot service for internal ticket routing.',
    'Independently deployed a Spring Boot service for internal ticket routing.',
    'Carefully architected a Spring Boot service for internal ticket routing.',
  ]) {
    const p = extractClaimedPredicate(invented);
    assert.ok(p.detected, invented);
    assert.notEqual(p.base, '', invented);
    assert.equal(verdict(source, invented), 'FAIL', invented);
  }
});

test('passive voice unsupported actions cannot hide from provenance', () => {
  const source = 'Worked on a Spring Boot service for internal ticket routing.';
  for (const invented of [
    'A Spring Boot service was designed for internal ticket routing.',
    'The Spring Boot service was successfully developed for internal ticket routing.',
    'A Spring Boot service has been deployed for internal ticket routing.',
    'The Spring Boot service was carefully architected for internal ticket routing.',
  ]) {
    const p = extractClaimedPredicate(invented);
    assert.equal(p.voice, 'PASSIVE', invented);
    assert.equal(verdict(source, invented), 'FAIL', invented);
  }
});

test('passive voice preserves an explicitly evidenced action', () => {
  const source = 'Designed the routing service for internal ticket handling.';
  const candidate = 'The routing service was designed for internal ticket handling.';
  assert.equal(extractClaimedPredicate(candidate).base, 'design');
  assert.equal(verdict(source, candidate), 'PASS');
  assert.equal(validateActionSemantics(candidate, ev(source)).status, 'PASS');
});

test('combined truth gate blocks adverb and passive action-provenance bypasses', () => {
  const source = ev('Worked on a Spring Boot service for internal ticket routing.');
  for (const candidate of [
    'Successfully designed a Spring Boot service for internal ticket routing.',
    'A Spring Boot service was designed for internal ticket routing.',
  ]) {
    const v = validateAgainstEvidence(candidate, source, { ownershipCeiling: 8 });
    assert.equal(v.ok, false, candidate);
    assert.equal(v.verdicts.actionProvenance, 'FAIL', candidate);
    assert.ok(v.violations.some((x) => x.code === 'unsupported_action_claim'), candidate);
  }
});

test('contribution-safe composer restores the source determiner', () => {
  const out = composeCandidates(ev('Worked on a Spring Boot service for internal ticket routing.'), {
    roleFamily: 'backend', seniority: 'mid', intent: 'delivery',
    userKey: 'prov-article', ownershipCeiling: 8,
  });
  const contribution = out.accepted.filter((c) => c.strategy === 'contribution_safe').map((c) => c.text);
  assert.ok(contribution.some((t) => /^Contributed to a Spring Boot service\b/i.test(t)), contribution.join('\n'));
  assert.ok(!contribution.some((t) => /^Contributed to Spring Boot service\b/i.test(t)), contribution.join('\n'));
});

test('worked-on contribution wording prefers contribution language and never overstates operational support', () => {
  const out = composeCandidates(ev('Worked on a Spring Boot service for internal ticket routing.'), {
    roleFamily: 'backend', seniority: 'mid', intent: 'delivery',
    userKey: 'prov-support', ownershipCeiling: 8,
  });
  const contribution = out.accepted.filter((c) => c.strategy === 'contribution_safe').map((c) => c.text);
  assert.ok(contribution.some((t) => /^Contributed to a Spring Boot service\b/i.test(t)), contribution.join('\n'));
  assert.ok(!contribution.some((t) => /^Supported(?: work on)? a Spring Boot service\b/i.test(t)), contribution.join('\n'));
});

test('worked-with association cannot become an unsupported support claim', () => {
  const evidence = { rawText: 'Worked with AWS EC2 for deployment environments.', object: 'AWS EC2 for deployment environments', action: '', actionBase: '' };
  const p = classifyActionProvenance(evidence);
  assert.ok(p.authorized.includes('work'));
  assert.ok(!p.authorized.includes('support'));
  const verdict = validateActionProvenance('Supported AWS EC2 for deployment environments.', evidence, { kind: 'bullet' });
  assert.equal(verdict.status, 'FAIL');
});
