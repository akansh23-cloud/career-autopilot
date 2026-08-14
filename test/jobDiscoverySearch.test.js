/* ============================================================
   JOB DISCOVERY OS — SEARCH TESTS
   ------------------------------------------------------------
   Covers SEARCH_GATE (§64.5), §50 (no resume required), §56
   (relevance fixtures) and §33 (response shape).

   NOTHING in this file supplies a resume, a profile or an
   evidence graph. That is the point.
   ============================================================ */

import test from 'node:test';
import assert from 'node:assert/strict';

import { toCanonicalJob } from '../server/services/jobDiscovery/normalize/index.js';
import { rankJob, titleRelevance, remoteCompatibility } from '../server/services/jobDiscovery/ranking.js';
import { StoreBackedSearchIndex, QueryCache } from '../server/services/jobDiscovery/searchIndex.js';
import { MemoryJobStore } from '../server/services/jobDiscovery/store.js';
import { parseSearchQuery } from '../server/routes/jobDiscoveryRoutes.js';
import { PROVIDER, SOURCE_CLASS, SOURCE_TYPE, JOB_STATUS } from '../server/services/jobDiscovery/schema.js';

const NOW = '2026-08-14T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);

const atsSource = {
  id: 'src_ats', provider: PROVIDER.GREENHOUSE, sourceType: SOURCE_TYPE.ATS,
  sourceClass: SOURCE_CLASS.ORIGINAL_ATS, tenant: 'testco', companyName: 'Test Co',
  companyDomain: 'testco.example',
};
const aggSource = {
  id: 'src_agg', provider: PROVIDER.API, sourceType: SOURCE_TYPE.AGGREGATOR,
  sourceClass: SOURCE_CLASS.AGGREGATOR, tenant: 'Aggregator',
};

let seq = 0;
function job({
  title, company = 'Test Co', locations = ['Bengaluru, India'], remote = null,
  description = 'Standard responsibilities for this role including delivery, quality and collaboration with partner teams.',
  published = '2026-08-13T00:00:00.000Z', source = atsSource, salary = null, employmentType = null,
  applicantRegions = [],
}) {
  seq += 1;
  return toCanonicalJob({
    sourceJobId: `j${seq}`,
    /* Unique per fixture job: the canonical id is derived from company + title +
       location, so two same-shaped fixtures would otherwise be ONE record and
       the second putJob would silently replace the first. */
    requisitionId: `REQ-${seq}`,
    title,
    company: { name: company, domain: source.companyDomain || null },
    descriptionText: description,
    descriptionHtml: null,
    locationsRaw: locations,
    applicantRegions,
    explicitRemote: remote,
    workplaceHint: null,
    employmentTypeRaw: employmentType,
    department: null,
    jobUrl: `https://boards.greenhouse.io/testco/jobs/${seq}`,
    applyUrl: `https://boards.greenhouse.io/testco/jobs/${seq}#app`,
    sourcePublishedAt: published,
    validThrough: null,
    compensationStructured: salary,
    compensationRaw: null,
    tags: [],
  }, source, { now: NOW });
}

async function indexOf(jobs) {
  const store = await new MemoryJobStore().init();
  for (const j of jobs) await store.putJob({ ...j, status: JOB_STATUS.ACTIVE });
  return new StoreBackedSearchIndex({ store, now: () => NOW_MS, cache: null });
}

/* ======================= §56 relevance fixtures ======================= */

const RELEVANCE_FIXTURES = [
  {
    query: 'DevOps Engineer',
    exact: 'DevOps Engineer',
    alias: 'Build & Release Engineer',
    strong: 'Site Reliability Engineer',
    weak: 'Systems Engineer',
    irrelevant: 'Marketing Manager',
  },
  {
    /* "Java Backend" resolves to TWO families (Java + Backend), so both
       "Spring Boot Developer" and "Backend Engineer" are aliases of a queried
       family and their order is decided by text overlap with the query — a
       legitimate, explainable signal, not a tier violation. Only the tier
       claims that remain unambiguous are asserted here. */
    query: 'Java Backend',
    crossFamily: true,
    exact: 'Java Backend Engineer',
    alias: 'Spring Boot Developer',
    strong: 'Backend Engineer',
    weak: 'QA Engineer',
    irrelevant: 'UX Designer',
  },
  {
    query: 'Data Engineer',
    exact: 'Data Engineer',
    alias: 'ETL Developer',
    strong: 'Machine Learning Engineer',
    weak: 'Data Analyst',
    irrelevant: 'Recruiter',
  },
  {
    query: 'Product Manager',
    exact: 'Product Manager',
    alias: 'Product Owner',
    strong: 'Program Manager',
    weak: 'Project Manager',
    irrelevant: 'Network Engineer',
  },
  {
    query: 'Marketing Manager',
    exact: 'Marketing Manager',
    alias: 'Digital Marketing Manager',
    strong: 'Content Marketing Manager',
    weak: 'Sales Manager',
    irrelevant: 'Data Engineer',
  },
  {
    query: 'Remote Support Engineer',
    exact: 'Support Engineer',
    alias: 'Technical Support Engineer',
    strong: 'Customer Success Manager',
    weak: 'DevOps Engineer',
    irrelevant: 'Accountant',
  },
];

for (const fixture of RELEVANCE_FIXTURES) {
  test(`SEARCH_GATE — "${fixture.query}" ranks exact > alias > related > irrelevant`, async () => {
    const jobs = [
      job({ title: fixture.exact }),
      job({ title: fixture.alias }),
      job({ title: fixture.strong }),
      job({ title: fixture.weak }),
      job({ title: fixture.irrelevant }),
    ];
    const index = await indexOf(jobs);
    const res = await index.search({ q: fixture.query, limit: 20 });
    const titles = res.results.map((r) => r.job.title);

    assert.equal(titles[0], fixture.exact, `expected exact first, got ${titles.join(' > ')}`);
    assert.ok(!titles.includes(fixture.irrelevant), `irrelevant role "${fixture.irrelevant}" must be suppressed, got ${titles.join(' > ')}`);

    const scoreOf = (t) => res.results.find((r) => r.job.title === t)?.relevance.overall ?? -1;
    const relationOf = (t) => res.results.find((r) => r.job.title === t)?.relevance.titleRelation ?? 'ABSENT';

    /* A cross-family query has no literal exact title to match, so the best
       possible relation there is ALIAS. */
    assert.ok(
      fixture.crossFamily
        ? ['EXACT', 'ALIAS'].includes(relationOf(fixture.exact))
        : relationOf(fixture.exact) === 'EXACT',
      `unexpected relation for "${fixture.exact}": ${relationOf(fixture.exact)}`,
    );
    assert.equal(relationOf(fixture.alias), 'ALIAS');
    assert.ok(scoreOf(fixture.exact) >= scoreOf(fixture.alias), 'exact >= alias');
    assert.ok(scoreOf(fixture.alias) > scoreOf(fixture.weak), 'alias > weakly related');
    assert.ok(scoreOf(fixture.strong) > scoreOf(fixture.weak), 'strongly related > weakly related');

    if (!fixture.crossFamily) {
      assert.equal(relationOf(fixture.strong), 'STRONG');
      assert.equal(relationOf(fixture.weak), 'RELATED');
      assert.ok(scoreOf(fixture.alias) >= scoreOf(fixture.strong), 'alias >= strongly related');
    }
  });
}

test('§32 — SRE is NOT treated as an exact synonym of DevOps Engineer', async () => {
  const devops = job({ title: 'DevOps Engineer' });
  const sre = job({ title: 'Site Reliability Engineer' });
  const index = await indexOf([sre, devops]);
  const res = await index.search({ q: 'DevOps Engineer' });

  const d = res.results.find((r) => r.job.title === 'DevOps Engineer');
  const s = res.results.find((r) => r.job.title === 'Site Reliability Engineer');
  assert.equal(d.relevance.titleRelation, 'EXACT');
  assert.equal(s.relevance.titleRelation, 'STRONG');
  assert.ok(d.relevance.overall > s.relevance.overall);
  assert.ok(s.relevance.overall > 0, 'but it is still surfaced');
});

test('§32 — substring matching is not used', () => {
  const engineerJob = job({ title: 'Sales Engineer' });
  const r = titleRelevance(engineerJob, 'DevOps Engineer');
  assert.ok(r.score < 0.4, `shared word "engineer" must not score like a family match (got ${r.score})`);
});

/* ========================== §50 no resume ========================== */

test('§50 — search works with NO resume, NO profile, NO evidence graph', async () => {
  const index = await indexOf([
    job({ title: 'DevOps Engineer', locations: ['Remote - India'], remote: true, applicantRegions: ['India'] }),
    job({ title: 'Platform Engineer' }),
    job({ title: 'Accountant' }),
  ]);
  const res = await index.search({ q: 'DevOps Engineer', location: 'Remote India' });

  assert.ok(res.results.length >= 1);
  assert.equal(res.personalization.usedResume, false);
  assert.equal(res.personalization.usedProfile, false);
  assert.equal(res.personalization.usedEvidence, false);

  /* Ranking is a pure function of (job, query): feeding it candidate data
     changes NOTHING, because there is no path by which it could. */
  const sample = index.store.jobs.values().next().value;
  const plain = rankJob(sample, { q: 'DevOps Engineer' }, { now: NOW_MS });
  const withCandidateNoise = rankJob(sample, {
    q: 'DevOps Engineer',
    resume: { text: 'kubernetes terraform aws jenkins' },
    profile: { skills: ['devops'] },
    evidenceGraph: { nodes: 42 },
    careerAutopilotScore: 91,
  }, { now: NOW_MS });
  assert.deepEqual(withCandidateNoise, plain, 'candidate data cannot influence the score');
  assert.ok(plain.overall > 0);
});

test('an empty query still returns ranked jobs', async () => {
  const index = await indexOf([job({ title: 'DevOps Engineer' }), job({ title: 'Accountant' })]);
  const res = await index.search({});
  assert.equal(res.results.length, 2, 'no query means no relevance filter, not an empty page');
});

/* ========================== §57 location ========================== */

test('SEARCH_GATE — an India remote search excludes a US-only remote role', async () => {
  const usOnly = job({
    title: 'DevOps Engineer', locations: ['Remote - US'], remote: true,
    applicantRegions: ['United States'],
    description: 'Own the CI/CD estate. This role is open to candidates located in the United States only.',
  });
  const indiaRemote = job({ title: 'DevOps Engineer', locations: ['Remote - India'], remote: true, applicantRegions: ['India'] });
  const worldwide = job({ title: 'DevOps Engineer', locations: ['Remote — Worldwide'], remote: true });
  const puneOnsite = job({ title: 'DevOps Engineer', locations: ['Pune, India'] });
  const europeRemote = job({ title: 'DevOps Engineer', locations: ['Remote - Europe'], remote: true, applicantRegions: ['Europe'] });

  const index = await indexOf([usOnly, indiaRemote, worldwide, puneOnsite, europeRemote]);
  const res = await index.search({ q: 'DevOps Engineer', location: 'Remote India' });
  const ids = res.results.map((r) => r.job.id);

  assert.ok(ids.includes(indiaRemote.id), 'India remote must be included');
  assert.ok(ids.includes(worldwide.id), 'worldwide remote must be included');
  assert.ok(!ids.includes(usOnly.id), 'US-only remote must NOT be location-compatible');
  assert.ok(!ids.includes(europeRemote.id), 'Europe-only remote must NOT be location-compatible');
});

test('a Bangalore search finds Bangalore roles and not London ones', async () => {
  const blr = job({ title: 'Java Backend Engineer', locations: ['Bengaluru, India'] });
  const ldn = job({ title: 'Java Backend Engineer', locations: ['London, United Kingdom'] });
  const index = await indexOf([ldn, blr]);
  const res = await index.search({ q: 'Java Backend', location: 'Bangalore' });
  assert.equal(res.results[0].job.id, blr.id);
  assert.ok(!res.results.map((r) => r.job.id).includes(ldn.id));
});

test('remote filter respects evidence and does not guess', () => {
  const unknown = job({ title: 'DevOps Engineer', locations: [] });
  const r = remoteCompatibility(unknown, 'remote');
  assert.equal(r.compatible, true);
  assert.ok(r.score < 0.5, 'unstated workplace type is surfaced but not rewarded');
  assert.match(r.reason, /not stated/);

  /* A city with no workplace statement stays UNKNOWN — it is not silently
     upgraded to "onsite" (§37). Only an explicit signal classifies it. */
  const cityOnly = job({ title: 'DevOps Engineer', locations: ['Pune, India'] });
  assert.equal(cityOnly.workplace.type, 'UNKNOWN');
  assert.equal(remoteCompatibility(cityOnly, 'remote').compatible, true);
  assert.ok(remoteCompatibility(cityOnly, 'remote').score < 0.5);

  const onsite = job({ title: 'DevOps Engineer', locations: ['Pune, India (On-site)'] });
  assert.equal(onsite.workplace.type, 'ONSITE');
  assert.equal(remoteCompatibility(onsite, 'remote').compatible, false);
});

/* ======================= filters and freshness ======================= */

test('filters are respected: company, freshness, employmentType, salary', async () => {
  const recent = job({ title: 'Data Engineer', published: '2026-08-13T00:00:00.000Z' });
  const old = job({ title: 'Data Engineer', published: '2026-05-01T00:00:00.000Z' });
  const other = job({ title: 'Data Engineer', company: 'Other Corp', published: '2026-08-13T00:00:00.000Z' });
  const contract = job({ title: 'Data Engineer', employmentType: 'Contract', published: '2026-08-13T00:00:00.000Z' });
  const paid = job({
    title: 'Data Engineer', published: '2026-08-13T00:00:00.000Z',
    salary: { minValue: 3000000, maxValue: 4000000, currency: 'INR', interval: 'YEAR' },
  });

  const index = await indexOf([recent, old, other, contract, paid]);

  const fresh = await index.search({ q: 'Data Engineer', freshness: '7d' });
  assert.ok(!fresh.results.map((r) => r.job.id).includes(old.id), '7-day window excludes a May posting');
  assert.equal(fresh.rejected.freshness, 1);

  const byCompany = await index.search({ q: 'Data Engineer', company: 'Other Corp' });
  assert.equal(byCompany.results.length, 1);
  assert.equal(byCompany.results[0].job.company.name, 'Other Corp');

  /* Employment type follows the same rule as salary: a job whose source never
     stated a type is NOT deleted by the filter — it is retained and explained.
     A job that states a DIFFERENT type is excluded. */
  const byType = await index.search({ q: 'Data Engineer', employmentType: 'CONTRACT' });
  const typeIds = byType.results.map((r) => r.job.id);
  assert.ok(typeIds.includes(contract.id));
  assert.ok(typeIds.includes(recent.id), 'unstated employment type is not excluded');
  assert.match(
    byType.results.find((r) => r.job.id === recent.id).relevance.explanations.employmentType,
    /not stated/,
  );

  const wrongType = await index.search({ q: 'Data Engineer', employmentType: 'INTERNSHIP' });
  assert.ok(!wrongType.results.map((r) => r.job.id).includes(contract.id), 'a stated CONTRACT role is excluded from an INTERNSHIP search');

  const bySalary = await index.search({ q: 'Data Engineer', salaryMin: 3500000 });
  const ids = bySalary.results.map((r) => r.job.id);
  assert.ok(ids.includes(paid.id));
  assert.ok(ids.includes(recent.id), 'jobs with no stated salary are not deleted by a salary filter');
});

test('an original ATS job outranks an identical aggregator-only job', async () => {
  const ats = job({ title: 'DevOps Engineer' });
  const aggregator = job({ title: 'DevOps Engineer', company: 'Test Co', source: aggSource });
  const index = await indexOf([aggregator, ats]);
  const res = await index.search({ q: 'DevOps Engineer' });
  assert.equal(res.results[0].job.id, ats.id);
  assert.equal(res.results[0].source.isOriginal, true);
  assert.equal(res.results[0].apply.directApply, true);
});

/* ========================= §33 response shape ========================= */

test('§33 — response carries provenance, freshness semantics and honest scores', async () => {
  const dated = job({ title: 'DevOps Engineer', published: '2026-08-13T00:00:00.000Z' });
  const undated = job({ title: 'DevOps Engineer', published: null });
  const index = await indexOf([dated, undated]);
  const res = await index.search({ q: 'DevOps Engineer' });

  const first = res.results[0];
  assert.equal(first.rank, 1);
  assert.equal(typeof first.relevance.overall, 'number');
  assert.ok(Number.isInteger(first.relevance.overall), 'scores are integers, not fake precision');
  assert.ok(first.relevance.overall <= 100);
  assert.equal(first.source.provider, PROVIDER.GREENHOUSE);
  assert.equal(first.source.type, SOURCE_CLASS.ORIGINAL_ATS);
  assert.ok('sourcePublishedAt' in first.freshness);
  assert.ok('firstSeenAt' in first.freshness);
  assert.ok('lastVerifiedAt' in first.freshness);

  const undatedResult = res.results.find((r) => r.job.id === undated.id);
  assert.equal(undatedResult.freshness.sourcePublishedAt, null);
  assert.equal(undatedResult.freshness.dateKind, 'discovered');
  assert.match(undatedResult.freshness.dateLabel, /^First discovered/);

  const datedResult = res.results.find((r) => r.job.id === dated.id);
  assert.equal(datedResult.freshness.dateKind, 'posted');
  assert.match(datedResult.freshness.dateLabel, /^Posted/);
});

test('removed jobs never appear in search results', async () => {
  const store = await new MemoryJobStore().init();
  await store.putJob({ ...job({ title: 'DevOps Engineer' }), status: JOB_STATUS.ACTIVE });
  await store.putJob({ ...job({ title: 'DevOps Engineer' }), status: JOB_STATUS.REMOVED });
  const index = new StoreBackedSearchIndex({ store, now: () => NOW_MS, cache: null });
  const res = await index.search({ q: 'DevOps Engineer' });
  assert.equal(res.results.length, 1);
});

test('cursor pagination is stable', async () => {
  const jobs = Array.from({ length: 7 }, (_, i) => job({ title: 'DevOps Engineer', description: `Role variant ${i} with platform ownership and delivery duties.` }));
  const index = await indexOf(jobs);
  const p1 = await index.search({ q: 'DevOps Engineer', limit: 3 });
  assert.equal(p1.results.length, 3);
  assert.ok(p1.nextCursor);
  const p2 = await index.search({ q: 'DevOps Engineer', limit: 3, cursor: p1.nextCursor });
  assert.equal(p2.results.length, 3);
  assert.equal(p2.results[0].rank, 4);
  const overlap = p1.results.map((r) => r.job.id).filter((id) => p2.results.some((r) => r.job.id === id));
  assert.equal(overlap.length, 0);
});

/* ============================ query cache ============================ */

test('query cache keys on normalized filters and expires', () => {
  let t = 0;
  const cache = new QueryCache({ ttlMs: 1000, now: () => t });
  cache.set({ q: 'DevOps Engineer', location: '' }, { hit: 1 });
  assert.deepEqual(cache.get({ q: 'devops engineer' }), { hit: 1 }, 'empty filters do not change the key');
  assert.equal(cache.get({ q: 'devops engineer', location: 'Pune' }), null);
  t = 2000;
  assert.equal(cache.get({ q: 'devops engineer' }), null, 'expired');
});

/* ========================= §60 query parsing ========================= */

test('§60 — search parameters are coerced and bounded', () => {
  const parsed = parseSearchQuery({
    q: 'x'.repeat(500), location: 'Pune', remote: 'REMOTE', salaryMin: '20,00,000',
    freshness: 'nonsense', limit: '999', employmentType: 'full time', sourceType: 'original_ats',
  });
  assert.equal(parsed.q.length, 160);
  assert.equal(parsed.remote, 'remote');
  assert.equal(parsed.salaryMin, 2000000);
  assert.equal(parsed.freshness, 'latest', 'an unknown freshness value falls back, it does not throw');
  assert.equal(parsed.limit, 50);
  assert.equal(parsed.employmentType, 'FULL_TIME');
  assert.equal(parsed.sourceType, 'ORIGINAL_ATS');

  assert.equal(parseSearchQuery({ remote: 'any' }).remote, null);
  assert.equal(parseSearchQuery({}).q, null);
});
