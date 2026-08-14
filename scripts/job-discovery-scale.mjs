#!/usr/bin/env node
/* ============================================================
   JOB DISCOVERY OS — PRODUCTION SCALE BENCHMARK
   ------------------------------------------------------------
   Builds a deterministic 100k-job corpus and measures what
   actually matters at that size:

       normalization throughput   jobs/sec through the canonicalizer
       index build throughput     jobs/sec into the inverted index
       dedupe throughput          candidate lookups/sec
       search P50 / P95           across a mixed query workload
       candidate retrieval size   how many docs the ranker sees
       memory                     heap used by the whole index
       verification selection     adaptive budget allocation cost
       scheduler fairness         host interleaving across a queue

   AND the correctness property the whole phase exists for:

       a relevant job cannot disappear because of a scan limit.

   Every number here is FIXTURE data. It measures the engine.
   It is not, and is never presented as, real-world job coverage.

       node scripts/job-discovery-scale.mjs
       node scripts/job-discovery-scale.mjs --jobs 20000 --json
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';

import { generateCorpus, RARE_TITLES } from '../server/services/jobDiscovery/scaleCorpus.js';
import { MemoryJobStore } from '../server/services/jobDiscovery/store.js';
import { StoreBackedSearchIndex } from '../server/services/jobDiscovery/searchIndex.js';
import { computeCoverage, NAMESPACE, coverageDisclaimer } from '../server/services/jobDiscovery/coverageMetrics.js';
import { allocateVerificationBudget } from '../server/services/jobDiscovery/verificationPolicy.js';
import { interleaveByHost } from '../server/services/jobDiscovery/crawlQueue.js';
import { findDuplicate } from '../server/services/jobDiscovery/dedupe.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const jobCount = Number(argv[argv.indexOf('--jobs') + 1]) || (argv.includes('--jobs') ? 100000 : 100000);
const NOW = '2026-08-14T12:00:00.000Z';

const say = (m) => { if (!asJson) console.log(m); };

function mb(bytes) { return Math.round((bytes / 1048576) * 10) / 10; }

function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 100) / 100;
}

const QUERY_WORKLOAD = [
  { q: 'DevOps Engineer' },
  { q: 'Platform Engineer' },
  { q: 'Java backend' },
  { q: 'AWS DevOps' },
  { q: 'Remote data engineer India' },
  { q: 'platform engineer kubernetes' },
  { q: 'fresher software engineer' },
  { q: 'Data Scientist' },
  { q: 'Product Manager' },
  { q: 'Security Engineer' },
  { q: 'Frontend Engineer', location: 'Pune' },
  { q: 'Backend Engineer', remote: 'remote' },
  { q: 'QA Engineer', employmentType: 'INTERNSHIP' },
  { q: 'Marketing Manager' },
  { q: 'Cloud Engineer', location: 'India' },
  { q: 'Software Engineer', sourceType: 'ORIGINAL_ATS' },
];

async function main() {
  const report = { namespace: NAMESPACE.FIXTURE, at: new Date().toISOString(), jobCount };

  say('════════════════════════════════════════════════════════════');
  say('JOB DISCOVERY OS — PRODUCTION SCALE BENCHMARK');
  say('════════════════════════════════════════════════════════════');
  say(`Corpus: ${jobCount.toLocaleString()} jobs (deterministic fixture data)`);
  say('');

  /* ---------------- corpus generation / normalization ---------------- */
  if (global.gc) global.gc();
  const memBefore = process.memoryUsage().heapUsed;

  let t = performance.now();
  const corpus = generateCorpus({ jobCount, now: NOW });
  const genMs = performance.now() - t;
  report.normalization = {
    jobs: corpus.jobs.length,
    ms: Math.round(genMs),
    jobsPerSec: Math.round(corpus.jobs.length / (genMs / 1000)),
    composition: corpus.stats,
    companies: corpus.companies.length,
    sources: corpus.sources.length,
  };
  say(`normalization      ${report.normalization.jobsPerSec.toLocaleString()} jobs/sec  (${Math.round(genMs)}ms)`);
  say(`  duplicates ${corpus.stats.duplicates} · closed ${corpus.stats.closed} · stale ${corpus.stats.stale} · undated ${corpus.stats.undated}`);
  say(`  aggregator-only ${corpus.stats.aggregatorOnly} · scoped-remote ${corpus.stats.remoteRestricted} · multi-location ${corpus.stats.multiLocation}`);

  /* ---------------- index build ---------------- */
  const store = await new MemoryJobStore().init();
  t = performance.now();
  for (const job of corpus.jobs) await store.putJob(job);
  const indexMs = performance.now() - t;
  report.indexBuild = {
    ms: Math.round(indexMs),
    jobsPerSec: Math.round(corpus.jobs.length / (indexMs / 1000)),
    index: store.index.stats(),
  };
  say(`index build        ${report.indexBuild.jobsPerSec.toLocaleString()} jobs/sec  (${Math.round(indexMs)}ms)`);
  say(`  ${store.index.stats().fieldTerms.toLocaleString()} field terms · ${store.index.stats().bodyTerms.toLocaleString()} body terms · ${store.index.stats().companies.toLocaleString()} companies`);

  if (global.gc) global.gc();
  const memAfter = process.memoryUsage().heapUsed;
  report.memory = {
    heapUsedMb: mb(memAfter),
    corpusAndIndexMb: mb(memAfter - memBefore),
    bytesPerJob: Math.round((memAfter - memBefore) / corpus.jobs.length),
  };
  say(`memory             ${report.memory.corpusAndIndexMb} MB for corpus + index (~${report.memory.bytesPerJob} bytes/job)`);

  /* ---------------- dedupe throughput ---------------- */
  t = performance.now();
  let dedupeChecks = 0;
  let dedupeHits = 0;
  for (let i = 0; i < Math.min(2000, corpus.jobs.length); i += 1) {
    const job = corpus.jobs[i];
    const candidates = await store.findCandidates(job);
    if (findDuplicate(job, candidates)) dedupeHits += 1;
    dedupeChecks += 1;
  }
  const dedupeMs = performance.now() - t;
  report.dedupe = {
    checks: dedupeChecks,
    hits: dedupeHits,
    ms: Math.round(dedupeMs),
    checksPerSec: Math.round(dedupeChecks / (dedupeMs / 1000)),
  };
  say(`dedupe             ${report.dedupe.checksPerSec.toLocaleString()} candidate lookups/sec (${dedupeHits} duplicates found in ${dedupeChecks} probes)`);

  /* ---------------- search latency ---------------- */
  const index = new StoreBackedSearchIndex({ store, cache: false, now: () => Date.parse(NOW) });
  const latencies = [];
  const retrievalSizes = [];
  const matchedTotals = [];
  let emptyResults = 0;

  /* Warm-up excluded from the measurement so JIT noise is not reported as
     latency. */
  for (const query of QUERY_WORKLOAD) await index.search({ ...query, limit: 20 });

  for (let round = 0; round < 8; round += 1) {
    for (const query of QUERY_WORKLOAD) {
      const started = performance.now();
      // eslint-disable-next-line no-await-in-loop
      const res = await index.search({ ...query, limit: 20 });
      latencies.push(performance.now() - started);
      retrievalSizes.push(res.retrieval.candidatesRanked);
      matchedTotals.push(res.retrieval.matchedTotal);
      if (!res.results.length) emptyResults += 1;
    }
  }
  report.search = {
    queries: latencies.length,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    maxMs: Math.round(Math.max(...latencies) * 100) / 100,
    meanCandidatesRanked: Math.round(retrievalSizes.reduce((a, b) => a + b, 0) / retrievalSizes.length),
    maxCandidatesRanked: Math.max(...retrievalSizes),
    meanIndexMatches: Math.round(matchedTotals.reduce((a, b) => a + b, 0) / matchedTotals.length),
    emptyResultQueries: emptyResults,
  };
  say('');
  say(`search P50         ${report.search.p50Ms} ms`);
  say(`search P95         ${report.search.p95Ms} ms`);
  say(`search P99         ${report.search.p99Ms} ms`);
  say(`candidates ranked  mean ${report.search.meanCandidatesRanked} · max ${report.search.maxCandidatesRanked} (index matched mean ${report.search.meanIndexMatches.toLocaleString()})`);

  /* ---------------- the correctness property ----------------
     A one-in-100k posting must be findable. If a candidate budget can hide it,
     the whole "coverage" story is a lie. */
  const rareFindings = [];
  for (const title of RARE_TITLES) {
    // eslint-disable-next-line no-await-in-loop
    const res = await index.search({ q: title, limit: 20 });
    const found = res.results.some((r) => r.job.title === title);
    const present = corpus.jobs.some((j) => j.title === title && j.status !== 'REMOVED');
    rareFindings.push({ title, presentInCorpus: present, found, rank: res.results.findIndex((r) => r.job.title === title) + 1 || null });
  }
  const rareOk = rareFindings.every((f) => !f.presentInCorpus || f.found);
  report.rareTitleRetrieval = { findings: rareFindings, allFound: rareOk };
  say('');
  say(`rare-title recall  ${rareOk ? 'PASS' : 'FAIL'} — a 1-in-${jobCount.toLocaleString()} posting is still retrievable`);
  for (const f of rareFindings) {
    say(`  ${f.title.padEnd(34)} inCorpus=${f.presentInCorpus} found=${f.found}${f.rank ? ` rank=${f.rank}` : ''}`);
  }

  /* Closed jobs must never surface. */
  const closedLeak = [];
  for (const query of QUERY_WORKLOAD.slice(0, 6)) {
    // eslint-disable-next-line no-await-in-loop
    const res = await index.search({ ...query, limit: 50 });
    for (const r of res.results) if (r.job.status === 'REMOVED') closedLeak.push(r.job.id);
  }
  report.closedJobLeak = { leaked: closedLeak.length };
  say(`closed-job leak    ${closedLeak.length === 0 ? 'PASS' : `FAIL (${closedLeak.length} leaked)`}`);

  /* ---------------- verification selection ---------------- */
  t = performance.now();
  const budget = allocateVerificationBudget(corpus.jobs.slice(0, 20000), { limit: 200, now: Date.parse(NOW) });
  const verifyMs = performance.now() - t;
  const tierCounts = budget.reduce((acc, b) => { acc[b.tier] = (acc[b.tier] || 0) + 1; return acc; }, {});
  report.verificationSelection = {
    scanned: 20000,
    selected: budget.length,
    ms: Math.round(verifyMs),
    byTier: tierCounts,
  };
  say('');
  say(`verify selection   ${budget.length} of 20,000 selected in ${Math.round(verifyMs)}ms`);
  say(`  tiers ${JSON.stringify(tierCounts)}`);

  /* ---------------- scheduler fairness ---------------- */
  const tasks = corpus.sources.slice(0, 400).map((s, i) => ({
    id: `t${i}`, sourceId: s.id, host: `host${i % 7}.example`, priority: i % 11,
  }));
  const ordered = interleaveByHost(tasks);
  const firstSeven = new Set(ordered.slice(0, 7).map((x) => x.host));
  report.schedulerFairness = {
    tasks: tasks.length,
    distinctHosts: 7,
    distinctHostsInFirst7: firstSeven.size,
    fair: firstSeven.size === 7,
  };
  say(`scheduler fairness ${firstSeven.size}/7 distinct hosts in the first 7 slots — ${firstSeven.size === 7 ? 'FAIR' : 'UNFAIR'}`);

  /* ---------------- coverage snapshot (fixture-namespaced) ---------------- */
  const coverage = computeCoverage({
    jobs: corpus.jobs,
    sources: corpus.sources,
    companies: corpus.companies,
    namespace: NAMESPACE.FIXTURE,
    now: Date.parse(NOW),
  });
  report.coverage = coverage;
  say('');
  say(coverageDisclaimer(coverage));
  say(`  active canonical jobs   ${coverage.jobs.activeCanonicalJobs.toLocaleString()}`);
  say(`  direct-source           ${coverage.quality.directSourcePct}%`);
  say(`  direct-apply            ${coverage.quality.directApplyPct}%`);
  say(`  duplicate ratio         ${coverage.quality.duplicateRatio}`);
  say(`  verification coverage   ${coverage.quality.verificationCoveragePct}%`);
  say(`  median discovery age    ${coverage.discovery.medianDiscoveryAgeDays ?? 'n/a'} days (n=${coverage.discovery.datedSampleSize})`);

  /* ---------------- verdict ---------------- */
  const thresholds = { p95Ms: 250, rareRecall: true, closedLeak: 0, fairness: true };
  const pass = report.search.p95Ms <= thresholds.p95Ms
    && rareOk
    && closedLeak.length === 0
    && report.schedulerFairness.fair;
  report.thresholds = thresholds;
  report.pass = pass;

  say('');
  say('────────────────────────────────────────────────────────────');
  say(`SEARCH_SCALE_GATE: ${pass ? 'PASS' : 'FAIL'}`);
  say('────────────────────────────────────────────────────────────');

  const dir = path.join(ROOT, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'job-discovery-scale-benchmark.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else say('Wrote reports/job-discovery-scale-benchmark.json');

  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
