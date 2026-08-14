/* ============================================================
   JOB DISCOVERY OS — NORMALIZATION + ADAPTER TESTS
   ------------------------------------------------------------
   Covers INGEST_GATE and SOURCE_GATE. No network access.
   ============================================================ */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeJobDocument, completenessFlags, computeCompleteness, recordProvenance,
  SOURCE_CLASS, WORKPLACE_TYPE, REMOTE_SCOPE, EMPLOYMENT_TYPE, SENIORITY, PROVIDER,
} from '../server/services/jobDiscovery/schema.js';
import {
  parseSourceDate, normalizeUrl, registrableDomain, minhashSignature,
  signatureSimilarity, jaccard, shingles, stripHtml,
} from '../server/services/jobDiscovery/normalize/text.js';
import { normalizeCompany, normalizeTitle, sameCompany, normalizeEmploymentType } from '../server/services/jobDiscovery/normalize/entity.js';
import { resolveFamilies, expandQuery, RELATION_WEIGHT } from '../server/services/jobDiscovery/normalize/taxonomy.js';
import { parseLocation, classifyWorkplace, locationCompatibility } from '../server/services/jobDiscovery/normalize/location.js';
import { parseCompensationText, normalizeCompensation, salaryCompatibility } from '../server/services/jobDiscovery/normalize/compensation.js';
import { toCanonicalJob } from '../server/services/jobDiscovery/normalize/index.js';
import { detectAts, extractAtsLinks, boardUrlFor } from '../server/services/jobDiscovery/atsDetect.js';
import { findJobPostings, jobPostingToInput, extractEmbeddedJson, findJobArrays, extractJobLinks, extractSitemapUrls } from '../server/services/jobDiscovery/crawler/extract.js';
import { assertNormalizedInput } from '../server/services/jobDiscovery/adapters/base.js';
import GreenhouseAdapter from '../server/services/jobDiscovery/adapters/greenhouse.js';
import LeverAdapter from '../server/services/jobDiscovery/adapters/lever.js';
import AshbyAdapter from '../server/services/jobDiscovery/adapters/ashby.js';
import WorkableAdapter from '../server/services/jobDiscovery/adapters/workable.js';
import SmartRecruitersAdapter from '../server/services/jobDiscovery/adapters/smartrecruiters.js';
import AggregatorAdapter from '../server/services/jobDiscovery/adapters/aggregator.js';
import GenericCareerSiteAdapter from '../server/services/jobDiscovery/adapters/genericCareerSite.js';

import fx from './fixtures/jobDiscovery/providers.js';
import { makeHttp, makeService, silentLogger } from './fixtures/jobDiscovery/harness.js';

const NOW = '2026-08-14T12:00:00.000Z';

const ghSource = {
  id: 'src_gh', provider: PROVIDER.GREENHOUSE, sourceType: 'ATS',
  sourceClass: SOURCE_CLASS.ORIGINAL_ATS, tenant: 'northwindlabs',
  companyName: 'Northwind Labs', companyDomain: 'northwindlabs.example',
};
const leverSource = {
  id: 'src_lv', provider: PROVIDER.LEVER, sourceType: 'ATS',
  sourceClass: SOURCE_CLASS.ORIGINAL_ATS, tenant: 'harborstack', companyName: 'Harborstack',
};
const ashbySource = {
  id: 'src_ab', provider: PROVIDER.ASHBY, sourceType: 'ATS',
  sourceClass: SOURCE_CLASS.ORIGINAL_ATS, tenant: 'vellumsystems', companyName: 'Vellum Systems',
};
const workableSource = {
  id: 'src_wk', provider: PROVIDER.WORKABLE, sourceType: 'ATS',
  sourceClass: SOURCE_CLASS.ORIGINAL_ATS, tenant: 'corvidanalytics', companyName: 'Corvid Analytics',
};
const srSource = {
  id: 'src_sr', provider: PROVIDER.SMARTRECRUITERS, sourceType: 'ATS',
  sourceClass: SOURCE_CLASS.ORIGINAL_ATS, tenant: 'FernwoodTech', companyName: 'Fernwood Tech',
};

/* ============================ dates ============================ */

test('parseSourceDate never fabricates a date', () => {
  assert.equal(parseSourceDate(null), null);
  assert.equal(parseSourceDate(''), null);
  assert.equal(parseSourceDate('not a date'), null);
  assert.equal(parseSourceDate(undefined), null);
  assert.equal(parseSourceDate('1970-01-01'), null, 'pre-1995 rejected as junk');
  assert.equal(parseSourceDate('2026-08-12'), '2026-08-12T00:00:00.000Z');
  assert.equal(parseSourceDate(1786406400000), '2026-08-11T00:00:00.000Z');
  assert.equal(parseSourceDate(1786406400), '2026-08-11T00:00:00.000Z', 'seconds accepted');
});

/* ============================ urls ============================ */

test('normalizeUrl strips tracking params and canonicalises', () => {
  assert.equal(
    normalizeUrl('https://Boards.Greenhouse.io/acme/jobs/1?utm_source=x&gh_src=y&foo=1#top'),
    'https://boards.greenhouse.io/acme/jobs/1?foo=1',
  );
  assert.equal(normalizeUrl('ftp://example.com/x'), null);
  assert.equal(normalizeUrl('nonsense'), null);
});

test('registrableDomain handles two-part TLDs', () => {
  assert.equal(registrableDomain('careers.acme.co.in'), 'acme.co.in');
  assert.equal(registrableDomain('https://www.acme.com/x'), 'acme.com');
  assert.equal(registrableDomain('jobs.sub.acme.io'), 'acme.io');
});

/* ============================ taxonomy ============================ */

test('taxonomy resolves aliases and expands with DISTINCT relation weights', () => {
  assert.equal(resolveFamilies('DevOps Engineer').primary, 'DEVOPS_ENGINEER');
  assert.equal(resolveFamilies('Senior DevOps Engineer').primary, 'DEVOPS_ENGINEER');
  assert.equal(resolveFamilies('Build & Release Engineer').primary, 'DEVOPS_ENGINEER');
  assert.equal(resolveFamilies('Spring Boot Developer').primary, 'JAVA_ENGINEER');

  const exp = expandQuery('DevOps Engineer');
  assert.equal(exp.get('DEVOPS_ENGINEER').weight, RELATION_WEIGHT.EXACT);
  assert.equal(exp.get('SRE').relation, 'STRONG', 'SRE is strongly related, NOT an alias');
  assert.ok(exp.get('SRE').weight < RELATION_WEIGHT.EXACT);
  assert.ok(exp.get('SRE').weight > (exp.get('BACKEND_ENGINEER')?.weight ?? 0));
});

test('Java Backend expands to the families the spec names', () => {
  const exp = expandQuery('Java Backend');
  const ids = [...exp.keys()];
  for (const want of ['JAVA_ENGINEER', 'BACKEND_ENGINEER', 'SOFTWARE_ENGINEER']) {
    assert.ok(ids.includes(want), `expected ${want} in expansion, got ${ids.join(', ')}`);
  }
});

/* ============================ titles ============================ */

test('normalizeTitle keeps the raw title and detects seniority', () => {
  const t = normalizeTitle('Senior Platform Engineer (m/f/d) — Remote');
  assert.equal(t.title, 'Senior Platform Engineer (m/f/d) — Remote');
  assert.equal(t.titleFamily, 'PLATFORM_ENGINEER');
  assert.equal(t.seniority, SENIORITY.SENIOR);
  assert.ok(!t.normalizedTitle.includes('senior'));
});

test('normalizeEmploymentType never guesses', () => {
  assert.equal(normalizeEmploymentType(null), EMPLOYMENT_TYPE.UNKNOWN);
  assert.equal(normalizeEmploymentType(''), EMPLOYMENT_TYPE.UNKNOWN);
  assert.equal(normalizeEmploymentType('FULL_TIME'), EMPLOYMENT_TYPE.FULL_TIME);
  assert.equal(normalizeEmploymentType('Full-time'), EMPLOYMENT_TYPE.FULL_TIME);
  assert.equal(normalizeEmploymentType('Contract'), EMPLOYMENT_TYPE.CONTRACT);
});

test('company normalization drops legal suffixes without losing the display name', () => {
  const c = normalizeCompany('Northwind Labs Private Limited');
  assert.equal(c.name, 'Northwind Labs Private Limited');
  assert.equal(c.normalizedName, 'northwind');
  assert.ok(sameCompany('Acme Technologies Pvt Ltd', 'Acme'));
  assert.ok(!sameCompany('Acme', 'Beta Corp'));
});

/* ============================ locations ============================ */

test('parseLocation structures Indian and US cities', () => {
  const pune = parseLocation('Pune, India');
  assert.equal(pune.city, 'Pune');
  assert.equal(pune.countryCode, 'IN');
  assert.equal(pune.region, 'Maharashtra');

  const ny = parseLocation('New York, NY');
  assert.equal(ny.countryCode, 'US');
});

test('remote scope is evidence-based and never widened', () => {
  const usOnly = classifyWorkplace({ locationsRaw: ['Remote - US'], description: 'Open to candidates in the United States only.' });
  assert.equal(usOnly.type, WORKPLACE_TYPE.REMOTE);
  assert.equal(usOnly.remoteScope, REMOTE_SCOPE.REMOTE_COUNTRY);
  assert.deepEqual(usOnly.remoteRegions, ['US']);

  const worldwide = classifyWorkplace({ locationsRaw: ['Remote — Worldwide'] });
  assert.equal(worldwide.remoteScope, REMOTE_SCOPE.REMOTE_WORLDWIDE);

  const unscoped = classifyWorkplace({ locationsRaw: ['Remote'] });
  assert.equal(unscoped.remoteScope, REMOTE_SCOPE.UNKNOWN, 'unscoped remote is UNKNOWN, not worldwide');

  const hybrid = classifyWorkplace({ locationsRaw: ['Pune, India'], workplaceHint: 'hybrid' });
  assert.equal(hybrid.type, WORKPLACE_TYPE.HYBRID);

  const unknown = classifyWorkplace({ locationsRaw: [] });
  assert.equal(unknown.type, WORKPLACE_TYPE.UNKNOWN);
});

test('§57 — an India remote search must not accept a US-only remote role', () => {
  const usJob = makeJobDocument({
    workplace: { type: 'REMOTE', remoteScope: REMOTE_SCOPE.REMOTE_COUNTRY, remoteRegions: ['US'] },
    locations: [parseLocation('Remote - US')],
  });
  const r = locationCompatibility(usJob, 'Remote India');
  assert.equal(r.compatible, false);

  const inJob = makeJobDocument({
    workplace: { type: 'REMOTE', remoteScope: REMOTE_SCOPE.REMOTE_COUNTRY, remoteRegions: ['IN'] },
    locations: [parseLocation('Remote - India')],
  });
  assert.equal(locationCompatibility(inJob, 'Remote India').compatible, true);

  const wwJob = makeJobDocument({
    workplace: { type: 'REMOTE', remoteScope: REMOTE_SCOPE.REMOTE_WORLDWIDE, remoteRegions: ['ANYWHERE'] },
  });
  assert.equal(locationCompatibility(wwJob, 'Remote India').compatible, true);

  const euJob = makeJobDocument({
    workplace: { type: 'REMOTE', remoteScope: REMOTE_SCOPE.REMOTE_REGION, remoteRegions: ['EUROPE', 'DE', 'FR'] },
  });
  assert.equal(locationCompatibility(euJob, 'Remote India').compatible, false);

  const puneOnsite = makeJobDocument({
    workplace: { type: 'ONSITE', remoteScope: REMOTE_SCOPE.ONSITE },
    locations: [parseLocation('Pune, India')],
  });
  assert.equal(locationCompatibility(puneOnsite, 'Pune').compatible, true);
  assert.equal(locationCompatibility(puneOnsite, 'Remote').compatible, false);
});

/* ============================ salary ============================ */

test('compensation parses only explicit values, including Indian magnitudes', () => {
  const lpa = parseCompensationText('₹18L – ₹28L per year');
  assert.equal(lpa.min, 1800000);
  assert.equal(lpa.max, 2800000);
  assert.equal(lpa.currency, 'INR');
  assert.equal(lpa.period, 'YEAR');
  assert.equal(lpa.raw, '₹18L – ₹28L per year');

  const none = parseCompensationText('Competitive salary and equity');
  assert.equal(none.min, null);
  assert.equal(none.max, null);
  assert.equal(none.raw, 'Competitive salary and equity', 'raw text retained even when unparseable');

  const empty = normalizeCompensation(null);
  assert.equal(empty.min, null);
  assert.equal(empty.currency, null);

  /* A bare year must not be read as money. */
  assert.equal(parseCompensationText('Founded in 2019').min, null);
});

test('unknown salary is not excluded by a salary filter', () => {
  const job = makeJobDocument({ compensation: { min: null, max: null, currency: null, period: null, raw: null } });
  const r = salaryCompatibility(job, { salaryMin: 2000000 });
  assert.equal(r.compatible, true);
  assert.equal(r.unknown, true);
});

/* ============================ ATS detection ============================ */

test('ATS fingerprinting extracts tenants and separates DETECTED from SUPPORTED', () => {
  const gh = detectAts('https://boards.greenhouse.io/northwindlabs');
  assert.equal(gh.provider, PROVIDER.GREENHOUSE);
  assert.equal(gh.tenant, 'northwindlabs');
  assert.equal(gh.supported, true);

  const wd = detectAts('https://acme.wd3.myworkdayjobs.com/en-US/External');
  assert.equal(wd.provider, PROVIDER.WORKDAY);
  assert.equal(wd.detected, true);
  assert.equal(wd.supported, false, 'Workday is detected but has no connector in this build');

  const embedded = detectAts('https://northwindlabs.example/careers', fx.greenhouseEmbeddedPage);
  assert.equal(embedded.provider, PROVIDER.GREENHOUSE);
  assert.equal(embedded.tenant, 'northwindlabs');

  assert.equal(boardUrlFor(PROVIDER.ASHBY, 'vellumsystems'), 'https://jobs.ashbyhq.com/vellumsystems');
  assert.equal(boardUrlFor(PROVIDER.LEVER, 'harborstack', { region: 'eu' }), 'https://jobs.eu.lever.co/harborstack');

  const links = extractAtsLinks(fx.greenhouseEmbeddedPage, 'https://northwindlabs.example/careers');
  assert.equal(links[0].provider, PROVIDER.GREENHOUSE);
  assert.equal(links[0].tenant, 'northwindlabs');
});

/* ============================ extraction ============================ */

test('JSON-LD extraction maps only stated fields', () => {
  const nodes = findJobPostings(fx.jsonLdCareerPage);
  assert.equal(nodes.length, 1);
  const input = jobPostingToInput(nodes[0], { pageUrl: 'https://careers.aldermanfoods.example/jobs/support-engineer-1042' });
  assert.equal(input.title, 'Remote Support Engineer');
  assert.equal(input.requisitionId, 'AF-1042');
  assert.equal(input.sourcePublishedAt, '2026-08-12');
  assert.deepEqual(input.applicantRegions, ['India']);
  assert.equal(input.explicitRemote, true);
  assert.equal(input.compensationStructured.currency, 'INR');
});

test('embedded __NEXT_DATA__ job arrays are found', () => {
  const blocks = extractEmbeddedJson(fx.nextDataCareerPage);
  assert.ok(blocks.length >= 1);
  const arrays = findJobArrays(blocks[0].data);
  assert.ok(arrays.length >= 1);
  assert.equal(arrays[0].jobs.length, 2);
});

test('HTML job links and sitemap URLs are extracted and filtered', () => {
  const links = extractJobLinks(fx.plainHtmlCareerPage, 'https://thornburyretail.example/careers');
  assert.equal(links.length, 2, 'the /about link is not a job link');
  const urls = extractSitemapUrls(fx.sitemapXml);
  assert.equal(urls.length, 3);
});

/* ============================ adapters ============================ */

test('SOURCE_GATE — Greenhouse adapter normalizes to the canonical contract', async () => {
  const http = makeHttp({ routes: [[/boards-api\.greenhouse\.io/, { body: fx.greenhouseBoard }]] });
  const adapter = new GreenhouseAdapter({ http, logger: silentLogger() });
  const batch = await adapter.fetchJobs(ghSource, null, { http });

  assert.equal(batch.items.length, 3);
  assert.equal(batch.authoritative, true, 'a complete board makes absence meaningful');

  const input = adapter.normalize(batch.items[0], ghSource);
  assertNormalizedInput(input, { adapter: 'greenhouse' });
  assert.equal(input.title, 'Senior Platform Engineer');
  assert.equal(input.requisitionId, 'REQ-8841');
  assert.equal(input.sourcePublishedAt, '2026-08-11T10:00:00-04:00');

  /* updated_at must NOT be promoted to a publication date. */
  const undated = adapter.normalize(batch.items[2], ghSource);
  assert.equal(undated.sourcePublishedAt, null);

  const job = toCanonicalJob(undated, ghSource, { now: NOW });
  assert.equal(job.sourcePublishedAt, null);
  assert.equal(job.firstSeenAt, NOW);
});

test('SOURCE_GATE — Lever adapter handles pagination, EU endpoints and scope', async () => {
  const http = makeHttp({ routes: [[/api\.lever\.co/, { body: fx.leverPostings }]] });
  const adapter = new LeverAdapter({ http, logger: silentLogger() });
  const batch = await adapter.fetchJobs(leverSource, null, { http });
  assert.equal(batch.items.length, 2);
  assert.equal(batch.authoritative, true, 'short page means the board was fully walked');

  const input = adapter.normalize(batch.items[0], leverSource);
  assertNormalizedInput(input, { adapter: 'lever' });
  assert.equal(input.title, 'Backend Engineer, Payments');
  assert.equal(input.applyUrl, 'https://jobs.lever.co/harborstack/a7f3c9d1-2b44-4e0a-9c11-6f2d8e5b7a31/apply');
  assert.equal(input.compensationStructured.currency, 'INR');

  const job = toCanonicalJob(input, leverSource, { now: NOW });
  assert.equal(job.workplace.type, WORKPLACE_TYPE.HYBRID);
  assert.equal(job.compensation.min, 2500000);

  const sre = toCanonicalJob(adapter.normalize(batch.items[1], leverSource), leverSource, { now: NOW });
  assert.equal(sre.workplace.remoteScope, REMOTE_SCOPE.REMOTE_COUNTRY);
  assert.deepEqual(sre.workplace.remoteRegions, ['US']);

  assert.equal(adapter.endpointFor({ region: 'eu' }).base, 'https://api.eu.lever.co/v0/postings');
});

test('SOURCE_GATE — Ashby adapter ingests listed jobs only', async () => {
  const http = makeHttp({ routes: [[/api\.ashbyhq\.com/, { body: fx.ashbyBoard }]] });
  const adapter = new AshbyAdapter({ http, logger: silentLogger() });
  const batch = await adapter.fetchJobs(ashbySource, null, { http });
  assert.equal(batch.items.length, 2, 'isListed:false is excluded');

  const input = adapter.normalize(batch.items[0], ashbySource);
  assertNormalizedInput(input, { adapter: 'ashby' });
  assert.equal(input.explicitRemote, true);
  assert.equal(input.compensationStructured.minValue, 1800000);

  const job = toCanonicalJob(input, ashbySource, { now: NOW });
  assert.equal(job.titleFamily, 'DEVOPS_ENGINEER');
  assert.equal(job.compensation.currency, 'INR');
  assert.equal(job.workplace.remoteScope, REMOTE_SCOPE.REMOTE_COUNTRY);
});

test('SOURCE_GATE — Workable adapter uses the documented public account payload', async () => {
  const http = makeHttp({ routes: [[/www\.workable\.com\/api\/accounts\//, { body: fx.workableAccount }]] });
  const adapter = new WorkableAdapter({ http, logger: silentLogger() });
  const batch = await adapter.fetchJobs(workableSource, null, { http });
  assert.equal(batch.items.length, 2);

  const input = adapter.normalize(batch.items[0], workableSource);
  assertNormalizedInput(input, { adapter: 'workable' });
  assert.equal(input.sourceJobId, 'A1B2C3D4E5');
  assert.equal(input.requisitionId, 'CA-DE-2026-14');
  assert.equal(input.explicitRemote, true);
  assert.equal(input.applyUrl, 'https://apply.workable.com/corvidanalytics/j/A1B2C3D4E5/apply/');
  assert.equal(input.sourcePublishedAt, '2026-08-10');
});

test('SOURCE_GATE — SmartRecruiters reports configuration truthfully', async () => {
  const http = makeHttp({ routes: [[/api\.smartrecruiters\.com/, { body: fx.smartRecruitersPostings }]] });

  const publicMode = new SmartRecruitersAdapter({ http, logger: silentLogger() });
  assert.equal(publicMode.configurationStatus().mode, 'PUBLIC');
  const batch = await publicMode.fetchJobs(srSource, null, { http });
  assert.equal(batch.items.length, 1);
  const input = publicMode.normalize(batch.items[0], srSource);
  assertNormalizedInput(input, { adapter: 'smartrecruiters' });
  assert.equal(input.requisitionId, 'SR-2026-4471');

  const keyRequired = new SmartRecruitersAdapter({
    http, logger: silentLogger(), smartRecruitersRequireKey: true, smartRecruitersApiKey: '',
  });
  const cfg = keyRequired.configurationStatus();
  assert.equal(cfg.status, 'NOT_CONFIGURED');
  const empty = await keyRequired.fetchJobs(srSource, null, { http });
  assert.equal(empty.notConfigured, true);
  assert.equal(empty.items.length, 0, 'never fakes a successful ingestion');
});

test('aggregator adapter is demoted, never authoritative', async () => {
  const legacy = { name: 'Remotive', home: 'https://remotive.example', fetch: async () => fx.aggregatorJobs };
  const adapter = new AggregatorAdapter({ legacySources: [legacy], logger: silentLogger() });
  assert.equal(AggregatorAdapter.sourceClass, SOURCE_CLASS.AGGREGATOR);

  const source = { id: 'src_agg', provider: PROVIDER.API, tenant: 'Remotive', sourceClass: SOURCE_CLASS.AGGREGATOR, queries: ['devops'] };
  const batch = await adapter.fetchJobs(source, null, {});
  assert.equal(batch.authoritative, false, 'a keyword response can never prove absence');
  assert.equal(batch.items.length, 2);

  const input = adapter.normalize(batch.items[0], source);
  assertNormalizedInput(input, { adapter: 'aggregator' });
  assert.equal(input.explicitRemote, true);
});

test('generic career-site adapter walks the ladder cheapest-first', async () => {
  const adapter = new GenericCareerSiteAdapter({ logger: silentLogger() });

  const jsonLd = await adapter.extractFrom(fx.jsonLdCareerPage, 'https://careers.aldermanfoods.example/jobs/support-engineer-1042', {}, {});
  assert.equal(jsonLd.stage, 'JSON_LD');
  assert.equal(jsonLd.items.length, 1);

  const embedded = await adapter.extractFrom(fx.nextDataCareerPage, 'https://pelicanfreight.example/careers', {}, {});
  assert.equal(embedded.stage, 'EMBEDDED_JSON');
  assert.equal(embedded.items.length, 2);
  const embInput = adapter.normalize(embedded.items[0], { companyName: 'Pelican Freight' });
  assertNormalizedInput(embInput, { adapter: 'generic-embedded' });
  assert.equal(embInput.title, 'Frontend Engineer');

  const http = makeHttp({ routes: [[/store-systems-analyst/, { body: fx.plainHtmlDetailPage }], [/warehouse-supervisor/, { status: 404, body: 'gone' }]] });
  const links = await adapter.extractFrom(fx.plainHtmlCareerPage, 'https://thornburyretail.example/careers', {}, { http });
  assert.equal(links.stage, 'HTML_LINKS');
  assert.equal(links.items.length, 1, 'a 404 detail page must not fail the source');
  const metaInput = adapter.normalize(links.items[0], { companyName: 'Thornbury Retail' });
  assert.equal(metaInput.sourcePublishedAt, null, 'a meta-only page states no publication date');
});

/* ============================ canonical document ============================ */

test('INGEST_GATE — canonical document keeps identity, provenance and honest gaps', () => {
  const adapter = new GreenhouseAdapter({ logger: silentLogger() });
  const input = adapter.normalize(fx.greenhouseBoard.jobs[0], ghSource);
  const job = toCanonicalJob(input, ghSource, { now: NOW });

  assert.equal(job.title, 'Senior Platform Engineer');
  assert.equal(job.company.name, 'Northwind Labs');
  assert.equal(job.sourceInstances.length, 1);
  assert.equal(job.sourceInstances[0].sourceJobId, '4118821');
  assert.equal(job.sourceInstances[0].requisitionId, 'REQ-8841');
  assert.ok(job.contentHash);
  assert.ok(job.dedupeFingerprint);
  assert.ok(job.id.startsWith('cj_'));

  /* provenance answers "which source said this?" */
  assert.equal(job.provenance.workplaceType.provider, PROVIDER.GREENHOUSE);
  assert.equal(job.provenance.canonicalApplyUrl.sourceClass, SOURCE_CLASS.ORIGINAL_ATS);

  const flags = completenessFlags(job);
  assert.equal(flags.hasTitle, true);
  assert.equal(flags.hasSalary, false, 'no salary was stated — reported as missing, not filled in');
  assert.equal(flags.hasPublishedDate, true);
  assert.ok(computeCompleteness(job).completeness > 50);
});

test('provenance records conflicts without discarding the losing source', () => {
  const job = makeJobDocument({});
  const ats = { sourceId: 'src_ats', sourceClass: SOURCE_CLASS.ORIGINAL_ATS, provider: PROVIDER.GREENHOUSE };
  const agg = { sourceId: 'src_agg', sourceClass: SOURCE_CLASS.AGGREGATOR, provider: PROVIDER.API };

  recordProvenance(job, 'workplaceType', 'HYBRID', ats, NOW);
  const won = recordProvenance(job, 'workplaceType', 'REMOTE', agg, NOW);
  assert.equal(won, false, 'aggregator cannot outrank an original ATS');
  assert.equal(job.provenance.workplaceType.value, 'HYBRID');
  assert.equal(job.conflicts.workplaceType.length, 1);
  assert.equal(job.conflicts.workplaceType[0].value, 'REMOTE', 'the disagreement is retained');
});

/* ============================ similarity primitives ============================ */

test('MinHash approximates Jaccard on shingles', () => {
  const a = 'we are hiring a senior platform engineer to own kubernetes terraform and internal developer tooling';
  const b = 'we are hiring a senior platform engineer to own kubernetes terraform and internal developer tooling today';
  const c = 'own the activation and retention roadmap partner with design and data to run experiments';

  const sigA = minhashSignature(a);
  const sigB = minhashSignature(b);
  const sigC = minhashSignature(c);

  assert.ok(signatureSimilarity(sigA, sigB) > 0.6);
  assert.ok(signatureSimilarity(sigA, sigC) < 0.2);
  assert.ok(jaccard(shingles(a), shingles(b)) > 0.7);
  assert.equal(stripHtml('<p>Hello&nbsp;<b>world</b></p>'), 'Hello world');
});

/* ============================ end-to-end ingest ============================ */

test('ingest pipeline stores canonical jobs from a Greenhouse board', async () => {
  const service = await makeService({
    routes: [[/boards-api\.greenhouse\.io/, { body: fx.greenhouseBoard }]],
  });
  const { source } = await service.registerSource({
    provider: PROVIDER.GREENHOUSE, sourceType: 'ATS', sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
    tenant: 'northwindlabs', companyName: 'Northwind Labs', companyDomain: 'northwindlabs.example',
  });

  const run = await service.crawlSource(source.id);
  assert.equal(run.ok, true, JSON.stringify(run.errors));
  assert.equal(run.fetched, 3);
  assert.equal(run.created, 3);

  const stored = await service.store.listJobs({});
  assert.equal(stored.length, 3);

  const health = await service.sourceHealth();
  assert.equal(health[0].status, 'ACTIVE');
  assert.equal(health[0].jobsLastSeen, 3);
  assert.equal(health[0].successRate, 1);
});
