# Architecture Diagram OS — Upgrade Notes

Upgrades the basic Mermaid-only architecture generator into a structured,
deterministic, multi-view Architecture Diagram OS. Fully additive — no
existing feature, route, view or data shape was removed or changed.

## What changed

### Backend (new: `server/utils/architecture/`)
- `knowledgeBase.js` — curated offline knowledge base: 12 architecture patterns
  (three-tier SaaS, microservices, AI/RAG, resume/job-matching, DevOps CI/CD,
  marketplace, exam/proctoring, patent intelligence, placement analytics,
  event-driven pipeline, serverless API, Kubernetes), a capability catalog,
  AWS/Azure/GCP/generic cloud-service mappings, and 9 diagram templates.
- `patternMatcher.js` — deterministic keyword/use-case scoring; falls back to
  three-tier SaaS; returns confidence + reasons + alternatives.
- `serviceMapper.js` — capability → provider service names (S3/Blob/GCS etc.).
- `specBuilder.js` — builds the structured `architectureSpec` with up to 9
  views (systemContext, container, deployment, dataFlow, security, cicd,
  observability, scalingFailure, patentFigure), each with groups (incl. nested
  region/VPC/subnet for cloud deployment), typed nodes, labeled edges,
  annotations, legend and risks. Same input ⇒ same spec.
- `validator.js` — 19 best-practice checks (auth, RBAC, rate limiting,
  secrets, DB, backup, monitoring/logging/alerting, CI/CD, queue, cache,
  object storage, DLQ, env separation, audit logs, IaC, tracing) + quality
  score across 8 categories (security, scalability, reliability,
  observability, maintainability, deployment readiness, data design, cost
  awareness) and an `overallScore`.
- `mermaidAdapter.js` — converts spec views to the legacy `graph TD` subset the
  existing in-app renderer parses (backward compatibility adapter), plus a
  deterministic server-side SVG exporter.
- `refineEngine.js` — instruction-based refinement via keyword rules (no AI):
  "Add Redis cache, SQS queue, worker, monitoring, backup and CI/CD" /
  "Remove the WAF". Bumps version, returns a diff summary.
- `index.js` — orchestrator: analyzer → matcher → mapper → builder →
  validator → adapters.

### New API endpoints (`server/routes/architectureRoutes.js`)
All behind the existing `requireAuth` + `generationLimiter`, mounted from
`server.js` exactly like the other route modules:
- `POST /api/architecture/spec` — generate/regenerate (returns spec,
  mermaidViews, validation, warnings, recommendations, service mappings).
- `POST /api/architecture/validate` — checks + score + missingCriticalItems.
- `POST /api/architecture/refine` — apply an instruction, get diffSummary.
- `POST /api/architecture/export` — json / mermaid / svg per view. PNG/PDF
  honestly return `unsupported_format` (no headless browser in this stack).
- `GET /api/architecture/specs?projectId=` — saved versions (DB-backed,
  empty-safe without a DB). `GET /api/architecture/meta` — view types/levels.

### Legacy route (unchanged contract, additive payload)
`POST /api/architecture/generate` still returns the exact old shape
(`architecture`, `narrative`) and now ALSO returns `architectureSpec`,
`mermaidViews`, `validation`. If the new engine ever fails, the legacy
response is unaffected (wrapped in its own try/catch).

### Persistence (db.js, graceful fallback)
New `ProjectArchitectureSpec` collection (userId, projectId, title, provider,
targetLevel, version, architectureSpec, mermaidViews, validationScore,
checks, timestamps) with auto-incrementing versions per project. Helpers:
`saveArchitectureSpec`, `getLatestArchitectureSpec`,
`listArchitectureSpecVersions` — all safe no-ops when `MONGODB_URI` is unset.

### Frontend
- `web/src/lib/architectureSpec.js` — pure helpers: spec detection, canonical
  view ordering, deterministic nested-group layout (shared logic with the SVG
  export), client Mermaid mirror, palette/tone helpers. Node-testable.
- `web/src/components/architecture/`:
  - `architectureIconMap.jsx` — generic icon keys → lucide-react (no
    hotlinking; provider SVG packs can slot in later).
  - `ArchitectureCanvas.jsx` — dependency-free professional SVG renderer:
    grouped boundaries (region/VPC/subnet dashed nesting), node-type colors +
    icons, labeled/dashed-async edges, legend, annotations, zoom controls.
    Clean enterprise style, no animation. (React Flow/elkjs were NOT added —
    a custom renderer matches the repo's dependency-free renderer policy and
    avoids ~1MB of new bundle; documented as the sanctioned fallback.)
  - `ArchitectureTabs.jsx`, `ArchitectureValidationPanel.jsx`,
    `ArchitectureExportPanel.jsx` (copy JSON/Mermaid client-side, SVG download
    via the backend exporter).
  - `ArchitectureDiagram.jsx` — universal wrapper: spec → new canvas; anything
    else → the proven legacy Mermaid renderer (old data can never crash it).
- `web/src/views/ArchitectureView.jsx` — upgraded to the Diagram OS: cloud
  provider selector, multi-view tabs, professional canvas, validation panel
  with quality score + missing production-readiness items, refine prompt box,
  export panel. All legacy prose sections (DB/API/security design, maturity
  score, gaps, etc.) retained; legacy 4-diagram tabs remain as fallback.
- Project OS: `ProjectStudio.jsx` + `ProjectCreator.jsx` now render through
  the universal wrapper — projects carrying an `architectureSpec` get the new
  canvas; every existing project renders exactly as before.
- Patent OS: `POST /api/patent/assess` additively returns `patentFigure`
  (figure-ready system diagram with numbered modules, decision engine,
  storage/indexing, feedback loop) from the same engine; `PatentEngine.jsx`
  renders it as "Patent figure (FIG. 1 draft)". Explicitly NOT a
  patentability claim. Scores untouched.
- `web/src/lib/api.js` — `Architecture.{spec,validate,refine,exportView,savedSpecs}`.

## Tests
- `test/architecture.test.js` — pattern matching, spec building, determinism,
  level behavior, Mermaid/SVG adapters (verified against the legacy parser),
  validation, refine add/remove/no-op, all new endpoints incl. auth + honest
  PNG rejection, legacy-route backward compatibility, Patent OS figure.
- `test/architectureClient.test.js` — spec detection, tab ordering, layout
  (incl. 3-level nesting), client Mermaid mirror, legacy-Mermaid safety.

Suite: **271 passing, 0 failing** (`npm test`). Lint: **0 errors**
(`npm run lint`). Build: ✓ (`npm run build`, dist/ rebuilt).

## Known limitations
- PNG/PDF export is not implemented (returns `unsupported_format` honestly);
  SVG/Mermaid/JSON are fully supported.
- Refinement is keyword-rule based — unknown phrasing is reported as
  unrecognized rather than guessed.
- Saved spec versions require `MONGODB_URI`; without it the endpoints degrade
  to empty lists and generation remains fully functional.
- Generic icons (lucide) for MVP; official AWS/Azure/GCP icon packs can be
  mapped in `architectureIconMap.jsx` later without spec changes.

## Manual test steps
1. `npm install && npm run build && npm start` → open http://localhost:3000.
2. Sign in (dev login works with `ALLOW_DEV_LOGIN=1`).
3. Project OS → **Architecture Generator**: enter a title like
   "Online exam platform with proctoring", pick AWS + Production → Generate.
4. Verify: pattern badge, 8–9 diagram tabs, grouped/iconified diagrams
   (Deployment shows Region → VPC → subnets), validation score + checks,
   missing-items panel.
5. Refine: "Add Redis cache, SQS queue, worker service, monitoring, backup
   flow, and CI/CD" → diff message, diagrams update, version bumps.
6. Export: Copy JSON, Copy Mermaid, Download SVG on any tab.
7. Patent Engine → Assess any invention → "Patent figure (FIG. 1 draft)" card.
8. Confirm old features: Sandbox, Project Studio, Project Creator, Patent OS
   dashboards all unchanged; legacy projects still render their diagrams.

---

# v2 — Full Project OS Integration + Industry-Style Rendering

## What changed in v2

### Industry-style diagrams (Netflix/AWS system-design look)
- **Left→right flow layout** for all flow views (Context, Container, Data Flow,
  Security, CI/CD, Observability, Scaling, Patent Figure): top-level groups
  become ordered columns; ungrouped nodes form a leading chain. Landscape,
  scrollable, zoomable. The nested Cloud Deployment view (Region → VPC →
  subnets) keeps the vertical band layout where nesting reads best.
- **Cylinder shapes** for data stores and queues (classic system-design shape).
- **Stacked-card nodes** for concurrent workers / ×N autoscaled instances
  (like the "concurrent async workers" transcoder stack in reference diagrams).
- **Labeled edges** with pill backgrounds (request/response/step numbers),
  dashed async edges, feedback edges loop underneath.
- The server-side SVG exporter uses the **same layout algorithm**, so the
  downloaded SVG matches the on-screen diagram (repo pattern: pure generator
  duplicated server/client and kept in sync).
- No copyrighted logos are used — generic lucide icons with provider-mapped
  service names convey the same information legally.

### Stack-to-capability detection (much smarter)
New `detectStackCapabilities` maps ~28 families of concrete technologies to
capabilities AND attributes the real names onto diagram nodes:
Redis→Cache·Redis, Kafka→Event Bus·Kafka, Snowflake→Warehouse·Snowflake,
Elasticsearch→Search, Airflow/dbt→Scheduler, Terraform→IaC, Auth0/Cognito→
Auth, Stripe/Razorpay→Payments, Pinecone/pgvector→Vector Store, etc.
MVP-level trimming never drops a capability the user explicitly named.

### Project OS — full integration
- **Every generated project now carries `architectureSpec`** (+ validation +
  legacy-compatible Mermaid), attached server-side in
  `POST /api/projects/generate-roadmap` (AI and template paths) and
  `POST /api/inspirations/:id/build`. Failure-safe: if the engine throws, the
  project is returned without a spec and the legacy client Mermaid covers it.
- New reusable `ArchitectureStudioPanel.jsx` — the full Diagram OS embedded in
  Project OS: view tabs, professional canvas, quality score badge,
  open-checks toggle, refine prompt box, JSON/Mermaid/SVG export,
  Regenerate. Patches the spec back onto the project via the existing
  project-store mechanism so it persists.
- **Project Studio** architecture tab now hosts the panel; the old client-side
  Mermaid "Regenerate" is replaced by backend spec generation (legacy
  generator remains the offline/failure fallback). Architecture notes and
  technical-architecture panels untouched.
- **Project Creator** blueprint step hosts the same panel for the selected
  project.
- Old saved projects without a spec show their legacy diagram plus a single
  "Generate professional architecture" upgrade button — nothing breaks.

## v2 test/build status
- `npm test`: **277 passing, 0 failing** (6 new: stack detection + attribution,
  MVP keeps named stack, roadmap/inspiration spec attachment, horizontal
  layout left-to-right ordering, dataFlow chain direction).
- `npm run lint`: **0 errors**. `npm run build`: ✓ (dist/ rebuilt).
- Live HTTP smoke: roadmap project carried 7 views + quality 82 with
  Spark/PostgreSQL/Airflow attributed to nodes; inspiration roadmap carried
  the spec with Redis→cache; SVG export landscape with cylinders.
