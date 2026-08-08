// Guided Project Workspace — codegen engine + starter pack tests (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspacePlan, normalizeCustomProject } from '../server/utils/workspace/index.js';
import { generateForFile, generateForTask } from '../server/utils/codegen/codegenEngine.js';
import { planPatch } from '../server/utils/codegen/patchPlanner.js';
import { listTemplates, hasTemplate } from '../server/utils/codegen/templateRegistry.js';
import { detectStack } from '../server/utils/codegen/stackDetector.js';
import { buildStarterPack, packToZip } from '../server/utils/starterPack/starterPackBuilder.js';
import { createZip, isSafeZipPath, crc32 } from '../server/utils/starterPack/zipWriter.js';

function makePlan(overrides = {}) {
  const project = normalizeCustomProject({
    title: 'Campus Skill Exchange',
    problemStatement: 'Students cannot find peers to swap skills with.',
    category: 'Marketplace',
    techStack: ['React', 'Node.js', 'Express', 'MongoDB'],
    flags: { auth: true, upload: true, ...overrides.flags },
  });
  return buildWorkspacePlan({ project, architecture: null, userId: 'u1' });
}

test('detectStack identifies MERN and warns on other stacks', () => {
  const mern = detectStack({ techStack: ['React', 'Node.js', 'Express', 'MongoDB'] });
  assert.equal(mern.isMern, true);
  const other = detectStack({ techStack: ['Django', 'PostgreSQL'] });
  assert.equal(other.isMern, false);
  assert.ok(other.warnings.length >= 1, 'non-MERN stack should carry a compatibility warning');
});

test('every templated file in the plan has a registered template', () => {
  const plan = makePlan();
  for (const f of plan.fileTree) {
    if (f.templateKey) assert.ok(hasTemplate(f.templateKey), `unregistered template ${f.templateKey} for ${f.path}`);
  }
  assert.ok(listTemplates().length >= 20);
});

test('generateForFile renders starter code with TODO markers, deterministically', () => {
  const plan = makePlan();
  const file = plan.fileTree.find((f) => f.templateKey && /\.jsx?$/.test(f.path));
  const a = generateForFile(plan, file.path);
  const b = generateForFile(plan, file.path);
  assert.equal(a.generatedFiles.length, 1);
  assert.equal(a.generatedFiles[0].content, b.generatedFiles[0].content, 'codegen must be deterministic');
  assert.ok(/STARTER CODE/i.test(a.generatedFiles[0].content));
  assert.ok(/TODO/.test(a.generatedFiles[0].content));
});

test('generateForTask renders all linked files and warns it is not verified work', () => {
  const plan = makePlan();
  const task = plan.tasks.find((t) => (t.linkedFiles || []).length > 0);
  const out = generateForTask(plan, task.id);
  assert.ok(out.generatedFiles.length >= 1);
  assert.ok(out.warnings.some((w) => /not verified/i.test(w)));
});

test('planPatch never claims repo writes in v1', () => {
  const plan = makePlan();
  const task = plan.tasks.find((t) => (t.linkedFiles || []).length > 0);
  const out = planPatch(plan, task.id);
  assert.ok(out.patchPlan.every((p) => p.action === 'create'));
  assert.ok(out.warnings.some((w) => /does not write/i.test(w)));
});

test('zipWriter rejects unsafe paths and produces a valid ZIP structure', () => {
  assert.equal(isSafeZipPath('../etc/passwd'), false);
  assert.equal(isSafeZipPath('/abs/path'), false);
  assert.equal(isSafeZipPath('frontend/src/App.jsx'), true);
  const zip = createZip([{ path: 'a.txt', content: 'hello' }], { date: new Date('2026-01-01') });
  assert.ok(Buffer.isBuffer(zip));
  assert.equal(zip.readUInt32LE(0), 0x04034b50, 'local file header signature');
  const eocd = zip.readUInt32LE(zip.length - 22);
  assert.equal(eocd, 0x06054b50, 'end of central directory signature');
  assert.equal(crc32(Buffer.from('hello')), zip.readUInt32LE(14), 'CRC32 stored in header');
});

test('buildStarterPack includes only allowlisted template files and no secrets', () => {
  const plan = makePlan();
  const pack = buildStarterPack(plan);
  assert.ok(pack.files.length >= 10);
  const planned = new Set(plan.fileTree.filter((f) => f.starterPackIncluded && f.templateKey).map((f) => f.path));
  // Guided Build Kit files are deterministic additions (not from the file tree):
  // guides, AI prompts, the checks manifest, the local runner, the devcontainer.
  const isKitFile = (rel) => rel.startsWith('guide/') || rel.startsWith('prompts/')
    || rel === 'workspace/checks.json' || rel === 'scripts/check.mjs' || rel === '.devcontainer/devcontainer.json'
    /* v2 kit additions: the engine's own build report, shipped with the pack
       so the student sees what the generator knows about its output. */
    || rel === 'workspace/build-report.json' || rel === 'BUILD-REPORT.md';
  const root = pack.name + '/';
  for (const f of pack.files) {
    const rel = f.path.startsWith(root) ? f.path.slice(root.length) : f.path;
    assert.ok(planned.has(rel) || isKitFile(rel), `${f.path} not in the plan's starter allowlist or kit`);
    if (rel !== '.env.example') {
      assert.ok(!/(api[_-]?key|secret)\s*=\s*['"][^'"]+/i.test(f.content), `possible secret in ${f.path}`);
    }
  }
  assert.ok(pack.warnings.some((w) => /starter skeleton/i.test(w)));
  assert.ok(pack.setupCommands.length >= 2);
});

test('starter pack ships the Guided Build Kit (start-here, one guide+prompt per task, runner, checks, devcontainer)', () => {
  const plan = makePlan();
  const pack = buildStarterPack(plan);
  const root = pack.name + '/';
  const names = pack.files.map((f) => (f.path.startsWith(root) ? f.path.slice(root.length) : f.path));
  assert.ok(names.includes('guide/00-start-here.md'), 'start-here guide present');
  assert.ok(names.includes('scripts/check.mjs'), 'local check runner present');
  assert.ok(names.includes('workspace/checks.json'), 'checks manifest present');
  assert.ok(names.includes('.devcontainer/devcontainer.json'), 'Codespaces devcontainer present');
  /* v2 replaced memoryStore.js with store.js: one adapter whose methods behave
     identically in memory mode and against MongoDB, so switching databases is
     an env var rather than a rewrite. */
  assert.ok(names.includes('backend/lib/store.js'), 'storage adapter present');
  assert.ok(names.includes('backend/lib/seedData.js'), 'demo data present so the first run is not an empty screen');
  assert.ok(names.includes('scripts/setup.mjs'), 'one-command setup present');
  assert.ok(names.includes('backend/tests/smoke.test.js'), 'foundation tests present');
  // Task guides are 01..NN; guide/00-start-here is the intro, not a task.
  const guides = names.filter((n) => /^guide\/(?!00-)\d\d-/.test(n));
  const prompts = names.filter((n) => /^prompts\/\d\d-/.test(n));
  assert.equal(pack.guideTaskCount, guides.length, 'one guide file per task');
  assert.equal(prompts.length, guides.length, 'one AI prompt per task');
  // Every guide carries its structure + a copy-paste AI prompt.
  const g1 = pack.files.find((f) => /guide\/01-/.test(f.path)).content;
  /* "Check yourself" became "Prove it" in v2 — the section now runs a real
     command that either passes or does not, rather than offering checkboxes. */
  for (const marker of ['## Why this matters', '## Open these files', '## Do this', '## Run this', '## Prove it', '🤖 Your AI pair', '## What you just learned']) {
    assert.ok(g1.includes(marker), `guide/01 missing "${marker}"`);
  }
  // Checks manifest and code speak the same TODO language.
  const manifest = JSON.parse(pack.files.find((f) => /workspace\/checks\.json/.test(f.path)).content);
  assert.ok(Array.isArray(manifest.tasks) && manifest.tasks.length === guides.length);
  assert.ok(/Verified.*evidence|evidence.*Verified/i.test(manifest.note), 'manifest states local checks are not verification');
});

test('packToZip is deterministic for the same pack', () => {
  const plan = makePlan();
  const pack = buildStarterPack(plan);
  const z1 = packToZip(pack);
  const z2 = packToZip(pack);
  assert.equal(Buffer.compare(z1, z2), 0, 'ZIP bytes must be identical for identical plans');
  assert.ok(z1.length < 4 * 1024 * 1024, "ZIP stays under the 4MB cap");
});

test('starter pack generation does not mutate plan progress or task statuses', () => {
  const plan = makePlan();
  const before = JSON.stringify({ tasks: plan.tasks.map((t) => t.status), progress: plan.progress });
  buildStarterPack(plan);
  const after = JSON.stringify({ tasks: plan.tasks.map((t) => t.status), progress: plan.progress });
  assert.equal(before, after, 'building the pack must not change statuses or progress');
});

test('starter auth route implements logout when API plan marks it starter', () => {
  const plan = makePlan();
  const out = generateForFile(plan, 'backend/routes/auth.routes.js');
  assert.equal(out.generatedFiles.length, 1);
  const content = out.generatedFiles[0].content;
  assert.match(content, /router\.post\('\/api\/auth\/logout'/);
  const apiDoc = generateForFile(plan, 'docs/api-plan.md').generatedFiles[0].content;
  assert.match(apiDoc, /POST \| `\/api\/auth\/logout` .*\| starter \|/);
});

test('starter upload and score routes have matching service methods', () => {
  const project = normalizeCustomProject({
    title: 'AI Resume Screening Platform',
    problemStatement: 'Screen resumes and score them against jobs.',
    category: 'AI',
    techStack: ['React', 'Node.js', 'Express', 'MongoDB'],
    flags: { auth: true, upload: true, ai: true },
  });
  const plan = buildWorkspacePlan({ project, architecture: null, userId: 'u1' });
  /* Resolve the generated paths from the plan rather than hardcoding them:
     v2 names files from the domain model, so the entity may legitimately be
     Resume, Candidate or Application depending on how the project is phrased. */
  const routeFile = plan.fileTree.find((f) => /backend\/routes\/[a-z-]+\.routes\.js$/.test(f.path)
    && !/health|auth|admin|recruiter|payments/.test(f.path));
  const controllerFile = plan.fileTree.find((f) => /Controller\.js$/.test(f.path));
  const serviceFile = plan.fileTree.find((f) => /Service\.js$/.test(f.path) && !/uploadService|scoringService/.test(f.path));
  const entityPlural = plan.domain.primary.slugPlural;
  const E = plan.domain.primary.name;
  const routes = generateForFile(plan, routeFile.path).generatedFiles[0].content;
  const controller = generateForFile(plan, controllerFile.path).generatedFiles[0].content;
  const service = generateForFile(plan, serviceFile.path).generatedFiles[0].content;
  assert.ok(routes.includes(`router.post('/api/${entityPlural}/upload', controller.upload)`), 'upload route wired');
  assert.ok(routes.includes(`router.post('/api/${entityPlural}/:id/score', controller.score)`), 'score route wired');
  assert.ok(controller.includes(`service.upload${E}(req)`), 'controller delegates upload to the service');
  assert.ok(controller.includes(`service.score${E}(req.params.id, req)`), 'controller delegates scoring to the service');
  assert.ok(service.includes(`export async function upload${E}(`), 'service implements upload');
  assert.ok(service.includes(`export async function score${E}(`), 'service implements scoring');
  assert.match(service, /storeUpload\(req\.file\)/);
  assert.match(service, /runScore\(item\)/);
});
