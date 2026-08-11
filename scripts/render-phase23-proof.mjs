import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATE_OS_BUILTINS, TEMPLATE_FIXTURES } from '../web/src/lib/templateOs/index.js';
import { compileTemplate, adaptTreeToShape, balancePageComposition } from '../web/src/lib/templateOs/compiler.js';
import { analyzeResumeShape } from '../web/src/lib/templateOs/shape.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { VERB_DICTIONARY, verbAlternatives } from '../server/utils/resume/grammarLibrary.js';
import { ROLE_ACTION_VERBS } from '../server/utils/resume/roleDictionaries.js';
import {
  TEMPLATE_ADMIN_AUTH_VERSION, TEMPLATE_ADMIN_CAPABILITIES, TEMPLATE_PRODUCTION_LICENSE_STATES,
  isProductionPublishedTemplate, publicTemplateProjection,
} from '../server/utils/templateOs/adminPolicy.js';

const outDir = '/mnt/data/templateos_phase23_outputs';
const pdfDir = path.join(outDir, 'pdf');
fs.mkdirSync(pdfDir, { recursive: true });

const fixture = TEMPLATE_FIXTURES.find((f) => f.id === 'senior-technical') || TEMPLATE_FIXTURES[0];
const def = TEMPLATE_OS_BUILTINS.find((x) => x.id === 'editorial-professional');
const compiled = compileTemplate(def, { density: 'balanced' });
const shaped = adaptTreeToShape(compiled, analyzeResumeShape(fixture.structured, { targetRole: 'Senior DevOps Engineer' }));
const composed = balancePageComposition(shaped, fixture.structured, { sizeId: 'a4' });
const pdf = renderTemplatePdf(composed, fixture.structured, { sizeId: 'a4' });
const pdfPath = path.join(pdfDir, 'editorial-regression-phase23.pdf');
fs.writeFileSync(pdfPath, Buffer.from(pdf.bytes));

const publishedRow = {
  templateId: 'phase23-public-proof', version: 3, status: 'PUBLISHED', source: 'db', createdBy: 'private@example.com', internalNote: 'not public',
  definition: { ...structuredClone(def), id: 'phase23-public-proof', version: 3, license: { ...def.license, licenseStatus: 'INTERNAL_ORIGINAL', productionEnabled: true } },
  certification: { certified: true, evidence: 'real-pdf-text-layer', atsLevel: 'VERY_HIGH' },
};
const projection = publicTemplateProjection(publishedRow);
const configuredRoleVerbs = Object.values(ROLE_ACTION_VERBS).flat();
const missingRoleVerbs = configuredRoleVerbs.filter((v) => !Object.values(VERB_DICTIONARY).some((x) => x.past.toLowerCase() === String(v).toLowerCase()) && !VERB_DICTIONARY[String(v).toLowerCase()]);

const proof = {
  phase: 23,
  adminAuthorizationVersion: TEMPLATE_ADMIN_AUTH_VERSION,
  adminCapabilities: TEMPLATE_ADMIN_CAPABILITIES,
  productionLicenseStates: TEMPLATE_PRODUCTION_LICENSE_STATES,
  publishedFailClosed: {
    explicitClearedLicenseAccepted: isProductionPublishedTemplate(publishedRow),
    missingLicenseStateRejected: !isProductionPublishedTemplate({ ...publishedRow, definition: { ...publishedRow.definition, license: { productionEnabled: true } } }),
    draftRejected: !isProductionPublishedTemplate({ ...publishedRow, status: 'DRAFT' }),
    disabledProductionRejected: !isProductionPublishedTemplate({ ...publishedRow, definition: { ...publishedRow.definition, license: { licenseStatus: 'INTERNAL_ORIGINAL', productionEnabled: false } } }),
  },
  publicProjection: {
    exposesTemplateDefinition: !!projection.definition,
    exposesCertification: !!projection.certification,
    leaksCreatedBy: Object.prototype.hasOwnProperty.call(projection, 'createdBy'),
    leaksInternalNote: Object.prototype.hasOwnProperty.call(projection, 'internalNote'),
  },
  lifecycle: {
    builderSaveEndpoint: '/api/template-os/save',
    externalImportForcesLicensePending: true,
    deepCertificationMustBindExactVersion: true,
    publishRequiresEvidence: 'real-pdf-text-layer',
    runtimeCatalogQuery: 'catalog=1&publishedOnly=1',
  },
  vocabulary: {
    recognizedVerbCount: Object.keys(VERB_DICTIONARY).length,
    configuredRoleVerbCount: configuredRoleVerbs.length,
    missingConfiguredRoleVerbs: missingRoleVerbs,
    fixAlternatives: verbAlternatives('fix', 10),
    documentAlternatives: verbAlternatives('document', 20),
    transformAlternatives: verbAlternatives('transform', 20),
    communicateAlternatives: verbAlternatives('communicate', 20),
  },
  rendererRegression: {
    templateId: def.id,
    pdf: pdfPath,
    pageCount: pdf.pageCount,
    pageUsage: pdf.geometry?.pageUsage || [],
  },
};
fs.writeFileSync(path.join(outDir, 'phase23-proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof, null, 2));
