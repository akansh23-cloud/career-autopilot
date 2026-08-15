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
     POST /api/admin/job-discovery/tick       run one scheduler slice
     POST /api/admin/job-discovery/discover   probe a domain/url

   MANUAL INGESTION (admin):

     POST /api/admin/job-discovery/fetch      fetch a batch of targets NOW
     GET  /api/admin/job-discovery/runs       past manual-fetch receipts
     GET  /api/admin/job-discovery/runs/:id   one receipt
     GET  /api/admin/job-discovery/jobs       browse what is in the store

   There is NO unauthenticated crawl trigger. Human ingest commands
   are requireAuth + requireAdmin; Vercel Cron commands live under
   /api/cron/job-discovery/* and require Authorization: Bearer
   CRON_SECRET. Every crawl target still passes the same SSRF/access
   guards (§47/§61). Neither an admin click nor a cron invocation is
   an authorization bypass: robots policy, source access policy,
   adapter configuration and source-health credibility all apply.

   The service is created LAZILY on first use so importing this
   module never opens a store or a socket.
   ============================================================ */

import crypto from 'node:crypto';
import { createJobDiscoveryService } from '../services/jobDiscovery/index.js';
import { RUN_MODE, LIMITS as MANUAL_LIMITS } from '../services/jobDiscovery/manualIngest.js';
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

function cronSecretMatches(req) {
  const expected = String(process.env.CRON_SECRET || '');
  const auth = String(req.headers?.authorization || '');
  const actual = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!expected || !actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function executionBudgetMs(kind = 'cron') {
  const envName = kind === 'manual' ? 'JOB_DISCOVERY_MANUAL_BUDGET_MS' : 'JOB_DISCOVERY_CRON_BUDGET_MS';
  const configured = Number(process.env[envName]);
  if (Number.isFinite(configured) && configured > 0) return configured;
  /* Current deployment is serverless. Leave margin for serialisation and the
     platform response after checkpointing the last unit of work. */
  return process.env.VERCEL ? 45_000 : 0;
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

  /* ----------------------- serverless cron workers ----------------------- */

  const cronHandler = (phase) => async (req, res) => {
    if (!cronSecretMatches(req)) return res.status(401).json({ error: 'cron_unauthorized' });
    try {
      const service = await getService();
      if (phase === 'bootstrap') {
        return res.json(await service.ensureCompanySeeds({ minimum: 1000, includeRemote: true }));
      }
      const budgetMs = executionBudgetMs('cron') || 45_000;
      return res.json(await service.runCronPhase(phase, { budgetMs }));
    } catch (e) {
      logger.error?.('job discovery cron failed', { phase, message: e?.message });
      return res.status(500).json({ error: 'cron_failed', phase, message: e?.message });
    }
  };

  app.get('/api/cron/job-discovery/bootstrap', cronHandler('bootstrap'));
  app.get('/api/cron/job-discovery/crawl', cronHandler('crawl'));
  app.get('/api/cron/job-discovery/discover', cronHandler('discover'));
  app.get('/api/cron/job-discovery/verify', cronHandler('verify'));

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

  /* ---------------------- manual ingestion ---------------------- */

  /**
   * Fetch a batch of targets on demand.
   *
   * Body:
   *   targets   string | string[]  board URLs, careers pages, domains, source ids
   *   mode      "INLINE" (default, crawl now) | "QUEUE" (hand to the workers)
   *   dryRun    boolean            resolve and report; touch nothing
   *   maxPages  number             page cap per source
   *   reason    string             free-text note kept on the receipt
   *
   * The jobs land in the canonical store, so they are searchable through the
   * ordinary /jobs/search-v2 path immediately — there is no separate "manually
   * fetched" collection and no second read path.
   */
  app.post('/api/admin/job-discovery/fetch', ...admin, async (req, res) => {
    try {
      const body = req.body || {};
      const raw = body.targets ?? body.target ?? body.url ?? body.urls;
      const targets = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,]+/))
        .map((t) => String(t ?? '').trim())
        .filter(Boolean);

      if (!targets.length) {
        return res.status(400).json({
          error: 'bad_request',
          message: 'Provide targets: a board URL, careers URL, company domain or source id (or a list of them).',
        });
      }

      const mode = String(body.mode || RUN_MODE.INLINE).toUpperCase() === RUN_MODE.QUEUE
        ? RUN_MODE.QUEUE
        : RUN_MODE.INLINE;

      const service = await getService();
      const result = await service.fetchNow(targets, {
        mode,
        dryRun: body.dryRun === true,
        /* Deliberately no artificial page/target cap: stress tests can run
           the full batch. On serverless, the execution deadline checkpoints
           and queues continuation instead of truncating work. */
        maxPagesPerSource: Number(body.maxPages) > 0 ? Number(body.maxPages) : null,
        deadlineAt: (() => {
          const budget = Number(body.executionBudgetMs) > 0 ? Number(body.executionBudgetMs) : executionBudgetMs('manual');
          return budget > 0 ? Date.now() + budget : null;
        })(),
        /* Recorded on the receipt so a fetch is attributable months later. */
        triggeredBy: req.user?.email || req.user?.id || 'admin',
        reason: body.reason ? String(body.reason).slice(0, 300) : null,
      });

      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: 'fetch_failed', message: e?.message });
    }
  });

  app.get('/api/admin/job-discovery/runs', ...admin, async (req, res) => {
    try {
      const service = await getService();
      const runs = await service.ingestRuns({
        limit: Number(req.query?.limit) || 25,
        triggeredBy: req.query?.triggeredBy ? String(req.query.triggeredBy) : null,
      });
      return res.json({ runs, limits: MANUAL_LIMITS });
    } catch (e) {
      return res.status(500).json({ error: 'runs_failed', message: e?.message });
    }
  });

  app.get('/api/admin/job-discovery/runs/:id', ...admin, async (req, res) => {
    try {
      const service = await getService();
      const run = await service.ingestRun(String(req.params.id));
      if (!run) return res.status(404).json({ error: 'not_found' });
      return res.json(run);
    } catch (e) {
      return res.status(500).json({ error: 'run_failed', message: e?.message });
    }
  });

  /**
   * Browse the canonical store directly. The run receipt says what we think
   * happened; this says what is actually there — which is the check an operator
   * wants after a manual fetch.
   */
  app.get('/api/admin/job-discovery/jobs', ...admin, async (req, res) => {
    try {
      const service = await getService();
      return res.json(await service.browseJobs({
        page: Number(req.query?.page) || 1,
        q: req.query?.q ? String(req.query.q).slice(0, 160) : '',
        sourceId: req.query?.sourceId ? String(req.query.sourceId) : null,
        companyDomain: req.query?.companyDomain ? String(req.query.companyDomain) : null,
        provider: req.query?.provider ? String(req.query.provider) : null,
        status: req.query?.status ? String(req.query.status) : null,
        since: req.query?.since ? String(req.query.since) : null,
      }));
    } catch (e) {
      return res.status(500).json({ error: 'browse_failed', message: e?.message });
    }
  });

  /** Searchable persisted employer-career registry, 20 companies per page. */
  app.get('/api/admin/job-discovery/companies', ...admin, async (req, res) => {
    try {
      const service = await getService();
      const hasSource = req.query?.hasSource == null || req.query?.hasSource === ''
        ? null
        : ['1', 'true', 'yes'].includes(String(req.query.hasSource).toLowerCase());
      return res.json(await service.browseCompanies({
        page: Number(req.query?.page) || 1,
        q: req.query?.q ? String(req.query.q).slice(0, 160) : '',
        provider: req.query?.provider ? String(req.query.provider) : null,
        seedSource: req.query?.seedSource ? String(req.query.seedSource) : null,
        hasSource,
      }));
    } catch (e) {
      return res.status(500).json({ error: 'company_browse_failed', message: e?.message });
    }
  });

  /** Seed/refresh the direct-company catalog. Target defaults to 1,000. */
  app.post('/api/admin/job-discovery/company-seeds', ...admin, async (req, res) => {
    try {
      const service = await getService();
      const minimum = Math.max(1, Number(req.body?.minimum) || 1000);
      return res.json(await service.ensureCompanySeeds({ minimum, includeRemote: req.body?.includeRemote !== false }));
    } catch (e) {
      console.error('[job-discovery] company seed failed', {
        message: e?.message || String(e),
        code: e?.code || null,
        name: e?.name || null,
      });
      return res.status(500).json({ error: 'company_seed_failed', message: e?.message });
    }
  });

  /** Admin stress runner for the durable queues; no count ceiling, deadline only. */
  app.post('/api/admin/job-discovery/process-queue', ...admin, async (req, res) => {
    try {
      const phase = String(req.body?.phase || 'crawl').toLowerCase();
      if (!['crawl', 'discover', 'verify'].includes(phase)) {
        return res.status(400).json({ error: 'bad_request', message: 'phase must be crawl, discover or verify' });
      }
      const service = await getService();
      const budgetMs = Number(req.body?.executionBudgetMs) > 0
        ? Number(req.body.executionBudgetMs)
        : (executionBudgetMs('manual') || 45_000);
      return res.json(await service.runCronPhase(phase, { budgetMs }));
    } catch (e) {
      return res.status(500).json({ error: 'queue_process_failed', message: e?.message });
    }
  });

  return app;
}

export default { registerJobDiscoveryRoutes, parseSearchQuery };
