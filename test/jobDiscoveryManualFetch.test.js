import test from 'node:test';
import assert from 'node:assert/strict';
import { makeService, makeSource } from './fixtures/jobDiscovery/harness.js';
import { greenhouseBoard as GREENHOUSE_BOARD } from './fixtures/jobDiscovery/providers.js';
import { PROVIDER, SOURCE_CLASS, SOURCE_TYPE, ACCESS_POLICY } from '../server/services/jobDiscovery/schema.js';

const NOW = () => new Date('2026-08-14T12:00:00.000Z');

test('INTEGRATION_GATE — admin manual fetch — due batch is bounded and writes canonical jobs', async () => {
  const service = await makeService({
    routes: [[/boards-api\.greenhouse\.io/, { body: GREENHOUSE_BOARD }]],
    now: NOW,
  });
  await service.registerSource(makeSource({
    provider: PROVIDER.GREENHOUSE,
    sourceType: SOURCE_TYPE.ATS,
    sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
    tenant: 'acme', companyName: 'Acme', companyDomain: 'acme.com',
    accessPolicy: ACCESS_POLICY.ALLOW,
  }));

  const r = await service.manualFetch({ sourceLimit: 999, maxPagesPerSource: 999 });
  assert.equal(r.requested.sourceLimit, 3, 'operator source limit is hard-capped');
  assert.equal(r.requested.maxPagesPerSource, 3, 'page count is hard-capped');
  assert.ok(r.crawl.crawled.length <= 3);
  assert.ok(r.after.jobs > r.before.jobs);
  assert.ok(r.delta.jobs > 0);
});

test('INTEGRATION_GATE — admin manual fetch — selected source uses normal truth/provenance ingest path', async () => {
  const service = await makeService({
    routes: [[/boards-api\.greenhouse\.io/, { body: GREENHOUSE_BOARD }]],
    now: NOW,
  });
  const { source } = await service.registerSource(makeSource({
    provider: PROVIDER.GREENHOUSE,
    sourceType: SOURCE_TYPE.ATS,
    sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
    tenant: 'acme', companyName: 'Acme', companyDomain: 'acme.com',
    accessPolicy: ACCESS_POLICY.ALLOW,
  }));

  const r = await service.manualFetch({ sourceId: source.id, maxPagesPerSource: 1 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.crawl.mode, 'source');
  assert.ok(r.crawl.crawled[0].fetched > 0);
  const jobs = await service.store.listJobs({ sourceId: source.id, limit: 10 });
  assert.ok(jobs.length > 0);
  assert.ok(jobs.every((j) => j.sourceInstances?.some((s) => s.sourceId === source.id)));
});

test('SECURITY_GATE — admin manual fetch — access policy cannot be overridden', async () => {
  const service = await makeService({ routes: [], now: NOW });
  const { source } = await service.registerSource(makeSource({
    provider: PROVIDER.GENERIC,
    sourceType: SOURCE_TYPE.CAREER_SITE,
    sourceClass: SOURCE_CLASS.ORIGINAL_CAREER_SITE,
    tenant: 'blocked.example', companyName: 'Blocked', companyDomain: 'blocked.example',
    careersUrl: 'https://blocked.example/careers',
    accessPolicy: ACCESS_POLICY.REVIEW,
  }));
  const r = await service.manualFetch({ sourceId: source.id });
  assert.equal(r.ok, false);
  assert.equal(r.crawl.error, 'source_not_allowed');
  assert.equal(r.after.jobs, 0);
});

test('INTEGRATION_GATE — admin manual fetch — direct public ATS URL can be registered and fetched', async () => {
  const service = await makeService({
    routes: [[/boards-api\.greenhouse\.io/, { body: GREENHOUSE_BOARD }]],
    now: NOW,
  });
  const r = await service.manualFetch({
    sourceUrl: 'https://boards.greenhouse.io/acme',
    companyName: 'Acme',
    maxPagesPerSource: 1,
  });
  assert.equal(r.registered.ok, true, JSON.stringify(r));
  assert.equal(r.registered.source.provider, PROVIDER.GREENHOUSE);
  assert.equal(r.registered.source.accessPolicy, ACCESS_POLICY.ALLOW);
  assert.ok(r.after.jobs > 0);
});
