# Resume Narrative Intelligence — pre-implementation architecture note

Written **before** any code changed. It records what the repository already does,
what is canonical, and exactly what the Narrative Intelligence Layer reuses,
replaces and adds. Nothing here proposes a second Resume OS.

---

## 1. Current "enhance resume" flow (as found)

There is no single endpoint literally named *enhance*. Enhancement today is the
union of three independent paths:

| Path | Entry | Behaviour |
|---|---|---|
| Legacy text analysis | `POST /api/resume/analyze` (`server.js:1881`) | Deterministic `scoreResume()` + an AI **explanation** (`aiResumeFeedback`) with deterministic fallback. Produces advice, not content. |
| Wording assist | `POST /api/resume-os/assist` → `writingProviders.assistRewrite()` | Rewrites **one selected string** at a time. `DeterministicWritingProvider` (filler strip, lead-verb swap, outcome-first inversion, recompile from facts) always runs; `AnthropicWritingProvider` runs only with `ANTHROPIC_API_KEY` + explicit `useAi`. Every AI candidate goes through `validateRewrite()` (no new numbers, no new ontology skills, no claim-shaped additions, ≤50% vocabulary drift). |
| Deterministic recompile | `POST /api/resume-os/bullet/compile` → `bulletCompiler.compileBullet()` | Renders a bullet from structured `facts` through `grammarLibrary` patterns. `containsOnlyProvidedNumbers()` blocks fabricated metrics. |

**Consequence:** enhancement is per-string, has no document-level view, no
domain vocabulary, no seniority register, no reranking, no repetition control,
and no notion of *why* a change happened.

## 2. Current "tailor resume for a job" flow (as found)

Two live implementations plus one legacy:

1. **Canonical (V4)** — `POST /api/resume-os/tailor-for-job` (`resumeOsRoutes.js`).
   `sanitizeDocumentTrust` → `parseJDv2` → `matchDocumentToJD` →
   `rankContentForTarget` → `rankTemplates` → `planContentBudget` →
   `compileSummary` → non-destructive **variant proposal** → `auditResumeTruth`
   + `scoreResumeDocument` + gap report. **Zero AI. Selection and ordering only —
   it never rewrites a bullet's language.**
2. **V3 proposal** — `POST /api/resume-os/tailor-v3` — ranking + selection, no package.
3. **Legacy text** — `POST /api/resume/tailor` (`server.js:1958`) →
   `tailoringEngine.tailorResume()` + `fabricationChecker`. Still consumed by
   older screens; kept.

**Consequence:** tailoring reorders and trims truthfully, but the *sentences*
stay exactly as the user wrote them. The job never changes the language.

## 3. Current AI calls in the resume path

| Call site | Model use | Guard |
|---|---|---|
| `aiResumeFeedback` (server.js) | prose advice | deterministic fallback |
| `makeAnthropicWritingProvider` (`writingProviders.js`) | single-string reword, 12s timeout, ≤900 chars of source | `validateRewrite()` hard reject |
| `services/problemIntelligence/ai/aiProvider.js` | 8-method provider facade (anthropic / openai / gemini / deterministic fallback), SHA-256 response cache, `parseLooseJSON`, never throws | per-method deterministic fallback |

The **provider facade already exists and is good**; it is simply not wired into
Resume OS. Resume OS has its own narrower `ResumeWritingProvider` interface.

## 4. Canonical resume representation

`server/utils/resume/resumeDocument.js` — `ResumeDocument`
(`resume-doc-v4-template-pin`). Every engine consumes it. Key facts:

* `PROVENANCE`: `VERIFIED > PROFILE_CONFIRMED > USER_ENTERED > UNSUPPORTED`.
* Bullets carry `evidenceIds`, `verified`, `userConfirmed`, `facts`,
  `generatedByRule`, `provenance`, `enabled`.
* `toRendererStructured()` is the single bridge to Template OS / PDF / DOCX.
* `overrides = { bulletIds, disabled }` is how variants stay non-destructive.

`masterProfileEngine.assembleMasterProfile()` is the user-level truth
aggregate (profile + verified submissions + verified skills + GitHub-proven
skills). `trustBoundary.sanitizeDocumentTrust()` re-stamps trust from server
context before *anything* is scored, tailored or exported.

## 5. What will be REUSED (unchanged)

* `resumeDocument.js` — the one canonical schema. **No schema change.**
* `trustBoundary.js` — every new entry point calls it first.
* `masterProfileEngine.js` — evidence source #1.
* `truthEngine.js`, `atsEngineV3.js`, `scoringEngine.js` — final verdicts stay theirs.
* `jdParserV2.js` — Job Intelligence is built *on top of* it, not instead of it.
* `skillOntology.js` / `skillMatcher.js` / `roleDictionaries.js` — one taxonomy.
* `grammarLibrary.js` (verbs, tense, patterns), `bulletCompiler.js`.
* `contentBudget.js`, `templateRecommender.js`, `jobMatchEngineV3.js`.
* `textQualityEngines.js` — similarity/duplicate detection.
* `writingProviders.validateRewrite()` — reused verbatim as the *last* gate.
* `workspace/ssrfGuard.js` — the only server-side URL fetcher.
* `services/problemIntelligence/ai/*` — provider clients (anthropic/openai/gemini).

## 6. What will be REPLACED (behaviourally, not deleted)

Nothing is deleted. Two behaviours are superseded:

* **Per-string assist as the enhancement product.** `/assist` stays (Resume
  Studio's side-by-side comparison depends on it) but is no longer the only
  way to improve content. The new `/enhance` operates on the whole document.
* **Tailoring as selection-only.** `/tailor-for-job` keeps its exact response
  contract; the new `/tailor-narrative` extends it with rewritten content,
  and internally *calls the same* V4 package builder so template, budget,
  truth and gap semantics stay identical.

## 7. What will be ADDED

A new layer `server/utils/resume/narrative/` — a *stage* of Resume OS, not a
peer of it. Pipeline (each stage a module with one responsibility):

```
ResumeDocument + MasterProfile + (JD)
   → evidenceGraph          normalized, traceable EvidenceRecords
   → candidateIntelligence  domain, role family, seniority, tenure
   → voiceFingerprint       the candidate's own writing signature
   → jobIntelligence        role identity / requirement tiers / semantic expectations
   → externalContext        OPTIONAL, SSRF-safe, cached, context-only
   → domainVocabulary       verbs + technical nouns + collocations + register
   → contentStrategy        space allocation, compression, bullet INTENTS
   → bulletComposer         5–8 candidates per unit, 7 strategies
   → bulletScoring          9-dimension rerank, hard-fail on unsupported claims
   → resumeConsistency      document-level repetition / tense / structure repair
   → truthValidator         final hallucination firewall (calls validateRewrite)
   → narrativeEngine        assembles ResumeDocument + change ledger + telemetry
```

Plus: `skillIntelligence` (SUPPORTED / PARTIAL / UNSUPPORTED),
`atsSemantics` (coverage without stuffing), `naturalness`, `phraseQuality`
(cliché frequency model), `genericityGuard` (no cross-user text ever stored),
`changeLedger` ("why this changed"), `narrativeProviders` (task-routed AI with
strict Zod schemas), `telemetry`.

**Invariants carried over from the rest of Career Autopilot:**
no AI in any verdict/scoring path; all scoring deterministic and backend-owned;
no fabricated content; every claim traceable to an evidence record.

## 8. Compatibility commitments

* No route removed, no response field removed, no schema field repurposed.
* `/api/resume-os/tailor-for-job` returns byte-compatible `package`/`variant`.
* New endpoints are additive: `/api/resume-os/enhance`,
  `/api/resume-os/tailor-narrative`, `/api/resume-os/narrative/preview`.
* Everything degrades: no DB → works; no AI key → works (deterministic
  composition); no network → works (external research skipped).
