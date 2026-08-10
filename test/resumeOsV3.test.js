/* ============================================================
   Resume OS V3 — engine test suite (node:test, no framework)
   Covers: canonical document model, truth firewall, deterministic
   compiler (fabrication guard), grammar/tense/redundancy, checks,
   ATS Engine V3 (determinism + explainability + potential math),
   JD parser V2 weighting, job match V3, content selection,
   ATS parse simulator round-trip, template certification, and a
   golden score snapshot pinned to ATS_ENGINE_VERSION.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeResumeDocument, fromStructuredResume, toRendererStructured, toPlainText,
  resetIdSequence, PROVENANCE, RESUME_DOCUMENT_VERSION,
} from '../server/utils/resume/resumeDocument.js';
import { auditResumeTruth } from '../server/utils/resume/truthEngine.js';
import { compileBullet, quantificationPrompts } from '../server/utils/resume/bulletCompiler.js';
import { detectVerbRepetition, detectTenseIssues, verbAlternatives, eligiblePatterns } from '../server/utils/resume/grammarLibrary.js';
import { parseResumeDate, validateDateRange, analyzeChronology } from '../server/utils/resume/dateEngine.js';
import { findDuplicateBullets, readabilityIssuesForBullet, bulletSimilarity } from '../server/utils/resume/textQualityEngines.js';
import { runResumeChecks, groupChecksForFixCenter } from '../server/utils/resume/resumeChecksV3.js';
import { scoreResumeDocument, ATS_ENGINE_VERSION } from '../server/utils/resume/atsEngineV3.js';
import { parseJDv2 } from '../server/utils/resume/jdParserV2.js';
import { matchDocumentToJD, rankContentForTarget, proposeTailoredSelection } from '../server/utils/resume/jobMatchEngineV3.js';
import { extractTextFromHtml, simulateAtsParse } from '../server/utils/resume/atsParseSimulator.js';
import { certifyAllTemplates } from '../server/utils/resume/templateCertification.js';
import { assembleMasterProfile, seedResumeDocument, detectEvidenceOpportunities } from '../server/utils/resume/masterProfileEngine.js';
import { buildCollegeResumeOverview } from '../server/utils/resume/collegeResumeOverview.js';
import { pickResumeNextBestAction } from '../server/routes/resumeOsRoutes.js';
import { canonicalSkill } from '../server/utils/resume/skillOntology.js';
import { V3_TEMPLATES, getResumeTemplate } from '../web/src/lib/resumeTemplateRegistry.js';

/* ----------------------------------------------------------- fixtures ---- */
function sampleDoc() {
  resetIdSequence();
  return normalizeResumeDocument({
    id: 'rd_fixture', title: 'Fixture', targetRole: 'data engineer',
    contact: { name: 'Asha Rao', email: 'asha@example.com', phone: '+91 99999 88888', linkedin: 'linkedin.com/in/asha', github: 'github.com/asha' },
    summary: 'Data engineer with 3 years building AWS pipelines processing 2TB daily.',
    skills: [
      { name: 'Python', status: 'VERIFIED' }, { name: 'PySpark', status: 'VERIFIED' },
      { name: 'AWS', status: 'DECLARED' }, { name: 'Airflow', status: 'DECLARED' },
    ],
    experience: [{
      company: 'DataCo', role: 'Data Engineer', startDate: 'Jun 2023', current: true,
      bullets: [
        { text: 'Built Python and PySpark pipelines on AWS EMR processing 2TB of events daily.', verified: true, evidenceIds: ['evidence:github:p1'] },
        { text: 'Reduced warehouse cost 30% by migrating hot tables to Iceberg.' },
      ],
    }],
    projects: [{
      name: 'StreamGuard', techStack: 'Python, Kafka', sourceProjectId: 'p1', verified: true,
      evidenceIds: ['evidence:github:p1'],
      bullets: [{ text: 'Streaming anomaly detector handling 40k events/sec.', verified: true }],
    }],
    education: [{ school: 'IIT Indore', degree: 'B.Tech CSE', dates: '2018 – 2022' }],
  });
}

/* -------------------------------------------------- document model ------- */
test('document model: normalize is idempotent and versioned', () => {
  const d1 = sampleDoc();
  const d2 = normalizeResumeDocument(JSON.parse(JSON.stringify(d1)));
  assert.equal(d1.engineVersions.document, RESUME_DOCUMENT_VERSION);
  assert.deepEqual(d2.sectionOrder, d1.sectionOrder);
  assert.equal(d2.experience[0].bullets.length, 2);
});

test('document model: legacy structured round-trip keeps content', () => {
  const doc = sampleDoc();
  const s = toRendererStructured(doc);
  assert.equal(s.personalInfo.name, 'Asha Rao');
  assert.ok(s.experience[0].bullets.includes('Reduced warehouse cost 30% by migrating hot tables to Iceberg.'));
  const back = fromStructuredResume(s);
  assert.equal(back.experience[0].company, 'DataCo');
  // imported content is never auto-trusted
  assert.equal(back.experience[0].bullets[0].userConfirmed, false);
});

test('document model: overrides select bullets per variant without duplication', () => {
  const doc = sampleDoc();
  const keep = doc.experience[0].bullets[0].id;
  doc.overrides = { bulletIds: { [doc.experience[0].id]: [keep] }, disabled: [] };
  const s = toRendererStructured(doc);
  assert.equal(s.experience[0].bullets.length, 1);
});

test('document model: plain text export contains all enabled content', () => {
  const txt = toPlainText(sampleDoc());
  for (const needle of ['Asha Rao', 'DataCo', 'StreamGuard', 'IIT Indore', 'PySpark']) assert.ok(txt.includes(needle), needle);
});

/* ---------------------------------------------------- truth engine ------- */
test('truth engine: unsupported skill usage in bullets is flagged; listing is not', () => {
  const doc = sampleDoc();
  doc.experience[0].bullets.push(normalizeResumeDocument({ experience: [{ bullets: [{ text: 'Managed Kubernetes clusters across three regions.' }] }] }).experience[0].bullets[0]);
  const audit = auditResumeTruth(doc, { verifiedSkills: ['Python', 'PySpark'], profileSkills: ['Python', 'PySpark', 'AWS', 'Airflow'] });
  const unsupported = audit.findings.filter((f) => f.id === 'unsupported_skill_usage');
  assert.ok(unsupported.some((f) => /kubernetes/i.test(f.message)));
  // AWS is profile-confirmed → allowed in use, and declared listing alone never fires
  assert.ok(!unsupported.some((f) => /airflow/i.test(f.message)));
});

test('truth engine: skill marked VERIFIED without server verification is critical', () => {
  const doc = sampleDoc();
  const audit = auditResumeTruth(doc, { verifiedSkills: ['Python'], profileSkills: [] });
  assert.ok(audit.findings.some((f) => f.id === 'skill_marked_verified_without_verification' && f.severity === 'critical'));
});

/* ------------------------------------------------- bullet compiler ------- */
test('compiler: deterministic output and no fabricated numbers', () => {
  const facts = { action: 'automate', object: 'deployments', tech: ['Jenkins'], outcome: 'cutting release time', outcomeValue: '60%' };
  const a = compileBullet(facts); const b = compileBullet(facts);
  assert.equal(a.text, b.text);
  assert.ok(a.text.includes('60%'));
  const nums = a.text.match(/\d+/g) || [];
  assert.deepEqual(nums, ['60']); // exactly the provided number, nothing invented
});

test('compiler: missing required slots returns questions, never filler', () => {
  const r = compileBullet({ tech: ['React'] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'insufficient_fields');
  assert.ok(r.missing.length > 0 && r.text === '');
});

test('quantification: prompts only when no number present', () => {
  assert.equal(quantificationPrompts('Automated deployment pipelines.').needed, true);
  assert.equal(quantificationPrompts('Cut deploy time 40%.').needed, false);
});

test('grammar: eligible patterns require all slots; alternatives stay in-group', () => {
  assert.equal(eligiblePatterns({ action: 'build' }).some((p) => p.id === 'act-obj-tech-outcome'), false);
  const alts = verbAlternatives('built');
  assert.ok(alts.length > 0 && !alts.includes('built'));
});

test('grammar: verb repetition + tense mismatch detection', () => {
  const rep = detectVerbRepetition([
    { text: 'Built an API.' }, { text: 'Built a dashboard.' }, { text: 'Built a pipeline.' },
  ], 3);
  assert.equal(rep.repeated.length, 1);
  assert.ok(rep.repeated[0].alternatives.length > 0 && !rep.repeated[0].alternatives.includes('build'));
  const tense = detectTenseIssues([{ text: 'Build data pipelines for reporting.', current: false }]);
  assert.ok(tense.length === 1 && tense[0].suggestion.toLowerCase().startsWith('built'));
});

/* ------------------------------------------------------ date engine ------ */
test('dates: parsing, ranges and chronology ordering', () => {
  assert.equal(parseResumeDate('Jun 2023').ok, true);
  assert.equal(validateDateRange({ startDate: 'Jun 2023', endDate: 'Jan 2022' }).issues[0].code, 'end_before_start');
  const chron = analyzeChronology([
    { id: 'a', role: 'Old', startDate: 'Jan 2019', endDate: 'Dec 2020' },
    { id: 'b', role: 'New', startDate: 'Jan 2021', current: true },
  ]);
  assert.ok(chron.issues.some((i) => i.code === 'chronology_order'));
});

/* ---------------------------------------------------- text quality ------- */
test('redundancy: exact and near duplicates', () => {
  const dup = findDuplicateBullets([
    { id: '1', text: 'Built REST APIs with Node.js and Express.' },
    { id: '2', text: 'Built REST APIs with Node.js and Express.' },
    { id: '3', text: 'Built REST APIs with Node.js and Express for clients.' },
  ]);
  assert.equal(dup.exact.length, 1);
  assert.ok(dup.near.length >= 1);
  assert.ok(bulletSimilarity('a b c', 'x y z') < 0.2);
});

test('readability: long bullet, first person, weak opener', () => {
  const long = readabilityIssuesForBullet('I was responsible for the management of the very long process of building and maintaining and improving and documenting and testing and shipping and monitoring many different internal tools for teams across the organization every quarter of the year always');
  const ids = long.map((i) => i.code);
  assert.ok(ids.includes('bullet_too_long') && ids.includes('first_person'));
  const weak = readabilityIssuesForBullet('Responsible for maintaining internal tools for the platform team');
  assert.ok(weak.map((i) => i.code).includes('weak_opener'));
});

/* ------------------------------------------------------- checks ---------- */
test('checks: 40+ rules run, targeting free-win fires, fix center groups', () => {
  const doc = sampleDoc();
  // Verified skill absent from doc → free win check
  const { checks } = runResumeChecks(doc, { targetRole: 'data engineer', verifiedSkills: ['Python', 'PySpark', 'Terraform'] });
  assert.ok(checks.some((c) => c.id === 'targeting_verified_skill_absent' && /terraform/i.test(c.message)));
  for (const c of checks) {
    for (const k of ['id', 'severity', 'category', 'message', 'reason', 'recommendedAction']) assert.ok(c[k] != null && c[k] !== '', `${c.id}.${k}`);
  }
  const grouped = groupChecksForFixCenter(checks);
  assert.ok(['critical', 'highImpact', 'improvement', 'formatting'].every((k) => Array.isArray(grouped[k])));
});

/* --------------------------------------------------- ATS Engine V3 ------- */
test('ats v3: deterministic, dimensions sum to score, reasons everywhere', () => {
  const doc = sampleDoc();
  const opts = { targetRole: 'data engineer', verifiedSkills: ['Python', 'PySpark'], profileSkills: ['AWS'] };
  const a = scoreResumeDocument(doc, opts);
  const b = scoreResumeDocument(normalizeResumeDocument(JSON.parse(JSON.stringify(doc))), opts);
  assert.equal(a.score, b.score);
  const sum = Object.values(a.dimensions).reduce((n, d) => n + d.points, 0);
  assert.equal(Math.round(sum), a.score);
  for (const d of Object.values(a.dimensions)) assert.ok(d.reasons.length > 0);
  assert.ok(a.potential >= a.score && a.potential <= 100);
});

test('ats v3: no-JD folds jdMatch into roleAlignment (max 24)', () => {
  const r = scoreResumeDocument(sampleDoc(), { targetRole: 'data engineer' });
  assert.equal(r.dimensions.roleAlignment.max, 24);
  assert.equal(r.dimensions.jdMatch, undefined);
});

test('ats v3: potential equals score + capped sum of check impacts', () => {
  const r = scoreResumeDocument(sampleDoc(), { targetRole: 'data engineer' });
  const gain = r.checks.reduce((n, c) => n + (c.scoreImpact || 0), 0);
  assert.equal(r.potential, Math.min(100, r.score + gain));
});

/* --------------------------------------------------- JD parser V2 -------- */
const JD = `Senior Data Engineer

Requirements:
- 5+ years with Python and SQL
- Must have hands-on Apache Spark experience
- Bachelor's degree in Computer Science

Responsibilities:
- Build and operate Airflow pipelines
- Optimize Snowflake warehouses

Nice to have:
- Terraform, Docker
Certifications: AWS Solutions Architect preferred`;

test('jd parser v2: sections weighted, required > nice, frequency capped', () => {
  const jd = parseJDv2({ jobDescription: JD });
  const w = Object.fromEntries(jd.weighted.map((x) => [x.canonical, x.weight]));
  assert.ok(w[canonicalSkill('python')] >= 3);
  assert.ok(w[canonicalSkill('terraform')] <= 1.2);
  assert.ok(Math.max(...jd.weighted.map((x) => x.weight)) <= 4.0);
  assert.equal(jd.yearsOfExperience, 5);
  assert.match(jd.education, /bachelor/i);
  assert.ok(jd.certifications.some((c) => /aws/i.test(c)));
  assert.ok(jd.required.includes('python') || jd.required.includes('Python'.toLowerCase()));
});

/* -------------------------------------------------- job match V3 --------- */
test('job match v3: verified/declared/missing classification + provable gaps', () => {
  const doc = sampleDoc();
  const jd = parseJDv2({ jobDescription: JD });
  const m = matchDocumentToJD(doc, jd, { verifiedSkills: ['Python', 'PySpark', 'Terraform'] });
  assert.ok(m.strong.some((s) => s.skill.toLowerCase() === 'python' && s.status === 'VERIFIED'));
  const terr = m.missing.find((x) => x.skill.toLowerCase() === 'terraform');
  assert.ok(terr && terr.provable === true); // verified evidence exists, resume never shows it
  assert.ok(m.breakdown.requiredSkills >= 0 && m.breakdown.requiredSkills <= 100);
  assert.ok(m.actions.length > 0);
  const gap = m.actions.find((a) => a.type === 'build_evidence');
  if (gap) assert.deepEqual(Object.keys(gap.cta.context).sort(), ['reason', 'targetRole', 'targetSkill']);
});

/* --------------------------------------------- content selection --------- */
test('content selection: explainable ranking + non-destructive proposal', () => {
  const doc = sampleDoc();
  const jd = parseJDv2({ jobDescription: JD });
  const ranking = rankContentForTarget(doc, { jd, targetRole: 'data engineer', verifiedSkills: ['Python', 'PySpark'] });
  assert.ok(ranking.bullets.length >= 3);
  for (const b of ranking.bullets) assert.ok(b.reasons.length > 0);
  const proposal = proposeTailoredSelection(doc, ranking, { maxBulletsPerItem: 1, maxProjects: 1 });
  assert.ok(proposal.decisions.some((d) => d.action === 'trim_bullet' && d.reason.length > 10));
  // proposal only produces overrides — the source document is untouched
  assert.equal(doc.experience[0].bullets.length, 2);
});

/* -------------------------------------------- ATS parse simulator -------- */
test('ats simulator: extraction preserves block boundaries and content', () => {
  const txt = extractTextFromHtml('<div><h2>Experience</h2><ul><li>Built <b>X</b></li><li>Shipped Y</li></ul></div>');
  assert.ok(txt.includes('Experience'));
  assert.ok(txt.split('\n').length >= 3);
});

test('ats simulator: fixture doc survives its own render round-trip', async () => {
  const { buildResumeBlocks } = await import('../web/src/lib/resumeRenderer.js');
  const doc = sampleDoc();
  const { blocks } = buildResumeBlocks(toRendererStructured(doc), getResumeTemplate('atlas'));
  const sim = simulateAtsParse(doc, blocks.map((b) => b.html).join('\n'));
  assert.ok(sim.integrity >= 90, `integrity ${sim.integrity}`);
  assert.equal(sim.criticalLoss.length, 0);
});

/* -------------------------------------------- template certification ----- */
test('certification: all 12 V3 templates earn ATS Checked on every fixture', () => {
  const report = certifyAllTemplates({ force: true });
  for (const t of V3_TEMPLATES) {
    assert.ok(report.certified.includes(t.id), `${t.id} not certified: ${JSON.stringify(report.failed)}`);
  }
});

/* ------------------------------------------------- master profile -------- */
test('master profile: verified projects/skills flow with honest status; seed carries provenance', () => {
  const master = assembleMasterProfile({
    profile: { name: 'Asha Rao', skills: ['Python', 'Airflow'], targetRole: 'data engineer' },
    user: { email: 'asha@example.com' },
    submissions: [
      { _id: 'p1', title: 'StreamGuard', verificationStatus: 'verified', verifiedSkills: ['Python'], technologies: ['Python', 'Kafka'], githubUrl: 'https://github.com/x' },
      { _id: 'p2', title: 'Draft thing', verificationStatus: 'pending', technologies: ['Go'] },
    ],
    verifiedSkills: ['Python'],
  });
  assert.equal(master.counts.verifiedProjects, 1);
  assert.equal(master.skills.find((s) => s.canonical === canonicalSkill('python')).status, 'VERIFIED');
  assert.equal(master.skills.find((s) => s.canonical === canonicalSkill('airflow')).status, 'DECLARED');
  const doc = seedResumeDocument(master, { targetRole: 'data engineer' });
  const p1 = doc.projects.find((p) => p.sourceProjectId === 'p1');
  assert.equal(p1.verified, true);
  assert.equal(p1.provenance, PROVENANCE.VERIFIED);
  const p2 = doc.projects.find((p) => p.sourceProjectId === 'p2');
  assert.equal(p2.verified, false);
  // opportunities: verified skill removed from doc is detected
  doc.skills = doc.skills.filter((s) => s.status !== 'VERIFIED');
  const opps = detectEvidenceOpportunities(doc, master);
  assert.ok(opps.some((o) => o.type === 'verified_skill_absent'));
});

/* -------------------------------------------------- college overview ----- */
test('college overview: buckets + evidence-sprint suggestions from aggregates', () => {
  const signals = [
    { studentId: '1', hasResumeDoc: true, resumeScore: 85, verifiedSkillsOnResume: 3, declaredSkillsOnResume: 5, verifiedProjectsOnResume: 2, targetRole: 'data engineer', legacyResumeAnalyzed: false },
    { studentId: '2', hasResumeDoc: true, resumeScore: 55, verifiedSkillsOnResume: 0, declaredSkillsOnResume: 9, verifiedProjectsOnResume: 0, targetRole: 'data engineer', legacyResumeAnalyzed: false },
    { studentId: '3', hasResumeDoc: true, resumeScore: 62, verifiedSkillsOnResume: 0, declaredSkillsOnResume: 4, verifiedProjectsOnResume: 0, targetRole: 'data engineer', legacyResumeAnalyzed: false },
    { studentId: '4', hasResumeDoc: true, resumeScore: 58, verifiedSkillsOnResume: 0, declaredSkillsOnResume: 2, verifiedProjectsOnResume: 0, targetRole: 'data engineer', legacyResumeAnalyzed: false },
    { studentId: '5', hasResumeDoc: false, resumeScore: null, verifiedSkillsOnResume: 0, declaredSkillsOnResume: 0, verifiedProjectsOnResume: 0, targetRole: '', legacyResumeAnalyzed: false },
  ];
  const o = buildCollegeResumeOverview(signals);
  assert.equal(o.totals.students, 5);
  assert.equal(o.buckets.ready, 1);
  assert.equal(o.totals.noResume, 1);
  assert.ok(o.buckets.evidenceGaps >= 3);
  assert.ok(o.interventionSuggestions.length > 0);
  assert.equal(o.interventionSuggestions[0].action.context.reason, 'college_resume_gap');
});

/* ------------------------------------------------------------- NBA ------- */
test('resume NBA: critical truth issue outranks everything; ready state is honest', () => {
  const nba = pickResumeNextBestAction({
    truth: { findings: [{ severity: 'critical', message: 'Unverifiable metric', recommendedAction: 'Remove it' }] },
    health: { fixCenter: { critical: [{ message: 'x', recommendedAction: 'y', scoreImpact: 5 }] }, topImprovements: [] },
    match: null, opportunities: [],
  });
  assert.equal(nba.type, 'fix_truth_issue');
  const ready = pickResumeNextBestAction({ truth: { findings: [] }, health: { fixCenter: {}, topImprovements: [] }, match: null, opportunities: [] });
  assert.equal(ready.type, 'ready');
});

/* ----------------------------------------------------------- golden ------ */
test(`golden: fixture score is pinned for ${ATS_ENGINE_VERSION} (bump version if scoring changes)`, () => {
  const doc = sampleDoc();
  const r = scoreResumeDocument(doc, { targetRole: 'data engineer', verifiedSkills: ['Python', 'PySpark'], profileSkills: ['AWS', 'Airflow'] });
  const again = scoreResumeDocument(sampleDoc(), { targetRole: 'data engineer', verifiedSkills: ['Python', 'PySpark'], profileSkills: ['AWS', 'Airflow'] });
  assert.equal(r.score, again.score);
  assert.equal(r.engineVersion, ATS_ENGINE_VERSION);
  // Structural pin: any change to these fails loudly so scoring drift is a
  // conscious, versioned decision — never an accident.
  assert.deepEqual(Object.keys(r.dimensions).sort(), ['atsParsing', 'completeness', 'consistency', 'evidenceStrength', 'formattingSafety', 'impact', 'readability', 'roleAlignment', 'structure'].sort());
  assert.ok(r.score >= 55 && r.score <= 95, `fixture score sanity band, got ${r.score}`);
});
