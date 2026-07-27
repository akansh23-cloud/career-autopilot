// Guided Project Workspace — stabilization-pass tests (pure, no DB/network).
// Covers: architecture package preservation + refinement sync, patent asset
// normalization, starter backend route correctness (auth/upload/score/admin/
// recruiter), serverEntry wiring, api-plan implemented-vs-planned docs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkspacePlan, normalizeCustomProject, applyArchitecturePatch, applyTaskPatch,
} from '../server/utils/workspace/index.js';
import { generateArchitectureSpec } from '../server/utils/architecture/index.js';
import { generateForFile, buildTemplateContext } from '../server/utils/codegen/codegenEngine.js';
import { buildStarterPack } from '../server/utils/starterPack/starterPackBuilder.js';

const baseInput = {
  title: 'Campus Skill Exchange',
  problemStatement: 'Students cannot find peers to swap skills with.',
  category: 'Marketplace',
  techStack: ['React', 'Node.js', 'Express', 'MongoDB'],
  flags: { auth: true, upload: true, ai: true, admin: true, recruiter: true, payment: true, patent: true },
};

function makeArchPackage(proj) {
  const pkg = generateArchitectureSpec({
    title: proj.title, description: proj.problemStatement,
    techStack: proj.techStack, projectType: proj.category, targetLevel: 'mvp',
  });
  return {
    architectureSpec: pkg.architectureSpec,
    mermaidViews: pkg.mermaidViews,
    validation: pkg.validation,
    designScore: pkg.validation?.score?.overallScore ?? null,
  };
}

function makePlan(flags = {}) {
  const project = normalizeCustomProject({ ...baseInput, flags: { ...baseInput.flags, ...flags } });
  const architecture = makeArchPackage(project);
  return { project, architecture, plan: buildWorkspacePlan({ project, architecture, userId: 'u1' }) };
}

/* ---------- Fix 7: full architecture package preserved ---------- */
test('workspacePlan preserves the full Architecture OS package', () => {
  const { architecture, plan } = makePlan();
  const a = plan.architecture;
  assert.ok(a.architectureSpec, 'spec preserved');
  assert.ok(a.mermaidViews && Object.keys(a.mermaidViews).length >= 1, 'mermaid views preserved');
  assert.ok(a.validation && Array.isArray(a.validation.checks), 'validation preserved');
  assert.equal(a.designScore, architecture.designScore, 'designScore preserved');
  assert.ok(Number.isFinite(a.designScore), 'designScore is a number');
  assert.ok(!('__validation' in (a.architectureSpec || {})), 'no hidden __validation field');
});

/* ---------- Fix 8: architecture refinement syncs into the plan ---------- */
test('applyArchitecturePatch updates plan architecture and marks artifacts stale', () => {
  const { plan } = makePlan();
  const withPack = { ...plan, starterPack: { ...plan.starterPack, available: true } };
  const newSpec = { ...plan.architecture.architectureSpec, refinedAt: 'test', components: [] };
  const { plan: updated, changed } = applyArchitecturePatch(withPack, { architectureSpec: newSpec });
  assert.equal(changed, true);
  assert.equal(updated.architecture.architectureSpec.refinedAt, 'test');
  assert.equal(updated.starterPack.stale, true, 'starter pack marked stale');
  assert.equal(updated.patentAssets.stale, true, 'patent assets marked stale');
  assert.equal(updated.docsStale, true);
  assert.ok(updated.architectureUpdatedAt);
});

test('applyArchitecturePatch with identical spec reports no change and keeps artifacts fresh', () => {
  const { plan } = makePlan();
  const { plan: updated, changed } = applyArchitecturePatch(plan, { architectureSpec: plan.architecture.architectureSpec });
  assert.equal(changed, false);
  assert.notEqual(updated.starterPack.stale, true);
});

test('applyArchitecturePatch recomputes designScore from new validation', () => {
  const { plan } = makePlan();
  const fakeValidation = { score: { overallScore: 91 }, checks: [], warnings: [] };
  const { plan: updated } = applyArchitecturePatch(plan, { validation: fakeValidation });
  assert.equal(updated.architecture.designScore, 91);
});

/* ---------- Fix 6: patent assets are always list-shaped ---------- */
test('patentAssets lists are arrays whether enabled or disabled', () => {
  const enabled = makePlan().plan.patentAssets;
  assert.ok(Array.isArray(enabled.notes));
  assert.ok(Array.isArray(enabled.noveltyAngles));
  assert.ok(Array.isArray(enabled.claimElementCandidates));
  assert.ok(Array.isArray(enabled.methodFlow));
  const disabled = makePlan({ patent: false }).plan.patentAssets;
  assert.ok(Array.isArray(disabled.notes));
  assert.equal(disabled.enabled, false);
});

/* ---------- Fix 9: correct templates per route ---------- */
test('auth.routes.js uses the auth template, not entity CRUD', () => {
  const { plan } = makePlan();
  const entry = plan.fileTree.find((f) => f.path === 'backend/routes/auth.routes.js');
  assert.equal(entry.templateKey, 'authRoute');
  const out = generateForFile(plan, entry.path);
  const code = out.generatedFiles[0].content;
  assert.match(code, /\/api\/auth\/register/);
  assert.match(code, /\/api\/auth\/login/);
  assert.match(code, /\/api\/auth\/me/);
  assert.ok(!/controller\.list/.test(code), 'no generic CRUD controller wiring');
  assert.ok(!/skillexchanges|resumes/.test(code), 'no entity CRUD paths in auth routes');
});

test('entity routes include upload and score placeholders when those features are on', () => {
  const { plan } = makePlan();
  const entry = plan.fileTree.find((f) => /backend\/routes\/[a-z]+s\.routes\.js$/.test(f.path) && f.path !== 'backend/routes/auth.routes.js');
  const code = generateForFile(plan, entry.path).generatedFiles[0].content;
  assert.match(code, /\/upload'/, 'upload route wired');
  assert.match(code, /\/:id\/score'/, 'score route wired');
  // and the controller has matching handlers
  const ctrl = plan.fileTree.find((f) => /Controller\.js$/.test(f.path));
  const ctrlCode = generateForFile(plan, ctrl.path).generatedFiles[0].content;
  assert.match(ctrlCode, /export async function upload/);
  assert.match(ctrlCode, /export async function score/);
});

test('upload/score routes are omitted when those features are off', () => {
  const { plan } = makePlan({ upload: false, ai: false });
  const entry = plan.fileTree.find((f) => /backend\/routes\/[a-z]+s\.routes\.js$/.test(f.path) && f.path !== 'backend/routes/auth.routes.js');
  const code = generateForFile(plan, entry.path).generatedFiles[0].content;
  assert.ok(!/\/upload'/.test(code));
  assert.ok(!/\/:id\/score'/.test(code));
});

test('admin and recruiter route files exist with role-shaped placeholders', () => {
  const { plan } = makePlan();
  const admin = generateForFile(plan, 'backend/routes/admin.routes.js').generatedFiles[0].content;
  assert.match(admin, /\/api\/admin\/users/);
  assert.match(admin, /requireRole\('admin'\)/);
  const rec = generateForFile(plan, 'backend/routes/recruiter.routes.js').generatedFiles[0].content;
  assert.match(rec, /\/api\/recruiter\/candidates/);
});

test('generated backend/server.js imports and mounts every planned route file and exports app', () => {
  const { plan } = makePlan();
  const code = generateForFile(plan, 'backend/server.js').generatedFiles[0].content;
  const routeFiles = plan.fileTree.filter((f) => /backend\/routes\/.+\.routes\.js$/.test(f.path) && f.templateKey);
  assert.ok(routeFiles.length >= 4, 'auth+admin+recruiter+health+entity planned');
  for (const f of routeFiles) {
    const file = f.path.split('/').pop();
    assert.ok(code.includes(`./routes/${file}`), `server.js imports ${file}`);
  }
  assert.match(code, /export default app/);
  assert.match(code, /import\.meta\.url === /, 'starts only when run directly');
});

test('health starter test calls the real exported app, entity test is labeled a harness example', () => {
  const { plan } = makePlan();
  const health = generateForFile(plan, 'backend/tests/health.test.js').generatedFiles[0].content;
  assert.match(health, /import app from '\.\.\/server\.js'/);
  assert.match(health, /fetch\(base \+ '\/api\/health'\)/);
  assert.ok(!/const payload = \{ ok: true/.test(health), 'no hardcoded payload assertion');
  const entityTest = plan.fileTree.find((f) => /backend\/tests\/(?!health).+\.test\.js$/.test(f.path));
  const code = generateForFile(plan, entityTest.path).generatedFiles[0].content;
  assert.match(code, /TEST HARNESS EXAMPLE/);
  assert.match(code, /verifies nothing about your API/);
});

/* ---------- Fix 9: docs distinguish implemented vs planned ---------- */
test('docs/api-plan.md marks every endpoint starter or planned-only, honestly', () => {
  const { plan } = makePlan();
  const doc = generateForFile(plan, 'docs/api-plan.md').generatedFiles[0].content;
  assert.match(doc, /Status legend/);
  for (const a of plan.apiPlan) {
    const row = doc.split('\n').find((l) => l.includes(`\`${a.path}\``) && l.includes(a.method));
    assert.ok(row, `row for ${a.method} ${a.path}`);
    assert.ok(/\| (starter|planned only) \|/.test(row), 'has a status cell');
  }
  // payments has no starter route file → must be planned only
  const pay = plan.apiPlan.find((a) => a.path.startsWith('/api/payments'));
  if (pay) {
    const row = doc.split('\n').find((l) => l.includes(`\`${pay.path}\``));
    assert.match(row, /planned only/);
  }
  // auth + upload + score are wired → starter
  const ctx = buildTemplateContext(plan, { path: 'docs/api-plan.md' });
  const authApi = ctx.apis.find((a) => a.path === '/api/auth/login');
  assert.equal(authApi.starterImplemented, true);
  const uploadApi = ctx.apis.find((a) => /\/upload$/.test(a.path));
  assert.equal(uploadApi.starterImplemented, true);
  const scoreApi = ctx.apis.find((a) => /\/score$/.test(a.path));
  assert.equal(scoreApi.starterImplemented, true);
});

/* ---------- Fix 10: starter pack contents + commands ---------- */
test('starter pack includes the required student-experience files and run commands', () => {
  const { plan } = makePlan();
  const pack = buildStarterPack(plan);
  const rels = pack.files.map((f) => f.path.split('/').slice(1).join('/'));
  for (const required of [
    'README.md', 'SETUP.md', 'TASKS.md', '.env.example',
    'backend/server.js', 'backend/routes/health.routes.js', 'backend/routes/auth.routes.js',
    'backend/models/User.js', 'frontend/src/lib/api.js',
    'docs/api-plan.md', 'docs/database-models.md', 'docs/deployment-guide.md',
    'workspace/workspace-plan.json', 'workspace/architecture-spec.json', 'workspace/verification-checklist.json',
  ]) {
    assert.ok(rels.includes(required), `pack includes ${required}`);
  }
  assert.ok(!rels.includes('.env'), 'no real .env in the pack');
  assert.ok(pack.setupCommands.some((c) => /npm install/.test(c)));
  // The guided flow points at start-here first and the local checker instead of a bare npm test.
  assert.ok(pack.setupCommands.some((c) => /guide\/00-start-here/.test(c)), 'setup points to the start-here guide');
  assert.ok(pack.setupCommands.some((c) => /scripts\/check\.mjs/.test(c)), 'setup includes the local check command');
  assert.ok(pack.warnings.some((w) => /starter skeleton/i.test(w)));
});

/* ---------- Fix 12: Done vs Verified stays enforced after this pass ---------- */
test('manual Verified is still downgraded after architecture syncs', () => {
  const { plan } = makePlan();
  const synced = applyArchitecturePatch(plan, { validation: { score: { overallScore: 80 } } }).plan;
  const r = applyTaskPatch(synced, synced.tasks[0].id, { status: 'verified' });
  assert.equal(r.plan.tasks[0].status, 'done');
});
