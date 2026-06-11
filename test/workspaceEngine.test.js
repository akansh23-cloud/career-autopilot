// Guided Project Workspace — engine unit tests (pure, no DB/network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkspacePlan, recalculatePlan, applyTaskPatch,
  normalizeCustomProject, runVerification,
} from '../server/utils/workspace/index.js';

const customInput = {
  title: 'Campus Skill Exchange',
  problemStatement: 'Students cannot find peers to swap skills with.',
  targetUsers: 'University students',
  category: 'Marketplace',
  difficulty: 'intermediate',
  techStack: ['React', 'Node.js', 'Express', 'MongoDB'],
  flags: { auth: true, upload: true, payment: true, patent: true },
};

function makePlan() {
  const project = normalizeCustomProject(customInput, { now: '2026-01-01T00:00:00.000Z' });
  return { project, plan: buildWorkspacePlan({ project, architecture: null, userId: 'u1' }) };
}

test('normalizeCustomProject maps the form payload (flags object, lowercase difficulty)', () => {
  const p = normalizeCustomProject(customInput);
  assert.equal(p.isCustom, true);
  assert.equal(p.difficulty, 'Intermediate');
  assert.equal(p.flags.auth, true);
  assert.equal(p.flags.payment, true);
  assert.equal(p.flags.patent, true);
  assert.equal(p.flags.admin, false);
  assert.ok(p.id.startsWith('custom_'));
});

test('buildWorkspacePlan produces every required section', () => {
  const { plan } = makePlan();
  for (const key of ['projectSummary', 'mvpScope', 'visualPreview', 'architecture', 'roadmap', 'tasks',
    'fileTree', 'apiPlan', 'databaseModels', 'testPlan', 'deploymentPlan', 'proofRequirements',
    'patentAssets', 'starterPack', 'progress', 'currentPhase', 'nextAction', 'validation']) {
    assert.ok(plan[key] !== undefined, `missing ${key}`);
  }
  assert.ok(plan.tasks.length >= 10);
  assert.ok(plan.visualPreview.screens.length >= 4);
  assert.ok(plan.apiPlan.length >= 6);
  assert.equal(plan.patentAssets.enabled, true);
  assert.equal(plan.starterPack.available, false, 'starter pack must not be marked available before generation');
});

test('plan generation is deterministic for the same input', () => {
  const project = normalizeCustomProject(customInput, { now: '2026-01-01T00:00:00.000Z' });
  project.id = 'fixed_id';
  const a = buildWorkspacePlan({ project, architecture: null, userId: 'u1', now: '2026-01-01T00:00:00.000Z' });
  const b = buildWorkspacePlan({ project, architecture: null, userId: 'u1', now: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(a.tasks.map((t) => t.id), b.tasks.map((t) => t.id));
  assert.deepEqual(a.fileTree.map((f) => f.path), b.fileTree.map((f) => f.path));
});

test('cross-links resolve: task linked files/apis exist in the plan', () => {
  const { plan } = makePlan();
  const fileIds = new Set(plan.fileTree.map((f) => f.id));
  const apiIds = new Set(plan.apiPlan.map((a) => a.id));
  for (const t of plan.tasks) {
    for (const f of t.linkedFiles || []) assert.ok(fileIds.has(f), `task ${t.id} links missing file ${f}`);
    for (const a of t.linkedApis || []) assert.ok(apiIds.has(a), `task ${t.id} links missing api ${a}`);
  }
});

test('applyTaskPatch moves status and progress separates done vs verified', () => {
  const { plan } = makePlan();
  const task = plan.tasks.find((t) => t.status === 'ready') || plan.tasks[0];
  const r1 = applyTaskPatch(plan, task.id, { status: 'done' });
  assert.ok(r1.plan, 'applyTaskPatch returns the updated plan');
  const p1 = recalculatePlan(r1.plan);
  assert.equal(p1.progress.doneTasks, 1);
  assert.equal(p1.progress.verifiedTasks, 0);
  assert.ok(p1.progress.percentDone > 0);
  assert.equal(p1.progress.percentVerified, 0, 'marking Done must not count as Verified');
});

test('users cannot self-mark Verified — patch downgrades to done', () => {
  const { plan } = makePlan();
  const task = plan.tasks[0];
  const r = applyTaskPatch(plan, task.id, { status: 'verified' });
  const updated = r.plan.tasks.find((t) => t.id === task.id);
  assert.equal(updated.status, 'done');
  assert.ok((r.notes || []).length >= 1, 'should explain the downgrade');
});

test('blocked tasks require/keep a blocker reason and unblocking clears it', () => {
  const { plan } = makePlan();
  const task = plan.tasks[0];
  const blocked = applyTaskPatch(plan, task.id, { status: 'blocked', blockerReason: 'Waiting on API key' });
  assert.equal(blocked.plan.tasks.find((t) => t.id === task.id).blockerReason, 'Waiting on API key');
  const unblocked = applyTaskPatch(blocked.plan, task.id, { status: 'in_progress' });
  assert.equal(unblocked.plan.tasks.find((t) => t.id === task.id).blockerReason, '');
});

test('regenerate preserves task progress by stable id', () => {
  const { project, plan } = makePlan();
  const task = plan.tasks[2];
  const moved = applyTaskPatch(plan, task.id, { status: 'in_progress' }).plan;
  const regenerated = buildWorkspacePlan({ project, architecture: null, existingPlan: moved, userId: 'u1' });
  assert.equal(regenerated.tasks.find((t) => t.id === task.id)?.status, 'in_progress');
});

test('runVerification is honest: github/deployment proofs stay pending in v1', () => {
  const { plan } = makePlan();
  const { proofRequirements, verificationSummary } = runVerification(plan);
  for (const p of proofRequirements) {
    if (p.verificationMethod === 'github' || p.verificationMethod === 'deployment') {
      assert.notEqual(p.status, 'verified', `${p.id} must not auto-verify in v1`);
    }
  }
  assert.ok(verificationSummary.checks.length >= 1);
  assert.ok(verificationSummary.note.includes('Done is not Verified'));
  // verification only touches proof items — tasks remain user-driven
  assert.ok(plan.tasks.every((t) => t.status !== 'verified'));
});

test('recalculatePlan keeps percentDone consistent with statuses', () => {
  const { plan } = makePlan();
  let p = plan;
  for (const t of p.tasks.slice(0, 4)) p = applyTaskPatch(p, t.id, { status: 'done' }).plan;
  p = recalculatePlan(p);
  assert.equal(p.progress.doneTasks, 4);
  assert.equal(p.progress.percentDone, Math.round((4 / p.tasks.length) * 100));
});

test('deployment plan exposes env var names but never values', () => {
  const { plan } = makePlan();
  const d = plan.deploymentPlan;
  assert.ok(Array.isArray(d.requiredEnvVars) && d.requiredEnvVars.length > 0);
  for (const v of d.requiredEnvVars) {
    assert.equal(typeof v, 'string');
    assert.ok(!v.includes('='), 'env vars must be names only');
  }
});

test('patent tab is disabled when the flag is off', () => {
  const project = normalizeCustomProject({ ...customInput, flags: { ...customInput.flags, patent: false } });
  const plan = buildWorkspacePlan({ project, architecture: null, userId: 'u1' });
  assert.equal(plan.patentAssets.enabled, false);
});
