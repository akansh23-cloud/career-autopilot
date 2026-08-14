import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { MemoryJobStore, createStore } from '../server/services/jobDiscovery/store.js';
import { StoreBackedSearchIndex } from '../server/services/jobDiscovery/searchIndex.js';
import { SourceRegistry, makeSource } from '../server/services/jobDiscovery/sourceRegistry.js';
import { makeJobDocument, JOB_STATUS, ACCESS_POLICY, SOURCE_CLASS, SOURCE_TYPE, PROVIDER } from '../server/services/jobDiscovery/schema.js';
import { finalizeJobDocument } from '../server/services/jobDiscovery/schema.js';

const ROOT = path.resolve(import.meta.dirname, '..');

test('INTEGRATION_GATE PHASE11 — frozen Resume OS services and canonical renderer are preserved', () => {
  for (const rel of [
    'server/services/resumeOs/resumeOsApplicationService.js',
    'server/services/resumeOs/resumeQualityEvaluator.js',
    'server/services/resumeOs/weaknessDetector.js',
    'server/services/resumeRender/resumeRenderService.js',
    'server/services/resumeRender/vectorPdfRenderProvider.js',
    'server/services/resumeRender/chromiumRenderProvider.js',
  ]) assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} must remain present`);

  const editor = fs.readFileSync(path.join(ROOT, 'web/src/views/Editor.jsx'), 'utf8');
  assert.match(editor, /ResumeOsApi\.tailorForJob\(/);
  assert.doesNotMatch(editor, /Rewrite and tailor the resume below/);

  const jobs = fs.readFileSync(path.join(ROOT, 'web/src/views/Jobs.jsx'), 'utf8');
  assert.match(jobs, /Applications\.generate\(/);
  assert.doesNotMatch(jobs, /"tailoredResume"\s*:\s*"plain text resume"/);
});

test('INTEGRATION_GATE PHASE11 — server and worker select the same Mongo persistence when configured', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const worker = fs.readFileSync(path.join(ROOT, 'scripts/job-discovery-worker.mjs'), 'utf8');
  assert.match(server, /registerJobDiscoveryRoutes\(app,[\s\S]*mongoose,[\s\S]*connect:\s*db\.connectDB/);
  assert.match(server, /backend:\s*process\.env\.MONGODB_URI\s*\?\s*'mongo'/);
  assert.match(worker, /backend:\s*process\.env\.MONGODB_URI\s*\?\s*'mongo'/);
  assert.match(worker, /refusing to split worker\/API persistence/);
});



test('INTEGRATION_GATE PHASE11 — configured Mongo cannot silently fall back to a local file index', async () => {
  await assert.rejects(
    () => createStore({ mongoUri: 'mongodb://example.invalid/jobs', mongoose: null, dataDir: '.data/should-not-be-used' }),
    /refusing local-store fallback/,
  );
});


test('INTEGRATION_GATE PHASE11 — Mongo schemas persist source registry health and typed discovery scheduling fields', () => {
  const storeSrc = fs.readFileSync(path.join(ROOT, 'server/services/jobDiscovery/store.js'), 'utf8');
  assert.match(storeSrc, /sourceDiscovery:\s*\{[\s\S]*?nextAttemptAt:\s*\{\s*type:\s*Date/);
  for (const field of ['companyWebsite', 'region', 'lastErrorAt', 'lastErrorClass', 'lastErrorMessage', 'queries', 'discoveredFrom']) {
    assert.ok(storeSrc.includes(`${field}:`), `${field} must be persisted by the Mongo source schema`);
  }
});


test('INTEGRATION_GATE PHASE11 — Mongo upserts never attempt to $set immutable _id', () => {
  const storeSrc = fs.readFileSync(path.join(ROOT, 'server/services/jobDiscovery/store.js'), 'utf8');
  assert.match(storeSrc, /const \{ _id, \.\.\.doc \} = this\.toDoc\(job\);/);
  assert.match(storeSrc, /const \{ id, _id, \.\.\.doc \} = source;/);
  assert.doesNotMatch(storeSrc, /\$set:\s*\{\s*\.\.\.source,\s*_id:/);
});
test('INTEGRATION_GATE PHASE11 — product Jobs view has no synchronous legacy provider fallback', () => {
  const src = fs.readFileSync(path.join(ROOT, 'web/src/views/Jobs.jsx'), 'utf8');
  assert.match(src, /Jobs\.discoverySearch\(/);
  assert.doesNotMatch(src, /Jobs\.search\(/);
  assert.match(src, /Default: preserve server rank exactly/);
});

test('SEARCH_GATE PHASE11 — search uses candidate retrieval interface, not listJobs first-N scan', async () => {
  const job = finalizeJobDocument(makeJobDocument({
    id: 'cj_indexed', title: 'DevOps Engineer', normalizedTitle: 'devops engineer', titleFamily: 'DEVOPS_ENGINEER', titleFamilies: ['DEVOPS_ENGINEER'],
    company: { name: 'Acme', normalizedName: 'acme', domain: 'acme.com' },
    description: { text: 'Build CI/CD systems' }, status: JOB_STATUS.ACTIVE,
    sourceInstances: [{ sourceClass: SOURCE_CLASS.ORIGINAL_ATS, sourceType: SOURCE_TYPE.ATS, provider: PROVIDER.GREENHOUSE, sourceJobId: '1', jobUrl: 'https://example.com/1', applyUrl: 'https://example.com/1/apply' }],
  }));
  let candidatesCalled = 0;
  const store = {
    searchCandidates: async () => { candidatesCalled += 1; return [job]; },
    listJobs: async () => { throw new Error('collection scan path must not be used'); },
    stats: async () => ({ backend: 'test' }),
    putJob: async (j) => j,
    getJob: async () => job,
  };
  const index = new StoreBackedSearchIndex({ store, cache: false });
  const out = await index.search({ q: 'DevOps Engineer', limit: 10 });
  assert.equal(candidatesCalled, 1);
  assert.equal(out.results[0].job.id, 'cj_indexed');
});



test('SEARCH_GATE PHASE11 — a relevant role beyond the former 5,000-job boundary remains discoverable', async () => {
  const store = await new MemoryJobStore().init();
  for (let i = 0; i < 5200; i++) {
    const wanted = i === 5199;
    await store.putJob(finalizeJobDocument(makeJobDocument({
      id: `scale_${i}`,
      title: wanted ? 'DevOps Engineer' : `Accountant ${i}`,
      normalizedTitle: wanted ? 'devops engineer' : `accountant ${i}`,
      titleFamily: wanted ? 'DEVOPS_ENGINEER' : null,
      titleFamilies: wanted ? ['DEVOPS_ENGINEER'] : [],
      company: { name: `Scale Co ${i}`, normalizedName: `scale co ${i}`, domain: `scale${i}.example` },
      description: { text: wanted ? 'Build CI/CD platforms' : 'Finance and accounting work' },
      status: JOB_STATUS.ACTIVE,
      sourceInstances: [{ sourceClass: SOURCE_CLASS.ORIGINAL_ATS, sourceType: SOURCE_TYPE.ATS, provider: PROVIDER.GREENHOUSE, sourceJobId: String(i) }],
    })));
  }
  const index = new StoreBackedSearchIndex({ store, cache: false });
  const out = await index.search({ q: 'DevOps Engineer', limit: 10, candidateLimit: 250 });
  assert.equal(out.results[0]?.job.id, 'scale_5199');
  assert.ok(out.candidatesRetrieved < 5200, 'ranking receives a bounded candidate set, not the whole collection');
});

test('SEARCH_GATE PHASE11 — structured location selection happens before candidate limiting', async () => {
  const store = await new MemoryJobStore().init();
  for (let i = 0; i < 1000; i++) {
    const pune = i === 999;
    await store.putJob(finalizeJobDocument(makeJobDocument({
      id: `loc_${i}`,
      title: 'Software Engineer', normalizedTitle: 'software engineer',
      company: { name: `Location Co ${i}`, normalizedName: `location co ${i}`, domain: `loc${i}.example` },
      locations: [{ raw: pune ? 'Pune, India' : 'New York, United States', city: pune ? 'Pune' : 'New York', countryCode: pune ? 'IN' : 'US' }],
      workplace: { type: 'ONSITE', remoteScope: 'ONSITE', remoteRegions: [] },
      status: JOB_STATUS.ACTIVE,
      sourceInstances: [{ sourceClass: SOURCE_CLASS.ORIGINAL_ATS, sourceType: SOURCE_TYPE.ATS, provider: PROVIDER.GREENHOUSE, sourceJobId: String(i) }],
    })));
  }
  const index = new StoreBackedSearchIndex({ store, cache: false });
  const out = await index.search({ location: 'Pune, India', limit: 10, candidateLimit: 250 });
  assert.equal(out.results[0]?.job.id, 'loc_999');
});
test('SECURITY_GATE PHASE11 — REVIEW is not executable crawl permission', async () => {
  const store = await new MemoryJobStore().init();
  const registry = new SourceRegistry({ store, now: () => new Date('2026-08-14T12:00:00Z') });
  await registry.register(makeSource({
    provider: PROVIDER.GENERIC, tenant: 'review.example.com', careersUrl: 'https://review.example.com/jobs',
    sourceClass: SOURCE_CLASS.ORIGINAL_CAREER_SITE, sourceType: SOURCE_TYPE.CAREER_SITE,
    accessPolicy: ACCESS_POLICY.REVIEW,
  }));
  await registry.register(makeSource({
    provider: PROVIDER.GREENHOUSE, tenant: 'allowed', careersUrl: 'https://boards.greenhouse.io/allowed',
    sourceClass: SOURCE_CLASS.ORIGINAL_ATS, sourceType: SOURCE_TYPE.ATS,
    accessPolicy: ACCESS_POLICY.ALLOW,
  }));
  const due = await registry.due({ limit: 10 });
  assert.equal(due.length, 1);
  assert.equal(due[0].accessPolicy, ACCESS_POLICY.ALLOW);
});

test('SOURCE_GATE PHASE11 — durable source-discovery queue can reach jobs beyond an arbitrary prefix', async () => {
  const store = await new MemoryJobStore().init();
  const now = '2026-08-14T12:00:00.000Z';
  for (let i = 0; i < 700; i++) {
    await store.putJob(finalizeJobDocument(makeJobDocument({
      id: `cj_${i}`, title: `Engineer ${i}`, normalizedTitle: `engineer ${i}`,
      company: { name: `Company ${i}`, normalizedName: `company ${i}`, domain: `company${i}.example` },
      status: JOB_STATUS.ACTIVE, now,
      sourceInstances: [{ sourceClass: SOURCE_CLASS.AGGREGATOR, sourceType: SOURCE_TYPE.AGGREGATOR, provider: PROVIDER.API, sourceJobId: String(i) }],
      sourceDiscovery: { nextAttemptAt: i === 699 ? '2026-08-14T11:00:00.000Z' : '2026-08-15T12:00:00.000Z' },
    })));
    // makeJobDocument intentionally ignores operational fields; persist them explicitly.
    const j = await store.getJob(`cj_${i}`);
    await store.putJob({ ...j, sourceDiscovery: { nextAttemptAt: i === 699 ? '2026-08-14T11:00:00.000Z' : '2026-08-15T12:00:00.000Z' } });
  }
  const due = await store.listDiscoveryCandidates({ at: now, limit: 5 });
  assert.deepEqual(due.map((j) => j.id), ['cj_699']);
});
