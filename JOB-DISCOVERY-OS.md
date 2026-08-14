# JOB DISCOVERY OS — Phase 1 (Foundation)

Career Autopilot's job universe. This phase builds the infrastructure that
finds, normalizes, deduplicates, verifies and serves jobs. Candidate-aware
intelligence is explicitly **not** in this phase — the point is to make the job
universe itself excellent first, so later reranking has something real to rank.

Resume OS is frozen and untouched.

---

## 1. Architecture discovered during the audit

The pre-existing implementation, traced from source rather than from docs:

```
web/src/views/Jobs.jsx
  → web/src/lib/api.js            Jobs.search()
    → GET /jobs/search            server/routes/jobSearchRoute.js
      → SOURCES[].fetch()         defined inline in server.js:354–600
      → progressiveGate() → rankJobs()   server/utils/jobSearchEngine.js
      → verifyMany() → balancedBySource() → jobCacheSet()
```

What that audit established:

| Finding | Consequence for this phase |
|---|---|
| `SOURCES` is Remotive, RemoteOK, Arbeitnow, Jobicy, The Muse, plus conditional Adzuna / JSearch / SerpAPI — **all aggregators, zero original ATS** | §2: aggregators are demoted to supplemental; ATS becomes the foundation |
| Every user search fanned out to 5–8 providers live, inside the request, under an 8s budget | §26/§48: background ingestion + canonical index |
| No job persistence at all — `jobCacheGet/Set` was a 90-second in-memory cache | §5/§40: a real store, a real registry, real indexes |
| `postedDate` was derived per-source and conflated with discovery time | §22/§58: four distinct timestamps, never substituted |
| Dedupe was a single `jobKey()` string | §20: four deterministic stages with anti-overmerge guards |
| Mongo is optional (`db.js` degrades without `MONGODB_URI`) | §30: memory / file / Mongo behind one interface, no new infrastructure |

---

## 2. Files added

**Core** — `server/services/jobDiscovery/`

```
schema.js               canonical JobDocument, SourceInstance, source authority,
                        provenance + conflict recording, completeness flags
normalize/text.js       hashing, shingles, MinHash, date parsing, URL canonicalisation
normalize/taxonomy.js   ~45 role families with EXACT/ALIAS/STRONG/RELATED weights
normalize/entity.js     company + title normalization, seniority, employment type
normalize/location.js   location structuring, remote scope, location compatibility
normalize/compensation.js  explicit-only salary parsing incl. LPA / lakh / crore
normalize/index.js      adapter input → canonical document, hashes, provenance
dedupe.js               4-stage dedupe, anti-overmerge guards, blocking keys
freshness.js            status lifecycle, verification outcomes, date labelling
store.js                Memory / File / Mongo stores, all §40 indexes
sourceRegistry.js       JobSourceRegistry, health window, crawl priority
ingest.js               raw snapshot → normalize → dedupe → merge → persist
sourceDiscovery.js      self-expansion loop, ATS registration, robots-aware
ranking.js              no-resume relevance model with a relevance gate
searchIndex.js          JobSearchIndex abstraction, cursor paging, query cache
scheduler.js            CrawlScheduler, VerificationWorker, Metrics
index.js                JobDiscoveryService facade + wiring
atsDetect.js            12 provider signatures; DETECTED ≠ SUPPORTED
```

**Crawler** — `server/services/jobDiscovery/crawler/`

```
ssrf.js          protocol / DNS / reserved-range / redirect guards
httpClient.js    manual redirects, byte caps, conditional requests, error classes
rateControl.js   global + per-host semaphores, Retry-After, backoff, circuit breaker
robots.js        RFC 9309 parsing, ALLOW / DENY / REVIEW policy
extract.js       meta → JSON-LD → embedded JSON → links → sitemap
browserPool.js   one bounded Chromium, SSRF-checked navigations
```

**Adapters** — `server/services/jobDiscovery/adapters/`

```
base.js  greenhouse.js  lever.js  ashby.js  workable.js
smartrecruiters.js  genericCareerSite.js  aggregator.js  index.js
```

**Routes / UI / scripts / tests**

```
server/routes/jobDiscoveryRoutes.js
web/src/lib/jobDiscovery.js          canonical → UI mapping
web/src/lib/api.js                   + JobsV2 client
web/src/views/Jobs.jsx               migrated to the canonical index
scripts/job-discovery-gates.mjs      §64 gate runner
scripts/job-discovery-demo.mjs       §66 demonstration + §63 coverage report
scripts/job-discovery-worker.mjs     §26 worker (--once / --forever)
scripts/job-discovery-live-smoke.mjs §53 optional live smoke
test/jobDiscoveryNormalization.test.js
test/jobDiscoveryDedupeFreshness.test.js
test/jobDiscoverySearch.test.js
test/jobDiscoverySecurity.test.js
test/jobDiscoveryIntegration.test.js
test/fixtures/jobDiscovery/{providers,harness}.js
```

---

## 3. The honesty rules, and where each is enforced

These are the rules the spec cares most about. Each is enforced in code, not by
convention, and each has a test.

| Rule | Enforcement point |
|---|---|
| No fabricated posting dates | `parseSourceDate()` returns `null` on failure — it has no "now" fallback. `freshnessLabel()` is the only sanctioned date label and emits `kind: 'discovered'` whenever `sourcePublishedAt` is absent. The UI adapter writes `postedDate` **only** from `sourcePublishedAt`. |
| No fabricated salary | `normalizeCompensation()` parses explicit values only; `annualize()` is comparison-only and never written back. `salaryText()` returns `''` when nothing was stated. |
| No fabricated remote eligibility | `classifyWorkplace()` returns `REMOTE_SCOPE.UNKNOWN` for remote-with-no-scope-evidence. It cannot return `REMOTE_WORLDWIDE` without an explicit worldwide marker and no competing restriction. |
| No overmerging | `overmergeGuard()` blocks on different location, different seniority, or different title family **before** any dedupe stage can match. `requisitionConflict()` keeps distinct requisitions separate. |
| No deletion on transient failure | `observeSourceFailure()` preserves status. Only `applyVerification()` with a 404/410 or an explicit closed state, on the last active instance, sets `REMOVED`. |
| No silent overwrite of provenance | `recordProvenance()` pushes the losing value into `conflicts[field]` before the winner is written. |
| Aggregator never beats an original | `SOURCE_AUTHORITY` ordering, applied in `mergeJobs()` for every field and again for `canonicalApplyUrl`. |
| No LLM in dedupe | `dedupe.js` imports nothing but deterministic text utilities. |
| Search needs no candidate data | `rankJob(job, criteria)` has no parameter through which a resume could enter; the response states `personalization: { usedResume: false, ... }`. |

---

## 4. Quality gates

```
node scripts/job-discovery-gates.mjs      # or: npm run jobs:gates
```

```
✓ SOURCE_GATE        PASS    9 assertions  Source adapters
✓ INGEST_GATE        PASS   21 assertions  Raw → normalized ingestion
✓ DEDUPE_GATE        PASS    9 assertions  Deduplication
✓ FRESHNESS_GATE     PASS    8 assertions  Freshness & lifecycle
✓ SEARCH_GATE        PASS   21 assertions  Search & ranking
✓ SECURITY_GATE      PASS   53 assertions  Crawler safety
✓ INTEGRATION_GATE   PASS   17 assertions  Product integration
────────────────────────────────────────────────────────────
136 assertions, 0 failures
unattributed assertions: 0
OVERALL: PASS
```

Every test injects fetch, DNS, the clock and the jitter source. **No test
requires network access.**

---

## 5. Operating it

```bash
npm run jobs:tick        # one bounded slice of work
npm run jobs:worker      # long-running worker (local / container)
npm run jobs:demo        # fixture demonstration + coverage report
npm run jobs:gates       # the seven quality gates
npm run jobs:smoke       # optional live smoke (needs egress)
npm run test:jobs        # job-discovery tests only
```

On a serverless deployment there is no in-process `setInterval`. Drive the
scheduler with a cron trigger against:

```
POST /api/admin/job-discovery/tick
```

### Registering sources

```bash
curl -X POST /api/admin/job-discovery/sources \
  -d '{"url":"https://jobs.ashbyhq.com/somecompany"}'

curl -X POST /api/admin/job-discovery/sources \
  -d '{"provider":"GREENHOUSE","tenant":"somecompany","companyDomain":"somecompany.com"}'
```

Source discovery grows the registry on its own: an aggregator result that names
an employer triggers a careers-surface probe, the ATS is fingerprinted, the
tenant is extracted and the board is registered. From then on that employer's
jobs arrive from the original source with a real apply URL.

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `MONGODB_URI` | — | Mongo store when present; file store otherwise |
| `JOB_DISCOVERY_STORE` | auto | force `mongo` / `file` / `memory` |
| `JOB_DISCOVERY_DATA_DIR` | `.data/job-discovery` | file store location |
| `JOB_DISCOVERY_BROWSER` | `0` | `1` enables the Playwright fallback |
| `JOB_DISCOVERY_GLOBAL_CONCURRENCY` | `8` | crawler-wide in-flight cap |
| `JOB_DISCOVERY_HOST_CONCURRENCY` | `2` | per-host in-flight cap |
| `JOB_DISCOVERY_HOST_DELAY_MS` | `1000` | minimum spacing per host |
| `SMARTRECRUITERS_API_KEY` | — | optional; unlocks keyed mode |
| `SMARTRECRUITERS_REQUIRE_KEY` | `0` | `1` forces `NOT_CONFIGURED` without a key |

---

## 6. Crawler access policy

The system pursues aggressive **legitimate** coverage. It does not implement,
and must not be extended to implement:

- CAPTCHA bypass
- login / session theft
- authentication or access-control bypass
- proxy rotation intended to defeat blocks
- fingerprint evasion intended to bypass restrictions
- private API credential discovery

What it does implement: read robots.txt and honour it; honour the HTTP signals a
site returns; record a per-source `ALLOW` / `DENY` / `REVIEW` policy; and when a
source cannot be crawled legitimately, route around it and look for another
legitimate source for the same employer.

An unreachable `robots.txt` is `REVIEW`, never permission.

---

## 7. Measured limitations

Stated plainly, because they matter for the next phase.

1. **Coverage numbers in `reports/` are fixture measurements.** They describe
   the offline corpus in `test/fixtures/jobDiscovery/`, not production. Real
   coverage is whatever the deployed scheduler has ingested, and is reported by
   `GET /api/admin/job-discovery/coverage`.
2. **Live smoke did not run in this environment.** All four provider endpoints
   returned HTTP 403 through the sandbox egress proxy. The adapters are proven
   against recorded response shapes, not against live traffic. Run
   `npm run jobs:smoke` on a host with egress before trusting the HTTP path.
3. **The generic career-site crawler is never authoritative.** It cannot prove a
   page shows the complete vacancy list, so absence from it never closes a job.
   Only ATS board feeds carry that weight.
4. **Location normalization uses an explicit table**, not a gazetteer. Cities
   outside the Indian and US tables fall back to the comma-head heuristic and
   `country: null`. This is deliberate — a wrong country is worse than a null.
5. **Browser fallback is untested against live JS-heavy boards.** The pool is
   bounded and its failure path is tested, but `JOB_DISCOVERY_BROWSER=1` has not
   been exercised against a real single-page careers site.
6. **Salary comparison across currencies is not attempted.** A filter in one
   currency against a job in another returns `unknown`, not a converted figure.
7. **The aggregator sweep is query-driven.** Coverage from supplemental sources
   is bounded by the bootstrap query list, which is a deliberate trade against
   hammering those APIs.
8. **The Mongo store's text index is defined but unproven at scale.** It is
   created correctly; it has not been load-tested against millions of documents.

---

## 8. Final acceptance

| Requirement | Status |
|---|---|
| Search works with zero resume / profile | YES |
| User search reads canonical indexed jobs | YES |
| Search does not synchronously fan out across providers | YES |
| Greenhouse ingestion | PASS |
| Lever ingestion | PASS |
| Ashby ingestion | PASS |
| Workable ingestion | PASS |
| SmartRecruiters | Implemented; reports its configuration mode truthfully |
| Original-source provenance retained | YES |
| Canonical direct apply preferred | YES |
| Deduplication adversarial gate | PASS |
| Freshness gate | PASS |
| No fabricated published dates | YES |
| No fabricated salary | YES |
| No fabricated remote eligibility | YES |
| Closed jobs can be removed safely | YES |
| Transient failures do not immediately delete jobs | YES |
| Source registry persists | YES |
| Source discovery can add new sources | YES |
| Crawler SSRF gate | PASS |
| Per-host rate limiting exists | YES |
| Browser fallback is bounded | YES |
| Jobs UI uses Job Discovery OS | YES |
| Resume tailoring still delegates to Resume OS | YES |

```
JOB DISCOVERY FOUNDATION:          PASS
CANDIDATE-AWARE JOB INTELLIGENCE:  PENDING
```

---

## 9. Next phase

Built **on top of** this foundation, never as a substitute for real coverage:

- Candidate ↔ Job intelligence
- Evidence-aware reranking
- Gap analysis
- Application priority
- Early-apply opportunity score
- Resume tailorability

The first task of that phase is not a model. It is **source volume**: this phase
built the machine that grows the registry; the next phase should be run against
a registry with real breadth before any reranking claim is made.
