/* ============================================================
   ADAPTER REGISTRY
   ------------------------------------------------------------
   One place that maps provider -> adapter instance. Everything
   downstream (ingest, verification, discovery) resolves through
   here, so adding a provider is one registration, not a rewrite.
   ============================================================ */

import { PROVIDER, SOURCE_STATUS } from '../schema.js';
import { JobSourceAdapter, assertNormalizedInput, NORMALIZED_INPUT_KEYS } from './base.js';
import GreenhouseAdapter from './greenhouse.js';
import LeverAdapter from './lever.js';
import AshbyAdapter from './ashby.js';
import WorkableAdapter from './workable.js';
import SmartRecruitersAdapter from './smartrecruiters.js';
import GenericCareerSiteAdapter from './genericCareerSite.js';
import AggregatorAdapter from './aggregator.js';

export const ADAPTER_CLASSES = [
  GreenhouseAdapter, LeverAdapter, AshbyAdapter, WorkableAdapter,
  SmartRecruitersAdapter, GenericCareerSiteAdapter, AggregatorAdapter,
];

export class AdapterRegistry {
  constructor(ctx = {}) {
    this.ctx = ctx;
    this.adapters = new Map();
    for (const Cls of ADAPTER_CLASSES) {
      this.adapters.set(Cls.provider, new Cls(ctx));
    }
  }

  get(provider) {
    return this.adapters.get(provider) || this.adapters.get(PROVIDER.GENERIC);
  }

  forSource(source) {
    return this.get(source?.provider);
  }

  /** Providers that have a real connector in this build. */
  supportedProviders() {
    return [...this.adapters.keys()];
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
        ...cfg,
      };
    }
    return out;
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
  SmartRecruitersAdapter, GenericCareerSiteAdapter, AggregatorAdapter,
};

export default AdapterRegistry;
