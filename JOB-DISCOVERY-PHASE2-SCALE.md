# Job Discovery OS — Phase 2: Scale Foundation

Phase 1.1 proved the *shape* was right: a canonical `JobDocument`, a source
registry, five ATS adapters, real dedupe, evidence-based freshness, and a
crawler that could not be talked into fetching an internal address.

Phase 2 answers a different question: **does it hold up as a network?**

Not "can we claim a big number" — the number is the easy part and the least
honest one. The questions that matter are whether jobs are real, direct,
fresh, deduplicated, findable, and whether the machine can be trusted not to
destroy its own index when a provider changes a class name.

---

## 1. What changed

| Area | Phase 1.1 | Phase 2 |
|---|---|---|
| Providers detected | 13 | **20** |
| Ingest-ready connectors | 5 | **20** (2 more detected but credential-gated) |
| Source discovery | in-process sweep | **durable queue** with dedupe, backoff, dead leads |
| Crawling | inline, single process | **durable queue**: leases, checkpoints, retries, dead-letter |
| Search retrieval | full scan + rank | **inverted index**, scored retrieval, bounded ranking |
| Query understanding | title family match | **deterministic parser**: role, tech, location, remote, seniority |
| Verification | fixed 7-day sweep | **adaptive tiering**, budget spent by value |
| Company knowledge | none | **CompanyRegistry** with confidence-ranked provenance |
| Change tracking | content hash | **change intelligence**: typed lifecycle events |
| Source failure | success rate only | **health assessment + reconciliation guard** |
| Metrics | one shape | **namespaced**: PRODUCTION vs FIXTURE, enforced in code |

---

## 2. Provider coverage

**Detection and support are separate facts, and the code keeps them separate.**
`DETECTED_PROVIDERS` is a strict superset of what we can ingest; the coverage
matrix reports `detected` / `connector` / `ingestReady` as three different
columns because collapsing them is how a provider count becomes a lie.

**Ingest-ready (20):** Greenhouse, Lever, Ashby, Workable, SmartRecruiters,
Workday, Oracle Recruiting (CE), Taleo, iCIMS, BambooHR, Recruitee, Personio,
Teamtailor, JazzHR, Jobvite, Pinpoint, Rippling, Zoho Recruit, the universal
career-site crawler, and the aggregator adapter.

**Detected but NOT ingest-ready (2):** Comeet and SuccessFactors. Neither
publishes an unauthenticated listing endpoint. They are fingerprinted and
registered — knowing a company runs Comeet is worth keeping — but ingestion
reports `NOT_CONFIGURED` until a deployment supplies the token the provider
itself issues. The alternative would be scraping around an access control,
which this system does not do.

### Two kinds of connector

**Hand-written** where the protocol is genuinely distinct: Workday (POST search
endpoint, offset pagination, bounded detail enrichment), Oracle CE (finder
syntax, exact totals), iCIMS (public portal structured data), plus the phase-1
five.

**Spec-driven** where providers differ only in URL shape, field names and
pagination. `adapters/spec/providerSpecs.js` declares them; one `SpecAdapter`
executes the declaration. Adding a board is a spec, not a rewrite — and every
provider inherits identical conditional-request, error-classification,
authoritative-listing and provenance behaviour, so a bug is fixed once.

### The `authoritative` flag is load-bearing

`authoritative` means *absence from this response is evidence the job closed*.
It is per-provider and per-page:

- a complete board listing → authoritative
- **page 1 of 3** → **not** authoritative
- a rendered board page (JSON-LD) → **never** authoritative
- an unparseable response → **never** authoritative

One bug found and fixed by the provider tests: a helper coerced a missing
listing path to `[]`, which made a schema change look like an *authoritative
empty board* — licence to close every job on it. A missing path is now
`SCHEMA_CHANGED`.

---

## 3. Autonomous source discovery

```
company domain → careers page → ATS detected → tenant identified
   → source registered → validated → crawled → scheduled
```

Every arrow is a durable task carrying `kind`, `key`, `state`, `attempts`,
`nextAttemptAt`, `failureReason`, `confidence`, `discoveredFrom`.

`key` is the canonical dedupe identity. `acme.com`, `ACME.com` and
`https://www.acme.com/careers` are **one** lead. Enqueueing an existing key
enriches its evidence; it never creates a second task and never resets a
backoff a string of failures earned.

- transient failure → exponential backoff (6h → 30d, 6 attempts)
- attempts exhausted → `EXHAUSTED`, **retained as a record**, never deleted
- robots denial / SSRF block → `DEAD` immediately, never retried
- resolved → rechecked in 21 days, because companies switch ATS vendors

The strongest lead is free: an aggregator's *apply URL* frequently **is** the
original board. `leadsFromJob` extracts it at priority 100, well above a domain
we would otherwise have to probe.

### CompanyRegistry

Jobs churn, sources churn slowly, and what a company *is* barely changes at all
— which makes it the most expensive thing to rediscover. Before probing a
domain, discovery asks the registry, and skips the network entirely when the
company already has a known ATS tenant, a registered source, or five failed
attempts on record. Provenance is confidence-ranked, so a domain guessed from a
job posting can never overwrite one the company's own careers page stated.

---

## 4. Production ingestion

The crawl queue sits between the registry and the workers.

**Idempotency** — the task id derives from `(sourceId, due-window)`. Two cron
triggers in one window produce one task, not two crawls of someone's board.

**Leases** — a leased task is invisible to other workers; an expired lease is
reclaimable, so a worker that dies mid-crawl strands nothing.

**Checkpoints** — the page cursor is persisted on the task. A crash on page 40
costs one page, not a board.

**Retries and dead-letter** — transient failures back off with jitter (so a
fleet does not synchronise onto one host). `ROBOTS_DENIED`, `SSRF_BLOCKED`,
`AUTH_REQUIRED`, `NOT_CONFIGURED` skip retries entirely. Exhausted tasks are
dead-lettered **with their error**, requeueable by an operator, never dropped.

**Host fairness** — `interleaveByHost` prevents one employer with hundreds of
boards from filling every worker slot.

### The guard that matters most

The worst failure in a job index is not a crawler that stops. It is a crawler
that keeps working and returns nonsense: a provider ships a markup change, the
parser still returns HTTP 200, and now finds 3 jobs on a board that had 400.
Reconciliation closes 397 live postings and the dashboard stays green.

So a successful crawl is not automatically trusted. `assessRun` compares each
run against the source's own recent history:

- volume collapse below 40% of the recent median
- zero jobs after a populated history
- a parse-failure spike
- a titleless-row spike
- an adapter-reported schema change

Any high-severity anomaly → the run is **not credible** → reconciliation is
**blocked**, the source is marked `DEGRADED`, the anomaly is recorded with
`destructiveActionsBlocked: true`, and **every existing job is retained
untouched**. A source that recovers returns to `ACTIVE` on its own.

The asymmetry is deliberate: wrongly keeping a closed job costs one wasted
click; wrongly deleting 400 live jobs costs the product its credibility.

---

## 5. Search architecture

```
query → understanding → index retrieval → bounded candidates → deterministic rerank
```

**Inverted index** with dense integer doc ids, ascending posting lists,
tombstoned deletes and amortised compaction. Postings cover title terms, body
terms, families, companies, countries, cities, workplace, employment type,
seniority, source class, status, provider, remote regions, direct-apply and
dated-ness.

**Scored retrieval, not a blind slice.** `retrieve()` scores *every* match with
a cheap prefilter, then quickselects the top N. A first-N slice of a posting
list would silently hide relevant jobs — which is exactly the failure the scale
gate exists to catch.

**Retrieval reports the truth**: `{ matchedTotal, candidatesRanked, truncated,
strategy }`. Matched and ranked are different numbers and the payload says so.

**Disjunctive filters must never drive a scan.** An employment-type filter also
accepts `UNKNOWN`; a location filter also accepts unrestricted remote roles with
no offices. Driving the scan from the narrow half silently deletes the other
half, so equalities drive and disjunctions are explicit unions.

**Backends.** MongoDB Atlas Search is preferred where configured; the fallback
to indexed `$text` is *recorded as a degradation in stats*, never hidden.

### Query understanding

Deterministic. No LLM, no candidate data, no resume required.

| Query | Understood as |
|---|---|
| `Java backend` | JAVA_ENGINEER + BACKEND_ENGINEER, tech `java` |
| `AWS DevOps` | DEVOPS_ENGINEER + CLOUD_ENGINEER, tech `aws` |
| `Remote data engineer India` | DATA_ENGINEER, location India, remote |
| `platform engineer kubernetes` | PLATFORM_ENGINEER + KUBERNETES_ENGINEER |
| `fresher software engineer` | SOFTWARE_ENGINEER, seniority ENTRY |
| `senior python developer in Pune` | PYTHON_ENGINEER, Pune, SENIOR |

Relation weights: EXACT 1.0 → ALIAS → STRONGLY_RELATED → RELATED → WEAK 0.16,
with second-degree weak relations *derived* from strong-of-strong rather than
hand-listed.

**Inferred signals score; they never exclude.** Only criteria the user stated
explicitly can hard-fail a job. A location the parser guessed changes ranking,
not membership.

One bug found this way: the location parser fell back to "treat the head of the
string as a city", which turned *"DevOps Engineer"* into a city and emptied
every result set. A city must now resolve to a real country code.

---

## 6. Freshness

Six distinct timestamps, never conflated:

`sourcePublishedAt` · `firstSeenAt` · `lastSeenAt` · `lastVerifiedAt` ·
`lastChangedAt` · `closedAt`

**A discovery time is not a posting date.** When a source states no date, the
date stays null. Workday's `"Posted 3 Days Ago"` is display text and is
discarded; only the detail endpoint's `startDate` becomes a posting date.

Verification is **adaptive**, not a fixed sweep:

| Tier | Interval | Earned by |
|---|---|---|
| URGENT | 1h | flagged, or missing from its source |
| HOT | 12h | new, direct-sourced, high completeness |
| WARM | 48h | recent and active |
| STEADY | 7d | established |
| COLD | 14d | old, low velocity |
| DORMANT | 30d | very old — verified rarely, **never dropped** |

Budget is spent highest-value first. A fresh direct-ATS posting is worth many
more re-checks than a four-month-old aggregator record, and spending the budget
in id order wastes it on whatever happens to sort first.

**Original-source preference** is tracked, not assumed: company careers site >
original ATS > trusted feed > aggregator, surfaced as `directSourceRate` and
`directApplyRate`.

---

## 7. Change intelligence

A posting is not a static row. Typed events: `JOB_CREATED`, `TITLE_CHANGED`,
`SALARY_CHANGED`, `LOCATION_CHANGED`, `REMOTE_POLICY_CHANGED`,
`EMPLOYMENT_TYPE_CHANGED`, `SENIORITY_CHANGED`, `DESCRIPTION_CHANGED`,
`SOURCE_ADDED`, `JOB_CLOSED`, `JOB_REOPENED`.

The failure this prevents: **an edit becoming a duplicate.** A description tweak
that changes the content hash updates *one* canonical record and emits
`DESCRIPTION_CHANGED`. Only a material change (≥8% body shift) is logged, so
boilerplate churn does not drown the signal that a role was genuinely re-scoped.

---

## 8. Coverage metrics

Namespace separation is **enforced in code, not documented in prose**.

`computeCoverage()` throws without an explicit `PRODUCTION` or `FIXTURE`
namespace. `mergeSnapshots()` throws on a namespace mismatch. A default would be
exactly how benchmark numbers end up on a page labelled "coverage".

Every fixture snapshot carries: *"FIXTURE DATA — deterministic benchmark corpus.
These numbers measure the engine, not real-world job coverage."*

---

## 9. The 100,000-job benchmark

`npm run jobs:scale` — deterministic corpus, same seed, same corpus byte for
byte. A benchmark whose input drifts cannot tell you whether a regression is in
your code or your data.

The corpus deliberately contains the awkward cases: 7,479 duplicate
cross-postings, 4,686 closed jobs, 2,802 stale, 10,955 undated, 13,757
aggregator-only, 10,154 scoped-remote, 10,286 multi-location, and 3 rare titles
that exist exactly once each.

### Results

| Metric | Result |
|---|---|
| Normalization | 6,836 jobs/sec |
| Index build | 12,642 jobs/sec |
| Memory | 687 MB corpus + index (~7.2 KB/job) |
| Dedupe | 3,191 candidate lookups/sec |
| **Search P50** | **79.6 ms** |
| **Search P95** | **141.7 ms** |
| Search P99 | 150.8 ms |
| Candidates ranked | mean 738 (index matched mean 33,391) |
| Rare-title recall | **PASS** — all 3 at rank 1 |
| Closed-job leak | **PASS** — zero |
| Scheduler fairness | 7/7 hosts in the first 7 slots |

**The correctness property matters more than the throughput.** A one-in-100,000
posting ranks **first**, while the ranker only ever sees ~738 of 33,391 matches.
That is the whole point: bounded work, unbounded reach. A relevant job cannot
disappear behind a scan limit.

### Three bugs the benchmark found

1. **Dedupe at 15 lookups/sec.** Every fixture company shared one registrable
   domain, making the company blocking key match the entire corpus. Fixed in the
   fixture *and* hardened in the store: `findCandidates` is now bounded per key,
   with precise keys ordered first so a saturating broad key can never crowd out
   the exact match. **15 → 3,191 lookups/sec.**

2. **Zero duplicates detected.** The fixture coalesced `requisitionId: null` to a
   generated id, giving each duplicate a *different* requisition number — so the
   anti-overmerge guard correctly refused every one. The guard was right; the
   fixture was wrong. `undefined` now means unspecified, `null` means the source
   published none.

3. **Retrieval slower than ranking.** Title tokens and source authority were
   re-derived for every one of 33,000 matched documents on every query. Both are
   now precomputed once at insert. **P50 100 ms → 80 ms.**

---

## 10. Relevance evaluation

`npm run jobs:relevance` — twelve graded benchmarks against **one shared
corpus**, so every "irrelevant" distractor is genuinely indexed. A per-query
corpus would let a search engine pass the leak check by never indexing the
distractor at all.

| Metric | Result |
|---|---|
| Benchmarks ordering-clean | 12/12 |
| Mean nDCG@5 | 0.976 |
| Min nDCG@5 | 0.936 (platform) |
| Irrelevant leaks | 0 |
| Query understanding | 6/6 |

One grading error was found and fixed **in the benchmark, not the engine**: for
`"Java Backend"`, both *Spring Boot Developer* and *Backend Engineer* resolve to
exact-family matches, so demanding an ordering between them would have meant
tuning the engine to the test. The benchmark now grades against roles that
occupy genuinely different relation classes.

---

## 11. Gates

```
✓ SOURCE_GATE                  10   Source adapters (phase 1)
✓ SOURCE_EXPANSION_GATE        15   Provider expansion
✓ DISCOVERY_GATE               10   Autonomous source discovery
✓ INGEST_GATE                  32   Ingestion & crawl queue
✓ DEDUPE_GATE                  10   Deduplication
✓ FRESHNESS_GATE               11   Freshness & lifecycle
✓ SEARCH_GATE                  24   Search & ranking (phase 1)
✓ SEARCH_RELEVANCE_GATE         6   Graded relevance
✓ SEARCH_SCALE_GATE            10   Retrieval at scale
✓ SECURITY_GATE                55   Crawler safety
✓ MANUAL_INGEST_GATE           12   Operator-triggered ingestion
✓ INTEGRATION_GATE             23   Product integration
✓ RESUME_OS_REGRESSION_GATE   247   Resume OS / Template OS regression

212 job-discovery assertions + 247 regression checks, 0 failures
unattributed assertions: 0
```

A gate with no assertions reports **NO COVERAGE**, never PASS — "nothing ran"
and "everything passed" must not look alike. Gates that name required subjects
report **INCOMPLETE** if those subjects are untested, so a gate cannot go green
while testing nothing that matters.

`RESUME_OS_REGRESSION_GATE` compares against a baseline recorded from the
**pristine pre-phase-2 package**, answering "did phase 2 break anything?" rather
than "does everything pass in this environment?". Two suites fail identically
before and after (a missing optional dependency); they are reported as
**inherited**, not as new damage.

---

## 11a. Manual ingestion (operator-triggered fetch)

Everything above is autonomous, which is right for steady state and useless for
the two moments an operator actually has: *"seed the index with these 40
employers, now"* and *"this company just posted — pull it before tonight's
tick."*

So there is a one-shot path. Give it targets, it registers them, crawls them,
and persists the jobs into **the same canonical store the workers write to** —
searchable through the ordinary index immediately. There is no separate
"manually fetched" collection and no second read path.

### Targets

An operator pastes whatever they have; the classifier works out what it is:

| Input | Understood as |
|---|---|
| `https://boards.greenhouse.io/acme` | ATS board → provider + tenant |
| `https://acme.wd3.myworkdayjobs.com/en-US/External` | ATS board → `acme/wd3/External` |
| `https://acme.com/careers` | careers page → classify, then register |
| `acme.com` | company domain → probe for a careers surface |
| `src_a1b2c3` | an already-registered source |

Hostnames are validated, not just normalized: `not a target` is **rejected**
rather than becoming a discovery lead that probes a nonsense host.

### What an admin trigger does NOT get

A human in the loop is the path most likely to be handed powers it should not
have, so the guards are explicit and tested:

| Guard | Still applies |
|---|---|
| SSRF-guarded HTTP client | yes, unchanged |
| robots + source access policy | yes — a `REVIEW` source is **not** crawled because someone clicked |
| adapter configuration | yes — `NOT_CONFIGURED` is reported, never treated as an empty board |
| source-health credibility | yes — a manual fetch of a broken board **cannot close jobs it failed to see** |

The only things a manual run changes are **when** work happens and **who** asked
for it. Both are recorded.

### Bounded and idempotent

One click cannot start an unbounded crawl: 50 targets per run, 20 pages per
source, 400 pages per run — and the response says when a cap was hit rather than
quietly stopping. Re-running the same fetch is safe and expected: the second run
registers nothing new, re-crawls the board, and dedupe folds the results onto the
same canonical jobs. It updates; it never duplicates.

### Modes

- **INLINE** — crawl now, return what landed. For a handful of boards.
- **QUEUE** — register and enqueue at high priority with a 5-minute idempotency
  window, so an operator request is not swallowed by the source's ordinary
  6-hour window. For large batches, where holding an HTTP request open for 200
  boards would be a bad idea.

### Receipts

Every non-dry run writes a receipt: who triggered it, why, what was attempted and
what landed. A dry run is a question, not an event, and deliberately leaves no
receipt.

### Surfaces

```
POST /api/admin/job-discovery/fetch      { targets, mode, dryRun, maxPages, reason }
GET  /api/admin/job-discovery/runs       past receipts
GET  /api/admin/job-discovery/runs/:id   one receipt
GET  /api/admin/job-discovery/jobs       browse the canonical store
```

```bash
npm run jobs:fetch -- https://boards.greenhouse.io/acme acme.com
npm run jobs:fetch -- --file targets.txt --dry-run
npm run jobs:fetch -- --file targets.txt --queue
npm run jobs:runs
```

Plus an admin panel (`web/src/views/AdminJobIngestPanel.jsx`) that shows the
per-target outcome including the boring failures — *"source access policy is
REVIEW; approve the source first"* is the most useful thing an operator can be
told, because it names the next action.

The panel's "In the store" list reads the **store**, not the receipt. The receipt
says what we think happened; that list says what is actually there. If they ever
disagree, the operator sees it.

### Two bugs this work surfaced

1. **Stale search cache after ingestion.** A cached "no results" outlived the
   fetch that would have answered it — so an admin clicked *fetch now*, the jobs
   landed, and search kept saying "nothing found" for the rest of the 60-second
   TTL. The store now carries a write generation and the search layer invalidates
   on any corpus change.

2. **Duplicate in-flight crawls per source.** An operator's "fetch now" and the
   source's routine window could both be queued, so one tick crawled the same
   board twice. Window idempotency alone could not catch it — the scheduler now
   skips routine enqueues for sources that already have work in flight.


---

## 12. Limitations

**Real-world live coverage is NOT YET MEASURED.** Every number above is fixture
data. The engine is measured; actual job coverage is not, and cannot be until
real sources are registered and crawled against live boards.

**P50 is fixture-flattered — in the harder direction.** The corpus has 53
distinct titles, so one family query matches 33% of 100k documents. Real corpora
have far more diverse term distributions, so real match sets are smaller. The
80 ms figure is a pessimistic bound, not an optimistic one.

**Comeet and SuccessFactors are detected but not ingest-ready.** They need a
deployment-supplied token. SuccessFactors career sites also have no single
public URL shape; the endpoint must be configured per tenant.

**HTML/JSON-LD providers are never authoritative.** Teamtailor, JazzHR, Zoho
Recruit, Jobvite, Taleo and iCIMS read structured data from public board pages.
Absence there can never close a job — a deliberate trade of closure latency for
safety.

**Memory backend is single-process.** The queues are distributed-safe *by
design* (atomicity lives in the store, via `findOneAndUpdate` on Mongo), but
multi-worker operation is only real on the Mongo backend.

**Candidate ↔ job intelligence is out of scope** and remains pending, as
specified.

---

## 13. Commands

```bash
npm run jobs:gates          # all 13 gates
npm run jobs:gates:quick    # skip the Resume OS regression sweep
npm run jobs:scale          # 100k benchmark
npm run jobs:scale:quick    # 20k benchmark
npm run jobs:relevance      # graded relevance evaluation
npm run jobs:fetch -- <targets…>   # operator-triggered fetch
npm run jobs:runs           # past manual-fetch receipts
npm run test:jobs           # job-discovery tests only
npm run jobs:worker         # run the queue-driven worker
npm run jobs:tick           # one scheduler tick
```

Reports land in `reports/`:
`job-discovery-gates.json` · `job-discovery-scale-benchmark.json` ·
`job-discovery-relevance.json`
