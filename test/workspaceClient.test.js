// Guided Project Workspace — client selector tests (pure, mirrors
// clientLogic.test.js pattern: imports web/src/lib directly).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKSPACE_SECTIONS, TASK_COLUMNS, tasksByColumn, progressOf,
  designScoreOf, itemForInspector, linkedEntities, fileBadge,
  mergePlanIntoProject, validCustomInput, statusLabel,
} from '../web/src/lib/workspaceSelectors.js';
import { buildWorkspacePlan, normalizeCustomProject } from '../server/utils/workspace/index.js';

function makePlan() {
  const project = normalizeCustomProject({
    title: 'Campus Skill Exchange', problemStatement: 'x', techStack: ['React', 'Node.js', 'Express', 'MongoDB'],
  });
  return buildWorkspacePlan({ project, architecture: null, userId: 'u1' });
}

test('workspace exposes all 12 sections and 6 task columns', () => {
  assert.equal(WORKSPACE_SECTIONS.length, 12);
  assert.deepEqual(TASK_COLUMNS.map((c) => c.id), ['backlog', 'ready', 'in_progress', 'blocked', 'done', 'verified']);
});

test('tasksByColumn buckets every task exactly once', () => {
  const plan = makePlan();
  const cols = tasksByColumn(plan);
  const total = Object.values(cols).reduce((n, list) => n + list.length, 0);
  assert.equal(total, plan.tasks.length);
  assert.ok(cols.ready.length >= 1, 'first setup tasks start in Ready');
});

test('progressOf reads the engine progress and keeps done/verified separate', () => {
  const plan = makePlan();
  const p = progressOf(plan);
  assert.equal(p.totalTasks, plan.tasks.length);
  assert.equal(p.percentVerified, 0);
  assert.equal(progressOf(null).totalTasks, 0, 'safe on null plans');
});

test('itemForInspector + linkedEntities resolve plan cross-links', () => {
  const plan = makePlan();
  const task = plan.tasks.find((t) => (t.linkedFiles || []).length > 0);
  const resolved = itemForInspector(plan, { type: 'task', id: task.id });
  assert.equal(resolved.item.id, task.id);
  const linked = linkedEntities(plan, task);
  assert.equal(linked.files.length, task.linkedFiles.length, 'every linked file id resolves');
  const api = plan.apiPlan[0];
  assert.equal(itemForInspector(plan, { type: 'api', id: api.id }).item.id, api.id);
});

test('fileBadge is honest about template vs manual files', () => {
  assert.equal(fileBadge({ templateKey: 'readme', starterPackIncluded: true }), 'Starter template');
  assert.equal(fileBadge({ templateKey: '', starterPackIncluded: false }), 'Manual — you implement this');
  assert.equal(fileBadge({ verificationStatus: 'verified' }), 'Verified');
});

test('mergePlanIntoProject attaches the plan without losing project fields', () => {
  const plan = makePlan();
  const merged = mergePlanIntoProject({ id: 'p1', title: 'T', proofScore: 42 }, plan);
  assert.equal(merged.proofScore, 42);
  assert.equal(merged.workspacePlan.id, plan.id);
  assert.ok(merged.workspacePlanUpdatedAt);
});

test('validCustomInput requires title and problem statement', () => {
  assert.equal(validCustomInput({}).ok, false);
  assert.equal(validCustomInput({ title: 'X' }).ok, false);
  assert.equal(validCustomInput({ title: 'X', problemStatement: 'Y' }).ok, true);
});

test('statusLabel renders honest human labels', () => {
  assert.equal(statusLabel('in_progress'), 'In Progress');
  assert.equal(statusLabel('verified'), 'Verified');
  assert.equal(statusLabel(''), 'Planned');
});

test('WorkspaceApi.patch forwards architecturePatch to backend payload', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../web/src/lib/workspaceApi.js', import.meta.url), 'utf8');
  assert.match(src, /\{ workspacePlan, patch, architecturePatch, currentTab, selectedItem \}/);
  assert.match(src, /\{ workspacePlan, patch, architecturePatch, currentTab, selectedItem \}/);
});
