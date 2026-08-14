/* ============================================================
   JOB DISCOVERY OS — SOURCE_EXPANSION_GATE
   ------------------------------------------------------------
   Proves the expanded provider surface is real rather than a
   longer enum:

     - every declared provider is FINGERPRINTABLE from a board URL,
       with the tenant shape that actually addresses that board
     - detection and support stay SEPARATE, and detection is always
       a superset
     - a provider with no public unauthenticated listing endpoint
       reports NOT_CONFIGURED instead of silently returning zero
     - each spec-driven connector normalizes a real provider payload
       into the canonical contract with NO provider keys leaking
     - no adapter invents a posting date, a salary or a remote
       classification the board did not state
     - `authoritative` is only claimed for complete listings

   Everything here is offline.
   ============================================================ */

import test from 'node:test';
import assert from 'node:assert/strict';

import AdapterRegistry from '../server/services/jobDiscovery/adapters/index.js';
import { detectAts, boardUrlFor, SUPPORTED_PROVIDERS, DETECTED_PROVIDERS } from '../server/services/jobDiscovery/atsDetect.js';
import { PROVIDER, SOURCE_CLASS } from '../server/services/jobDiscovery/schema.js';
import { NORMALIZED_INPUT_KEYS } from '../server/services/jobDiscovery/adapters/base.js';
import { parseXmlItems } from '../server/services/jobDiscovery/adapters/spec/specAdapter.js';
import { parseWorkdayTenant } from '../server/services/jobDiscovery/adapters/workday.js';
import { parseOracleTenant } from '../server/services/jobDiscovery/adapters/oracleRecruiting.js';
import { makeHttp } from './fixtures/jobDiscovery/harness.js';

const BOARD_URLS = [
  ['https://boards.greenhouse.io/northwind', PROVIDER.GREENHOUSE, 'northwind'],
  ['https://jobs.lever.co/harborstack', PROVIDER.LEVER, 'harborstack'],
  ['https://jobs.ashbyhq.com/vellum', PROVIDER.ASHBY, 'vellum'],
  ['https://apply.workable.com/tidewater/', PROVIDER.WORKABLE, 'tidewater'],
  ['https://careers.smartrecruiters.com/Kestrel', PROVIDER.SMARTRECRUITERS, 'Kestrel'],
  ['https://acme.wd3.myworkdayjobs.com/en-US/External', PROVIDER.WORKDAY, 'acme/wd3/External'],
  ['https://efxx.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1', PROVIDER.ORACLE_RECRUITING, 'efxx.fa.oraclecloud.com/CX_1'],
  ['https://acme.icims.com/jobs/search', PROVIDER.ICIMS, 'acme'],
  ['https://acme.taleo.net/careersection/ex/joblist.ftl', PROVIDER.TALEO, 'acme'],
  ['https://acme.recruitee.com/o/data-engineer', PROVIDER.RECRUITEE, 'acme'],
  ['https://acme.jobs.personio.de/job/12345', PROVIDER.PERSONIO, 'acme'],
  ['https://acme.teamtailor.com/jobs/1', PROVIDER.TEAMTAILOR, 'acme'],
  ['https://acme.bamboohr.com/jobs/', PROVIDER.BAMBOOHR, 'acme'],
  ['https://acme.applytojob.com/apply', PROVIDER.JAZZHR, 'acme'],
  ['https://acme.pinpointhq.com/postings', PROVIDER.PINPOINT, 'acme'],
  ['https://ats.rippling.com/acme/jobs', PROVIDER.RIPPLING, 'acme'],
  ['https://acme.zohorecruit.com/jobs/Careers', PROVIDER.ZOHO_RECRUIT, 'acme'],
  ['https://jobs.jobvite.com/acme/search', PROVIDER.JOBVITE, 'acme'],
  ['https://www.comeet.co/jobs/acme/1A.00B', PROVIDER.COMEET, 'acme'],
  ['https://acme.successfactors.eu/career?company=acme', PROVIDER.SUCCESSFACTORS, 'acme'],
];

test('SOURCE_EXPANSION_GATE — every declared provider is fingerprintable with an addressable tenant', () => {
  for (const [url, provider, tenant] of BOARD_URLS) {
    const det = detectAts(url);
    assert.equal(det.provider, provider, `${url} should fingerprint as ${provider}`);
    assert.equal(det.detected, true, `${url} should be detected`);
    assert.equal(det.tenant, tenant, `${url} tenant`);
  }
  assert.ok(DETECTED_PROVIDERS.size >= 20, `expected at least 20 fingerprintable providers, got ${DETECTED_PROVIDERS.size}`);
});

test('SOURCE_EXPANSION_GATE — detection is separate from, and a superset of, support', () => {
  for (const p of SUPPORTED_PROVIDERS) {
    if (p === PROVIDER.GENERIC || p === PROVIDER.API) continue;
    assert.ok(DETECTED_PROVIDERS.has(p), `${p} claims support with no detection signature`);
  }
  const registry = new AdapterRegistry({});
  const matrix = registry.coverageMatrix();
  assert.ok(matrix.detectedCount >= 20);
  assert.ok(matrix.connectorCount >= matrix.ingestReadyCount, 'ingest-ready can never exceed connectors');
  /* The whole point: a provider can be known without being ingestable. */
  assert.ok(matrix.rows.some((r) => r.detected && !r.ingestReady), 'the matrix must be able to express detected-but-not-ingestable');
});

test('SOURCE_EXPANSION_GATE — a board tenant round-trips to a usable board URL', () => {
  for (const [, provider, tenant] of BOARD_URLS) {
    const url = boardUrlFor(provider, tenant);
    if (url == null) continue; // not every provider exposes one canonical shape
    const det = detectAts(url);
    assert.equal(det.provider, provider, `${provider} board URL ${url} must fingerprint back to ${provider}`);
  }
});

test('SOURCE_EXPANSION_GATE — composite tenants are parsed, not guessed', () => {
  assert.deepEqual(parseWorkdayTenant('acme/wd3/External'), {
    company: 'acme', wd: 'wd3', site: 'External', host: 'acme.wd3.myworkdayjobs.com',
  });
  assert.equal(parseWorkdayTenant('acme'), null, 'an incomplete Workday tenant must not be accepted');
  assert.deepEqual(parseOracleTenant('efxx.fa.oraclecloud.com/CX_1'), { host: 'efxx.fa.oraclecloud.com', site: 'CX_1' });
  assert.equal(parseOracleTenant('efxx.fa.oraclecloud.com'), null);
});

test('SOURCE_EXPANSION_GATE — providers with no public listing endpoint report NOT_CONFIGURED', () => {
  const registry = new AdapterRegistry({});
  const status = registry.statusReport();

  for (const p of [PROVIDER.COMEET, PROVIDER.SUCCESSFACTORS]) {
    assert.equal(status[p].configured, false, `${p} must not claim to be configured without credentials`);
    assert.equal(status[p].status, 'NOT_CONFIGURED');
    assert.ok(status[p].reason.length > 20, 'the reason must explain what is missing');
  }
  /* And with credentials supplied, the same adapter reports ready. */
  const configured = new AdapterRegistry({ credentials: { [PROVIDER.COMEET]: { token: 'test-token' } } });
  assert.equal(configured.statusReport()[PROVIDER.COMEET].configured, true);
});

test('SOURCE_EXPANSION_GATE — a NOT_CONFIGURED adapter refuses to fetch rather than returning zero jobs', async () => {
  const registry = new AdapterRegistry({ http: makeHttp({ routes: [] }) });
  const adapter = registry.get(PROVIDER.COMEET);
  const batch = await adapter.fetchJobs({ id: 's1', tenant: 'acme', provider: PROVIDER.COMEET }, null, {});
  assert.equal(batch.notConfigured, true, 'an unconfigured provider must be distinguishable from an empty board');
  assert.equal(batch.items.length, 0);
  assert.equal(batch.authoritative, false, 'an unconfigured response can never be authoritative');
  assert.equal(batch.error.errorClass, 'NOT_CONFIGURED');
});

/* ------------------------------------------------------------------
   Spec-driven connectors against realistic provider payloads
   ------------------------------------------------------------------ */

const RECRUITEE_BOARD = {
  offers: [{
    id: 9911,
    slug: 'senior-data-engineer',
    title: 'Senior Data Engineer',
    description: '<p>Build and operate our data platform using Spark and Airflow.</p>',
    location: 'Amsterdam, Netherlands',
    city: 'Amsterdam',
    country: 'Netherlands',
    remote: true,
    employment_type_code: 'fulltime',
    department: 'Data',
    careers_url: 'https://acme.recruitee.com/o/senior-data-engineer',
    careers_apply_url: 'https://acme.recruitee.com/o/senior-data-engineer/c/new',
    published_at: '2026-08-01T09:00:00Z',
    tags: ['spark', 'airflow'],
  }],
};

const BAMBOO_BOARD = {
  result: [{
    id: 7788,
    jobOpeningName: 'Platform Engineer',
    location: { city: 'Pune', state: 'Maharashtra', country: 'India' },
    employmentStatusLabel: 'Full-Time',
    departmentLabel: 'Platform',
    isRemote: false,
    datePosted: '2026-08-05',
  }],
};

const RIPPLING_BOARD = [{
  uuid: 'rip-1234',
  name: 'Backend Engineer',
  jobDescription: '<p>Own our Go services.</p>',
  workLocation: { label: 'Bengaluru, India' },
  isRemote: false,
  employmentType: 'FULL_TIME',
  department: { label: 'Engineering' },
  url: 'https://ats.rippling.com/acme/jobs/rip-1234',
  publishedAt: '2026-08-09T00:00:00Z',
}];

const PERSONIO_FEED = `<?xml version="1.0"?>
<workzag-jobs>
  <position>
    <id>55501</id>
    <name>Cloud Engineer</name>
    <office>Berlin</office>
    <department>Infrastructure</department>
    <employmentType>permanent</employmentType>
    <createdAt>2026-07-28T00:00:00+00:00</createdAt>
    <jobDescriptions><![CDATA[<p>Run our AWS estate.</p>]]></jobDescriptions>
  </position>
</workzag-jobs>`;

async function normalizeVia(provider, routes, source) {
  const http = makeHttp({ routes });
  const registry = new AdapterRegistry({ http });
  const adapter = registry.get(provider);
  const batch = await adapter.fetchJobs(source, null, {});
  assert.equal(batch.error, undefined, `${provider} fetch error: ${JSON.stringify(batch.error)}`);
  assert.ok(batch.items.length > 0, `${provider} returned no items`);
  return { batch, inputs: batch.items.map((raw) => adapter.normalize(raw, source)) };
}

test('SOURCE_EXPANSION_GATE — spec-driven connectors emit the canonical contract with no provider keys', async () => {
  const cases = [
    [PROVIDER.RECRUITEE, [[/recruitee\.com\/api\/offers/, { body: RECRUITEE_BOARD }]], { id: 's', tenant: 'acme', provider: PROVIDER.RECRUITEE, companyName: 'Acme' }],
    [PROVIDER.BAMBOOHR, [[/bamboohr\.com\/careers\/list/, { body: BAMBOO_BOARD }]], { id: 's', tenant: 'acme', provider: PROVIDER.BAMBOOHR, companyName: 'Acme' }],
    [PROVIDER.RIPPLING, [[/api\.rippling\.com/, { body: RIPPLING_BOARD }]], { id: 's', tenant: 'acme', provider: PROVIDER.RIPPLING, companyName: 'Acme' }],
    [PROVIDER.PERSONIO, [[/jobs\.personio\.de\/xml/, { body: PERSONIO_FEED, contentType: 'application/xml' }]], { id: 's', tenant: 'acme', provider: PROVIDER.PERSONIO, companyName: 'Acme' }],
  ];

  for (const [provider, routes, source] of cases) {
    // eslint-disable-next-line no-await-in-loop
    const { batch, inputs } = await normalizeVia(provider, routes, source);
    assert.equal(batch.authoritative, true, `${provider} complete board listing should be authoritative`);

    for (const input of inputs) {
      assert.ok(input.title, `${provider} produced a titleless input`);
      const extra = Object.keys(input).filter((k) => !NORMALIZED_INPUT_KEYS.includes(k) && k !== 'company');
      assert.deepEqual(extra, [], `${provider} leaked provider keys: ${extra.join(', ')}`);
      assert.ok('sourcePublishedAt' in input, `${provider} must state its date field explicitly`);
    }
  }
});

test('SOURCE_EXPANSION_GATE — connectors never invent dates, salary or remote status', async () => {
  /* A board row with NOTHING optional stated. Every unknown must stay null. */
  const bare = { offers: [{ id: 1, title: 'Support Engineer', careers_url: 'https://acme.recruitee.com/o/x' }] };
  const { inputs } = await normalizeVia(
    PROVIDER.RECRUITEE,
    [[/recruitee\.com\/api\/offers/, { body: bare }]],
    { id: 's', tenant: 'acme', provider: PROVIDER.RECRUITEE },
  );
  const input = inputs[0];
  assert.equal(input.sourcePublishedAt, null, 'a missing publication date must stay null');
  assert.equal(input.compensationStructured, null);
  assert.equal(input.compensationRaw, null);
  assert.equal(input.explicitRemote, null, 'unstated remoteness must stay null, not false');
});

test('SOURCE_EXPANSION_GATE — Workday paginates and only the final page is authoritative', async () => {
  const page = (offset) => ({
    total: 30,
    jobPostings: Array.from({ length: offset === 0 ? 20 : 10 }, (_, i) => ({
      title: `Engineer ${offset + i}`,
      externalPath: `/job/Engineer-${offset + i}`,
      locationsText: 'Pune, India',
      bulletFields: [`REQ-${offset + i}`],
    })),
  });

  const http = makeHttp({
    routes: [
      [/wday\/cxs\/.*\/jobs$/, async (url, opts) => {
        const body = JSON.parse(opts.body || '{}');
        return { body: page(body.offset || 0) };
      }],
      [/wday\/cxs\/.*\/job\//, { body: { jobPostingInfo: { jobDescription: '<p>Details</p>', startDate: '2026-08-02' } } }],
    ],
  });
  const registry = new AdapterRegistry({ http });
  const adapter = registry.get(PROVIDER.WORKDAY);
  const source = { id: 's', tenant: 'acme/wd3/External', provider: PROVIDER.WORKDAY, companyName: 'Acme' };

  const first = await adapter.fetchJobs(source, null, {});
  assert.equal(first.items.length, 20);
  assert.deepEqual(first.nextCursor, { offset: 20 });
  assert.equal(first.authoritative, false, 'a mid-pagination page must never be authoritative');

  const second = await adapter.fetchJobs(source, first.nextCursor, {});
  assert.equal(second.items.length, 10);
  assert.equal(second.nextCursor, null);
  assert.equal(second.authoritative, true, 'the final page of a complete board is authoritative');

  const input = adapter.normalize(second.items[0], source);
  assert.equal(input.sourcePublishedAt, '2026-08-02', 'the detail endpoint supplies the real posting date');
  assert.ok(input.jobUrl.includes('/External/job/'), 'job url is built from the addressable board path');
});

test('SOURCE_EXPANSION_GATE — Workday display text is never mistaken for a posting date', async () => {
  const http = makeHttp({
    routes: [
      [/wday\/cxs\/.*\/jobs$/, { body: { total: 1, jobPostings: [{ title: 'SRE', externalPath: '/job/SRE', locationsText: 'Remote', postedOn: 'Posted 3 Days Ago' }] } }],
      /* No detail route: the detail fetch fails, so no real date is available. */
    ],
  });
  const registry = new AdapterRegistry({ http });
  const adapter = registry.get(PROVIDER.WORKDAY);
  const source = { id: 's', tenant: 'acme/wd3/External', provider: PROVIDER.WORKDAY };
  const batch = await adapter.fetchJobs(source, null, {});
  const input = adapter.normalize(batch.items[0], source);
  assert.equal(input.sourcePublishedAt, null, '"Posted 3 Days Ago" is display text, not a date');
});

test('SOURCE_EXPANSION_GATE — Oracle CE paginates against its stated total', async () => {
  const http = makeHttp({
    routes: [[/recruitingCEJobRequisitions/, (url) => {
      const offset = Number(url.match(/offset=(\d+)/)?.[1] ?? 0);
      return {
        body: {
          items: [{
            TotalJobsCount: 150,
            requisitionList: Array.from({ length: offset === 0 ? 100 : 50 }, (_, i) => ({
              Id: `${offset + i}`,
              Title: `Analyst ${offset + i}`,
              PrimaryLocation: 'Hyderabad, India',
              PostedDate: '2026-08-03',
              RequisitionNumber: `R${offset + i}`,
            })),
          }],
        },
      };
    }]],
  });
  const registry = new AdapterRegistry({ http });
  const adapter = registry.get(PROVIDER.ORACLE_RECRUITING);
  const source = { id: 's', tenant: 'efxx.fa.oraclecloud.com/CX_1', provider: PROVIDER.ORACLE_RECRUITING };

  const first = await adapter.fetchJobs(source, null, {});
  assert.equal(first.items.length, 100);
  assert.equal(first.authoritative, false);
  const second = await adapter.fetchJobs(source, first.nextCursor, {});
  assert.equal(second.authoritative, true);
  const input = adapter.normalize(second.items[0], source);
  assert.equal(input.sourcePublishedAt, '2026-08-03');
  assert.ok(input.jobUrl.includes('/sites/CX_1/job/'));
});

test('SOURCE_EXPANSION_GATE — structured-data boards read schema.org, and say so when it is absent', async () => {
  const withJsonLd = `<html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'JobPosting',
    title: 'Growth Manager', datePosted: '2026-08-06',
    hiringOrganization: { name: 'Acme' },
    jobLocation: { address: { addressLocality: 'Berlin', addressCountry: 'Germany' } },
    description: 'Own paid acquisition end to end.',
  })}</script></head><body></body></html>`;

  const ok = await normalizeVia(
    PROVIDER.TEAMTAILOR,
    [[/teamtailor\.com\/jobs/, { body: withJsonLd, contentType: 'text/html' }]],
    { id: 's', tenant: 'acme', provider: PROVIDER.TEAMTAILOR },
  );
  assert.equal(ok.inputs[0].title, 'Growth Manager');
  assert.equal(ok.inputs[0].sourcePublishedAt, '2026-08-06');
  /* A rendered board page is not a guaranteed-complete listing. */
  assert.equal(ok.batch.authoritative, false);

  const http = makeHttp({ routes: [[/teamtailor\.com\/jobs/, { body: '<html><body>No structured data</body></html>', contentType: 'text/html' }]] });
  const adapter = new AdapterRegistry({ http }).get(PROVIDER.TEAMTAILOR);
  const batch = await adapter.fetchJobs({ id: 's', tenant: 'acme', provider: PROVIDER.TEAMTAILOR }, null, {});
  assert.equal(batch.items.length, 0);
  assert.equal(batch.error.errorClass, 'SCHEMA_CHANGED', 'a board that stops publishing structured data is a classified failure, not an empty board');
});

test('SOURCE_EXPANSION_GATE — a malformed listing is a SCHEMA_CHANGED signal, never an empty board', async () => {
  const http = makeHttp({ routes: [[/recruitee\.com\/api\/offers/, { body: { unexpected: 'shape' } }]] });
  const adapter = new AdapterRegistry({ http }).get(PROVIDER.RECRUITEE);
  const batch = await adapter.fetchJobs({ id: 's', tenant: 'acme', provider: PROVIDER.RECRUITEE }, null, {});
  assert.equal(batch.items.length, 0);
  assert.equal(batch.authoritative, false, 'an unparseable response must never authorise closing jobs');
  assert.equal(batch.error.errorClass, 'SCHEMA_CHANGED');
});

test('SOURCE_EXPANSION_GATE — the XML reader extracts feed items without entity expansion', () => {
  const items = parseXmlItems(PERSONIO_FEED, 'position');
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Cloud Engineer');
  assert.equal(items[0].office, 'Berlin');
  assert.ok(items[0].jobDescriptions.includes('AWS estate'), 'CDATA is unwrapped');

  /* An external entity declaration must contribute nothing — the reader only
     matches literal elements and never resolves entities. */
  const hostile = `<!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><r><position><name>&xxe;</name></position></r>`;
  const parsed = parseXmlItems(hostile, 'position');
  assert.equal(parsed.length, 1);
  assert.ok(!String(parsed[0].name).includes('root:'), 'no entity expansion');
});

test('SOURCE_EXPANSION_GATE — every connector declares its source class honestly', () => {
  const registry = new AdapterRegistry({});
  const status = registry.statusReport();
  for (const [provider, s] of Object.entries(status)) {
    if (provider === PROVIDER.API) {
      assert.equal(s.sourceClass, SOURCE_CLASS.AGGREGATOR, 'aggregators must never claim original-source class');
      continue;
    }
    if (provider === PROVIDER.GENERIC) {
      assert.equal(s.sourceClass, SOURCE_CLASS.ORIGINAL_CAREER_SITE);
      continue;
    }
    assert.equal(s.sourceClass, SOURCE_CLASS.ORIGINAL_ATS, `${provider} should be an original ATS connector`);
  }
});
