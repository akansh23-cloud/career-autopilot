/* ============================================================
   SERVER RUNTIME TEMPLATE CATALOG
   ------------------------------------------------------------
   Resolves the same published Template OS definitions used by the
   client runtime gallery for deterministic Resume OS operations
   (recommendation, tailoring, auto-fit and DOCX metadata).

   Static templates are always available. Stored TemplateDefinitions
   may override the same id only when they are PUBLISHED and their
   license is production-enabled. Draft/generated/license-pending rows
   never enter this catalog.
   ============================================================ */
import { RESUME_TEMPLATES } from '../../../web/src/lib/resumeTemplateRegistry.js';
import { toRegistryCard } from '../../../web/src/lib/templateOs/adapter.js';
import { BUILTIN_CERTIFICATION } from '../../../web/src/lib/templateOs/builtins.js';
import { makeTemplateStore } from './store.js';
import { isProductionLicenseCleared } from './adminPolicy.js';

export const SERVER_RUNTIME_TEMPLATE_CATALOG_VERSION = 'server-runtime-template-catalog-v2-template-pin';

function published(row) {
  return row?.status === 'PUBLISHED'
    && row?.definition
    && isProductionLicenseCleared(row.definition);
}

function merge(staticTemplates, runtimeCards) {
  const dynamic = new Map(runtimeCards.map((t) => [t.id, t]));
  const out = staticTemplates.map((t) => dynamic.get(t.id) || t);
  const staticIds = new Set(staticTemplates.map((t) => t.id));
  const additions = runtimeCards
    .filter((t) => !staticIds.has(t.id))
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  return [...out, ...additions];
}

export function makeRuntimeTemplateCatalog(db, dbOn = () => !!process.env.MONGODB_URI) {
  const store = makeTemplateStore(db, dbOn);
  const versionOf = (t) => Number(t?.templateVersion || t?.definition?.version || 1);
  const rowToCard = (row) => {
    if (!published(row)) return null;
    const cert = row.certification || BUILTIN_CERTIFICATION[row.templateId] || row.definition?.certification || null;
    const version = Number(row.version || row.definition?.version || 1);
    return {
      ...toRegistryCard({ ...row.definition, version, status: row.status }, cert),
      runtimeSource: row.source || 'stored',
      templateVersion: version,
      status: row.status,
    };
  };

  async function listPublishedCards() {
    const rows = (await store.list({ includeDrafts: true })).filter(published);
    const runtimeCards = rows.map(rowToCard).filter(Boolean);
    return merge(RESUME_TEMPLATES, runtimeCards);
  }

  /* Exact-version resolution is the Phase 18 invariant. A pinned resume may
     only render a different revision when its pin is absent (legacy doc) or
     the caller explicitly opts out of strict versioning. */
  async function resolve(templateId, templateVersion = null, { strictVersion = false } = {}) {
    const requested = Number.isInteger(Number(templateVersion)) && Number(templateVersion) > 0 ? Number(templateVersion) : null;
    if (templateId && requested) {
      const staticHit = RESUME_TEMPLATES.find((t) => (t.id === templateId || t.name === templateId) && versionOf(t) === requested);
      if (staticHit) return { ...staticHit, templateVersion: versionOf(staticHit) };
      const row = await store.get(templateId, { version: requested });
      const exact = rowToCard(row);
      if (exact && exact.templateVersion === requested) return exact;
      if (strictVersion) return null;
    }

    const catalog = await listPublishedCards();
    if (!templateId) return catalog[0] || RESUME_TEMPLATES[0];
    return catalog.find((t) => t.id === templateId || t.name === templateId) || catalog[0] || RESUME_TEMPLATES[0];
  }

  async function pinDocument(doc, { strictExisting = true } = {}) {
    const source = doc && typeof doc === 'object' ? doc : {};
    const existingVersion = Number.isInteger(Number(source.templateVersion)) && Number(source.templateVersion) > 0 ? Number(source.templateVersion) : null;
    const template = await resolve(source.templateId, existingVersion, { strictVersion: !!(existingVersion && strictExisting) });
    if (!template) return { ok: false, error: 'template_version_unavailable', templateId: source.templateId, templateVersion: existingVersion };
    return {
      ok: true,
      template,
      pinned: { ...source, templateId: template.id, templateVersion: versionOf(template) },
      migratedLegacyPin: !existingVersion,
    };
  }

  return { version: SERVER_RUNTIME_TEMPLATE_CATALOG_VERSION, listPublishedCards, resolve, pinDocument };
}

export default { SERVER_RUNTIME_TEMPLATE_CATALOG_VERSION, makeRuntimeTemplateCatalog };
