// Buildable Engine (v2) — tests for the layer that decides whether a
// generated project can actually be built by a second-year student.
//
// The bug class these guard against is subtle: the old engine produced output
// that LOOKED complete — a roadmap, guides, a ZIP — while half the tasks had
// no code behind them and the primary entity was called "Record" regardless of
// domain. Nothing failed; students just quietly stalled. These tests assert the
// properties that make the difference.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildWorkspacePlan, normalizeCustomProject } from '../server/utils/workspace/index.js';
import { modelDomain, detectDomainPack, inferEntityName, singularize, pluralize } from '../server/utils/domain/domainModeler.js';
import { compileFeatures, standaloneFeatures } from '../server/utils/workspace/featureCompiler.js';
import { buildStarterPack } from '../server/utils/starterPack/starterPackBuilder.js';
import { runBuildDoctor, relativeImports, resolveRelative } from '../server/utils/starterPack/buildDoctor.js';
import { generateForFile } from '../server/utils/codegen/codegenEngine.js';

/* A spread of real project shapes a college cohort actually submits. */
const ARCHETYPES = [
  {
    label: 'clinic',
    input: {
      title: 'Clinic Follow-up Reminder System',
      problemStatement: 'Small clinics lose repeat patients because follow-ups and reminders are managed on paper.',
      targetUsers: 'Clinic receptionists',
      category: 'SaaS',
      mvpFeatures: ['Patient list', 'Schedule follow-up', 'Send reminder', 'Login'],
      flags: { auth: true, ai: true, admin: true },
    },
    expectEntity: 'Patient',
  },
  {
    label: 'attendance',
    input: {
      title: 'Coaching Centre Attendance Analytics',
      problemStatement: 'Coaching institutes track attendance on paper and cannot see drop-off risk.',
      category: 'Analytics',
      mvpFeatures: ['Mark attendance', 'Risk report', 'Notify guardians'],
      flags: { auth: true },
    },
    expectEntity: 'Student',
  },
  {
    label: 'freelance money',
    input: {
      title: 'Freelancer Invoice and Expense Tracker',
      problemStatement: 'Freelancers juggle invoices and expenses across spreadsheets.',
      category: 'FinTech',
      mvpFeatures: ['Create invoice', 'Track expenses', 'Export report'],
      flags: { auth: true },
    },
    expectEntity: 'Invoice',
  },
  {
    label: 'generic / no pack match',
    input: {
      title: 'Campus Skill Exchange',
      problemStatement: 'Students cannot find peers to swap skills with.',
      category: 'Marketplace',
      mvpFeatures: ['Browse skills', 'Request a swap'],
      flags: { auth: true, upload: true },
    },
    expectEntity: 'Skill',
  },
];

function planFor(input) {
  return buildWorkspacePlan({ project: normalizeCustomProject(input), userId: 'u1' });
}

/* ================= Domain modelling ================= */

test('the domain model names the entity the student would name', () => {
  for (const a of ARCHETYPES) {
    const domain = modelDomain(normalizeCustomProject(a.input));
    assert.equal(domain.primary.name, a.expectEntity, `${a.label}: expected ${a.expectEntity}, got ${domain.primary.name}`);
  }
});

test('entities carry real domain fields, not title/description/status', () => {
  const domain = modelDomain(normalizeCustomProject(ARCHETYPES[0].input));
  const names = domain.primary.fields.map((f) => f.name);
  assert.ok(names.includes('fullName'), 'a patient has a name');
  assert.ok(names.includes('phone'), 'a patient has a phone number');
  assert.ok(names.some((n) => /followUp/i.test(n)), 'a follow-up system tracks follow-ups');
  assert.ok(!names.includes('description'), 'generic placeholder fields are gone');
});

test('every entity ships seed rows so the first run is never an empty screen', () => {
  for (const a of ARCHETYPES) {
    const domain = modelDomain(normalizeCustomProject(a.input));
    for (const e of domain.entities) {
      assert.ok(e.seed.length >= 3, `${a.label}/${e.name} needs demo rows`);
      for (const row of e.seed) {
        for (const f of e.fields.filter((x) => x.required && x.name !== 'userId')) {
          assert.ok(row[f.name] !== undefined, `${e.name} seed row missing required ${f.name}`);
        }
      }
    }
  }
});

test('domain modelling is deterministic', () => {
  const input = normalizeCustomProject(ARCHETYPES[0].input);
  assert.deepEqual(modelDomain(input), modelDomain(input));
});

test('pluralization survives the irregular cases that broke the API paths', () => {
  // /api/campuss and /api/companys were real, shipped URLs.
  assert.equal(singularize('Campus'), 'Campus');
  assert.equal(singularize('Status'), 'Status');
  assert.equal(singularize('Analysis'), 'Analysis');
  assert.equal(singularize('Patients'), 'Patient');
  assert.equal(pluralize('Company'), 'Companies');
  assert.equal(pluralize('Campus'), 'Campuses');
  assert.equal(pluralize('Patient'), 'Patients');
});

test('an unmatched domain still produces a usable entity, never "Item" by default', () => {
  assert.equal(inferEntityName({ title: 'Local Delivery Tracker' }), 'Delivery');
  assert.equal(inferEntityName({ title: 'Smart Parking Finder' }), 'Parking');
  assert.equal(detectDomainPack({ title: 'Something Entirely Novel' }), null);
});

/* ================= Feature compilation ================= */

test('every MVP feature compiles to a concrete, testable contract', () => {
  const project = normalizeCustomProject(ARCHETYPES[0].input);
  const domain = modelDomain(project);
  const specs = compileFeatures(project, domain, { features: {} });
  assert.ok(specs.length >= 3);
  for (const s of specs) {
    assert.ok(s.method && s.path, `${s.name} needs an endpoint`);
    assert.ok(s.successShape, `${s.name} needs a success shape to assert against`);
    assert.ok(s.acceptance.length >= 2, `${s.name} needs acceptance criteria`);
  }
  const send = specs.find((s) => /reminder/i.test(s.name));
  assert.equal(send.kind, 'notify', 'a "send reminder" feature is a notification, not generic CRUD');
});

test('features already covered by the CRUD scaffold are not duplicated as tasks', () => {
  const project = normalizeCustomProject(ARCHETYPES[0].input);
  const domain = modelDomain(project);
  const specs = compileFeatures(project, domain, { features: {} });
  const login = specs.find((s) => /login/i.test(s.name));
  assert.equal(login.builtin, true, 'login is handled by the auth task, not a duplicate feature task');
  assert.ok(standaloneFeatures(specs).length < specs.length);
});

/* ================= The buildability invariants ================= */

test('NO task in the roadmap is a fileless placeholder', () => {
  // This is the headline regression: v1 shipped "Feature: Patient list" with
  // "No specific files — this task is about your environment or process."
  const processTask = /github|deploy|readme|screenshot|proof|database/i;
  for (const a of ARCHETYPES) {
    const plan = planFor(a.input);
    for (const t of plan.tasks) {
      if (processTask.test(t.title)) continue;
      assert.ok(t.linkedFiles.length > 0, `${a.label}: task "${t.title}" points at no files`);
    }
  }
});

test('every task states how to prove it is done', () => {
  for (const a of ARCHETYPES) {
    const plan = planFor(a.input);
    for (const t of plan.tasks) {
      assert.ok(t.checkCommand, `${a.label}: task "${t.title}" has no check command`);
      assert.ok(t.acceptanceCriteria.length >= 1, `${a.label}: task "${t.title}" has no acceptance criteria`);
    }
  }
});

test('every feature ships a module, a screen and an acceptance test', () => {
  const plan = planFor(ARCHETYPES[0].input);
  const paths = new Set(plan.fileTree.map((f) => f.path));
  for (const spec of plan.featureSpecs.filter((s) => !s.builtin)) {
    assert.ok(paths.has(spec.serviceFile), `missing backend module for ${spec.name}`);
    assert.ok(paths.has(spec.viewFile), `missing screen for ${spec.name}`);
    assert.ok(paths.has(`backend/tests/acceptance/${spec.slug}.test.js`), `missing acceptance test for ${spec.name}`);
  }
});

test('unbuilt features answer 501 and their test asserts the real contract', () => {
  const plan = planFor(ARCHETYPES[0].input);
  const spec = plan.featureSpecs.find((s) => !s.builtin);
  const mod = generateForFile(plan, spec.serviceFile).generatedFiles[0].content;
  assert.match(mod, /status\(501\)/, 'unbuilt features must be visibly unbuilt');
  assert.match(mod, /not_implemented/);
  assert.ok(mod.includes(spec.path), 'the module owns the endpoint it claims');

  const testCode = generateForFile(plan, `backend/tests/acceptance/${spec.slug}.test.js`).generatedFiles[0].content;
  assert.match(testCode, /assert\.notEqual\(res\.status, 501/, 'the test is red until the feature is built');
  assert.match(testCode, /assert\.equal\(res\.status, 200/);
});

test('the schema is the single source of truth across backend and frontend', () => {
  const plan = planFor(ARCHETYPES[0].input);
  const entity = plan.domain.primary;
  const backend = generateForFile(plan, `backend/schemas/${entity.slug}.schema.js`).generatedFiles[0].content;
  const frontend = generateForFile(plan, 'frontend/src/lib/schema.js').generatedFiles[0].content;
  for (const f of entity.fields.filter((x) => x.name !== 'userId')) {
    assert.ok(backend.includes(`"${f.name}"`), `backend schema missing ${f.name}`);
    assert.ok(frontend.includes(`"${f.name}"`), `frontend schema missing ${f.name}`);
  }
  // The owner field is server-assigned and must never be a required input.
  assert.ok(!/"name": "userId"/.test(backend), 'userId must not be a client-supplied field');
});

test('the API plan documents the URLs the generated routes actually serve', () => {
  for (const a of ARCHETYPES) {
    const plan = planFor(a.input);
    const plural = plan.domain.primary.slugPlural;
    const routeFile = plan.fileTree.find((f) => f.path === `backend/routes/${plural}.routes.js`);
    assert.ok(routeFile, `${a.label}: entity routes file should be named for the real plural`);
    const listApi = plan.apiPlan.find((x) => x.method === 'GET' && x.path === `/api/${plural}`);
    assert.ok(listApi, `${a.label}: api plan should document /api/${plural}`);
  }
});

/* ================= The engine checking its own work ================= */

test('build doctor passes on every archetype', () => {
  for (const a of ARCHETYPES) {
    const pack = buildStarterPack(planFor(a.input));
    assert.equal(pack.report.ok, true,
      `${a.label} produced an unbuildable pack:\n` + pack.report.errors.map((e) => `  ${e.code} ${e.file} ${e.message}`).join('\n'));
    assert.equal(pack.buildable, true);
  }
});

test('build doctor catches a broken relative import', () => {
  const report = runBuildDoctor({
    files: [
      { path: 'backend/server.js', content: "import x from './lib/missing.js';\nexport default app;\n" },
    ],
    plan: {},
    root: '',
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === 'E1_MISSING_IMPORT'));
});

test('build doctor catches invalid JSON and a missing entry point', () => {
  const report = runBuildDoctor({
    files: [{ path: 'workspace/checks.json', content: '{ not json' }],
    plan: {},
    root: '',
  });
  assert.ok(report.errors.some((e) => e.code === 'E2_BAD_JSON'));
  assert.ok(report.errors.some((e) => e.code === 'E6_NO_ENTRY'));
});

test('build doctor does not flag legitimate JavaScript as a template leak', () => {
  // `headers: body ? {...} : undefined` is correct code, not a rendering bug.
  const report = runBuildDoctor({
    files: [
      { path: 'backend/server.js', content: 'const o = { headers: body ? h : undefined };\nexport default app;\n' },
    ],
    plan: {},
    root: '',
  });
  assert.ok(!report.warnings.some((w) => w.code === 'W3_PLACEHOLDER'), 'no false positive on real code');
});

test('no two features claim the same endpoint', () => {
  /* Found in the wild: "Report an issue" and "Issue heatmap" both compiled to
     GET /api/issues/summary. Express served the first, so the second router was
     dead code — the student implemented a handler that could never run. */
  const project = normalizeCustomProject({
    title: 'Civic Issue Reporting Heatmap',
    problemStatement: 'Citizens cannot report local issues.',
    mvpFeatures: ['Report an issue', 'Issue heatmap', 'Upvote issues'],
    flags: { auth: true },
  });
  const plan = buildWorkspacePlan({ project, userId: 'u1' });
  const keys = plan.featureSpecs.filter((f) => !f.builtin).map((f) => `${f.method} ${f.path}`);
  assert.equal(new Set(keys).size, keys.length, `duplicate endpoints: ${keys.join(', ')}`);
  // "Report an issue" is a create action, not an analytics report.
  const report = plan.featureSpecs.find((f) => /report an issue/i.test(f.name));
  assert.equal(report.kind, 'create');
});

test('feature routes mount before the entity :id route that would shadow them', () => {
  /* /api/issues/:id swallows /api/issues/summary when it registers first, and
     the failure is silent: the student gets 404 from getOne instead of their
     own handler, and debugs the wrong file. */
  const project = normalizeCustomProject({
    title: 'Civic Issue Reporting Heatmap',
    problemStatement: 'Citizens cannot report local issues.',
    mvpFeatures: ['Issue heatmap', 'Upvote issues'],
    flags: { auth: true },
  });
  const plan = buildWorkspacePlan({ project, userId: 'u1' });
  const server = generateForFile(plan, 'backend/server.js').generatedFiles[0].content;
  const firstFeature = server.search(/Feature\)/);
  // The entity route file is named for the PLURAL: issues.routes.js -> issuesRoutes.
  const ident = server.match(new RegExp(`import\\s+(\\w+)\\s+from '\\./routes/${plan.domain.primary.slugPlural}\\.routes\\.js'`));
  assert.ok(ident, 'entity routes should be imported');
  const entityMount = server.search(new RegExp(`app\\.use\\(${ident[1]}\\)`));
  assert.ok(firstFeature !== -1 && entityMount !== -1);
  assert.ok(firstFeature < entityMount, 'feature routers must mount first');
});

test('build doctor catches route shadowing and duplicate endpoints', () => {
  const shadowed = runBuildDoctor({
    files: [{
      path: 'backend/server.js',
      content: "import issuesRoutes from './routes/issues.routes.js';\napp.use(issuesRoutes);\napp.use(heatmapFeature);\nexport default app;\n",
    }],
    plan: {
      domain: { primary: { camel: 'issue', slugPlural: 'issues' } },
      featureSpecs: [{ name: 'Heatmap', method: 'GET', path: '/api/issues/summary' }],
    },
    root: '',
  });
  assert.ok(shadowed.errors.some((e) => e.code === 'E10_ROUTE_SHADOWED'));

  const duped = runBuildDoctor({
    files: [{ path: 'backend/server.js', content: 'export default app;\n' }],
    plan: {
      featureSpecs: [
        { name: 'A', method: 'GET', path: '/api/x/summary' },
        { name: 'B', method: 'GET', path: '/api/x/summary' },
      ],
    },
    root: '',
  });
  assert.ok(duped.errors.some((e) => e.code === 'E9_DUPLICATE_ENDPOINT'));
});

test('a check never passes on a pack the student has not touched', () => {
  /* Every automated check must be RED on a freshly generated pack. A check that
     is green before you start (the shipped Dashboard contained the word
     "search" in a comment) teaches students the board is meaningless. */
  const plan = planFor(ARCHETYPES[0].input);
  const pack = buildStarterPack(plan);
  const files = new Map(pack.files.map((f) => [f.path.split('/').slice(1).join('/'), f.content]));
  const manifest = JSON.parse(files.get('workspace/checks.json'));
  for (const t of manifest.tasks) {
    for (const c of t.checks) {
      if (c.kind !== 'fileContains') continue;
      const body = files.get(c.path);
      if (body === undefined) continue; // created later by setup, not shipped
      assert.ok(!new RegExp(c.pattern).test(body),
        `task ${t.no}: check "${c.label}" already passes on the untouched pack`);
    }
  }
});

test('import resolution helpers handle nesting correctly', () => {
  assert.equal(resolveRelative('backend/tests/acceptance/x.test.js', '../helpers/server.js'), 'backend/tests/helpers/server.js');
  assert.equal(resolveRelative('backend/server.js', './lib/store.js'), 'backend/lib/store.js');
  assert.deepEqual(relativeImports("import a from './b.js';\nimport 'express';"), ['./b.js']);
});

test('the pack reports honest buildability signals', () => {
  const pack = buildStarterPack(planFor(ARCHETYPES[0].input));
  const s = pack.report.stats;
  assert.equal(s.tasksWithFiles, s.tasks, 'every task is wired to code');
  assert.ok(s.acceptanceTests >= 1);
  assert.ok(s.seededEntities >= 1);
  assert.ok(pack.files.some((f) => /BUILD-REPORT\.md$/.test(f.path)));
});

test('generation stays deterministic end to end', () => {
  /* Normalize ONCE. normalizeCustomProject mints a timestamped project id by
     design, and that id is embedded in the exported workspace-plan.json — so
     normalizing twice compares two genuinely different projects. Determinism
     is a property of "same project in -> same bytes out". */
  const project = normalizeCustomProject(ARCHETYPES[0].input);
  /* Fix the clock too: the plan snapshot records when it was generated, which
     is honest metadata rather than drift. The builder takes `now` for exactly
     this reason. */
  const now = '2026-01-01T00:00:00.000Z';
  const a = buildStarterPack(buildWorkspacePlan({ project, userId: 'u1', now }));
  const b = buildStarterPack(buildWorkspacePlan({ project, userId: 'u1', now }));
  assert.deepEqual(a.files.map((f) => f.path), b.files.map((f) => f.path));
  for (let i = 0; i < a.files.length; i += 1) {
    assert.equal(a.files[i].content, b.files[i].content, `${a.files[i].path} is not deterministic`);
  }
});

test('two students with the same idea get the same code', () => {
  /* The stronger guarantee, and the one that matters for audit: identical
     input phrasing produces identical generated CODE, even though each
     student's project carries its own id. */
  const first = buildStarterPack(planFor(ARCHETYPES[0].input));
  const second = buildStarterPack(planFor(ARCHETYPES[0].input));
  const codeOf = (pack) => pack.files
    .filter((f) => !/workspace\/(workspace-plan|architecture-spec|verification-checklist)\.json$/.test(f.path))
    .map((f) => `${f.path}\n${f.content}`).join('\n');
  assert.equal(codeOf(first), codeOf(second));
});

test('the guide never tells a student a task has no files when it does', () => {
  const plan = planFor(ARCHETYPES[0].input);
  const pack = buildStarterPack(plan);
  const featureGuides = pack.files.filter((f) => /guide\/\d\d-/.test(f.path)
    && /Build:/.test(f.content.split('\n')[0]));
  assert.ok(featureGuides.length >= 1, 'feature tasks should have guides');
  for (const g of featureGuides) {
    assert.ok(!/No files for this one/.test(g.content), `${g.path} claims it has no files`);
    assert.match(g.content, /## The contract you must satisfy/, `${g.path} should state the endpoint contract`);
  }
});
