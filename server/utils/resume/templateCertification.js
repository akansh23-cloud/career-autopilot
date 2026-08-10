/* ============================================================
   TEMPLATE CERTIFICATION — "Career Autopilot ATS Checked"
   ------------------------------------------------------------
   Runs every template against every resume fixture through the
   REAL render pipeline (buildResumeBlocks -> block HTML) and
   the ATS parse simulator. A template is certified only when,
   for EVERY fixture:
     • parse integrity ≥ 90%
     • zero critical field loss (name/email/company/title)
     • all present section headings recovered
   No external ATS is guaranteed or claimed — this certifies OUR
   rendering keeps the content machine-readable.
   Results are deterministic and cached per process.
   ============================================================ */
import { buildResumeBlocks } from '../../../web/src/lib/resumeRenderer.js';
import { RESUME_TEMPLATES } from '../../../web/src/lib/resumeTemplateRegistry.js';
import { RESUME_FIXTURES } from '../../../web/src/lib/resumeFixtures.js';
import { fromStructuredResume } from './resumeDocument.js';
import { simulateAtsParse } from './atsParseSimulator.js';

export const CERTIFICATION_VERSION = 'tpl-cert-v1';
export const CERT_THRESHOLDS = Object.freeze({ integrity: 90, headingRecovery: 1 });

export function certifyTemplate(templateId, fixtures = RESUME_FIXTURES) {
  const runs = [];
  for (const fx of fixtures) {
    const { blocks } = buildResumeBlocks(fx.data, templateId);
    const html = blocks.map((b) => b.html).join('\n');
    const doc = fromStructuredResume(fx.data);
    const sim = simulateAtsParse(doc, html);
    runs.push({ fixtureId: fx.id, integrity: sim.integrity, headingRecovery: sim.headingRecovery, criticalLoss: sim.criticalLoss, pass: sim.integrity >= CERT_THRESHOLDS.integrity && sim.criticalLoss.length === 0 && sim.headingRecovery >= CERT_THRESHOLDS.headingRecovery });
  }
  const minIntegrity = Math.min(...runs.map((r) => r.integrity));
  const certified = runs.every((r) => r.pass);
  return {
    templateId, certified, minIntegrity,
    label: certified ? 'Career Autopilot ATS Checked' : 'Not certified',
    runs,
  };
}

let _cache = null;
export function certifyAllTemplates({ force = false } = {}) {
  if (_cache && !force) return _cache;
  const results = RESUME_TEMPLATES
    .filter((t) => t.previewType === 'structural')
    .map((t) => certifyTemplate(t.id));
  _cache = {
    version: CERTIFICATION_VERSION,
    generatedAt: new Date().toISOString(),
    thresholds: CERT_THRESHOLDS,
    certified: results.filter((r) => r.certified).map((r) => r.templateId),
    failed: results.filter((r) => !r.certified).map((r) => ({ templateId: r.templateId, minIntegrity: r.minIntegrity })),
    results,
  };
  return _cache;
}

export default { CERTIFICATION_VERSION, CERT_THRESHOLDS, certifyTemplate, certifyAllTemplates };
