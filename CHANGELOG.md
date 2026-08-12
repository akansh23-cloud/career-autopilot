
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
