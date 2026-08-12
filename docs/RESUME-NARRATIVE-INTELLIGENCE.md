# Resume Narrative Intelligence

A layer **of** Resume OS, not a competing engine. It sits between the canonical
`ResumeDocument` and the deterministic verdict engines (Truth, ATS V3, Job
Match), and it is responsible for one thing the rest of Resume OS deliberately
never did: **writing the sentences**.

Everything below is live in this build and covered by
`test/resumeNarrative.test.js` (87 tests) and
`test/resumeNarrativeRoutes.test.js` (18 tests).

---

## 1. Why this exists

Before this layer, Resume OS could *select, rank, budget and audit* content
truthfully — but the sentences stayed exactly as the candidate typed them.
"Tailoring" reordered evidence; it never made the writing better. The optional
AI assist improved one string at a time with no view of the document.

The goal is writing that reads as though an expert human resume strategist wrote
it for this specific person: evidence-driven, domain-authentic, varied,
ATS-aware, and **never** inflated. Not:

> Leveraged cutting-edge technologies to optimize scalable solutions, resulting in improved operational efficiency.

but:

> Standardized Java 17 service releases across OpenShift environments by moving deployment configuration into Helm and ConfigMaps, reducing region-specific release steps.

— and only when the candidate's own evidence supports every clause of it.

**This is not detector evasion.** No errors are introduced, no randomisation is
applied, nothing is tuned against a classifier. The writing reads human because
it is specific, grounded and varied — which is also what makes it *useful*.

---

## 2. Architecture

```
ResumeDocument (trust-sanitized)  +  MasterProfile  +  (Job Description)
        │
        ├─ 1  evidenceGraph          normalized, traceable EvidenceRecords
        ├─ 2  candidateIntelligence  role family · seniority · tech centre of mass
        ├─ 3  voiceFingerprint       how THIS person writes
        ├─ 4  jobIntelligence        role identity · requirement tiers · semantics
        ├─ 5  externalContext        OPTIONAL · SSRF-safe · context-only
        ├─ 6  domainVocabulary       verbs · nouns · collocations · register
        ├─ 7  skillIntelligence      SUPPORTED / PARTIAL / UNSUPPORTED
        ├─ 8  contentStrategy        space allocation · compression · ordering
        ├─ 9  bulletComposer         intent planning → 5–8 candidates/unit
        ├─ 10 bulletScoring          9-dimension rerank · hard-fail on fabrication
        ├─ 11 resumeConsistency      document-level repetition/tense/terminology
        ├─ 12 truthValidator         hallucination firewall (final gate)
        ├─ 13 summaryComposer        evidence-only summaries
        └─ 14 narrativeEngine        assembly · change ledger · telemetry
                │
        ResumeDocument  →  Truth Engine · ATS V3 · Template OS · PDF/DOCX
```

Each stage is one module with one responsibility, in
`server/utils/resume/narrative/`.

---

## 3. Evidence model

`evidenceGraph.js` builds the graph from **candidate-owned sources only**:
the working document, the Master Career Profile (profile, verified submissions,
verified skills, GitHub-proven skills), certifications, achievements, patents,
education, and any metric the candidate already wrote.

An `EvidenceRecord` is a *parsed* view of one claim:

```js
{
  id: 'ev_xp_b1',
  type: 'achievement',
  source: 'experience', sourceId: 'x1', bulletId: 'b1',
  company: 'Meridian Bank', role: 'DevOps Engineer',
  skills: ['openshift', 'helm', 'java'],
  skillsDisplay: ['OpenShift', 'Helm', 'Java'],   // the candidate's own casing
  action: '', weakOpener: 'responsible for',
  object: 'deployment configuration of Java 17 services',
  method: 'Helm and ConfigMaps',
  scope: 'OpenShift environments',
  outcome: '', outcomeVerb: '',
  numericEvidence: [],                            // ← the permitted-number universe
  verificationLevel: 'user_provided', confidence: 0.8,
  tense: 'past', hasConcreteAnchor: true,
}
```

Parsing is deliberately conservative: a field is populated only when it is
literally recoverable from the candidate's own words. **Empty is always safer
than guessed.**

Two derived indexes are the backbone of the safety model:

* `permittedNumbers` — every number the candidate actually wrote.
* `permittedSkills` — every technology anywhere in their evidence.

Connected GitHub evidence enters as `type: 'connected_signal'` with
`claimable: false`. A dependency-manifest mention is classified
`declared_dependency` (confidence 0.45); authored code is `authored` (0.75).
Neither ever becomes an achievement sentence.

---

## 4. Hallucination prevention

`truthValidator.js` is a **hard gate**, not a score. A violation removes the
candidate sentence from consideration entirely; it cannot win on other merits.

| Refused | How |
|---|---|
| Fabricated numbers | Every digit token must exist in that record's `numericEvidence` (or its source text). Identifiers like `EC2`, `p99`, `Java 17` are excluded from the metric check by lookbehind. |
| Fabricated technologies | Every ontology skill in the output must exist in the record, or be a document-wide supported skill (semantic alignment). |
| Fabricated credentials | certification / award / patent / promotion shapes absent from the source. |
| Fabricated authority | "led a team of", "architected the platform", "set the strategy" absent from the source. |
| Seniority inflation | Authority language above the evidence-supported `ownershipCeiling`. |
| Fabricated scale | "enterprise-wide", "company-wide", "global" absent from the source. |
| Fabricated titles | "as Senior…", "as Lead…" absent from the source. |
| Unquantified magnitude | "significantly", "dramatically" without evidence for the magnitude. |
| Everything the shipped gate refuses | `writingProviders.validateRewrite()` is re-run verbatim, so this layer can never be weaker than the existing AI assist. |

**Composition is recombination, not writing.** Every deterministic candidate is
assembled from spans the candidate themself wrote (action / object / method /
scope / outcome) plus connectives that carry no factual content. The only
substitutions permitted are (a) verb register *within the same semantic family*
and (b) collocation upgrades whose head noun is already present. The validator
then checks the result anyway.

`auditGeneratedDocument()` re-runs the whole sweep after assembly. Its
`unsupportedClaimCount` is the number the acceptance criteria and the quality
benchmark are measured against, and it is **0** across all fixtures.

---

## 5. Job Intelligence

`jobIntelligence.js` is built **on top of** the canonical `parseJDv2` (which
already does weighted, section-aware skill extraction). It adds what a keyword
parser cannot express:

* **Role identity** — canonical role, family, seniority, IC vs leadership vs
  hybrid, business domain, years, education, certifications.
* **Requirement tiers** — mandatory / strong preference / optional, plus
  categories: business domain, leadership, collaboration, architecture,
  operational, security, delivery, data.
* **Technical signals** — bucketed by kind (cloud, language, platform,
  framework, data, devops tool, security, practice) with tier and weight.
* **Semantic expectations** — what a requirement *implies* operationally.
  "Kubernetes production support" implies rollout strategy, pod troubleshooting,
  resource limits, service discovery… Every expansion is tagged
  **`claimable: false`**. It is used to understand the job, never to describe
  the candidate.
* **Functional expectations** — what the job actually wants done.
* **Employer vocabulary** — repeated noun phrases in the employer's own words.

The whole object is content-hashed (`hash`) so JD analysis is cacheable and is
never recomputed while a user edits one bullet.

---

## 6. External research

`externalContext.js`. **Optional; the pipeline is fully functional without it.**

The hard boundary, which is the entire point of the module:

> **CANDIDATE FACT** may become a resume claim.
> **EXTERNAL CONTEXT** may only change vocabulary and framing.

Everything returned is stamped `claimable: false`, and it reaches generation
through exactly two narrow channels: `terminology[]` (preferred words for things
the candidate already did — and only where the term is already a *supported*
candidate skill) and `contextNotes[]` (relevance ranking only). The composer
physically cannot read it as evidence: it only ever receives `EvidenceRecord`s.

**Security.** All network access goes through the repository's existing
`workspace/ssrfGuard.js` — DNS validation, private-IP blocking, per-hop redirect
validation, timeouts. This module adds a 512 KB response cap and a content-type
allow-list (`text/html`, `text/plain`, `application/json`, `application/xhtml+xml`).
No new URL-fetching primitive was introduced. HTML → text extraction is
dependency-free and strips scripts, styles and comments.

**Provider abstraction.** `search()` / `fetch()` / `extract()`. `NullSearchProvider`
is the default and returns `available: false`. `makeHttpSearchProvider` is
vendor-neutral and configured entirely from env, with the API key travelling in
a header when the provider supports it.

Results are cached in-process (TTL 12 h, LRU-bounded, never persisted — research
is context, not a record we owe anyone) with source URLs and retrieval
timestamps for auditability.

---

## 7. Domain vocabulary

`domainVocabulary.js` is not a list of power verbs. It carries four kinds of
knowledge per role family:

* **Verbs bucketed by INTENT** — so the verb is chosen by what the bullet must
  communicate, not by novelty.
* **Technical nouns** — the domain's real objects.
* **Collocations** — the word pairs practitioners genuinely use:
  `configuration drift`, `release gate`, `rollout validation`, `artifact
  repository`, `secret rotation`, `month-end close`, `variance analysis`,
  `tolerance stack-up`, `load case`, `audience segment`… These do more for
  domain authenticity than any verb list.
* **Register** — seniority-appropriate framing with an `ownershipCeiling`.

**The grounding rule:** a collocation may only be used when its **head noun is
already in the candidate's own text**, and none of its modifier words are
already present (which would produce a stutter). Vocabulary shapes *how* a fact
is said, never *what* is claimed.

25 families ship: devops, sre, platform, cloud, backend, frontend, fullstack,
data_engineering, data_science, machine_learning, cybersecurity, qa, product,
business_analysis, finance, accounting, consulting, marketing, sales, hr,
operations, mechanical, electrical, electronics, civil, research, graduate,
general.

---

## 8. Voice fingerprint

`candidateIntelligence.js` measures the candidate's own writing: sentence length
mean and spread, technical density, metric habit, acronym density, register bias
(leadership vs execution), result orientation, architecture affinity, clause
style, lead-verb diversity, cliché load, and spelling convention (-ise vs -ize).

The fingerprint keeps the enhanced resume sounding like the same person, and is
a large part of why two candidates applying to one job do not converge on the
same sentences. It explicitly does **not** preserve errors: grammar, filler and
vagueness are always corrected.

---

## 9. Composition and scoring

**Intent planning** (`bulletComposer.js`) decides what each bullet must
communicate before deciding how to say it — from 20 intents (scale,
architecture, ownership, automation, reliability, security, performance,
delivery, leadership, migration, troubleshooting, cost, data, product_impact,
operational_excellence, innovation, analysis, compliance, stakeholder,
research). `planSectionIntents` diversifies across a role so it doesn't read as
six versions of one idea, and prefers intents the JD actually asks for.

**Seven strategies**, each with a genuinely different structure:

| Strategy | Structure |
|---|---|
| `technical_precision` | ACTION → SYSTEM → SCALE |
| `impact_led` | RESULT → CHANGE (or CHANGE → CONDITION when no outcome exists) |
| `ownership_led` | OWNERSHIP → SCOPE → TECHNOLOGY *(only when evidence asserts ownership)* |
| `architecture_led` | ARCHITECTURE → IMPLEMENTATION → CONSEQUENCE |
| `concise_ats` | shortest defensible form |
| `seniority_adjusted` | register-matched framing |
| `domain_natural` | collocation-upgraded phrasing |

The candidate's original is always also a candidate — sometimes their own
sentence is genuinely the best, and the scorer must be able to say so rather
than being forced to change something.

Weak openers are mapped to **faithful** restatements, not flattering ones:
"responsible for" → owned/ran/maintained (subject to the ceiling); "helped with"
→ supported/contributed to. Register openers are only usable when the source
verb places us in a known semantic family, so "worked on X" can never silently
become "owned X".

**Nine-dimension scoring** (`bulletScoring.js`, weights sum to 100):

| Dimension | Weight |
|---|---|
| evidence support | 25 |
| target-job relevance | 20 |
| specificity | 15 |
| domain authenticity | 10 |
| natural professional language | 10 |
| ATS usefulness | 8 |
| voice consistency | 5 |
| conciseness | 4 |
| novelty / non-generic | 3 |

Hard failure ⇒ `finalScore = 0`. Every bullet carries its full metadata
(`evidenceScore`, `relevanceScore`, `specificityScore`, `domainScore`,
`naturalnessScore`, `atsScore`, `voiceScore`, `redundancyScore`, `finalScore`)
internally; none of it appears in the exported resume.

**No AI in this file.** Scoring is a verdict, and verdicts are deterministic and
backend-owned throughout Career Autopilot.

---

## 10. Resume-level consistency

`resumeConsistency.js` detects and repairs, across the whole document: lead-verb
repetition, structural repetition, duplicate and near-duplicate achievements,
technology over-repetition, keyword stuffing, excessive metric density, tense
inconsistency, seniority inconsistency, length monotony, and JD-critical content
appearing too late.

**Repair philosophy:** substitute from the *already-validated candidate pool* for
that same evidence unit. Never invent a replacement, never reach for a
thesaurus. If no validated alternative exists, the repetition is **reported**
rather than "fixed" with a worse sentence — so you never get
Built/Spearheaded/Leveraged/Orchestrated/Championed.

Terminology normalisation makes one technology read the same way everywhere,
using the candidate's own most frequent spelling. We normalise; we do not rename.

---

## 11. Skill intelligence and ATS

`skillIntelligence.js` classifies every target skill as **SUPPORTED** (used in an
achievement, or server-verified), **PARTIALLY_SUPPORTED** (declared but never
demonstrated, or adjacent experience only), or **UNSUPPORTED**. Only SUPPORTED
skills are `insertable`. Adjacency can lift UNSUPPORTED → PARTIAL; it can never
produce SUPPORTED.

Semantic normalisation uses the existing `skillOntology` plus an implication
graph: `AWS EKS → Kubernetes + AWS`, `GitLab CI → CI/CD`, `PySpark → Spark +
Python`. Terminology alignment substitutes **only practice-level umbrellas**
(`ci/cd`, `infrastructure as code`, `data pipeline`…) — never a tool for a
language, because "Spring Boot → Java" destroys information.

`atsSemantics.js` measures four things separately: `keywordCoverage` (tier-weighted
literal), `semanticCoverage` (requirements met through equivalent candidate
vocabulary), `density`, `repetitionPenalty`, and `unsupportedPenalty`.

**The invariant:** an unsupported keyword is subtracted at 1.4× the rate it would
have earned, so **stuffing is strictly worse than honesty**. A user can never
raise their ATS score by inserting something they cannot evidence.

---

## 12. Content strategy

`contentStrategy.js` allocates space *before* any sentence is written, from
recency, target relevance, evidence quality, seniority and achievement value.
Recent and relevant roles get depth; older or irrelevant roles compress; roles
over seven years old keep one line for continuity. Projects are reordered by
priority and those outside the budget are **disabled on the variant, never
deleted** — the master keeps everything.

Compression is real: near-duplicates drop (keeping the stronger evidence),
overloaded bullets are flagged for splitting, weak fragments merge, and
everything over budget is trimmed. **Every decision carries a reason string.**

Section order responds to the target: students lead with education and projects;
certification-heavy JDs lift certifications; a thin work history yields to
projects.

---

## 13. Summary generation

`summaryComposer.js` has no persona templates. It assembles only from the
candidate's real role, years computed from *dated* experience, technologies that
appear in achievement sentences, the intents their evidence demonstrates, and
verified-project/certification counts. Practice concepts ("CI/CD", "ETL") are
expressed as work descriptions, not listed as tools.

Structure is chosen per candidate from a seeded set of shapes, so two people in
the same field do not receive the same skeleton. Every candidate summary is
validated against a synthetic evidence record built from those same facts, so the
truth firewall applies to summaries exactly as it does to bullets.

---

## 14. AI provider architecture

`narrativeProviders.js`. Task-routed, schema-validated, cached, never required.

| Task | Tier | Used for |
|---|---|---|
| `classify` | small | intent / seniority tagging |
| `extract` | small | structured facts |
| `generate` | strong | candidate sentence synthesis |
| `rerank` | strong | hard tie-breaks |
| `summarize` | strong | summary synthesis |

Cheap deterministic logic does normalisation, keyword extraction, similarity,
repetition detection, validation and every scoring component. AI is asked only
about the top 24 evidence units by value (cost ceiling), and only when the caller
opts in.

Every response is parsed (`parseStrictJSON`, fence-tolerant with one conservative
brace repair), validated against a Zod schema, sanitised, and then checked
against the evidence graph before it can touch a `ResumeDocument`. Malformed
output is discarded, not coerced.

Responses are SHA-256 cached (30 min TTL, 400 entries). A `UsageLedger` records
tokens, latency, cache hits and errors per task, so cost is measurable without
pricing being hard-coded.

---

## 15. Observability

`NarrativeTelemetry` records per-stage durations plus:
`evidenceRecords`, `bulletsEvaluated`, `candidatesGenerated`,
`candidatesRejected`, `rejectedHallucinations`, `repetitionRepairs`,
`terminologyNormalisations`, `compressionOps`, `researchCalls`,
`researchCacheHits`, `aiCalls`, `aiFailures`, `fallbacksUsed`, `errors`, and
quality (`averageFinalScore`, `averageGenericPenalty`, `naturalnessScore`,
`unsupportedClaimCount`).

It records **counts and identifiers, never resume content**.

---

## 16. Change ledger — "why this changed"

Every significant modification is recorded with: original, enhanced, source
evidence (id, verification level, skills, metrics), reason codes, human-readable
reason, job signal addressed, confidence, and score before/after.

```
Original: "Worked on Jenkins pipelines."
Enhanced: "Maintained Jenkins CI workflows for Java service builds and deployments."
Reason:   "Converted vague responsibility language into an evidence-backed
           statement of what you actually did, without adding any new claim."
```

`significant()` surfaces only the changes worth a user's attention, ordered by
score impact.

---

## 17. Failure modes

| Failure | Behaviour |
|---|---|
| No database | Works — evidence comes from the document itself. |
| No AI key / AI disabled | Works — deterministic composition produces the full resume. |
| AI unreachable / timeout / rate-limited | Candidate discarded, others remain, `aiFailures` incremented. |
| AI returns malformed JSON or violates schema | Discarded before it can touch the document. |
| AI provider *throws* | Absorbed; the request still succeeds. |
| No network / research unavailable | Tailoring proceeds from the JD alone; `externalContext.available: false`. |
| Internal engine failure | `ok: false` plus the **untouched original document** and a useful error. |
| Weak candidate evidence | Nothing is fabricated; a `thin_evidence` gap is reported asking the user a question. |
| Unsupported job requirement | Reported as a gap with a Build-Evidence CTA; never inserted. |

---

## 18. Performance and caching

Job Intelligence and external research run in parallel. AI candidate generation
for all units runs in one `Promise.all`. Cached: JD analysis (content hash),
company research (12 h TTL), AI responses (30 min TTL), and the role
taxonomy/vocabulary (module-level, built once).

Typical deterministic run: **~30–60 ms** for a full 12-fixture-scale document
(see `reports/resume-intelligence-quality.json` → `cost.meanDurationMs`).

---

## 19. Cross-user genericity protection

Achieved **without ever storing, reading or comparing another user's resume**:

* a **public** template/cliché corpus shipped in code, derived from no user;
* **content-free structure hashes** (all content words replaced with `X`);
* per-user deterministic **variation seeds** (`sha256(userKey + evidenceId + salt)`)
  that drive structural and verb selection;
* high-frequency phrase penalties within a single document.

Measured cross-domain vocabulary overlap across the twelve golden fixtures:
**max Jaccard 0.07, mean 0.019**.

---

## 20. API surface

| Endpoint | Purpose |
|---|---|
| `POST /api/resume-os/enhance` | Strongest general-market version. No JD. |
| `POST /api/resume-os/tailor-narrative` | Targeted variant for one opportunity. Returns the same `package` shape as `tailor-for-job`. |
| `POST /api/resume-os/narrative/preview` | All candidates + scores for one bullet. |

All three: behind auth, rate-limited, trust-boundary sanitized, non-destructive
(nothing persists unless `persist: true`, and tailoring never writes to the
master).

Existing endpoints are unchanged. `ENGINE_VERSIONS` now also reports `narrative`
and `narrativeStages`.

---

## 21. Environment variables

| Var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Enables the optional AI layer. Absent ⇒ deterministic only. |
| `RESUME_NARRATIVE_AI` | `1` | `0` disables AI for this layer specifically. |
| `RESUME_NARRATIVE_MODEL` | `AI_MODEL` / `claude-sonnet-4-6` | Strong-tier model. |
| `RESUME_NARRATIVE_SMALL_MODEL` | `claude-haiku-4-5-20251001` | Cheap-tier model. |
| `RESUME_RESEARCH_ENABLED` | `0` | Must be `1` before any external research is possible. |
| `RESUME_RESEARCH_ENDPOINT` | — | Vendor-neutral search endpoint. |
| `RESUME_RESEARCH_API_KEY` | falls back to `SERPAPI_KEY` | Search credential. |
| `RESUME_RESEARCH_PROVIDER` | `http` | Provider label. |
| `RESUME_RESEARCH_QUERY_PARAM` | `q` | Query parameter name. |
| `RESUME_RESEARCH_RESULTS_PATH` | `organic_results` | Dotted path to the results array. |
| `RESUME_RESEARCH_HEADER` | — | Header name for the key (preferred over query string). |
| `RESUME_RESEARCH_TIMEOUT_MS` | `8000` | Per-search timeout. |

---

## 22. Tests

`test/resumeNarrative.test.js` — **87 tests**: evidence, natural language, job
tailoring, seniority, resume-level consistency, cross-user genericity, voice,
composition, scoring, provider failure (malformed / schema violation / timeout /
rate limit / throwing provider / unavailable), security (SSRF, private
addresses, redirect-to-private, scheme and content-type restrictions, HTML
sanitisation), degradation, and golden quality.

`test/resumeNarrativeRoutes.test.js` — **18 tests**: the three new endpoints,
auth, validation, trust boundary, and regression against `tailor-for-job`,
`compile`, `assist`, template recommendation, text export, DOCX export, legacy
document shapes and engine-version reporting.

`scripts/resume-quality-benchmark.mjs` (`npm run quality:resume`) — the
evaluation harness. Writes `reports/resume-intelligence-quality.json` and
`.md`. **Exits non-zero if any unsupported claim or untraced metric appears.**
