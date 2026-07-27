# Project Brief + discipline-aware build guidance

Three linked complaints, one root cause: everything downstream of project
generation assumed the project was a MERN web app, and nothing explained the
project in plain language.

## What was actually wrong

**`convertToProject` (server/utils/disclosureEngine.js) was a fixed template.**
Every patent idea — sensor rig, lab assay, bridge inspection, web tool — got
the same four `coreFeatures`, the same "modular monolith" architecture, the
same `POST /ingest` API list, the same MongoDB-shaped schema and the same
demo script. No AI call, no explanation field.

**No AI was reaching the explanation surfaces.** The provider layer
(`server/services/problemIntelligence/ai/`) already supports Gemini, Anthropic
and OpenAI with a deterministic fallback — `GEMINI_API_KEY` + `AI_PROVIDER=gemini`
is all it needs. But `convertToProject` never called it, and `explainProject`
is deterministic-only. `simplifyProject` (which *is* AI-backed) was reachable
from one Innovation-OS route and nowhere near the workspace.

**The Guided Build Kit is MERN-hardcoded.** `guidePlanner.js` has a CONCEPTS
library of Node/Express/Mongoose/React only; `runFor()` returns
`npm run dev --prefix backend` for every task shape; `stackDetector.js`
degrades everything to the same skeleton. An agriculture or defence hardware
idea got told to run npm.

## What changed

- **`server/services/projectBrief/disciplineProfiles.js` (new)** — deterministic
  classifier over 7 disciplines (software, hardware/embedded, data/ML,
  mechanical, bio/chem, civil/infra, business/ops). Each carries its own build
  unit, toolchain, first-week plan, proof artifacts, validation standard, cost
  reality and failure mode. Weighted keyword scoring; software no longer wins
  by default. Explicit `project.discipline` overrides detection.

- **`server/services/projectBrief/projectBriefService.js` (new)** — the brief.
  Deterministic skeleton, AI prose on top via the existing provider (Gemini
  included). Answers: what is this, who is it for, how it works stage by stage,
  what finished looks like, how you prove it works, what you're deliberately
  *not* building, where this usually goes wrong, plus a glossary of terms the
  student will hit. `generatedBy` always reports the real provider — a
  templated brief reports `deterministic` and confidence `low`.

- **`convertToProject` rewritten** — now async and discipline-shaped. Emits
  `frontendScreens` / `backendApis` / `databaseSchema` **only** when the project
  has a software component; otherwise emits that discipline's real work
  products (BOM + calibration for hardware, protocol + controls for lab,
  code-compliance sheet for civil). Adds `whatYouAreBuilding`,
  `howYouKnowItWorks`, `costReality`, `toolchain`, `buildSteps`. All legacy
  fields kept. `convertToProjectDeterministic` remains sync and AI-free.

- **`ProjectBriefPanel.jsx` (new)** + POC tab rewritten — the brief renders
  *above* the artifacts, so you read what you're building before you're handed
  a task list. Footer states plainly when the brief was templated.

- **New routes** — `POST /api/project-intelligence/brief` and
  `POST /api/project-intelligence/discipline`.

- **`test/projectBrief.test.js` (new)** — 22 tests, all passing with no API key.

## To turn on Gemini

    AI_PROVIDER=gemini
    GEMINI_API_KEY=...
    AI_MODEL=gemini-2.0-flash

Responses are cached per prompt (`aiCacheTtlMs`, default 1h). With no key the
brief is still complete — just templated, and it says so.

## Still generic (not done here)

`guidePlanner.js` and the starter-pack codegen are unchanged — they still emit
npm-shaped tasks. The discipline layer now exists for them to read from; wiring
it in is the next piece of work.
