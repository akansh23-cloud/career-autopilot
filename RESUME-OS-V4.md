# Resume OS V4

The self-sufficient resume platform. Everything works with **zero AI**; AI is an optional, truth-gated wording layer that sits *above* the deterministic engine and can be removed without losing a single capability.

```
PROFILE + EVIDENCE + JOB
        ↓
DETERMINISTIC RESUME OS          ← authoritative, always
        ↓
TRUTHFUL STRUCTURED RESUME (one canonical ResumeDocument)
        ↓
OPTIONAL AI ASSIST (wording only)
        ↓
TRUTH ENGINE (rejects unsupported AI claims)
        ↓
FINAL RESUME → PDF / real DOCX / TXT
```

## 1. Zero-AI canonical pipeline — "Tailor for Job"

`POST /api/resume-os/tailor-for-job` runs the entire chain in one deterministic request:

trust sanitization → JD parse (+ role detection) → requirement weighting → evidence match → content ranking → template recommendation → content budget plan → deterministic summary candidates → variant proposal → truth audit → ATS health → gap report.

The response is the **Job Tailor Package**: `jobMatch`, `atsHealth`, `evidenceCoverage`, `criticalRequirements met/total`, `missingEvidence[]` (with `provable` flags), recommended template + alternatives, page target, deterministic summary, and a ready-to-accept **variant** (`kind:'variant'`, `parentId`, non-destructive `overrides`). Nothing is applied until the user clicks Accept; the master document is never mutated.

**Gap rule:** a missing requirement (e.g. Terraform) is *never* inserted as experience. It surfaces as `missingEvidence` with a **Build Evidence** CTA that opens Project OS carrying `{ targetRole, targetSkill, reason:'resume_gap' }` — and Project OS consumes that context (banner + prefilled generator), closing the requirement → evidence → project → verification → resume loop.

## 2. Trust boundary V2 (`trustBoundary.js`)

Client-side `verified:true`, `status:'VERIFIED'`, or client-submitted evidenceIds **never** establish verification. `sanitizeDocumentTrust()` re-stamps every trust-bearing field from server context (verified skills, verified project ids, server evidence index) before any document is scored, matched, tailored, exported, or persisted. Unknown evidence ids are stripped, provenance is downgraded, and every change is returned in an auditable `changes[]`. With no server context the boundary **fails closed**. Wired into: save, compile, tailor-v3, tailor-for-job, summary, recommend, autofit, docx export.

## 3. Deterministic engines added in V4

| Engine | Version | What it does |
|---|---|---|
| `summaryCompiler.js` | `summary-compiler-v2-vocabulary` | 2–4 line summaries from facts only: role, years computed strictly from dated experience, technologies actually on the doc, verified-project counts. Expanded deterministic pattern vocabulary, seeded variation, template-aware character limits, sentence-safe clipping, and no invented facts. |
| `contentBudget.js` | `content-budget-v2-template-contract` | Template-specific capacity contracts now survive TemplateDefinition → runtime card → Tailor for Job. Budgets cover summary, current/previous experience bullets, projects, skills, certifications and achievements; every trim remains explainable and non-destructive. |
| `contentBudget.js` | `auto-fit-v1` | Fixed overflow order: duplicates → lowest-value skills → lowest-value unverified project → older-role bullets → density → margins → line-height → font → **second page**. Hard floors: font ≥ 9.5px, line-height ≥ 1.18, margins ≥ 10mm. Readability is never sacrificed. |
| `templateRecommender.js` | `template-recommender-v1` | Explainable 0–100 template ranking by role family, detected career stage, content shape, ATS preference and certification status. `productionEnabled:false` templates are never recommended. |
| `writingProviders.js` | `writing-providers-v2-vocabulary` | Provider abstraction + truth gate, with expanded deterministic wording cleanup/alternatives; AI remains optional and truth-gated. |
| `docxWriter.js` | `docx-writer-v1` | **Real** WordprocessingML `.docx` (Content_Types, document/styles/numbering parts, real bullet numbering, XML-escaped, deterministic bytes). Validated to open in python-docx/Word/LibreOffice. `POST /api/resume-os/export/docx`. The legacy HTML `.doc` remains only as a client-side fallback. |

## 4. Optional AI Assist

`ResumeWritingProvider` interface with two implementations:

- **DeterministicWritingProvider** (mandatory default, always available): filler removal, active-voice cleanup, lead-verb alternatives from the grammar library, outcome-first inversion, recompilation from confirmed facts.
- **AnthropicWritingProvider** (optional adapter, exists only when `ANTHROPIC_API_KEY` is set): wording-only prompt, receives *only* the selected text + approved facts + up to 8 JD skills (token/cost/privacy control), 12s timeout. Future OpenAI/Gemini adapters implement the same interface.

**The gate (`validateRewrite`)**: every AI candidate is rejected — not warned — if it introduces a number, a known technology, or a credential/achievement-shaped claim absent from the source, or replaces more than half the source vocabulary. Rejected candidates never reach the user as applyable; the UI shows only a rejection count. AI outage, quota, malformed output → deterministic candidates still return; the workflow never blocks. `POST /api/resume-os/assist`.

UX: primary action is **Tailor for Job** (no AI). "Improve wording" on bullets/summary opens a side-by-side Original / Deterministic / AI comparison; AI column only renders when the user ticks the opt-in and a provider exists.

## 5. Template platform

28 templates (8 legacy + 12 V3 + 8 V4), all render the same canonical ResumeDocument through the shared renderer — templates decide **how**, the content engine decides **what**. V4 additions: Sentinel (security), Tensor (DS/ML), Meridian (consulting/finance), Compass (PM), Graduate, Internship Sprint, Foreman (EM), Directorate (Director). All 28 pass render→parse ATS certification at 100% integrity.

Every template carries **license metadata**: `licenseStatus` (`INTERNAL_ORIGINAL | OWNED | OPEN_SOURCE | LICENSED | LICENSE_PENDING | DEVELOPMENT_REFERENCE`), `source`, `licenseName`, `licenseNotice`, `productionEnabled`. All shipped designs are `INTERNAL_ORIGINAL`. An externally sourced template can live in the codebase as `LICENSE_PENDING` with `productionEnabled:false` — invisible to users and the recommender — and go live with a **data flip, not a code change**. Descriptors also declare `supportedRoles`, `careerStages`, `atsLevel`, optional `contentBudget` overrides.

## 6. Import & export

- **Import** (deterministic, no AI): PDF via lazy-loaded pdfjs (line-grouped extraction), DOCX via lazy-loaded mammoth, TXT direct — feeding the existing structured import parser; imported content stays `userConfirmed:false` until reviewed.
- **Export**: PDF (layout-gated) with optional **real PDF validation** (`validatePdfBlob` re-parses the produced PDF with pdfjs and measures field recovery); real DOCX (server); TXT; JSON.

## 7. API surface added in V4

`POST tailor-for-job` · `POST summary/compile` · `POST templates/recommend` · `POST autofit` · `POST assist` · `POST export/docx` — all under `/api/resume-os/*`, all behind auth, all reporting `ENGINE_VERSIONS` (now including trustBoundary, summary, contentBudget, templateRecommender, writingProviders, docx).

## 8. Acceptance status

- **Zero-AI test**: the full flow (profile → job → tailor → match → selection → summary → bullets → template → auto-fit plan → ATS → gaps → variant → preview → PDF/DOCX/TXT) runs in the test environment with no AI env vars set — covered by `test/resumeOsV4.test.js` route test, which also asserts `aiAvailable:false`.
- **AI-optional test**: fake-provider tests prove hallucinated numbers/certs are rejected (`aiRejected`), valid rewordings pass, and provider outage degrades to deterministic-only.
- **Truth**: the route test proves a client-claimed VERIFIED skill is downgraded on save and a missing JD requirement (Terraform) appears as a gap, never as content.

See `RESUME-OS-V3.md` for the underlying V3 engine map and `THIRD_PARTY_NOTICES.md` for library/licensing notes.

## Exact template revision on variants

Resume OS persists `templateId + templateVersion` on canonical documents and tailored variants. Template recommendation results include the revision that was scored, and export/auto-fit operations use strict exact-version resolution. This prevents a later Template OS release from changing an already-saved application resume without an explicit user upgrade.
