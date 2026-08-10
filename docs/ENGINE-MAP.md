# Engine Map & Consolidation Plan (Phase 2)

The audit below is the basis for every Phase 2 change. Rule applied throughout:
the newest engine is canonical only where it is objectively the strongest;
older engines are kept behind adapters, never deleted while a screen uses them.

## 1. Project generation — implementations found

| Generation | Location | Verdict |
| --- | --- | --- |
| G1 client legacy | `web/src/lib/projectGen.js`, `projectCreator.js` | Category-driven templates; no profile signals. **Kept** for Project Studio offline flows; not canonical. |
| G2 client recommender | `web/src/lib/projectRecommend.js` | Duplicates G4 on the client. **Kept** as offline fallback only. |
| G3 project-builder | `server/services/projectBuilder`, `/api/project-builder/*` | Brief/export oriented. Kept; not canonical. |
| G4 gap matcher | `server/services/projectIntelligence/projectGapMatchingService.js` | Deterministic, profile-signal driven, explains WHY, scores readiness impact, dedupes against existing projects. **Canonical recommender.** |
| G5 Synthesis Intelligence | `server/services/synthesisIntelligence/*` via `/api/intelligence/create-project` | Package-first generation with quality validation; degrades to legacy input. **Canonical package source.** |
| G6 Workspace Engine | `server/utils/workspace/*` (`buildWorkspacePlan`) | Deterministic domain-modelled plan: roadmap phases, file-linked tasks, acceptance criteria, check commands, API/DB/test/deploy plans, honest done-vs-verified progress. **Canonical planner.** |

**Canonical pipeline (confirmed, already wired in `/api/intelligence/create-project`):**
`profile signals → G4 matchProjects (WHY + gaps) → G5 project package → normalizeCustomProject → G6 buildWorkspacePlan → workspace routes`.
Phase 2 strengthens G6 (dependencies, weighted progress, requirement-aware
verification) rather than adding a seventh generator.

## 2. Canonical Project Package

The Synthesis package + workspace plan already jointly carry nearly every field
in the Phase 2 contract. Mapping (no schema churn — existing names kept):

| Contract field | Existing home |
| --- | --- |
| projectId / studentId | `plan.projectId` / `plan.userId` |
| targetRole, targetSkills, gapsAddressed, whyRecommended | G4 recommendation (`targetRole`, `skills`, `skillGapsFixed`, `whyRecommended`) carried on `project.intelligence` |
| title, problemStatement, targetUser, difficulty, recommendedStack | `plan.projectSummary` |
| architecture | `plan.architecture` (Architecture OS spec) |
| functional / non-functional requirements | `plan.featureSpecs`, `plan.mvpScope`, `plan.testPlan`, `plan.deploymentPlan` |
| milestones | `plan.roadmap` (phase objects) |
| tasks, dependencies, acceptanceCriteria | `plan.tasks[]` — **Phase 2 adds `dependsOn` + `weight`** |
| evidenceRequirements | `plan.proofRequirements` + task `verificationRules` |
| completionCriteria / verificationStatus / verificationConfidence | `plan.verificationSummary` — **Phase 2 adds per-task matrix + confidence** |
| skillEvidence | **Phase 2:** emitted by verification (task→skill attribution) |
| resumeOutcomes, interviewTalkingPoints | project-intelligence `resume-output` service |
| nextBestAction | `plan.nextAction` — **Phase 2 makes it dependency-aware** and adds the platform-wide NBA engine |

## 3. Verification — canonical stack (kept, extended)

- Evidence gathering: `utils/workspace/proofVerification.js` (three-outcome:
  present / absent / unavailable→pending; SSRF-guarded).
- Judgement: `utils/workspace/workspaceValidator.js` (verified /
  self_reported / pending / not_applicable; deliberately no `failed`).
- Skill XP: `utils/skillVerificationEngine.js` + `db.applySkillVerification`.
- Signed credentials: `utils/verificationCredentialEngine.js`
  (method→confidence ceilings; medium+ counts).
- Authorship + repo→skill mapping: `utils/githubIntegrationEngine.js`.
- Comprehension: `utils/vivaEngine.js` (high-confidence tier).

**Phase 2 additions** (`utils/workspace/taskVerification.js`): per-task
requirement matrices from acceptance criteria + gathered evidence, partial
verification, evidence-confidence, deterministic task→skill attribution feeding
the *existing* XP ledger, and remediation actions. No new subsystem.

## 4. Readiness

`utils/readinessEngine.js` (readiness-v1) is verified-only and stays the
college/recruiter number (backwards compatible). Phase 2 adds
`computeRoleReadiness` (readiness-v2) on top: role-specific dimensions from
`utils/resume/roleDictionaries.js` (the richer of the two role sources; the
projectIntelligence role families remain for recommendation only), explainable
per-dimension evidence, highest-impact actions, and delta attribution via a
snapshot in user state.

## 5. Next Best Action

Currently three places compute an NBA independently (workspace
`progressCalculator`, the student dashboard's three-branch heuristic, mission
hints). Phase 2 introduces one deterministic engine
(`utils/nextBestActionEngine.js`, `/api/next-best-action`) that ranks candidate
actions from real state (workspace plans, verification pendings, role
readiness, resume evidence gaps, college tasks). Workspace-internal NBA remains
for the plan view; the platform NBA consumes it.

## 6. College / interventions

Existing, kept: `collegeObservability.js` (funnel, risk register, cohorts),
`/api/college/tasks` (bulk assignment + completion tracking + notifications),
trends snapshots, team projects, strict `callerCollegeId` scoping.
**Phase 2 adds** `utils/interventionEngine.js`: deterministic cohort detection
over the already-scoped deep rows → structured intervention recommendations →
assignment through the existing task/notification infrastructure → before/after
outcome measurement from stored readiness snapshots. No new isolation paths:
every query flows through `collegeStudentsDeep({ collegeId })`.

## 7. Resume

Deterministic scorer (`utils/resume/scoringEngine.js`) stays authoritative.
Phase 2 adds `utils/resume/evidenceGapClassifier.js` with the three
recommendation types (verified-but-absent / weak-wording / evidence-missing),
each carrying provenance or a Build-Evidence CTA into the canonical
recommender. AI never invents metrics; TYPE 2 rewrites draw only from known
evidence.

## 8. Patent / Innovation convergence (Phase G — plan only, per directive)

Overlap found: `services/problemIntelligence/*` (problem clusters, IP
readiness, patent bridge) vs `utils/patentEngine.js` +
`patentScoringEngine.js` + `priorArtEngine.js` + `disclosureEngine.js`.
Convergence plan (not executed in this phase):
1. Problem Intelligence remains the single intake (evidence-backed problems).
2. `patentBridgeService` becomes the only path that creates Patent OS ideas
   (career-intelligence `send-to-patent` already routes through
   `db.createPatentIdeas` — reuse).
3. Prototype evidence: Patent OS references Project OS evidence by
   `projectId`/verification ids (the new evidence graph) instead of re-upload.
4. `ipReadinessService` + `patentScoringEngine` merge behind one scoring
   facade; both currently produce 0–100 scores with different rubrics.
5. Safety language, Section 3(k) checks, prior-art and disclosure-risk
   safeguards are preserved verbatim.

## 9. Compatibility commitments

- `dependsOn`, `weight`, `taskVerification`, `skillEvidence`,
  `roleReadiness` are all additive with defaults; plans, submissions,
  credentials and interventions created before Phase 2 continue to load and
  recalculate unchanged (covered by tests).
- No route removed; no schema field repurposed; db-off degradation preserved
  on every new endpoint.

---

# PHASE 2 — SHIPPED (implementation record)

Everything below is live in this build, additive, and covered by
`test/phase2Intelligence.test.js` (18 tests) plus the untouched existing suite.

## Student loop (end-to-end)
PROFILE → TARGET ROLE → `/api/readiness?targetRole=` (readiness-v2: role
dimensions, evidence levels, top-impact actions, delta attribution vs stored
snapshot) → `/api/next-best-action` (deterministic platform NBA) →
`/api/project-intelligence/recommend` (gap-driven WHY) →
`/api/intelligence/create-project` (Synthesis package → Workspace plan) →
workspace tasks now carry `dependsOn` (artifact/phase-gate/critical-path
rules) and derived weights (hours × priority × proof) →
`/api/workspace/:id/verify` runs proof checks **and** Verification V3
(`taskVerification`: per-task criteria matrix, partial states, exact
remediation, done+all-machine-rules promotion, skill attribution) → promoted
repo-backed evidence flows into the existing skill ledger via the canonical
`verifyProjectSubmission` + `db.applySkillVerification` → readiness moves and
explains why → `/api/resume/evidence-gaps` classifies TYPE 1/2/3 with
provenance → TYPE 3 routes back into the recommender. Traceability:
`POST /api/workspace/:id/evidence-graph` (+`?skill=`) answers "why is this
skill verified" from real ids.

## College loop
`/api/college/interventions/recommendations` — 5 deterministic cohort rules
(backend evidence, pending verification, resume evidence, inactive recovery,
application readiness) over the **already-scoped** deep rows; every member
carries its qualifying reason. `POST /api/college/interventions/assign` —
scope-filters ids, reuses `createCollegeTask` + notifications, snapshots the
cohort baseline. `GET /api/college/interventions` — live
`measureInterventionOutcome`: real before/after readiness, verified skills,
verified projects, resume score and linked-task completion; refuses to
measure without a baseline instead of forecasting.

## UI (V4 preserved)
Student dashboard reordered to: role readiness (dimension bars + "why it
moved") → highest-impact action → active project (built vs verified) →
verification attention → skill-gap chips → resume action → apps/deadlines →
XP/badges demoted below. Workspace: dual built/verified progress bar,
dependency locks + verify chips on task cards, task-verification summary +
remediation rows in the Proof tab. College Interventions tab: recommendation
cards with reviewable cohorts and one-click assignment, plus measured
outcomes. Resume: evidence-backed recommendations panel.

## Client fallback contract
`web/src/lib/nextBestAction.js` — API-first; on `db_off`/failure computes a
local NBA from the browser's own project store using the same action shape,
labelled `computedBy: 'local-fallback'`. It never fabricates server state.

## Compatibility guarantees (tested)
Pre-Phase-2 plans recalculate unchanged (`percentDone` stays count-based;
missing `dependsOn` never blocks); readiness-v1 contract untouched for
college/recruiter consumers; no route removed; every new endpoint degrades
db-off.
