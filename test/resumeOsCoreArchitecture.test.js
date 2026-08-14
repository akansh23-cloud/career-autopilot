import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { normalizeResumeDocument, toPlainText } from '../server/utils/resume/resumeDocument.js';
import { evaluateResumeQuality } from '../server/services/resumeOs/resumeQualityEvaluator.js';
import { enhance, improveAgain, optimizeResume, tailorForJob } from '../server/services/resumeOs/resumeOsApplicationService.js';
import { readOptimizationHistory, resumeStateHash } from '../server/services/resumeOs/optimizationHistory.js';
import { FIXTURES } from './fixtures/resumeNarrativeFixtures.js';

function weakDoc() {
  return normalizeResumeDocument({
    id: 'core-doc', title: 'Core test', targetRole: 'Backend Engineer',
    contact: { name: 'Test Candidate', email: 'test@example.com' },
    summary: 'Backend engineer working on various projects and delivering work end to end.',
    skills: [{ id: 's1', name: 'Spring Boot', enabled: true }, { id: 's2', name: 'Java', enabled: true }],
    experience: [{ id: 'e1', company: 'Acme', role: 'Software Engineer', current: true, enabled: true, bullets: [
      { id: 'b1', text: 'Worked on a Spring Boot service for internal ticket routing.', enabled: true },
      { id: 'b2', text: 'Wrote SQL validation queries for settlement records.', enabled: true },
    ] }],
    education: [{ id: 'ed1', school: 'Example University', degree: 'B.Tech', enabled: true }],
  });
}

const JD = `Backend Engineer. Required: Java, Spring Boot, REST APIs, SQL. Build and maintain backend services, write tests, collaborate on production delivery. Preferred: Docker and AWS.`;
const context = { verifiedSkills: [], profileSkills: [], userKey: 'core-test', plan: 'premium' };

test('global quality is mode-independent for an unchanged ResumeDocument', () => {
  const doc = weakDoc();
  const a = evaluateResumeQuality(doc, { jobDescription: JD, targetRole: doc.targetRole });
  const b = evaluateResumeQuality({ ...doc, metadata: { ...(doc.metadata || {}), lastTailoringMode: 'concise', lastDepth: 'deep' } }, { jobDescription: JD, targetRole: doc.targetRole });
  assert.equal(a.overall, b.overall);
  assert.deepEqual(a.dimensions, b.dimensions);
  assert.equal(a.confidence.layout, 'N/A_PENDING_RENDER_FINALIZATION');
});

test('no-JD quality reports JD relevance as N/A rather than fake points', () => {
  const q = evaluateResumeQuality(weakDoc());
  assert.equal(q.dimensions.jdRelevance, null);
  assert.equal(q.confidence.jdRelevance, 'N/A');
});

test('AI-off enhance makes zero provider calls and preserves canonical truth boundary', async () => {
  let fetchCalls = 0;
  const r = await enhance({ doc: weakDoc(), context, aiPolish: false, fetchImpl: async () => { fetchCalls += 1; throw new Error('must not call'); } });
  assert.equal(r.ok, true);
  assert.equal(fetchCalls, 0);
  assert.equal(r.aiPolish.calls, 0);
  assert.equal(r.canonical.telemetry?.ai?.totalCalls ?? 0, 0);
  assert.equal(r.quality.hardFailures.length, 0);
});

test('optional Gemini is wording-candidate-only and cannot bypass action provenance', async () => {
  const r = await enhance({
    doc: weakDoc(), context, aiPolish: true,
    env: { GEMINI_API_KEY: 'test-key', GEMINI_RESUME_MODEL: 'gemini-3.6-flash' },
    fetchImpl: async () => ({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ units: [
        { bulletId: 'b1', candidates: ['Successfully designed a Spring Boot service for internal ticket routing.'] },
      ] }) }] } }] }),
    }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.aiPolish.calls, 1);
  assert.equal(r.aiPolish.applied, 0, 'unsupported Gemini action must not be applied');
  assert.ok(r.aiPolish.rejected >= 1, 'unsafe candidate should be rejected by Career Autopilot truth gates');
  assert.doesNotMatch(toPlainText(r.resumeDocument), /Successfully designed a Spring Boot service/i);
});

test('optional Gemini may improve wording only when an evidence-equivalent candidate passes truth gates', async () => {
  const fixture = FIXTURES.find((x) => x.id === 'devops_engineer');
  const responseText = JSON.stringify({ units: [{ bulletId: 'b1', candidates: [
    'Configured Java 17 service deployments across OpenShift environments with Helm and ConfigMaps.',
  ] }] });
  const r = await enhance({
    doc: fixture.doc, context: {}, aiPolish: true,
    env: { GEMINI_API_KEY: 'test-key', GEMINI_RESUME_MODEL: 'gemini-3.6-flash' },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: responseText }] } }] }) }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.aiPolish.calls, 1);
  assert.equal(r.aiPolish.applied, 1);
  assert.match(toPlainText(r.resumeDocument), /Configured Java 17 service deployments across OpenShift environments with Helm and ConfigMaps\./);
  assert.equal(r.quality.hardFailures.length, 0);
});

test('Improve Again records an objective and never replaces the best with a worse version', async () => {
  const original = weakDoc();
  const r = await improveAgain({ doc: original, jobDescription: JD, targetRole: original.targetRole, context, aiPolish: false, minDelta: 0.5 });
  assert.equal(r.ok, true);
  assert.ok(r.objective || r.converged);
  if (r.accepted) {
    assert.ok(r.quality.overall >= r.beforeQuality.overall + 0.5);
    assert.notEqual(resumeStateHash(r.resumeDocument), resumeStateHash(original));
  } else {
    assert.equal(r.quality.overall, r.beforeQuality.overall);
  }
  const h = readOptimizationHistory(r.resumeDocument);
  if (r.objective) assert.ok(h.passes.some((p) => p.objective === r.objective));
});

test('rejected Improve Again attempt persists history so the next call selects a different objective', async () => {
  const base = await enhance({ doc: weakDoc(), context, aiPolish: false });
  const first = await improveAgain({ doc: base.resumeDocument, targetRole: base.resumeDocument.targetRole, context, aiPolish: false, minDelta: 0.5 });
  assert.ok(first.objective || first.converged);
  if (!first.converged && first.objective) {
    const second = await improveAgain({ doc: first.resumeDocument, targetRole: first.resumeDocument.targetRole, context, aiPolish: false, minDelta: 0.5 });
    if (second.objective) assert.notEqual(second.objective, first.objective, 'history must prevent repeating an exhausted objective');
  }
});

test('Optimize Resume is bounded, terminates, and accepted automatic versions are monotonic', async () => {
  const doc = weakDoc();
  const r = await optimizeResume({ doc, jobDescription: JD, targetRole: doc.targetRole, context, aiPolish: false, maxPasses: 4, minDelta: 0.5 });
  assert.equal(r.ok, true);
  assert.ok(r.passes.length <= 4);
  assert.ok(r.quality.overall >= r.beforeQuality.overall, 'best-version guarantee must prevent overall regression');
  for (const p of readOptimizationHistory(r.resumeDocument).passes.filter((x) => x.accepted)) {
    assert.ok(p.afterScore >= p.beforeScore + 0.5, `accepted pass ${p.objective} must improve globally`);
  }
  assert.ok(['OPTIMIZED', 'IMPROVED'].includes(r.status));
});

test('canonical job tailoring produces structured ResumeDocument with zero AI when polish is off', async () => {
  const r = await tailorForJob({ doc: weakDoc(), jobDescription: JD, targetRole: 'Backend Engineer', context, aiPolish: false });
  assert.equal(r.ok, true);
  assert.equal(r.resumeDocument.version != null, true);
  assert.equal(r.aiPolish.calls, 0);
  assert.ok(Array.isArray(r.changeLedger));
  assert.ok(Number.isFinite(r.quality.overall));
});

test('product surfaces no longer contain hidden full-resume AI-authoring bypasses', () => {
  const jobs = fs.readFileSync(new URL('../web/src/views/Jobs.jsx', import.meta.url), 'utf8');
  const editor = fs.readFileSync(new URL('../web/src/views/Editor.jsx', import.meta.url), 'utf8');
  const studio = fs.readFileSync(new URL('../web/src/views/ResumeStudio.jsx', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const pkg = fs.readFileSync(new URL('../server/utils/applicationPackageEngine.js', import.meta.url), 'utf8');
  const routes = fs.readFileSync(new URL('../server/routes/resumeOsRoutes.js', import.meta.url), 'utf8');

  assert.doesNotMatch(jobs, /"tailoredResume":"plain text resume"/);
  assert.doesNotMatch(jobs, /latexResume":"Jake/i);
  assert.match(jobs, /Applications\.generate\(/);
  assert.match(jobs, /AI\.message\(/, 'Jobs may still use AI for separate outreach drafting');
  assert.doesNotMatch(editor, /AI\.message\(/);
  assert.doesNotMatch(editor, /Rewrite and tailor the resume below/i);
  assert.match(editor, /ResumeOsApi\.tailorForJob\(/);
  assert.match(studio, /ResumeOsApi\.improveAgain\(/);
  assert.match(studio, /ResumeOsApi\.optimize\(/);
  assert.match(studio, /ResumeOsApi\.autofit\(/);
  assert.match(server, /appTailorForJob\(/);
  assert.doesNotMatch(pkg, /tailoringEngine\.js/);
  assert.match(pkg, /canonicalTailorForJob\(/);
  assert.match(routes, /appEnhance\(/);
  assert.match(routes, /appTailorForJob\(/);
  assert.match(routes, /appImproveAgain\(/);
  assert.match(routes, /appOptimizeResume\(/);
});
