/* ============================================================
   RESUME NARRATIVE — route + regression tests
   ------------------------------------------------------------
   Boots the real Express app. Proves the new endpoints work and
   that every existing Resume OS / Template OS contract still
   holds after the narrative layer was added.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeClient } from './helpers.js';
import { fixtureById } from './fixtures/resumeNarrativeFixtures.js';

let server; let base; let api;

test.before(async () => {
  const s = await startServer();
  server = s.server; base = s.base;
  api = makeClient(base);
  const login = await api.devLogin('Narrative Tester', 'narrative@test.dev');
  assert.ok(login.status < 400, `dev login failed: ${login.status}`);
});
test.after(async () => { await stopServer(server); });

const DEVOPS = () => fixtureById('devops_engineer');

/* ============================================================
   New endpoints
   ============================================================ */
test('route: POST /api/resume-os/enhance returns a full narrative package', async () => {
  const f = DEVOPS();
  const r = await api.post('/api/resume-os/enhance', { doc: f.doc, useAi: false });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.mode, 'enhance');
  assert.ok(r.json.doc, 'a ResumeDocument comes back');
  assert.ok(r.json.bullets.length >= 4);
  assert.ok(r.json.summary.chosen.length > 20);
  assert.equal(r.json.narrativeTruth.unsupportedClaimCount, 0);
  /* The deterministic Resume OS verdicts are still present and authoritative. */
  assert.ok(r.json.truth, 'truth engine verdict');
  assert.ok(Number.isFinite(r.json.health.score), 'ATS V3 score');
  assert.ok(r.json.engineVersions.narrative);
  assert.ok(r.json.telemetry.durationMs >= 0);
});

test('route: enhance never persists unless asked', async () => {
  const f = DEVOPS();
  const r = await api.post('/api/resume-os/enhance', { doc: f.doc, useAi: false });
  assert.equal(r.json.persisted, false);
});

test('route: POST /api/resume-os/tailor-narrative returns a variant, not a mutation', async () => {
  const f = DEVOPS();
  const r = await api.post('/api/resume-os/tailor-narrative', {
    doc: f.doc, jobDescription: f.jd, job: f.job, useAi: false, useExternalResearch: false,
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.variant.kind, 'variant');
  assert.equal(r.json.variant.parentId, f.doc.id, 'the variant points back at the master');
  assert.notEqual(r.json.variant.id, f.doc.id, 'the master document id is never reused');
  /* Same package contract as the existing tailor-for-job endpoint. */
  assert.ok(Number.isFinite(r.json.package.jobMatch));
  assert.ok(Number.isFinite(r.json.package.atsHealth));
  assert.ok(Number.isFinite(r.json.package.evidenceCoverage));
  assert.ok(r.json.package.criticalRequirements);
  assert.ok(Array.isArray(r.json.package.missingEvidence));
  assert.ok(r.json.package.template, 'a template is recommended');
});

test('route: tailoring reports gaps instead of inserting unsupported skills', async () => {
  const f = DEVOPS();
  const r = await api.post('/api/resume-os/tailor-narrative', {
    doc: f.doc, jobDescription: f.jd, job: f.job, useAi: false, useExternalResearch: false,
  });
  const text = [r.json.summary.chosen, ...r.json.bullets.map((b) => b.text)].join(' ').toLowerCase();
  assert.ok(!/terraform/.test(text));
  assert.ok(r.json.gaps.gaps.some((g) => /terraform/i.test(g.skill || '')));
  assert.equal(r.json.narrativeTruth.unsupportedClaimCount, 0);
});

test('route: external research is off by default and reported honestly', async () => {
  const f = DEVOPS();
  const r = await api.post('/api/resume-os/tailor-narrative', {
    doc: f.doc, jobDescription: f.jd, job: f.job, useAi: false,
  });
  assert.equal(r.json.externalContext.available, false);
  assert.equal(r.json.ok, true, 'tailoring works entirely without research');
});

test('route: change intelligence explains what changed and why', async () => {
  const f = DEVOPS();
  const r = await api.post('/api/resume-os/enhance', { doc: f.doc, useAi: false });
  assert.ok(r.json.changes.entries.length > 0);
  const changed = r.json.changes.entries.filter((e) => e.changed);
  assert.ok(changed.length > 0);
  for (const e of changed) {
    assert.ok(e.original !== undefined && e.enhanced);
    assert.ok(e.reason.length > 10, 'every change carries a human-readable reason');
    assert.ok(e.evidenceId, 'and a traceable evidence id');
  }
});

test('route: POST /api/resume-os/narrative/preview scores one bullet', async () => {
  const r = await api.post('/api/resume-os/narrative/preview', {
    text: 'Responsible for various deployment tasks using Jenkins.',
    targetRole: 'DevOps Engineer',
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(r.json.bullet);
  assert.ok(r.json.bullet.metadata.finalScore > 0);
  assert.ok(Array.isArray(r.json.bullet.alternatives));
});

test('route: input validation rejects a too-short job description', async () => {
  const f = DEVOPS();
  const r = await api.post('/api/resume-os/tailor-narrative', { doc: f.doc, jobDescription: 'short' });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'invalid_input');
});

test('route: the narrative endpoints require authentication', async () => {
  const anon = await makeClient(base).bootstrap();
  const r = await anon.post('/api/resume-os/enhance', { doc: DEVOPS().doc });
  assert.ok(r.status === 401 || r.status === 403, `expected auth rejection, got ${r.status}`);
});

/* ============================================================
   Trust boundary still applies to the new path
   ============================================================ */
test('route: a client-claimed VERIFIED skill is downgraded before enhancement', async () => {
  const doc = {
    ...DEVOPS().doc,
    skills: [{ id: 'sk1', name: 'Kubernetes', status: 'VERIFIED' }, { id: 'sk2', name: 'Helm' }],
  };
  const r = await api.post('/api/resume-os/enhance', { doc, useAi: false });
  assert.equal(r.json.ok, true);
  const k8s = r.json.doc.skills.find((s) => /kubernetes/i.test(s.name));
  assert.notEqual(k8s.status, 'VERIFIED', 'client-side verification claims never survive');
  assert.ok(r.json.trust, 'the trust boundary result is reported');
});

/* ============================================================
   REGRESSION — existing Resume OS contracts
   ============================================================ */
test('regression: /api/resume-os/tailor-for-job is unchanged', async () => {
  const f = DEVOPS();
  const r = await api.post('/api/resume-os/tailor-for-job', {
    doc: f.doc, jobDescription: f.jd, job: f.job,
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  for (const key of ['package', 'variant', 'jd', 'match', 'ranking', 'budgetPlan', 'summary', 'truth', 'health', 'templateRanking']) {
    assert.ok(key in r.json, `tailor-for-job must still return ${key}`);
  }
  assert.equal(r.json.variant.kind, 'variant');
});

test('regression: /api/resume-os/compile still runs the deterministic pipeline', async () => {
  const f = DEVOPS();
  const r = await api.post('/api/resume-os/compile', { doc: f.doc, jobDescription: f.jd });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(r.json.truth && r.json.health && r.json.ranking);
  assert.ok(r.json.nextBestAction);
});

test('regression: /api/resume-os/assist still returns deterministic candidates', async () => {
  const r = await api.post('/api/resume-os/assist', {
    kind: 'bullet', text: 'Responsible for working on various deployment tasks.', useAi: false,
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(r.json.result.deterministic.length > 0);
  assert.equal(r.json.result.ai.length, 0);
});

test('regression: template recommendation and text export still work', async () => {
  const f = DEVOPS();
  const rec = await api.post('/api/resume-os/templates/recommend', { doc: f.doc });
  assert.equal(rec.status, 200);
  assert.ok(rec.json.recommendation.best);

  const txt = await api.post('/api/resume-os/export/text', { doc: f.doc });
  assert.equal(txt.status, 200);
  assert.match(txt.json.text, /EXPERIENCE/);
});

test('regression: DOCX export still produces a real docx', async () => {
  const f = DEVOPS();
  const cookie = [...api.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(`${base}/api/resume-os/export/docx`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      'X-CSRF-Token': api.jar.get('ca_csrf') || '',
    },
    body: JSON.stringify({ doc: f.doc }),
  });
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString(), 'PK', 'a .docx is a zip container');
  assert.ok(buf.length > 1000);
});

test('regression: an enhanced document is still a valid ResumeDocument', async () => {
  const f = DEVOPS();
  const enhanced = await api.post('/api/resume-os/enhance', { doc: f.doc, useAi: false });
  const doc = enhanced.json.doc;

  /* It must survive every downstream consumer untouched. */
  const compile = await api.post('/api/resume-os/compile', { doc });
  assert.equal(compile.json.ok, true);

  const txt = await api.post('/api/resume-os/export/text', { doc });
  assert.equal(txt.json.ok, true);
  assert.ok(txt.json.text.length > 100);

  const tailor = await api.post('/api/resume-os/tailor-for-job', { doc, jobDescription: f.jd, job: f.job });
  assert.equal(tailor.json.ok, true);
});

test('regression: existing saved-document shapes remain readable', async () => {
  /* A pre-narrative document: no metadata.narrative, no template version pin. */
  const legacy = {
    id: 'rd_legacy', title: 'Legacy Resume', targetRole: 'DevOps Engineer',
    contact: { name: 'Legacy User' },
    summary: 'Old summary text.',
    skills: ['Docker', 'Jenkins'],
    experience: [{ company: 'OldCo', role: 'Engineer', dates: '2019 - 2021', bullets: ['Did deployment work with Jenkins.'] }],
  };
  const r = await api.post('/api/resume-os/enhance', { doc: legacy, useAi: false });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.doc.experience.length, 1);
  assert.ok(r.json.doc.skills.length >= 2);
});

test('regression: engine versions expose both the deterministic and narrative layers', async () => {
  const r = await api.get('/api/resume-os/documents');
  assert.equal(r.status, 200);
  const v = r.json.engineVersions;
  for (const key of ['document', 'truth', 'ats', 'jdParser', 'jobMatch', 'trustBoundary', 'summary', 'contentBudget', 'templateRecommender', 'writingProviders', 'docx']) {
    assert.ok(v[key], `existing engine version ${key} must still be reported`);
  }
  assert.ok(v.narrative, 'the narrative layer reports its version too');
  assert.ok(v.narrativeStages.evidenceGraph);
});
