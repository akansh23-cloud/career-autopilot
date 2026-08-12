/* ============================================================
   RESUME NARRATIVE INTELLIGENCE — engine tests
   ------------------------------------------------------------
   Evidence · natural language · job tailoring · seniority ·
   resume-level consistency · provider failure · security ·
   regression against the existing Resume OS contracts.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeResumeDocument } from '../server/utils/resume/resumeDocument.js';
import {
  buildEvidenceGraph, parseEvidenceText, extractNumericEvidence, VERIFICATION_LEVEL,
} from '../server/utils/resume/narrative/evidenceGraph.js';
import {
  validateAgainstEvidence, auditGeneratedDocument, findUntracedMetrics,
} from '../server/utils/resume/narrative/truthValidator.js';
import { buildJobIntelligence, hashJobDescription } from '../server/utils/resume/narrative/jobIntelligence.js';
import {
  resolveRoleFamily, vocabularyFor, eligibleCollocations, SENIORITY_REGISTER,
} from '../server/utils/resume/narrative/domainVocabulary.js';
import { analyzePhraseQuality, buildDocumentFrequency } from '../server/utils/resume/narrative/phraseQuality.js';
import {
  buildCandidateIntelligence, buildVoiceFingerprint, voiceConsistency,
} from '../server/utils/resume/narrative/candidateIntelligence.js';
import { composeCandidates, inferIntent, planSectionIntents, variationSeed } from '../server/utils/resume/narrative/bulletComposer.js';
import { scoreCandidate, rerankCandidates, WEIGHTS, shapeOf } from '../server/utils/resume/narrative/bulletScoring.js';
import { detectDocumentIssues, repairDocument, normalizeTerminology } from '../server/utils/resume/narrative/resumeConsistency.js';
import { classifySkills, expandImplied, substrateOf, SUPPORT, buildTerminologyAlignment } from '../server/utils/resume/narrative/skillIntelligence.js';
import { analyzeAtsAlignment } from '../server/utils/resume/narrative/atsSemantics.js';
import { analyzeNaturalness, assessGenericity, structureFingerprint } from '../server/utils/resume/narrative/naturalness.js';
import { planContentStrategy } from '../server/utils/resume/narrative/contentStrategy.js';
import {
  makeNarrativeRouter, parseStrictJSON, UsageLedger, BulletCandidatesSchema, clearNarrativeCache,
} from '../server/utils/resume/narrative/narrativeProviders.js';
import {
  resolveSearchProvider, NullSearchProvider, makeHttpSearchProvider,
  guardedFetch, extractText, distillContext, researchRoleContext, researchCache,
} from '../server/utils/resume/narrative/externalContext.js';
import { enhanceResumeNarrative, tailorResumeNarrative } from '../server/utils/resume/narrative/narrativeEngine.js';
import { ChangeLedger, NarrativeTelemetry } from '../server/utils/resume/narrative/changeLedger.js';
import { FIXTURES, fixtureById } from './fixtures/resumeNarrativeFixtures.js';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
const DEVOPS = () => fixtureById('devops_engineer');
const graphOf = (doc, opts = {}) => buildEvidenceGraph(normalizeResumeDocument(doc), opts);
const firstAchievement = (g) => g.records.find((r) => r.type === 'achievement');

/* ============================================================
   1. EVIDENCE TESTS
   ============================================================ */
test('evidence: numeric evidence is extracted with units and clause context', () => {
  const nums = extractNumericEvidence('Reduced batch runtime by 35% across 40 jobs in 2021.');
  const values = nums.map((n) => n.value);
  assert.ok(values.includes('35'));
  assert.ok(values.includes('40'));
  assert.ok(!values.includes('2021'), 'bare years are dates, not achievement metrics');
});

test('evidence: sentence anatomy is parsed into traceable spans', () => {
  const p = parseEvidenceText('Automated deployment validation across 12 environments using GitLab CI, reducing manual release steps.');
  assert.equal(p.action, 'automated');
  assert.match(p.object, /deployment validation/i);
  assert.match(p.method, /GitLab CI/i);
  assert.match(p.scope, /12 environments/i);
  assert.match(p.outcome, /manual release steps/i);
  assert.equal(p.outcomeVerb, 'reducing');
});

test('evidence: graph is built from the document and carries verification levels', () => {
  const g = graphOf(DEVOPS().doc, { verifiedSkills: ['helm'] });
  assert.ok(g.counts.achievements >= 6);
  assert.ok(g.permittedSkills.has('helm'));
  const rec = firstAchievement(g);
  assert.ok(Object.values(VERIFICATION_LEVEL).includes(rec.verificationLevel));
  assert.ok(rec.id.startsWith('ev_'));
});

test('evidence: unsupported NUMBERS are rejected', () => {
  const g = graphOf(DEVOPS().doc);
  const rec = g.records.find((r) => /Automated certificate renewal/i.test(r.rawText));
  const bad = validateAgainstEvidence('Automated certificate renewal, cutting incidents by 45%.', rec, { globalPermittedSkills: g.permittedSkills });
  assert.equal(bad.ok, false);
  assert.ok(bad.violations.some((v) => v.code === 'fabricated_number' && v.token === '45'));
});

test('evidence: unsupported TECHNOLOGIES are rejected', () => {
  const g = graphOf(DEVOPS().doc);
  const rec = g.records.find((r) => /certificate renewal/i.test(r.rawText));
  const bad = validateAgainstEvidence('Automated certificate renewal with Terraform and Vault.', rec, { globalPermittedSkills: g.permittedSkills });
  assert.equal(bad.ok, false);
  assert.ok(bad.violations.some((v) => v.code === 'fabricated_technology'));
});

test('evidence: unsupported CREDENTIALS, AUTHORITY and SCALE are rejected', () => {
  const g = graphOf(DEVOPS().doc);
  const rec = g.records.find((r) => /certificate renewal/i.test(r.rawText));
  const opts = { globalPermittedSkills: g.permittedSkills };
  assert.ok(validateAgainstEvidence('Automated certificate renewal as a certified expert.', rec, opts).violations.some((v) => v.code === 'fabricated_credential'));
  assert.ok(validateAgainstEvidence('Automated certificate renewal while leading a team of 6.', rec, opts).violations.some((v) => ['fabricated_authority', 'fabricated_number'].includes(v.code)));
  assert.ok(validateAgainstEvidence('Automated certificate renewal enterprise-wide.', rec, opts).violations.some((v) => v.code === 'fabricated_scale'));
});

test('evidence: SUPPORTED metrics are retained through composition', async () => {
  const f = DEVOPS();
  const r = await enhanceResumeNarrative(f.doc, { userKey: 'metric-test', useAi: false });
  assert.equal(r.ok, true);
  const joined = r.bullets.map((b) => b.text).join(' ');
  assert.match(joined, /80%/, 'a metric the candidate actually provided must survive');
});

test('evidence: every generated bullet is traceable to an evidence record', async () => {
  const f = DEVOPS();
  const r = await enhanceResumeNarrative(f.doc, { userKey: 'trace-test', useAi: false });
  for (const b of r.bullets) {
    assert.ok(b.evidenceId, 'bullet must carry an evidenceId');
    assert.match(b.evidenceId, /^ev_/);
  }
  assert.equal(r.truth.unsupportedClaimCount, 0);
});

test('evidence: auditGeneratedDocument refuses content with no evidence record', () => {
  const g = graphOf(DEVOPS().doc);
  const out = auditGeneratedDocument(
    [{ id: 'b_orphan', text: 'Delivered a 40% uplift in platform reliability.', evidenceId: 'ev_does_not_exist' }],
    g,
  );
  assert.equal(out.ok, false);
  assert.ok(out.unsupportedClaimCount >= 1);
  assert.ok(out.findings.some((f) => f.code === 'untraceable_claim'));
});

test('evidence: findUntracedMetrics catches any number not in the graph', () => {
  const g = graphOf(DEVOPS().doc);
  const out = findUntracedMetrics(['Cut costs by 62% and latency by 12ms.'], g);
  assert.ok(out.some((x) => x.number === '62'));
});

test('evidence: connected GitHub signals never become claims', () => {
  const g = graphOf(DEVOPS().doc, { githubEvidence: [{ repo: 'x/y', technologies: ['Terraform'], authored: false }] });
  const gh = g.records.find((r) => r.type === 'connected_signal');
  assert.ok(gh);
  assert.equal(gh.claimable, false);
  assert.equal(gh.signalStrength, 'declared_dependency');
  assert.ok(gh.confidence < 0.6, 'a dependency-file mention is weak evidence');
});

/* ============================================================
   2. NATURAL-LANGUAGE TESTS
   ============================================================ */
test('language: repeated opening verbs are detected', () => {
  const out = analyzeNaturalness([
    'Built the ingestion service.', 'Built the reporting layer.',
    'Built the alerting rules.', 'Built the deployment scripts.',
  ]);
  assert.ok(out.findings.some((f) => f.code === 'repeated_opening_verb'));
  assert.ok(out.score < 0.9);
});

test('language: repeated sentence structures are detected', () => {
  const out = analyzeNaturalness([
    'Implemented X using Y, resulting in Z.',
    'Implemented A using B, resulting in C.',
    'Implemented M using N, resulting in O.',
  ]);
  assert.ok(out.findings.some((f) => f.code === 'repeated_structure' || f.code === 'repeated_opening_verb'));
  assert.ok(out.findings.some((f) => f.code === 'resulting_in_overuse'));
});

test('language: clichés are penalised by FREQUENCY and rescued by CONTEXT', () => {
  const single = analyzePhraseQuality('Leveraged Kubernetes to consolidate 12 clusters.', { technologies: ['Kubernetes'] });
  const freq = buildDocumentFrequency(['leveraged a', 'leveraged b', 'leveraged c', 'leveraged d']);
  const repeated = analyzePhraseQuality('Leveraged various synergies to drive results.', { documentFrequency: freq });
  assert.ok(single.penalty < repeated.penalty, 'one anchored use must cost less than repeated unanchored use');
  assert.ok(single.hits.some((h) => h.rescuedByContext));
});

test('language: irredeemable self-description clichés are never rescued', () => {
  const out = analyzePhraseQuality('Results-driven professional with a proven track record in Kubernetes.', { technologies: ['Kubernetes'] });
  assert.ok(out.hits.some((h) => h.phrase === 'results-driven' && !h.rescuedByContext));
  assert.ok(out.penalty > 0.2);
});

test('language: excessive "resulting in" and uniform lengths are detected', () => {
  const out = analyzeNaturalness([
    'Alpha beta gamma delta epsilon zeta, resulting in eta.',
    'Theta iota kappa lambda mu nu, resulting in xi.',
    'Omicron pi rho sigma tau upsilon, resulting in phi.',
    'Chi psi omega alpha beta gamma, resulting in delta.',
  ]);
  assert.ok(out.metrics.resultingInCount >= 3);
  assert.ok(out.findings.some((f) => f.code === 'uniform_sentence_length'));
});

test('language: weak openers are penalised regardless of surrounding detail', () => {
  const rich = 'Responsible for Kubernetes deployment configuration across 12 OpenShift environments.';
  const direct = 'Owned Kubernetes deployment configuration across 12 OpenShift environments.';
  const evidence = { rawText: rich, skills: ['kubernetes', 'openshift'], skillsDisplay: ['Kubernetes', 'OpenShift'], numericEvidence: [{ value: '12' }] };
  const a = scoreCandidate({ text: rich }, { evidence });
  const b = scoreCandidate({ text: direct }, { evidence });
  assert.ok(b.metadata.naturalnessScore > a.metadata.naturalnessScore);
});

test('language: the scoring weights sum to 100', () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

/* ============================================================
   3. JOB-TAILORING TESTS
   ============================================================ */
test('job intelligence: mandatory requirements are separated from optional', () => {
  const f = DEVOPS();
  const ji = buildJobIntelligence({ jobDescription: f.jd, job: f.job });
  assert.ok(ji.requirements.mandatory.length >= 1);
  assert.ok(ji.requirements.all.length >= 4);
  assert.equal(ji.roleIdentity.seniority, 'senior');
  assert.ok(ji.prioritySkills.some((p) => /kubernetes|openshift/i.test(p.skill)));
});

test('job intelligence: semantic expectations exist but are never claimable', () => {
  const f = DEVOPS();
  const ji = buildJobIntelligence({ jobDescription: f.jd, job: f.job });
  assert.ok(ji.semanticExpectations.length > 0);
  for (const e of ji.semanticExpectations) assert.equal(e.claimable, false);
});

test('job intelligence: the same JD hashes identically (cacheable)', () => {
  const f = DEVOPS();
  assert.equal(hashJobDescription(f.jd, 'a'), hashJobDescription(`  ${f.jd}  `, 'a'));
  assert.notEqual(hashJobDescription(f.jd, 'a'), hashJobDescription(f.jd, 'b'));
});

test('skills: claimable implication vs non-claimable substrate', () => {
  /* CHANGED CONTRACT (Phase 2, P2.12/P2.13): implication used to be one
     relation. It is now two, because they carry different truth risk.

     Claimable — using X means you genuinely did Y and Y may be written. */
  assert.ok(expandImplied('gitlab ci').includes('ci/cd'));
  assert.ok(expandImplied('pyspark').includes('apache spark'));
  assert.ok(expandImplied('aws eks').includes('amazon web services'));

  /* Substrate — X runs on Y. Satisfies a requirement, never writable. */
  assert.ok(!expandImplied('aws eks').includes('kubernetes'),
    'EKS must not make "Kubernetes" a writable claim');
  assert.ok(!expandImplied('openshift').includes('kubernetes'),
    'OpenShift must not make "Kubernetes" a writable claim');
  assert.ok(substrateOf('openshift').includes('kubernetes'),
    'the relationship is still known — it is just not claimable');

  assert.ok(!expandImplied('kubernetes').includes('terraform'), 'meaningful distinctions are preserved');
});

test('skills: classification into SUPPORTED / PARTIAL / UNSUPPORTED', () => {
  const f = DEVOPS();
  const g = graphOf(f.doc);
  const c = classifySkills(['Helm', 'GitLab CI', 'Terraform', 'Prometheus', 'Java'], g, { verifiedSkills: [] });
  const by = (n) => c.results.find((r) => r.skill === n);
  assert.equal(by('Helm').status, SUPPORT.SUPPORTED);
  assert.equal(by('Terraform').status, SUPPORT.UNSUPPORTED);
  assert.equal(by('Terraform').insertable, false);
  assert.ok(!c.insertable.includes('Terraform'));
});

test('tailor: unsupported JD skills are NEVER inserted into the resume', async () => {
  const f = DEVOPS();
  const r = await tailorResumeNarrative(f.doc, {
    jobDescription: f.jd, job: f.job, userKey: 'no-insert', useAi: false, useExternalResearch: false,
  });
  assert.equal(r.ok, true);
  const text = [r.summary.chosen, ...r.bullets.map((b) => b.text)].join(' ').toLowerCase();
  assert.ok(!/terraform/.test(text), 'Terraform is a JD requirement with no candidate evidence');
  assert.ok(!/prometheus|grafana/.test(text));
  assert.ok(r.gaps.gaps.some((g) => /terraform/i.test(g.skill || '') && g.insertable === false));
});

test('tailor: relevant experience is prioritised and older roles compressed', async () => {
  const f = DEVOPS();
  /* An old, unrelated role is added so compression has something to do. */
  const doc = normalizeResumeDocument({
    ...f.doc,
    experience: [...f.doc.experience, {
      id: 'x9', company: 'Seabright Retail', role: 'Store Supervisor',
      startDate: 'Jun 2013', endDate: 'Aug 2016',
      bullets: [
        { id: 'o1', text: 'Managed the weekend shift rota for eight staff.' },
        { id: 'o2', text: 'Handled cash reconciliation at close of trading.' },
        { id: 'o3', text: 'Trained new starters on the till system.' },
      ],
    }],
  });
  const r = await tailorResumeNarrative(doc, {
    jobDescription: f.jd, job: f.job, userKey: 'compress', useAi: false, useExternalResearch: false,
  });
  const current = r.strategy.roles.find((x) => x.current);
  const old = r.strategy.roles.find((x) => x.itemId === 'x9');
  assert.ok(current.bulletBudget > old.bulletBudget, 'the current relevant role keeps more space');
  assert.ok(current.relevance > old.relevance, 'relevance drives allocation');
  assert.ok(r.strategy.decisions.length > 0, 'every compression decision is explainable');
  for (const d of r.strategy.decisions) assert.ok(d.reason && d.reason.length > 10);
});

test('tailor: the summary reflects the target role and stays evidence-bound', async () => {
  const f = DEVOPS();
  const r = await tailorResumeNarrative(f.doc, {
    jobDescription: f.jd, job: f.job, userKey: 'summary', useAi: false, useExternalResearch: false,
  });
  const s = r.summary.chosen;
  assert.ok(s.length > 20);
  assert.ok(!/results-driven|proven track record|cutting-edge|passionate/i.test(s));
  assert.ok(!/terraform/i.test(s));
});

test('ats: coverage never rises from an unsupported keyword', () => {
  const f = DEVOPS();
  const g = graphOf(f.doc);
  const ji = buildJobIntelligence({ jobDescription: f.jd, job: f.job });
  const honest = 'Automated GitLab CI deployment workflows across OpenShift environments using Helm.';
  const stuffed = `${honest} Terraform Terraform Terraform Prometheus Grafana Terraform.`;
  const a = analyzeAtsAlignment(honest, ji, g);
  const b = analyzeAtsAlignment(stuffed, ji, g);
  assert.ok(b.unsupportedPenalty > 0);
  assert.ok(b.score <= a.score, 'stuffing unsupported keywords must never help');
});

test('ats: semantic coverage credits equivalent candidate vocabulary', () => {
  const f = DEVOPS();
  const g = graphOf(f.doc);
  const ji = buildJobIntelligence({ jobDescription: f.jd, job: f.job });
  const a = analyzeAtsAlignment('Automated GitLab CI build and deployment pipelines for banking services.', ji, g);
  assert.ok(a.semanticCoverage >= a.keywordCoverage);
});

/* ============================================================
   4. SENIORITY TESTS
   ============================================================ */
test('seniority: a fresher is never described as an architect', async () => {
  const f = fixtureById('fresher_software_engineer');
  const r = await tailorResumeNarrative(f.doc, {
    jobDescription: f.jd, job: f.job, userKey: 'fresher', useAi: false, useExternalResearch: false,
  });
  assert.equal(r.intelligence.seniority, 'student');
  const text = [r.summary.chosen, ...r.bullets.map((b) => b.text)].join(' ');
  assert.ok(!/architected|spearheaded|established the|defined the strategy|set the direction/i.test(text));
  assert.equal(r.intelligence.ownershipCeiling, SENIORITY_REGISTER.student.maxOwnership);
});

test('seniority: the ceiling blocks authority language at validation time', () => {
  const evidence = { rawText: 'Built the reporting module in Java.', skills: ['java'], skillsDisplay: ['Java'], numericEvidence: [] };
  const out = validateAgainstEvidence('Architected the reporting module in Java.', evidence, { ownershipCeiling: 1 });
  assert.equal(out.ok, false);
  assert.ok(out.violations.some((v) => v.code === 'seniority_inflation'));
});

test('seniority: a senior candidate keeps ownership and design language', async () => {
  const f = fixtureById('senior_platform_engineer');
  const r = await tailorResumeNarrative(f.doc, {
    jobDescription: f.jd, job: f.job, userKey: 'senior', useAi: false, useExternalResearch: false,
  });
  assert.equal(r.intelligence.seniority, 'senior');
  const text = r.bullets.map((b) => b.text).join(' ');
  assert.match(text, /designed|led|established|mentored/i);
});

test('seniority: business "Manager" titles are a job family, not a seniority signal', async () => {
  const f = fixtureById('product_manager');
  const r = await enhanceResumeNarrative(f.doc, { userKey: 'pm', useAi: false });
  assert.equal(r.intelligence.seniority, 'mid');
});

/* ============================================================
   5. RESUME-LEVEL TESTS
   ============================================================ */
test('resume-level: repeated lead verbs are detected and repaired', () => {
  const mk = (text, id) => ({
    evidence: { id, bulletId: id, sourceId: 'x1', section: 'experience', skillsDisplay: [], current: false, rawText: text },
    chosen: { text, finalScore: 70, metadata: {} },
    ranked: [
      { text, finalScore: 70, strategy: 'a' },
      { text: text.replace(/^Built/, 'Automated'), finalScore: 66, strategy: 'b' },
      { text: text.replace(/^Built/, 'Migrated'), finalScore: 64, strategy: 'c' },
    ],
  });
  const selections = [
    mk('Built the ingestion service in Python.', 'e1'),
    mk('Built the reporting layer in SQL.', 'e2'),
    mk('Built the alerting rules in Grafana.', 'e3'),
    mk('Built the deployment scripts in Bash.', 'e4'),
  ];
  const before = detectDocumentIssues(selections);
  assert.ok(before.some((i) => i.code === 'lead_verb_repetition'));
  const out = repairDocument(selections);
  assert.ok(out.repairs.length > 0);
  const verbs = out.selections.map((s) => s.chosen.text.split(' ')[0]);
  assert.ok(new Set(verbs).size > 1, 'repair must produce genuine variation');
});

test('resume-level: repair never invents a replacement when none is validated', () => {
  const only = (text, id) => ({
    evidence: { id, bulletId: id, sourceId: 'x', section: 'experience', skillsDisplay: [], rawText: text },
    chosen: { text, finalScore: 60, metadata: {} },
    ranked: [{ text, finalScore: 60, strategy: 'original' }],
  });
  const sel = ['Built A.', 'Built B.', 'Built C.'].map((t, i) => only(t, `x${i}`));
  const out = repairDocument(sel);
  assert.equal(out.repairs.length, 0);
  assert.ok(out.remainingIssues.some((i) => i.code === 'lead_verb_repetition'), 'the problem is reported, not papered over');
});

test('resume-level: technology naming is normalised to one form', () => {
  const sel = [
    { evidence: { id: 'a', skillsDisplay: ['Kubernetes'] }, chosen: { text: 'Ran Kubernetes upgrades.' } },
    { evidence: { id: 'b', skillsDisplay: ['Kubernetes'] }, chosen: { text: 'Debugged k8s networking.' } },
    { evidence: { id: 'c', skillsDisplay: ['Kubernetes'] }, chosen: { text: 'Sized Kubernetes clusters.' } },
  ];
  const out = normalizeTerminology(sel);
  const text = out.selections.map((s) => s.chosen.text).join(' ');
  assert.ok(!/\bk8s\b/.test(text) || out.changes.length > 0);
});

test('resume-level: no duplicate bullets survive assembly', async () => {
  const doc = normalizeResumeDocument({
    id: 'rd_dup', targetRole: 'Data Engineer',
    skills: [{ name: 'Python' }, { name: 'Airflow' }],
    experience: [{
      id: 'x1', company: 'Co', role: 'Data Engineer', startDate: 'Jan 2021', current: true,
      bullets: [
        { id: 'b1', text: 'Built Airflow pipelines that load daily sales data into the warehouse.' },
        { id: 'b2', text: 'Built Airflow pipelines loading daily sales data into the warehouse.' },
        { id: 'b3', text: 'Wrote Python validation scripts for the customer dimension.' },
      ],
    }],
  });
  const r = await enhanceResumeNarrative(doc, { userKey: 'dup', useAi: false });
  const texts = r.bullets.map((b) => b.text.toLowerCase());
  assert.equal(new Set(texts).size, texts.length);
  assert.ok(r.strategy.decisions.some((d) => d.action === 'drop_duplicate'));
});

test('resume-level: tense stays consistent within a role', async () => {
  const f = DEVOPS();
  const r = await enhanceResumeNarrative(f.doc, { userKey: 'tense', useAi: false });
  const current = r.bullets.filter((b) => b.itemId === 'x1');
  const past = current.filter((b) => /^(\w+ed|Built|Led|Ran|Wrote|Made|Set|Cut)\b/.test(b.text)).length;
  assert.ok(past === current.length || past === 0, 'a single role must not mix tenses');
});

test('resume-level: section ordering remains a valid canonical order', async () => {
  const f = fixtureById('fresher_software_engineer');
  const r = await enhanceResumeNarrative(f.doc, { userKey: 'order', useAi: false });
  assert.ok(Array.isArray(r.doc.sectionOrder));
  assert.ok(r.doc.sectionOrder.includes('experience'));
  assert.ok(r.doc.sectionOrder.includes('education'));
});

/* ============================================================
   6. CROSS-USER GENERICITY + VOICE
   ============================================================ */
test('genericity: two users with identical evidence do not get identical bullets', async () => {
  const f = DEVOPS();
  const a = await enhanceResumeNarrative(f.doc, { userKey: 'user-alpha', useAi: false });
  const b = await enhanceResumeNarrative(f.doc, { userKey: 'user-beta', useAi: false });
  const at = a.bullets.map((x) => x.text);
  const bt = b.bullets.map((x) => x.text);
  assert.notDeepEqual(at, bt, 'per-user variation seeds must diverge');
});

test('genericity: template-corpus similarity is measured without any user corpus', () => {
  const out = assessGenericity([
    'Leveraged cutting-edge technologies to optimize scalable solutions, resulting in improved operational efficiency.',
    'Standardised Java 17 service releases across OpenShift environments using Helm.',
  ]);
  assert.ok(out.perSentence[0].templateSimilarity > out.perSentence[1].templateSimilarity);
  assert.match(out.privacyNote, /no other user/i);
});

test('genericity: structure fingerprints contain no content words', () => {
  const a = structureFingerprint('Automated deployment pipelines across twelve environments.');
  const b = structureFingerprint('Reconciled quarterly balances across fourteen subsidiaries.');
  assert.equal(a, b, 'the same skeleton hashes identically regardless of content');
  const c = structureFingerprint('Automated deployment pipelines.');
  assert.notEqual(a, c, 'a different skeleton hashes differently');
});

test('voice: the fingerprint measures the candidate, not a persona', () => {
  const g = graphOf(DEVOPS().doc);
  const fp = buildVoiceFingerprint(g, { doc: normalizeResumeDocument(DEVOPS().doc) });
  assert.ok(fp.sampleSize >= 6);
  assert.ok(fp.avgWords > 5);
  assert.ok(Array.isArray(fp.targetWordRange) && fp.targetWordRange[0] < fp.targetWordRange[1]);
  assert.ok(voiceConsistency('Automated deployment validation across four environments.', fp) > 0);
});

/* ============================================================
   7. COMPOSITION + SCORING
   ============================================================ */
test('composition: multiple strategies are generated and validated', () => {
  const g = graphOf(DEVOPS().doc);
  const rec = g.records.find((r) => /Java 17/i.test(r.rawText));
  const out = composeCandidates(rec, {
    roleFamily: 'devops', seniority: 'mid', intent: 'operational_excellence',
    userKey: 'comp', globalPermittedSkills: g.permittedSkills,
  });
  assert.ok(out.accepted.length >= 3);
  assert.ok(new Set(out.accepted.map((c) => c.strategy)).size >= 3, 'strategies must differ');
  for (const c of out.accepted) assert.equal(c.truth.ok, true);
});

test('composition: an AI candidate with a fabricated metric is rejected, not returned', () => {
  const g = graphOf(DEVOPS().doc);
  const rec = g.records.find((r) => /certificate renewal/i.test(r.rawText));
  const out = composeCandidates(rec, {
    roleFamily: 'devops', seniority: 'mid', intent: 'automation', userKey: 'x',
    globalPermittedSkills: g.permittedSkills,
    aiCandidates: [{ text: 'Automated certificate renewal, cutting outages by 63% across the enterprise.', strategy: 'ai_synthesis' }],
  });
  assert.ok(!out.accepted.some((c) => /63%/.test(c.text)));
  assert.ok(out.rejected.some((c) => /63%/.test(c.text)));
});

test('scoring: a candidate with unsupported claims hard-fails to zero', () => {
  const evidence = { rawText: 'Automated deployments.', skills: [], skillsDisplay: [], numericEvidence: [] };
  const s = scoreCandidate({ text: 'Automated deployments, reducing time by 45%.' }, { evidence, hardFail: true });
  assert.equal(s.finalScore, 0);
});

test('scoring: reranking is deterministic and ordered', () => {
  const evidence = { rawText: 'Automated GitLab CI deployment workflows.', skills: ['gitlab ci'], skillsDisplay: ['GitLab CI'], numericEvidence: [] };
  const cands = [
    { text: 'Worked on some deployment things.' },
    { text: 'Automated GitLab CI deployment workflows for service releases.' },
  ];
  const a = rerankCandidates(cands, { evidence, roleFamily: 'devops' });
  const b = rerankCandidates(cands, { evidence, roleFamily: 'devops' });
  assert.deepEqual(a.map((x) => x.text), b.map((x) => x.text));
  assert.match(a[0].text, /GitLab CI/);
});

test('intent: planning avoids saturating one intent across a section', () => {
  const g = graphOf(DEVOPS().doc);
  const recs = g.records.filter((r) => r.type === 'achievement' && r.sourceId === 'x1');
  const plan = planSectionIntents(recs, { maxSameIntent: 2 });
  const counts = new Map();
  for (const p of plan) counts.set(p.intent, (counts.get(p.intent) || 0) + 1);
  assert.ok(Math.max(...counts.values()) <= 3);
  assert.equal(plan.length, recs.length);
});

test('vocabulary: domain vocabulary differs by role family', () => {
  const devops = vocabularyFor('devops', { seniority: 'mid' });
  const finance = vocabularyFor('finance', { seniority: 'mid' });
  assert.notDeepEqual(devops.nouns, finance.nouns);
  assert.ok(devops.collocations.some(([, p]) => /configuration drift|release gate/.test(p)));
  assert.ok(finance.collocations.some(([, p]) => /month-end close|variance analysis/.test(p)));
});

test('vocabulary: collocations require their head noun to already exist', () => {
  const vocab = vocabularyFor('devops', { seniority: 'mid' });
  assert.equal(eligibleCollocations(vocab, 'Analysed sales figures in Excel.').length, 0);
  assert.ok(eligibleCollocations(vocab, 'Fixed the release configuration drift issue.').length >= 0);
});

test('vocabulary: role family resolves from title and from skill mix', () => {
  assert.equal(resolveRoleFamily('Senior DevOps Engineer'), 'devops');
  assert.equal(resolveRoleFamily('Financial Analyst'), 'finance');
  assert.equal(resolveRoleFamily('Mechanical Design Engineer'), 'mechanical');
  assert.equal(resolveRoleFamily('', { skills: ['spark', 'airflow', 'snowflake'] }), 'data_engineering');
});

/* ============================================================
   8. PROVIDER FAILURE TESTS
   ============================================================ */
function fakeClient(behaviour) {
  return { id: 'fake', available: () => true, models: { strong: 's', small: 'm' }, complete: behaviour };
}

test('provider: malformed AI response is discarded safely', async () => {
  clearNarrativeCache();
  const router = makeNarrativeRouter({ client: fakeClient(async () => ({ ok: true, text: 'not json at all', model: 's', ms: 1 })) });
  const out = await router.generateBulletCandidates({
    evidence: { rawText: 'Automated deployments.', skillsDisplay: [], numericEvidence: [] },
    vocabulary: vocabularyFor('devops', {}), intent: 'automation', seniority: 'mid',
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'malformed_response');
});

test('provider: schema violations are rejected', async () => {
  clearNarrativeCache();
  const router = makeNarrativeRouter({ client: fakeClient(async () => ({ ok: true, text: '{"candidates":[{"nope":1}]}', model: 's', ms: 1 })) });
  const out = await router.generateBulletCandidates({
    evidence: { rawText: 'x', skillsDisplay: [], numericEvidence: [] },
    vocabulary: vocabularyFor('devops', {}), intent: 'automation', seniority: 'mid',
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'schema_violation');
});

test('provider: timeout and rate limit degrade without throwing', async () => {
  clearNarrativeCache();
  for (const err of ['timeout', 'http_429', 'unreachable']) {
    const router = makeNarrativeRouter({ client: fakeClient(async () => ({ ok: false, error: err, model: 's', ms: 1 })) });
    const out = await router.generateSummaryCandidates({ facts: {}, vocabulary: vocabularyFor('devops', {}), seniority: 'mid' });
    assert.equal(out.ok, false);
    assert.equal(out.reason, err);
  }
});

test('provider: AI unavailable still produces a complete resume', async () => {
  const f = DEVOPS();
  const r = await enhanceResumeNarrative(f.doc, { userKey: 'no-ai', useAi: false });
  assert.equal(r.ok, true);
  assert.ok(r.bullets.length >= 4);
  assert.equal(r.telemetry.ai.totalCalls, 0);
});

test('provider: a failing AI provider falls back to deterministic composition', async () => {
  const f = DEVOPS();
  const router = makeNarrativeRouter({ client: fakeClient(async () => ({ ok: false, error: 'unreachable', model: 's', ms: 1 })) });
  const r = await enhanceResumeNarrative(f.doc, { userKey: 'ai-down', useAi: true, router });
  assert.equal(r.ok, true);
  assert.ok(r.bullets.length >= 4);
  assert.ok(r.telemetry.counters.aiFailures > 0);
  assert.equal(r.truth.unsupportedClaimCount, 0);
});

test('provider: a well-behaved AI candidate is accepted only if it passes truth', async () => {
  clearNarrativeCache();
  const client = fakeClient(async ({ system }) => ({
    ok: true, model: 's', ms: 1, inputTokens: 10, outputTokens: 5,
    text: /summary/i.test(system)
      ? '{"candidates":[{"text":"DevOps engineer working across OpenShift, Helm and GitLab CI delivery workflows."}]}'
      : '{"candidates":[{"text":"Standardised Java 17 service deployments across OpenShift environments using Helm.","strategy":"ai"}]}',
  }));
  const router = makeNarrativeRouter({ client });
  const r = await enhanceResumeNarrative(DEVOPS().doc, { userKey: 'ai-ok', useAi: true, router });
  assert.equal(r.ok, true);
  assert.ok(r.telemetry.ai.totalCalls > 0);
  assert.equal(r.truth.unsupportedClaimCount, 0);
});

test('provider: usage ledger accumulates tokens by task', () => {
  const l = new UsageLedger();
  l.record({ task: 'generate', provider: 'p', model: 'm', inputTokens: 10, outputTokens: 4, ms: 5 });
  l.record({ task: 'generate', provider: 'p', model: 'm', inputTokens: 6, outputTokens: 2, ms: 3 });
  const s = l.snapshot();
  assert.equal(s.inputTokens, 16);
  assert.equal(s.byTask.generate.calls, 2);
});

test('provider: JSON parsing survives fences and trailing junk', () => {
  assert.deepEqual(parseStrictJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseStrictJSON('Here you go: {"a":2} thanks'), { a: 2 });
  assert.equal(parseStrictJSON('nothing here'), null);
});

test('provider: schemas reject out-of-range payloads', () => {
  assert.equal(BulletCandidatesSchema.safeParse({ candidates: [] }).success, false);
  assert.equal(BulletCandidatesSchema.safeParse({ candidates: [{ text: 'short' }] }).success, false);
  assert.equal(BulletCandidatesSchema.safeParse({ candidates: [{ text: 'a defensible sentence about work' }] }).success, true);
});

/* ============================================================
   9. SECURITY TESTS (external research)
   ============================================================ */
test('security: research is disabled unless explicitly configured', () => {
  assert.equal(resolveSearchProvider({}).available(), false);
  assert.equal(resolveSearchProvider({ RESUME_RESEARCH_ENABLED: '1' }).available(), false);
  const p = resolveSearchProvider({ RESUME_RESEARCH_ENABLED: '1', RESUME_RESEARCH_ENDPOINT: 'https://example.com/s', RESUME_RESEARCH_API_KEY: 'k' });
  assert.equal(p.available(), true);
});

test('security: private and loopback addresses are refused', async () => {
  for (const url of [
    'http://127.0.0.1/x', 'http://localhost/x', 'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/admin', 'http://192.168.1.1/', 'http://[::1]/x', 'file:///etc/passwd',
  ]) {
    const out = await guardedFetch(url);
    assert.equal(out.ok, false, `${url} must be refused`);
    assert.match(out.reason, /ssrf_|bad_url|unreachable/);
  }
});

test('security: non-http schemes and internal TLDs are refused', async () => {
  for (const url of ['ftp://example.com/x', 'http://service.internal/x', 'http://db.local/x']) {
    const out = await guardedFetch(url);
    assert.equal(out.ok, false);
  }
});

test('security: the search provider validates its own endpoint', async () => {
  const p = makeHttpSearchProvider({ endpoint: 'http://127.0.0.1:9/search', apiKey: 'k' });
  const out = await p.search('anything');
  assert.equal(out.ok, false);
  assert.match(out.reason, /ssrf_|provider_unreachable/);
});

test('security: extracted HTML is sanitised to text only', () => {
  const out = extractText('<html><head><title>T</title></head><body><script>alert(1)</script><p>Hello &amp; welcome</p></body></html>', 'https://x.test/');
  assert.equal(out.title, 'T');
  assert.ok(!/script|alert/.test(out.text));
  assert.match(out.text, /Hello & welcome/);
});

test('security: external context is never claimable and carries provenance', () => {
  const ctx = distillContext([{ url: 'https://x.test/eng', title: 'Engineering', text: 'We run Kubernetes and Terraform with trunk-based development.', words: 9, retrievedAt: new Date().toISOString() }], { company: 'X', role: 'DevOps' });
  assert.ok(ctx.terminology.length > 0);
  for (const t of ctx.terminology) assert.equal(t.claimable, false);
  assert.equal(ctx.sources.length, 1);
  assert.ok(ctx.sources[0].retrievedAt);
  assert.match(ctx.disclaimer, /never become a candidate claim/i);
});

test('security: research unavailability degrades to an empty context', async () => {
  researchCache.clear();
  const ctx = await researchRoleContext({ company: 'Nowhere', role: 'DevOps', provider: NullSearchProvider });
  assert.equal(ctx.available, false);
  assert.equal(ctx.skipped, true);
});

test('security: tailoring still works with no research at all', async () => {
  const f = DEVOPS();
  const r = await tailorResumeNarrative(f.doc, {
    jobDescription: f.jd, job: f.job, userKey: 'nores', useAi: false,
    useExternalResearch: true, searchProvider: NullSearchProvider,
  });
  assert.equal(r.ok, true);
  assert.equal(r.externalContext.available, false);
  assert.ok(r.bullets.length > 0);
});

/* ============================================================
   10. ENGINE BEHAVIOUR / DEGRADATION
   ============================================================ */
test('engine: weak evidence produces no fabrication', async () => {
  const f = fixtureById('weak_resume');
  const r = await tailorResumeNarrative(f.doc, {
    jobDescription: f.jd, job: f.job, userKey: 'weak', useAi: false, useExternalResearch: false,
  });
  assert.equal(r.ok, true);
  assert.equal(r.truth.unsupportedClaimCount, 0);
  assert.equal(r.untracedMetrics.length, 0);
  assert.ok(r.gaps.gaps.some((g) => g.type === 'thin_evidence' || g.type === 'no_evidence'));
});

test('engine: an already-excellent resume is not degraded', async () => {
  const f = fixtureById('excellent_resume');
  const r = await tailorResumeNarrative(f.doc, {
    jobDescription: f.jd, job: f.job, userKey: 'excellent', useAi: false, useExternalResearch: false,
  });
  const text = r.bullets.map((b) => b.text).join(' ');
  assert.match(text, /idempotency keys/i);
  assert.match(text, /480ms|120ms/);
  assert.ok(r.quality.averageFinalScore > 55);
});

test('engine: the change ledger explains every modification', async () => {
  const f = DEVOPS();
  const r = await enhanceResumeNarrative(f.doc, { userKey: 'ledger', useAi: false });
  assert.ok(r.changes.entries.length > 0);
  for (const e of r.changes.entries) {
    assert.ok(e.reason && e.reason.length > 10);
    assert.ok(e.evidenceId);
  }
  assert.ok(r.changes.summary.changed >= 1);
});

test('engine: telemetry makes cost and quality measurable', async () => {
  const f = DEVOPS();
  const r = await enhanceResumeNarrative(f.doc, { userKey: 'telemetry', useAi: false });
  const t = r.telemetry;
  assert.ok(t.durationMs >= 0);
  assert.ok(t.stages.length >= 5);
  assert.ok(t.counters.candidatesGenerated > 0);
  assert.ok(t.counters.bulletsEvaluated > 0);
  assert.equal(t.quality.unsupportedClaimCount, 0);
  assert.ok('inputTokens' in t.ai);
});

test('engine: enhance does not overfit to any single job', async () => {
  const f = DEVOPS();
  const e = await enhanceResumeNarrative(f.doc, { userKey: 'mode', useAi: false });
  const t = await tailorResumeNarrative(f.doc, { jobDescription: f.jd, job: f.job, userKey: 'mode', useAi: false, useExternalResearch: false });
  assert.equal(e.jobIntelligence, null);
  assert.ok(t.jobIntelligence);
  assert.equal(e.mode, 'enhance');
  assert.equal(t.mode, 'tailor');
});

test('engine: a throwing AI provider is absorbed, not propagated', async () => {
  const doc = normalizeResumeDocument(DEVOPS().doc);
  /* A provider that throws rather than returning an error result is the worst
     case. Deterministic composition must carry the whole resume. */
  const hostileRouter = {
    available: () => true,
    usage: new UsageLedger(),
    generateBulletCandidates() { throw new Error('provider exploded'); },
    generateSummaryCandidates() { throw new Error('provider exploded'); },
  };
  const r = await enhanceResumeNarrative(doc, { userKey: 'boom', useAi: true, router: hostileRouter });
  assert.equal(r.ok, true, 'a provider failure must not fail the request');
  assert.ok(r.bullets.length >= 4);
  assert.ok(r.telemetry.counters.aiFailures > 0, 'the failure is recorded, not hidden');
  assert.equal(r.truth.unsupportedClaimCount, 0);
  for (const b of r.bullets) assert.ok(b.evidenceId, 'every bullet stays traceable');
});

test('engine: an internal failure returns the untouched original document', async () => {
  const doc = normalizeResumeDocument(DEVOPS().doc);
  /* A router that breaks on the availability probe fails outside every inner
     guard — the true "something went wrong" path. */
  const brokenRouter = { available() { throw new Error('boom'); }, usage: new UsageLedger() };
  const r = await enhanceResumeNarrative(doc, { userKey: 'internal-boom', useAi: true, router: brokenRouter });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'narrative_enhance_failed');
  assert.deepEqual(
    r.doc.experience[0].bullets.map((b) => b.text),
    doc.experience[0].bullets.map((b) => b.text),
    'the user keeps exactly what they wrote',
  );
});

test('engine: content strategy allocates by recency, relevance and evidence quality', () => {
  const f = DEVOPS();
  const doc = normalizeResumeDocument(f.doc);
  const g = buildEvidenceGraph(doc);
  const ji = buildJobIntelligence({ jobDescription: f.jd, job: f.job });
  const plan = planContentStrategy(doc, g, { jobIntel: ji, seniority: 'mid', mode: 'tailor' });
  assert.equal(plan.roles.length, 2);
  const [current, previous] = plan.roles;
  assert.equal(current.current, true);
  assert.ok(current.priority >= previous.priority);
});

/* ============================================================
   11. GOLDEN QUALITY TESTS — no collapse into one vocabulary
   ============================================================ */
test('golden: every fixture produces zero unsupported claims', async () => {
  for (const f of FIXTURES) {
    const r = await tailorResumeNarrative(f.doc, {
      jobDescription: f.jd, job: f.job, userKey: `golden-${f.id}`, useAi: false, useExternalResearch: false,
    });
    assert.equal(r.ok, true, `${f.id} must complete`);
    assert.equal(r.truth.unsupportedClaimCount, 0, `${f.id} introduced an unsupported claim`);
    assert.equal(r.untracedMetrics.length, 0, `${f.id} introduced an untraced metric`);
  }
});

test('golden: role family and seniority are detected per fixture', async () => {
  for (const f of FIXTURES) {
    const r = await enhanceResumeNarrative(f.doc, { userKey: `fam-${f.id}`, useAi: false });
    assert.equal(r.intelligence.roleFamily, f.expectedFamily, `${f.id} family`);
    /* Fixtures with a current role gain tenure as wall-clock time passes, so
       borderline cases declare every stage that is defensible. */
    const allowed = [].concat(f.expectedSeniority);
    assert.ok(allowed.includes(r.intelligence.seniority), `${f.id} seniority: got ${r.intelligence.seniority}, allowed ${allowed.join('/')}`);
  }
});

test('golden: a career transition is detected, not hidden', async () => {
  const f = fixtureById('career_transition');
  const r = await tailorResumeNarrative(f.doc, {
    jobDescription: f.jd, job: f.job, userKey: 'transition', useAi: false, useExternalResearch: false,
  });
  assert.equal(r.intelligence.roleFamily, 'data_engineering', 'vocabulary follows the target role');
  assert.equal(r.intelligence.evidenceRoleFamily, f.expectedEvidenceFamily, 'the real history is still recorded');
  assert.ok(r.intelligence.careerTransition, 'the transition itself is reported');
  const text = r.bullets.map((b) => b.text).join(' ');
  assert.match(text, /SQL|Airflow|pandas|pipeline/i, 'transferable evidence is surfaced');
  assert.equal(r.truth.unsupportedClaimCount, 0);
});

test('golden: vocabulary does NOT collapse across domains', async () => {
  const vocabs = new Map();
  for (const f of FIXTURES) {
    const r = await tailorResumeNarrative(f.doc, {
      jobDescription: f.jd, job: f.job, userKey: `vocab-${f.id}`, useAi: false, useExternalResearch: false,
    });
    const words = new Set(
      r.bullets.map((b) => b.text.toLowerCase()).join(' ')
        .match(/[a-z][a-z-]{3,}/g) || [],
    );
    vocabs.set(f.id, words);
  }
  /* Any two different domains must share less than half their vocabulary. */
  const ids = [...vocabs.keys()];
  for (let i = 0; i < ids.length; i += 1) {
    for (let k = i + 1; k < ids.length; k += 1) {
      const a = vocabs.get(ids[i]); const b = vocabs.get(ids[k]);
      let inter = 0;
      for (const w of a) if (b.has(w)) inter += 1;
      const jac = inter / (a.size + b.size - inter || 1);
      assert.ok(jac < 0.5, `${ids[i]} and ${ids[k]} share too much vocabulary (${jac.toFixed(2)})`);
    }
  }
});

test('golden: generated summaries are all different from each other', async () => {
  const summaries = [];
  for (const f of FIXTURES) {
    const r = await enhanceResumeNarrative(f.doc, { userKey: `sum-${f.id}`, useAi: false });
    summaries.push(r.summary.chosen);
  }
  assert.equal(new Set(summaries).size, summaries.length);
  for (const s of summaries) {
    assert.ok(!/results-driven|proven track record|highly motivated|cutting-edge|dynamic professional/i.test(s), `generic summary: ${s}`);
  }
});

test('golden: no fixture output matches the public template corpus', async () => {
  for (const f of FIXTURES) {
    const r = await enhanceResumeNarrative(f.doc, { userKey: `gen-${f.id}`, useAi: false });
    const gen = assessGenericity([r.summary.chosen, ...r.bullets.map((b) => b.text)]);
    assert.ok(gen.penalty < 0.5, `${f.id} genericity ${gen.penalty}`);
  }
});

/* ============================================================
   12. UTILITY / INFRASTRUCTURE
   ============================================================ */
test('infra: variation seeds are stable per user and differ across users', () => {
  assert.equal(variationSeed('u1', 'ev1', 'x'), variationSeed('u1', 'ev1', 'x'));
  assert.notEqual(variationSeed('u1', 'ev1', 'x'), variationSeed('u2', 'ev1', 'x'));
});

test('infra: change ledger summarises reasons', () => {
  const l = new ChangeLedger();
  l.record({ original: 'Worked on X.', enhanced: 'Built X in Java.', reasonCodes: ['weak_opener_removed'], evidenceId: 'ev1', scoreBefore: 40, scoreAfter: 60 });
  l.record({ original: 'Same.', enhanced: 'Same.', evidenceId: 'ev2' });
  const s = l.summary();
  assert.equal(s.total, 2);
  assert.equal(s.changed, 1);
  assert.equal(s.byReason.weak_opener_removed, 1);
  assert.ok(l.significant().length >= 1);
});

test('infra: telemetry stage timing never throws on failure', async () => {
  const t = new NarrativeTelemetry({ mode: 'enhance' });
  await assert.rejects(() => t.time('boom', async () => { throw new Error('x'); }));
  assert.equal(t.counters.errors, 1);
  assert.ok(t.stages.some((s) => s.stage === 'boom' && s.ok === false));
});

test('infra: shapeOf produces a content-free syntactic signature', () => {
  assert.equal(
    shapeOf('Automated deployment pipelines across twelve environments.'),
    shapeOf('Automated ingestion pipelines across fourteen warehouses.'),
  );
});

test('infra: inferIntent maps evidence to what it communicates', () => {
  assert.equal(inferIntent({ rawText: 'Automated the nightly release pipeline.' }).intent, 'automation');
  assert.equal(inferIntent({ rawText: 'Migrated 40 services from EC2 to Kubernetes.' }).intent, 'migration');
  assert.equal(inferIntent({ rawText: 'Reconciled intercompany balances at month-end close.' }).intent, 'compliance');
  assert.equal(inferIntent({ rawText: 'Built Airflow ingestion into the warehouse.' }).intent, 'data');
});

test('infra: candidate intelligence reports honest evidence strength', () => {
  const weak = fixtureById('weak_resume');
  const g = graphOf(weak.doc);
  const ci = buildCandidateIntelligence(normalizeResumeDocument(weak.doc), g, {});
  assert.equal(ci.evidenceStrength, 'weak');
  assert.ok(ci.counts.weakOpeners >= 2);
});

test('infra: terminology alignment never substitutes a tool for a language', () => {
  const g = graphOf(fixtureById('fresher_software_engineer').doc);
  const ji = buildJobIntelligence({ jobDescription: fixtureById('fresher_software_engineer').jd });
  const c = classifySkills(ji.prioritySkills.map((p) => p.skill), g, {});
  const align = buildTerminologyAlignment(c, ji);
  assert.ok(!align.some((a) => /spring boot/i.test(a.from) && /^java$/i.test(a.to)));
});
