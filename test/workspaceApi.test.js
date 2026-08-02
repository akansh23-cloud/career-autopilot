// Guided Project Workspace — API endpoint tests.
// NOTE: requires `npm install` (express etc). Run locally via `npm test`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeClient } from './helpers.js';

let server;
let base;
let c;

const customInput = {
  title: 'Campus Skill Exchange',
  problemStatement: 'Students cannot find peers to swap skills with.',
  category: 'Marketplace',
  techStack: ['React', 'Node.js', 'Express', 'MongoDB'],
  flags: { auth: true, upload: true },
};

before(async () => {
  ({ server, base } = await startServer());
  c = makeClient(base);
  await c.devLogin('Workspace Tester', 'workspace.tester@example.com');
});
after(async () => { await stopServer(server); });

let plan;
const pid = 'ws_test_project';

test('POST /api/workspace/generate builds a plan from a custom project', async () => {
  const r = await c.post('/api/workspace/generate', { projectId: pid, customInput });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  plan = r.json.workspacePlan;
  assert.ok(plan.tasks.length >= 10);
  assert.equal(plan.starterPack.available, false);
  assert.equal(r.json.project.isCustom, true);
});

test('workspace routes are auth-gated', async () => {
  const anon = makeClient(base);
  const r = await anon.post('/api/workspace/generate', { customInput });
  assert.ok([401, 403].includes(r.status));
});

test('PATCH tasks: user cannot self-mark Verified', async () => {
  const task = plan.tasks[0];
  const r = await c.patch(`/api/workspace/${pid}/tasks/${task.id}`, { workspacePlan: plan, status: 'verified' });
  assert.equal(r.status, 200);
  assert.equal(r.json.task.status, 'done', 'verified downgrades to done');
  assert.ok(r.json.notes.length >= 1);
  plan = r.json.workspacePlan;
  assert.equal(plan.progress.verifiedTasks, 0);
  assert.ok(plan.progress.doneTasks >= 1);
});

test('PATCH tasks: unknown task id returns 404', async () => {
  const r = await c.patch(`/api/workspace/${pid}/tasks/nope`, { workspacePlan: plan, status: 'done' });
  assert.equal(r.status, 404);
});

test('POST verify with no evidence: github/deployment stay pending', async () => {
  const r = await c.post(`/api/workspace/${pid}/verify`, { workspacePlan: plan });
  assert.equal(r.status, 200);
  const s = r.json.verificationSummary;
  // No repo/deploy URL attached => nothing network-backed can be observed.
  assert.equal(s.mode, 'local_only');
  const netChecks = s.checks.filter((ch) => ch.method === 'github' || ch.method === 'deployment');
  assert.ok(netChecks.length >= 1, 'fixture should contain network-backed proof items');
  assert.ok(netChecks.every((ch) => ch.result === 'pending'));
  // The pending note must tell the student what to do, not just say "pending".
  assert.ok(netChecks.every((ch) => /attach/i.test(ch.note)));
  plan = r.json.updatedWorkspacePlan;
});

test('POST verify with unusable evidence never fakes a pass', async () => {
  // Malformed URLs are rejected before any network call, so this stays fast
  // and deterministic. The contract under test: a check that cannot run
  // yields `pending`, never `verified` and never `failed`.
  const r = await c.post(`/api/workspace/${pid}/verify`, {
    workspacePlan: plan,
    evidence: { repoUrl: 'definitely-not-a-repo', liveUrl: 'not a url' },
  });
  assert.equal(r.status, 200);
  const s = r.json.verificationSummary;
  assert.equal(s.mode, 'evidence_backed');
  const netChecks = s.checks.filter((ch) => ch.method === 'github' || ch.method === 'deployment');
  assert.ok(netChecks.every((ch) => ch.result === 'pending'));
  assert.equal(s.evidenceUsed.repoUrl, 'definitely-not-a-repo');
  assert.equal(s.evidenceUsed.testOutputProvided, false);
  plan = r.json.updatedWorkspacePlan;
});

test('verify persists attached evidence so it need not be re-pasted', async () => {
  const r = await c.post(`/api/workspace/${pid}/verify`, { workspacePlan: plan });
  assert.equal(r.status, 200);
  // The previous test attached a repoUrl; it should still be on the plan.
  assert.equal(r.json.updatedWorkspacePlan.proofEvidence.repoUrl, 'definitely-not-a-repo');
  plan = r.json.updatedWorkspacePlan;
});

test('POST codegen/preview returns starter code with warnings', async () => {
  const task = plan.tasks.find((t) => (t.linkedFiles || []).length > 0);
  const r = await c.post(`/api/workspace/${pid}/codegen/preview`, { workspacePlan: plan, taskId: task.id });
  assert.equal(r.status, 200);
  assert.ok(r.json.generatedFiles.length >= 1);
  assert.ok(r.json.warnings.some((w) => /not verified/i.test(w)));
});

test('starter pack preview + generate + download round-trip', async () => {
  const prev = await c.post(`/api/workspace/${pid}/starter-pack/preview`, { workspacePlan: plan });
  assert.equal(prev.status, 200);
  assert.ok(prev.json.files.length >= 10);

  const gen = await c.post(`/api/workspace/${pid}/starter-pack/generate`, { workspacePlan: plan });
  assert.equal(gen.status, 200);
  assert.ok(gen.json.packId);
  assert.ok(gen.json.downloadUrl.includes(gen.json.packId));
  assert.ok(gen.json.warnings.some((w) => /starter skeleton/i.test(w)));

  const dl = await c.get(gen.json.downloadUrl);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-type') || '', /application\/zip/);
});

test('generating a starter pack never changes task statuses', async () => {
  const before = plan.tasks.map((t) => t.status).join(',');
  await c.post(`/api/workspace/${pid}/starter-pack/generate`, { workspacePlan: plan });
  const after = plan.tasks.map((t) => t.status).join(',');
  assert.equal(before, after);
});

test('POST recalculate returns a consistent plan', async () => {
  const r = await c.post(`/api/workspace/${pid}/recalculate`, { workspacePlan: plan });
  assert.equal(r.status, 200);
  assert.equal(r.json.workspacePlan.progress.totalTasks, plan.tasks.length);
});

test('input validation rejects oversized garbage', async () => {
  const r = await c.post('/api/workspace/generate', { projectId: 'x'.repeat(500) });
  assert.equal(r.status, 400);
});

test('GET unknown workspace returns null plan (drives the Generate Workspace CTA)', async () => {
  const r = await c.get('/api/workspace/no_such_project');
  assert.equal(r.status, 200);
  assert.equal(r.json.workspacePlan, null);
});

test('PATCH architecturePatch syncs into the plan and marks artifacts stale', async () => {
  const newSpec = { ...(plan.architecture?.architectureSpec || {}), refinedAt: 'api-test' };
  const r = await c.patch(`/api/workspace/${pid}`, { workspacePlan: plan, architecturePatch: { architectureSpec: newSpec, validation: { score: { overallScore: 88 }, checks: [], warnings: [] } } });
  assert.equal(r.status, 200);
  assert.equal(r.json.architectureChanged, true);
  assert.equal(r.json.workspacePlan.architecture.designScore, 88);
  assert.equal(r.json.workspacePlan.docsStale, true);
  plan = r.json.workspacePlan;
});
