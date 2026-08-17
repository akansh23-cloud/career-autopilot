/* ============================================================
   ADAPTER REGISTRY
   ------------------------------------------------------------
   One place that maps provider -> adapter instance. Everything
   downstream (ingest, verification, discovery) resolves through
   here, so adding a provider is one registration, not a rewrite.

   Two kinds of connector live here:

     hand-written   providers whose protocol is genuinely distinct
                    (Greenhouse, Lever, Ashby, Workable,
                    SmartRecruiters, Workday, Oracle CE, iCIMS,
                    the universal career-site crawler, aggregators)

     spec-driven    providers that differ only in URL shape, field
                    names and pagination. Declared in
                    spec/providerSpecs.js and executed by one
                    SpecAdapter, so every one of them inherits the
                    same conditional-request, error-classification,
                    authoritative-listing and provenance guarantees.

   DETECTION IS SEPARATE FROM SUPPORT. atsDetect fingerprints more
   providers than this registry can ingest, and a provider whose
   only listing surface needs credentials reports NOT_CONFIGURED
   through statusReport() rather than silently returning zero jobs.
   ============================================================ */

import { PROVIDER, SOURCE_STATUS } from '../schema.js';
import { DETECTED_PROVIDERS, SUPPORTED_PROVIDERS } from '../atsDetect.js';
import { JobSourceAdapter, assertNormalizedInput, NORMALIZED_INPUT_KEYS } from './base.js';
import GreenhouseAdapter from './greenhouse.js';
import LeverAdapter from './lever.js';
import AshbyAdapter from './ashby.js';
import WorkableAdapter from './workable.js';
import SmartRecruitersAdapter from './smartrecruiters.js';
import WorkdayAdapter from './workday.js';
import OracleRecruitingAdapter from './oracleRecruiting.js';
import ICIMSAdapter from './icims.js';
import GenericCareerSiteAdapter from './genericCareerSite.js';
import GoogleCareersAdapter from './googleCareers.js';
import AggregatorAdapter from './aggregator.js';
import { adapterFromSpec } from './spec/specAdapter.js';
import PROVIDER_SPECS from './spec/providerSpecs.js';

export const SPEC_ADAPTER_CLASSES = PROVIDER_SPECS.map(adapterFromSpec);

export const ADAPTER_CLASSES = [
  GreenhouseAdapter, LeverAdapter, AshbyAdapter, WorkableAdapter,
  SmartRecruitersAdapter, WorkdayAdapter, OracleRecruitingAdapter, ICIMSAdapter,
  ...SPEC_ADAPTER_CLASSES,
  GenericCareerSiteAdapter, AggregatorAdapter,
];

export class AdapterRegistry {
  constructor(ctx = {}) {
    this.ctx = ctx;
    this.adapters = new Map();
    for (const Cls of ADAPTER_CLASSES) {
      this.adapters.set(Cls.provider, new Cls(ctx));
    }
    /* Google is still persisted as a GENERIC employer career source. Routing it
       here, rather than assigning a fake provider enum, keeps the canonical
       source model stable while enforcing Google's host-specific robots policy. */
    this.googleCareers = new GoogleCareersAdapter(ctx);
  }

  get(provider) {
    return this.adapters.get(provider) || this.adapters.get(PROVIDER.GENERIC);
  }

  forSource(source) {
    if (source?.provider === PROVIDER.GENERIC && GoogleCareersAdapter.matchesSource(source)) {
      return this.googleCareers;
    }
    return this.get(source?.provider);
  }

  /** Providers that have a real connector in this build. */
  supportedProviders() {
    return [...this.adapters.keys()];
  }

  /** Providers we can fingerprint, whether or not we can ingest them. */
  detectedProviders() {
    return [...DETECTED_PROVIDERS];
  }

  /**
   * Truthful per-adapter status. An adapter needing absent credentials reports
   * NOT_CONFIGURED here and is skipped by the scheduler — never faked as OK.
   */
  statusReport() {
    const out = {};
    for (const [provider, adapter] of this.adapters.entries()) {
      const cfg = typeof adapter.configurationStatus === 'function'
        ? adapter.configurationStatus()
        : { status: SOURCE_STATUS.ACTIVE, configured: true, mode: null, reason: 'no credentials required' };
      out[provider] = {
        adapter: adapter.constructor.name,
        sourceType: adapter.constructor.sourceType,
        sourceClass: adapter.constructor.sourceClass,
        requiresCredentials: adapter.constructor.requiresCredentials === true,
        specDriven: !!adapter.constructor.spec,
        detectable: DETECTED_PROVIDERS.has(provider),
        ...cfg,
      };
    }
    out.GOOGLE_CAREERS_DIRECT = {
      adapter: this.googleCareers.constructor.name,
      sourceType: this.googleCareers.constructor.sourceType,
      sourceClass: this.googleCareers.constructor.sourceClass,
      requiresCredentials: false,
      specDriven: false,
      detectable: true,
      status: SOURCE_STATUS.ACTIVE,
      configured: true,
      mode: 'ROBOTS_COMPLIANT_PARTIAL',
      reason: 'Direct Google Careers crawl uses only the robots-allowed canonical listing page; broader inventory must come from other configured sources.',
    };
    return out;
  }

  /**
   * Coverage matrix for the final report. Separates three DIFFERENT facts that
   * are easy to conflate into an inflated "providers supported" number:
   *   detected      we can fingerprint it from a URL or page
   *   connector     a connector exists in this build
   *   ingestReady   that connector can actually run right now
   */
  coverageMatrix() {
    const status = this.statusReport();
    const providers = new Set([...DETECTED_PROVIDERS, ...this.adapters.keys()]);
    const rows = [];
    for (const p of providers) {
      const s = status[p];
      rows.push({
        provider: p,
        detected: DETECTED_PROVIDERS.has(p),
        connector: !!s,
        listedSupported: SUPPORTED_PROVIDERS.has(p),
        ingestReady: !!s?.configured,
        mode: s?.mode ?? null,
        reason: s?.reason ?? 'no connector in this build',
      });
    }
    rows.sort((a, b) => a.provider.localeCompare(b.provider));
    return {
      rows,
      detectedCount: [...providers].filter((p) => DETECTED_PROVIDERS.has(p)).length,
      connectorCount: rows.filter((r) => r.connector).length,
      ingestReadyCount: rows.filter((r) => r.ingestReady).length,
    };
  }

  /** Identify which registered adapter claims a URL. */
  identify(url, html = '') {
    for (const adapter of this.adapters.values()) {
      if (adapter.constructor.provider === PROVIDER.GENERIC) continue;
      if (adapter.constructor.provider === PROVIDER.API) continue;
      const det = adapter.identify(url, html);
      if (det.matches) return det;
    }
    return this.get(PROVIDER.GENERIC).identify(url, html);
  }
}

export {
  JobSourceAdapter, assertNormalizedInput, NORMALIZED_INPUT_KEYS,
  GreenhouseAdapter, LeverAdapter, AshbyAdapter, WorkableAdapter,
  SmartRecruitersAdapter, WorkdayAdapter, OracleRecruitingAdapter, ICIMSAdapter,
  GenericCareerSiteAdapter, GoogleCareersAdapter, AggregatorAdapter,
};

export default AdapterRegistry;
