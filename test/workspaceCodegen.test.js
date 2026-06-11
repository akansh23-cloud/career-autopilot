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
  const root = pack.name + '/';
  for (const f of pack.files) {
    const rel = f.path.startsWith(root) ? f.path.slice(root.length) : f.path;
    assert.ok(planned.has(rel), `${f.path} not in the plan's starter allowlist`);
    if (rel !== '.env.example') {
      assert.ok(!/(api[_-]?key|secret)\s*=\s*['"][^'"]+/i.test(f.content), `possible secret in ${f.path}`);
    }
  }
  assert.ok(pack.warnings.some((w) => /starter skeleton/i.test(w)));
  assert.ok(pack.setupCommands.length >= 2);
});

test('packToZip is deterministic for the same pack', () => {
  const plan = makePlan();
  const pack = buildStarterPack(plan);
  const z1 = packToZip(pack);
  const z2 = packToZip(pack);
  assert.equal(Buffer.compare(z1, z2), 0, 'ZIP bytes must be identical for identical plans');
  assert.ok(z1.length < 2 * 1024 * 1024, 'ZIP stays under the 2MB cap');
});

test('starter pack generation does not mutate plan progress or task statuses', () => {
  const plan = makePlan();
  const before = JSON.stringify({ tasks: plan.tasks.map((t) => t.status), progress: plan.progress });
  buildStarterPack(plan);
  const after = JSON.stringify({ tasks: plan.tasks.map((t) => t.status), progress: plan.progress });
  assert.equal(before, after, 'building the pack must not change statuses or progress');
});
