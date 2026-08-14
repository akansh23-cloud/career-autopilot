/* ============================================================
   JOB DISCOVERY OS — SEARCH_RELEVANCE_GATE
   ------------------------------------------------------------
   Makes ranking quality a number that can regress.

   Twelve graded benchmarks run against ONE shared corpus, so
   every "irrelevant" distractor is genuinely indexed and the
   leak check is a real test rather than a tautology.

   What is asserted:
     - the exact role ranks first
     - relation classes are respected: alias outranks strongly
       related, which outranks related
     - the irrelevant role is never returned
     - nDCG@5 stays above an explicit floor, per query and on
       average, so a change that preserves ordering but degrades
       the shape of the ranking still fails
     - free-text queries are PARSED correctly, checked separately
       from ranking so a parser bug and a ranking bug are
       distinguishable

   No resume and no candidate data anywhere: this is search
   quality for a visitor the product knows nothing about.
   ============================================================ */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryJobStore } from '../server/services/jobDiscovery/store.js';
import { StoreBackedSearchIndex } from '../server/services/jobDiscovery/searchIndex.js';
import { buildRelevanceCorpus } from './fixtures/jobDiscovery/relevanceCorpus.js';
import { understandQuery } from '../server/services/jobDiscovery/normalize/queryUnderstanding.js';
import {
  RELEVANCE_BENCHMARKS, UNDERSTANDING_BENCHMARKS, evaluateBenchmark,
  summarizeEvaluation, RELEVANCE_THRESHOLDS, ndcg,
} from '../server/services/jobDiscovery/searchQualityEvaluator.js';

const NOW = '2026-08-14T12:00:00.000Z';

let cached = null;
async function relevanceIndex() {
  if (cached) return cached;
  const corpus = buildRelevanceCorpus({ now: NOW });
  const store = await new MemoryJobStore().init();
  for (const job of corpus.jobs) await store.putJob(job);
  const index = new StoreBackedSearchIndex({ store, cache: false, now: () => Date.parse(NOW) });
  cached = { corpus, store, index };
  return cached;
}

test('SEARCH_RELEVANCE_GATE — every benchmark respects the relation-class ordering', async () => {
  const { index } = await relevanceIndex();
  const evaluations = [];

  for (const benchmark of RELEVANCE_BENCHMARKS) {
    // eslint-disable-next-line no-await-in-loop
    const res = await index.search({ q: benchmark.query, limit: 10 });
    const evaluation = evaluateBenchmark(benchmark, res.results);
    evaluations.push(evaluation);

    assert.equal(
      evaluation.ordering.ok,
      true,
      `${benchmark.query}: ${JSON.stringify(evaluation.ordering.violations)} — returned ${evaluation.returned.slice(0, 5).join(' | ')}`,
    );
    assert.equal(evaluation.irrelevantReturned, false, `${benchmark.query} returned the irrelevant role ${benchmark.irrelevant}`);
    assert.ok(
      evaluation.ndcg >= RELEVANCE_THRESHOLDS.minPerQueryNdcg,
      `${benchmark.query} nDCG ${evaluation.ndcg} below floor ${RELEVANCE_THRESHOLDS.minPerQueryNdcg}`,
    );
  }

  const summary = summarizeEvaluation(evaluations);
  assert.equal(summary.failed, 0);
  assert.ok(
    summary.meanNdcg >= RELEVANCE_THRESHOLDS.minMeanNdcg,
    `mean nDCG ${summary.meanNdcg} below ${RELEVANCE_THRESHOLDS.minMeanNdcg}`,
  );
  assert.deepEqual(summary.irrelevantLeaks, []);
});

test('SEARCH_RELEVANCE_GATE — free-text queries are parsed into the right intent', () => {
  for (const b of UNDERSTANDING_BENCHMARKS) {
    const u = understandQuery(b.query);
    const families = new Set(u.families || []);

    for (const f of b.expectFamilies || []) {
      assert.ok(families.has(f), `"${b.query}" should resolve family ${f}, got ${[...families].slice(0, 6).join(', ')}`);
    }
    for (const t of b.expectTechs || []) {
      assert.ok((u.techs || []).includes(t), `"${b.query}" should extract technology ${t}, got ${(u.techs || []).join(', ')}`);
    }
    if (b.expectLocation) {
      assert.match(String(u.location || ''), new RegExp(b.expectLocation, 'i'), `"${b.query}" should extract location ${b.expectLocation}`);
    }
    if (b.expectRemote) {
      assert.equal(u.remote, b.expectRemote, `"${b.query}" should be understood as ${b.expectRemote}`);
    }
    for (const s of b.expectSeniority || []) {
      assert.ok((u.seniority || []).includes(s), `"${b.query}" should imply seniority ${s}, got ${(u.seniority || []).join(', ')}`);
    }
  }
});

test('SEARCH_RELEVANCE_GATE — a role query never requires a resume or profile', async () => {
  const { index } = await relevanceIndex();
  /* Search is called with nothing but a query string. If any candidate-side
     input were load-bearing this would return nothing. */
  const res = await index.search({ q: 'DevOps Engineer', limit: 5 });
  assert.ok(res.results.length >= 4);
  assert.equal(res.results[0].job.title, 'DevOps Engineer');
  assert.ok(res.understanding, 'the payload explains how the query was interpreted');
  assert.match(res.understanding.roleText, /devops engineer/i);
});

test('SEARCH_RELEVANCE_GATE — a query with no matching family still returns nothing irrelevant', async () => {
  const { index } = await relevanceIndex();
  const res = await index.search({ q: 'Underwater Basket Weaver', limit: 10 });
  /* The honest answer to a role we have no jobs for is an empty or very small
     result set — never a page of unrelated engineering roles padded out to
     look busy. */
  const titles = res.results.map((r) => r.job.title);
  assert.ok(titles.length <= 3, `expected few or no results, got ${titles.length}: ${titles.join(', ')}`);
});

test('SEARCH_RELEVANCE_GATE — nDCG is computed against the graded corpus, not the returned order', () => {
  const benchmark = RELEVANCE_BENCHMARKS[0];
  const perfect = [benchmark.exact, benchmark.alias, benchmark.strong, benchmark.related];
  const reversed = [benchmark.related, benchmark.strong, benchmark.alias, benchmark.exact];

  assert.equal(ndcg(perfect, benchmark, 5), 1, 'the ideal ordering scores 1');
  assert.ok(ndcg(reversed, benchmark, 5) < 0.8, 'a reversed ordering must score materially worse');
  assert.equal(ndcg([benchmark.irrelevant], benchmark, 5), 0, 'the irrelevant role contributes no gain');
});

test('SEARCH_RELEVANCE_GATE — every graded title exists in the corpus', async () => {
  const { corpus } = await relevanceIndex();
  const present = new Set(corpus.titles);
  for (const b of RELEVANCE_BENCHMARKS) {
    for (const title of [b.exact, b.alias, b.strong, b.related, b.irrelevant]) {
      assert.ok(present.has(title), `graded title "${title}" is missing from the shared corpus`);
    }
  }
});
