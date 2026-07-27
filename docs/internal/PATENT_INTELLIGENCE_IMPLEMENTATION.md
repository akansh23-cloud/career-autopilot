# Innovation & Patent Intelligence OS Implementation

## What changed

This build replaces the weak/static patent idea generation flow with a source-backed Innovation & Patent Intelligence workflow.

The new flow is:

1. Discover real problem signals from official/public APIs.
2. Extract pain points and constraints.
3. Cluster similar problems and deduplicate repeated signals.
4. Generate a buildable project from a selected cluster.
5. Produce pain framing, MVP blueprint, architecture, roadmap, test plan and demo script.
6. Estimate team size, required skills, resources, timeline and India MVP cost bands.
7. Score IP-readiness with strict caps when source evidence, prior-art, or prototype evidence is missing.
8. Convert generated projects into the existing Project Submission flow or Patent OS workspace.

## New backend files

- `server/services/problemIntelligence/index.js`
- `server/services/problemIntelligence/utils.js`
- `server/services/problemIntelligence/connectors/githubIssuesConnector.js`
- `server/services/problemIntelligence/connectors/stackExchangeConnector.js`
- `server/services/problemIntelligence/connectors/arxivConnector.js`
- `server/services/problemIntelligence/connectors/manualProblemConnector.js`
- `server/services/problemIntelligence/ai/aiProvider.js`
- `server/routes/problemIntelligenceRoutes.js`

## Modified backend files

- `server.js`
  - Mounted `/api/problem-intelligence/*` routes.
- `db.js`
  - Added `ProblemSignal`, `ProblemCluster`, and `GeneratedInnovationProject` schemas/models.
  - Added persistence helpers for discovery runs and generated innovation projects.
- `.env.example`
  - Added Problem Intelligence and model-agnostic AI variables.

## Modified frontend files

- `web/src/lib/api.js`
  - Added `ProblemIntelligence` API client.
- `web/src/views/patent/PatentIdeaGenerator.jsx`
  - Rebuilt page into the new source-backed Innovation & Patent Intelligence OS UI.
- `web/src/views/patent/PatentDashboard.jsx`
  - Updated copy/CTA from generic patent generation to problem discovery.

## New routes

- `GET /api/problem-intelligence/config`
- `POST /api/problem-intelligence/discover`
- `GET /api/problem-intelligence/clusters`
- `GET /api/problem-intelligence/clusters/:clusterId`
- `POST /api/problem-intelligence/clusters/:clusterId/generate-project`
- `POST /api/problem-intelligence/projects/:projectId/build-blueprint`
- `POST /api/problem-intelligence/projects/:projectId/cost-estimate`
- `POST /api/problem-intelligence/projects/:projectId/ip-readiness`
- `POST /api/problem-intelligence/projects/:projectId/convert-to-project`
- `POST /api/problem-intelligence/projects/:projectId/convert-to-patent`
- `POST /api/problem-intelligence/projects/:projectId/generate-disclosure`

## New env vars

```env
PROBLEM_INTELLIGENCE_ENABLED=1
PROBLEM_DISCOVERY_MAX_SIGNALS=30
PROBLEM_DISCOVERY_TIMEOUT_MS=12000
PROBLEM_DISCOVERY_CACHE_TTL_MS=3600000
GITHUB_TOKEN=
STACKEXCHANGE_KEY=
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
OPENAI_BASE_URL=
GEMINI_API_KEY=
AI_MODEL=
```

Notes:

- `GITHUB_TOKEN` is optional but recommended for higher GitHub public API rate limits.
- `STACKEXCHANGE_KEY` is optional but recommended for higher Stack Exchange limits.
- arXiv does not require a key.
- AI keys are optional. Without them, the engine works in deterministic/fallback mode and labels outputs accordingly.

## Safety decisions

- No blind scraping.
- Uses official/public APIs only.
- Does not request private GitHub repository scopes.
- Does not claim patent guarantees.
- Does not claim low prior-art risk without prior-art records.
- IP-readiness score is capped when prior-art/prototype evidence is missing.
- Generated ideas are source-backed or explicitly marked as fallback draft.

## Validation performed

- `npm run build` passed.
- `npm test` passed: 104/104 tests.
- Added `test/problemIntelligence.test.js` for fallback discovery, project synthesis, and IP-readiness caps.

## Known limitations

- GitHub/Stack Exchange/arXiv source quality depends on API response availability and rate limits.
- Current clustering is deterministic keyword/scoring based, not vector-search based yet.
- Prior-art comparison is still manual/workspace-oriented; full automated patent database similarity search is a later phase.
- College/faculty/IP-cell workflow foundation exists through statuses and conversion flow, but a full college multi-tenant dashboard is not implemented in this pass.
