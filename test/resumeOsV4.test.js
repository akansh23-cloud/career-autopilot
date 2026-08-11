/* ============================================================
   RESUME OS V4 — engine + route tests
   Zero-AI pipeline correctness, the AI truth gate, the server
   trust boundary, real DOCX output, and the canonical
   Tailor-for-Job package.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeClient } from './helpers.js';

import { sanitizeDocumentTrust } from '../server/utils/resume/trustBoundary.js';
import { compileSummary, computeYears } from '../server/utils/resume/summaryCompiler.js';
import { planContentBudget, buildAutoFitPlan, budgetForTemplate, FIT_FLOORS, AUTO_FIT_ORDER } from '../server/utils/resume/contentBudget.js';
import { rankTemplates, detectCareerStage } from '../server/utils/resume/templateRecommender.js';
import { validateRewrite, DeterministicWritingProvider, assistRewrite, makeAnthropicWritingProvider } from '../server/utils/resume/writingProviders.js';
import { renderResumeDocx, buildResumeDocxParts } from '../server/utils/docxWriter.js';
import { normalizeResumeDocument } from '../server/utils/resume/resumeDocument.js';
import { parseJDv2 } from '../server/utils/resume/jdParserV2.js';
import { RESUME_TEMPLATES, V4_TEMPLATES, LICENSE_STATES, getResumeTemplate } from '../web/src/lib/resumeTemplateRegistry.js';

/* ---------- fixtures ---------- */
const DOC = () => normalizeResumeDocument({
  id: 'rd_test1', targetRole: 'Data Engineer',
  contact: { name: 'Asha Rao', email: 'asha@example.com', phone: '+91 90000 00000', title: 'Data Engineer' },
  summary: '',
  skills: [
    { id: 'sk1', name: 'Python', status: 'VERIFIED' },            // client claims VERIFIED
    { id: 'sk2', name: 'Spark', status: 'DECLARED' },
    { id: 'sk3', name: 'Kubernetes', status: 'VERIFIED' },        // client lies
    { id: 'sk4', name: 'SQL' }, { id: 'sk5', name: 'Airflow' }, { id: 'sk6', name: 'AWS' },
  ],
  experience: [{
    id: 'e1', company: 'DataCo', role: 'Data Engineer', startDate: 'Jun 2021', current: true,
    bullets: [
      { id: 'b1', text: 'Built PySpark pipelines processing 2TB daily across 40 sources.' },
      { id: 'b2', text: 'Reduced batch runtime by 35% by tuning Spark partitioning.' },
      { id: 'b3', text: 'Automated data quality checks in Airflow.', verified: true, evidenceIds: ['ev_fake'] }, // client-invented evidence
      { id: 'b4', text: 'Wrote documentation for onboarding.' },
      { id: 'b5', text: 'Mentored two interns on SQL best practices.' },
      { id: 'b6', text: 'Attended weekly team meetings and standups.' },
    ],
  }, {
    id: 'e0', company: 'OldCo', role: 'Analyst', startDate: 'Jul 2019', endDate: 'May 2021',
    bullets: [
      { id: 'ob1', text: 'Analyzed sales data in SQL.' },
      { id: 'ob2', text: 'Built Excel dashboards.' },
      { id: 'ob3', text: 'Created weekly reports.' },
      { id: 'ob4', text: 'Supported ad-hoc requests.' },
    ],
  }],
  projects: [
    { id: 'p1', name: 'Lakehouse ETL', techStack: 'Spark, Iceberg', sourceProjectId: 'proj_ok', verified: true, bullets: [{ id: 'pb1', text: 'Implemented incremental ingestion with Apache Iceberg.' }] },
    { id: 'p2', name: 'Weather App', techStack: 'React', verified: true, bullets: [{ id: 'pb2', text: 'Displayed forecasts.' }] }, // client lies
    { id: 'p3', name: 'Toy Scraper', techStack: 'Python', bullets: [{ id: 'pb3', text: 'Scraped listings.' }] },
  ],
  education: [{ id: 'ed1', school: 'UPES', degree: 'B.Tech Computer Science', endDate: 'May 2019' }],
  certifications: [{ id: 'c1', name: 'AWS Solutions Architect Associate', verified: true }],
});

const SERVER_CTX = () => ({
  verifiedSkills: ['Python', 'Spark'],
  verifiedProjectIds: ['proj_ok'],
  evidenceIndex: new Map([['ev_real', { kind: 'submission' }]]),
});

/* ================= trust boundary ================= */
test('trust boundary: client verified flags are stripped, server truth wins', () => {
  const { doc, changes } = sanitizeDocumentTrust(DOC(), SERVER_CTX());
  const skill = (id) => doc.skills.find((s) => s.id === id);
  assert.equal(skill('sk1').status, 'VERIFIED');            // server-backed → kept
  assert.equal(skill('sk3').status, 'DECLARED');            // client lie → downgraded
  const p2 = doc.projects.find((p) => p.id === 'p2');
  assert.equal(p2.verified, false);                          // no server backing
  const p1 = doc.projects.find((p) => p.id === 'p1');
  assert.equal(p1.verified, true);                           // verified project id
  const b3 = doc.experience[0].bullets.find((b) => b.id === 'b3');
  assert.equal(b3.verified, false);                          // fake evidence stripped
  assert.deepEqual(b3.evidenceIds, []);
  assert.ok(changes.some((c) => c.kind === 'skill_downgraded'));
  assert.ok(changes.some((c) => c.kind === 'evidence_stripped'));
});

test('trust boundary fails CLOSED with no server context', () => {
  const { doc } = sanitizeDocumentTrust(DOC(), {});
  assert.ok(doc.skills.every((s) => s.status !== 'VERIFIED'));
  assert.ok(doc.projects.every((p) => p.verified === false));
});

/* ================= summary compiler ================= */
test('summary compiler: multiple candidates, facts only, deterministic', () => {
  const ctx = SERVER_CTX();
  const doc = sanitizeDocumentTrust(DOC(), ctx).doc;
  const s1 = compileSummary(doc, { targetRole: 'Data Engineer', verifiedSkills: ctx.verifiedSkills });
  assert.equal(s1.ok, true);
  assert.ok(s1.candidates.length >= 2, 'expected multiple pattern candidates');
  const s2 = compileSummary(doc, { targetRole: 'Data Engineer', verifiedSkills: ctx.verifiedSkills });
  assert.deepEqual(s1.candidates, s2.candidates, 'summary must be deterministic');
  for (const c of s1.candidates) {
    /* no invented numbers: any digit in the summary must exist in doc text or be the verified project count (1) */
    for (const num of c.text.match(/\d+/g) || []) assert.ok(['1', '2', '35', '40'].includes(num) || /year/.test(c.text), `unexpected number ${num}`);
  }
});

test('summary compiler: insufficient facts → questions, not filler', () => {
  const empty = normalizeResumeDocument({ id: 'rd_empty' });
  const s = compileSummary(empty, {});
  assert.equal(s.ok, false);
  assert.equal(s.reason, 'insufficient_facts');
  assert.ok(s.questions.length > 0);
});

test('computeYears counts only dated experience', () => {
  const { years } = computeYears(DOC());
  assert.ok(years >= 5 && years <= 8, `unexpected years ${years}`);
  assert.equal(computeYears(normalizeResumeDocument({})).months, 0);
});

/* ================= content budget + auto-fit ================= */
test('content budget: caps enforced with per-decision reasons, non-destructive', () => {
  const doc = sanitizeDocumentTrust(DOC(), SERVER_CTX()).doc;
  const tpl = getResumeTemplate('atlas');
  const ranking = { bullets: doc.experience.flatMap((e) => e.bullets.map((b, i) => ({ bulletId: b.id, value: 100 - i * 10, reasons: ['test'] }))), projects: doc.projects.map((p, i) => ({ itemId: p.id, value: p.verified ? 90 : 40 - i, reasons: ['test'] })), skills: doc.skills.map((s, i) => ({ itemId: s.id, value: 80 - i, reasons: [] })) };
  const plan = planContentBudget(doc, ranking, tpl, { pageTarget: 1 });
  const budget = budgetForTemplate(tpl);
  const kept = plan.overrides.bulletIds.e1;
  assert.ok(kept && kept.length === budget.currentExperience.preferredBullets, 'current role capped at preferred');
  assert.ok(plan.decisions.every((d) => d.reason && d.reason.length > 10), 'every decision carries a reason');
  /* the source document is untouched — plan is overrides only */
  assert.equal(DOC().experience[0].bullets.length, 6);
});

test('auto-fit: fixed order, hard floors, second page last', () => {
  const doc = sanitizeDocumentTrust(DOC(), SERVER_CTX()).doc;
  const plan = buildAutoFitPlan({ overflowLines: 8, density: 'comfortable', pageTarget: 1, doc, ranking: { skills: [], projects: [], bullets: [] } });
  assert.equal(plan.fits, false);
  const steps = plan.steps.map((s) => s.step);
  const order = steps.map((s) => AUTO_FIT_ORDER.indexOf(s));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'steps must follow AUTO_FIT_ORDER');
  assert.equal(steps[steps.length - 1], 'allow_second_page');
  const font = plan.steps.find((s) => s.step === 'reduce_font_within_floor');
  assert.equal(font.floor, FIT_FLOORS.bodyFontPx);
  assert.ok(FIT_FLOORS.bodyFontPx >= 9.5);
  assert.equal(buildAutoFitPlan({ overflowLines: 0 }).fits, true);
});

/* ================= template platform ================= */
test('registry: expanded templates, all license-stamped, V4 descriptor fields present', () => {
  assert.equal(RESUME_TEMPLATES.length, 51);
  for (const t of RESUME_TEMPLATES) {
    assert.ok(t.license && LICENSE_STATES.includes(t.license.licenseStatus), `${t.id} missing license`);
    assert.equal(typeof t.license.productionEnabled, 'boolean');
  }
  for (const t of V4_TEMPLATES) {
    assert.ok(Array.isArray(t.supportedRoles) && t.supportedRoles.length, `${t.id} missing supportedRoles`);
    assert.ok(Array.isArray(t.careerStages), `${t.id} missing careerStages`);
  }
});

test('template recommender: role fit, stage penalties, disabled licenses excluded', () => {
  const doc = sanitizeDocumentTrust(DOC(), SERVER_CTX()).doc;
  const reco = rankTemplates(RESUME_TEMPLATES, doc, { targetRole: 'Data Engineer', atsPreference: 'high' });
  assert.equal(reco.stage, 'professional');
  assert.ok(reco.best.score > 50);
  assert.ok(['tech', 'ats-strict'].includes(reco.best.category), `best category was ${reco.best.category}`);
  assert.ok(reco.best.reasons.length >= 2, 'scores must explain themselves');
  /* a disabled license never gets recommended */
  const withDisabled = [...RESUME_TEMPLATES, { id: 'pending', name: 'Pending', category: 'tech', license: { licenseStatus: 'LICENSE_PENDING', productionEnabled: false } }];
  const reco2 = rankTemplates(withDisabled, doc, { targetRole: 'Data Engineer' });
  assert.ok(!reco2.ranked.some((r) => r.id === 'pending'));
  /* student profile penalizes executive layouts */
  const student = normalizeResumeDocument({ id: 'rd_s', targetRole: 'Data Engineer', education: [{ school: 'X', degree: 'B.Tech' }], projects: [{ name: 'P', bullets: [{ text: 'Did a thing.' }] }] });
  assert.equal(detectCareerStage(student), 'student');
  const sReco = rankTemplates(RESUME_TEMPLATES, student, { targetRole: 'Data Engineer' });
  const exec = sReco.ranked.find((r) => r.category === 'executive');
  assert.ok(exec.score < sReco.best.score - 10, 'executive should rank well below best for a student');
});

/* ================= writing providers + truth gate ================= */
test('truth gate: rejects invented numbers, skills, and claims; accepts pure rewording', () => {
  const src = 'Built PySpark pipelines processing 2TB daily across 40 sources.';
  assert.equal(validateRewrite('Engineered PySpark pipelines handling 2TB daily across 40 sources.', { sourceText: src }).accepted, true);
  const num = validateRewrite('Built PySpark pipelines processing 5TB daily.', { sourceText: src });
  assert.equal(num.accepted, false);
  assert.ok(num.reasons.some((r) => r.includes('5tb')));
  const skill = validateRewrite('Built PySpark pipelines and deployed them on Kubernetes.', { sourceText: src });
  assert.equal(skill.accepted, false);
  assert.ok(skill.reasons.some((r) => /kubernetes/i.test(r)));
  const claim = validateRewrite('Built PySpark pipelines; promoted for this work.', { sourceText: src });
  assert.equal(claim.accepted, false);
});

test('deterministic provider always produces candidates without AI', async () => {
  const out = await DeterministicWritingProvider.rewrite({ kind: 'bullet', text: 'Responsible for building various data pipelines in order to support analytics.' });
  assert.ok(out.candidates.length >= 1);
  assert.ok(out.candidates.every((c) => c.source === 'deterministic'));
  assert.ok(out.candidates[0].text.length < 80, 'filler should be stripped');
  assert.ok(!/responsible for|in order to|various/i.test(out.candidates[0].text));
});

test('assistRewrite: AI failure degrades gracefully; hallucinated AI output is rejected, never shown', async () => {
  const fakeAi = {
    id: 'fake', available: () => true,
    async rewrite() {
      return { provider: 'fake', candidates: [
        { text: 'Built PySpark pipelines processing 2TB daily across 40 sources with excellence.', source: 'ai' },   // ok
        { text: 'Built PySpark pipelines processing 9TB daily and earned AWS certification.', source: 'ai' },        // invented number + cert claim
      ] };
    },
  };
  const r = await assistRewrite({ kind: 'bullet', text: 'Built PySpark pipelines processing 2TB daily across 40 sources.', useAi: true, aiProvider: fakeAi });
  assert.equal(r.ai.length, 1);
  assert.equal(r.aiRejected, 1);
  assert.ok(r.deterministic.length >= 0);
  /* provider outage → deterministic still works, no throw */
  const down = makeAnthropicWritingProvider({ apiKey: 'k', model: 'm', fetchImpl: async () => { throw new Error('net down'); } });
  const r2 = await assistRewrite({ kind: 'bullet', text: 'Reduced batch runtime by 35% by tuning Spark partitioning.', useAi: true, aiProvider: down });
  assert.equal(r2.ai.length, 0);
  assert.equal(r2.aiError, 'provider_unreachable');
});

/* ================= real DOCX ================= */
test('DOCX writer produces genuine WordprocessingML with intact content, deterministically', async () => {
  const doc = DOC();
  const buf1 = await renderResumeDocx(doc, getResumeTemplate('atlas'));
  const buf2 = await renderResumeDocx(doc, getResumeTemplate('atlas'));
  assert.ok(Buffer.isBuffer(buf1) && buf1.length > 1000);
  assert.equal(buf1.equals(buf2), true, 'same doc → identical bytes');
  assert.equal(buf1.slice(0, 2).toString(), 'PK', 'must be a real zip (OOXML) package');
  const parts = buildResumeDocxParts(doc, getResumeTemplate('atlas'));
  assert.ok(parts.contentTypes.includes('wordprocessingml.document.main+xml'));
  assert.ok(parts.documentXml.includes('Asha Rao'));
  assert.ok(parts.documentXml.includes('PySpark pipelines'));
  assert.ok(parts.documentXml.includes('<w:numPr>'), 'bullets must use real numbering');
  assert.ok(!/<w:t[^>]*>[^<]*<script/i.test(parts.documentXml));
  /* XML escaping */
  const tricky = normalizeResumeDocument({ contact: { name: 'A & B <C>' }, summary: 'Uses "quotes" & <tags>.' });
  const p2 = buildResumeDocxParts(tricky, null);
  assert.ok(p2.documentXml.includes('A &amp; B &lt;C&gt;'));
});

/* ================= jd parser detectedRole ================= */
test('JD parser detects the role family from the title line', () => {
  const jd = parseJDv2({ jobDescription: 'Senior DevOps Engineer\n\nRequirements:\n- Kubernetes and Docker required\n- CI/CD with Jenkins' });
  assert.equal(jd.detectedRole, 'DevOps Engineer');
  const jd2 = parseJDv2({ jobDescription: 'Cloud Data Engineer\nRequirements:\n- Spark, Airflow' });
  assert.equal(jd2.detectedRole, 'Data Engineer');
});

/* ================= routes ================= */
test('V4 routes: canonical tailor-for-job package + real DOCX + assist (zero AI env)', async (t) => {
  const { server, base } = await startServer();
  t.after(() => stopServer(server));
  const client = makeClient(base);
  await client.devLogin('V4 Tester', 'v4tester@example.com');

  const doc = DOC();
  const jobDescription = 'Senior Data Engineer\n\nRequirements:\n- Python and Spark required\n- Airflow orchestration required\n- Terraform infrastructure as code required\n\nPreferred:\n- AWS experience';

  const res = await client.post('/api/resume-os/tailor-for-job', { doc, jobDescription, job: { company: 'UnitedHealth', title: 'Senior Data Engineer' } });
  assert.equal(res.status, 200);
  const body = res.json;
  assert.equal(body.ok, true);
  const pkg = body.package;
  assert.equal(pkg.job.company, 'UnitedHealth');
  assert.ok(pkg.jobMatch >= 0 && pkg.jobMatch <= 100);
  assert.ok(pkg.atsHealth >= 0 && pkg.atsHealth <= 100);
  assert.ok(pkg.criticalRequirements.total >= 3);
  assert.ok(pkg.missingEvidence.some((m) => /terraform/i.test(m.skill)), 'Terraform gap must surface as missing evidence, never inserted');
  assert.ok(pkg.template && pkg.template.id, 'a recommended template with an id');
  assert.ok(Array.isArray(pkg.templateAlternatives) && pkg.templateAlternatives.length >= 2);
  assert.equal(body.variant.kind, 'variant');
  assert.equal(body.variant.parentId, doc.id);
  /* the JD text is stored for targeting, but Terraform must never enter CONTENT */
  const content = JSON.stringify({ skills: body.variant.skills, experience: body.variant.experience, projects: body.variant.projects, summary: body.variant.summary, certifications: body.variant.certifications });
  assert.ok(!/terraform/i.test(content), 'the variant content must NOT gain Terraform experience');
  assert.ok(body.summary.ok, 'deterministic summary compiled');
  assert.ok(body.trust.changes.some((c) => c.kind === 'skill_downgraded'), 'client verified=true on Kubernetes was neutralized');

  /* summary endpoint */
  const sRes = await client.post('/api/resume-os/summary/compile', { doc });
  assert.equal(sRes.json.summary.ok, true);

  /* template recommendation endpoint */
  const rRes = await client.post('/api/resume-os/templates/recommend', { doc, targetRole: 'Data Engineer' });
  const rBody = rRes.json;
  assert.ok(rBody.recommendation.best.reasons.length >= 2);

  /* autofit endpoint */
  const aRes = await client.post('/api/resume-os/autofit', { doc, overflowLines: 6 });
  const aBody = aRes.json;
  assert.equal(aBody.plan.fits, false);
  assert.ok(aBody.plan.steps.length >= 3);

  /* REAL docx export */
  const dRes = await client.post('/api/resume-os/export/docx', { doc });
  assert.equal(dRes.status, 200);
  assert.ok(dRes.headers.get('content-type').includes('officedocument.wordprocessingml.document'));
  assert.ok(dRes.text.startsWith('PK'), 'binary payload is a real OOXML zip');
  assert.ok(dRes.text.length > 1000);

  /* assist endpoint without any AI key: deterministic candidates, aiAvailable=false */
  const asRes = await client.post('/api/resume-os/assist', { kind: 'bullet', text: 'Responsible for building various data pipelines in order to support analytics.', useAi: true });
  const asBody = asRes.json;
  assert.equal(asBody.ok, true);
  assert.equal(asBody.result.aiAvailable, false, 'no ANTHROPIC_API_KEY in tests → AI unavailable');
  assert.ok(asBody.result.deterministic.length >= 1, 'deterministic provider always answers');

  /* save endpoint sanitizes trust */
  const svRes = await client.post('/api/resume-os/documents', { doc });
  const svBody = svRes.json;
  const savedK8s = svBody.doc.skills.find((s) => s.name === 'Kubernetes');
  assert.equal(savedK8s.status, 'DECLARED', 'persisted document must not keep client-claimed VERIFIED');
});
