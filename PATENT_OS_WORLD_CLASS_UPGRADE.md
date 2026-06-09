# Patent OS — World-Class Upgrade (Implementation Summary)

This upgrade extends the existing **Innovation & Patent Intelligence OS** into a
student-friendly invention builder + patent-readiness workflow + evidence-backed
IP review system. It is **additive**: no existing auth, jobs, resume, projects,
recruiter, admin, GitHub, payments, or prior Innovation OS routes were removed or
broken. Everything degrades safely without API keys or a database, and all
deterministic scoring stays backend-owned (AI only adds prose, never numbers).

---

## How to test

```bash
npm ci
npm run build          # Vite production build (frontend)
npm test               # node --test test/*.test.js  → 45 tests (17 existing + 28 new)
npm run lint
```

Backend was verified in a sandbox with `node --check` on every changed/added file
and `node --test` (all 45 pass). Frontend bracket/JSX balance was verified; the
authoritative frontend check is your local `npm run build`.

---

## Files added

**Community discovery connectors** (`server/services/problemIntelligence/connectors/`)
- `communityCommon.js` — shared normalization, pain-hint extraction, classification, hashing.
- `hackerNewsConnector.js` — public Algolia API (keyless).
- `redditConnector.js` — **official OAuth API only**, no HTML scraping, no usernames stored.
- `discourseConnector.js` — **allowlisted base URLs only**.
- `devtoConnector.js` — public Forem API.
- `hashnodeConnector.js` — public GraphQL API.
- `specializedForumConnector.js` — allowlisted api/rss/discourse/manual sources only.

**Per-project intelligence services** (`server/services/problemIntelligence/`)
- `simplifiedExplainerService.js` — "Explain What To Build" + 5 audience modes + clarity scores.
- `indiaCriValidatorService.js` — India Section 3(k) / CRI validator + `ipCapFromCRI`.
- `patentWorkflowService.js` — prior-art search plan, safe claim directions, evidence
  checklist + `scoreEvidence`, disclosure-risk check, diagram plan (Mermaid, no image gen),
  experiment/benchmark plan.
- `sourceQualityService.js` — `scoreSourceQuality`, `assessPrivacyRisk`, `computeSourceMix`.

**Innovation memory / RAG** (`server/services/innovationMemory/`)
- `memoryStore.js` — `InnovationMemoryChunk` model on the shared mongoose connection
  (db.js untouched); cross-user retrieval limited to `public_safe`/`anonymized_global`.
- `embeddingProvider.js` — optional OpenAI/Gemini embeddings, keyword fallback, `cosine`.
- `similarity.js` — pure (no-DB) similarity helpers (`similarityScore`, `isNearDuplicate`).
- `retrievalService.js` — RAG retrieval (vector when enabled, else keyword).
- `duplicateDetectionService.js` — fingerprint + near-duplicate detection.
- `memoryIngestionService.js` — privacy-filtered, quality-scored chunk creation.
- `outcomeLearningService.js` — lightweight outcome recording foundation.
- `privacyFilterService.js` — strips usernames/emails/handles, neutralizes first person.
- `sourceQualityService.js` — re-export shim of the shared scorer.

**Frontend** (`web/src/views/innovation/`)
- New panels in `panels.jsx`: SimpleExplanation, IndiaCri, PriorArtSearchPlan,
  ClaimDirections, PrototypeEvidence, Confidentiality, DiagramPlan, ExperimentPlan,
  SimilarMemory.
- `GeneratedProjectWorkspace.jsx` rewritten with a top summary + 16 tabs.
- `ProblemDiscovery.jsx` rewritten with core/community source pickers, community
  sub-inputs, time range, and safety warnings.

**Tests**
- `test/patentOsUpgrade.test.js` — 28 new tests (pure modules only).

---

## Files modified

- `server/services/problemIntelligence/config.js` — community + memory env config,
  `ALL_SOURCES` (11), `COMMUNITY_SOURCES` (6), `COMMUNITY_ONLY_IP_CAP` (55).
- `server/services/problemIntelligence/ingestionService.js` — community connectors
  (gated), privacy filtering, source-quality scoring, source mix, community count.
- `server/services/problemIntelligence/ipReadinessService.js` — integrated CRI cap,
  community-only cap, `scoreExplanation`, `section3k` sub-object.
- `server/services/problemIntelligence/ai/aiProvider.js` — generic `freeformJSON`.
- `server/services/problemIntelligence/store.js` — new project fields + widened
  `updateProject` allow-list (evidence, confidentiality, plans, source mix, etc.).
- `server/routes/problemIntelligenceRoutes.js` — new endpoints + enhanced `/discover`
  and `/config`; duplicate detection + memory ingest on project generation.
- `web/src/lib/innovation.js` — client methods for every new endpoint.
- `web/src/views/innovation/{shared,InnovationOS,ProblemClusterList}.jsx` — community
  metadata, config wiring, cluster badges (community count, corroborated, validation).
- `web/src/views/patent/PatentDashboard.jsx` — CTAs now route to Innovation OS
  ("Discover Innovation Projects").
- `web/src/views/patent/PatentIdeaGenerator.jsx` — demoted to "Legacy idea generator"
  with a banner steering users to Innovation OS.
- `web/src/components/app/Shell.jsx` — old generator nav renamed "Legacy Generator".
- `.env.example` — all new community + memory variables (documented, safe defaults).

---

## Routes added (all under `/api/problem-intelligence`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/projects/:id/simplify` | Student build explainer (audience + detail level) |
| POST | `/projects/:id/india-cri` | India Section 3(k) / CRI validation |
| POST | `/projects/:id/prior-art/search-plan` | Prior-art search-query plan |
| POST | `/projects/:id/claim-directions` | Safe plain-language claim directions |
| POST | `/projects/:id/evidence-checklist` | Prototype evidence checklist |
| POST | `/projects/:id/evidence` | Attach evidence → bumps prototype + IP readiness |
| POST | `/projects/:id/confidentiality` | Set confidentiality / disclosure status |
| POST | `/projects/:id/disclosure-risk-check` | Pre-disclosure risk check |
| POST | `/projects/:id/diagram-plan` | Patent diagram plan (Mermaid, no image gen) |
| POST | `/projects/:id/experiment-plan` | Benchmark / experiment plan |
| GET  | `/projects/:id/similar` | Find similar past ideas (RAG) |
| POST | `/memory/reindex` | Reindex the user's innovation memory |

`/discover` enhanced: accepts 11 sources + `communities{}` + `timeRange`; response adds
`communitySignalsCount`, `sourceMix`, `mode` (`source_backed`/`mixed`/`fallback`), and a
`rag{ memoryUsed, retrievedMemoryCount, duplicateWarnings }` block.
`/config` enhanced: reports enabled/disabled status for each community source, memory,
vector search, and embedding provider.

---

## Env vars added (see `.env.example`)

`COMMUNITY_DISCOVERY_ENABLED` (default 0), `REDDIT_DISCOVERY_ENABLED` (0) +
`REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`/`REDDIT_USER_AGENT`,
`HACKERNEWS_DISCOVERY_ENABLED` (1), `DISCOURSE_DISCOVERY_ENABLED` (0) +
`DISCOURSE_ALLOWED_BASE_URLS`/`DISCOURSE_API_KEY`/`DISCOURSE_API_USERNAME`,
`DEVTO_DISCOVERY_ENABLED` (0) + `DEVTO_API_KEY`, `HASHNODE_DISCOVERY_ENABLED` (0) +
`HASHNODE_API_KEY`, `SPECIALIZED_FORUM_DISCOVERY_ENABLED` (0) +
`SPECIALIZED_FORUM_ALLOWED_SOURCES`, `COMMUNITY_DISCOVERY_MAX_SIGNALS` (25),
`COMMUNITY_DISCOVERY_TIMEOUT_MS` (12000), `COMMUNITY_DISCOVERY_CACHE_TTL_MS` (3600000),
`COMMUNITY_STORE_RAW_COMMENTS` (0), `INNOVATION_MEMORY_ENABLED` (1),
`EMBEDDING_PROVIDER` (fallback), `OPENAI_EMBEDDING_MODEL` (text-embedding-3-small),
`VECTOR_SEARCH_ENABLED` (0).

---

## Key safety invariants (enforced)

- **Honest scoring** — all scores/caps are deterministic and backend-owned. AI only
  adds narrative. No 90+ IP score without source evidence + prior-art + prototype +
  technical effect. Hard caps: 55 (no source), 65 (no prior-art), 75 (no prototype),
  50 (business-method), 45 (algorithm-only), CRI cap, **55 community-only**.
- **Community = early signals, not facts.** Community-only evidence caps IP-readiness at
  55 and is labelled "needs validation"; strong recommendations require corroboration.
- **Privacy** — usernames/emails/handles are stripped; first-person is neutralized; raw
  comments are dropped by default; sensitive communities are rejected; only community
  names (e.g. `r/devops`) are stored, never authors.
- **No scraping** — Reddit uses the official OAuth API; Discourse/specialized forums are
  allowlisted; nothing fetches arbitrary user-provided URLs.
- **RAG informs, never overrides** scoring caps. Cross-user memory is limited to
  `public_safe`/`anonymized_global`.
- **Never says "patentable"**; claim output is "directions", not legal claims, always
  with a disclaimer.
- **Degrades safely** — missing API keys / missing vector DB / DB off never crash; the
  feature flag 404s cleanly when disabled.

---

## Known limitations

- `github_discussions` currently routes through the existing GitHub issues connector
  (issues + repo signals). A dedicated GitHub Discussions GraphQL connector is a
  next-phase item.
- Vector search requires `VECTOR_SEARCH_ENABLED=1` **and** an embedding provider key;
  otherwise retrieval uses deterministic keyword similarity (works with no keys).
- Outcome learning records outcomes but does not yet feed a weighted re-ranking model
  (foundation only, by design).
- Community connectors do live network calls and cannot be exercised end-to-end in an
  offline sandbox; tests cover normalization + disabled/allowlist paths instead.

## What still needs real API keys

- **Reddit**: `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` (+ enable flag).
- **Discourse**: allowlisted base URLs (+ optional API key/username).
- **Dev.to / Hashnode**: work keyless; keys raise limits.
- **Hacker News**: keyless.
- **Vector embeddings**: `OPENAI_API_KEY` or `GEMINI_API_KEY` + `VECTOR_SEARCH_ENABLED=1`.
- **AI prose** (sharper explainer/claims): any of the existing `ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY` / `GEMINI_API_KEY`.

## Next-phase recommendations

- Dedicated GitHub Discussions GraphQL connector.
- Vector index (Atlas Vector Search / pgvector) behind the existing embedding interface.
- Faculty/IP-cell review workflow surfacing `faculty_feedback` memory chunks.
- Outcome-weighted re-ranking using `outcomeLearningService` signals.
- Recruiter-safe public profile export wired through `disclosure-risk-check`.
