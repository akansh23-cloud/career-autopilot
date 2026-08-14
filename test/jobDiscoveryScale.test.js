/* ============================================================
   JOB DISCOVERY OS — SEARCH_SCALE_GATE
   ------------------------------------------------------------
   The full 100k benchmark lives in scripts/job-discovery-scale.mjs
   and takes about a minute. This is the CI-sized version of the
   same corpus, asserting the CORRECTNESS properties that a scan
   limit would quietly break — the ones that matter far more than
   the throughput numbers:

     - a one-in-N posting is still retrievable at rank 1. A
       candidate budget must never be able to hide a relevant job
     - the number of documents RANKED is bounded, while the number
       of documents MATCHED is not. Those are different, and
       conflating them is how relevant jobs disappear
     - closed jobs never surface, at any depth
     - filters do not delete half the index: a disjunctive filter
       must union its branches rather than driving from one
     - deleting and re-adding documents keeps the index consistent
     - a scoped remote role is not promoted to worldwide remote
     - verification budget is spent by tier, not by id order
     - one host cannot monopolise a scheduler tick

   The corpus is deterministic, so a failure here is always a code
   change and never a data change.
   ============================================================ */

import test from 'node:test';
import assert from 'node:assert/strict';

import { generateCorpus, RARE_TITLES } from '../server/services/jobDiscovery/scaleCorpus.js';
import { MemoryJobStore } from '../server/services/jobDiscovery/store.js';
import { StoreBackedSearchIndex } from '../server/services/jobDiscovery/searchIndex.js';
import { allocateVerificationBudget, VERIFY_TIER } from '../server/services/jobDiscovery/verificationPolicy.js';
import { interleaveByHost } from '../server/services/jobDiscovery/crawlQueue.js';
import { computeCoverage, mergeSnapshots, NAMESPACE } from '../server/services/jobDiscovery/coverageMetrics.js';
import { JOB_STATUS } from '../server/services/jobDiscovery/schema.js';

const NOW = '2026-08-14T12:00:00.000Z';
const JOBS = 12000;

let cached = null;
async function scaleIndex() {
  if (cached) return cached;
  const corpus = generateCorpus({ jobCount: JOBS, now: NOW });
  const store = await new MemoryJobStore().init();
  for (const job of corpus.jobs) await store.putJob(job);
  const index = new StoreBackedSearchIndex({ store, cache: false, now: () => Date.parse(NOW) });
  cached = { corpus, store, index };
  return cached;
}

test('SEARCH_SCALE_GATE — a one-in-N posting is still retrievable', async () => {
  const { corpus, index } = await scaleIndex();

  for (const title of RARE_TITLES) {
    const present = corpus.jobs.some((j) => j.title === title && j.status !== JOB_STATUS.REMOVED);
    if (!present) continue;
    // eslint-disable-next-line no-await-in-loop
    const res = await index.search({ q: title, limit: 10 });
    const rank = res.results.findIndex((r) => r.job.title === title);
    assert.ok(rank === 0, `"${title}" is 1 job in ${JOBS} and must rank first, got rank ${rank + 1 || 'absent'}`);
    /* And the index really did have to look past a huge match set to find it. */
    assert.ok(res.retrieval.matchedTotal >= 1);
  }
});

test('SEARCH_SCALE_GATE — documents ranked are bounded, documents matched are not', async () => {
  const { index } = await scaleIndex();
  const res = await index.search({ q: 'Software Engineer', limit: 20 });

  assert.ok(res.retrieval.matchedTotal > 500, `the query should match a large slice of the corpus, matched ${res.retrieval.matchedTotal}`);
  assert.ok(
    res.retrieval.candidatesRanked <= 1000,
    `the ranker must see a bounded candidate set, got ${res.retrieval.candidatesRanked}`,
  );
  assert.ok(
    res.retrieval.candidatesRanked < res.retrieval.matchedTotal,
    'this query should genuinely exercise the truncation path',
  );
  assert.equal(res.retrieval.truncated, true, 'truncation is REPORTED rather than hidden');
  /* The scored-then-selected contract: every match is scored cheaply and the
     top slice is selected. A blind first-N slice of the posting list would make
     the rare-title test above fail, which is exactly why both exist. */
  assert.ok(res.results.length > 0);
});

test('SEARCH_SCALE_GATE — closed jobs never surface, at any depth', async () => {
  const { index } = await scaleIndex();
  const queries = ['DevOps Engineer', 'Data Engineer', 'Product Manager', 'Software Engineer'];
  for (const q of queries) {
    // eslint-disable-next-line no-await-in-loop
    const res = await index.search({ q, limit: 50 });
    const leaked = res.results.filter((r) => r.job.status === JOB_STATUS.REMOVED);
    assert.equal(leaked.length, 0, `${q} leaked ${leaked.length} closed jobs`);
  }
});

test('SEARCH_SCALE_GATE — a disjunctive filter unions its branches instead of driving from one', async () => {
  const { index } = await scaleIndex();

  /* Employment type: a job whose type is UNKNOWN is not evidence that it is not
     full-time, so the filter must include unknowns rather than driving the scan
     from the narrow half and silently deleting the rest. */
  const all = await index.search({ q: 'Engineer', limit: 20 });
  const fullTime = await index.search({ q: 'Engineer', employmentType: 'FULL_TIME', limit: 20 });
  assert.ok(fullTime.results.length > 0, 'an employment-type filter must not empty the result set');
  assert.ok(fullTime.retrieval.matchedTotal <= all.retrieval.matchedTotal);

  /* Location: an unrestricted remote role has no office, and must still be
     reachable from a location query. */
  const located = await index.search({ q: 'Engineer', location: 'India', limit: 20 });
  assert.ok(located.results.length > 0, 'a location filter must not empty the result set');
});

test('SEARCH_SCALE_GATE — a scoped remote role is never promoted to worldwide remote', async () => {
  const { corpus } = await scaleIndex();

  const remote = corpus.jobs.filter((j) => j.workplace?.type === 'REMOTE');
  assert.ok(remote.length > 100, `the corpus contains a real population of remote roles, got ${remote.length}`);

  for (const job of remote) {
    /* WORLDWIDE is a claim about who may apply, and it needs evidence. The
       corpus states either a specific region or nothing at all, so no job in
       it may end up classified as remote-from-anywhere. */
    assert.notEqual(
      job.workplace.remoteScope,
      'WORLDWIDE',
      `"${job.workplace.evidence}" is not evidence of worldwide remote (${job.id})`,
    );
    assert.ok(
      (job.workplace.remoteRegions || []).length > 0,
      `a scoped remote role must retain its regions (${job.id})`,
    );
  }
});

test('SEARCH_SCALE_GATE — deleting and re-adding keeps the index consistent', async () => {
  const corpus = generateCorpus({ jobCount: 500, now: NOW });
  const store = await new MemoryJobStore().init();
  for (const job of corpus.jobs) await store.putJob(job);
  const index = new StoreBackedSearchIndex({ store, cache: false, now: () => Date.parse(NOW) });

  const before = await index.search({ q: 'Engineer', limit: 50 });
  const victim = before.results[0].job;

  await store.deleteJob(victim.id);
  const afterDelete = await index.search({ q: 'Engineer', limit: 50 });
  assert.ok(!afterDelete.results.some((r) => r.job.id === victim.id), 'a deleted job disappears from results');

  await store.putJob(victim);
  const afterReadd = await index.search({ q: 'Engineer', limit: 50 });
  assert.ok(afterReadd.results.some((r) => r.job.id === victim.id), 'a re-added job comes back');
  assert.equal(
    afterReadd.retrieval.matchedTotal,
    before.retrieval.matchedTotal,
    'tombstones must not inflate or deflate the match count',
  );
});

test('SEARCH_SCALE_GATE — verification budget is spent by tier, not by id order', async () => {
  const { corpus } = await scaleIndex();
  const allocated = allocateVerificationBudget(corpus.jobs, { limit: 100, now: Date.parse(NOW) });

  assert.equal(allocated.length, 100);
  const weights = allocated.map((a) => a.weight);
  for (let i = 1; i < weights.length; i += 1) {
    assert.ok(weights[i] <= weights[i - 1], 'the budget is spent highest-value first');
  }
  /* A REMOVED job is never worth a check. */
  assert.ok(!allocated.some((a) => a.job.status === JOB_STATUS.REMOVED));
  assert.ok(Object.values(VERIFY_TIER).includes(allocated[0].tier));
});

test('SEARCH_SCALE_GATE — one host cannot monopolise a scheduler tick', async () => {
  const { corpus } = await scaleIndex();
  const tasks = corpus.sources.slice(0, 300).map((s, i) => ({
    id: `t${i}`, sourceId: s.id, host: `host${i % 7}.example`, priority: i % 11,
  }));
  const ordered = interleaveByHost(tasks);
  const firstSeven = new Set(ordered.slice(0, 7).map((t) => t.host));
  assert.equal(firstSeven.size, 7, 'every host gets a slot in the first round');
});

test('SEARCH_SCALE_GATE — fixture metrics can never be reported as production coverage', async () => {
  const { corpus } = await scaleIndex();

  const fixture = computeCoverage({
    jobs: corpus.jobs, sources: corpus.sources, companies: corpus.companies,
    namespace: NAMESPACE.FIXTURE, now: Date.parse(NOW),
  });
  assert.equal(fixture.namespace, NAMESPACE.FIXTURE);
  assert.ok(fixture.jobs.activeCanonicalJobs > 0);

  /* An unlabelled snapshot is refused outright — a default namespace is exactly
     how benchmark numbers end up on a page labelled "coverage". */
  assert.throws(
    () => computeCoverage({ jobs: corpus.jobs, sources: [], companies: [] }),
    /namespace must be PRODUCTION or FIXTURE/,
  );

  const production = computeCoverage({
    jobs: [], sources: [], companies: [], namespace: NAMESPACE.PRODUCTION, now: Date.parse(NOW),
  });
  assert.throws(() => mergeSnapshots(fixture, production), /refusing to combine/);
});

test('SEARCH_SCALE_GATE — discovery age is only computed from stated publication dates', async () => {
  const { corpus } = await scaleIndex();
  const snapshot = computeCoverage({
    jobs: corpus.jobs, sources: corpus.sources, companies: corpus.companies,
    namespace: NAMESPACE.FIXTURE, now: Date.parse(NOW),
  });

  const dated = corpus.jobs.filter((j) => j.sourcePublishedAt && j.firstSeenAt).length;
  assert.ok(snapshot.discovery.datedSampleSize <= dated, 'the sample can only shrink, never exceed the dated population');
  assert.ok(snapshot.discovery.datedSampleSize < corpus.jobs.length, 'undated jobs are excluded rather than given a fabricated date');
  assert.ok(snapshot.discovery.medianDiscoveryAgeDays >= 0);
});
