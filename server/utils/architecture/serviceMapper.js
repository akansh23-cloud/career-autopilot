/* ============================================================
   CLOUD SERVICE MAPPER  (deterministic)
   ------------------------------------------------------------
   Maps generic capabilities to provider-specific service names
   (AWS / Azure / GCP / generic). Never throws — unknown
   capabilities fall back to their catalog label.
   ============================================================ */
import { CAPABILITY_CATALOG, CLOUD_SERVICES } from './knowledgeBase.js';

export const PROVIDERS = ['aws', 'azure', 'gcp', 'generic'];

export function normalizeProvider(p) {
  const v = String(p || '').toLowerCase().trim();
  if (/^aws|amazon/.test(v)) return 'aws';
  if (/azure|microsoft/.test(v)) return 'azure';
  if (/gcp|google/.test(v)) return 'gcp';
  return 'generic';
}

/* Provider-specific display name for a capability ("Cache" → "ElastiCache (Redis)"). */
export function serviceNameFor(capability, provider = 'generic') {
  const prov = normalizeProvider(provider);
  const mapped = CLOUD_SERVICES[capability]?.[prov];
  if (mapped) return mapped;
  return CAPABILITY_CATALOG[capability]?.label || capability;
}

/* Full mapping row for one capability across all providers (for legends/docs). */
export function mappingRow(capability) {
  const cat = CAPABILITY_CATALOG[capability] || { label: capability };
  const svc = CLOUD_SERVICES[capability] || {};
  return {
    capability,
    label: cat.label,
    aws: svc.aws || cat.label,
    azure: svc.azure || cat.label,
    gcp: svc.gcp || cat.label,
    generic: svc.generic || cat.label,
  };
}

/* Decorate a node label with the provider service when it differs.
   "Cache" on aws → "Cache · ElastiCache (Redis)" (kept short for diagrams). */
export function decoratedLabel(capability, provider = 'generic') {
  const cat = CAPABILITY_CATALOG[capability];
  const base = cat?.label || capability;
  const prov = normalizeProvider(provider);
  if (prov === 'generic') return base;
  const svc = CLOUD_SERVICES[capability]?.[prov];
  if (!svc || svc === base) return base;
  return `${svc}`;
}

export default { serviceNameFor, mappingRow, decoratedLabel, normalizeProvider, PROVIDERS };
