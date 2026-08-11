import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TEMPLATE_OS_BUILTINS } from '../web/src/lib/templateOs/builtins.js';
import { RESUME_TEMPLATES } from '../web/src/lib/resumeTemplateRegistry.js';
import { validateTemplateDefinition } from '../web/src/lib/templateOs/dsl.js';
import { PRIMITIVES } from '../web/src/lib/templateOs/primitives.js';
import { certifyDefinition } from '../web/src/lib/templateOs/certification.js';
import { templateStructuralSignature } from '../web/src/lib/templateOs/synthesis.js';
import { compileTemplate } from '../web/src/lib/templateOs/compiler.js';
import { getResumeFixture } from '../web/src/lib/resumeFixtures.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { VERB_DICTIONARY, verbInfo } from '../server/utils/resume/grammarLibrary.js';
import { ROLE_ACTION_VERBS } from '../server/utils/resume/roleDictionaries.js';

const added = ['signature-engineering', 'modern-corporate', 'security-engineering', 'analytics-insight', 'product-strategy', 'research-innovation', 'minimal-ats-premium'];

test('Phase 30 expands Template OS to fourteen published builtins across distinct families', () => {
  assert.equal(TEMPLATE_OS_BUILTINS.length, 23);
  for (const id of added) assert.ok(TEMPLATE_OS_BUILTINS.some((x) => x.id === id), id);
  const tosCards = RESUME_TEMPLATES.filter((x) => x.engine === 'template-os');
  assert.equal(tosCards.length, 23);
  assert.equal(RESUME_TEMPLATES.length, 51);
});

test('every expanded family validates and passes deterministic parse certification', () => {
  for (const def of TEMPLATE_OS_BUILTINS.filter((x) => added.includes(x.id))) {
    const valid = validateTemplateDefinition(def, { primitives: PRIMITIVES });
    assert.equal(valid.ok, true, `${def.id}: ${JSON.stringify(valid.errors)}`);
    const cert = certifyDefinition(def, { sizeIds: ['a4'] });
    assert.equal(cert.ok, true, def.id);
    assert.equal(cert.certified, true, def.id);
  }
});

test('expanded families are structurally distinct rather than palette-only clones', () => {
  const signatures = TEMPLATE_OS_BUILTINS.filter((x) => added.includes(x.id)).map(templateStructuralSignature);
  assert.equal(new Set(signatures).size, signatures.length);
});

test('new families do not invent empty optional sections to fill whitespace', () => {
  const structured = structuredClone(getResumeFixture('missing-sections').data);
  for (const def of TEMPLATE_OS_BUILTINS.filter((x) => added.includes(x.id))) {
    const pdf = renderTemplatePdf(compileTemplate(def), structured, { sizeId: 'a4' });
    const raw = Buffer.from(pdf.bytes).toString('latin1');
    for (const fake of ['PUBLICATIONS', 'PATENTS', 'VOLUNTEER']) assert.ok(!raw.includes(`(${fake})`), `${def.id} rendered empty ${fake}`);
  }
});

test('Phase 30+ reference family preview cache covers all 51 Resume Studio templates', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../web/public/template-previews/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.surfaces['resume-studio'].length, 51);
  for (const id of added) {
    const row = manifest.surfaces['resume-studio'].find((x) => x.id === id);
    assert.ok(row, id);
    assert.equal(row.renderer, 'template-os-vector-pdf');
    assert.equal(row.width, 360); assert.equal(row.height, 509);
  }
});

test('resume vocabulary expands while every role-specific action remains grammar-recognized', () => {
  assert.ok(Object.keys(VERB_DICTIONARY).length >= 380);
  for (const expected of ['Containerized', 'Decoupled', 'Normalized', 'Authenticated', 'Fuzz-tested', 'Hypothesized', 'Mitigated']) assert.ok(verbInfo(expected), expected);
  const missing = [];
  for (const [role, verbs] of Object.entries(ROLE_ACTION_VERBS)) for (const verb of verbs) if (!verbInfo(verb)) missing.push(`${role}:${verb}`);
  assert.deepEqual(missing, []);
});
