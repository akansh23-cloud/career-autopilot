# TEMPLATE OS V1

A template layout operating system underneath Resume OS. Resume OS decides **what** content appears (deterministic compiler, Truth Engine, evidence); Template OS decides **where and how** it is presented. No AI anywhere in the Template OS path.

```
ResumeDocument → Shape Analyzer → Recommendation → TemplateDefinition
  → Layout Compiler → (Budget/Auto-fit from Resume OS V4) → HTML/PDF/DOCX
  → Parse Validation → Certification
```

## Engine versions
`TEMPLATE_OS_VERSIONS` (web/src/lib/templateOs/index.js): `template-dsl-v1`, `template-primitives-v1`, `layout-compiler-v1`, `resume-shape-v1`, `reading-order-v1`, `template-os-cert-v1`, `template-os-pdf-cert-v1`, `template-pdf-writer-v1`, `pdf-validation-v1`, `template-synthesis-v1`, `template-adapter-v1`, `template-thumbnail-v1`, `layout-measure-v1`. Certification results and stored definitions carry these for auditability.

## Template DSL (`templateOs/dsl.js`)
A template is structured data:

```json
{
  "id": "cloud-infrastructure-pro", "name": "Cloud Infrastructure Pro", "version": 1,
  "category": "technical", "supportedRoles": ["devops", "cloud"], "careerStages": ["mid", "senior"],
  "layout": { "type": "sidebar-left", "columns": [{ "id": "sidebar", "width": 0.30 }, { "id": "main", "width": 0.70 }] },
  "sectionPlacement": { "skills": { "region": "sidebar", "fallback": "main" }, "experience": "main" },
  "sectionOrder": ["summary", "experience", "projects", "certifications", "skills", "education"],
  "headerStyle": { "primitive": "technical" }, "skillStyle": { "primitive": "sidebar-stack" },
  "typography": { "preset": "engineering-mix" }, "spacing": { "preset": "balanced" }, "colors": { "preset": "teal" },
  "exports": { "pdf": true, "docx": true, "docxProfile": "simplified-single-column" },
  "license": { "licenseStatus": "INTERNAL_ORIGINAL", "productionEnabled": true },
  "status": "PUBLISHED"
}
```

`validateTemplateDefinition` enforces a closed Template DSL allowlist: kebab ids, approved nested fields, two columns summing to 1, readable column ratios, known regions/primitives, bounded arrays/strings/depth/nodes, safe color/spacing/typography ranges, and readability floors (body ≥ 9.5px, line-height ≥ 1.18, margins ≥ 10mm). Unknown renderer fields fail validation rather than being passed through.

`sanitizeTemplateDefinition` (`template-dsl-v2-strict`) is fail-closed for imported definitions. It rejects prototype-manipulation keys, non-plain objects, control/bidi characters, script/CSS injection constructs, unknown fields and unknown primitive ids. Untrusted packages can carry only the declarative DSL + approved primitives; no freeform CSS/font/renderer hooks or executable code are accepted.

`extendTemplate(base, overrides)` gives inheritance: the technical family (Technical Sidebar → Cloud Infrastructure Pro / Data Platform) shares one geometry with role-specific overrides, `parentTemplateId` recorded.

## Layout primitives (`templateOs/primitives.js`)
Approved building blocks only: pages (single-column, sidebar-left/right, two-column), headers (minimal/centered/editorial/technical/executive/compact), dividers, skills styles (inline/categorized/sidebar-stack/compact-matrix/plain), experience styles (classic/impact-first/compact/technical), project styles (incl. `evidence` with VERIFIED badge), typography/spacing/color presets. Adding a primitive here makes it available to every template and the generator.

## Layout compiler (`templateOs/compiler.js`)
`compileTemplate(def)` → validated layout **tree** + style tokens. `buildLayoutHTML(compiled, structured)` emits the document.

**Reading-order guarantee:** the DOM always follows semantic resume order — columns are emitted in the order of the earliest declared section they contain, and CSS grid areas handle *visual* placement. Text extraction from a sidebar or two-column layout therefore reads narrative before rail data. `scoreReadingOrder` verifies this with a sequential-cursor anchor walk (robust to header echoes); scrambled layouts measurably fail.

`estimateGeometry` gives a deterministic chars-per-line/lines-per-page estimate (page count, overflow lines, utilization). It is an estimate, not a DOM measurement — the browser print path remains the ground truth for page breaks.

`adaptTreeToShape(compiled, shape)`: declared region fallbacks only — a sparse profile (≤8 skills, ≤2 certifications) pulls sections whose `fallback` is the sidebar into the rail so it never renders dead space. Every move is reported (`adaptation.moves`).

## Resume shape (`templateOs/shape.js`)
`analyzeResumeShape(doc)` → deterministic `{ careerStage, years, skill/project/certification/experience densities, educationImportance, summaryLength, targetRole (dictionary-resolved), atsPriority, preferredPageCount }`. Rules only, no AI.

## Real PDF pipeline (`templateOs/pdfWriter.js`, `pdfValidation.js`)

`renderTemplatePdf(compiled, structured, { sizeId })` emits a **real PDF** — selectable text, base-14 fonts, no canvas, no dependencies, deterministic bytes. It matters for two reasons:

1. **Owned pagination.** Sidebar and two-column layouts are paginated by Template OS using real font metrics, not by the browser's print engine. Page breaks in the exported file are the same ones certification measured.
2. **Text-layer truth.** `validateRenderedPdf()` generates the PDF, extracts its text layer with pdfjs, and scores field recovery and reading order on *what an ATS actually receives*.

Content-stream order is semantic (columns emitted by earliest declared section, same rule as the HTML compiler), so a left rail still extracts after the narrative it visually precedes.

Base-14 fonts are WinAnsi-encoded; glyphs outside it (CJK, Devanagari, some Latin extended) are transliterated by `pdfEncodeText`, and certification applies the **identical** transform to its expectations so the comparison can't flatter itself. Non-Latin scripts need embedded fonts — not implemented; use the browser print path for those documents.

Studio's PDF export for Template OS templates goes through this writer (`triggerDownload` of a real `.pdf`), and `POST /api/template-os/export/pdf` does the same server-side.

## Certification (`templateOs/certification.js`)
Seven fixtures (short fresher, senior technical, skills-heavy, certification-heavy, long names, two-page, international characters) × A4 + Letter. Measures: field recovery (name/email/phone/roles/companies/dates/skills/projects/education/certifications), semantic reading order, geometry. ATS level is **measured**: `VERY_HIGH` (single column, ≥90 integrity, ≥92 order), `HIGH` (multi-column at same thresholds), `BALANCED` (≥80/≥80), else `DESIGN_FORWARD`. Certified = criticals + integrity ≥ 90 + order ≥ 85. The honest label is “Career Autopilot parse checks passed”, never “guaranteed ATS”. Validation runs against extracted HTML text; printed-PDF text-layer extraction is not automated in-app (documented gap).

The scorecard reports only measurable dimensions (parse, order, fit reliability, overflow resistance, per-fixture integrity, multi-page stability, typography safety).

### Deep certification — measured on real PDFs

`certifyDefinitionDeep(def)` (`template-os-pdf-cert-v1`) runs the same fixtures through the PDF writer and scores the extracted **text layer**. When PDF evidence exists it overrides the HTML estimate, because the PDF is what a recruiter receives; the HTML result is retained as `htmlOnly` for comparison.

Levels are reported **per page regime**: `atsLevel` (one page) and `atsLevelMultiPage`. A rail that reads perfectly on one page necessarily interleaves once content spills onto a second — page 1's rail precedes page 2's narrative in any document's text layer — so the two are reported separately rather than averaged into a flattering middle. Certification requires the one-page regime to pass **and** the multi-page regime to be at least `BALANCED`.

All six builtins currently measure `HIGH` (single column: `VERY_HIGH`) at one page with 100% field recovery and 100% reading order, and `BALANCED` at two pages. Those numbers are checked into `builtins.js` as `BUILTIN_CERTIFICATION` so gallery cards can show them without parsing PDFs during typing — and `test/templateOsGaps.test.js` re-measures and **fails on any drift**, so a snapshot can never quietly become a marketing claim.

## Geometry: estimate vs measurement

Three levels, each labelled honestly wherever it's shown:

| Source | Where | Nature |
|---|---|---|
| `estimateGeometry` | server render, Node, tests | chars-per-line projection |
| `measureLayoutGeometry` (`layout-measure-v1`) | Studio preview in a browser | **real DOM measurement** — mounts the layout off-screen at page width and reads actual column and section heights, reports straddling sections |
| `renderTemplatePdf().pageCount` | export + certification | real typographic layout with base-14 metrics |

`measureLayoutGeometry` falls back to the estimate under Node and sets `measured: false`; the Studio and comparison UI show "Measured" or "Estimated" accordingly.

## Gallery previews (`templateOs/previewAssets.js`, `templateOs/thumbnail.js`)

Published/static gallery cards now load **cached 360×509 PNGs generated from the real renderers**, not schematic wireframes. Template OS builtins are rasterized from the actual vector-PDF writer; legacy/V3/V4 Resume Studio cards use the actual Resume Renderer block markup + CSS; the older Resume Editor cards use its actual self-contained HTML renderer. The cache is generated offline with `npm run previews:templates` and audited by `web/public/template-previews/manifest.json`. Public URLs carry preview-cache + template-version query values for browser invalidation.

The original deterministic SVG `thumbnail.js` remains intentionally: it is the safe, microsecond fallback for missing assets and the normal preview for draft/generated definitions that have not passed the publish pipeline yet. `POST /api/template-os/thumbnail` continues to expose that schematic representation for internal tooling.

## Deterministic generation (`templateOs/synthesis.js`)
`generateTemplateCandidates(goal)` maps roles → compatible primitive families, enumerates combinations, validates, certifies, and ranks. Same goal → same candidates. Generated definitions are `GENERATED` + `productionEnabled:false` — they never self-publish. CLI:

```
node scripts/generate-template-candidates.mjs --role devops --layout sidebar --stage senior --ats high --limit 6 [--json out.json]
```

## Lifecycle, storage, versioning
Statuses: `DRAFT, GENERATED, VALIDATING, CERTIFIED, APPROVED, DISABLED, LICENSE_PENDING, PUBLISHED`. License states: `INTERNAL_ORIGINAL, OWNED, OPEN_SOURCE, LICENSED, LICENSE_PENDING, DEVELOPMENT_REFERENCE` with `productionEnabled` gating.

Storage layers (server/utils/templateOs/store.js): builtins (code-shipped) → in-memory drafts → Mongo (`TemplateDefinition` model, unique on `templateId+version`). Saves always create a **new version**; published versions are never mutated.

## API (`/api/template-os/*`)
- `GET /versions`, `GET /templates` (non-admins see only PUBLISHED + production-enabled), `GET /templates/:id`
- `POST /shape`, `POST /validate`, `POST /thumbnail`
- `POST /certify` — deep (real-PDF) by default; `deep:false` for the fast HTML estimate
- `POST /export/pdf` — vector PDF with a real text layer and Template OS pagination
- `POST /import` (JSON definition) and `POST /import-package` (.zip) — sanitize → validate → certify → store as `DRAFT` with **forced** `LICENSE_PENDING` + `productionEnabled:false`
- `POST /generate` — deterministic candidates; `persist:true` stores top 3 as `GENERATED`
- `POST /render` — server-side HTML + geometry through a stored definition (trust-boundary sanitized first)
- `POST /status` — admin only; `PUBLISHED` requires passed certification **and** cleared license

## Template package format (.zip)

```
template-package/
  template.json     required — the DSL definition
  styles.css        optional — approved CSS custom properties ONLY
  metadata.json     optional — source / licenseName
  LICENSE           optional — license text, stored as the notice
  preview.webp      optional
  assets/…          optional — png/jpg/webp only
```

`POST /api/template-os/import-package` accepts the archive base64-encoded (also uploadable from the Template Builder). `readTemplatePackage` enforces: 2 MB compressed / 8 MB expanded / 40 entries, no path traversal, no `.js/.ts/.html/.svg/.wasm/...` entries, per-file limits, image magic-byte validation, and an 8 MB expanded-size ceiling. Security-sensitive entries fail the package closed. A single wrapping folder is tolerated.

`styles.css` may **only** contain one `:root` block setting palette variables (`--tpl-accent`, `--tpl-rule`, `--tpl-side`, `--tpl-text`, `--tpl-muted`), each value re-validated as a 3/6-digit hex colour. Selectors, at-rules, `url()`, unknown variables and malformed declarations reject the stylesheet. `metadata.json` is also allowlisted (`source`, `licenseName`, `author`, `notes`) and package/license text rejects markup delimiters plus control/bidi characters. Everything in a package remains data; no executable code path exists.

Every package lands as `DRAFT` + `LICENSE_PENDING` + `productionEnabled:false` with the LICENSE file stored as the notice — a package can never grant itself production rights. JSON-body import (`POST /import`) remains available for definitions without assets.

## Template Builder (admin)

`web/src/views/TemplateBuilder.jsx` is now gated by a server-authoritative `/api/template-os/admin/access` probe in addition to the admin-only navigation. The client never treats `user.role` as sufficient authority for the Builder. Every builder read/mutation path is re-checked by the backend with the existing verified-admin middleware; normal authenticated users retain only the explicit published runtime catalog plus resume render/export operations.

Production lifecycle is exact-version bound: **Save draft → deep real-PDF certification of that stored version → explicit approval → Publish that same version**. The Builder no longer hard-codes `v1`, and editing after save/certification invalidates the publish-ready state until the new draft is saved and certified again. External JSON/ZIP imports always remain `LICENSE_PENDING` + `productionEnabled:false`; only an admin-authored Builder save may preserve a cleared production license state.

It is a composer over the approved primitives — never freeform positioning:

- identity, category, supported roles
- geometry: layout type, rail ratio slider bounded by the readability floors, header and divider primitives
- style: typography / spacing / palette / skills / experience / project primitives
- sections: reorder (order *is* reading order) and assign each to rail or main
- content budget overrides
- license status + production flag
- live preview across all seven fixtures and both page sizes, with estimate badges
- **Run parse checks** → deep certification bound to the exact stored template version, with the full scorecard persisted back onto that version
- Save draft, Approve, Publish (release controls stay disabled until the exact saved version has deep real-PDF certification, explicit approval and a cleared production license), import `.zip` package, load/paste definition JSON, start from a shipped builtin, edit/fork stored revisions

## Template comparison (student-facing)

The Studio design tab lets 2–3 templates be selected and compared side by side on the **same ResumeDocument**: scaled live previews plus page count, fit/overflow, parse level (with the two-page level when it differs), layout type, body font, whether the page count was measured or estimated, and any region adaptations. Content is identical in every column by construction — switching a template never edits the document — and the comparison says so rather than inventing a quality score.

## Adding a new template
1. Write a TemplateDefinition (or `extendTemplate` a base, or run the generator).
2. `POST /api/template-os/validate`, then `/certify` — fix anything below thresholds.
3. Store via `/import` (or add to `builtins.js` for code-shipped templates with cleared license).
4. Admin `POST /status` → `PUBLISHED` once certified and license-cleared (or do all of this in the Template Builder).
5. Builtins surface in the Studio gallery automatically via `toRegistryCard` (engine `template-os`).

## Studio integration
Registry now contains 42 static cards: 28 legacy/V3/V4 cards plus 14 Template OS builtins. The premium families are Technical Sidebar, Cloud Infrastructure Pro, Data Platform, Balanced Two Column, Editorial Professional, Executive Technology, Campus Portfolio, Signature Engineering, Modern Corporate, Security Engineering, Analytics Insight, Product Strategy, Research & Innovation, and Minimal ATS Premium. For `engine:'template-os'` templates the Studio preview runs through the layout compiler with **real DOM measurement**, and PDF export runs through the vector writer (real text layer, Template OS pagination); DOCX uses the declared `docxProfile` (`simplified-single-column` keeps identical content in semantic order — declared, not silent).

## Density modes

Template OS supports three presentation modes without creating duplicate templates:

- `compact` — tighter margins and vertical rhythm for content-heavy one-page resumes.
- `balanced` — default professional spacing for most applications.
- `spacious` — more whitespace for lighter or editorial profiles.

Density modes preserve the selected template's typography preset and readability floors. They scale the template's own tuned spacing ratios rather than replacing them with generic spacing. ResumeDocument's legacy `comfortable / compact / tight` values are mapped at the renderer boundary to `spacious / balanced / compact` for backward compatibility.

## Runtime published-template catalog (Phase 17)

Code-shipped templates are no longer the only templates Resume Studio can use. On Studio boot the client requests:

`GET /api/template-os/templates?catalog=1&publishedOnly=1`

The response includes only `PUBLISHED` definitions whose license metadata allows production use, together with the stored version and certification. `runtimeTemplateCatalog.js` converts those definitions through the same `toRegistryCard()` projection used by builtins and merges them non-destructively with the static library. A stored template with the same id replaces that id at runtime; a new id is appended to the Premium Layout Engine group. The static `RESUME_TEMPLATES` array is never mutated, so offline fallback remains deterministic.

Runtime cards are resolved by the normal `getResumeTemplate()` path, so Design preview, template comparison and vector-PDF export do not need a separate renderer. Phase 16 cached previews are attempted first; a newly published template without a generated cache asset falls back to the deterministic Template OS SVG until the offline preview pipeline generates its PNG.

The server has an equivalent production-only runtime catalog (`server/utils/templateOs/runtimeCatalog.js`). Template recommendation, Tailor for Job, auto-fit and DOCX metadata therefore see the same published stored templates as Resume Studio instead of ranking only build-time definitions.

ResumeDocument version pinning is now implemented as described below.

## Resume template version pinning

ResumeDocument now stores both `templateId` and `templateVersion`. A saved resume or job-specific variant resolves that exact revision for preview/export. Published runtime catalog upgrades do not silently alter older resumes. Legacy documents without `templateVersion` remain readable; the next authoritative create/save path resolves the current production revision once and persists that pin. Historical runtime definitions are loaded on demand and kept separate from the latest gallery card.

## Premium completion state — Phase 30

Template OS now includes 14 published first-party families plus the runtime catalog for stored published definitions. The remaining premium renderer roadmap through Phase 30 is implemented: structural generator diversity and Builder UI, multi-parser owned-PDF audit, semantic owned pagination, a flagship engineering family, and expanded corporate/security/analytics/product/research/ATS families.

The design system remains deterministic and allowlisted. Generated templates still travel through the same immutable lifecycle and deep certification gates as hand-authored templates. Resume content rules are unchanged: empty optional sections stay absent, project depth is source-bound, and vocabulary variation cannot fabricate facts.
