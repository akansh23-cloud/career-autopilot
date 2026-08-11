/* ============================================================
   TEMPLATE OS — ADMIN AUTHORIZATION POLICY
   ------------------------------------------------------------
   Pure helpers used by the API boundary so authorization rules
   are explicit, testable and fail closed.
   ============================================================ */

export const TEMPLATE_ADMIN_AUTH_VERSION = 'template-admin-auth-v1-server-authoritative';

export const TEMPLATE_PRODUCTION_LICENSE_STATES = Object.freeze(['INTERNAL_ORIGINAL', 'OWNED', 'OPEN_SOURCE', 'LICENSED']);

export const TEMPLATE_ADMIN_CAPABILITIES = Object.freeze([
  'builder:read-drafts',
  'builder:read-version-history',
  'builder:validate',
  'builder:thumbnail',
  'builder:import-definition',
  'builder:import-package',
  'builder:generate',
  'builder:certify',
  'builder:change-status',
  'builder:approve',
  'builder:fork-published',
]);

export function isRuntimeCatalogRequest(req = {}) {
  return String(req?.query?.catalog || '') === '1' && String(req?.query?.publishedOnly || '') === '1';
}

export function isProductionLicenseCleared(definition) {
  const license = definition?.license || {};
  return license.productionEnabled === true && TEMPLATE_PRODUCTION_LICENSE_STATES.includes(String(license.licenseStatus || ''));
}

export function isProductionPublishedTemplate(row) {
  return !!row && row.status === 'PUBLISHED' && isProductionLicenseCleared(row.definition);
}


export function publicTemplateProjection(row) {
  if (!row) return null;
  return {
    templateId: row.templateId,
    version: row.version,
    status: row.status,
    source: row.source,
    definition: row.definition,
    certification: row.certification || row.definition?.certification || null,
  };
}

export function safeTemplateAudit({ action = '', templateId = '', version = null, status = '', source = '' } = {}) {
  const parsedVersion = version === null || version === undefined || version === '' ? null : Number(version);
  return {
    action: String(action || '').slice(0, 64),
    templateId: String(templateId || '').slice(0, 80),
    version: Number.isInteger(parsedVersion) && parsedVersion > 0 ? parsedVersion : null,
    status: String(status || '').slice(0, 24),
    source: String(source || '').slice(0, 24),
  };
}

export default {
  TEMPLATE_ADMIN_AUTH_VERSION,
  TEMPLATE_ADMIN_CAPABILITIES, TEMPLATE_PRODUCTION_LICENSE_STATES,
  isRuntimeCatalogRequest, isProductionLicenseCleared,
  isProductionPublishedTemplate,
  publicTemplateProjection,
  safeTemplateAudit,
};
