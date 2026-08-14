/* ============================================================
   Routes — JOB DISCOVERY OS  (§42, §60, §61)
   ------------------------------------------------------------
   PUBLIC (session-protected like the rest of /jobs):

     GET  /jobs/search-v2      canonical indexed search, no fan-out
     GET  /jobs/v2/:id         one canonical JobDocument
     GET  /jobs/v2/meta/filters  filter vocabulary

   PROTECTED (requireAuth + requireAdmin):

     GET  /api/admin/job-discovery/health     source health board
     GET  /api/admin/job-discovery/coverage   coverage report
     GET  /api/admin/job-discovery/stats      runtime stats
     POST /api/admin/job-discovery/sources    register source
     POST /api/admin/job-discovery/crawl      crawl one source
     POST /api/admin/job-discovery/verify     verify one source
     POST /api/admin/job-discovery/reprocess  re-normalize from raw
     POST /api/admin/job-discovery/manual-fetch bounded operator-triggered fetch
     POST /api/admin/job-discovery/tick       run one scheduler slice
     POST /api/admin/job-discovery/discover   probe a domain/url

   There is NO unauthenticated crawl trigger. Every ingest command
   is admin-gated, and the crawl target is validated by the same
   SSRF guards as any other URL (§47/§61).

   The service is created LAZILY on first use so importing this
   module never opens a store or a socket.
   ============================================================ */

import { createJobDiscoveryService } from '../services/jobDiscovery/index.js';
import { SOURCE_CLASS, SOURCE_TYPE, JOB_STATUS, PROVIDER, EMPLOYMENT_TYPE } from '../services/jobDiscovery/schema.js';
import { FRESHNESS_WINDOWS } from '../services/jobDiscovery/searchIndex.js';
import { ROLE_FAMILIES } from '../services/jobDiscovery/normalize/taxonomy.js';

const REMOTE_FILTERS = ['any', 'remote', 'hybrid', 'onsite'];
const SENIORITY_FILTERS = Object.freeze({
  internship: ['INTERN'],
  entry: ['ENTRY'],
  junior: ['ENTRY', 'MID'],
  mid: ['MID'],
  senior: ['SENIOR', 'STAFF', 'PRINCIPAL', 'LEAD', 'MANAGER', 'DIRECTOR', 'EXECUTIVE'],
});

/** Coerce and bound every query parameter. Nothing user-supplied reaches a store raw. */
export function parseSearchQuery(query = {}) {
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[,\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const remote = REMOTE_FILTERS.includes(String(query.remote || '').toLowerCase())
    ? String(query.remote).toLowerCase()
    : null;
  const freshness = Object.prototype.hasOwnProperty.call(FRESHNESS_WINDOWS, String(query.freshness || ''))
    ? String(query.freshness)
    : 'latest';

  const experienceKey = String(query.experience || query.seniority || '').toLowerCase();
  return {
    q: query.q != null ? String(query.q).slice(0, 160) : null,
    location: query.location != null ? String(query.location).slice(0, 120) : null,
    remote: remote === 'any' ? null : remote,
    salaryMin: num(query.salaryMin),
    salaryMax: num(query.salaryMax),
    currency: query.currency ? String(query.currency).slice(0, 8).toUpperCase() : null,
    employmentType: query.employmentType ? String(query.employmentType).toUpperCase().replace(/[\s-]+/g, '_').slice(0, 24) : null,
    seniority: SENIORITY_FILTERS[experienceKey] || null,
    freshness,
    company: query.company ? String(query.company).slice(0, 120) : null,
    sourceType: query.sourceType ? String(query.sourceType).toUpperCase().slice(0, 32) : null,
    includeStale: query.includeStale === '1' || query.includeStale === 'true',
    requireDated: query.requireDated === '1' || query.requireDated === 'true',
    limit: Math.max(1, Math.min(50, Number(query.limit) || 20)),
    cursor: query.cursor ? String(query.cursor).slice(0, 256) : null,
  };
}

export function registerJobDiscoveryRoutes(app, deps = {}) {
  const {
    jobsLimiter,
    requireAuth = (req, res, next) => next(),
    requireAdmin = (req, res, next) => next(),
    validateBody = null,
    logger = console,
    legacySources = [],
    serviceFactory = createJobDiscoveryService,
    serviceOptions = {},
  } = deps;

  let servicePromise = null;
  function getService() {
    if (!servicePromise) {
      servicePromise = serviceFactory({ legacySources, logger, ...serviceOptions })
        .catch((e) => { servicePromise = null; throw e; });
    }
    return servicePromise;
  }
  /* Exposed for tests and for the worker script. */
  app.locals = app.locals || {};
  app.locals.jobDiscovery = getService;

  const limiter = jobsLimiter || ((req, res, next) => next());

  /* ----------------------------- public ----------------------------- */

  app.get('/jobs/v2/meta/filters', (req, res) => {
    res.json({
      remote: REMOTE_FILTERS,
      freshness: Object.keys(FRESHNESS_WINDOWS),
      employmentTypes: Object.values(EMPLOYMENT_TYPE),
      experience: Object.keys(SENIORITY_FILTERS),
      sourceTypes: [...Object.values(SOURCE_CLASS), ...Object.values(SOURCE_TYPE)],
      statuses: Object.values(JOB_STATUS),
      providers: Object.values(PROVIDER),
      roleFamilies: Object.entries(ROLE_FAMILIES).map(([id, def]) => ({ id, label: def.label })),
      note: 'Search reads the canonical Job Discovery index. It performs no external provider calls.',
    });
  });

  app.get('/jobs/search-v2', limiter, async (req, res) => {
    try {
      const criteria = parseSearchQuery(req.query);
      const service = await getService();
      const payload = await service.search(criteria);
      res.json({
        ...payload,
        engine: 'job-discovery-os',
        /* Stated on every response: this search consulted no candidate data. */
        requiresResume: false,
        fetchedAt: new Date().toISOString(),
      });
    } catch (e) {
      logger.error?.('job discovery search failed', { message: e?.message });
      res.status(500).json({ error: 'job_search_failed', message: 'Job search failed. Please try again.' });
    }
  });

  app.get('/jobs/v2/:id', limiter, async (req, res) => {
    try {
      const service = await getService();
      const job = await service.getJob(String(req.params.id));
      if (!job) return res.status(404).json({ error: 'not_found', message: 'No canonical job with that id.' });
      res.json({ job });
    } catch (e) {
      logger.error?.('job discovery fetch failed', { message: e?.message });
      res.status(500).json({ error: 'job_fetch_failed' });
    }
  });

  /* ------------------------------ admin ------------------------------ */

  const admin = [requireAuth, requireAdmin];

  app.get('/api/admin/job-discovery/health', ...admin, async (req, res) => {
    try {
      const service = await getService();
      res.json({ sources: await service.sourceHealth(), adapters: service.adapters.statusReport() });
    } catch (e) {
      res.status(500).json({ error: 'health_failed', message: e?.message });
    }
  });

  app.get('/api/admin/job-discovery/coverage', ...admin, async (req, res) => {
    try {
      const service = await getService();
      res.json(await service.coverageReport());
    } catch (e) {
      res.status(500).json({ error: 'coverage_failed', message: e?.message });
    }
  });

  app.get('/api/admin/job-discovery/stats', ...admin, async (req, res) => {
    try {
      const service = await getService();
      res.json(await service.stats());
    } catch (e) {
      res.status(500).json({ error: 'stats_failed', message: e?.message });
    }
  });

  app.post('/api/admin/job-discovery/sources', ...admin, async (req, res) => {
    try {
      const service = await getService();
      const { url, provider, tenant, companyName, companyDomain } = req.body || {};
      if (provider && tenant) {
        const r = await service.registerSource({ provider, tenant, companyName, companyDomain }, {});
        return res.json(r);
      }
      if (!url) return res.status(400).json({ error: 'bad_request', message: 'Provide either { provider, tenant } or { url }.' });
      const r = await service.registerFromUrl(String(url), { companyName, companyDomain });
      return res.json(r);
    } catch (e) {
      return res.status(500).json({ error: 'register_failed', message: e?.message });
    }
  });

  app.post('/api/admin/job-discovery/crawl', ...admin, async (req, res) => {
    try {
      const service = await getService();
      const sourceId = String(req.body?.sourceId || '');
      if (!sourceId) return res.status(400).json({ error: 'bad_request', message: 'sourceId is required.' });
      return res.json(await service.crawlSource(sourceId));
    } catch (e) {
      return res.status(500).json({ error: 'crawl_failed', message: e?.message });
    }
  });

  app.post('/api/admin/job-discovery/verify', ...admin, async (req, res) => {
    try {
      const service = await getService();
      const sourceId = String(req.body?.sourceId || '');
      if (!sourceId) return res.status(400).json({ error: 'bad_request', message: 'sourceId is required.' });
      return res.json(await service.verifySource(sourceId, { limit: Number(req.body?.limit) || 25 }));
    } catch (e) {
      return res.status(500).json({ error: 'verify_failed', message: e?.message });
    }
  });

  app.post('/api/admin/job-discovery/reprocess', ...admin, async (req, res) => {
    try {
      const service = await getService();
      const sourceId = String(req.body?.sourceId || '');
      if (!sourceId) return res.status(400).json({ error: 'bad_request', message: 'sourceId is required.' });
      return res.json(await service.reprocessSource(sourceId, { limit: Number(req.body?.limit) || 500 }));
    } catch (e) {
      return res.status(500).json({ error: 'reprocess_failed', message: e?.message });
    }
  });

  app.post('/api/admin/job-discovery/manual-fetch', ...admin, async (req, res) => {
    try {
      const service = await getService();
      const body = req.body || {};
      const sourceLimit = Math.max(1, Math.min(3, Number(body.sourceLimit) || 1));
      const maxPagesPerSource = Math.max(1, Math.min(3, Number(body.maxPagesPerSource) || 2));
      const discoveryLimit = Math.max(1, Math.min(5, Number(body.discoveryLimit) || 2));
      const verificationLimit = Math.max(1, Math.min(25, Number(body.verificationLimit) || 10));
      const sourceId = body.sourceId ? String(body.sourceId).slice(0, 180) : null;
      const sourceUrl = body.sourceUrl ? String(body.sourceUrl).slice(0, 1000) : null;
      const companyName = body.companyName ? String(body.companyName).slice(0, 180) : null;
      const companyDomain = body.companyDomain ? String(body.companyDomain).slice(0, 255) : null;

      const result = await service.manualFetch({
        sourceId,
        sourceUrl,
        companyName,
        companyDomain,
        sourceLimit,
        maxPagesPerSource,
        runDiscovery: body.runDiscovery === true,
        discoveryLimit,
        runVerification: body.runVerification === true,
        verificationLimit,
      });
      return res.status(result.ok ? 200 : 207).json(result);
    } catch (e) {
      logger.error?.('manual job fetch failed', { message: e?.message });
      return res.status(500).json({ error: 'manual_fetch_failed', message: e?.message || 'Manual job fetch failed.' });
    }
  });

  app.post('/api/admin/job-discovery/tick', ...admin, async (req, res) => {
    try {
      const service = await getService();
      const body = req.body || {};
      return res.json(await service.tick({
        crawl: body.crawl !== false,
        verify: body.verify !== false,
        discover: body.discover !== false,
      }));
    } catch (e) {
      return res.status(500).json({ error: 'tick_failed', message: e?.message });
    }
  });

  app.post('/api/admin/job-discovery/discover', ...admin, async (req, res) => {
    try {
      const service = await getService();
      const domain = req.body?.domain ? String(req.body.domain) : null;
      const url = req.body?.url ? String(req.body.url) : null;
      if (!domain && !url) return res.status(400).json({ error: 'bad_request', message: 'domain or url is required.' });
      const r = url
        ? await service.registerFromUrl(url, { companyName: req.body?.companyName || null })
        : await service.discovery.discoverFromDomain(domain, { companyName: req.body?.companyName || null, discoveredFrom: 'admin' });
      return res.json(r);
    } catch (e) {
      return res.status(500).json({ error: 'discover_failed', message: e?.message });
    }
  });

  return app;
}

export default { registerJobDiscoveryRoutes, parseSearchQuery };
