import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TEMPLATE_OS_BUILTINS, BUILTIN_CERTIFICATION } from '../web/src/lib/templateOs/builtins.js';
import { makeRuntimeTemplateCatalog } from '../server/utils/templateOs/runtimeCatalog.js';
import { normalizeResumeDocument, toRendererStructured } from '../server/utils/resume/resumeDocument.js';
import { compileTemplate, adaptTreeToShape, normalizeResumeDensityToTemplateMode } from '../web/src/lib/templateOs/compiler.js';
import { analyzeResumeShape } from '../web/src/lib/templateOs/shape.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { getTemplatePreviewStructured } from '../web/src/lib/templateOs/previewFixtures.js';

const outDir = '/mnt/data/templateos_phase18_outputs';
mkdirSync(outDir, { recursive: true });
const clone = (v) => structuredClone(v);
const v1Base = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'technical-sidebar');
const v2Base = TEMPLATE_OS_BUILTINS.find((d) => d.id === 'cloud-infrastructure-pro');
const id = 'runtime-version-pin-proof';
const commonLicense = { licenseStatus: 'INTERNAL_ORIGINAL', productionEnabled: true };
const v1 = { ...clone(v1Base), id, name: 'Version Pin Proof', version: 1, status: 'PUBLISHED', description: 'Historical v1 — left technical rail.', license: commonLicense };
const v2 = { ...clone(v2Base), id, name: 'Version Pin Proof', version: 2, status: 'PUBLISHED', description: 'Current v2 — right infrastructure rail.', license: commonLicense };
const cert = { ...(BUILTIN_CERTIFICATION['technical-sidebar'] || {}), certified: true, atsLevel: 'HIGH', evidence: 'real-pdf-text-layer' };
const row1 = { templateId: id, version: 1, status: 'PUBLISHED', source: 'phase18-proof', definition: v1, certification: cert };
const row2 = { templateId: id, version: 2, status: 'PUBLISHED', source: 'phase18-proof', definition: v2, certification: cert };
const db = {
  saveTemplateDefinition: async () => ({ ok: true, version: 3 }),
  listTemplateDefinitions: async () => [row2],
  getTemplateDefinition: async ({ templateId, version }) => {
    if (templateId !== id) return null;
    if (Number(version) === 1) return row1;
    if (Number(version) === 2 || version == null) return row2;
    return null;
  },
};
const catalog = makeRuntimeTemplateCatalog(db, () => true);
const historicalDoc = normalizeResumeDocument({ id: 'resume-historical', title: 'Historical Pinned Resume', templateId: id, templateVersion: 1, targetRole: 'Senior DevOps Engineer' });
const legacyDoc = normalizeResumeDocument({ id: 'resume-legacy', title: 'Legacy Unpinned Resume', templateId: id, targetRole: 'Senior DevOps Engineer' });
const historicalPin = await catalog.pinDocument(historicalDoc);
const legacyPin = await catalog.pinDocument(legacyDoc);
const latest = await catalog.resolve(id);
const exactV1 = await catalog.resolve(id, 1, { strictVersion: true });
if (!historicalPin.ok || historicalPin.pinned.templateVersion !== 1) throw new Error('historical resume did not remain pinned to v1');
if (!legacyPin.ok || legacyPin.pinned.templateVersion !== 2) throw new Error('legacy resume did not pin current v2');
if (latest.templateVersion !== 2 || exactV1.templateVersion !== 1) throw new Error('catalog version resolution failed');

const structured = getTemplatePreviewStructured({ ...exactV1, supportedRoles: ['devops'] });
function render(card, filename) {
  const compiled = adaptTreeToShape(
    compileTemplate(card.definition, { density: normalizeResumeDensityToTemplateMode('compact') }),
    analyzeResumeShape(structured, { targetRole: 'Senior DevOps Engineer', atsPriority: 'high' }),
  );
  const pdf = renderTemplatePdf(compiled, structured, { sizeId: 'a4' });
  const bytes = Buffer.from(pdf.bytes);
  writeFileSync(`${outDir}/${filename}`, bytes);
  return { pageCount: pdf.pageCount, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const v1Pdf = render(exactV1, 'pinned-resume-template-v1.pdf');
const v2Pdf = render(latest, 'current-catalog-template-v2.pdf');
writeFileSync(`${outDir}/template-version-pinning-proof.json`, JSON.stringify({
  templateId: id,
  catalogLatestVersion: latest.templateVersion,
  historicalResume: {
    requestedVersion: historicalDoc.templateVersion,
    resolvedVersion: historicalPin.pinned.templateVersion,
    stayedPinned: historicalPin.pinned.templateVersion === 1,
    layoutType: exactV1.definition.layout.type,
    pdf: v1Pdf,
  },
  legacyResume: {
    originalVersion: legacyDoc.templateVersion,
    pinnedOnAuthoritativeResolution: legacyPin.pinned.templateVersion,
    migratedLegacyPin: legacyPin.migratedLegacyPin,
  },
  currentCatalog: {
    version: latest.templateVersion,
    layoutType: latest.definition.layout.type,
    pdf: v2Pdf,
  },
  pdfsDiffer: v1Pdf.sha256 !== v2Pdf.sha256,
}, null, 2));
console.log('Phase 18 version pin proof generated:', { historical: historicalPin.pinned.templateVersion, latest: latest.templateVersion, legacyPinned: legacyPin.pinned.templateVersion });
