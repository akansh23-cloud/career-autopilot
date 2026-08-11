/* ============================================================================
   runtimeTemplateCatalog.js — client-side published Template OS catalog
   ----------------------------------------------------------------------------
   Phase 17 closes the Template OS runtime loop without mutating the static
   RESUME_TEMPLATES array. Code-shipped templates remain the offline baseline;
   published stored TemplateDefinitions can be installed at runtime and
   override the same template id only inside the runtime catalog.

   Security/lifecycle rule: this module accepts only rows already marked
   PUBLISHED with productionEnabled === true. The server owns that gate too;
   the duplicate client check prevents an accidental admin/draft payload from
   leaking into Resume Studio.
   ========================================================================== */
import { toRegistryCard } from './templateOs/adapter.js';

export const RUNTIME_TEMPLATE_CATALOG_VERSION = 'runtime-template-catalog-v2-template-pin';

const PRODUCTION_LICENSE_STATES = new Set(['INTERNAL_ORIGINAL', 'OWNED', 'OPEN_SOURCE', 'LICENSED']);

const runtimeCards = new Map(); // latest published card per id
const runtimeVersions = new Map(); // id -> Map(version, exact historical card)

function isPublishedProductionRow(row) {
  return !!(
    row
    && row.status === 'PUBLISHED'
    && row.definition
    && row.definition.id
    && row.definition.license?.productionEnabled === true
    && PRODUCTION_LICENSE_STATES.has(String(row.definition.license?.licenseStatus || ''))
  );
}

function rowCertification(row) {
  return row?.certification || row?.definition?.certification || null;
}

/** Install a server catalog snapshot. Existing runtime cards are replaced so
 * disabling/unpublishing a template on the server removes it after refresh. */
function cardFromRow(row) {
  if (!isPublishedProductionRow(row)) return null;
  const def = { ...row.definition, version: Number(row.version || row.definition.version || 1), status: row.status };
  return {
    ...toRegistryCard(def, rowCertification(row)),
    runtime: true,
    runtimeSource: row.source || 'stored',
    templateVersion: Number(row.version || def.version || 1),
    status: row.status,
  };
}

function rememberExact(card) {
  if (!card?.id || !Number.isInteger(Number(card.templateVersion))) return;
  const versions = runtimeVersions.get(card.id) || new Map();
  versions.set(Number(card.templateVersion), card);
  runtimeVersions.set(card.id, versions);
}

/** Install a server catalog snapshot. Existing latest runtime cards are
 * replaced so disabling/unpublishing a template removes it after refresh.
 * Exact historical rows hydrated for pinned documents live in a separate
 * version map and are never allowed to replace the latest catalog entry. */
export function installRuntimeTemplateRows(rows = [], { staticTemplates = [] } = {}) {
  runtimeCards.clear();
  runtimeVersions.clear();
  const staticById = new Map((staticTemplates || []).map((t) => [t.id, t]));
  let installed = 0;
  let skippedBuiltins = 0;
  let rejected = 0;

  for (const row of rows || []) {
    const card = cardFromRow(row);
    if (!card) { rejected += 1; continue; }
    const existing = staticById.get(card.id);
    const sameOrOlderBuiltin = row.source === 'builtin'
      && existing
      && Number(card.templateVersion || 1) <= Number(existing.definition?.version || existing.templateVersion || 1);
    if (sameOrOlderBuiltin) { skippedBuiltins += 1; continue; }
    runtimeCards.set(card.id, card);
    rememberExact(card);
    installed += 1;
  }

  return { installed, skippedBuiltins, rejected, version: RUNTIME_TEMPLATE_CATALOG_VERSION };
}

/** Add one exact published row without replacing/clearing the current catalog.
 * Used when opening an older resume pinned to a historical template version. */
export function installRuntimeTemplateVersionRow(row) {
  const card = cardFromRow(row);
  if (!card) return { installed: false, rejected: true };
  rememberExact(card);
  const latest = runtimeCards.get(card.id);
  if (!latest || Number(card.templateVersion) > Number(latest.templateVersion || 1)) runtimeCards.set(card.id, card);
  return { installed: true, card };
}

export function clearRuntimeTemplateCatalog() { runtimeCards.clear(); runtimeVersions.clear(); }

export function getRuntimeTemplateCards() { return [...runtimeCards.values()]; }

export function getRuntimeTemplateCard(idOrName, templateVersion = null) {
  if (!idOrName) return null;
  const requested = Number.isInteger(Number(templateVersion)) && Number(templateVersion) > 0 ? Number(templateVersion) : null;
  if (requested) {
    const byId = runtimeVersions.get(idOrName)?.get(requested);
    if (byId) return byId;
    for (const versions of runtimeVersions.values()) {
      const hit = versions.get(requested);
      if (hit && hit.name === idOrName) return hit;
    }
    return null;
  }
  for (const card of runtimeCards.values()) {
    if (card.id === idOrName || card.name === idOrName) return card;
  }
  return null;
}

/** Runtime cards replace the same static id in place; brand-new templates are
 * appended in deterministic name/id order so the gallery does not jump around. */
export function mergeTemplateCatalog(staticTemplates = [], dynamicTemplates = getRuntimeTemplateCards()) {
  const dynamicById = new Map((dynamicTemplates || []).map((t) => [t.id, t]));
  const merged = (staticTemplates || []).map((t) => dynamicById.get(t.id) || t);
  const staticIds = new Set((staticTemplates || []).map((t) => t.id));
  const additions = (dynamicTemplates || [])
    .filter((t) => !staticIds.has(t.id))
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  return [...merged, ...additions];
}

export function runtimeTemplateCatalogSnapshot() {
  return {
    version: RUNTIME_TEMPLATE_CATALOG_VERSION,
    count: runtimeCards.size,
    templates: getRuntimeTemplateCards().map((t) => ({
      id: t.id, name: t.name, templateVersion: t.templateVersion,
      source: t.runtimeSource, atsLevel: t.atsLevel, layoutType: t.layoutType,
    })),
  };
}

export default {
  RUNTIME_TEMPLATE_CATALOG_VERSION,
  installRuntimeTemplateRows,
  installRuntimeTemplateVersionRow,
  clearRuntimeTemplateCatalog,
  getRuntimeTemplateCards,
  getRuntimeTemplateCard,
  mergeTemplateCatalog,
  runtimeTemplateCatalogSnapshot,
};
