## Job Discovery OS — Manual ingestion

An operator-triggered fetch path, so the index can be seeded and topped up on
demand rather than only by the scheduler. Fetched jobs land in the SAME canonical
store the autonomous pipeline writes to and are searchable through the ordinary
index immediately — there is no separate collection and no second read path.

### Added
- **`manualIngest.js`** — one-shot orchestrator. Accepts board URLs, careers
  pages, company domains or source ids, classifies each, registers what is new,
  crawls it, and reports per-target outcomes.
- **Admin routes**: `POST /api/admin/job-discovery/fetch`,
  `GET /runs`, `GET /runs/:id`, `GET /jobs` (browse the canonical store).
- **`scripts/job-discovery-fetch.mjs`** — the terminal equivalent, with
  `--file targets.txt` (comments and blank lines allowed), `--dry-run`,
  `--queue`, `--runs`, `--json`.
- **Ingest-run receipts** — a seventh store collection across all three backends.
  Every non-dry run records who triggered it, why, what was attempted and what
  landed, so "what did last night's fetch do?" survives the browser tab.
- **`AdminJobIngestPanel.jsx`** — admin UI showing per-target outcomes including
  the actionable failures, plus a store-backed verification list.
- **Two run modes** — INLINE (crawl now) and QUEUE (enqueue at high priority with
  a 5-minute idempotency window, so an operator request is not swallowed by the
  source's ordinary 6-hour window).
- **`MANUAL_INGEST_GATE`** — 12 assertions covering canonical storage,
  idempotency, bounds, dry-run inertness, receipt persistence, and each guard a
  human trigger must not bypass.

### Fixed
- **Search served stale results after an ingest.** A cached "no results" outlived
  the fetch that would have answered it, so a manual fetch appeared to do nothing
  until the 60-second TTL expired. The store now carries a monotonic write
  generation and the search layer invalidates its cache on any corpus change.
- **A source could have two crawl tasks in flight at once.** An operator's "fetch
  now" plus the source's routine window meant one tick crawled the same board
  twice — wasteful for us and rude to the host. The scheduler now skips routine
  enqueues for sources with work already in flight.
- **`registrableDomain()` was used as a validator.** It is a normalizer and will
  return `"not a target"` unchanged, which would have turned an operator's typo
  into a discovery lead probing a nonsense host. Targets are now hostname-checked
  before being accepted as domains.

### Guarantees
- An admin trigger is not an authorisation bypass: SSRF guards, robots and source
  access policy, adapter configuration honesty and the source-health credibility
  guard all apply exactly as they do to a scheduled crawl. A manual fetch of a
  board whose parser just broke **cannot close the jobs it failed to see**.
- Bounded by construction: 50 targets per run, 20 pages per source, 400 pages per
  run, with the cap reported rather than silently applied.
- Idempotent: re-running the same fetch updates the canonical records and never
  creates duplicates.

### Validation
- 13 gates PASS: 212 job-discovery assertions + 247 Resume/Template OS regression
  checks, 0 failures, 0 unattributed.

## Job Discovery OS — Phase 2: Scale Foundation

Turns the phase-1.1 foundation into an autonomous discovery network. Optimised
for jobs that are real, direct, fresh, deduplicated and findable — never for a
larger job count.

### Added
- **Provider expansion to 20 ingest-ready connectors.** New: Workday (public
  candidate-experience POST endpoint, offset pagination, bounded detail
  enrichment), Oracle Recruiting CE, iCIMS, Taleo, BambooHR, Recruitee,
  Personio (XML feed), Teamtailor, JazzHR, Jobvite, Pinpoint, Rippling, Zoho
  Recruit. Comeet and SuccessFactors are detected and registered but report
  `NOT_CONFIGURED` — neither publishes an unauthenticated listing endpoint.
- **Spec-driven adapter engine** (`adapters/spec/`). Providers that differ only
  in URL shape, field names and pagination are declared, not rewritten, so all
  of them inherit identical conditional-request, error-classification,
  authoritative-listing and provenance behaviour.
- **Durable source-discovery queue** (`discoveryQueue.js`). Canonical dedupe
  keys, exponential backoff, permanent-failure classification, 21-day recheck of
  resolved leads. The same company is never rediscovered.
- **Durable crawl queue** (`crawlQueue.js`). Idempotency keyed on
  `(sourceId, due-window)`, worker leases with automatic reclaim, mid-crawl
  checkpointing, jittered retries, dead-letter with retained errors, host-fair
  ordering. Atomicity lives in the store, so it is distributed-safe on Mongo.
- **Inverted search index** (`invertedIndex.js`). Dense doc ids, tombstoned
  deletes with amortised compaction, precomputed scoring metadata. Retrieval
  scores every match and quickselects the top N — never a blind first-N slice.
- **Query understanding** (`normalize/queryUnderstanding.js`). Deterministic,
  no LLM, no candidate data: role families, ~90 technology tokens, location,
  remote intent and seniority parsed from free text.
- **Adaptive verification** (`verificationPolicy.js`). Six tiers from URGENT
  (1h) to DORMANT (30d), earned from age, source class, velocity, volatility and
  status. Budget is spent highest-value first.
- **CompanyRegistry** (`companyRegistry.js`). Confidence-ranked provenance;
  short-circuits discovery for companies already resolved or repeatedly failed.
- **Change intelligence** (`changeIntelligence.js`). Typed lifecycle events. An
  edit updates one canonical record and can never become a duplicate.
- **Source health & self-healing** (`sourceHealth.js`). Volume collapse, empty
  board, parse-failure spike and schema-change detection.
- **Namespaced coverage metrics** (`coverageMetrics.js`). `PRODUCTION` vs
  `FIXTURE` enforced in code: unlabelled snapshots throw, cross-namespace merges
  throw.
- **Search quality evaluator** (`searchQualityEvaluator.js`) — 12 graded nDCG
  benchmarks plus 6 query-understanding benchmarks.
- **Deterministic 100k scale corpus** (`scaleCorpus.js`) and benchmark
  (`scripts/job-discovery-scale.mjs`).
- New gates: `SOURCE_EXPANSION_GATE`, `DISCOVERY_GATE`, `SEARCH_RELEVANCE_GATE`,
  `SEARCH_SCALE_GATE`, `RESUME_OS_REGRESSION_GATE`.

### Fixed
- **A broken parser can no longer close a board's jobs.** Reconciliation now
  requires both an authoritative complete listing *and* a credible run assessed
  against the source's own history. Incredible runs mark the source `DEGRADED`,
  record the anomaly, and retain every job untouched.
- **A missing listing path is no longer an "authoritative empty board."** The
  spec engine coerced an absent array to `[]`, which was licence to close every
  job on the board; it is now classified `SCHEMA_CHANGED`.
- **Workday tenant extraction skipped the locale segment.** `/en-US/External`
  parsed as site `en-US`, producing board URLs that 404 for every job.
- **`"Posted 3 Days Ago"` is never treated as a posting date.** Only Workday's
  detail-endpoint `startDate` becomes one.
- **Disjunctive filters no longer drive a scan from one branch.** Employment-type
  filters include `UNKNOWN`; location filters include unrestricted remote roles.
- **The location parser no longer invents cities.** "DevOps Engineer" was being
  read as a city, emptying every result set; a city must now resolve to a real
  country code.
- **Dedupe candidate fan-out is bounded per blocking key**, with precise keys
  ordered first, so a broad key cannot make ingestion an O(N) scan
  (15 → 3,191 lookups/sec at 100k).
- **Retrieval no longer re-derives title tokens and source authority per
  matched document** (search P50 100 ms → 80 ms at 100k).

### Validation
- All 12 gates PASS: 200 job-discovery assertions + 247 Resume/Template OS
  regression checks, 0 failures, 0 unattributed.
- 100k benchmark: P50 79.6 ms, P95 141.7 ms, rare 1-in-100k titles retrieved at
  rank 1, zero closed-job leaks, 687 MB (~7.2 KB/job).
- Relevance: 12/12 ordering-clean, mean nDCG@5 0.976, zero irrelevant leaks,
  6/6 query understanding.
- Resume OS and Template OS compared against a baseline recorded from the
  pristine pre-phase-2 package: no new failures. Two pre-existing failures are
  reported as inherited and are unchanged.

### Known limitations
- **Real-world live coverage is NOT YET MEASURED** — every figure above is
  fixture data measuring the engine, not job coverage.
- Comeet and SuccessFactors require deployment-supplied credentials.
- JSON-LD board providers are never authoritative, so absence there cannot close
  a job.
- Multi-worker operation is real only on the Mongo backend.
- Candidate ↔ job intelligence remains out of scope.

## Job Discovery OS — Phase 1.1 Merge + Production Hardening

### Fixed
- Rebased Job Discovery onto the final frozen Resume OS instead of the older application branch.
- Removed user-search fallback to synchronous legacy provider fan-out; Jobs now uses the canonical indexed `/jobs/search-v2` path only.
- Unified worker/API Mongo persistence and made configured Mongo fail closed instead of silently selecting a local file index.
- Replaced first-N search/discovery/verification scans with store-level indexed/due candidate selection.
- Preserved server discovery ranking in the Jobs UI and wired the visible experience filter to Job Discovery.
- Made `REVIEW` non-executable crawl policy; only explicit `ALLOW` sources can be crawled.
- Typed durable Mongo source-discovery scheduling and persisted source health/discovery metadata previously dropped by strict schemas.
- Removed immutable `_id` from Mongo `$set` upserts.
- Switched Workable direct ingestion to the documented public account jobs endpoint.

### Validation
- Job Discovery quality gates and scale-hardening assertions pass.
- Frozen Resume OS core/render gates remain PASS.

## Resume Tailoring — Phase 1 Hardening + Narrative Intelligence V2

### Added
- **AI deny boundary** (`server/services/resumeTailoring/aiBoundary.js`) — AsyncLocalStorage
  transaction guard. Any generative provider invoked inside a tailoring
  transaction throws `AI_CALL_INSIDE_TAILORING_BOUNDARY`, at any nesting depth.
- **Canonical tailoring service** (`canonicalTailoringService.js`) — one business
  entry point, eight operations. `/tailor-narrative`, `/narrative/preview` and
  `/assist` now delegate here instead of running independent intelligence.
- **Mode + depth strategy** (`modes.js`) — six modes, two depths. Every declared
  key is consumed; a test fails if one is added without a consumer.
- **Requirement graph** (`requirementGraph.js`) — AND/OR requirement groups with
  SUPPORTED / PARTIALLY_SUPPORTED / TRANSFERABLE / UNSUPPORTED states, plus
  separate equivalence and relatedness graphs.
- **Fail-closed leakage audit** (`requirementLeakage.js`) — unsupported requirement
  terms are REVERTED, not warned about; run returns `TAILORING_PARTIAL`.
- **De-nominalisation composition family** — un-buries verbs hiding in nouns
  ("deployment configuration of X" → "Configured X deployments").
- **Outcome-carrying summary structures** — identity + domain + tooling, then one
  evidence-bound quantified achievement.
- Audit regression fixtures A/B/C and ten named adversarial fixtures.
- `docs/RESUME-TAILORING-ARCHITECTURE.md`, `docs/NARRATIVE-INTELLIGENCE-V2.md`.

### Fixed
- **Kubernetes leak.** `openshift implies kubernetes` in the skill adjacency table
  made "Kubernetes" claimable vocabulary for OpenShift-only candidates. Split into
  claimable `implies` (GitLab CI → CI/CD) and non-claimable `substrate`
  (OpenShift → Kubernetes).
- **Evidence tracing punished good rewriting.** `scoreEvidence()` used exact
  substring matching, so "configured" did not trace to "configuration". Now
  stem-based.
- **Candidates truncated before scoring.** Depth's `alternativesPerBullet` cut the
  candidate list by generation order in the composer, discarding the de-nominalised
  family before the reranker saw it. Selection now belongs to the reranker.
- **Domain vocabulary leak.** Summary intent phrasing described a marketing manager
  as working "across build and release engineering". Intent registers are now
  role-family aware.
- Nominalisation-density penalty added to naturalness scoring.

### Changed
- Resume tailoring consumes a dedicated **`tailoring`** quota bucket, not `aiCalls`
  (free 30/day). Billing a deterministic operation as an AI call misdescribed it.
- UI copy: "Tailor with AI" → "Tailor for This Job"; all "AI tailoring" strings removed.
- Benchmark now reports **separate safety and quality gates** and **both**
  useful-rewrite-rate denominators.

### Deliberate test contract changes
- `skills: semantic normalisation` → asserts claimable-implication vs substrate.
- `hardening` quota mapping → `/api/resume/tailor` maps to `tailoring`.
Neither weakened a truth check; both tightened one.

### Fixed — resume import (the reason deterministic output looked unformatted)
- **PDF extraction collapsed each page into a single line.**
  `extractResumeText()` joined every pdfjs text fragment with a space and
  emitted one newline per page, so a two-page resume arrived as two lines.
  `sliceSections()` splits on newlines and requires a section header alone on a
  line, so **no section could ever be detected in a PDF import** — the document
  reached the renderer with no structure and was laid out as one block of text.
  Lines are now reconstructed from pdfjs baseline geometry, with spaces
  inserted only at real horizontal gaps.
- **Letter-spaced headings** ("A K A N S H  M O W A R") are collapsed, with a
  run-length guard so "A B testing" and "J. R. R." survive.
- **Blob recovery in `sectionDetector`.** When text still arrives as a wall
  (paste, geometry-free PDF, odd producer), inline section headers are
  re-broken onto their own lines instead of dumping everything into `preamble`.
- **Compound headers.** "EDUCATION & CERTIFICATIONS" is treated as one header
  whose body is shared, instead of splitting into an orphan "&".

## Resume OS — Part 4 truth hardening (pre-Phase 3)

### Added
- **Action-semantic validator** (`narrative/actionSemantics.js`, Part 4.2). 28 verb
  families; substitution within a family is safe, across families fails closed.
  `wrote → launched` FAIL, `rebuilt → consolidated` FAIL, `wrote → authored` PASS.
  Placeholder openers ("responsible for", "worked on") are treated as the absence
  of an action, not an unknown one — what verb may replace them is governed by the
  seniority ceiling, which is the correct home for that question.
- **Truth check registry** (`narrative/truthCheckRegistry.js`, Part 4.4). Named
  verdicts with four states. Every mandatory validator starts NOT_RUN and must be
  moved to PASS explicitly; `safe` requires all blocking checks to be satisfied.
  NOT_APPLICABLE is deliberately distinct from NOT_RUN: "does not apply here" is
  not "we could not check".
- Employer/client grounding heuristic, scoped per sentence.

### Fixed
- **Composer verdicts were not propagating to the audit stage.** Latent, and
  masked by the old default-PASS: once defaults became NOT_RUN, every bullet
  reverted. Verdicts now flow composer → selection → audit, for bullets and
  summaries alike.
- **Generic capability nouns were being vocabulary-banned.** "analysis",
  "monitoring", "reporting" entered `forbiddenTerms` whenever a JD mentioned them
  and the candidate lacked them as a listed skill, which suppressed the entire
  finance summary ("analysis and reporting" is a description of the work, not a
  product claim). Named tools such as SQL remain forbidden; ordinary nouns do not.
- Employer grounding scanned only the document's first word for sentence-initial
  capitalisation, so a second sentence's opening verb ("Automated") read as an
  invented organisation. Now scoped per sentence, and known technologies are
  excluded since `skillContext` owns them.

### Changed
- `employer` demoted from blocking to **advisory**. It is a capitalisation
  heuristic and was suppressing whole summaries on 3 of 12 fixtures. Invented
  entities are already caught by `entity`, which validates against the evidence
  graph rather than letter case.
- Useful rewrite rate 0.857 → 0.714 (10/14). Two rewrites are now correctly
  rejected for changing the claimed action. This is the intended trade.

## Resume OS — Part 3 (responsibility ceiling) + Part 4 (evidence scope)

### Added
- **`narrative/responsibilityScale.js`** — separates Candidate Seniority Ceiling
  from Evidence Responsibility Ceiling on a 9-level scale (EXPOSURE→STRATEGY).
  The binding ceiling is the LOWER of the two. Seniority makes strong language
  plausible; only the statement's own evidence makes it true.
  `Responsible for X → Owned X`, `Worked on X → Led X` and
  `Helped implement X → Architected X` now FAIL with `responsibility_inflation`.
  Execution-tier verbs (below RESPONSIBLE) are not authority claims and remain
  governed by actionSemantics.
- **`test/resumeResponsibilityScope.test.js`** — 14 regression tests.

### Fixed
- **Cross-record skill leakage (Part 4).** `globalPermittedSkills` authorised a
  technology document-wide, so a Terraform role licensed Terraform inside an
  unrelated Jenkins bullet — true of the person, false of the job. Authorisation
  is now RECORD-scoped. `skillContext` fails independently with a distinct
  `cross_record_skill_leakage` code, kept separate from `fabricated_technology`
  so "used elsewhere" and "never used" stay distinguishable.
  Umbrella restatement within the same record (GitLab CI → CI/CD) still passes.

### Known regression — reported, not hidden
- Useful rewrite rate **0.714 → 0.286** (4/14). `unchangedDespiteEvidence` rose
  to 10 with **zero safety reversions**: the stricter ceilings mean surviving
  candidates sit closer to the original and no longer clear the substantive-change
  threshold. Safety gate PASSES; quality gate FAILS on usefulRewriteRate — which
  is the benchmark behaving as designed. Recovering usefulness needs additional
  composition families within the evidenced responsibility level, not a relaxed gate.

## Resume OS — Phase A (writing quality recovery) + Phase B1 (release gates)

### Added
- **`narrative/objectVerbFit.js`** — verb/object collocation model. "Ran deployment
  configuration" is truthful and unidiomatic; without this the reranker could not
  tell it apart from "Configured deployments", so a two-word synonym swap kept
  beating a real rewrite. Whitelist of collocations rather than a blacklist of
  awkward pairs, since the space of things nobody says is far larger.
  Unknown pairings score neutral — absence of data is not evidence of awkwardness.
- **`object_verb` composition family (A2/A3)** — asks the OBJECT which verbs
  collocate with it and emits one candidate per fitting verb, capped at the
  responsibility level the evidence supports. This is what makes the Part 34 gates
  survivable: rejecting an inflated candidate now costs one option out of several
  instead of the only one. Candidate pool on the GitLab bullet went 2 → 6.
- Verb/object stutter guard ("Configured deployment configuration").

### Fixed
- **Useful rewrite rate 0.286 → 0.571** with zero safety weakening. All Part 34
  invariants still hold (152/152 tests).
- **Quality gate read a mean of per-fixture rates, not the pooled rate.** Averaging
  rates gives a fixture with one improvable bullet the same weight as one with six.
- **Phase B1 — gates now fail CI.** A benchmark that printed FAIL and exited 0 is
  decoration: CI goes green and the regression ships. `render` and `regression`
  report NOT_IMPLEMENTED and explicitly do not count as passes.

### Status
SAFETY=PASS · QUALITY=PASS · RENDER=NOT_IMPLEMENTED · REGRESSION=NOT_IMPLEMENTED

## Resume OS — Phase A.1 (action provenance)

### The bug
Phase A's object-aware family asked the OBJECT which verbs sound natural and
then claimed them. "Worked on a Spring Boot service" acquired "Designed",
"Developed" and "Deployed" — all idiomatic English, none supported by evidence.
Collocation strength was answering "what did this person do?", a question it
cannot answer.

### Added
- **`narrative/actionProvenance.js`** — six categories (EXPLICIT_ACTION,
  NOMINALIZED_ACTION, SUPPORTED_EQUIVALENT, RESPONSIBILITY_PARAPHRASE,
  CONTRIBUTION_ONLY, UNKNOWN_ACTION). The evidence layer produces the AUTHORIZED
  ACTION SET; the language layer may only rank within it.
  Audited `NOMINALIZATION_MAP`; ambiguous nouns (service, platform, system,
  project, work, activity) deliberately excluded.
- **`actionProvenance` as a mandatory blocking truth check** with
  `unsupported_action_claim`. Nine → ten blocking validators.
- **`contribution_safe` composition family** — "Worked on X for Y" →
  "Contributed to X supporting Y". Stronger writing at the same claim level.
- **`test/resumeActionProvenance.test.js`** — 21 tests.

### Changed
- **`objectVerbFit` is now ranking-only.** `verbsForObject()` could hand the
  composer a verb the evidence never supported; `rankAuthorizedVerbs({object,
  authorizedVerbs})` takes the authorized set as an INPUT and cannot add to it.
- **Nominalization only widens under a RESPONSIBILITY opener.** "Responsible for
  deployment configuration" means the configuring was theirs; "Participated in
  database migration" means a migration happened and they were present. Treating
  those alike is how "Helped with deployment activities" became "Deployed
  applications".
- Prepositional verbs (contribute to, participate in) are realized with their
  preposition and in past tense, instead of "Contribute service".
- Benchmark: `unsupportedActionClaims` counted, gate renamed `PHASE_A1_GATE`,
  and it states explicitly that render/regression are FUTURE gates and that this
  is not a final release pass.

### Results
Useful rewrite rate **0.571 → 0.714** — higher than Phase A, with provenance
enforced. 173/173 tests. Unsupported action claims: 0.

## Resume OS — Phase A.1.1 predicate hardening

### Fixed
- **Adverb-prefixed action bypass.** Action truth checks now resolve the principal
  predicate in forms such as `Successfully designed ...`; the leading adverb can
  no longer hide an unsupported action.
- **Passive-voice action bypass.** Noun-led forms such as `A service was designed`
  and `A service has been deployed` now resolve to `design` / `deploy` before
  Action Provenance and Action Semantics validation.
- **Fail-closed changed noun-led rewrites.** A changed candidate whose principal
  action cannot be reasoned about remains `NOT_RUN`; the untouched source itself
  is explicitly safe so weak evidence never turns into an undefined fallback.
- **Contribution grammar.** Weak-opener rewrites restore source determiners
  (`Worked on a Spring Boot service` → `Contributed to a Spring Boot service`)
  and use `Supported work on ...` rather than implying operational support.

### Tests
- Added adversarial coverage for adverb-prefixed and passive unsupported actions,
  combined truth-gate behavior, passive preservation of an evidenced action, and
  contribution determiner/support phrasing.

## Resume OS — Core product architecture (post A.1.1)

### Canonicalized
- Added a single Resume OS application-service layer over the existing hardened
  `ResumeTailoringService`; Jobs, Editor, Resume Studio, legacy HTTP routes and
  application-package resume generation now delegate to the canonical engine.
- Retired the old standalone `tailoringEngine.js` implementation; the module is
  now a compatibility adapter over the canonical service.
- `ResumeDocument` is the authoritative internal state. Plain text is retained
  only for compatibility/export surfaces.

### AI boundary
- Resume content is deterministic by default (`AI polish = OFF`). Jobs and
  Editor no longer ask an LLM to author a whole resume or LaTeX resume.
- Optional Gemini integration is bounded to wording candidates. Every candidate
  passes Action Provenance, Action Semantics, responsibility, skill-context,
  metrics, entities, evidence-binding and other mandatory truth checks before it
  may compete with the deterministic wording.

### Optimization
- Added fixed, mode-independent `ResumeQualityEvaluator`, deterministic
  `WeaknessDetector`, `OptimizationHistory`, `Improve Again`, bounded
  `Optimize Resume`, convergence, oscillation prevention and best-version
  protection.
- Rejected Improve Again attempts persist their history on the unchanged best
  document so subsequent attempts advance to another objective instead of
  repeating forever.
- Existing Auto-Fit is now triggered after accepted content changes; browser
  pagination supplies measured overflow and can step through content budgeting,
  compact density and finally a readable two-page layout.

### Quality gates
- Enhance and Job Tailor quality are reported separately. JD relevance is N/A
  for general Enhance rather than receiving fabricated points.
- Core release gates now report SAFETY, QUALITY, OPTIMIZATION and INTEGRATION
  independently. Final rendering remains explicitly PENDING.

## Resume OS final rendering
- Added canonical `ResumeRenderService` with ATS vector, Playwright/Chromium, and WeasyPrint fail-safe providers.
- Resume Studio normal PDF downloads now use server rendering; legacy and Template OS previews share the Template OS compiler used by export.
- Unicode-heavy resumes are routed away from the Base-14 vector writer so non-Latin glyphs are never silently dropped.
- Added selectable-text/critical-field render validation, stable render signatures, render gate, regression gate, and final Resume OS gate.
