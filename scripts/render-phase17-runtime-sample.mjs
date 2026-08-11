import { writeFileSync } from 'node:fs';
import { RESUME_TEMPLATES, getResumeTemplate } from '../web/src/lib/resumeTemplateRegistry.js';
import { installRuntimeTemplateRows, clearRuntimeTemplateCatalog } from '../web/src/lib/runtimeTemplateCatalog.js';
import { TEMPLATE_OS_BUILTINS, BUILTIN_CERTIFICATION } from '../web/src/lib/templateOs/builtins.js';
import { compileTemplate, adaptTreeToShape, normalizeResumeDensityToTemplateMode } from '../web/src/lib/templateOs/compiler.js';
import { analyzeResumeShape } from '../web/src/lib/templateOs/shape.js';
import { renderTemplatePdf } from '../web/src/lib/templateOs/pdfWriter.js';
import { getTemplatePreviewStructured } from '../web/src/lib/templateOs/previewFixtures.js';

const base = structuredClone(TEMPLATE_OS_BUILTINS.find((d) => d.id === 'balanced-two-column'));
const definition = {
  ...base,
  id: 'runtime-published-market-pro',
  name: 'Runtime Published Market Pro',
  version: 3,
  status: 'PUBLISHED',
  description: 'Phase 17 proof: a published stored definition that is not code-shipped in RESUME_TEMPLATES.',
  colors: { ...base.colors, accent: '#334155' },
  license: { ...(base.license || {}), licenseStatus: 'INTERNAL_ORIGINAL', productionEnabled: true },
};

if (RESUME_TEMPLATES.some((t) => t.id === definition.id)) throw new Error('sample id unexpectedly exists in static registry');
clearRuntimeTemplateCatalog();
installRuntimeTemplateRows([{
  templateId: definition.id,
  version: definition.version,
  status: 'PUBLISHED',
  source: 'phase17-proof',
  definition,
  certification: { ...BUILTIN_CERTIFICATION['balanced-two-column'], certified: true, atsLevel: 'HIGH', evidence: 'real-pdf-text-layer' },
}], { staticTemplates: RESUME_TEMPLATES });

const card = getResumeTemplate(definition.id);
if (!card.runtime || card.templateVersion !== 3) throw new Error('runtime resolver did not resolve the installed published template');
const structured = getTemplatePreviewStructured({ ...card, supportedRoles: ['product manager'] });
const compiled = adaptTreeToShape(
  compileTemplate(card.definition, { density: normalizeResumeDensityToTemplateMode('compact') }),
  analyzeResumeShape(structured, { targetRole: 'Product Manager', atsPriority: 'high' }),
);
const pdf = renderTemplatePdf(compiled, structured, { sizeId: 'a4' });
writeFileSync('/mnt/data/templateos_phase17_outputs/runtime-published-market-pro.pdf', Buffer.from(pdf.bytes));
writeFileSync('/mnt/data/templateos_phase17_outputs/runtime-catalog-proof.json', JSON.stringify({
  staticRegistryContainsTemplate: false,
  resolvedAtRuntime: true,
  id: card.id,
  name: card.name,
  runtime: card.runtime,
  runtimeSource: card.runtimeSource,
  templateVersion: card.templateVersion,
  engine: card.engine,
  layoutType: card.layoutType,
  atsLevel: card.atsLevel,
  pageCount: pdf.pageCount,
  pdfBytes: pdf.bytes.length,
}, null, 2));
