/* ============================================================================
   Template OS lifecycle — immutable-definition production state machine
   ----------------------------------------------------------------------------
   A stored TemplateDefinition version is immutable content. Lifecycle state may
   advance on that exact version, but editing content always creates a NEW
   version. This module is shared by the server and Template Builder so the UI
   can explain the same gates the API enforces.
   ========================================================================== */

export const TEMPLATE_LIFECYCLE_VERSION = 'template-lifecycle-v1-immutable-approval';

export const TEMPLATE_LIFECYCLE_STATUSES = Object.freeze([
  'DRAFT', 'GENERATED', 'LICENSE_PENDING', 'VALIDATING', 'CERTIFIED', 'APPROVED', 'PUBLISHED', 'DISABLED',
]);

export const TEMPLATE_PRIMARY_LIFECYCLE = Object.freeze(['DRAFT', 'VALIDATING', 'CERTIFIED', 'APPROVED', 'PUBLISHED']);

const ALLOWED = Object.freeze({
  GENERATED: ['DRAFT', 'DISABLED'],
  LICENSE_PENDING: ['DRAFT', 'DISABLED'],
  DRAFT: ['VALIDATING', 'DISABLED'],
  VALIDATING: ['CERTIFIED', 'DRAFT', 'DISABLED'],
  CERTIFIED: ['APPROVED', 'DISABLED'],
  APPROVED: ['PUBLISHED', 'DISABLED'],
  PUBLISHED: ['DISABLED'],
  DISABLED: [],
});

export function isDeepCertified(row) {
  const cert = row?.certification || row?.definition?.certification || null;
  return !!cert?.certified && cert?.evidence === 'real-pdf-text-layer';
}

export function isLifecycleLicenseCleared(row) {
  const license = row?.definition?.license || row?.license || {};
  return license.productionEnabled === true
    && ['INTERNAL_ORIGINAL', 'OWNED', 'OPEN_SOURCE', 'LICENSED'].includes(String(license.licenseStatus || ''));
}

export function lifecycleBlockers(row, targetStatus) {
  const target = String(targetStatus || '').toUpperCase();
  const blockers = [];
  if (target === 'CERTIFIED' && !isDeepCertified(row)) blockers.push('deep_certification_required');
  if (target === 'APPROVED') {
    if (!isDeepCertified(row)) blockers.push('deep_certification_required');
    if (!isLifecycleLicenseCleared(row)) blockers.push('license_clearance_required');
  }
  if (target === 'PUBLISHED') {
    if (!isDeepCertified(row)) blockers.push('deep_certification_required');
    if (!isLifecycleLicenseCleared(row)) blockers.push('license_clearance_required');
  }
  return blockers;
}

export function canTransitionTemplate(row, targetStatus) {
  const from = String(row?.status || 'DRAFT').toUpperCase();
  const to = String(targetStatus || '').toUpperCase();
  if (!TEMPLATE_LIFECYCLE_STATUSES.includes(from) || !TEMPLATE_LIFECYCLE_STATUSES.includes(to)) {
    return { ok: false, from, to, error: 'unsupported_lifecycle_status', blockers: ['unsupported_lifecycle_status'] };
  }
  if (from === to) return { ok: true, from, to, noop: true, blockers: [] };
  const allowed = ALLOWED[from] || [];
  if (!allowed.includes(to)) return { ok: false, from, to, error: 'invalid_lifecycle_transition', blockers: ['invalid_lifecycle_transition'] };
  const blockers = lifecycleBlockers(row, to);
  return blockers.length ? { ok: false, from, to, error: blockers[0], blockers } : { ok: true, from, to, blockers: [] };
}

export function templateLifecycleSummary(row = {}) {
  const status = String(row.status || 'DRAFT').toUpperCase();
  const primaryIndex = TEMPLATE_PRIMARY_LIFECYCLE.indexOf(status);
  const licenseCleared = isLifecycleLicenseCleared(row);
  const deepCertified = isDeepCertified(row);
  return {
    version: TEMPLATE_LIFECYCLE_VERSION,
    status,
    primaryIndex,
    deepCertified,
    licenseCleared,
    published: status === 'PUBLISHED',
    immutableContent: true,
    next: (ALLOWED[status] || []).filter((target) => canTransitionTemplate(row, target).ok),
    gates: {
      validate: status === 'DRAFT' || status === 'VALIDATING',
      certify: status === 'DRAFT' || status === 'VALIDATING',
      approve: status === 'CERTIFIED' && deepCertified && licenseCleared,
      publish: status === 'APPROVED' && deepCertified && licenseCleared,
      forkToEdit: ['CERTIFIED', 'APPROVED', 'PUBLISHED', 'DISABLED'].includes(status),
    },
  };
}

/* Fingerprint only immutable design/content fields. Storage version, lifecycle
   status, and certification measurements must not make an unchanged template
   look edited in the Builder. License data IS intentionally included because a
   clearance change must be saved as a new immutable version. */
export function templateDefinitionFingerprint(definition = {}) {
  const clone = JSON.parse(JSON.stringify(definition || {}));
  delete clone.version;
  delete clone.status;
  delete clone.certification;
  delete clone.atsLevel;
  return JSON.stringify(clone);
}

export function lifecycleEvent({ from = '', to = '', actor = '', reason = '', at = null } = {}) {
  return {
    from: String(from || '').slice(0, 24),
    to: String(to || '').slice(0, 24),
    actor: String(actor || '').slice(0, 160),
    reason: String(reason || '').slice(0, 240),
    at: at || new Date().toISOString(),
  };
}

export default {
  TEMPLATE_LIFECYCLE_VERSION,
  TEMPLATE_LIFECYCLE_STATUSES,
  TEMPLATE_PRIMARY_LIFECYCLE,
  isDeepCertified,
  isLifecycleLicenseCleared,
  lifecycleBlockers,
  canTransitionTemplate,
  templateLifecycleSummary,
  templateDefinitionFingerprint,
  lifecycleEvent,
};
