// Project OS — Builder Mode tests.
// These exercise the PURE generator (web/src/lib/buildGuide.js) and the server
// service/validator that wrap it. They run under `node --test` with no browser,
// DB, network or AI key — matching the rest of the suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateBuildGuide, normalizeBuildGuide, validateBuildGuide,
  computeProgress, setTaskProgress, setPrerequisiteProgress, setStageProgress,
  buildGuideToMarkdown, emptyProgress, slugify,
} from '../web/src/lib/buildGuide.js';

import { buildGuide as svcBuildGuide, progressFor, exportGuide } from '../server/services/projectBuilder/projectBuildGuideService.js';
import { isValidBuildGuide, sanitizeBuildGuide } from '../server/services/projectBuilder/projectBuildGuideValidator.js';

/* A realistic, saved Project OS project (Full Stack). */
function normalProject() {
  return {
    id: 'proj_abc',
    title: 'Fraud Alert Dashboard',
    type: 'Full Stack',
    targetRole: 'Cloud Data Engineer',
    difficulty: 'Intermediate',
    duration: '2 weeks',
    skillsCovered: ['React', 'Express', 'PostgreSQL'],
    techStack: ['React', 'Node.js', 'Express', 'PostgreSQL'],
    useCase: 'Surface suspicious transactions for analysts in real time.',
    problemStatement: 'Analysts lack a single screen to triage fraud alerts.',
    deploymentPlan: ['Dockerise the app', 'Deploy API to Render', 'Deploy web to Vercel'],
    testingPlan: ['Unit test the scoring rules', 'E2E the triage flow'],
  };
}

/* A Patent OS → Project Studio converted project (sparse; no tasks/steps). */
function patentProject() {
  return {
    title: 'On-device Anomaly Detector',
    targetRole: 'ML Engineer',
    type: 'AI/ML',
    difficulty: 'Advanced',
    duration: '1 month',
    skillsCovered: ['PyTorch', 'FastAPI'],
    techStack: ['Python', 'PyTorch', 'FastAPI'],
    summary: 'Detect equipment anomalies on the edge with low latency.',
    innovationGrade: true,
    innovation: {
      painPoint: 'cloud round-trips are too slow for safety alerts',
      noveltyAngle: 'on-device signal fusion',
      evidenceChecklist: ['Working prototype', 'Dated invention log', 'Benchmark vs. cloud baseline'],
    },
  };
}

/* ---------------- 1. generation from a normal project ---------------- */
test('generates a complete, valid guide from a normal Project OS project', () => {
  const g = generateBuildGuide(normalProject());
  assert.equal(validateBuildGuide(g), true);
  assert.equal(g.title, 'Fraud Alert Dashboard');
  assert.equal(g.targetRole, 'Cloud Data Engineer');
  assert.ok(g.stages.length >= 4, 'should have multiple stages');
  // Full Stack ⇒ has both backend and frontend stages.
  const ids = g.stages.map((s) => s.id);
  assert.ok(ids.includes('stage-backend'), 'has backend stage');
  assert.ok(ids.includes('stage-frontend'), 'has frontend stage');
  assert.ok(ids.includes('stage-proof'), 'has proof stage');
  // Section objects are all present.
  for (const k of ['setup', 'testingGuide', 'deploymentGuide', 'githubPlan', 'proofSubmission']) {
    assert.ok(g[k] && typeof g[k] === 'object', `${k} present`);
  }
  assert.deepEqual(g.exportFormats, ['markdown', 'json']);
});

test('guide is project-specific: includes the health-check task with the project slug', () => {
  const g = generateBuildGuide(normalProject());
  const backend = g.stages.find((s) => s.id === 'stage-backend');
  const health = backend.tasks.find((t) => /health/i.test(t.title));
  assert.ok(health, 'has a health-check task');
  assert.ok(health.commitMessage.length > 0, 'task has a commit message');
  assert.ok(health.expectedOutput.join(' ').includes('fraud-alert-dashboard'), 'expected output references the project slug');
  assert.ok(health.validationSteps.length > 0, 'task has validation steps');
});

test('starts at 0% with the first task as the next action', () => {
  const g = generateBuildGuide(normalProject());
  assert.equal(g.progressPercent, 0);
  assert.match(g.nextAction, /^Next action:/);
  assert.equal(g.currentStageId, 'stage-setup');
});

/* ---------------- 2. generation from a Patent-converted project ---------------- */
test('generates a valid guide from a Patent OS converted project (sparse fields)', () => {
  const g = generateBuildGuide(patentProject());
  assert.equal(validateBuildGuide(g), true);
  assert.equal(g.type, 'AI/ML');
  const ids = g.stages.map((s) => s.id);
  assert.ok(ids.includes('stage-ml'), 'AI/ML project has a model stage');
  // Innovation evidence flows into the required proof evidence.
  assert.ok(g.proofSubmission.requiredEvidence.some((e) => /invention log/i.test(e)), 'patent evidence preserved');
});

/* ---------------- 3. fallback when fields are missing ---------------- */
test('falls back gracefully for an empty project', () => {
  const g = generateBuildGuide({});
  assert.equal(validateBuildGuide(g), true);
  assert.equal(g.title, 'Untitled project');
  assert.ok(g.stages.length > 0, 'still produces stages');
  assert.ok(g.prerequisites.length > 0, 'still produces prerequisites');
});

test('normalizeBuildGuide repairs a malformed object so the UI never crashes', () => {
  // A minimally-valid but lossy guide (missing most arrays/objects).
  const partial = { stages: [{ id: 's1', tasks: [{ id: 't1', title: 'Do a thing' }] }] };
  const g = normalizeBuildGuide(partial, { title: 'Recovered' });
  assert.equal(validateBuildGuide(g), true);
  // Every task array exists (so .map in the UI is safe).
  const t = g.stages[0].tasks[0];
  for (const k of ['filesToCreate', 'filesToEdit', 'commands', 'implementationSteps', 'expectedOutput', 'validationSteps', 'commonErrors', 'completionCriteria']) {
    assert.ok(Array.isArray(t[k]), `${k} is an array`);
  }
  // Section objects exist with array members.
  assert.ok(Array.isArray(g.setup.commands));
  assert.ok(Array.isArray(g.proofSubmission.requiredEvidence));
  assert.ok(Array.isArray(g.githubPlan.commits));
});

test('a totally invalid guide is rejected and rebuilt from the project', () => {
  assert.equal(validateBuildGuide(null), false);
  assert.equal(validateBuildGuide({}), false);
  assert.equal(validateBuildGuide({ stages: [] }), false);
  assert.equal(validateBuildGuide({ stages: [{ tasks: [{ title: 'no id' }] }] }), false);
  const g = normalizeBuildGuide({ junk: true }, { title: 'Rebuilt', type: 'Backend' });
  assert.equal(validateBuildGuide(g), true);
  assert.equal(g.title, 'Rebuilt');
});

/* ---------------- 4. progress update logic ---------------- */
test('marking a task complete advances progress and the next action', () => {
  const project = normalProject();
  const base = generateBuildGuide(project);
  const firstTaskId = base.stages[0].tasks[0].id;
  const total = base.progress.totalTasks;

  const prog = setTaskProgress(undefined, firstTaskId, true);
  const after = generateBuildGuide(project, { progress: prog });

  assert.equal(after.progress.completedTasks, 1);
  assert.equal(after.progressPercent, Math.round((1 / total) * 100));
  // The next action moves to the SECOND task in the setup stage.
  assert.notEqual(after.nextAction, base.nextAction);
  // The task status is reflected in the guide.
  assert.equal(after.stages[0].tasks[0].status, 'done');
});

test('completing a stage marks all its tasks done and the stage done', () => {
  const project = normalProject();
  const base = generateBuildGuide(project);
  const stage = base.stages[0];
  const prog = setStageProgress(emptyProgress(), stage.id, true, stage.tasks.map((t) => t.id));
  const after = generateBuildGuide(project, { progress: prog });
  const s = after.stages.find((x) => x.id === stage.id);
  assert.equal(s.status, 'done');
  assert.ok(s.tasks.every((t) => t.status === 'done'));
  assert.ok(after.progress.completedStages >= 1);
});

test('prerequisite completion is tracked independently of tasks', () => {
  const project = normalProject();
  const name = generateBuildGuide(project).prerequisites[0].name;
  const prog = setPrerequisiteProgress(undefined, name, true);
  const after = generateBuildGuide(project, { progress: prog });
  assert.equal(after.prerequisites[0].completed, true);
  // Prereqs do NOT inflate task progress.
  assert.equal(after.progress.completedTasks, 0);
});

test('computeProgress reports 100% and a proof-submission next action when all tasks done', () => {
  const project = normalProject();
  const base = generateBuildGuide(project);
  let prog = emptyProgress();
  for (const s of base.stages) for (const t of s.tasks) prog = setTaskProgress(prog, t.id, true);
  const done = generateBuildGuide(project, { progress: prog });
  assert.equal(done.progressPercent, 100);
  assert.match(done.nextAction, /proof/i);
});

/* ---------------- 5. markdown export ---------------- */
test('markdown export contains every required section', () => {
  const md = buildGuideToMarkdown(generateBuildGuide(normalProject()));
  assert.ok(md.startsWith('# Build Guide'));
  for (const heading of ['Prerequisites', 'Local setup', 'Implementation roadmap', 'Step-by-step tasks', 'Testing guide', 'Deployment guide', 'GitHub commit plan', 'Proof submission', 'Resume bullet unlock conditions']) {
    assert.ok(md.includes(heading), `markdown includes "${heading}"`);
  }
  assert.ok(md.includes('git commit -m'), 'includes commit commands');
});

/* ---------------- 6. server service + validator parity ---------------- */
test('server service builds the same shape as the client lib', () => {
  const g = svcBuildGuide({ project: normalProject() });
  assert.equal(isValidBuildGuide(g), true);
  assert.equal(g.title, 'Fraud Alert Dashboard');
});

test('server service progressFor recomputes progress', () => {
  const project = normalProject();
  const firstTaskId = generateBuildGuide(project).stages[0].tasks[0].id;
  const { progress } = progressFor({ project, progress: { tasks: { [firstTaskId]: true } } });
  assert.equal(progress.completedTasks, 1);
});

test('server service exports json and markdown', () => {
  const json = exportGuide({ project: normalProject(), format: 'json' });
  assert.equal(json.format, 'json');
  assert.ok(JSON.parse(json.content).stages.length > 0);
  const md = exportGuide({ project: normalProject(), format: 'markdown' });
  assert.equal(md.format, 'markdown');
  assert.ok(md.content.includes('# Build Guide'));
});

test('server validator sanitizes a bad AI guide back to a deterministic one', () => {
  const g = sanitizeBuildGuide({ totally: 'wrong' }, { title: 'Safe', type: 'Backend' });
  assert.equal(isValidBuildGuide(g), true);
  assert.equal(g.title, 'Safe');
});

test('an optional pre-validated AI guide is normalized, never trusted raw', () => {
  // Provide a structurally-valid "AI" guide; it should be accepted + normalized.
  const ai = {
    title: 'AI Guide', stages: [{ id: 'a', title: 'A', tasks: [{ id: 'a1', title: 'Task A' }] }],
  };
  const g = svcBuildGuide({ project: normalProject(), aiGuide: ai });
  assert.equal(isValidBuildGuide(g), true);
  assert.equal(g.generatedBy, 'ai+validated');
  // Arrays are present after normalization (was missing in the raw AI object).
  assert.ok(Array.isArray(g.stages[0].tasks[0].commands));
});

/* ---------------- misc ---------------- */
test('slugify produces safe repo names', () => {
  assert.equal(slugify('Fraud Alert Dashboard!'), 'fraud-alert-dashboard');
  assert.equal(slugify(''), 'project');
});
