// Market-Readiness Gap Sprint — dependency-free unit tests.
// Pure engine logic only (no server boot, DB or network), so this file
// runs under plain `node --test` without npm install.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateProjectBlueprint, blueprintSignature } from '../server/services/synthesisIntelligence/blueprintGenerator.js';
import { stableHash, seedFromContext, applyBlueprintVariation } from '../server/services/synthesisIntelligence/variationEngine.js';
import { PROFILE_SECTION_VARIANTS, DOMAIN_PROFILES } from '../server/services/synthesisIntelligence/domainProfiles.js';
import { scorePatentIdea, STUFFING_REASON } from '../server/utils/patentScoringEngine.js';
import { searchLivePriorArt, priorArtQueryTerms, _clearLivePriorArtCache } from '../server/services/problemIntelligence/livePriorArtService.js';
import { auditAtsCompatibility } from '../server/utils/resume/atsAuditEngine.js';
import { matchResumeToJD } from '../server/utils/resume/jdMatchEngine.js';
import { buildResumeDocHTML, sanitizeCssForAts } from '../web/src/lib/resumeRenderer.js';
import { RESUME_FIXTURES } from '../web/src/lib/resumeFixtures.js';
import { mergeProjects } from '../web/src/lib/projectSync.js';

/* ============================================================
   PHASE 2 — output variety at scale
   ============================================================ */

const classification = { domain: 'healthcare', subdomain: 'remote patient monitoring', difficulty: 'intermediate', projectType: 'web app', intent: 'portfolio' };
const brief = { _meta: { mechanismName: 'vitals anomaly detection pipeline', title: 'Vitals Watch' } };

test('variant pools ship ≥3 concrete variants per section', () => {
  for (const key of ['milestonePhrasings', 'architectureEmphasis', 'proofChecklistExtras']) {
    assert.ok(PROFILE_SECTION_VARIANTS[key].length >= 3, `${key} needs ≥3 variants`);
  }
  // every profile carries ≥3 mechanisms → mechanism-emphasis pool is ≥3 everywhere
  for (const [key, p] of Object.entries(DOMAIN_PROFILES)) {
    assert.ok((p.mechanisms || []).length >= 3, `profile ${key} needs ≥3 mechanisms`);
  }
  // variants are concrete (parameterized functions produce real content, no filler)
  const line = PROFILE_SECTION_VARIANTS.architectureEmphasis[1]('scoring engine');
  assert.ok(line.includes('scoring engine') && line.length > 40);
});

test('uniqueness regression: two projects, same domain, same user → blueprintSignature differs', () => {
  const a = generateProjectBlueprint({ classification, brief, query: 'patient vitals monitor', seedContext: { userId: 'u1', projectId: 'p1', title: 'Vitals Watch' } });
  const b = generateProjectBlueprint({ classification, brief, query: 'patient vitals monitor', seedContext: { userId: 'u1', projectId: 'p2', title: 'Ward Guardian' } });
  assert.notEqual(blueprintSignature(a), blueprintSignature(b), 'same-domain projects must not share a signature');
});

test('uniqueness regression: same project regenerated → byte-identical', () => {
  const ctx = { userId: 'u1', projectId: 'p1', title: 'Vitals Watch' };
  const a = generateProjectBlueprint({ classification, brief, query: 'patient vitals monitor', seedContext: ctx });
  const b = generateProjectBlueprint({ classification, brief, query: 'patient vitals monitor', seedContext: ctx });
  assert.deepEqual(a, b, 'same seed must regenerate identical output');
  assert.equal(blueprintSignature(a), blueprintSignature(b));
});

test('no seedContext → blueprint is unchanged legacy output (no variant metadata)', () => {
  const legacy = generateProjectBlueprint({ classification, brief, query: 'patient vitals monitor' });
  assert.equal(legacy._meta.variant, undefined, 'legacy path must carry no variant');
  assert.ok(legacy.milestones.every((m) => /^M\d+:/.test(m)), 'legacy milestone phrasing preserved');
});

test('variation engine: stable hash + section independence', () => {
  assert.equal(stableHash('abc'), stableHash('abc'));
  assert.notEqual(stableHash('abc'), stableHash('abd'));
  assert.equal(seedFromContext({ userId: 'u', projectId: 'p', title: 'T' }), seedFromContext({ userId: 'u', projectId: 'p', title: 't ' }));
  const profile = DOMAIN_PROFILES.healthcare;
  const bp = { architecture: ['x'], milestones: ['M1: a', 'M2: b'], proofChecklist: ['p'], _meta: {} };
  const varied = applyBlueprintVariation({ blueprint: bp, profile, mechanismName: 'm', seedContext: { userId: 'u', projectId: 'p', title: 'T' } });
  assert.equal(varied.architecture.length, 2, 'one architecture emphasis line appended');
  assert.equal(varied.proofChecklist.length, 2, 'one proof item appended');
  assert.ok(varied._meta.variant.mechanismEmphasis.length > 0);
});

/* ============================================================
   PHASE 3 — patent trust (anti-gaming + triage)
   ============================================================ */

const cleanIdea = {
  title: 'Proof-weighted skill-credibility graph',
  problem: 'recruiters cannot trust self-claimed skills',
  proposedSolution: 'updates candidate skill credibility from multiple proof sources',
  technicalMechanism: 'a graph algorithm fusing repository behavior, deployment verification, peer validation and recruiter outcome feedback into adaptive per-skill credibility weights with anomaly detection',
  processingLogic: 'ingest, normalize, reliability-weight, propagate through skill graph, recompute',
  inputData: 'commits, deploy logs, endorsements', outputResult: 'real-time credibility score with confidence',
  feedbackLoop: 'recruiter outcomes recalibrate source weights',
  noveltyAngle: 'multi-source proof fusion with outcome-driven adaptive weighting',
  marketUseCase: 'reduces mis-hires by 30%', implementationPlan: 'graph DB + pipeline',
};

/* A pure keyword soup: dense mechanism keywords, repeated lists, no I/O,
   no processing logic — the exact pattern the cap targets. */
const stuffedIdea = {
  title: 'Ultimate AI engine',
  problem: 'everything is slow',
  proposedSolution: 'algorithm pipeline optimization detection classification prediction scoring weighting anomaly detection adaptive inference embedding graph algorithm pipeline optimization detection classification scoring weighting anomaly adaptive inference embedding graph algorithm pipeline optimization',
  technicalMechanism: 'algorithm, pipeline, feedback loop, data fusion, multi-source, real-time, detection, classification, prediction, optimization, graph, embedding, inference, scoring, weighting, anomaly, adaptive, algorithm, pipeline, detection, scoring, anomaly, adaptive, optimization',
};

test('keyword stuffing is detected, capped and explained', () => {
  const r = scorePatentIdea(stuffedIdea);
  assert.equal(r.stuffingDetected, true);
  assert.ok(r.factors.technicalDepth <= 35, `technicalDepth capped, got ${r.factors.technicalDepth}`);
  assert.ok(r.factors.specificity <= 35, `specificity capped, got ${r.factors.specificity}`);
  assert.ok(r.reasons.includes(STUFFING_REASON));
});

test('non-stuffed ideas never trip the cap and keep strong scores', () => {
  const r = scorePatentIdea(cleanIdea);
  assert.equal(r.stuffingDetected, false);
  assert.ok(!r.reasons.includes(STUFFING_REASON));
  assert.ok(r.overall >= 70, `clean idea stays strong, got ${r.overall}`);
});

test('stuffing detection is deterministic', () => {
  assert.deepEqual(scorePatentIdea(stuffedIdea), scorePatentIdea(stuffedIdea));
});

test('every score carries the triage block positioned as an estimate for human review', () => {
  for (const idea of [cleanIdea, stuffedIdea, { title: 'AI app for x', proposedSolution: 'an app' }]) {
    const r = scorePatentIdea(idea);
    assert.equal(r.positioning, 'patent-readiness estimate for faculty/IP-cell triage');
    assert.ok(r.triage.headline.includes('faculty/IP-cell triage'));
    assert.ok(Array.isArray(r.triage.strong) && Array.isArray(r.triage.missing));
    assert.ok(r.triage.nextHumanStep.length > 20, 'recommended next human step is mandatory');
  }
});

test('live prior-art NEVER makes network calls under NODE_ENV=test', async () => {
  _clearLivePriorArtCache();
  const r = await searchLivePriorArt({ title: 'edge anomaly detection', technicalMechanism: 'streaming pipeline' });
  assert.equal(r.skipped, 'test_mode');
  assert.deepEqual(r.candidates, []);
});

test('prior-art query terms are deterministic and bounded', () => {
  const idea = { title: 'Adaptive vitals anomaly pipeline', technicalMechanism: 'rolling baseline detection with explainable alerts' };
  assert.equal(priorArtQueryTerms(idea), priorArtQueryTerms(idea));
  assert.ok(priorArtQueryTerms(idea).split(' ').length <= 8);
  assert.equal(priorArtQueryTerms({}), '');
});

/* ============================================================
   PHASE 4 — Resume OS: ATS audit, JD match, DOCX fidelity
   ============================================================ */

const GOOD_RESUME = `KAMAL SHARMA
kamal.sharma@example.com | +91 9876543210 | Pune, India

SUMMARY
Cloud Data Engineer with 3 years building AWS data platforms in BFSI.

EXPERIENCE
Cloud Data Engineer — Barclays, Pune
Jan 2023 – Present
• Built PySpark pipelines on AWS EMR processing 2TB daily with 40% lower runtime
• Migrated 14 Hadoop workloads to AWS Glue and Iceberg with zero data loss
• Automated Snowflake warehouse cost controls saving 18% monthly spend

EDUCATION
B.E. Computer Engineering, Pune University, 2021

SKILLS
AWS, PySpark, Snowflake, Apache Iceberg, SQL, Python, Airflow`;

const BAD_RESUME = `kamal
creative profile!!
did stuff at a bank
• coded
• worked on many different things across many different teams in many different cities while also doing many other unrelated activities that go on and on without any measurable outcome or technology named anywhere at all in this line
contact me on social media`;

test('ATS audit: known-good resume scores high with no header/contact fixes', () => {
  const r = auditAtsCompatibility({ text: GOOD_RESUME });
  assert.ok(r.score >= 85, `expected ATS-ready, got ${r.score}`);
  assert.ok(!r.fixes.some((f) => f.includes('email')), 'email must be detected');
  assert.ok(r.checks.find((c) => c.id === 'dates_parseable').passed);
});

test('ATS audit: known-bad resume scores low with specific fixes', () => {
  const r = auditAtsCompatibility({ text: BAD_RESUME });
  assert.ok(r.score < 55, `expected low score, got ${r.score}`);
  assert.ok(r.fixes.length >= 3, 'must return concrete fixes');
  assert.ok(r.fixes.some((f) => /email/i.test(f)));
  assert.ok(r.fixes.some((f) => /dates/i.test(f)));
});

test('ATS audit: layout flags penalize tables/columns/images deterministically', () => {
  const clean = auditAtsCompatibility({ text: GOOD_RESUME });
  const tabled = auditAtsCompatibility({ text: GOOD_RESUME, structure: { usesTables: true, usesColumns: true, usesImages: true } });
  assert.ok(tabled.score < clean.score);
  assert.ok(tabled.fixes.some((f) => /tables/i.test(f)));
  assert.deepEqual(tabled, auditAtsCompatibility({ text: GOOD_RESUME, structure: { usesTables: true, usesColumns: true, usesImages: true } }));
});

test('JD match: matched / weak / missing with evidence, provable gaps flagged', () => {
  const jd = `Job Title: Data Engineer
Requirements: AWS, PySpark, Snowflake, Kafka and Airflow experience required.
Preferred / nice to have: Databricks.`;
  const r = matchResumeToJD({ resumeText: GOOD_RESUME, jobDescription: jd, targetRole: 'Data Engineer', verifiedSkills: ['Kafka'] });
  const names = (list) => list.map((x) => x.skill.toLowerCase());
  assert.ok(names(r.matched).includes('aws'), 'aws evidenced in experience');
  assert.ok(names(r.missing).includes('kafka'), 'kafka absent from resume');
  const kafka = r.missing.find((m) => m.skill.toLowerCase() === 'kafka');
  assert.equal(kafka.verified, true);
  assert.ok(kafka.fix.startsWith('add this — you can prove it'), 'verified gap gets the proof-moat flag');
  assert.ok(r.provableGaps.map((s) => s.toLowerCase()).includes('kafka'));
  assert.ok(r.coverage >= 0 && r.coverage <= 100);
});

test('JD match: weak skills (skills-list only) get an evidence fix, deterministic output', () => {
  const resume = GOOD_RESUME + '\nKafka';
  const jd = 'Requirements: Kafka required for streaming pipelines and event processing systems.';
  const r = matchResumeToJD({ resumeText: resume, jobDescription: jd });
  const weak = r.weak.find((w) => w.skill.toLowerCase() === 'kafka');
  assert.ok(weak, 'kafka in skills area only → weak');
  assert.ok(/back it with a bullet/i.test(weak.fix));
  assert.deepEqual(r, matchResumeToJD({ resumeText: resume, jobDescription: jd }));
});

test('DOCX snapshot: ATS template doc is single-column, table-free, standard fonts, sections in order', () => {
  const fixture = RESUME_FIXTURES.find((f) => f.id === 'mid-developer');
  const html = buildResumeDocHTML(fixture.data, 'jake-ats-classic');
  // no tables / text boxes anywhere in the ATS document
  assert.ok(!/<table/i.test(html), 'no <table> in ATS export');
  assert.ok(!/v:textbox/i.test(html), 'no text boxes in ATS export');
  // no multi-column or grid CSS survives sanitization
  assert.ok(!/column-count\s*:/i.test(html), 'no column-count');
  assert.ok(!/display\s*:\s*grid/i.test(html), 'no grid layout');
  // standard embedded font stack
  assert.ok(/font-family:\s*Arial, Helvetica/.test(html), 'standard font stack pinned');
  // required sections present and in order
  const low = html.toLowerCase();
  const order = ['summary', 'skills', 'experience', 'projects', 'education'];
  const positions = order.map((s) => low.indexOf(s));
  for (let i = 0; i < positions.length; i++) assert.ok(positions[i] > -1, `section ${order[i]} present`);
  for (let i = 1; i < positions.length; i++) assert.ok(positions[i] > positions[i - 1], `${order[i]} after ${order[i - 1]}`);
  // snapshot stability: same input → same document
  assert.equal(html, buildResumeDocHTML(fixture.data, 'jake-ats-classic'));
});

test('sanitizeCssForAts strips parser-breaking layout constructs only', () => {
  const css = '.a{column-count:2;color:red}.b{display:grid;grid-template-columns:1fr 1fr}.c{float:left;font-size:12px}';
  const out = sanitizeCssForAts(css);
  assert.ok(!out.includes('column-count') && !out.includes('grid-template-columns') && !out.includes('float:left'));
  assert.ok(out.includes('color:red') && out.includes('font-size:12px'), 'non-layout styles preserved');
});

/* ============================================================
   PHASE 1 — client merge semantics (pure function)
   ============================================================ */

test('project sync merge: last-write-wins per project by updatedAt, local-only kept', () => {
  const local = [
    { id: 'a', title: 'local-newer', updatedAt: '2026-06-10T10:00:00Z' },
    { id: 'b', title: 'local-older', updatedAt: '2026-06-01T10:00:00Z' },
    { id: 'c', title: 'local-only', updatedAt: '2026-06-05T10:00:00Z' },
  ];
  const server = [
    { id: 'a', title: 'server-older', updatedAt: '2026-06-09T10:00:00Z' },
    { id: 'b', title: 'server-newer', updatedAt: '2026-06-08T10:00:00Z' },
    { id: 'd', title: 'server-only', updatedAt: '2026-06-07T10:00:00Z' },
  ];
  const merged = mergeProjects(local, server);
  const byId = Object.fromEntries(merged.map((p) => [p.id, p.title]));
  assert.equal(byId.a, 'local-newer');
  assert.equal(byId.b, 'server-newer');
  assert.equal(byId.c, 'local-only');
  assert.equal(byId.d, 'server-only');
  assert.equal(merged[0].id, 'a', 'sorted newest first');
});
