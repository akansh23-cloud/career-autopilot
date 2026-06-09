# Project Creator v2 — Career-Gap Driven Project Engine

This upgrade turns the Project Creator / Project Studio into an adaptive,
proof-based engine: it reads the signals the app already holds (target role,
resume analysis, verified-vs-claimed skills, GitHub proof, saved job, existing
projects, and Patent/Innovation OS clusters), works out the user's real career
gaps, and recommends projects that fix those gaps — then explains, diagrams,
scopes, costs, plans, and verifies each one.

It is **additive**. No existing module (Patent OS, Resume OS, Jobs, GitHub
integration, Auth, Admin, Recruiter, Payments, the existing Project Studio
generator and workspace) was rewritten or removed. Existing tabs, flows, routes
and storage all behave exactly as before.

---

## Design principles enforced

- **Deterministic first, AI optional.** Every feature runs with no AI key and no
  network call. The engine returns rule-based output; AI can only *enrich* it
  later via the existing `/api/creator/*` endpoints. Nothing here requires a key.
- **No fabricated proof.** Verified resume bullets are emitted *only* when real
  evidence exists (GitHub analysis success, verified live demo, detected tests,
  or admin/faculty verification). Unverified claims are always returned as drafts
  with an explicit warning — never as achievements.
- **No duplicate projects.** A keyword-similarity memory check (no vector DB)
  flags near-duplicates and suggests a different proof gap to target; the
  innovation bridge refuses to import the same cluster twice.
- **Surgical UI.** New tabs and sections reuse the existing Aurora design system
  and kit components. The heavy logic lives server-side (testable); the client
  assembles real signals and calls the deterministic API with offline fallbacks.

---

## Files added

### Backend services — `server/services/projectIntelligence/`
| File | Responsibility (spec task) |
|---|---|
| `util.js` | Shared deterministic helpers (text similarity, slug/label sanitisation, parsing). |
| `config.js` | Feature flag, provider resolution, role families, disclaimer, INR difficulty bands. |
| `projectGapMatchingService.js` | **Task 1** — gap matching: role/skill gaps, unverified claims, job-requirement gaps, proof gaps → ranked recommendations. |
| `whyBuildService.js` | **Task 2** — per-project "why build this" value (resume/recruiter/job-readiness/XP). |
| `projectExplainerService.js` | **Task 3** — plain-language explainer (modules, how it works, first-week tasks, what not to build yet). |
| `projectDiagramService.js` | **Task 4** — six project-specific Mermaid diagrams, renderer-safe. |
| `feasibilityService.js` | **Task 5** — difficulty, team, roles, INR cost bands, risks, solo-builder verdict. |
| `buildBlueprintService.js` | **Task 6** — 17-section build blueprint (scope, screens, APIs, schema, tests, deploy, README, checklist). |
| `taskBoardService.js` | **Task 7** — dependency-ordered, GitHub-ready issues with acceptance criteria. |
| `proofChecklistService.js` | **Task 8** — minimum/strong/recruiter-ready tiers reconciled against the *real* proof score (no fake ticks). |
| `resumeOutputService.js` | **Task 9** — evidence-backed resume output with the hard no-fabrication rule. |
| `projectMemoryService.js` | **Task 10** — duplicate detection + "target a different gap" suggestion. |
| `innovationBridgeService.js` | **Task 11** — imports a Patent/Innovation OS cluster as an innovation-grade project, preserving IP fields; blocks duplicate imports. |

### Routes
- `server/routes/projectIntelligenceRoutes.js` — **Task 12.** Registers
  `GET /api/project-intelligence/config` and `POST` endpoints for `recommend`,
  `why-build`, `explain`, `blueprint`, `diagrams`, `feasibility`,
  `proof-checklist`, `task-board`, `resume-output`, `import-innovation-project`,
  and `similar` (plus a documented `GET /similar` alias). All require auth, are
  zod-validated, feature-flag guarded (404 when disabled), and never throw —
  on error they return `{ ok: false, mode: 'error' }` so the UI degrades cleanly.

### Client
- `web/src/lib/projectIntelligence.js` — assembles **real** signals from
  `userProfile`, `resumeStore`, `projectStore`, and `xp` (verified skills, GitHub
  proof rolled up from analyzed repos), and wraps each endpoint with an offline
  fallback.
- `web/src/views/ProjectIntelligencePanels.jsx` — all new UI: the ten workspace
  tabs and the gap-driven `RecommendedProjects` section, plus a
  `deriveRecommendation(project)` helper that lets every panel work for
  already-saved projects, not just fresh recommendations.

### Tests
- `test/projectIntelligence.test.js` — **Task 15.** 23 `node --test` cases over
  the services directly (see "Test results").

## Files modified
- `server.js` — **two lines only:** one `import` and one
  `registerProjectIntelligenceRoutes(app, { requireAuth, currentUser, generationLimiter })`
  call, placed next to the existing problem-intelligence registration.
- `web/src/views/ProjectStudio.jsx` — import the new panels; add ten tabs to the
  `WorkspaceModal` (Why Build This, Explain Project, Build Blueprint, Diagrams,
  Cost & Team, GitHub Task Board, Proof Checklist, Verification Path, Resume
  Output, Similar Projects); render each lazily; add the gap-driven
  "Recommended next projects" section to the main view; `generate()` now accepts
  an override so "Build this" can seed it directly. Existing tabs untouched.
- `web/src/views/ProjectCreator.jsx` — import the panels; `run()` now accepts an
  override (avoids stale-state); add a `buildFromGap` handler and a gap-driven
  recommendations section to the Discover step. Existing discovery/build flow
  untouched.

---

## New workspace tabs (Project Studio → Open workspace)

Why Build This · Explain Project · Build Blueprint · Diagrams (six
project-specific Mermaid views) · Cost & Team · GitHub Task Board · Proof
Checklist · Verification Path · Resume Output · Similar Projects — alongside the
original Overview, Architecture, Roadmap, Tasks, GitHub Sync, Verification and
Resume/Interview tabs.

Each new tab fetches only when opened, shows a loading state, and renders a
deterministic result with a short note clarifying whether AI enrichment is
available.

---

## API quick reference

All under `/api/project-intelligence`, all `POST` unless noted, all auth-gated:

`GET config` · `recommend` · `why-build` · `explain` · `blueprint` · `diagrams`
· `feasibility` · `proof-checklist` · `task-board` · `resume-output` ·
`import-innovation-project` · `similar` (POST; `GET` alias documented).

Mode is reported as `deterministic` or `deterministic+ai-available`.

---

## Test results

```
npm ci      → ok
npm run build → ok (dist/ generated; new view compiles with the app)
npm run lint  → 0 errors
npm test      → 169 / 169 passing (includes 23 new project-intelligence tests)
```

The new suite asserts the rules that matter, not just shapes:
- recommendations carry the full contract; claimed-but-unverified skills are flagged;
- innovation clusters surface as innovation-grade recommendations;
- the six diagrams are renderer-safe Mermaid (sanitised labels, valid headers);
- feasibility returns INR cost bands and a verdict;
- the proof checklist marks items satisfied **only** from the real proof breakdown;
- **resume output returns zero verified bullets without evidence, and verified
  bullets only when real evidence exists;**
- duplicate detection flags near-identical projects and ignores unrelated ones;
- innovation import preserves IP fields and refuses to import the same cluster twice;
- every service runs deterministically with no AI key / no network, and tolerates
  empty input without throwing.

---

## Known limitations / notes

- **`/similar` is implemented as `POST`** (the client holds the project list); a
  `GET` alias is registered and documented but returns guidance rather than a
  real check, deviating from the original spec's `GET`.
- **No DB schema change.** Persistence stays in the existing client project store
  (same pattern as problem-intelligence), avoiding any migration risk.
- Duplicate detection uses keyword/Jaccard similarity, **not** a vector database.
- AI enrichment is not wired into these endpoints yet — they are deterministic by
  design. The hook is the existing `/api/creator/*` AI endpoints.
- Lint reports pre-existing warnings (unused-var style, mostly JSX imports the
  base config can't see) across the codebase; this upgrade adds none of a new
  *kind* and introduces **0 errors**.

## Recommended next phase

1. Optional AI enrichment layer over `why-build` / `explain` / `blueprint` using
   the existing AI endpoints, behind the same feature flag, still falling back to
   deterministic output.
2. Persist generated blueprints/task boards onto the saved project so they're
   cached between sessions.
3. A real `GET /similar` once project lists are queryable server-side.
