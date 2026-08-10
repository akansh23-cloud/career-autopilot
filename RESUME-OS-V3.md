# Resume OS V3

Deterministic, evidence-first resume engine. **Zero AI in any verdict, score, match, or content-selection path.** Every number is reproducible, versioned, and carries a human-readable reason.

---

## 1. Core invariants

| Invariant | Enforcement |
|---|---|
| No AI in verdict paths | All scoring/matching/selection is pure JS in `server/utils/resume/*`; the legacy `/api/resume/analyze` AI-explanation route is untouched compatibility, never consulted by V3 |
| No fabricated content | `bulletCompiler.containsOnlyProvidedNumbers()` firewall; compiler returns `insufficient_fields` + questions instead of filler; Truth Engine flags `compiled_metric_mismatch` as **critical** |
| Verification annotates, never gates | `VERIFIED` badge requires server-side verification; declared skills are always allowed on the resume — unproven **usage claims** are flagged, listing is not |
| Users can never self-verify | `skill_marked_verified_without_verification` is a critical Truth finding; seeding assigns provenance server-side |
| Tailoring proposes, never applies | `proposeTailoredSelection` emits non-destructive `overrides` + per-decision reasons; the UI requires explicit Accept (snapshot taken first) |
| Content is never silently cut | Fit engine reports (`fit.message`); density steps before anything else; body font floor 9.5px |
| Determinism | Same doc + same options ⇒ same score, byte-identical reasons. Golden test pins dimension keys to `ATS_ENGINE_VERSION` |
| Tenant isolation | College overview uses `collegeScopeMembers` + `requireRole('college_admin','admin')` + `requireCollegeScope`; **aggregate signals only**, no resume content crosses tenants |

## 2. Engine map (`server/utils/resume/`)

| Module | Version | Responsibility |
|---|---|---|
| `resumeDocument.js` | `resume-doc-v3` | Canonical document model, provenance enum, legacy ⇄ V3 conversion (`fromStructuredResume` marks imports `userConfirmed:false`), variant `overrides`, `toPlainText` |
| `dateEngine.js` | — | Date parsing/format detection, range validation, chronology + gap analysis (issue records use `code`) |
| `skillOntology.js` | — | Canonical skills + aliases, `allKnownSkills()` universe for truth scanning |
| `roleDictionaries.js` | — | Role keyword dictionaries incl. **Data Engineer** + aliases (`etl developer`, `analytics engineer`, …) |
| `grammarLibrary.js` | — | Rule-based bullet patterns, verb groups/alternatives, repetition + tense detection |
| `bulletCompiler.js` | — | Deterministic facts → bullet compiler + fabricated-number firewall + quantification prompts |
| `truthEngine.js` | `truth-engine-v1` | Claim firewall: provenance per claim, unsupported-usage scan across the **full ontology**, evidence-id sanity. Findings use `id` |
| `textQualityEngines.js` | `redundancy-v1` | Exact/near duplicate bullets (near ≥ 0.72), readability rules |
| `resumeChecksV3.js` | — | 50+ deterministic checks; free-win scan over **all** verified skills absent from the doc; self-resolves role dictionary; `groupChecksForFixCenter` |
| `atsEngineV3.js` | `ats-engine-v3.0` | 10-dimension score (dimensions sum = score), reasons on every point, `potential = score + Σ check impacts (cap 100)`; without a JD, `jdMatch` folds into `roleAlignment` (max 24) |
| `jdParserV2.js` | — | Sectioned JD parsing with capped weights (required 3.0, cap 4.0), YoE/education/cert extraction |
| `jobMatchEngineV3.js` | `job-match-v3` / `content-selection-v1` | Per-skill ledger (matched/weak/missing + `provable` when verified evidence exists), weighted overall, deterministic actions incl. `build_evidence` CTA; value-per-space content ranking with reasons; non-destructive tailoring proposal |
| `atsParseSimulator.js` | `ats-sim-v1` | Renders → text extraction → weighted field-recovery integrity (name/email critical) |
| `templateCertification.js` | — | Every structural template × 8 fixtures through render→parse round-trip; ≥90% integrity + full heading recovery ⇒ **ATS Checked** badge (earned, not asserted; all 20 pass at 100%) |
| `masterProfileEngine.js` | `master-profile-v1` | Profile + verified submissions + GitHub analyses → master profile; `seedResumeDocument` with honest provenance; evidence-opportunity detection |
| `collegeResumeOverview.js` | — | Aggregate cohort buckets, common unproven must-haves, evidence-sprint suggestions (min cohort 3) |

## 3. API surface (`server/routes/resumeOsRoutes.js`)

All new endpoints under `/api/resume-os/*`; the 3 pre-existing endpoints are untouched.

- `GET  master-profile` — assembled master profile + evidence index
- `GET/POST documents`, `GET/DELETE documents/:docId` — CRUD (Mongo `ResumeDocument`, snapshots capped at 15)
- `POST documents/create` — source `profile` (seeded, provenance-stamped) / `import` (returns `importReview`, nothing auto-trusted) / `blank`
- `POST documents/variants` — master → variant with `overrides`
- `POST documents/snapshots`, `POST documents/snapshots/restore`
- `POST compile` — truth → score → JD parse → match → ranking → opportunities → `nextBestAction`; accepts client `atsSimulation`; optional persist
- `POST tailor-v3` — ranking + proposal (overrides only)
- `POST bullet/compile`, `POST bullet/quantify`
- `POST ats-simulate`, `GET templates/certification`, `POST export/text`
- `GET college/overview` — college-admin only, tenant-scoped aggregates

Engine versions are reported in a frozen `ENGINE_VERSIONS` map on compile responses.

## 4. Client

- `web/src/lib/resumeOs.js` — API wrappers, user-scoped local cache, **re-exports the server document model** (one schema, no client fork), editor helpers, local ATS simulator.
- `web/src/views/ResumeStudio.jsx` — canonical workspace (`studio` view): wizard → studio with Content / Target / Evidence / Fixes / Design tabs, live paginated preview (same renderer as export), local parse round-trip, Health rail with expandable per-dimension reasons, Fix Center with ignore/intentional, tailoring Accept/Reject, snapshots, PDF/DOCX/TXT/JSON export (layout-gated).
- Templates: 12 new V3 templates (`set:'v3'`) appended to the registry; legacy 8 unchanged. `V3_TEMPLATES` export; ATS-Checked badges come from the certification API.
- College: `CollegeWorkspace → Resume readiness` tab now includes the Resume OS cohort card (buckets, common gaps, suggested evidence sprints).

## 5. Migration & compatibility

- Legacy structured resumes round-trip via `fromStructuredResume`/`toRendererStructured`; imported content is `userConfirmed:false` until reviewed.
- Legacy views (`resume` → "Resume Check", `editor`) remain registered and functional.
- `RESUME_TEMPLATES` grew 8 → 20; the registry test asserts the legacy 8 are intact and the V3 set is additive.
- DB: new `resumedocuments` collection only; no existing schema altered.

## 6. Validation

- `test/resumeOsV3.test.js` — 28 tests: model round-trips, truth firewall, compiler determinism + fabrication guard, grammar/dates/redundancy/readability, checks + free wins, ATS V3 determinism/sum/potential, JD weighting, match classification + provable gaps, selection explainability, simulator round-trip, certification of all 12 V3 templates, master-profile provenance, college buckets, NBA ordering, golden score pin.
- `test/routes.smoke.test.js`, full suite, `npm run lint` (0 errors), `npm run build` — all green.

Scoring changes must bump `ATS_ENGINE_VERSION` — the golden test fails loudly otherwise.
