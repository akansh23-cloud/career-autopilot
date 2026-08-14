# Resume Tailoring Architecture

**Status:** Phase 1 hardening + Phase 2 (partial) — see *Known gaps* at the end.
**Engine:** `canonical-resume-tailoring-v1`

---

## The product rule

Resume content is produced by Career Autopilot's deterministic Narrative
Intelligence engine. Not "usually", not "when no API key is present" —
structurally, enforced at runtime.

```
Anthropic calls  = 0
OpenAI calls     = 0
Gemini calls     = 0
Groq calls       = 0
```

for every resume surface: Resume Studio tailoring, resume enhancement, Job
Search → Tailor & Apply, bullet assist, summary assist, ATS optimisation,
application-package resume generation, preview and re-rank, on free and paid
plans alike.

AI may still exist elsewhere in the product for explicitly AI-labelled
features (optional cover-letter or outreach drafting). It may not touch resume
content, and there is no silent fallback.

---

## Execution path

```
  HTTP route  (legacy paths preserved for compatibility)
        │
  Canonical Tailoring Service          server/services/resumeTailoring/
        │                                canonicalTailoringService.js
        │   normalise request → resolve mode + depth → build boundary metadata
        │
  AI-Deny Execution Boundary           aiBoundary.js  (AsyncLocalStorage)
        │
        │   ── everything below runs inside the boundary ──
        │
  Narrative Engine                     server/utils/resume/narrative/
        │                                narrativeEngine.js
        ├── normalise document
        ├── Evidence Graph                     evidenceGraph.js
        ├── Candidate Intelligence + voice     candidateIntelligence.js
        ├── Job Intelligence                   jobIntelligence.js
        ├── Skill classification               skillIntelligence.js
        ├── Requirement Graph  (AND/OR)        requirementGraph.js
        ├── Content strategy + compression     contentStrategy.js
        ├── Composition families               bulletComposer.js
        ├── Truth gate (per candidate)         truthValidator.js
        ├── Deterministic reranker             bulletScoring.js
        ├── Resume consistency pass(es)        resumeConsistency.js
        ├── FAIL-CLOSED leakage audit          requirementLeakage.js
        ├── Summary composer                   summaryComposer.js
        ├── Change ledger                      changeLedger.js
        └── Quality + telemetry
        │
  Tailored resume + change ledger
```

---

## The AI deny boundary (P1.1)

`server/services/resumeTailoring/aiBoundary.js`

The guarantee is enforced with `AsyncLocalStorage` rather than by convention,
because convention does not survive the next contributor.

- `runInsideTailoringBoundary(meta, fn)` opens a transaction.
- Every generative provider entry point calls `assertNoAiInsideBoundary()`
  before doing anything expensive.
- Inside a transaction that call throws
  `AiCallInsideTailoringBoundaryError` (`code: AI_CALL_INSIDE_TAILORING_BOUNDARY`).
- Outside a transaction it is a no-op costing one store read.

Guarded provider entry points:

| Module | Function |
|---|---|
| `narrative/narrativeProviders.js` | `makeAnthropicNarrativeClient().complete()` |
| `writingProviders.js` | `makeAnthropicWritingProvider().rewrite()` |

Because the store propagates through the async context, the guard fires
whether the call is direct, nested, awaited, or several modules deep. Tests
in `test/resumeTailoringCanonical.test.js` prove this with a `fetchImpl` that
throws if it is ever reached — the guard must fire first.

**Escape hatch.** `runOutsideTailoringBoundary(fn)` exits the boundary for the
duration of `fn`. It exists for genuinely non-resume AI work that may run in
the same request (an optional cover letter). It is deliberately verbose so it
shows up in review.

---

## Canonical service (P1.2)

One business entry point: `runTailoring(request)`.

Operations:

| Operation | Engine mode | Needs JD |
|---|---|---|
| `full-tailor` | tailor | yes |
| `job-tailor` | tailor | yes |
| `ats-optimize` | tailor | yes |
| `preview` | tailor | no |
| `selection-rerank` | tailor | no |
| `enhance` | enhance | no |
| `bullet-assist` | enhance | no |
| `summary-assist` | enhance | no |

`bullet-assist` and `summary-assist` replace the intelligence previously in
`assistRewrite()`. They are a **scope filter** over the canonical pipeline,
not a parallel writer: the whole document is still processed (consistency and
diversity are document-level properties), and only the returned proposal is
narrowed. A scoped call and a full call produce the identical sentence for the
same bullet — asserted by test.

`runTailoringCore()` throws if it is ever executed outside the boundary, so a
future refactor that bypasses `runTailoring()` fails loudly instead of
silently losing the guarantee.

---

## Modes and depth (P1.5, P1.6)

`server/services/resumeTailoring/modes.js`

Every declared key is consumed. A test enumerates the mode objects and fails
if a key is added without a consumer, because config that nothing reads is a
lie told to the next reader.

| Key | Consumed by |
|---|---|
| `targetBulletLength` | `scoreConciseness()` band centre; content strategy |
| `intentPreference` | `planSectionIntents(preferred)` |
| `preferOutcomeLed` | composition-family ordering |
| `projectFirst` | `planContentStrategy()` project priority + budget + cap |
| `ownershipBias` | composer effective ceiling (may only **lower** it) |
| `weights` | `resolveWeights()` → reranker dimension weights |
| `rerankDepth` | retained ranked alternatives |
| `recomposeSummary` | summary stage |
| `prioritizeMatchedRequirements` | JD relevance weighting |

Modes: `balanced`, `achievement-focus`, `leadership-focus`, `fresher`,
`ats-optimize`, `concise`.

Depth is **computation, never permission**:

| Key | standard | deep |
|---|---|---|
| `alternativesPerBullet` | 4 | 8 |
| `rerankKeep` | 4 | 8 |
| `requirementDepth` | 40 | 120 |
| `consistencyPasses` | 1 | 2 |
| `evidenceAnalysis` | standard | expanded |
| `summaryCandidates` | 4 | 8 |
| `maxUnits` | 40 | 60 |

Free vs premium is **never** "our engine vs Claude". Both run the identical
deterministic pipeline under identical truth rules; premium runs more of it.
`depthForPlan()` is the only place plan affects tailoring.

---

## Evidence, requirements and the three relationships

The single most important distinction in the system, and the one that was
silently wrong before Phase 2:

| Relationship | Example | May normalise wording? | May be claimed? |
|---|---|---|---|
| **Equivalence** | `K8s` ≡ `Kubernetes` | yes | yes |
| **Implication** | `GitLab CI` → `CI/CD` | yes | **yes** |
| **Substrate** | `OpenShift` → `Kubernetes` | no | **no** |
| **Relatedness** | `Docker` ~ `Kubernetes` | no | no |

*Implication* is a language/practice relationship: someone who wrote PySpark
genuinely wrote Python; someone who built GitLab CI pipelines genuinely did
CI/CD. Nobody is misrepresented by either sentence.

*Substrate* is a platform relationship. OpenShift engineers have real
container-platform depth, but a recruiter screening for Kubernetes means
Kubernetes, and the candidate is the one who has to survive that conversation.
Substrate satisfies a requirement group and informs gap advice. It never
becomes a word in the resume.

Before Phase 2 these were one table, and `openshift implies kubernetes` put
"Kubernetes" into the claimable vocabulary of every OpenShift candidate.

### Requirement groups (P2.11)

`requirementGraph.js` parses JD statements into AND/OR groups:

```jsonc
{
  "id": "req-2",
  "logic": "OR",
  "priority": "must",
  "members": [
    { "term": "Kubernetes", "state": "PARTIALLY_SUPPORTED" },
    { "term": "OpenShift",  "state": "SUPPORTED" }
  ],
  "status": "SUPPORTED",
  "matchedAlternative": "OpenShift",
  "unmatchedAlternatives": ["Kubernetes"]
}
```

- **OR** groups resolve to their *strongest* member.
- **AND** groups resolve to their *weakest* member.
- `unmatchedAlternatives` become **forbidden vocabulary**. Satisfying a group
  through one sibling never licenses the others.

Support states (P2.12): `SUPPORTED`, `PARTIALLY_SUPPORTED`, `TRANSFERABLE`,
`UNSUPPORTED`. Only `SUPPORTED` is claimable. `TRANSFERABLE` influences
ranking and gap guidance and is explicitly listed in `forbiddenTerms`.

---

## Fail-closed leakage (P1.3) and what "safe" means (P1.4)

`requirementLeakage.js`

Detection without reversion is not a safety feature. If generated content
introduces a forbidden term that was **not in the candidate's original
sentence**, the change is reverted to their own words:

```jsonc
{
  "type": "UNSUPPORTED_REQUIREMENT_LEAKAGE",
  "changeId": "chg-3",
  "requirement": "kubernetes",
  "action": "REVERTED"
}
```

and the run returns `status: "TAILORING_PARTIAL"`.

Defence is layered, because a single check is a single point of failure:

1. **Composition** — candidates containing forbidden terms are rejected before
   scoring.
2. **Summary** — forbidden terms filtered before the summary is chosen.
3. **Final audit** — `auditAndRevert()` over every proposed change.

Surface aliases mean `K8s` trips the `kubernetes` wire.

### `safe`

`safe` is the conjunction of eight hard checks and nothing else:

```
metric · entity · skillContext · seniority
requirementLeakage · certification · employer · evidenceBinding
```

It is **never** inferred from confidence, score delta, or whether the text
changed. The "Accept All Safe" UI binds to this field. A change that is
`reverted` can never be `safe`.

---

## Quota (P1.7)

Resume tailoring consumes the **`tailoring`** bucket, not `aiCalls`.

| Plan | tailoring / day | aiCalls / day |
|---|---|---|
| free | 30 | 10 |
| pro | 300 | 100 |
| premium | unlimited | 400 |

Billing a deterministic operation as an "AI call" would tell the user
something untrue about how their resume was written. `aiCalls` now covers only
genuinely AI-backed optional features.

Routes mapped to `tailoring`: `/api/resume-os/tailor-narrative`,
`/tailor-for-job`, `/narrative/preview`, `/tailor-v3`, `/enhance`, `/assist`,
and `/api/resume/tailor`.

---

## UI terminology (P1.8)

| Was | Now |
|---|---|
| "Tailor with AI" | "Tailor for This Job" |
| "AI tailoring could not run…" | "Tailoring could not run…" |
| "AI tailoring is not enabled…" | "Tailoring is not enabled…" |

Deterministic tailoring is not marketed as AI.

---

## Observability (P2.27)

Recorded per run, no resume content: engine version, mode, depth, duration,
bullets analysed, improvable bullets, candidates generated/rejected, changes
proposed, requirements supported/transferable/unsupported, safety reversions,
consistency changes, boundary id and violation counters.

---

## Known gaps

Carried honestly rather than quietly:

- Product route delegation is now complete for resume-authoring operations:
  Jobs, Editor, Resume Studio, legacy `/api/resume/tailor`, `/tailor-v3`,
  `/tailor-for-job`, `/enhance`, `/assist`, and application-package resume
  generation delegate to the canonical Resume OS application service. The
  narrative preview endpoint may call `runTailoring()` directly because it is
  a non-authoritative candidate-inspection surface, not a second writer.
- Final rendering is intentionally pending: the existing Template OS/vector and
  browser preview paths are not yet normalized behind ResumeRenderService and
  Chromium/Unicode render gates.
- Domain language packs (P2.9) not expanded beyond the existing
  `domainVocabulary.js`.
- ATS null-scoring statuses (P2.20) not implemented.
- Composition families exist (8 including de-nominalisation) but the full
  family list in P2.7 is not exhaustively covered.
- De-nominalisation loses the rerank when the JD itself uses the nominalised
  term, because JD relevance is weighted at 20. This is a real ATS-vs-readability
  trade-off, not a defect, but it is not yet tunable per mode.
