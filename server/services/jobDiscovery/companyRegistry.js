/* ============================================================
   JOB DISCOVERY OS — COMPANY REGISTRY
   ------------------------------------------------------------
   Jobs churn. Sources churn more slowly. What a company IS —
   its domain, its careers page, which ATS it runs, which tenant
   on that ATS — barely changes at all, and it is the single most
   expensive thing to rediscover.

   So it is stored once, keyed on the strongest identity available:

       domain            preferred; a company IS its domain
       normalizedName    fallback when no domain is known yet

   The registry exists to make discovery CHEAPER over time: before
   probing a domain, ask here. A company with a known ATS provider
   and tenant needs no probing at all, and a company we have already
   failed to resolve five times should not be probed again today.

   Nothing in this file infers a fact. `provenance` records where
   each field came from, so a domain guessed from a job posting can
   never be mistaken for one the company's own careers page stated.
   ============================================================ */

import { sha256, registrableDomain } from './normalize/text.js';
import { normalizeCompany } from './normalize/entity.js';

export const IDENTITY = Object.freeze({ DOMAIN: 'DOMAIN', NAME: 'NAME' });
export const COMPANY_TYPE = Object.freeze({
  STARTUP_SCALEUP: 'STARTUP_SCALEUP',
  MNC_ENTERPRISE: 'MNC_ENTERPRISE',
  OTHER: 'OTHER',
  UNKNOWN: 'UNKNOWN',
});

const CAREER_RESOLVER_SOURCE_PREFIX = 'career-autopilot-career-target-resolver';
const RESOLVER_AUTHORITATIVE_FIELDS = new Set([
  'careersUrl', 'atsProvider', 'atsTenant', 'careerUrlStatus',
]);

function comparableUrl(value) {
  try {
    const u = new URL(String(value || ''));
    u.hash = '';
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString().replace(/\/$/, '');
  } catch {
    return String(value || '').trim().replace(/\/$/, '');
  }
}

export function companyId({ domain = null, normalizedName = null }) {
  const d = domain ? registrableDomain(domain) : null;
  if (d) return `co_${sha256(`domain:${d.toLowerCase()}`).slice(0, 20)}`;
  const n = String(normalizedName || '').trim().toLowerCase();
  if (!n) return null;
  return `co_${sha256(`name:${n}`).slice(0, 20)}`;
}

export function makeCompany(partial = {}) {
  const domain = partial.domain ? registrableDomain(partial.domain) : null;
  const normalizedName = partial.normalizedName
    || (partial.name ? normalizeCompany(partial.name).normalizedName : null);
  return {
    id: partial.id || companyId({ domain, normalizedName }),
    identity: domain ? IDENTITY.DOMAIN : IDENTITY.NAME,
    name: partial.name ?? null,
    normalizedName: normalizedName ?? null,
    domain,
    website: partial.website ?? null,
    careersUrl: partial.careersUrl ?? null,
    atsProvider: partial.atsProvider ?? null,
    atsTenant: partial.atsTenant ?? null,
    country: partial.country ?? null,
    region: partial.region ?? null,
    /* Only ever set when a source actually stated it. */
    industry: partial.industry ?? null,
    companyType: partial.companyType ?? COMPANY_TYPE.UNKNOWN,
    companyTypeSource: partial.companyTypeSource ?? null,
    companyTypeConfidence: partial.companyTypeConfidence ?? null,
    hiringCountries: partial.hiringCountries ?? [],
    indiaRelevance: partial.indiaRelevance ?? null,
    careerUrlStatus: partial.careerUrlStatus ?? null,
    seedSource: partial.seedSource ?? null,
    seedRank: partial.seedRank ?? null,
    sourceIds: partial.sourceIds ?? [],
    sourceConfidence: partial.sourceConfidence ?? 0,
    lastDiscoveryAt: partial.lastDiscoveryAt ?? null,
    lastDiscoveryOutcome: partial.lastDiscoveryOutcome ?? null,
    discoveryAttempts: partial.discoveryAttempts ?? 0,
    discoveryQueueCount: partial.discoveryQueueCount ?? 0,
    sourceHealth: partial.sourceHealth ?? null,
    jobCount: partial.jobCount ?? 0,
    provenance: partial.provenance ?? {},
    createdAt: partial.createdAt || new Date().toISOString(),
    updatedAt: partial.updatedAt || new Date().toISOString(),
  };
}

export class CompanyRegistry {
  constructor({ store, logger = console, now = () => new Date() } = {}) {
    this.store = store;
    this.logger = logger;
    this.now = now;
    this.metrics = { created: 0, enriched: 0, resolvedFromCache: 0, merged: 0 };
  }

  nowIso() { return this.now().toISOString(); }

  /**
   * Upsert. Existing knowledge is ENRICHED, never overwritten by something
   * weaker: a domain-sourced fact outranks a job-sourced one, and a null never
   * replaces a value we already have.
   *
   * The career-target resolver is a deliberate exception for URL/ATS identity.
   * It has just fetched the employer surface and resolved a more specific final
   * listing/ATS target, so an older high-confidence CURATED_SURFACE seed must
   * not be allowed to permanently pin the company to a marketing landing page.
   */
  async upsert(partial, { source = 'unknown', confidence = 0.5 } = {}) {
    const candidate = makeCompany(partial);
    if (!candidate.id) return { ok: false, reason: 'company has neither a domain nor a name' };

    let existing = await this.store.getCompany(candidate.id);
    /* A company can enter the registry by NAME before a corporate domain is
       known. When a later seed/discovery supplies the domain, enrich that
       existing identity rather than creating a second company row. */
    if (!existing && candidate.normalizedName) {
      const matches = await this.store.listCompanies({ normalizedName: candidate.normalizedName, limit: 3 });
      if (matches.length === 1) existing = matches[0];
    }
    if (!existing) {
      candidate.provenance = provenanceFor(candidate, source, confidence, this.nowIso());
      await this.store.putCompany(candidate);
      this.metrics.created += 1;
      return { ok: true, created: true, company: candidate };
    }

    const merged = { ...existing, id: existing.id };
    const resolverAuthoritative = String(source || '').startsWith(CAREER_RESOLVER_SOURCE_PREFIX);
    let changed = false;
    for (const field of [
      'name', 'normalizedName', 'domain', 'website', 'careersUrl', 'atsProvider', 'atsTenant',
      'country', 'region', 'industry', 'companyType', 'companyTypeSource', 'companyTypeConfidence',
      'indiaRelevance', 'careerUrlStatus', 'seedSource', 'seedRank',
    ]) {
      const incoming = candidate[field];
      if (incoming == null || incoming === '') continue;
      const prior = existing.provenance?.[field];
      const priorConfidence = prior?.confidence ?? -1;
      const resolverWins = resolverAuthoritative && RESOLVER_AUTHORITATIVE_FIELDS.has(field);
      if (existing[field] == null || existing[field] === '' || confidence > priorConfidence || resolverWins) {
        if (existing[field] !== incoming) changed = true;
        const storedConfidence = resolverWins ? Math.max(1, Number(confidence) || 0) : confidence;
        merged[field] = incoming;
        merged.provenance = {
          ...(merged.provenance || {}),
          [field]: { value: incoming, source, confidence: storedConfidence, at: this.nowIso() },
        };
      }
    }
    if (candidate.hiringCountries?.length) {
      const countries = new Set(merged.hiringCountries || []);
      for (const c of candidate.hiringCountries) if (c) countries.add(c);
      if (countries.size !== (merged.hiringCountries || []).length) changed = true;
      merged.hiringCountries = [...countries];
    }
    if (candidate.sourceIds?.length) {
      const before = new Set(merged.sourceIds || []);
      for (const id of candidate.sourceIds) before.add(id);
      if (before.size !== (merged.sourceIds || []).length) changed = true;
      merged.sourceIds = [...before];
    }
    merged.updatedAt = this.nowIso();
    if (changed) this.metrics.enriched += 1;
    await this.store.putCompany(merged);
    return { ok: true, created: false, changed, company: merged };
  }

  async get(id) { return this.store.getCompany(id); }

  /** Look up by the strongest identity the caller has. */
  async find({ domain = null, name = null, normalizedName = null }) {
    const norm = normalizedName || (name ? normalizeCompany(name).normalizedName : null);
    const id = companyId({ domain, normalizedName: norm });
    if (!id) return null;
    const direct = await this.store.getCompany(id);
    if (direct) return direct;
    /* A company first learned by name may since have acquired a domain — check
       the name index before concluding it is unknown and re-probing it. */
    if (norm) {
      const byName = await this.store.listCompanies({ normalizedName: norm, limit: 5 });
      if (byName.length) return byName[0];
    }
    if (domain) {
      const d = registrableDomain(domain);
      const byDomain = d ? await this.store.listCompanies({ domain: d, limit: 5 }) : [];
      if (byDomain.length) return byDomain[0];
    }
    return null;
  }

  /**
   * The point of the whole registry: can we skip discovery work?
   * Returns what we already know and an explicit recommendation.
   */
  async discoveryHint({ domain = null, name = null }) {
    const company = await this.find({ domain, name });
    if (!company) return { known: false, skipProbe: false, reason: 'company not in registry' };
    this.metrics.resolvedFromCache += 1;

    if (company.atsProvider && company.atsTenant) {
      return {
        known: true,
        skipProbe: true,
        reason: `already resolved to ${company.atsProvider}:${company.atsTenant}`,
        company,
      };
    }
    if ((company.sourceIds || []).length) {
      const sourceIds = (company.sourceIds || []).slice(0, 20);
      const sources = (await Promise.all(sourceIds.map((id) => this.store.getSource(id).catch(() => null)))).filter(Boolean);
      const target = comparableUrl(company.careersUrl);
      const matching = target && sources.some((s) => comparableUrl(s.careersUrl || s.baseUrl) === target);
      if (matching) {
        return { known: true, skipProbe: true, reason: 'company already has a registered source for the current careers URL', company };
      }
      return {
        known: true,
        skipProbe: false,
        reason: 'registered source is stale and does not match the current resolved careers URL',
        company,
      };
    }
    if ((company.discoveryAttempts || 0) >= 5) {
      return {
        known: true,
        skipProbe: true,
        reason: `${company.discoveryAttempts} discovery attempts already failed; not re-probing`,
        company,
      };
    }
    return { known: true, skipProbe: false, reason: 'known company with no resolved source', company };
  }

  /** Mark that a durable discovery task has been queued without counting it as
   * an attempt yet. discoveryQueueCount is deliberately monotonic so candidate
   * rotation stays fair even when multiple queue operations share a timestamp. */
  async markDiscoveryQueued(company, { outcome = 'QUEUED' } = {}) {
    if (!company?.id) return null;
    const next = {
      ...company,
      lastDiscoveryAt: this.nowIso(),
      lastDiscoveryOutcome: outcome,
      discoveryQueueCount: Number(company.discoveryQueueCount || 0) + 1,
      updatedAt: this.nowIso(),
    };
    await this.store.putCompany(next);
    return next;
  }

  /** Record the outcome of a discovery attempt against a company. */
  async recordDiscovery({ domain = null, name = null, outcome, sourceId = null, provider = null, tenant = null }) {
    const company = await this.find({ domain, name });
    const base = company || makeCompany({ domain, name });
    const next = {
      ...base,
      atsProvider: provider || base.atsProvider,
      atsTenant: tenant || base.atsTenant,
      sourceIds: sourceId ? [...new Set([...(base.sourceIds || []), sourceId])] : (base.sourceIds || []),
      discoveryAttempts: (base.discoveryAttempts || 0) + 1,
      lastDiscoveryAt: this.nowIso(),
      lastDiscoveryOutcome: outcome,
      updatedAt: this.nowIso(),
    };
    await this.store.putCompany(next);
    return next;
  }

  async summary() {
    const s = await this.store.companySummary();
    return {
      ...s,
      coveragePct: s.total ? Math.round(((s.withRegisteredSource || 0) / s.total) * 1000) / 10 : 0,
      counters: { ...this.metrics },
    };
  }
}

function provenanceFor(company, source, confidence, at) {
  const out = {};
  for (const field of [
    'name', 'domain', 'website', 'careersUrl', 'atsProvider', 'atsTenant', 'country', 'region',
    'industry', 'indiaRelevance', 'careerUrlStatus', 'seedSource', 'seedRank',
  ]) {
    if (company[field] != null && company[field] !== '') {
      out[field] = { value: company[field], source, confidence, at };
    }
  }
  return out;
}

export default { CompanyRegistry, makeCompany, companyId, IDENTITY };
