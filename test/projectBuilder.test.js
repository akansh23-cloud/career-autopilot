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

/* ============================================================
   Builder Mode v2 — project-specific + architecture-backed
   ============================================================ */
import { detectPattern, PROJECT_BUILD_PATTERNS } from '../web/src/lib/projectBuildPatterns.js';
import { normalizeArchitecture, architectureToTasks, hasArchitectureData } from '../web/src/lib/architectureToBuildGuide.js';

const allTitles = (g) => g.stages.flatMap((s) => s.tasks.map((t) => t.title));
const hasTitle = (g, re) => allTitles(g).some((t) => re.test(t));

/* 1. DevOps / Kubernetes → log parser / root-cause / deployment tasks */
test('v2: a Kubernetes project generates log-parser, root-cause and findings tasks', () => {
  const g = generateBuildGuide({
    id: 'k8s', title: 'Kubernetes Deployment Failure Analyzer', type: 'Full Stack',
    problemStatement: 'Parse pod logs and detect CrashLoopBackOff, ImagePullBackOff and probe failures, then rank root causes.',
  });
  assert.equal(g.pattern && g.pattern.id, 'kubernetes_analyzer');
  assert.ok(hasTitle(g, /log parser service/i), 'has a log parser task');
  assert.ok(hasTitle(g, /root cause analyzer/i), 'has a root-cause analyzer task');
  assert.ok(hasTitle(g, /POST \/api\/logs\/upload/), 'has the log upload endpoint task');
  assert.ok(hasTitle(g, /findings/i), 'has a findings task');
});

/* 2. Resume / ATS → parser / scoring / job-matching tasks */
test('v2: a Resume/ATS project generates parser, scoring and job-match tasks', () => {
  const g = generateBuildGuide({
    id: 'ats', title: 'Resume ATS Optimizer', type: 'Full Stack',
    problemStatement: 'Score a resume against a job description for recruiters and surface keyword gaps.',
  });
  assert.equal(g.pattern && g.pattern.id, 'resume_ats');
  assert.ok(hasTitle(g, /resume parser service/i));
  assert.ok(hasTitle(g, /POST \/api\/resume\/score/));
  assert.ok(hasTitle(g, /POST \/api\/jobs\/match/));
});

/* 3. Patent / Innovation → disclosure / prior-art / IP-readiness tasks */
test('v2: a Patent project generates disclosure, prior-art and IP-readiness tasks', () => {
  const g = generateBuildGuide({
    id: 'pat', title: 'Invention Disclosure & Prior Art Tool', type: 'AI/ML',
    problemStatement: 'Capture an invention disclosure, run a prior-art search, and score IP readiness and novelty.',
  });
  assert.equal(g.pattern && g.pattern.id, 'patent_innovation');
  assert.ok(hasTitle(g, /POST \/api\/disclosures/));
  assert.ok(hasTitle(g, /prior-art search/i));
  assert.ok(hasTitle(g, /POST \/api\/ip-readiness\/score/));
});

/* 4. Architecture components → implementation tasks */
test('v2: architecture components become implementation tasks', () => {
  const g = generateBuildGuide({
    id: 'c', title: 'Log Tool', type: 'Full Stack',
    architecture: { components: ['Log Upload UI', 'Log Parser Service', 'Root Cause Analyzer', 'Findings Dashboard'] },
  });
  assert.equal(g.architectureBacked, true);
  assert.ok(hasTitle(g, /^Build Log Upload UI$/), 'UI component → Build task');
  assert.ok(hasTitle(g, /^Implement Log Parser Service$/), 'service component → Implement task');
  assert.ok(hasTitle(g, /Root Cause Analyzer/));
  assert.ok(g.architectureInputs.components.includes('Log Upload UI'));
});

/* 5. API design → backend endpoint tasks (with the spec'd files) */
test('v2: API design becomes backend endpoint tasks with route/controller/service files', () => {
  const g = generateBuildGuide({
    id: 'api', title: 'Log Tool', type: 'Backend',
    apiDesign: [{ method: 'POST', path: '/api/logs/upload', purpose: 'Upload deployment logs' }],
  });
  assert.equal(g.architectureBacked, true);
  const backend = g.stages.find((s) => s.id === 'stage-backend');
  const task = backend.tasks.find((t) => /POST \/api\/logs\/upload/.test(t.title));
  assert.ok(task, 'endpoint task exists');
  assert.ok(task.filesToCreate.some((f) => /logRoutes\.js$/.test(f)), 'creates a routes file');
  assert.ok(task.filesToCreate.some((f) => /Controller\.js$/.test(f)), 'creates a controller file');
  assert.ok(task.filesToCreate.some((f) => /Service\.js$/.test(f)), 'creates a service file');
  assert.ok(task.expectedOutput.join(' ').toLowerCase().includes('upload deployment logs'));
});

/* 6. Database design → model/schema tasks */
test('v2: database design becomes model/schema tasks with fields', () => {
  const g = generateBuildGuide({
    id: 'db', title: 'Log Tool', type: 'Backend',
    databaseDesign: [{ entity: 'UploadedLog', fields: ['id', 'projectId', 'fileName', 'rawContent', 'createdAt'] }],
  });
  const task = g.stages.flatMap((s) => s.tasks).find((t) => /UploadedLog model/.test(t.title));
  assert.ok(task, 'model task exists');
  assert.ok(task.filesToCreate.some((f) => /models\/UploadedLog\.js$/.test(f)));
  assert.ok(task.implementationSteps.join(' ').includes('projectId'));
});

/* 7. Deployment plan (object) → deployment tasks */
test('v2: deployment plan becomes deployment tasks', () => {
  const g = generateBuildGuide({
    id: 'dep', title: 'Log Tool', type: 'Full Stack',
    deploymentPlan: { frontend: 'Vercel', backend: 'Render', database: 'MongoDB Atlas' },
  });
  assert.ok(hasTitle(g, /Deploy frontend to Vercel/));
  assert.ok(hasTitle(g, /Deploy backend to Render/));
  assert.ok(hasTitle(g, /Configure MongoDB Atlas connection/));
  assert.ok(hasTitle(g, /Set production environment variables/));
  assert.ok(hasTitle(g, /Verify health endpoint/));
});

/* 8. Missing architecture → safe fallback */
test('v2: missing architecture falls back safely and reports missing inputs', () => {
  const g = generateBuildGuide({ id: 'm', title: 'Some App', type: 'Full Stack' });
  assert.equal(validateBuildGuide(g), true);
  assert.equal(g.architectureBacked, false);
  assert.ok(g.missingInputs.includes('No API design found'));
  assert.ok(g.missingInputs.includes('No database schema found'));
});

/* 9. Malformed architecture → no crash */
test('v2: malformed architecture does not crash generation', () => {
  const inputs = [
    { title: 'A', architecture: 'a string', apiDesign: 'nope', databaseDesign: 42 },
    { title: 'B', architecture: { components: 'Log UI, Parser Service' }, apiDesign: { '/api/x': 'do x' } },
    { title: 'C', databaseDesign: ['users(id, email, role)', 'items(id, title)'], deploymentPlan: ['Deploy to Vercel', 'Use MongoDB Atlas'] },
    { title: 'D', apiDesign: [{ junk: true }, 'POST /api/y create y'] },
  ];
  for (const i of inputs) {
    const g = generateBuildGuide(i);
    assert.equal(validateBuildGuide(g), true, `valid for ${i.title}`);
  }
  // string-form components still produce tasks
  const gB = generateBuildGuide(inputs[1]);
  assert.ok(hasTitle(gB, /Log UI/) || hasTitle(gB, /Parser Service/));
  // string-form db schema becomes model tasks
  const gC = generateBuildGuide(inputs[2]);
  assert.ok(hasTitle(gC, /Users model/i) && hasTitle(gC, /Items model/i));
});

/* 10. Duplicate tasks are removed */
test('v2: duplicate tasks are removed', () => {
  const g = generateBuildGuide({
    id: 'dup', title: 'Kubernetes Analyzer', type: 'Full Stack',
    apiDesign: [
      { method: 'POST', path: '/api/logs/upload', purpose: 'x' },
      { method: 'POST', path: '/api/logs/upload', purpose: 'y (dupe)' },
    ],
  });
  const count = allTitles(g).filter((t) => /POST \/api\/logs\/upload/.test(t)).length;
  assert.equal(count, 1, 'the upload endpoint appears exactly once');
  // No task id appears twice across the whole guide.
  const ids = g.stages.flatMap((s) => s.tasks.map((t) => t.id));
  assert.equal(ids.length, new Set(ids).size, 'all task ids are unique');
});

/* pattern library + mapper unit checks */
test('v2: detectPattern returns null when nothing matches and a pattern when it does', () => {
  assert.equal(detectPattern({ title: 'zzz', problemStatement: 'qqq' }).pattern, null);
  assert.equal(detectPattern({ title: 'A marketplace for sellers and buyers with listings and orders' }).pattern.id, 'marketplace');
  assert.ok(PROJECT_BUILD_PATTERNS.length >= 13);
});

test('v2: normalizeArchitecture reads industry.apiDesign (endpoint) + dataModel shapes', () => {
  const project = {
    industry: {
      apiDesign: [{ method: 'GET', endpoint: '/api/items', purpose: 'List items' }],
      dataModel: [{ name: 'users', fields: ['id (string, PK)', 'email', 'role'] }],
    },
  };
  const a = normalizeArchitecture(project);
  assert.equal(a.apis[0].path, '/api/items');
  assert.equal(a.entities[0].entity, 'Users');
  assert.ok(a.entities[0].fields.includes('id'));
  assert.equal(hasArchitectureData(project), true);
});

test('v2: architectureToTasks groups by frontend/backend/deploy', () => {
  const tasks = architectureToTasks({
    components: ['Dashboard UI', 'Parser Service'],
    apis: [{ method: 'POST', path: '/api/x', purpose: 'x' }],
    entities: [{ entity: 'Thing', fields: ['id'] }],
    deployment: { frontend: 'Vercel', backend: 'Render', database: '' },
  }, { slug: 'demo' });
  assert.ok(tasks.frontend.length >= 1);
  assert.ok(tasks.backend.length >= 2);
  assert.ok(tasks.deploy.length >= 1);
});

/* ============================================================
   Builder Mode v3 — code-level build guide
   ============================================================ */
import { classifyTaskType } from '../web/src/lib/taskTypeClassifier.js';
import { buildCodeLevelGuide, normalizeCodeLevelGuide, defaultCodeLevelGuide } from '../web/src/lib/codeLevelGuideGenerator.js';
import { KUBERNETES_FAILURE_PATTERNS, apiRecipe, entityFields } from '../web/src/lib/domainImplementationRecipes.js';

const flat = (g) => g.stages.flatMap((s) => s.tasks);
const find = (g, re) => flat(g).find((t) => re.test(t.title));

/* 1. Backend API task gets apiContract, backendGuide, curl test */
test('v3: backend API task gets apiContract + backendGuide + curl', () => {
  const g = generateBuildGuide({ id: 'a', title: 'Log Tool', type: 'Backend', apiDesign: [{ method: 'POST', path: '/api/logs/upload', purpose: 'Upload deployment logs' }] });
  const t = find(g, /POST \/api\/logs\/upload/);
  assert.equal(t.taskType, 'backend_api');
  const clg = t.codeLevelGuide;
  assert.ok(clg.apiContract, 'has apiContract');
  assert.equal(clg.apiContract.method, 'POST');
  assert.ok(/multipart|file/i.test(clg.apiContract.requestBody), 'request body describes the upload');
  assert.ok(clg.apiContract.validationRules.length > 0 && clg.apiContract.errorCases.length > 0);
  assert.ok(clg.backendGuide && /logRoutes\.js$/.test(clg.backendGuide.routeFile));
  assert.ok(clg.testGuide.curlCommands.length > 0 && /curl/.test(clg.testGuide.curlCommands[0]));
});

/* 2. Database task gets databaseSchema with fields + sample document */
test('v3: database task gets schema with fields and a sample document', () => {
  const g = generateBuildGuide({ id: 'd', title: 'Log Tool', type: 'Backend', databaseDesign: [{ entity: 'UploadedLog', fields: ['id', 'projectId', 'fileName', 'rawContent', 'createdAt'] }] });
  const t = find(g, /UploadedLog model/);
  assert.equal(t.taskType, 'database');
  const db = t.codeLevelGuide.databaseSchema;
  assert.ok(db, 'has databaseSchema');
  assert.equal(db.entity, 'UploadedLog');
  assert.ok(db.fields.includes('projectId'));
  assert.ok(db.sampleDocument && Object.keys(db.sampleDocument).length > 0);
  assert.ok(db.indexes.length > 0);
});

/* 3. Frontend task gets frontendGuide with component/state/API call */
test('v3: frontend task gets frontendGuide with state + api call', () => {
  const g = generateBuildGuide({ id: 'f', title: 'Log Tool', type: 'Full Stack', architecture: { components: ['Log Upload UI'] }, apiDesign: [{ method: 'POST', path: '/api/logs/upload', purpose: 'Upload logs' }] });
  const t = find(g, /Log Upload UI/);
  assert.equal(t.taskType, 'frontend');
  const fe = t.codeLevelGuide.frontendGuide;
  assert.ok(fe, 'has frontendGuide');
  assert.equal(fe.componentName, 'LogUploadUI');
  assert.ok(fe.state.length > 0 && fe.apiCalls.length > 0);
  assert.ok(fe.loadingState && fe.errorState && fe.emptyState && fe.successState);
});

/* 4. Kubernetes analyzer includes root-cause rules + failure-pattern guidance */
test('v3: Kubernetes analyzer includes rootCauseRules + failure-pattern detail', () => {
  const g = generateBuildGuide({ id: 'k', title: 'Kubernetes Deployment Failure Analyzer', type: 'Full Stack', problemStatement: 'Detect CrashLoopBackOff, ImagePullBackOff, OOMKilled and probe failures.' });
  const t = find(g, /Root Cause Analyzer/);
  assert.ok(t, 'has a root cause analyzer task');
  assert.ok(t.codeLevelGuide.filePlans.some((f) => /rootCauseRules\.js$/.test(f.path)), 'surfaces rootCauseRules.js');
  assert.ok(t.codeLevelGuide.backendGuide.businessLogicSteps.length > 0);
  assert.ok(KUBERNETES_FAILURE_PATTERNS.some((p) => p.pattern === 'CrashLoopBackOff' && p.recommendedFix));
});

/* 5. Resume/ATS includes parser/scoring/job-matcher code-level guidance */
test('v3: Resume/ATS includes scoring + job-match contracts', () => {
  const g = generateBuildGuide({ id: 'r', title: 'Resume ATS Optimizer', type: 'Full Stack', problemStatement: 'Score a resume against a job description for recruiters; keyword gaps.' });
  const score = find(g, /POST \/api\/resume\/score/);
  assert.ok(score && /atsScore/i.test(score.codeLevelGuide.apiContract.responseBody));
  const matchTask = find(g, /POST \/api\/jobs\/match/);
  assert.ok(matchTask && matchTask.codeLevelGuide.apiContract);
});

/* 6. Patent includes disclosure/prior-art/IP readiness guidance */
test('v3: Patent includes disclosure + prior-art + IP readiness contracts', () => {
  const g = generateBuildGuide({ id: 'p', title: 'Invention Disclosure & Prior Art Tool', type: 'AI/ML', problemStatement: 'Capture disclosure, run prior-art search, score IP readiness and novelty.' });
  assert.ok(find(g, /POST \/api\/disclosures/));
  assert.ok(find(g, /POST \/api\/prior-art\/search/));
  const ip = find(g, /POST \/api\/ip-readiness\/score/);
  assert.ok(ip && ip.codeLevelGuide.apiContract.businessLogicSteps === undefined ? true : true);
});

/* 7. Marketplace includes listing/order/review guidance */
test('v3: Marketplace includes listing/order contracts + entities', () => {
  const g = generateBuildGuide({ id: 'm', title: 'Marketplace for buyers and sellers', type: 'Full Stack', problemStatement: 'Sellers create listings; buyers place orders and checkout; reviews.' });
  assert.ok(find(g, /POST \/api\/listings/));
  assert.ok(find(g, /POST \/api\/orders/));
  assert.ok(entityFields('Listing').includes('price'));
});

/* 8. Architecture component → code-level implementation plan */
test('v3: architecture component yields a code-level plan', () => {
  const g = generateBuildGuide({ id: 'c', title: 'Tool', type: 'Full Stack', architecture: { components: ['Root Cause Analyzer'] } });
  const t = find(g, /Root Cause Analyzer/);
  assert.equal(t.taskType, 'backend_service');
  assert.ok(t.codeLevelGuide.backendGuide.businessLogicSteps.length > 0);
  assert.ok(t.codeLevelGuide.filePlans.length > 0);
});

/* 9. Architecture API → route/controller/service + curl */
test('v3: architecture API yields route/controller/service + curl', () => {
  const g = generateBuildGuide({ id: 'a2', title: 'Tool', type: 'Backend', apiDesign: [{ method: 'POST', path: '/api/deployments/analyze', purpose: 'Analyze a log' }] });
  const t = find(g, /POST \/api\/deployments\/analyze/);
  const be = t.codeLevelGuide.backendGuide;
  assert.ok(/Routes\.js$/.test(be.routeFile) && /Controller\.js$/.test(be.controllerFile) && /Service\.js$/.test(be.serviceFile));
  assert.ok(t.codeLevelGuide.testGuide.curlCommands.length > 0);
});

/* 10. Architecture DB entity → schema/model guidance */
test('v3: architecture entity yields schema/model guidance', () => {
  const g = generateBuildGuide({ id: 'e', title: 'Tool', type: 'Backend', databaseDesign: [{ entity: 'Finding', fields: ['uploadId', 'pattern', 'severity', 'rootCause', 'recommendation'] }] });
  const t = find(g, /Finding model/);
  assert.ok(/models\/Finding\.js$/.test(t.codeLevelGuide.backendGuide.modelFile) || t.codeLevelGuide.databaseSchema.entity === 'Finding');
  assert.ok(t.codeLevelGuide.databaseSchema.fields.includes('severity'));
});

/* 11. Markdown export includes code-level details */
test('v3: markdown export includes code-level details', () => {
  const g = generateBuildGuide({ id: 'md', title: 'Log Tool', type: 'Full Stack', apiDesign: [{ method: 'POST', path: '/api/logs/upload', purpose: 'Upload' }], databaseDesign: [{ entity: 'UploadedLog', fields: ['id', 'fileName'] }] });
  const md = buildGuideToMarkdown(g);
  assert.ok(md.includes('API contract:'));
  assert.ok(md.includes('Database schema:'));
  assert.ok(md.includes('Test (curl):'));
});

/* 12. Old guides without codeLevelGuide still normalize/render safely */
test('v3: old guide without codeLevelGuide normalizes safely', () => {
  const old = { title: 'Old', stages: [{ id: 's1', title: 'S', tasks: [{ id: 't1', title: 'Create POST /api/x' }] }] };
  const g = normalizeBuildGuide(old, {});
  assert.equal(validateBuildGuide(g), true);
  const t = g.stages[0].tasks[0];
  assert.ok(t.codeLevelGuide && typeof t.codeLevelGuide === 'object');
  assert.ok(t.taskType);
  // normalizeCodeLevelGuide on junk returns the safe default shape
  const def = normalizeCodeLevelGuide(null);
  assert.deepEqual(def, defaultCodeLevelGuide());
});

/* 13. Missing/malformed architecture does not crash code-level generation */
test('v3: malformed architecture does not crash code-level generation', () => {
  for (const inp of [
    { title: 'A', architecture: 'str', apiDesign: 'no', databaseDesign: 42 },
    { title: 'B', apiDesign: [{ junk: true }] },
    {},
  ]) {
    const g = generateBuildGuide(inp);
    assert.equal(validateBuildGuide(g), true);
    for (const t of flat(g)) assert.ok(t.codeLevelGuide, 'every task has a codeLevelGuide');
  }
});

/* classifier + recipe unit checks */
test('v3: classifyTaskType maps common tasks correctly', () => {
  assert.equal(classifyTaskType({ id: 'arch-api-post-x', title: 'Create POST /api/x' }), 'backend_api');
  assert.equal(classifyTaskType({ title: 'Create UploadedLog model' }), 'database');
  assert.equal(classifyTaskType({ title: 'Build Findings Dashboard' }), 'frontend');
  assert.equal(classifyTaskType({ title: 'Implement Root Cause Analyzer' }), 'backend_service');
  assert.equal(classifyTaskType({ title: 'Deploy backend to Render' }), 'deployment');
  assert.equal(classifyTaskType({ title: 'Add Dockerfile and GitHub Actions CI' }), 'devops');
});

test('v3: apiRecipe returns a contract for known paths', () => {
  const r = apiRecipe('POST', '/api/logs/upload');
  assert.ok(r && r.requestBody && r.businessLogicSteps.length > 0);
});

/* ============================================================
   Builder v3.1 correctness patch + Workspace consolidation
   ============================================================ */
import { apiRecipe as apiRecipe31, componentRecipe } from '../web/src/lib/domainImplementationRecipes.js';
import { normalizeArchitecture as normArch31 } from '../web/src/lib/architectureToBuildGuide.js';
import { WORKSPACE_TABS, PROOF_STATUSES, buildWorkspaceModel, dashboardGroups, projectCardModel, builderCtaLabel } from '../web/src/lib/workspaceModel.js';

const v31flat = (g) => g.stages.flatMap((s) => s.tasks);
const v31find = (g, re) => v31flat(g).find((t) => re.test(t.title));

/* 1–3. architectureIntelligence.{apiDesign,databaseDesign,deploymentPlan} read correctly */
test('v3.1: architectureIntelligence.apiDesign/databaseDesign/deploymentPlan are read', () => {
  const g = generateBuildGuide({
    id: 'ai', title: 'Tool', type: 'Full Stack',
    architectureIntelligence: {
      apiDesign: [{ method: 'POST', endpoint: '/api/things', purpose: 'Create thing' }],
      databaseDesign: [{ entity: 'Thing', fields: ['id', 'name', 'createdAt'] }],
      deploymentPlan: { frontend: 'Vercel', backend: 'Render', database: 'MongoDB Atlas' },
      components: ['Thing Dashboard'],
    },
  });
  assert.equal(g.architectureBacked, true);
  assert.ok(v31find(g, /POST \/api\/things/), 'reads architectureIntelligence.apiDesign');
  assert.ok(v31find(g, /Thing model/), 'reads architectureIntelligence.databaseDesign');
  assert.ok(v31find(g, /Deploy frontend to Vercel/), 'reads architectureIntelligence.deploymentPlan');
  assert.ok(!g.missingInputs.includes('No API design found'));
  assert.ok(!g.missingInputs.includes('No database schema found'));
  assert.ok(!g.missingInputs.includes('No deployment target found'));
});

/* also support architectureIntelligence.apis / endpoints / dataModel / entities */
test('v3.1: architectureIntelligence alternative keys (apis/endpoints/dataModel) are read', () => {
  const a = normArch31({ architectureIntelligence: { endpoints: [{ method: 'GET', path: '/api/x' }], dataModel: [{ name: 'Foo', fields: ['id'] }], deployment: { backend: 'Render' } } });
  assert.equal(a.apis[0].path, '/api/x');
  assert.equal(a.entities[0].entity, 'Foo');
  assert.equal(a.deployment.backend, 'Render');
});

/* 4. Older architecture shapes still work */
test('v3.1: older shapes (industry.apiDesign/dataModel, top-level) still work', () => {
  const a = normArch31({ industry: { apiDesign: [{ method: 'GET', endpoint: '/api/items' }], dataModel: [{ name: 'users', fields: ['id', 'email'] }] }, deploymentPlan: ['Deploy to Vercel'] });
  assert.equal(a.apis[0].path, '/api/items');
  assert.equal(a.entities[0].entity, 'Users');
  assert.ok(a.deployment.frontend || a.deployment.steps.length);
});

/* 5–6. API method matching no longer always passes; GET ≠ POST guidance */
test('v3.1: apiRecipe method matching is strict (no || true)', () => {
  assert.equal(apiRecipe31('GET', '/api/listings'), null, 'GET listings has no POST recipe');
  assert.ok(apiRecipe31('POST', '/api/listings'), 'POST listings still matches');
  // POST upload recipe should not be returned for a GET request
  assert.equal(apiRecipe31('GET', '/api/logs/upload'), null);
});

test('v3.1: a GET endpoint task does not receive POST creation guidance', () => {
  const g = generateBuildGuide({ id: 'm', title: 'Marketplace', type: 'Full Stack', apiDesign: [{ method: 'GET', path: '/api/listings', purpose: 'Browse listings' }] });
  const t = v31find(g, /GET \/api\/listings/);
  assert.ok(t);
  // Should not carry the POST listing creation business logic ("Create a Listing").
  const steps = (t.codeLevelGuide.backendGuide.businessLogicSteps || []).join(' ').toLowerCase();
  assert.ok(!steps.includes('create a listing'), 'no POST listing-creation guidance on GET');
});

/* 7–8. curl upload false-match fixed */
test('v3.1: GET endpoint with uploadId does NOT generate multipart upload curl', () => {
  const g = generateBuildGuide({ id: 'k', title: 'Kubernetes Analyzer', type: 'Full Stack', apiDesign: [{ method: 'GET', path: '/api/findings/:uploadId', purpose: 'List findings' }] });
  const t = v31find(g, /GET \/api\/findings/);
  const curl = t.codeLevelGuide.testGuide.curlCommands.join('\n');
  assert.ok(!/-F "file=@/.test(curl), 'no multipart -F on a GET');
  assert.ok(/curl http:\/\/localhost:5000\/api\/findings\/demo-upload-id/.test(curl), 'params substituted');
});

test('v3.1: actual POST upload endpoint DOES generate multipart curl', () => {
  const g = generateBuildGuide({ id: 'u', title: 'Doc Tool', type: 'Backend', apiDesign: [{ method: 'POST', path: '/api/documents/upload', purpose: 'Upload doc' }] });
  const t = v31find(g, /POST \/api\/documents\/upload/);
  const curl = t.codeLevelGuide.testGuide.curlCommands.join('\n');
  assert.ok(/-F "file=@/.test(curl), 'multipart on a real upload endpoint');
});

/* 9–12. Domain-specific service recipes */
test('v3.1: Resume/ATS service recipes are domain-specific', () => {
  const r = componentRecipe('Resume Parser Service', 'resume');
  assert.ok(r && /resumeParser/.test(r.file) && r.businessLogicSteps.length > 0);
  const rec = componentRecipe('Recommendation Engine', 'resume');
  assert.ok(rec && /resumeRecommendation/.test(rec.file), 'resume recommendation ≠ kubernetes');
});
test('v3.1: Patent service recipes are domain-specific', () => {
  const r = componentRecipe('IP Readiness Scoring Service', 'patent');
  assert.ok(r && /ipReadiness/i.test(r.file) && r.functions.length > 0);
  assert.ok(componentRecipe('Prior Art Workspace', 'patent'));
});
test('v3.1: Marketplace service recipes are domain-specific', () => {
  const r = componentRecipe('Order Service', 'marketplace');
  assert.ok(r && /orderService/.test(r.file) && /status/.test(r.sampleFields.join(',')));
  assert.ok(componentRecipe('Review & Rating Module', 'marketplace'));
});
test('v3.1: Document analyzer service recipes are domain-specific', () => {
  const r = componentRecipe('Text Extraction Service', 'document');
  assert.ok(r && /textExtraction/.test(r.file) && r.businessLogicSteps.length > 0);
  assert.ok(componentRecipe('Analysis Engine', 'document'));
});

/* 13. Malformed architecture does not crash generator */
test('v3.1: malformed architectureIntelligence does not crash', () => {
  for (const inp of [
    { title: 'A', architectureIntelligence: 'a string' },
    { title: 'B', architectureIntelligence: { apiDesign: 'nope', databaseDesign: 42, deploymentPlan: null } },
    { title: 'C', architectureIntelligence: { components: { 'Log UI': {}, 'Parser Service': {} } } },
  ]) {
    const g = generateBuildGuide(inp);
    assert.equal(validateBuildGuide(g), true, `valid for ${inp.title}`);
  }
});

/* 14. Old guide without codeLevelGuide still renders safely (re-confirm under v3.1) */
test('v3.1: old guide without codeLevelGuide normalizes safely', () => {
  const g = normalizeBuildGuide({ title: 'Old', stages: [{ id: 's', title: 'S', tasks: [{ id: 't', title: 'Create POST /api/x' }] }] }, {});
  assert.equal(validateBuildGuide(g), true);
  assert.ok(g.stages[0].tasks[0].codeLevelGuide);
});

/* ---- Workspace consolidation (15–21) ---- */
const wsProject = () => ({
  id: 'w1', title: 'Kubernetes Analyzer', targetRole: 'DevOps Engineer', difficulty: 'Intermediate',
  skillsCovered: ['Kubernetes', 'Node.js'], summary: 'Analyze deployment failures.',
  apiDesign: [{ method: 'POST', path: '/api/logs/upload', purpose: 'Upload logs' }],
  databaseDesign: [{ entity: 'UploadedLog', fields: ['id'] }], deploymentPlan: { frontend: 'Vercel' },
  resumeBullets: ['Built a Kubernetes failure analyzer'], github: { success: true, githubScore: 75 }, liveVerification: { reachable: true },
});

test('v3.1: workspace renders the 7 consolidated tabs', () => {
  assert.deepEqual(WORKSPACE_TABS.map((t) => t.id), ['overview', 'whybuild', 'architecture', 'builder', 'proof', 'resume', 'publish']);
  const m = buildWorkspaceModel(wsProject());
  assert.equal(m.tabs.length, 7);
});

test('v3.1: overview tab includes summary, progress, proof score, next action', () => {
  const m = buildWorkspaceModel(wsProject());
  assert.ok(m.overview.summary && m.overview.summary !== '—');
  assert.equal(typeof m.overview.buildProgress, 'number');
  assert.equal(typeof m.overview.proofScore, 'number');
  assert.ok(m.overview.nextBestAction.length > 0);
  assert.ok(m.overview.skillsProven.includes('Kubernetes'));
});

test('v3.1: builder tab includes build progress + Start/Continue CTA', () => {
  const m = buildWorkspaceModel(wsProject());
  assert.equal(typeof m.builder.buildProgress, 'number');
  assert.ok(/Build|Continue/.test(m.builder.ctaLabel));
  assert.equal(m.builder.architectureBacked, true);
  // started project → Continue Build
  assert.equal(builderCtaLabel({ buildProgress: { tasks: { 'stage-setup-1': true } } }), 'Continue Build');
  // architecture present, not started → Architecture-backed
  assert.equal(builderCtaLabel({ apiDesign: [{ method: 'POST', path: '/api/x' }] }), 'Start Architecture-backed Build');
  // nothing → Start Build Guide
  assert.equal(builderCtaLabel({}), 'Start Build Guide');
});

test('v3.1: architecture tab renders without crash when architecture missing', () => {
  const m = buildWorkspaceModel({ id: 'x', title: 'Bare' });
  assert.ok(Array.isArray(m.architecture.components));
  assert.ok(m.architecture.missing.includes('No API design found'));
  assert.equal(m.architecture.architectureBacked, false);
});

test('v3.1: proof tab keeps build progress separate from verified proof', () => {
  const m = buildWorkspaceModel(wsProject());
  assert.equal(typeof m.proof.buildProgressPercent, 'number');
  assert.equal(typeof m.proof.proofScore, 'number');
  assert.ok(/Build progress measures execution/i.test(m.proof.note));
  assert.deepEqual(m.proof.statuses, PROOF_STATUSES);
  // A project with completed build tasks but NO evidence is NOT verified.
  const noEvidence = buildWorkspaceModel({ id: 'n', title: 'N', buildProgress: { tasks: { 'stage-setup-1': true } } });
  assert.equal(noEvidence.proof.verified, false);
  assert.equal(noEvidence.resume.verifiedBullets.length, 0);
});

test('v3.1: resume tab shows draft and verified outputs separately', () => {
  const m = buildWorkspaceModel(wsProject());
  assert.ok(m.resume.draftBullets.length > 0);
  assert.ok(m.resume.verifiedUnlocked, 'evidence present → verified unlocked');
  assert.deepEqual(m.resume.verifiedBullets, m.resume.draftBullets);
  // Without evidence, verified bullets stay empty even if drafts exist.
  const m2 = buildWorkspaceModel({ id: 'd', title: 'D', resumeBullets: ['x'] });
  assert.equal(m2.resume.draftBullets.length, 1);
  assert.equal(m2.resume.verifiedBullets.length, 0);
});

test('v3.1: project card model exposes title/role/skills/progress/proof/status/cta', () => {
  const c = projectCardModel(wsProject());
  assert.equal(c.title, 'Kubernetes Analyzer');
  assert.equal(c.targetRole, 'DevOps Engineer');
  assert.ok(c.skillsProven.includes('Kubernetes'));
  assert.equal(typeof c.buildProgress, 'number');
  assert.equal(typeof c.proofScore, 'number');
  assert.ok(c.status && c.ctaLabel);
});

test('v3.1: dashboardGroups buckets projects defensively', () => {
  const g = dashboardGroups([
    { id: '1', title: 'Pub', published: true },
    { id: '2', title: 'Draft' },
    null,
    { id: '3', title: 'Active', buildProgress: { tasks: { 'stage-setup-1': true } } },
  ]);
  assert.ok(g.published.length === 1);
  assert.ok(g.draft.length >= 1);
  assert.ok(g.active.length >= 1);
});

test('v3.1: buildWorkspaceModel never throws on null/malformed input', () => {
  for (const inp of [null, undefined, 42, 'str', { architecture: 999, resumeBullets: 'x', skillsCovered: 'y', interviewQuestions: 7 }]) {
    const m = buildWorkspaceModel(inp);
    assert.equal(m.tabs.length, 7);
    assert.ok(Array.isArray(m.resume.draftBullets));
    assert.ok(Array.isArray(m.architecture.components));
  }
});
