// Project identity — regression guard.
//
// Bug: clicking "Build this" on a recommendation created a workspace named
// "Production-grade Full Stack project for AIML Engineer" instead of the idea
// the student actually picked. Cause: the roadmap generator's template branch
// synthesised a title from (type, role) and ignored the caller's, and the
// client merged the server project OVER the local one. Because every build in
// a session then produced an identical title, the store's title-based dedupe
// folded them all into a single workspace.
//
// These tests lock the invariant: whoever asks for a project owns its name.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeClient } from './helpers.js';

const REC_A = {
  title: 'Real-Time Money Flow Monitoring & Alerting (explainable decisions)',
  problem: 'For freelancers & small businesses, where cash-flow, invoices and reconciliation are spread across spreadsheets.',
};
const REC_B = {
  title: 'The Dev Workflow Static Analyzer / Scanner CLI (explainable decisions)',
  problem: 'For engineering teams, where config errors, secret leaks and flaky pipelines slip through review.',
};
const BASE = { targetRole: 'AIML Engineer', difficulty: 'Advanced', duration: '1 month', type: 'Full Stack' };

let server; let base; let client;
before(async () => {
  ({ server, base } = await startServer());
  client = makeClient(base);
  await client.devLogin('Identity Tester', 'identity-tester@example.com');
});
after(async () => { await stopServer(server); });

test('generate-roadmap keeps the caller-supplied title', async () => {
  const r = await client.post('/api/projects/generate-roadmap', {
    ...BASE, title: REC_A.title, problemStatement: REC_A.problem,
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.project.title, REC_A.title);
  assert.equal(r.json.project.problemStatement, REC_A.problem);
});

test('generate-roadmap never renames a project to the generic template string', async () => {
  const r = await client.post('/api/projects/generate-roadmap', {
    ...BASE, title: REC_A.title, problemStatement: REC_A.problem,
  });
  assert.doesNotMatch(
    String(r.json.project.title),
    /^Production-grade .+ project for /i,
    'the chosen recommendation title must survive generation',
  );
});

test('two different recommendations produce two differently-named projects', async () => {
  const [a, b] = await Promise.all([
    client.post('/api/projects/generate-roadmap', { ...BASE, title: REC_A.title, problemStatement: REC_A.problem }),
    client.post('/api/projects/generate-roadmap', { ...BASE, title: REC_B.title, problemStatement: REC_B.problem }),
  ]);
  assert.equal(a.json.project.title, REC_A.title);
  assert.equal(b.json.project.title, REC_B.title);
  assert.notEqual(a.json.project.title, b.json.project.title);
});

test('the generic title is still used when the caller supplies none', async () => {
  const r = await client.post('/api/projects/generate-roadmap', BASE);
  assert.equal(r.status, 200);
  assert.ok(String(r.json.project.title || '').trim().length > 0, 'an unnamed project still gets a name');
});

test('a blank or whitespace title falls back rather than naming the project ""', async () => {
  const r = await client.post('/api/projects/generate-roadmap', { ...BASE, title: '   ' });
  assert.ok(String(r.json.project.title || '').trim().length > 0);
});

test('supplying a title does not break the rest of the project contract', async () => {
  const r = await client.post('/api/projects/generate-roadmap', {
    ...BASE, title: REC_A.title, problemStatement: REC_A.problem,
  });
  const p = r.json.project;
  assert.ok(Array.isArray(p.techStack) && p.techStack.length > 0);
  assert.ok(Array.isArray(p.steps) && p.steps.length > 0);
  assert.ok(Array.isArray(p.skillsCovered) && p.skillsCovered.length > 0);
  assert.ok(p.architectureSpec, 'architecture spec still attached');
});
