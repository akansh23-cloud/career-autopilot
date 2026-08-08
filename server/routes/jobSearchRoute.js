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
      let gated = progressiveGate(jobs, baseCriteria, helpers, { minResults, maxLevel: 4 });

      /* ENGINE BUG WORKAROUND — do not remove.
         progressiveGate() only returns a step's candidates when that step
         reaches `minResults`. If the ladder is exhausted without any step
         clearing the bar it returns an EMPTY list, even when the last step
         found real jobs (e.g. minResults=5, level 4 found 3 -> returns 0).
         That reproduces the exact "no jobs found" symptom the engine was
         written to fix. Retry with minResults=1 so a thin result set is
         still shown, clearly labelled as a fallback. */
      if (!gated.candidates.length && gated.attempts.some((a) => a.count > 0)) {
        gated = progressiveGate(jobs, baseCriteria, helpers, { minResults: 1, maxLevel: 4 });
      }

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

      /* When nothing survives even at level 4, the cause is almost always
         upstream coverage, not the filters. Say so plainly instead of
         showing an empty list with no explanation. */
      const noIndiaSource = !RAPIDAPI_KEY && !process.env.ADZUNA_APP_ID && !process.env.SERPAPI_KEY;
      const coverageHint = (!kept.length && noIndiaSource && /india|pune|mumbai|bengaluru|bangalore|hyderabad|delhi|chennai|noida|gurgaon|gurugram|kolkata/i.test(String(loc)))
        ? 'No India-focused job source is configured on this deployment. The active sources (Remotive, RemoteOK, Jobicy, Arbeitnow) list remote and European roles only. Set ADZUNA_APP_ID / ADZUNA_APP_KEY or RAPIDAPI_KEY to search Indian listings.'
        : '';

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
          removedByFilter: gated.baseRemoved,
          removedByVerification: verifiedRemoved,
          attempts: gated.attempts,
          applied: { role, location: loc, mode, experience, jobType, freshness, filterMode },
        },

        audit: gated.audit,
        diagnostics: {
          apiKeyDetected: !!RAPIDAPI_KEY,
          host: RAPIDAPI_HOST,
          country: jsearchCountry(loc),
          strictFreshness: strict,
          errorCode: noIndiaSource ? 'NO_REGIONAL_SOURCE' : null,
          errorMessage: coverageHint || null,
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
