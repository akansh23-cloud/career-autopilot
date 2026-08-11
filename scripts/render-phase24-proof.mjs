import fs from 'node:fs';
import path from 'node:path';
import {
  TEMPLATE_OS_BUILTINS, TEMPLATE_FIXTURES, compileTemplate, adaptTreeToShape, balancePageComposition,
  analyzeResumeShape, renderTemplatePdf,
} from '../web/src/lib/templateOs/index.js';
import {
  TEMPLATE_LIFECYCLE_VERSION, TEMPLATE_PRIMARY_LIFECYCLE, canTransitionTemplate, templateLifecycleSummary,
} from '../web/src/lib/templateOs/lifecycle.js';
import { makeTemplateStore, TEMPLATE_STORE_VERSION } from '../server/utils/templateOs/store.js';
import { VERB_DICTIONARY, verbAlternatives } from '../server/utils/resume/grammarLibrary.js';
import { ROLE_ACTION_VERBS } from '../server/utils/resume/roleDictionaries.js';
import { compileBullet } from '../server/utils/resume/bulletCompiler.js';

const outDir = '/mnt/data/templateos_phase24_outputs';
const pdfDir = path.join(outDir, 'pdf');
fs.mkdirSync(pdfDir, { recursive: true });

const store = makeTemplateStore({}, () => false);
const base = structuredClone(TEMPLATE_OS_BUILTINS.find((x) => x.id === 'editorial-professional'));
base.id = 'phase24-release-proof'; base.name = 'Phase 24 Release Proof'; base.status = 'DRAFT'; base.version = 1;
const deepCert = { certified: true, evidence: 'real-pdf-text-layer', atsLevel: 'VERY_HIGH', minIntegrity: 98, minOrderScore: 97 };
const actor = 'template-admin@careerautopilot.co';
const v1 = await store.save({ definition: base, status: 'DRAFT', source: 'builder', createdBy: actor, changeNote: 'Initial premium release candidate' });
let row = await store.get(base.id, { version: v1.version });
const transitions = [];
for (const [to, reason] of [['VALIDATING', 'deep certification started'], ['CERTIFIED', 'deep certification passed'], ['APPROVED', 'release approval'], ['PUBLISHED', 'production publish']]) {
  if (to === 'CERTIFIED') { await store.setCertification({ templateId: base.id, version: 1, certification: deepCert }); row = { ...row, certification: deepCert }; }
  const check = canTransitionTemplate(row, to);
  transitions.push({ from: row.status, to, allowed: check.ok, blockers: check.blockers });
  if (!check.ok) throw new Error(`Unexpected blocked transition ${row.status} -> ${to}: ${check.error}`);
  await store.setStatus({ templateId: base.id, version: 1, status: to, actor, reason });
  row = { ...row, status: to };
}
const directPublishBlocked = canTransitionTemplate({ ...row, status: 'DRAFT', certification: null }, 'PUBLISHED');
const v2def = { ...base, description: `${base.description} — revised release candidate` };
const v2 = await store.save({ definition: v2def, status: 'DRAFT', source: 'builder', createdBy: actor, baseVersion: 1, changeNote: 'Forked published v1 for a new design revision' });
const history = await store.history(base.id);

const fixture = TEMPLATE_FIXTURES.find((f) => f.id === 'senior-technical') || TEMPLATE_FIXTURES[0];
const editorial = TEMPLATE_OS_BUILTINS.find((x) => x.id === 'editorial-professional');
const compiled = compileTemplate(editorial, { density: 'balanced' });
const shaped = adaptTreeToShape(compiled, analyzeResumeShape(fixture.structured, { targetRole: 'Senior DevOps Engineer' }));
const composed = balancePageComposition(shaped, fixture.structured, { sizeId: 'a4' });
const pdf = renderTemplatePdf(composed, fixture.structured, { sizeId: 'a4' });
const pdfPath = path.join(pdfDir, 'editorial-regression-phase24.pdf');
fs.writeFileSync(pdfPath, Buffer.from(pdf.bytes));

const compiledVocabularyExamples = [
  compileBullet({ action: 'root-cause', object: 'intermittent deployment failures', tech: ['Kubernetes', 'Prometheus'], scope: '12 services', result: 'faster release triage', category: 'DEVOPS' }),
  compileBullet({ action: 'fine-tune', process: 'CI pipeline execution', tech: ['GitLab CI'], outcome: 'reducing release lead time', outcomeValue: '22%', category: 'DEVOPS' }),
  compileBullet({ action: 'triangulate', object: 'operational telemetry', tech: ['Prometheus', 'Grafana'], result: 'clearer incident diagnosis', category: 'ANALYZE' }),
];
const configuredRoleVerbs = Object.values(ROLE_ACTION_VERBS).flat();
const missingRoleVerbs = configuredRoleVerbs.filter((verb) => {
  const lower = String(verb).toLowerCase();
  return !VERB_DICTIONARY[lower] && !Object.values(VERB_DICTIONARY).some((v) => v.past.toLowerCase() === lower);
});

const proof = {
  phase: 24,
  lifecycleVersion: TEMPLATE_LIFECYCLE_VERSION,
  storeVersion: TEMPLATE_STORE_VERSION,
  primaryLifecycle: TEMPLATE_PRIMARY_LIFECYCLE,
  directDraftToPublishedBlocked: !directPublishBlocked.ok,
  transitions,
  publishedV1: {
    status: history.find((x) => x.version === 1)?.status,
    lifecycle: history.find((x) => x.version === 1)?.lifecycle,
    summary: templateLifecycleSummary(history.find((x) => x.version === 1)),
  },
  forkedV2: {
    version: v2.version,
    status: history.find((x) => x.version === 2)?.status,
    baseVersion: history.find((x) => x.version === 2)?.baseVersion,
    changeNote: history.find((x) => x.version === 2)?.changeNote,
  },
  vocabulary: {
    recognizedVerbCount: Object.keys(VERB_DICTIONARY).length,
    configuredRoleVerbCount: configuredRoleVerbs.length,
    missingConfiguredRoleVerbs: missingRoleVerbs,
    debugAlternatives: verbAlternatives('debug', 10),
    optimizeAlternatives: verbAlternatives('optimize', 20),
    transformAlternatives: verbAlternatives('transform', 20),
    compiledExamples: compiledVocabularyExamples.map((x) => ({ ok: x.ok, patternId: x.patternId, text: x.text })),
  },
  rendererRegression: {
    templateId: editorial.id,
    pdf: pdfPath,
    pageCount: pdf.pageCount,
    pageUsage: pdf.geometry?.pageUsage || [],
  },
};
fs.writeFileSync(path.join(outDir, 'phase24-lifecycle-vocabulary-proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof, null, 2));
