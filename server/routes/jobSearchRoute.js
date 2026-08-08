/* ============================================================
   Routes — JOB SEARCH v2  (replaces the inline /jobs/search in server.js)
   ------------------------------------------------------------
   WHY THIS EXISTS

   server/utils/jobSearchEngine.js is a complete, tested progressive
   fallback engine whose own header says it "fixes the chronic
   'No matching jobs found' problem". It is never imported by
   server.js — grepping for progressiveGate outside the module
   returns only test/jobSearchEngine.test.js.

   Same for server/utils/jobFilters.js (canonical work-mode /
   experience / job-type vocabulary), and web/src/lib/jobFilterOptions.js
   which views/Jobs.jsx ignores in favour of its own three-value array.

   The live route at server.js:982 uses an inline gate —
   validRoleMatch -> validLocationMatch -> validModeMatch — that drops
   a job at the FIRST failing filter and returns an empty array with no
   fallback. That is the "unable to find any job with any filter" review.

   This module wires the real engine in. It changes nothing about how
   jobs are FETCHED (same SOURCES, same verification, same cache) — only
   how they are gated, ranked and explained.

   ------------------------------------------------------------
   WIRING (server.js)

     1. Delete the whole `app.get('/jobs/search', jobsLimiter, ...)`
        block (server.js:982 to ~:1140).
     2. Add near the other route imports:

        import { registerJobSearchRoute } from './server/routes/jobSearchRoute.js';

     3. After the helper functions are defined (anywhere after
        balancedBySource), add:

        registerJobSearchRoute(app, {
          jobsLimiter, SOURCES, configuredSources, sourceKey, sourceAllowed,
          requestedSources, inferSource, sourceFromUrl, balancedBySource,
          jobKey, verifyMany, withBudget, jobCacheGet, jobCacheSet,
          maxFreshDaysFromQuery, passesFreshness,
          validRoleMatch, validLocationMatch,
          jsearchCountry, logger,
          RAPIDAPI_KEY, RAPIDAPI_HOST, STRICT_JOB_VERIFICATION,
          JOB_SEARCH_BUDGET,
        });

   Every one of those already exists in server.js — this module adds no
   new dependencies beyond the two orphaned engines.
   ============================================================ */

import {
  progressiveGate, rankJobs, summarizeSearch, normalizeFilterMode, FALLBACK_STEPS,
} from '../utils/jobSearchEngine.js';
import {
  matchesWorkMode, matchesExperienceLevel, matchesJobType,
  normalizeWorkMode, normalizeExperienceLevel, normalizeJobType,
  WORK_MODES, EXPERIENCE_LEVELS, JOB_TYPES,
} from '../utils/jobFilters.js';

/* Name the filters a fallback step actually relaxed, relative to what the user
   asked for. "Broader matches (30-day window)" does not tell someone who picked
   "24h" that their freshness filter was dropped — this does. Only reports a
   relaxation when it genuinely changed the user's own value. */
export function describeRelaxations(step = {}, baseCriteria = {}) {
  const relax = step.relax || {};
  const out = [];
  if (relax.freshness && relax.freshness !== baseCriteria.freshness) {
    const LABEL = { '24h': 'last 24 hours', '1d': 'last 24 hours', '3d': 'last 3 days', '7d': 'last week', '30d': 'last 30 days', latest: 'any date' };
    out.push({
      filter: 'freshness',
      from: LABEL[baseCriteria.freshness] || baseCriteria.freshness || 'any date',
      to: LABEL[relax.freshness] || relax.freshness,
      label: `Posting date widened to ${LABEL[relax.freshness] || relax.freshness}`,
    });
  }
  if (relax.includeUndated) {
    out.push({ filter: 'freshness', label: 'Included postings whose source published no date' });
  }
  if (relax.broadRole && baseCriteria.role) {
    out.push({ filter: 'role', from: baseCriteria.role, label: `Role matched loosely around "${baseCriteria.role}" instead of exactly` });
  }
  if (relax.anyLocation && baseCriteria.location) {
    out.push({ filter: 'location', from: baseCriteria.location, label: `Location filter "${baseCriteria.location}" dropped` });
  }
  if (relax.anyMode && baseCriteria.mode && baseCriteria.mode !== 'any') {
    out.push({ filter: 'workMode', from: baseCriteria.mode, label: `Work mode filter "${baseCriteria.mode}" dropped` });
  }
  return out;
}

export function registerJobSearchRoute(app, deps = {}) {
  const {
    jobsLimiter,
    SOURCES, configuredSources, sourceKey, sourceAllowed, requestedSources,
    inferSource, sourceFromUrl, balancedBySource, jobKey,
    verifyMany, withBudget, jobCacheGet, jobCacheSet,
    maxFreshDaysFromQuery, passesFreshness,
    validRoleMatch, validLocationMatch,
    jsearchCountry = () => 'in',
    logger = console,
    RAPIDAPI_KEY = '', RAPIDAPI_HOST = '', STRICT_JOB_VERIFICATION = false,
    JOB_SEARCH_BUDGET = 8000,
  } = deps;

  const required = { SOURCES, configuredSources, verifyMany, withBudget, jobKey, passesFreshness, maxFreshDaysFromQuery };
  for (const [k, v] of Object.entries(required)) {
    if (!v) throw new Error(`jobSearchRoute: missing dependency \`${k}\``);
  }

  /* Expose the canonical vocabulary so the frontend stops hardcoding it.
     web/src/lib/jobFilterOptions.js should be fed from this. */
  app.get('/jobs/filters', (req, res) => {
    res.json({
      workModes: WORK_MODES,
      experienceLevels: EXPERIENCE_LEVELS,
      jobTypes: JOB_TYPES,
      freshness: ['24h', '3d', '7d', '30d', 'latest'],
      filterModes: ['inclusive', 'strict'],
      fallbackSteps: FALLBACK_STEPS.map((s) => ({ level: s.level, group: s.group, label: s.label })),
    });
  });

  app.get('/jobs/search', jobsLimiter || ((req, res, next) => next()), async (req, res) => {
    try {
      const role = req.query.role || 'software engineer';
      const loc = req.query.location || '';

      /* Canonicalise every filter through jobFilters.js. This is what makes
         the legacy UI values keep working: 'On-site/Hybrid' -> 'hybrid',
         'Any' -> 'any', unknown -> 'any' (never throws, never empties). */
      const mode = normalizeWorkMode(req.query.mode);
      const experience = normalizeExperienceLevel(req.query.experience);
      const jobType = normalizeJobType(req.query.jobType || req.query.type);
      const filterMode = normalizeFilterMode(req.query.filterMode);

      /* CHANGED DEFAULT: 30d, not 7d. A 7-day hard wall against four
         remote-only boards is the single biggest cause of empty results,
         and the fallback ladder can always tighten back down. */
      const freshness = req.query.freshness || '30d';
      const maxDays = maxFreshDaysFromQuery(freshness);

      const limit = Math.max(1, Math.min(40, Number(req.query.limit || 12)));
      const minResults = Math.max(1, Math.min(limit, Number(req.query.minResults || 5)));
      const verify = req.query.verify !== '0';
      const strict = req.query.strict != null
        ? (req.query.strict === '1' || req.query.strict === 'true')
        : STRICT_JOB_VERIFICATION;
      const selected = requestedSources ? requestedSources(req) : null;

      const cacheKey = JSON.stringify({
        v: 2, role, loc, mode, experience, jobType, filterMode, freshness,
        limit, minResults, verify, strict, selected: selected ? [...selected].sort() : null,
      });
      const cached = jobCacheGet?.(cacheKey);
      if (cached) return res.json({ ...cached, cached: true });

      /* ---------------- fetch (unchanged from the original route) ------- */

      const ctx = { role, location: loc, mode, freshness, selectedSources: selected, strict, diag: {} };
      const runnable = SOURCES.filter(
        (s) => !selected || (sourceAllowed ? sourceAllowed(s.name, selected) : true) || ['SerpAPI', 'JSearch'].includes(s.name),
      );
      const settled = await withBudget(
        Promise.allSettled(runnable.map((s) => s.fetch(role, ctx))),
        JOB_SEARCH_BUDGET,
        runnable.map(() => ({ status: 'fulfilled', value: [] })),
      );

      const configured = configuredSources();
      const sources = configured.map((x) => ({
        source: x.source, ok: false, count: 0, active: x.active,
        integration: x.integration, reason: x.reason || '',
      }));
      const sourceIndex = new Map(sources.map((s, i) => [sourceKey(s.source), i]));

      let jobs = [];
      runnable.forEach((src, i) => {
        const r = settled[i];
        if (r.status === 'fulfilled') {
          const arr = (r.value || []).map((j) => ({ ...j, source: inferSource(j, src.name) }));
          jobs.push(...arr);
          const grouped = new Map();
          arr.forEach((j) => grouped.set(j.source, (grouped.get(j.source) || 0) + 1));
          for (const [name, count] of grouped) {
            const ix = sourceIndex.get(sourceKey(name));
            if (ix != null) { sources[ix].ok = true; sources[ix].active = true; sources[ix].count += count; sources[ix].reason = ''; }
            else sources.push({ source: name, ok: true, active: true, count, integration: src.name, reason: '' });
          }
          const pix = sourceIndex.get(sourceKey(src.name));
          if (pix != null && !grouped.size) { sources[pix].ok = true; sources[pix].active = true; }
        } else {
          const ix = sourceIndex.get(sourceKey(src.name));
          const error = r.reason?.message || String(r.reason);
          if (ix != null) { sources[ix].ok = false; sources[ix].active = true; sources[ix].error = error; }
          else sources.push({ source: src.name, ok: false, active: true, count: 0, error });
        }
      });
      if (selected && sourceAllowed) jobs = jobs.filter((j) => sourceAllowed(j.source, selected));
      jobs.forEach((j) => { j.source = inferSource(j, j.source || sourceFromUrl(j.url)); });

      const fetchedCount = jobs.length;

      /* ---------------- gate: THE ACTUAL FIX ---------------------------- */

      const helpers = {
        passesFreshness,
        matchRole: validRoleMatch,
        matchLocation: validLocationMatch,
        matchesWorkMode,
        matchesExperienceLevel,
        matchesJobType,
        jobKey,
        maxDaysOf: maxFreshDaysFromQuery,
      };

      const baseCriteria = { role, location: loc, mode, experience, jobType, freshness, filterMode };

      /* Instead of one hard pass that empties on first failure, walk the
         five-step ladder until `minResults` survive:
           0 exact -> 1 30-day -> 2 source-listed -> 3 broad role -> 4 global.
         `baseRemoved` still reports why the EXACT search was empty, so the
         user gets a reason rather than a blank page. */
      /* The engine now returns the best non-empty candidate set on its own when
         no step reaches `minResults` (see progressiveGate's `best` tracking), so
         the old "ENGINE BUG WORKAROUND" second call at minResults=1 is gone.
         A thin-but-real result set arrives here directly, flagged via
         `thinResults`, and an empty one now genuinely means zero postings
         survived at every relaxation level. */
      const gated = progressiveGate(jobs, baseCriteria, helpers, { minResults, maxLevel: 4 });

      let candidates = rankJobs(gated.candidates, baseCriteria, helpers);
      candidates = balancedBySource ? balancedBySource(candidates, limit * 2) : candidates.slice(0, limit * 2);

      /* ---------------- verify ------------------------------------------ */

      let kept = candidates;
      let verifiedRemoved = 0;
      if (verify) {
        const checked = await verifyMany(candidates, 6);
        kept = checked.filter((j) => {
          if (j.verified) return true;
          verifiedRemoved += 1;
          return false;
        });
      }

      kept = rankJobs(kept, baseCriteria, helpers);
      kept = balancedBySource ? balancedBySource(kept, limit) : kept.slice(0, limit);
      kept.forEach((j) => { delete j._auditRow; });

      /* ---------------- honest per-source status ------------------------ */

      for (const s of sources) {
        if (s.ok && Number(s.count || 0) > 0) s.status = 'fetched';
        else if (s.error) { s.status = 'failed'; s.reason = s.error; }
        else if (/SerpAPI|JSearch|search provider/i.test(s.integration || '')) {
          s.active = false; s.status = 'no_results';
          s.reason = 'No jobs from this board in this search (discovery runs via JSearch/SerpAPI, not a direct integration).';
        } else { s.active = false; s.status = 'inactive'; }
      }

      /* ---------------- explain --------------------------------------- */

      const explanation = summarizeSearch({
        baseCount: gated.baseCount,
        shownCount: kept.length,
        fallbackLevel: gated.step.level,
        fallbackLabel: gated.step.label,
        removed: gated.baseRemoved,
        verifiedRemoved,
      });

      /* ---------------- provider diagnostics ---------------------------
         `ctx.diag` is populated by the JSearch source with the real upstream
         outcome — INVALID_KEY (401), NOT_SUBSCRIBED (403 + RapidAPI's
         subscription body), RATE_LIMITED (429), UPSTREAM (other non-2xx),
         NETWORK (unreachable) or NO_RESULTS. The route created that object and
         then never read it back, so every one of those failures reached the
         user as an unexplained "No jobs found". It is surfaced now.

         Everything here is already sanitized at the source: the key itself is
         never placed on `diag`, only a classification and a human message. */
      const providerDiag = ctx.diag || {};
      const PROVIDER_ERROR_LABELS = {
        INVALID_KEY: 'The configured RapidAPI key was rejected (HTTP 401/403). Check RAPIDAPI_KEY.',
        NOT_SUBSCRIBED: 'The RapidAPI key is valid but this account is not subscribed to the JSearch API. Subscribe on RapidAPI (the free Basic plan is enough) and retry.',
        RATE_LIMITED: 'The job provider rate-limited this deployment (HTTP 429). Wait a minute before searching again, or raise the JSearch plan quota.',
        UPSTREAM: 'The job provider returned an unexpected error. This is upstream of Career Autopilot; retry shortly.',
        NETWORK: 'The job provider could not be reached from this deployment.',
        NO_RESULTS: 'The job provider was reachable and authorised but returned no postings for this query.',
      };

      /* A provider FAILURE is not the same as a provider returning nothing.
         Only the former is a configuration/health problem worth escalating. */
      const providerFailed = !!providerDiag.errorCode && providerDiag.errorCode !== 'NO_RESULTS';

      const configuredProviders = {
        rapidapi: !!RAPIDAPI_KEY,
        adzuna: !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
        serpapi: !!process.env.SERPAPI_KEY,
      };
      const anyRegionalProvider = configuredProviders.rapidapi || configuredProviders.adzuna || configuredProviders.serpapi;

      /* Regional coverage. The always-on fallbacks (Remotive, RemoteOK, Jobicy,
         Arbeitnow, The Muse) are remote/EU/US boards — none of them index
         Indian on-site listings, so an India/Pune search against those alone
         cannot succeed no matter how far the filters are relaxed. */
      const REGIONAL_QUERY = /india|bharat|pune|mumbai|bengaluru|bangalore|hyderabad|delhi|chennai|noida|gurgaon|gurugram|kolkata|ahmedabad|jaipur|indore|nashik|coimbatore|kochi/i;
      const wantsRegional = REGIONAL_QUERY.test(String(loc));

      /* Every source we actually ran threw. That is a total upstream/network
         outage and is NOT the same as "no provider configured" — without this
         branch a blocked network reported the misleading "only free boards are
         configured" message while the real cause was that all of them failed. */
      const attemptedSources = sources.filter((s) => s.active || s.error);
      const failedSources = sources.filter((s) => s.error);
      const anySourceSucceeded = sources.some((s) => s.ok);
      const allSourcesFailed = failedSources.length > 0 && !anySourceSucceeded;

      let errorCode = null;
      let coverageHint = '';

      if (allSourcesFailed && !kept.length) {
        errorCode = 'ALL_SOURCES_FAILED';
        coverageHint = `Every configured job source failed to respond (${failedSources.slice(0, 4).map((s) => s.source).join(', ')}). This is a network or upstream outage, not a filter problem — no postings could be retrieved.`;
      } else if (providerFailed) {
        /* Loudest signal first: a configured provider actually failed. This is
           reported whether or not fallback boards happened to return something,
           because silently degrading to remote-only results while the India
           provider is 401-ing is exactly the "silently shows no jobs" failure. */
        errorCode = providerDiag.errorCode;
        coverageHint = PROVIDER_ERROR_LABELS[providerDiag.errorCode] || providerDiag.errorMessage || 'The job provider returned an error.';
      } else if (wantsRegional && !anyRegionalProvider && !kept.length) {
        /* `!kept.length` matters: a fallback board can legitimately carry a
           remote role that matches an Indian search. When that happens the
           search SUCCEEDED, and raising a coverage error over a working result
           list would be plainly wrong. This fires only when the missing
           regional provider actually cost the user their results. */
        /* NEVER a bare "No jobs found" here — this is a configuration gap, and
           the user is told so explicitly rather than being left to conclude
           there are no DevOps jobs in Pune. */
        errorCode = 'NO_REGIONAL_SOURCE';
        coverageHint = 'No India-capable job source is configured on this deployment, so this location cannot return results. The active sources (Remotive, RemoteOK, Jobicy, Arbeitnow, The Muse) index remote, European and US roles only. Set RAPIDAPI_KEY, or ADZUNA_APP_ID + ADZUNA_APP_KEY, or SERPAPI_KEY to search Indian listings.';
      } else if (!kept.length && providerDiag.errorCode === 'NO_RESULTS') {
        errorCode = 'PROVIDER_NO_RESULTS';
        coverageHint = `${PROVIDER_ERROR_LABELS.NO_RESULTS} Try a broader role title or clear the location.`;
      } else if (!kept.length && !anyRegionalProvider) {
        errorCode = 'NO_SEARCH_PROVIDER';
        coverageHint = 'Only the free remote-job boards are configured on this deployment. Set RAPIDAPI_KEY, ADZUNA_APP_ID/ADZUNA_APP_KEY or SERPAPI_KEY for broader coverage.';
      }

      const payload = {
        jobs: kept,
        sources,
        verified: verify,

        /* Everything the UI needs to explain a thin or empty result set. */
        search: {
          explanation,
          coverageHint,
          fetchedCount,
          exactMatches: gated.baseCount,
          shown: kept.length,
          fallbackLevel: gated.step.level,
          fallbackGroup: gated.step.group,
          fallbackLabel: gated.step.label,
          usedFallback: gated.step.level > 0,
          /* Which filters the fallback step actually relaxed, named, so the UI
             can say WHICH ones were dropped instead of "broader matches". */
          relaxedFilters: describeRelaxations(gated.step, baseCriteria),
          /* Real postings, but fewer than the requested minimum. Previously
             this state was indistinguishable from "no jobs found". */
          thinResults: !!gated.thinResults,
          requestedMinResults: minResults,
          removedByFilter: gated.baseRemoved,
          removedByVerification: verifiedRemoved,
          attempts: gated.attempts,
          providerError: providerFailed ? { code: providerDiag.errorCode, message: coverageHint } : null,
          applied: { role, location: loc, mode, experience, jobType, freshness, filterMode },
        },

        audit: gated.audit,

        /* Sanitized provider health. Never contains the key itself — only
           whether one is configured, the classified outcome and a message the
           UI can show verbatim. */
        diagnostics: {
          apiKeyDetected: !!RAPIDAPI_KEY,
          host: RAPIDAPI_HOST,
          country: jsearchCountry(loc),
          strictFreshness: strict,
          errorCode,
          errorMessage: coverageHint || null,
          providersConfigured: configuredProviders,
          regionalProviderRequired: wantsRegional,
          regionalProviderConfigured: anyRegionalProvider,
          sourcesAttempted: attemptedSources.length,
          sourcesFailed: failedSources.map((s) => ({ source: s.source, error: String(s.error).slice(0, 200) })),
          allSourcesFailed,
          provider: {
            name: 'JSearch / RapidAPI',
            attempted: !!providerDiag.apiKeyDetected,
            reachable: providerDiag.reachable ?? null,
            statusCode: providerDiag.statusCode ?? null,
            query: providerDiag.query || null,
            freshnessUsed: providerDiag.usedFreshness || null,
            returnedCount: providerDiag.returnedCount ?? null,
            cached: !!providerDiag.cached,
            errorCode: providerDiag.errorCode || null,
            errorMessage: providerDiag.errorMessage || null,
            broadened: providerDiag.broadened || null,
          },
        },
        sourceSummary: {
          active: sources.filter((s) => s.active).map((s) => s.source),
          inactive: sources.filter((s) => !s.active).map((s) => ({ source: s.source, reason: s.reason })),
          returned: Object.fromEntries(
            [...new Set(kept.map((j) => j.source))].map((src) => [src, kept.filter((j) => j.source === src).length]),
          ),
        },
        freshnessDays: maxDays,
        fetchedAt: new Date().toISOString(),
        note: verify
          ? 'Structured-source jobs that passed URL verification. No AI-generated jobs.'
          : 'URL verification disabled (verify=0). Structured-source only — no AI-generated jobs.',
      };

      /* NEVER cache an empty result. The old route cached unconditionally for
         90s, so one bad upstream minute poisoned every identical search. */
      if (kept.length) jobCacheSet?.(cacheKey, payload);

      res.json(payload);
    } catch (e) {
      logger.error?.('Job search failed', { message: e.message });
      res.status(500).json({ error: 'job_search_failed', message: 'Job search failed. Please try again.' });
    }
  });

  return app;
}

export default { registerJobSearchRoute };
