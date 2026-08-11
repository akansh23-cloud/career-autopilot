/* ============================================================
   TEMPLATE OS — SERVER STORE
   ------------------------------------------------------------
   Layered template resolution:
     1. BUILTINS  — code-shipped, versioned definitions (always available)
     2. MEMORY    — generated/imported drafts for this process
     3. DATABASE  — versioned persistence when Mongo is configured

   Definition content is immutable after save. Lifecycle status and
   certification are version-bound metadata and may advance on that exact
   version. Any content edit creates a NEW version and records its base.
   ============================================================ */
import { TEMPLATE_OS_BUILTINS } from '../../../web/src/lib/templateOs/builtins.js';
import { lifecycleEvent, templateLifecycleSummary } from '../../../web/src/lib/templateOs/lifecycle.js';

export const TEMPLATE_STORE_VERSION = 'template-store-v3-db-authoritative-version-lifecycle-history';

const memory = new Map(); // templateId -> [versions desc]

function initialLifecycle({ status, actor = '', reason = '' }) {
  const event = lifecycleEvent({ from: '', to: status, actor, reason: reason || 'version_created' });
  return { history: [event], createdAt: event.at, lastTransitionAt: event.at };
}

function enrich(row) {
  if (!row) return row;
  return { ...row, lifecycleSummary: templateLifecycleSummary(row) };
}

export function makeTemplateStore(db, dbOn) {
  const dbReady = () => !!(dbOn() && db.saveTemplateDefinition);

  return {
    version: TEMPLATE_STORE_VERSION,

    builtins: () => TEMPLATE_OS_BUILTINS,

    async list({ includeDrafts = true } = {}) {
      const out = new Map();
      for (const d of TEMPLATE_OS_BUILTINS) out.set(d.id, enrich({ templateId: d.id, version: d.version, status: d.status, source: 'builtin', definition: d, lifecycle: initialLifecycle({ status: d.status, reason: 'builtin' }) }));
      if (includeDrafts) {
        for (const [id, versions] of memory) out.set(id, enrich(versions[0]));
        if (dbReady()) {
          for (const row of await db.listTemplateDefinitions({})) {
            if (!out.has(row.templateId) || out.get(row.templateId).source === 'builtin') out.set(row.templateId, enrich({ ...row, source: row.source || 'db' }));
          }
        }
      }
      return [...out.values()];
    },

    async history(templateId) {
      const rows = new Map();
      const builtin = TEMPLATE_OS_BUILTINS.find((d) => d.id === templateId);
      if (builtin) rows.set(Number(builtin.version), enrich({ templateId, version: builtin.version, status: builtin.status, source: 'builtin', definition: builtin, lifecycle: initialLifecycle({ status: builtin.status, reason: 'builtin' }) }));
      for (const row of (memory.get(templateId) || [])) rows.set(Number(row.version), enrich(row));
      if (dbReady() && db.listTemplateDefinitionVersions) {
        for (const row of await db.listTemplateDefinitionVersions({ templateId })) rows.set(Number(row.version), enrich(row));
      }
      return [...rows.values()].sort((a, b) => Number(b.version) - Number(a.version));
    },

    async get(templateId, { version = null } = {}) {
      const builtin = TEMPLATE_OS_BUILTINS.find((d) => d.id === templateId);
      if (builtin && (!version || builtin.version === version)) return enrich({ templateId, version: builtin.version, status: builtin.status, source: 'builtin', definition: builtin, lifecycle: initialLifecycle({ status: builtin.status, reason: 'builtin' }) });
      const mem = memory.get(templateId);
      if (mem) {
        const hit = version ? mem.find((v) => v.version === version) : mem[0];
        if (hit) return enrich(hit);
      }
      if (dbReady()) return enrich(await db.getTemplateDefinition({ templateId, version }));
      return null;
    },

    async save({ definition, status = 'DRAFT', source = 'internal', certification = null, createdBy = '', baseVersion = null, changeNote = '' }) {
      const templateId = definition.id;
      const versions = memory.get(templateId) || [];
      const localVersion = versions.length ? versions[0].version + 1 : (Number(definition.version) || 1);
      let persisted = { ok: false, reason: 'db_disabled' };
      if (dbReady()) {
        /* Mongo owns the version sequence when persistence is enabled. */
        persisted = await db.saveTemplateDefinition({ templateId, definition: { ...definition, version: localVersion }, status, source, certification, createdBy, baseVersion, changeNote });
      }
      const version = persisted.ok ? Number(persisted.version) : localVersion;
      const lifecycle = initialLifecycle({ status, actor: createdBy, reason: changeNote || (baseVersion ? `forked_from_v${baseVersion}` : 'version_created') });
      const row = {
        templateId, version, status, source, certification,
        definition: { ...definition, version }, createdBy,
        baseVersion: baseVersion ? Number(baseVersion) : null,
        changeNote: String(changeNote || '').slice(0, 240), lifecycle,
        updatedAt: new Date().toISOString(),
      };
      memory.set(templateId, [row, ...versions.filter((v) => Number(v.version) !== version)].sort((a, b) => Number(b.version) - Number(a.version)));
      return { ok: true, templateId, version, persisted: persisted.ok, baseVersion: row.baseVersion };
    },

    async setCertification({ templateId, version, certification }) {
      const mem = memory.get(templateId);
      const hit = mem?.find((v) => v.version === version);
      if (hit) hit.certification = certification;
      let persisted = { ok: false };
      if (dbReady() && db.setTemplateDefinitionCertification) persisted = await db.setTemplateDefinitionCertification({ templateId, version, certification });
      return { ok: !!hit || persisted.ok, persisted: persisted.ok };
    },

    async setStatus({ templateId, version, status, actor = '', reason = '' }) {
      const mem = memory.get(templateId);
      const hit = mem?.find((v) => v.version === version);
      const current = hit || (dbReady() ? await db.getTemplateDefinition({ templateId, version }) : null);
      const from = String(current?.status || '');
      const event = lifecycleEvent({ from, to: status, actor, reason });
      if (hit) {
        hit.status = status;
        hit.lifecycle = hit.lifecycle || { history: [] };
        hit.lifecycle.history = [...(hit.lifecycle.history || []), event].slice(-50);
        hit.lifecycle.lastTransitionAt = event.at;
        if (status === 'APPROVED') { hit.lifecycle.approvedAt = event.at; hit.lifecycle.approvedBy = event.actor; }
        if (status === 'PUBLISHED') { hit.lifecycle.publishedAt = event.at; hit.lifecycle.publishedBy = event.actor; }
        if (status === 'DISABLED') { hit.lifecycle.disabledAt = event.at; hit.lifecycle.disabledBy = event.actor; }
      }
      let persisted = { ok: false };
      if (dbReady()) persisted = await db.setTemplateDefinitionStatus({ templateId, version, status, event });
      return { ok: !!hit || persisted.ok, persisted: persisted.ok, event };
    },
  };
}

export default { TEMPLATE_STORE_VERSION, makeTemplateStore };
