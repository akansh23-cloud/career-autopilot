#!/usr/bin/env node
/* ============================================================
   JOB DISCOVERY OS — LIVE SMOKE TEST  (§53)
   ------------------------------------------------------------
   OPTIONAL. Requires outbound network access. It is NOT part of
   the deterministic gate suite and its failures are reported
   SEPARATELY, because a sandbox with no egress is not a defect in
   the adapters.

     node scripts/job-discovery-live-smoke.mjs
     node scripts/job-discovery-live-smoke.mjs --json
     node scripts/job-discovery-live-smoke.mjs --tenant=GREENHOUSE:sometenant

   The default targets are each provider's own PUBLIC DEMO or
   DOCUMENTATION board. They exist to prove the HTTP path, the
   response shape and the normalizer still line up with reality.

   These demo tenants are NEVER written into production source
   discovery as though they were real user-facing employers — this
   script registers them in a throwaway in-memory store that is
   discarded when the process exits.
   ============================================================ */

import process from 'node:process';
import { MemoryJobStore } from '../server/services/jobDiscovery/store.js';
import { SourceRegistry, makeSource } from '../server/services/jobDiscovery/sourceRegistry.js';
import AdapterRegistry from '../server/services/jobDiscovery/adapters/index.js';
import { IngestPipeline } from '../server/services/jobDiscovery/ingest.js';
import { StoreBackedSearchIndex } from '../server/services/jobDiscovery/searchIndex.js';
import { SafeHttpClient } from '../server/services/jobDiscovery/crawler/httpClient.js';
import { RateController } from '../server/services/jobDiscovery/crawler/rateControl.js';
import { Metrics } from '../server/services/jobDiscovery/scheduler.js';
import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS } from '../server/services/jobDiscovery/schema.js';

const asJson = process.argv.includes('--json');

/* Public demo/sandbox boards published by each vendor for exactly this purpose. */
const DEFAULT_TARGETS = [
  { provider: PROVIDER.GREENHOUSE, tenant: 'vaulttec', note: "Greenhouse's public sample board" },
  { provider: PROVIDER.LEVER, tenant: 'leverdemo', note: "Lever's public demo site" },
  { provider: PROVIDER.ASHBY, tenant: 'ashby', note: "Ashby's own public board" },
  { provider: PROVIDER.WORKABLE, tenant: 'workable', note: "Workable's own public account" },
];

function parseTargets() {
  const custom = process.argv.filter((a) => a.startsWith('--tenant='));
  if (!custom.length) return DEFAULT_TARGETS;
  return custom.map((a) => {
    const [provider, tenant] = a.slice('--tenant='.length).split(':');
    return { provider: String(provider).toUpperCase(), tenant, note: 'supplied on the command line' };
  });
}

async function main() {
  const store = await new MemoryJobStore().init();
  const metrics = new Metrics();
  const rate = new RateController({
    globalConcurrency: 2, hostConcurrency: 1, minHostDelayMs: 1500,
  });
  const http = new SafeHttpClient({ rateController: rate, timeoutMs: 15_000, maxRetries: 1 });
  const adapters = new AdapterRegistry({ http });
  const registry = new SourceRegistry({ store });
  const ingest = new IngestPipeline({ store, registry, adapters, metrics });

  const results = [];
  let networkReachable = false;

  for (const target of parseTargets()) {
    const started = Date.now();
    const entry = {
      provider: target.provider, tenant: target.tenant, note: target.note,
      ok: false, reachable: false, jobs: 0, created: 0, errorClass: null, message: null,
      sample: null, durationMs: 0,
    };
    try {
      const { source } = await registry.register(makeSource({
        provider: target.provider,
        sourceType: SOURCE_TYPE.ATS,
        sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
        tenant: target.tenant,
        companyName: null,
        discoveredFrom: 'live-smoke (not a production source)',
      }));

      const discovered = await adapters.get(target.provider).discover(source, { http });
      if (!discovered.ok) {
        entry.errorClass = discovered.errorClass || 'UNKNOWN';
        entry.message = discovered.reason;
      } else {
        const run = await ingest.runSource(discovered.source || source, { maxPages: 2 });
        entry.reachable = true;
        networkReachable = true;
        entry.ok = run.ok && run.fetched > 0;
        entry.jobs = run.fetched;
        entry.created = run.created;
        entry.errorClass = run.errors[0]?.errorClass ?? null;
        entry.message = run.errors[0]?.message ?? null;

        const stored = await store.listJobs({ sourceId: source.id, limit: 1 });
        if (stored[0]) {
          const j = stored[0];
          entry.sample = {
            title: j.title,
            company: j.company?.name ?? null,
            normalizedTitle: j.normalizedTitle,
            titleFamily: j.titleFamily,
            locations: (j.locations || []).map((l) => l.raw).slice(0, 3),
            workplace: `${j.workplace?.type}/${j.workplace?.remoteScope}`,
            /* The honesty checks that matter most against live data. */
            sourcePublishedAt: j.sourcePublishedAt,
            firstSeenAt: j.firstSeenAt,
            salaryStated: j.compensation?.min != null || j.compensation?.max != null,
            applyUrl: j.canonicalApplyUrl,
            completeness: j.completeness,
          };
        }
      }
    } catch (e) {
      entry.errorClass = e?.errorClass || 'UNKNOWN';
      entry.message = e?.message || String(e);
    }
    entry.durationMs = Date.now() - started;
    results.push(entry);
  }

  /* Prove the index answers a search built purely from live data. */
  const search = new StoreBackedSearchIndex({ store, cache: null });
  const probe = await search.search({ q: 'engineer', limit: 3 });

  const summary = {
    generatedAt: new Date().toISOString(),
    kind: 'LIVE_SMOKE',
    disclaimer: 'Live network results. Reported separately from the deterministic fixture gates. A network failure here is not an adapter defect.',
    networkReachable,
    adapters: results,
    passed: results.filter((r) => r.ok).length,
    reachable: results.filter((r) => r.reachable).length,
    attempted: results.length,
    indexedJobs: (await store.stats()).jobs,
    searchProbe: {
      q: 'engineer',
      shown: probe.results.length,
      total: probe.total,
      usedResume: probe.personalization.usedResume,
    },
    http: http.stats(),
  };

  if (asJson) { console.log(JSON.stringify(summary, null, 2)); return; }

  console.log('════════════════════════════════════════════════════════════');
  console.log('JOB DISCOVERY OS — LIVE SMOKE  (network required, reported separately)');
  console.log('════════════════════════════════════════════════════════════');
  if (!networkReachable) {
    console.log('No target was reachable. This environment appears to have no outbound');
    console.log('network access. Deterministic fixture gates are unaffected — run:');
    console.log('  node scripts/job-discovery-gates.mjs');
    console.log('');
  }
  for (const r of results) {
    const mark = r.ok ? '✓' : (r.reachable ? '✗' : '·');
    console.log(`${mark} ${String(r.provider).padEnd(16)} ${String(r.tenant).padEnd(16)} jobs=${String(r.jobs).padEnd(4)} ${r.durationMs}ms`);
    if (r.message) console.log(`    ${r.errorClass}: ${String(r.message).slice(0, 140)}`);
    if (r.sample) {
      console.log(`    sample: "${r.sample.title}" @ ${r.sample.company ?? 'unknown'} [${r.sample.titleFamily ?? 'unclassified'}]`);
      console.log(`            workplace=${r.sample.workplace} salaryStated=${r.sample.salaryStated} completeness=${r.sample.completeness}`);
      console.log(`            sourcePublishedAt=${r.sample.sourcePublishedAt ?? 'not stated'} firstSeenAt=${r.sample.firstSeenAt}`);
    }
  }
  console.log('────────────────────────────────────────────────────────────');
  console.log(`${summary.passed}/${summary.attempted} adapters ingested live data · ${summary.indexedJobs} jobs indexed`);
  console.log(`search probe "engineer": ${summary.searchProbe.shown} of ${summary.searchProbe.total} (usedResume=${summary.searchProbe.usedResume})`);
  console.log('');
  console.log('These demo tenants live in a throwaway in-memory store and are NOT');
  console.log('registered as production sources.');
}

main().catch((e) => { console.error(e); process.exit(1); });
