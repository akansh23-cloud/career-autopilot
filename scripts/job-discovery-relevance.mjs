#!/usr/bin/env node
/* ============================================================
   JOB DISCOVERY OS — SEARCH RELEVANCE EVALUATION
   ------------------------------------------------------------
   Runs the twelve graded benchmarks against a single shared
   corpus and reports nDCG@5, ordering violations and irrelevant
   leaks per query.

   One corpus, not one per query. That matters: a title that is
   "irrelevant" for the DevOps benchmark is "exact" for another,
   so every distractor is genuinely present in the index and the
   irrelevant-leak check is a real test rather than a tautology.

   No resume and no candidate data are used. This measures search
   quality for a visitor the product knows nothing about.

       node scripts/job-discovery-relevance.mjs
       node scripts/job-discovery-relevance.mjs --json
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';

import { MemoryJobStore } from '../server/services/jobDiscovery/store.js';
import { StoreBackedSearchIndex } from '../server/services/jobDiscovery/searchIndex.js';
import { buildRelevanceCorpus } from '../test/fixtures/jobDiscovery/relevanceCorpus.js';
import { understandQuery } from '../server/services/jobDiscovery/normalize/queryUnderstanding.js';
import {
  RELEVANCE_BENCHMARKS, UNDERSTANDING_BENCHMARKS, evaluateBenchmark,
  summarizeEvaluation, RELEVANCE_THRESHOLDS,
} from '../server/services/jobDiscovery/searchQualityEvaluator.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const asJson = process.argv.includes('--json');
const NOW = '2026-08-14T12:00:00.000Z';
const say = (m) => { if (!asJson) console.log(m); };

function checkUnderstanding(b) {
  const u = understandQuery(b.query);
  const families = new Set(u.families || []);
  const misses = [];

  for (const f of b.expectFamilies || []) if (!families.has(f)) misses.push(`family ${f}`);
  for (const t of b.expectTechs || []) if (!(u.techs || []).includes(t)) misses.push(`tech ${t}`);
  if (b.expectLocation) {
    /* understandQuery returns the location as the raw phrase it recognised —
       a city or a country — because resolving it to a place is the job of the
       location normalizer, not the query parser. */
    const loc = String(u.location || '').toLowerCase();
    if (!loc.includes(String(b.expectLocation).toLowerCase())) misses.push(`location ${b.expectLocation}`);
  }
  if (b.expectRemote && u.remote !== b.expectRemote) misses.push(`remote ${b.expectRemote}`);
  for (const s of b.expectSeniority || []) if (!(u.seniority || []).includes(s)) misses.push(`seniority ${s}`);

  return {
    query: b.query,
    ok: misses.length === 0,
    misses,
    parsed: {
      roleText: u.roleText,
      families: [...families],
      techs: u.techs,
      location: u.location,
      remote: u.remote,
      seniority: u.seniority,
    },
  };
}

async function main() {
  const corpus = buildRelevanceCorpus({ now: NOW });
  const store = await new MemoryJobStore().init();
  for (const job of corpus.jobs) await store.putJob(job);
  const index = new StoreBackedSearchIndex({ store, cache: false, now: () => Date.parse(NOW) });

  say('════════════════════════════════════════════════════════════');
  say('JOB DISCOVERY OS — SEARCH RELEVANCE EVALUATION');
  say('════════════════════════════════════════════════════════════');
  say(`corpus: ${corpus.jobs.length} jobs across ${corpus.titles.length} distinct titles (fixture data)`);
  say('');

  const evaluations = [];
  for (const benchmark of RELEVANCE_BENCHMARKS) {
    // eslint-disable-next-line no-await-in-loop
    const res = await index.search({ q: benchmark.query, limit: 10 });
    const evaluation = evaluateBenchmark(benchmark, res.results);
    evaluations.push(evaluation);

    const mark = evaluation.ordering.ok ? '✓' : '✗';
    say(`${mark} ${benchmark.query.padEnd(22)} nDCG@5 ${String(evaluation.ndcg).padEnd(6)} top: ${evaluation.returned.slice(0, 4).join(' | ')}`);
    for (const v of evaluation.ordering.violations) {
      say(`    ${JSON.stringify(v)}`);
    }
  }

  const summary = summarizeEvaluation(evaluations);

  say('');
  say('query understanding');
  const understanding = UNDERSTANDING_BENCHMARKS.map(checkUnderstanding);
  for (const u of understanding) {
    say(`${u.ok ? '✓' : '✗'} ${u.query.padEnd(32)} ${u.ok ? `${u.parsed.families.join(', ')}` : `MISSING ${u.misses.join(', ')}`}`);
  }

  const understandingFailures = understanding.filter((u) => !u.ok);
  const pass = summary.failed <= RELEVANCE_THRESHOLDS.maxOrderingFailures
    && summary.meanNdcg >= RELEVANCE_THRESHOLDS.minMeanNdcg
    && summary.minNdcg >= RELEVANCE_THRESHOLDS.minPerQueryNdcg
    && summary.irrelevantLeaks.length <= RELEVANCE_THRESHOLDS.maxIrrelevantLeaks
    && understandingFailures.length === 0;

  say('');
  say(`benchmarks         ${summary.passed}/${summary.benchmarks} ordering-clean`);
  say(`mean nDCG@5        ${summary.meanNdcg}`);
  say(`min nDCG@5         ${summary.minNdcg} (${summary.worstBenchmark})`);
  say(`irrelevant leaks   ${summary.irrelevantLeaks.length ? summary.irrelevantLeaks.join(', ') : 'none'}`);
  say(`understanding      ${understanding.length - understandingFailures.length}/${understanding.length} parsed correctly`);
  say('');
  say('────────────────────────────────────────────────────────────');
  say(`SEARCH_RELEVANCE_GATE: ${pass ? 'PASS' : 'FAIL'}`);
  say('────────────────────────────────────────────────────────────');

  const report = {
    namespace: 'FIXTURE',
    at: new Date().toISOString(),
    corpus: { jobs: corpus.jobs.length, titles: corpus.titles.length },
    thresholds: RELEVANCE_THRESHOLDS,
    summary,
    evaluations,
    understanding,
    pass,
  };
  const dir = path.join(ROOT, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'job-discovery-relevance.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else say('Wrote reports/job-discovery-relevance.json');

  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
