# Innovation & Patent Intelligence OS — changed files (cumulative delta)

This zip contains ONLY new + modified files. Unzip it over the project root
(`career-autopilot/`), preserving paths. It does not include node_modules,
build output, or unchanged files.

## NEW — backend service (server/services/problemIntelligence/)
config.js, util.js, dedupeService.js, ingestionService.js, extractionService.js,
clusteringService.js, opportunityScoringService.js, projectSynthesisService.js,
buildBlueprintService.js, feasibilityCostService.js, ipReadinessService.js,
priorArtWorkspaceService.js, patentBridgeService.js, store.js
connectors/: githubIssuesConnector, stackExchangeConnector, arxivConnector, manualProblemConnector
ai/: aiProvider, fallbackProvider, anthropicProvider, openaiProvider, geminiProvider

## NEW — backend route
server/routes/problemIntelligenceRoutes.js

## NEW — frontend (web/src/)
lib/innovation.js
views/innovation/: shared.jsx, panels.jsx, ProblemDiscovery.jsx, ProblemClusterList.jsx,
                  ProblemClusterDetail.jsx, GeneratedProjectWorkspace.jsx, InnovationOS.jsx

## NEW — tests
test/innovation.test.js  (pure-function; node --test, no network/DB)

## MODIFIED — 4 pre-existing files
server.js                         (+1 import, +1 mount call after /api/patents/disclosures)
web/src/App.jsx                   (+1 import, +1 VIEWS entry: innovation)
web/src/components/app/Shell.jsx  (+Sparkles icon, +NAV entry, +ROLE_NAV student/professional, +NAV_GROUPS Patent Engine)
.env.example                      (+Innovation OS env block)

db.js was intentionally NOT modified — new Mongoose models register on the
shared connection from inside store.js.
