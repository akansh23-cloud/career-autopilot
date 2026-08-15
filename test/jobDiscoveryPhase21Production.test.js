/* ============================================================
   JOB DISCOVERY OS — PHASE 2.1 PRODUCTION HARDENING
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { MemoryJobStore, MongoJobStore } from '../server/services/jobDiscovery/store.js';
import { CompanyRegistry, makeCompany } from '../server/services/jobDiscovery/companyRegistry.js';
import {
  CompanySeedCatalog,
  DEFAULT_COMPANY_SEED_TARGET,
  CURATED_SEED_SOURCE,
  OPENJOBS_SEED_SOURCE,
} from '../server/services/jobDiscovery/companySeedCatalog.js';
import { JOB_STATUS } from '../server/services/jobDiscovery/schema.js';
import { makeService } from './fixtures/jobDiscovery/harness.js';

function mockOpenJobsRows(count = 1400) {
  return Array.from({ length: count }, (_, i) => ({
    name: `OpenJobs Seed Company ${String(i + 1).padStart(4, '0')}`,
    website: `https://seed-company-${i + 1}.example`,
    industry_category: 'tech',
    ats_links: [`https://jobs.lever.co/seed-company-${i + 1}`],
    list_urls: [],
    countries: i % 2 === 0 ? ['India', 'United States'] : ['United States'],
  }));
}

function mockFetchJson(payload) {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    async text() { return JSON.stringify(payload); },
  });
}



test('INTEGRATION_GATE — Mongo company seed bulk upsert never overlaps $set and $setOnInsert paths', async () => {
  const captured = [];
  const store = new MongoJobStore({ mongoose: {} });
  store.models = {
    Company: {
      async bulkWrite(operations) {
        captured.push(...operations);
        return { upsertedCount: operations.length, matchedCount: 0, modifiedCount: 0 };
      },
    },
  };

  const company = makeCompany({
    name: 'Mongo Seed Fixture',
    domain: 'mongo-seed.example',
    careersUrl: 'https://jobs.lever.co/mongo-seed',
    atsProvider: 'LEVER',
    atsTenant: 'mongo-seed',
    seedSource: 'fixture-seed',
    seedRank: 7,
    careerUrlStatus: 'SEEDED_UNVERIFIED',
    indiaRelevance: 'High',
    companyType: 'MNC_ENTERPRISE',
    companyTypeSource: 'fixture-curated',
    companyTypeConfidence: 0.9,
  });

  const result = await store.seedCompanies([company], { seedSource: 'fixture-seed' });
  assert.equal(result.inserted, 1);
  assert.equal(captured.length, 1);
  const update = captured[0].updateOne.update;
  const insertKeys = new Set(Object.keys(update.$setOnInsert || {}));
  const setKeys = Object.keys(update.$set || {});
  assert.ok(setKeys.length > 0);
  assert.deepEqual(setKeys.filter((key) => insertKeys.has(key)), [],
    'Mongo update operators must never target the same seed metadata path');
  assert.equal(update.$set.seedSource, 'fixture-seed');
  assert.equal(update.$set.seedRank, 7);
  assert.equal(update.$set.careerUrlStatus, 'SEEDED_UNVERIFIED');
  assert.equal(update.$set.indiaRelevance, 'High');
  assert.equal(update.$set.companyType, 'MNC_ENTERPRISE');
  assert.equal(update.$set.companyTypeSource, 'fixture-curated');
  assert.equal(Object.prototype.hasOwnProperty.call(update.$setOnInsert || {}, 'createdAt'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(update.$setOnInsert || {}, 'updatedAt'), false,
    'Mongoose timestamps owns updatedAt; seed payload must not collide with it');
  assert.equal(Object.prototype.hasOwnProperty.call(update.$set || {}, 'updatedAt'), false);
});
test('DISCOVERY_GATE — company seed catalog persists 1,000 searchable direct-employer career entries', async () => {
  const store = new MemoryJobStore();
  const companies = new CompanyRegistry({ store });
  const catalog = new CompanySeedCatalog({
    store,
    companies,
    fetchImpl: mockFetchJson(mockOpenJobsRows()),
    logger: { warn() {} },
  });

  const result = await catalog.ensure({ minimum: DEFAULT_COMPANY_SEED_TARGET, includeRemote: true });
  assert.equal(result.ok, true);
  assert.equal(result.reached, true);
  assert.equal(result.summary.seeded, 1000);
  assert.ok(result.curated.requested >= 250, 'the bundled curated list remains the first seed tier');
  assert.ok(result.external.requested > 0, 'the public direct-career dataset extends the catalog to 1,000');

  const page1 = await store.pageCompanies({ page: 1, pageSize: 20 });
  const page2 = await store.pageCompanies({ page: 2, pageSize: 20 });
  assert.equal(page1.docs.length, 20);
  assert.equal(page2.docs.length, 20);
  assert.equal(page1.total, 1000);
  assert.equal(page2.total, 1000);
  assert.notEqual(page1.docs[0].id, page2.docs[0].id, 'page 2 is a different slice, not infinite-scroll duplication');

  const searched = await store.pageCompanies({ page: 1, pageSize: 20, q: 'OpenJobs Seed Company 0499' });
  assert.equal(searched.total, 1);
  assert.match(searched.docs[0].careersUrl, /jobs\.lever\.co/);
  assert.equal(searched.docs[0].seedSource, OPENJOBS_SEED_SOURCE);

  const curated = await store.pageCompanies({ page: 1, pageSize: 20, seedSource: CURATED_SEED_SOURCE });
  assert.ok(curated.total > 0);
});



test('DISCOVERY_GATE — remote seed outage still persists the bundled curated company registry', async () => {
  const store = new MemoryJobStore();
  const companies = new CompanyRegistry({ store });
  const catalog = new CompanySeedCatalog({
    store,
    companies,
    fetchImpl: async () => { throw new Error('fixture remote unavailable'); },
    logger: { warn() {} },
  });

  const result = await catalog.ensure({ minimum: 1000, includeRemote: true });
  assert.equal(result.ok, true);
  assert.equal(result.partial, true);
  assert.equal(result.reached, false);
  assert.ok(result.summary.seeded >= 250, 'bundled curated career sites remain persisted');
  assert.match(result.external.error, /remote unavailable/);
  const page = await store.pageCompanies({ page: 1, pageSize: 20 });
  assert.equal(page.docs.length, 20);
  assert.ok(page.total >= 250, 'registry remains usable even when external expansion is down');
  assert.ok(Number(result.summary.byCompanyType?.STARTUP_SCALEUP || 0) > 0);
  assert.ok(Number(result.summary.byCompanyType?.MNC_ENTERPRISE || 0) > 0);
});

test('DISCOVERY_GATE — persisted company career seeds feed the durable discovery queue', async () => {
  const service = await makeService({ queues: true });
  const company = makeCompany({
    name: 'Seeded Employer',
    domain: 'seeded-employer.example',
    careersUrl: 'https://jobs.lever.co/seeded-employer',
    atsProvider: 'LEVER',
    atsTenant: 'seeded-employer',
    seedSource: 'fixture-seed',
    seedRank: 1,
    sourceConfidence: 0.9,
  });
  await service.store.putCompany(company);

  service.scheduler.discovery.processTask = async (task) => {
    await service.discoveryQueue.resolve(task, { reason: 'fixture resolved' });
    return { ok: true, taskId: task.id };
  };
  const result = await service.scheduler.discoverySlice({ limit: 2 });
  assert.equal(result.seededCompanies, 1);
  assert.ok(result.leased >= 1, 'the newly seeded company lead becomes durable queue work');
});

test('DISCOVERY_GATE — 1,000-company seed scheduling rotates fairly instead of starving later companies', async () => {
  const service = await makeService({ queues: true });
  for (let i = 1; i <= 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await service.store.putCompany(makeCompany({
      name: `Fair Seed ${i}`,
      domain: `fair-seed-${i}.example`,
      careersUrl: `https://jobs.lever.co/fair-seed-${i}`,
      atsProvider: 'LEVER',
      atsTenant: `fair-seed-${i}`,
      seedSource: 'fixture-seed',
      seedRank: i,
    }));
  }

  service.scheduler.discovery.processTask = async (task) => {
    await service.discoveryQueue.resolve(task, { reason: 'fixture resolved' });
    return { ok: true, taskId: task.id };
  };

  await service.scheduler.discoverySlice({ limit: 2 });
  await service.scheduler.discoverySlice({ limit: 2 });
  await service.scheduler.discoverySlice({ limit: 2 });

  const all = await service.store.listCompanies({ limit: 10 });
  const seeded = all.filter((c) => c.seedSource === 'fixture-seed');
  assert.equal(seeded.length, 5);
  assert.ok(seeded.every((c) => Number(c.discoveryQueueCount || 0) >= 1),
    'every seeded company gets a durable discovery turn before early rows monopolize the queue');
});

test('INTEGRATION_GATE — admin canonical-job browse is fixed at 20 results per page', async () => {
  const service = await makeService({ queues: true });
  /* Seed canonical-looking jobs directly: this test is about browse/pagination,
     not ingestion normalization (covered elsewhere). */
  for (let i = 0; i < 45; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await service.store.putJob({
      id: `job_phase21_${i}`,
      schemaVersion: 1,
      title: `Platform Engineer ${i}`,
      normalizedTitle: 'platform engineer',
      titleFamilies: ['platform'],
      company: { name: `Company ${i}`, normalizedName: `company ${i}`, domain: `company-${i}.example` },
      locations: [{ raw: 'India' }],
      workplace: { type: 'UNKNOWN', remoteScope: 'UNKNOWN', evidence: null },
      employmentType: null,
      seniority: null,
      descriptionText: 'platform engineering',
      descriptionHtml: null,
      requirements: [],
      skills: [],
      compensation: null,
      sourcePublishedAt: null,
      firstSeenAt: new Date(Date.UTC(2026, 7, 14, 0, 0, i)).toISOString(),
      lastSeenAt: '2026-08-14T12:00:00.000Z',
      lastVerifiedAt: null,
      canonicalJobUrl: `https://company-${i}.example/jobs/${i}`,
      canonicalApplyUrl: `https://company-${i}.example/jobs/${i}/apply`,
      directApply: true,
      status: JOB_STATUS.NEW,
      freshness: null,
      sourceInstances: [],
      contentHash: `hash_${i}`,
      dedupeFingerprint: `fp_${i}`,
      searchText: `Platform Engineer ${i} Company ${i} India`,
      completeness: 0.8,
      needsVerification: false,
    });
  }

  const p1 = await service.browseJobs({ page: 1 });
  const p2 = await service.browseJobs({ page: 2 });
  const p3 = await service.browseJobs({ page: 3 });
  assert.deepEqual([p1.jobs.length, p2.jobs.length, p3.jobs.length], [20, 20, 5]);
  assert.equal(p1.totalPages, 3);
  assert.equal(p1.hasNext, true);
  assert.equal(p3.hasNext, false);
  assert.equal(p3.hasPrev, true);
});


test('INTEGRATION_GATE — company registry filters by type and reports exact available job counts', async () => {
  const store = new MemoryJobStore();
  const startup = makeCompany({ name: 'Growth Startup', domain: 'growth-startup.example', careersUrl: 'https://growth-startup.example/careers', companyType: 'STARTUP_SCALEUP', industry: 'SaaS', indiaRelevance: 'High', seedSource: 'fixture', seedRank: 1 });
  const enterprise = makeCompany({ name: 'Global Enterprise', domain: 'global-enterprise.example', careersUrl: 'https://global-enterprise.example/careers', companyType: 'MNC_ENTERPRISE', industry: 'Banking', seedSource: 'fixture', seedRank: 2 });
  await store.putCompany(startup); await store.putCompany(enterprise);
  for (const [i, status] of [JOB_STATUS.NEW, JOB_STATUS.ACTIVE, JOB_STATUS.LIKELY_ACTIVE, JOB_STATUS.REMOVED].entries()) {
    await store.putJob({ id: `company_filter_job_${i}`, title: `Platform Engineer ${i}`, companyId: startup.id, company: { name: startup.name, normalizedName: startup.normalizedName, domain: startup.domain }, status, firstSeenAt: `2026-08-15T00:00:0${i}.000Z`, sourceInstances: [], locations: [], directApply: true });
  }
  const filtered = await store.pageCompanies({ page: 1, pageSize: 20, companyType: 'STARTUP_SCALEUP', hasAvailableJobs: true });
  assert.equal(filtered.total, 1); assert.equal(filtered.docs[0].id, startup.id); assert.equal(filtered.docs[0].availableJobCount, 3); assert.equal(filtered.docs[0].newJobCount, 1); assert.equal(filtered.docs[0].activeJobCount, 1); assert.equal(filtered.docs[0].likelyActiveJobCount, 1);
});

test('INTEGRATION_GATE — admin company drill-down returns only available jobs and stays 20-per-page', async () => {
  const service = await makeService({ queues: true });
  const company = makeCompany({ name: 'Clickable Company', domain: 'clickable.example', careersUrl: 'https://clickable.example/careers', companyType: 'MNC_ENTERPRISE', seedSource: 'fixture', seedRank: 1 });
  await service.store.putCompany(company);
  for (let i = 0; i < 24; i += 1) {
    await service.store.putJob({ id: `company_drill_${i}`, title: `DevOps Engineer ${i}`, company: { name: company.name, normalizedName: company.normalizedName, domain: company.domain }, companyId: i % 2 === 0 ? company.id : null, status: i === 23 ? JOB_STATUS.REMOVED : (i % 3 === 0 ? JOB_STATUS.ACTIVE : JOB_STATUS.NEW), firstSeenAt: `2026-08-15T00:${String(i).padStart(2, '0')}:00.000Z`, sourceInstances: [], locations: [{ raw: 'India' }], directApply: true });
  }
  const p1 = await service.browseCompanyJobs(company.id, { page: 1 }); const p2 = await service.browseCompanyJobs(company.id, { page: 2 });
  assert.equal(p1.availableJobs, 23); assert.equal(p1.jobs.length, 20); assert.equal(p2.jobs.length, 3); assert.ok(p1.jobs.every((j) => j.status !== JOB_STATUS.REMOVED));
});

test('INTEGRATION_GATE — production config contains secret-protected cron consumers and Muse key wiring', () => {
  const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const paths = new Set((vercel.crons || []).map((c) => c.path));
  for (const path of [
    '/api/cron/job-discovery/bootstrap',
    '/api/cron/job-discovery/crawl',
    '/api/cron/job-discovery/discover',
    '/api/cron/job-discovery/verify',
  ]) assert.ok(paths.has(path), `missing cron ${path}`);

  const routes = fs.readFileSync(new URL('../server/routes/jobDiscoveryRoutes.js', import.meta.url), 'utf8');
  assert.match(routes, /CRON_SECRET/);
  assert.match(routes, /cronSecretMatches/);

  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /MUSE_API_KEY/);
  assert.match(server, /api_key/);
});

test('INTEGRATION_GATE — admin company catalog exposes search, pagination and one-click manual fetch', () => {
  const panel = fs.readFileSync(new URL('../web/src/views/AdminJobIngestPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /Company career-site registry/);
  assert.match(panel, /Search company, domain, industry or career URL/);
  assert.match(panel, /Seed \/ refresh 1,000/);
  assert.match(panel, /20 at a time/);
  assert.match(panel, /fetchCompany\(c\)/);
  assert.match(panel, /Fetching…/);
  assert.match(panel, /Startup & scale-up/);
  assert.match(panel, /MNC & enterprise/);
  assert.match(panel, /View jobs/);
  assert.match(panel, /companyJobs/);
});

test('INGEST_GATE — duplicate Mongoose index declarations stay removed', () => {
  const store = fs.readFileSync(new URL('../server/services/jobDiscovery/store.js', import.meta.url), 'utf8');
  assert.doesNotMatch(store, /fetchedAt:\s*\{[^}]*index:\s*true/s);
  assert.doesNotMatch(store, /startedAt:\s*\{[^}]*index:\s*true/s);
  assert.match(store, /rawSchema\.index\(\{\s*fetchedAt:\s*1\s*\}/s);
  assert.match(store, /ingestRunSchema\.index\(\{\s*startedAt:\s*-1\s*\}/s);
});


test('INTEGRATION_GATE — admin dashboard exposes exact currently-available canonical job count', async () => {
  const service = await makeService({ queues: true });
  const statuses = [
    JOB_STATUS.NEW,
    JOB_STATUS.ACTIVE,
    JOB_STATUS.LIKELY_ACTIVE,
    JOB_STATUS.STALE,
    JOB_STATUS.REMOVED,
  ];
  for (let i = 0; i < statuses.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await service.store.putJob({
      id: `inventory_${i}`,
      schemaVersion: 1,
      title: `Inventory Job ${i}`,
      normalizedTitle: 'inventory job',
      titleFamilies: ['software'],
      company: { name: 'Inventory Co', normalizedName: 'inventory co', domain: 'inventory.example' },
      locations: [{ raw: 'India' }],
      workplace: { type: 'UNKNOWN', remoteScope: 'UNKNOWN', evidence: null },
      employmentType: null,
      seniority: null,
      descriptionText: 'inventory fixture',
      descriptionHtml: null,
      requirements: [], skills: [], compensation: null,
      sourcePublishedAt: null,
      firstSeenAt: '2026-08-15T00:00:00.000Z',
      lastSeenAt: '2026-08-15T00:00:00.000Z',
      lastVerifiedAt: null,
      canonicalJobUrl: `https://inventory.example/jobs/${i}`,
      canonicalApplyUrl: `https://inventory.example/jobs/${i}/apply`,
      directApply: true,
      status: statuses[i], freshness: null, sourceInstances: [],
      contentHash: `inventory_hash_${i}`, dedupeFingerprint: `inventory_fp_${i}`,
      searchText: `Inventory Job ${i}`, completeness: 0.9, needsVerification: false,
    });
  }
  const stats = await service.stats();
  assert.equal(stats.inventory.currentlyAvailable, 3, 'NEW + ACTIVE + LIKELY_ACTIVE only');
  assert.equal(stats.inventory.canonicalTotal, 5);
  assert.equal(stats.inventory.stale, 1);
  assert.equal(stats.inventory.removed, 1);

  const panel = fs.readFileSync(new URL('../web/src/views/AdminJobIngestPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /Jobs currently available/);
  assert.match(panel, /AVAILABLE NOW/);
  assert.match(panel, /exact database count/i);
});

test('INTEGRATION_GATE — Job Discovery is a dedicated admin navigation screen', () => {
  const app = fs.readFileSync(new URL('../web/src/App.jsx', import.meta.url), 'utf8');
  const shell = fs.readFileSync(new URL('../web/src/components/app/Shell.jsx', import.meta.url), 'utf8');
  const users = fs.readFileSync(new URL('../web/src/views/AdminUsers.jsx', import.meta.url), 'utf8');
  assert.match(app, /jobdiscoveryadmin:\s*AdminJobDiscovery/);
  assert.match(shell, /id:\s*'jobdiscoveryadmin'.*label:\s*'Job Discovery'/s);
  assert.doesNotMatch(users, /<AdminJobIngestPanel\s*\/>/);
});
