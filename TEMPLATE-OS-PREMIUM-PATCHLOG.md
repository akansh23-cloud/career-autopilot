# Template OS Premium Renderer Patch Log

## Phase 1 — Typography System

Implemented as a narrow renderer patch. No Resume OS business logic, tailoring logic, evidence logic, authentication, billing, or unrelated product code was changed.

### Changes
- Raised built-in typography presets to real resume-readable scales. PDF body text now resolves to approximately 9.5–10.1pt instead of the previous ~7.5–8pt range for the premium presets.
- Added semantic typography roles for name, target title, section heading, role, company/meta text, contact text, and skill-group labels.
- HTML layout compiler now uses the semantic typography roles instead of deriving most elements from one body size.
- Vector PDF writer uses the same semantic scale for title, role, metadata, skills, and contact hierarchy.
- Technical headers use controlled PDF Base-14 Courier for the mono contact accent; no font files or external runtime dependencies were added.
- Bumped Template primitives, layout compiler, and PDF writer versions to reflect the visual-output change.

### Validation
- Added `test/templateTypography.test.js`.
- 3/3 focused typography tests pass.
- Syntax checks pass for the changed Template OS modules.
- Baseline and post-patch PDFs were rendered for Technical Sidebar, Cloud Infrastructure Pro, Balanced Two Column, and Editorial Professional.
- All four Senior DevOps fixture outputs remain one A4 page after the typography increase.
- Actual PDF text remains selectable/extractable.

### Deferred intentionally
Visual primitives, sidebar balancing, experience redesign, project styling, skills styling, and broader HTML/PDF parity are separate later patches. They were not mixed into Phase 1.

## Phase 2 — Premium Visual Primitives

Implemented as a renderer-only primitive patch on top of Phase 1. No Resume OS business logic, tailoring, evidence, authentication, billing, or unrelated product code was changed.

### Changes
- Added a reusable visual primitive registry for header rules, sidebar panel treatments, certification accent blocks, project metadata accents, and verified badges.
- Existing TemplateDefinitions automatically resolve those visual primitives from their current layout/header/project choices; no bespoke per-template React renderer was introduced.
- HTML compiler now renders premium header rules, accent-edged sidebar panels, certification markers, project metadata accents, and softer verified badges from shared tokens.
- Vector PDF writer now supports reusable line primitives and applies the same design intent to actual exported PDFs: header rules, section dividers (hairline/accent/short), sidebar accent edges, certification markers, and project metadata markers.
- Kept the large sidebar-height/content-balancing problem intentionally out of this phase; Phase 4 remains responsible for true Technical Sidebar premiumization and content-aware rail height.
- Bumped primitive/compiler/PDF writer versions for the output change.

### Validation
- Added `test/templateVisualPrimitives.test.js`.
- Phase 1 typography + Phase 2 visual primitive focused tests: 7/7 pass.
- Syntax checks pass for all three changed Template OS modules.
- Actual PDFs rendered for Technical Sidebar, Cloud Infrastructure Pro, Balanced Two Column, and Editorial Professional.
- All four flagship fixture outputs remain one-page A4 PDFs with selectable/extractable text.
- Full Vite build could not run in this sandbox because the extracted dependency tree does not contain the `vite` binary; this is an environment/dependency limitation, not reported as a passing build.

### Deferred intentionally
HTML/PDF parity architecture, content-height sidebar balancing, experience/project/skills redesign, runtime catalog, security hardening, generator changes, and pagination refinement remain separate later phases.

## Phase 03 — HTML/PDF Visual Parity

- Added `renderDesign.js` as a single resolved geometry/typography contract for both renderers.
- HTML CSS and vector PDF now share page size, margins, column gap, sidebar padding, typography scale, header spacing, contact layout, and visual token decisions.
- Vector PDF now honors `inline`, `stacked`, and `grid` header contact layouts instead of flattening every header.
- Executive/header-band definitions now render a corresponding PDF band.
- Sidebar PDF geometry consumes the same resolved panel padding/edge metrics as HTML.
- Engine versions bumped to `layout-compiler-v4` and `template-pdf-writer-v4`.

## Phase 4 — Technical Sidebar flagship premiumization

Small renderer/template patch only; Resume OS content/business logic remains untouched.

- Technical Sidebar geometry tuned to a 31/69 rail/main split.
- Added `premium-content` sidebar panel primitive with content-aware PDF height, tighter accent edge, safe inset, and short rail heading rules.
- PDF pagination now records per-column used height so content-height rails stop after the actual sidebar content instead of filling the page foot.
- Sidebar vertical padding is now honored by the vector PDF renderer.
- Technical Sidebar contact grid is balanced to two columns through a declarative header override.
- Rail section headings use short accent rules and skill rows drop repetitive separators.
- Wrapped certification accent markers render only on the first line of each certification instead of repeating for every wrapped line.
- Existing shared render contract retained; no bespoke React template was introduced.
- Engine versions: `template-primitives-v4`, `layout-compiler-v5`, `template-render-design-v2`, `template-pdf-writer-v5`.

## Phase 5 — Experience Design

Small renderer-only patch on top of Phase 4. No Resume OS truth, tailoring, evidence, AI, auth, billing, or unrelated product logic changed.

### Changes
- Replaced the cramped `Role — Company` experience header with a reusable premium hierarchy: role + right-aligned date lead, company/location follow on a quieter second line.
- Technical experience primitives use an accented company line and optional mono stack/context line; classic/editorial layouts retain a restrained text treatment; compact student layouts keep an explicit inline mode.
- Added shared experience geometry to `renderDesign.js` so HTML and vector PDF use the same item gaps, date spacing, metadata gaps, stack spacing, and bullet indentation.
- HTML experience markup now has semantic `t-jobtop`, `t-jobmeta`, `t-company`, `t-location`, `t-exp-stack`, and `t-exp-bullets` primitives.
- Vector PDF block model now supports paired left/right text on one baseline, allowing dates to sit at the true right edge without flattening job metadata.
- PDF metadata rows support deterministic multi-color text segments so technical company accents do not force the location to use the same color.
- Bullet rhythm now has a controlled top gap, inter-bullet gap, and stronger hanging-indent behavior without changing any bullet content.
- Added location support to the actual Template OS experience renderer; existing ResumeDocument facts are only displayed, never inferred.
- Engine versions: `template-primitives-v5`, `layout-compiler-v6`, `template-render-design-v3`, `template-pdf-writer-v6`.

### Validation
- Added `test/templateExperienceDesign.test.js`.
- Phase 1–5 focused renderer suite: 18/18 tests pass.
- Syntax checks pass for all changed Template OS modules.
- Actual one-page A4 PDFs rendered for Technical Sidebar, Cloud Infrastructure Pro, Balanced Two Column, and Editorial Professional using the realistic DevOps fixture.
- `pdfinfo` recognizes the generated files as A4 PDFs and `pdftotext` confirms selectable/searchable resume text remains present.

### Deferred intentionally
Project-specific presentation, dedicated skills redesign, broader header families, Cloud/DevOps structural differentiation, runtime catalog, security hardening, generator work, and multi-parser ATS validation remain later phases.

## Phase 6 — Project Presentation

Small renderer-only patch on top of Phase 5. Resume OS truth, tailoring, evidence creation, AI, auth, billing, and unrelated product logic remain unchanged.

### Changes
- Reworked project primitives into explicit presentation contracts for `classic`, `compact`, and `evidence` modes instead of treating projects like simplified experience rows.
- Added shared project geometry to `renderDesign.js`: header mode, metadata mode, technology font, verified-state behavior, item rhythm, metadata spacing, bullet indentation, and deterministic bullet limits.
- HTML project rendering now separates project name, subtle verified state, technology stack, link, and impact bullets into semantic `t-project-*` primitives.
- Evidence projects use a restrained right-aligned VERIFIED state instead of embedding `[VERIFIED]` into the project name.
- Technical project metadata can use the existing controlled mono accent while links use the template accent color and align away from the technology stack when space allows.
- Vector PDF renderer now mirrors the same project hierarchy, including right-side verified state, technology/link metadata treatment, long-link fallback, and project-specific bullet rhythm.
- Compact project mode keeps a deterministic two-bullet budget for dense/student layouts.
- Existing project content is rendered only; no facts, metrics, technologies, links, or verification states are inferred.
- Engine versions: `template-primitives-v6`, `layout-compiler-v7`, `template-render-design-v4`, `template-pdf-writer-v7`.

### Validation
- Added `test/templateProjectPresentation.test.js`.
- Phase 1–6 focused renderer suite: 22/22 tests pass.
- Syntax checks pass for all modified Template OS modules.
- Actual one-page A4 PDFs rendered for Technical Sidebar, Cloud Infrastructure Pro, Balanced Two Column, and Editorial Professional using the same project-rich Senior DevOps fixture before/after the patch.
- Rendered PDFs remain selectable/searchable and visually inspected after rasterization.

### Deferred intentionally
Dedicated skills redesign, broader header families, Cloud/DevOps structural differentiation, runtime catalog, security hardening, generator work, and multi-parser ATS validation remain later phases.

## Phase 7 — Skills System

Small renderer/primitive patch on top of Phase 6. Resume OS truth, tailoring, evidence, AI, auth, billing, and unrelated product logic remain unchanged.

### Changes
- Added an explicit premium skills presentation contract covering inline category rows, categorized lists, compact technical matrices, legacy stacks, and a new `sidebar-groups` primitive.
- Migrated the Technical Sidebar family from one-skill-per-line `sidebar-stack` rendering to compact `sidebar-groups`: category label + wrapping middot-delimited skill runs, with no pills, ratings, or progress bars.
- Preserved `sidebar-stack` for backward compatibility with existing stored TemplateDefinitions.
- Added shared skills geometry to `renderDesign.js` so HTML and vector PDF use the same item sizing, category sizing, category tone, group gap, label gap, separator rhythm, and sidebar-specific typography.
- HTML renderer now emits semantic `t-skill-label`, `t-skilltoken`, `t-skillsep`, `t-skilltokens`, `t-skill-inline-row`, `t-skillgroup-sidebar`, and `t-skill-matrix-row` primitives instead of flattening every skill mode to generic paragraphs/rows.
- Vector PDF renderer now preserves category meaning for sidebar, categorized, inline, and matrix modes while wrapping dense technical skill runs safely within the real column width.
- `compileTemplate()` now allows declarative skill-style overrides on top of an approved skill primitive, matching the existing safe header override pattern.
- Engine versions: `template-primitives-v7`, `layout-compiler-v8`, `template-render-design-v5`, `template-pdf-writer-v8`.

### Validation
- Added `test/templateSkillsSystem.test.js`.
- Phase 1–7 focused renderer suite: 26/26 tests pass.
- Syntax checks pass for all modified Template OS modules.
- Actual one-page A4 PDFs rendered before/after for Technical Sidebar, Cloud Infrastructure Pro, Balanced Two Column, and Editorial Professional using the project-rich Senior DevOps fixture.
- Technical Sidebar rail is materially shorter and clearer because 29 technical skills are grouped into five compact categories instead of 29 independent database-like rows.
- PDFs remain selectable/searchable after the skills compaction; skill category and individual skill text are recoverable from the actual PDF text layer.

### Deferred intentionally
Broader header families, Cloud/DevOps structural differentiation, runtime catalog, template version pinning, content-budget propagation, ResumeDocument section completion, security hardening, generator work, and multi-parser ATS validation remain later phases.

## Phase 8 — Premium Header System

Small header-only renderer/primitive patch on top of Phase 7. Resume content, truth, tailoring, evidence, AI, auth, billing, and unrelated product logic remain unchanged.

### Changes
- Reworked the approved header registry into explicit geometry/tone contracts rather than alignment-only presets.
- Added five premium reusable header systems: `technical`, `editorial`, `corporate`, `executive`, and `student`; legacy `minimal`, `centered`, and `compact` remain compatible.
- Technical header now uses a controlled vertical accent signature, inset identity block, mono two-column contact grid, and a restrained neutral rule instead of relying only on an accent-colored divider.
- Editorial header now uses an uppercase display identity, quieter uppercase role line, and compact inline contact baseline instead of a tall stack of contact rows.
- Added a Corporate split header primitive: identity left, right-aligned contact block right, shared hairline rule. Balanced Two Column now uses this header so it is structurally different from Editorial Professional.
- Added an Executive band primitive with reversed white typography on the template accent background; this is available to current/future executive definitions without a bespoke renderer.
- Campus Portfolio now uses a dedicated Student header with centered identity, compact contact line, and short accent signature instead of the generic centered primitive.
- `renderDesign.js` now resolves header layout, text tones, band color, split geometry, contact alignment, accent marks, contact separator, and title tracking once for both HTML and vector PDF.
- HTML compiler now emits semantic split/primary/contact header primitives and shared premium header CSS.
- Vector PDF writer now supports split identity/contact headers, vertical/short accent marks, custom header tones, title case, contact separators, and accent-colored inverse executive bands.
- Existing facts are rendered only; no contact details, titles, roles, or resume claims are inferred.
- Engine versions: `template-primitives-v8`, `layout-compiler-v9`, `template-render-design-v6`, `template-pdf-writer-v9`.

### Validation
- Added `test/templateHeaderSystem.test.js` covering all five premium headers plus a reusable executive header fixture.
- Phase 1–8 focused renderer suite: 33/33 tests pass.
- Syntax checks pass for all modified Template OS modules.
- Actual vector PDFs rendered and visually inspected for Technical Sidebar, Cloud Infrastructure Pro, Balanced Two Column, Editorial Professional, Campus Portfolio, plus a synthetic Executive header sample.
- Technical, Cloud, Balanced, Editorial, and Campus fixtures remain one-page A4 PDFs. The deliberately long executive fixture remains two pages.
- PDF text remains selectable/searchable and contact/name/title text is recoverable with `pdftotext`.

### Deferred intentionally
Cloud/DevOps structural differentiation, runtime template catalog, template version pinning, content-budget propagation, career-stage normalization, full ResumeDocument section support, security hardening, admin lifecycle, generator diversity/UI, multi-parser ATS validation, and further pagination work remain later phases.

## Phase 9 — Balanced Two-Column Premiumization

Small composition-only patch on top of Phase 8. Resume content, truth, tailoring, evidence, AI, auth, billing, and unrelated product logic remain unchanged.

### Changes
- Rebalanced `Balanced Two Column` from 42/58 to a 38/62 reference/narrative split so experience and project bullets gain useful line length while supporting material stays compact.
- Kept Summary, Experience, and Projects in the narrative/right column and Skills, Education, Certifications, and Achievements in the reference/left column; no resume facts or section content were moved between semantic domains.
- Added reusable `editorial-split` column-treatment primitive instead of hard-coding styling into the template.
- Added a restrained gutter divider that is drawn in the gap between columns, so it does not steal usable width from either column.
- The divider is content-height aware in the vector PDF and ends with the actual two-column content instead of running through an empty page foot; HTML naturally follows the grid content height.
- Added compact reference-column metrics: slightly smaller reference headings and tighter section rhythm, while the narrative column keeps the normal professional typography.
- Migrated Balanced Two Column skills from block-style categorized groups to the existing compact-matrix primitive for denser, cleaner reference scanning without pills or progress UI.
- Tuned the corporate split header to a 62/38 identity/contact ratio to align visually with the stronger narrative-side composition.
- Tuned spacing to a controlled 17 mm margin and balanced editorial rhythm; retained the existing burgundy/classic-serif identity.
- Added column-divider geometry to vector-PDF output metadata so parity and layout tests can verify the real rendered split.
- Engine versions: `template-primitives-v9`, `layout-compiler-v10`, `template-render-design-v7`, `template-pdf-writer-v10`.

### Validation
- Added `test/templateBalancedTwoColumnPremium.test.js`.
- Updated earlier header/skills expectations only where the Phase 9 Balanced Two Column definition intentionally changed.
- Phase 1–9 focused renderer suite: 37/37 tests pass.
- Syntax checks pass for all modified Template OS modules/tests.
- Actual one-page A4 vector PDFs rendered for Balanced Two Column plus Technical Sidebar, Cloud Infrastructure Pro, and Editorial Professional regressions.
- Balanced Two Column vector output records a 38/62 geometry and a content-height gutter divider; PDF text remains selectable/searchable.

### Deferred intentionally
Modern Corporate/Editorial refinement, Cloud/DevOps structural differentiation, runtime template catalog, template-version pinning, content-budget propagation, career-stage normalization, full ResumeDocument section support, security hardening, admin lifecycle, generator diversity/UI, multi-parser ATS validation, and additional pagination work remain later phases.

## Phase 10 — Modern Corporate / Editorial Refinement

Small single-column professional renderer patch on top of Phase 9. Resume content, truth, tailoring, evidence, AI, auth, billing, and unrelated product logic remain unchanged.

### Changes
- Refined `Editorial Professional` into a genuinely premium single-column professional family rather than a plain serif ATS document.
- Added reusable `editorial-line` section divider: compact section label with a quiet hairline extending through the remaining measure; HTML and vector PDF share the same behavior.
- Added reusable `editorial-flow` single-column treatment so the narrative body uses a slightly narrower centered reading measure while the identity header remains full-width.
- Added reusable `editorial-lead` summary treatment: slightly larger, softer profile copy with controlled line-height, without changing any resume facts.
- Added `editorial` experience primitive with stronger inter-role rhythm and quiet employer/location metadata.
- Added `editorial-premium` typography preset using the existing safe serif stack and PDF base-14 serif mapping; no new font files or external font dependencies were introduced.
- Added restrained `ink` color preset for warm charcoal text/rules instead of a flat black monochrome treatment.
- Editorial skills now use uppercase muted category labels with inline skill runs, keeping technical data compact without pills or progress UI.
- `compileTemplate()` now safely applies declarative experience/project overrides on top of approved primitives, matching the existing header/skill override pattern.
- Vector PDF single-column geometry now honors the same resolved content-width scale as HTML.
- Engine versions: `template-primitives-v10`, `layout-compiler-v11`, `template-render-design-v8`, `template-pdf-writer-v11`.

### Validation
- Added `test/templateEditorialProfessionalPremium.test.js`.
- Phase 1–10 focused renderer suite: 40/40 tests pass.
- Syntax checks pass for all modified Template OS modules.
- Actual one-page A4 vector PDF rendered and visually inspected for Editorial Professional using the same mid-career fixture before/after the patch.
- Regression PDFs rendered for Balanced Two Column, Technical Sidebar, and Cloud Infrastructure Pro; all remain one-page A4 on their current fixtures.
- Senior Editorial fixture remains within the declared two-page capability and renders as two pages.
- PDF text remains selectable/searchable; `pdfinfo` recognizes the output as A4 PDF 1.4 and `pdftotext` recovers the resume content.

### Deferred intentionally
Cloud/DevOps structural differentiation, runtime template catalog, template-version pinning, content-budget propagation, career-stage normalization, full ResumeDocument section support, security hardening, admin lifecycle, generator diversity/UI, multi-parser ATS validation, and pagination refinement remain later phases.

## Phase 11 — Cloud / DevOps Pro Flagship Differentiation

Small Cloud/DevOps flagship patch on top of Phase 10. Resume content, truth, tailoring, evidence, AI, auth, billing, and unrelated product logic remain unchanged.

### Changes
- Rebuilt `Cloud Infrastructure Pro` as a genuinely distinct `sidebar-right` composition instead of a teal variant of the left-rail Technical Sidebar.
- Uses a 72/28 main/right-rail geometry so Summary, Experience, and Projects retain dominant line length while Certifications, Skills, and Education sit in a narrow technical reference rail.
- Added reusable `cloud-rail` visual primitive: content-height pale rail, stronger inside accent edge, compact padding, and short rail heading rules. The rail no longer paints an empty full-height block.
- Made Certifications intentionally first in the right rail and added reusable `featured` certification treatment with stronger type weight, spacing, and accent marker hierarchy.
- Added reusable `cloud-platform` experience primitive with an explicit `STACK` label followed by deterministic mono infrastructure context when the ResumeDocument supplies stack data.
- Added reusable `evidence-compact` project primitive so infrastructure projects keep verified state + tech/link metadata while limiting density to two impact bullets.
- Added `cloud-engineering` typography preset and switched the main section divider to restrained hairlines, while the header uses a stronger accent rule and removes the Technical Sidebar's vertical identity marker.
- Kept all new behavior declarative through TemplateDefinition + shared primitives; no bespoke React template component was introduced.
- Engine versions: `template-primitives-v11`, `layout-compiler-v12`, `template-render-design-v9`, `template-pdf-writer-v12`.

### Validation
- Added `test/templateCloudInfrastructureProPremium.test.js` covering right-rail geometry, Cloud-specific primitive resolution, labelled stack context, featured certifications, content-height rail behavior, and real vector-PDF output.
- Updated older renderer tests only for the global engine-version bump and the intentional labelled stack markup.
- Phase 1–11 focused renderer suite: 43/43 tests pass.
- Syntax checks pass for all modified Template OS modules/tests.
- Actual one-page A4 vector PDFs rendered and visually inspected for Cloud Infrastructure Pro plus Technical Sidebar, Balanced Two Column, and Editorial Professional regressions.
- Cloud Infrastructure Pro PDF remains searchable/selectable; `pdftotext -raw` recovers semantic order as Header → Summary → Experience → Projects → Certifications → Skills → Education.
- Deep PDF.js certification could not be rerun in this extracted archive because `pdfjs-dist` is not installed; the production certification snapshot was therefore not rewritten during this visual patch.
- Full Vite build/lint could not run because the supplied archive does not include installed `vite` or `eslint` binaries.

### Deferred intentionally
Executive Technology, Student Portfolio, content-aware adaptation/density modes, runtime template catalog, template-version pinning, content-budget propagation, career-stage normalization, full ResumeDocument section support, security hardening, admin lifecycle, generator diversity/UI, multi-parser ATS validation, and pagination refinement remain later phases.

## Phase 12 — Executive Technology
- Added `executive-technology`, a leadership-first Template OS builtin rather than a larger technical resume.
- Added `executive-impact` experience hierarchy, `executive-premium` typography, `executive-navy` palette, `executive-flow` narrative measure and `executive-lead` profile treatment.
- Executive content order promotes Summary → Achievements → Experience before Skills/Projects.
- Uses the existing shared inverse executive header band and the same HTML/vector-PDF pipeline; no bespoke component.
- Skills remain compact inline category rows and projects use the compact primitive to keep leadership impact dominant.

## Phase 13 — Student Portfolio Premiumization

Small student/fresher composition patch on top of Phase 12. Resume truth, tailoring, evidence, AI, auth, billing, job logic and unrelated product flows remain unchanged.

### Changes
- Refined `Campus Portfolio` into a premium 70/30 main/right-rail student layout with Summary → Education → Projects → Experience leading the narrative and Skills/Certifications/Achievements living in a compact reference rail.
- Replaced the legacy one-skill-per-line student rail with the shared `sidebar-groups` primitive so technical categories remain readable without wasting vertical space.
- Added reusable `student-portfolio` project primitive: strong project name, compact stack/link metadata, optional verified state and a controlled two-bullet evidence budget.
- Added reusable Education rendering contract with `campus-featured` primitive. School + dates now lead on one line, while degree/CGPA receives a separate accent hierarchy; HTML and vector PDF share the same education geometry.
- Added `student-premium` typography preset, `campus-blue` restrained color system, `student-rail` content-height sidebar panel and `student-intro` summary treatment.
- The student rail now ends with its actual content rather than painting a mostly-empty column to the page foot.
- Added explicit student content budgets for projects, skills, certifications and achievements; no resume facts are invented or rewritten.
- Extended Template DSL primitive validation to include project and education primitives.
- Engine versions: `template-primitives-v13`, `layout-compiler-v13`, `template-render-design-v10`, `template-pdf-writer-v13`.

### Validation
- Added `test/templateCampusPortfolioPremium.test.js` covering 70/30 composition, grouped skills, featured education, student project hierarchy, content-height rail behavior and actual vector-PDF output.
- Phase 1–13 focused renderer suite: 50/50 tests pass.
- Syntax checks pass for all modified Template OS modules/tests.
- Actual A4 vector PDFs rendered and visually inspected for a targeted project-heavy student, the full five-project fixture and a short fresher fixture; all remain one page in the current fixtures.
- Regression PDFs rendered for Technical Sidebar, Cloud Infrastructure Pro, Balanced Two Column, Editorial Professional and Executive Technology; prior expected page counts remain stable.
- `pdftotext -raw` preserves student semantic sequence as Header → Summary → Education → Projects → Experience → Skills → Certifications → Achievements.

### Deferred intentionally
Content-aware adaptation/density modes, actual cached gallery previews, runtime template catalog, template-version pinning, content-budget propagation into Tailor for Job, career-stage normalization, full ResumeDocument section support, security hardening, admin lifecycle, generator diversity/UI, multi-parser ATS validation and pagination refinement remain later phases.

## Phase 14 — Content-Aware Visual Adaptation

Small ResumeShape-driven adaptation patch on top of Phase 13. Resume facts, truth, tailoring, evidence, AI, auth, billing, and unrelated product logic remain unchanged.

### Changes
- Upgraded Resume Shape to `resume-shape-v2` and made it robust to both canonical ResumeDocument input and renderer-structured resumes used by Template Lab/fixtures.
- Added deterministic shape signals for rail load/density, education/achievement/link counts, experience priority, and overall layout pressure.
- Upgraded `adaptTreeToShape()` to `shape-adaptation-v2`; adaptation now clones the compiled layout/tokens per resume and never mutates the underlying TemplateDefinition.
- Sparse sidebar profiles return unused width to the narrative column and only move sections whose TemplateDefinition explicitly declares the sidebar as a fallback.
- Dense skill profiles compact only skill-group rhythm/skill sizing within existing readability floors; body typography and page margins are not reduced.
- Project-heavy profiles use the existing approved compact project geometry while preserving verification/badge semantics and limiting project bullet density.
- Experience-heavy sidebar/two-column profiles prioritize the narrative region and slightly tighten inter-role rhythm without removing content.
- Balanced Two Column can widen its experience-led narrative region for senior/multi-role resumes while retaining a usable reference column.
- Added structured `adaptation.moves` and `adaptation.adjustments` metadata so every dynamic layout decision is explainable and testable.
- Engine versions: `resume-shape-v2`, `layout-compiler-v14`; renderer/PDF primitive versions remain unchanged because both already consume the adapted compiled contract.

### Validation
- Added `test/templateContentAwareAdaptation.test.js` covering renderer-structured shape analysis, sparse rail fallback/width behavior, dense skill compaction, project-heavy compact mode, senior narrative priority, and actual vector-PDF adapted column geometry.
- Phase 1–14 focused premium renderer suite: 56/56 tests pass.
- Syntax checks pass for all modified modules/tests.
- Actual A4 vector PDFs rendered and visually inspected for sparse Technical Sidebar, dense Technical Sidebar, project-heavy Campus Portfolio, senior Balanced Two Column, and Cloud Infrastructure Pro.
- All five adaptation fixtures remain one-page on the current test data; PDF text remains searchable/selectable.

### Deferred intentionally
Density modes as explicit user-selectable modes, cached gallery previews, runtime template catalog, template-version pinning, content-budget propagation, career-stage normalization across all systems, full ResumeDocument section support, security hardening, admin lifecycle, generator diversity/UI, multi-parser ATS validation, and pagination refinement remain later phases.

## Phase 15 — Density Modes (Compact / Balanced / Spacious)

Small deterministic density-control patch on top of Phase 14. Resume facts, truth, tailoring, evidence, AI, auth, billing, and unrelated product logic remain unchanged.

### Changes
- Added `template-density-v1` to Template OS. Density is now a real renderer mode rather than a template-count multiplier.
- `compileTemplate(def, { density })` supports `compact`, `balanced`, and `spacious` while preserving each template's hand-tuned base spacing proportions.
- Density scaling adjusts page margins, section gaps, item gaps, bullet rhythm, header micro-spacing, and metadata rhythm; it does not reduce body typography or bypass readability floors.
- Explicit mode changes are ratio-based against the template's declared spacing preset, so `Editorial Professional` can remain natively spacious while still producing balanced/compact variants without losing its design identity.
- Added a legacy ResumeDocument bridge: persisted `comfortable / compact / tight` values map to Template OS `spacious / balanced / compact` without changing the existing document storage contract.
- Resume Studio now shows the user-facing labels `Compact / Balanced / Spacious` while keeping legacy saved values compatible with the older renderer.
- Template OS live preview, compare, and vector-PDF export now compile using the selected density mode.
- Stored-template server HTML/PDF rendering also honors the document density selection.
- `resolveRenderDesign()` exposes shared density metadata (`condensed / standard / open`) and applies the same header/meta spacing contract to HTML and PDF.
- Engine versions: `template-density-v1`, `layout-compiler-v15`, `template-render-design-v11`.

### Validation
- Added `test/templateDensityModes.test.js` covering legacy mapping, monotonic spacing/margins, unchanged body typography, preservation of template-specific base tuning, shared HTML/PDF density geometry, and metadata rhythm.
- Phase 1–15 focused premium renderer suite: 61/61 tests pass.
- Actual A4 vector PDFs rendered and visually inspected for Technical Sidebar and Editorial Professional in all three modes.
- All six density samples remain one page on the current DevOps fixture; PDF text remains selectable/searchable and `pdftotext` recovers the resume content.
- Compact/Balanced/Spacious preserve the same typography preset; changes are layout rhythm and margins rather than font shrinking.

### Deferred intentionally
Actual cached gallery previews, runtime template catalog, template-version pinning, content-budget propagation into Tailor for Job, career-stage normalization, full ResumeDocument section support, security hardening, admin lifecycle, generator diversity/UI, multi-parser ATS validation, and pagination refinement remain later phases.

## Phase 16 — Actual Cached Template Thumbnails

Small gallery-performance/preview-quality patch on top of Phase 15. Resume facts, truth, tailoring, evidence, AI, auth, billing, and template rendering behavior remain unchanged.

### Changes
- Added `template-preview-cache-v1` and deterministic role-aware preview fixtures (`template-preview-fixtures-v1`).
- Generated and committed 35 Resume Studio preview PNGs and 8 legacy Resume Editor preview PNGs at 360×509 px.
- Template OS premium previews are rasterized from the actual vector-PDF renderer, so the gallery reflects real exported geometry rather than a schematic wireframe.
- Legacy/V3/V4 Resume Studio previews are generated from the actual Resume Renderer block markup + production CSS and rasterized offline.
- Legacy Resume Editor previews are generated from its actual self-contained HTML renderer.
- Resume Studio now loads cached preview images first, with the deterministic SVG wireframe retained only as a one-shot missing-asset fallback.
- Template Builder's shipped builtins use the same real cached previews; draft/generated definitions intentionally keep the lightweight schematic preview.
- Legacy Resume Editor template cards no longer create eight live iframe renders during normal gallery browsing; the live `ResumePaper` render is now only a safety fallback if the cached image is unavailable.
- Added `npm run previews:templates` and a reproducible generation script plus an auditable `manifest.json` containing renderer, fixture, dimensions, template version, and asset byte size.
- Cached public URLs include preview-cache and template-version query parameters for browser invalidation without adding dozens of image imports to the JS bundle.

### Validation
- Added `test/templateCachedPreviews.test.js` covering cache versioning, all static assets, PNG dimensions/magic, renderer provenance, fixture determinism, Resume Studio cache-first wiring, and legacy Editor iframe fallback behavior.
- 43 preview assets generated: 35 Resume Studio + 8 legacy Editor; total preview cache is about 2 MB.
- All seven Template OS builtins use `template-os-vector-pdf` provenance in the generated manifest.
- Actual preview contact sheets were visually inspected for the premium Template OS family and the legacy Resume Editor family.
- Runtime application has no WeasyPrint/Poppler dependency; those tools are used only by the offline preview-generation script. Shipped assets are ordinary static PNG files.

### Deferred intentionally
Runtime stored-template catalog, template-version pinning, content-budget propagation into Tailor for Job, career-stage normalization, full ResumeDocument section support, security hardening, admin lifecycle, generator diversity/UI, multi-parser ATS validation, and pagination refinement remain later phases.
- Phase 1–16 focused premium renderer/preview suite: **69/69 tests pass**.
- `npm run build` and `npm run lint` were attempted; this supplied archive does not contain the installed `vite` or `eslint` binaries, so those commands stop with `vite: not found` / `eslint: not found` and are not claimed as passing.

## Phase 17 — Runtime Template Catalog

Small closed-loop runtime-catalog patch on top of Phase 16. Template rendering/content/truth logic remains unchanged; this phase connects already-published stored TemplateDefinitions to the normal Resume Studio/Resume OS runtime without adding them to source-code arrays.

### Changes
- Added `web/src/lib/runtimeTemplateCatalog.js` (`runtime-template-catalog-v1`): published production-enabled Template OS rows become runtime registry cards through the existing `toRegistryCard()` adapter; drafts, generated rows, and production-disabled/license-pending definitions are rejected client-side as a second gate.
- Runtime installation never mutates the code-shipped `RESUME_TEMPLATES` array. `mergeTemplateCatalog()` overlays a newer stored version on the same id and appends brand-new published templates deterministically.
- `getResumeTemplate()` now resolves installed runtime cards before the static registry, so live preview, compare and client-side vector PDF export can render a template that did not exist at build time.
- Added `GET /api/template-os/templates?catalog=1&publishedOnly=1`: catalog mode returns the complete TemplateDefinition plus certification for production-published rows. `publishedOnly=1` remains published-only even for admins, preventing the student runtime catalog from accidentally inheriting builder drafts.
- Added `TemplateOsApi.catalog()` and Resume Studio boot-time catalog installation. The Create wizard and Design gallery both consume the merged runtime catalog.
- Published runtime cards use Phase 16 cached-preview URLs when an asset exists and automatically fall back to the deterministic Template OS SVG when it does not. Runtime cards show their runtime version in the Design gallery.
- Dynamic certification metadata is honored by the gallery's `ATS Checked` indicator.
- Added `server/utils/templateOs/runtimeCatalog.js` (`server-runtime-template-catalog-v1`) so Resume OS server workflows use the same production-published catalog. Deterministic template recommendation, `Tailor for Job`, auto-fit template resolution and DOCX template metadata now resolve runtime-published definitions instead of only the static registry.
- Existing static/offline behavior remains the fallback: if the catalog request fails, all code-shipped templates remain fully usable.

### Validation
- Added `test/templateRuntimeCatalog.test.js` covering published-only client installation, license/draft rejection, static registry immutability, same-id runtime replacement, server draft→published visibility, runtime-only template rendering, deterministic recommendation participation, and source wiring.
- Phase 1–17 focused premium renderer/runtime suite: **74/74 tests pass**.
- Rendered a proof template `runtime-published-market-pro` that is explicitly absent from static `RESUME_TEMPLATES`; runtime resolution produced a one-page A4 vector PDF with selectable/searchable text.
- Full Vite build/lint remain unavailable in this extracted archive because installed `vite`/`eslint` binaries are absent; those checks are not claimed as passing.

### Deferred intentionally
Template-version pinning into ResumeDocument/variants, content-budget propagation, career-stage normalization, full ResumeDocument section support, security/admin hardening, Template Builder lifecycle fixes, generator diversity/UI, multi-parser ATS validation and pagination refinement remain later phases.

## Phase 18 — Template Version Pinning

Small reproducibility/persistence patch on top of Phase 17. This phase does not redesign templates; it guarantees that a saved resume keeps rendering the exact template revision it originally selected even after the runtime catalog advances to a newer version.

### Changes
- Upgraded the canonical ResumeDocument to `resume-doc-v4-template-pin` with an additive `templateVersion` field. Older documents without the field remain valid and are treated as legacy/unpinned until an authoritative save/create operation resolves and pins a concrete version.
- Added top-level `templateVersion` persistence to the Mongo ResumeDocument row and list projection; snapshots already carry the canonical document and restore now synchronizes both `templateId` and `templateVersion` summary fields.
- Upgraded the server runtime catalog to `server-runtime-template-catalog-v2-template-pin`: it can resolve `templateId + templateVersion` exactly, return null in strict mode when the requested revision is unavailable, and pin legacy documents once without ever upgrading an existing pin.
- Upgraded the client runtime catalog to `runtime-template-catalog-v2-template-pin`: latest published cards remain the gallery catalog while historical published revisions can be hydrated into a separate exact-version map for old resumes.
- Added `templateVersionOf()` and version-aware `getResumeTemplate(id, version, { strictVersion })` to the central registry. Existing unversioned call sites retain legacy/latest behavior; pinned render/export paths use strict exact resolution.
- Template recommendations now carry `templateVersion` so accepting a recommended layout pins the same exact revision that was scored.
- Resume Studio now pins version on Create, gallery selection, recommendation selection, comparison selection, preview and export. Opening an old pinned runtime resume lazily fetches its exact historical definition via `TemplateOsApi.get(id, version)` without replacing the current gallery version.
- Resume Studio visually distinguishes a resume pinned to an older revision from the latest catalog card (`RESUME PINNED · V#`).
- `Tailor for Job` variants persist the recommended template version. Create/save/compile-persist paths pin server-authoritatively; auto-fit and DOCX export resolve strict pinned revisions and return `template_version_unavailable` instead of silently substituting a newer template.
- Template OS HTML/PDF server render endpoints now accept `templateVersion` and resolve the exact stored revision.
- Upgraded Template Store to `template-store-v2-db-authoritative-version`: when Mongo is enabled, the database-assigned version is now the version cached in memory. This closes the restart case where memory could previously cache v1 while the database correctly created v6.

### Validation
- Added `test/templateVersionPinning.test.js` covering canonical normalization, exact server resolution, one-time legacy pin migration, client historical-version hydration, recommendation version propagation, database-authoritative store versions, Resume Studio wiring, and persistence/source contracts.
- Phase 1–18 focused premium renderer/runtime suite: **83/83 tests pass**.
- Generated an actual proof pair using the same runtime template id: historical resume pinned to v1 renders the left technical-rail design while the catalog's current v2 renders the right infrastructure-rail design. Both are one-page A4 vector PDFs with searchable/selectable text and different SHA-256 hashes.
- Proof metadata confirms `catalogLatestVersion=2`, `historicalResume.resolvedVersion=1`, `stayedPinned=true`, and a legacy unpinned document becomes pinned to v2 on authoritative resolution.
- Syntax checks pass for all modified `.js` modules.
- Broader Resume OS regression suites were attempted but this extracted archive lacks the installed `jszip` dependency required by the DOCX module; full Vite build/lint also remain unavailable because installed `vite`/`eslint` binaries are absent. Those checks are not claimed as passing.

### Deferred intentionally
Content-budget propagation, career-stage normalization, complete ResumeDocument section support, strict Template DSL security, admin authorization/lifecycle, generator diversity/UI, multi-parser ATS validation, and pagination refinement remain later phases.


## Phase 19 — Template Content Budget Propagation + Deterministic Vocabulary Enrichment

Small Tailor-for-Job capacity patch on top of Phase 18. Template visuals, truth rules, evidence authority, optional-AI policy, auth, billing and unrelated product logic remain unchanged.

### Changes
- Upgraded content planning to `content-budget-v2-template-contract`. `TemplateDefinition.contentBudget` now survives `toRegistryCard()` and runtime catalog projection instead of being lost at the Resume OS boundary.
- `budgetForTemplate()` reads either direct card budgets or nested runtime definitions, normalizes `ats → ats-strict` and `technical → tech`, validates numeric allowances, and prevents preferred limits from exceeding hard max limits.
- All seven premium Template OS builtins now declare complete contracts for summary, current/previous experience, project count + project bullets, skills, certifications and achievements.
- Fixed a latent project-budget bug where `preferredBullets` could be mistaken for `preferredCount`; project-count and bullet-count allowances are now resolved independently.
- Added template-region-aware summary capacity (`summaryCapacityForTemplate`): summary line budgets become conservative character limits based on the actual column/region width.
- Tailor for Job passes the selected template's summary capacity to the deterministic summary compiler. If an existing summary materially exceeds the selected template contract, the proposed variant may use a shorter deterministic summary built only from confirmed facts; the master remains untouched and the decision is explicit.
- Content ranking upgraded to `content-selection-v2-budget-aware` with deterministic certification and achievement ranking. Role-aligned credentials and quantified/target-relevant achievements survive finite template slots before generic items.
- `planContentBudget()` now enforces certification and achievement counts in addition to experience, projects and skills; every hidden item has an explainable budget decision.
- Deterministic resume vocabulary enriched without introducing AI: expanded precise action-verb families, five additional fact-bound grammar patterns, two additional summary pattern families, sentence-safe summary clipping, and additional filler cleanup.
- Vocabulary truth wording tightened: removed the unsupported phrase `independently verified` in favor of `verified` / `platform-verified`; no vocabulary rule is allowed to add numbers, technologies or claims.
- Engine versions: `content-budget-v2-template-contract`, `content-selection-v2-budget-aware`, `bullet-compiler-v2-vocabulary`, `summary-compiler-v2-vocabulary`, `writing-providers-v2-vocabulary`.

### Validation
- Added `test/templateContentBudgetPropagation.test.js` covering card propagation, complete builtin contracts, category aliases, summary-region capacity, per-section budget enforcement, certification/achievement ranking, Tailor-for-Job summary wiring, and deterministic vocabulary safety.
- Phase 1–19 focused premium renderer/runtime/content suite: **91/91 tests pass**.
- Rendered an actual A4 vector-PDF proof using the same premium layout with generic category fallback versus a template-specific contract. The contract version retained 1 vs 2 projects, 10 vs 16 skills, 2 vs 4 certifications, 2 vs 3 achievements and 2 vs 3 previous-role bullets while keeping searchable/selectable PDF text.
- `test/resumeOsV4.test.js` was also attempted, but this extracted archive lacks the installed `jszip` dependency required by the DOCX module, so that broader suite cannot load and is not claimed as passing.
- Full Vite build/lint remain unavailable because the supplied archive lacks installed `vite`/`eslint` binaries.

### Deferred intentionally
Career-stage normalization, complete ResumeDocument section support in Template OS, strict Template DSL security, admin authorization/lifecycle, generator diversity/UI, multi-parser ATS validation and owned pagination refinement remain later phases.

## Phase 20 — Canonical Career Stage + Premium Page Composition + Vocabulary Depth

Broader quality pass on top of Phase 19, explicitly authorized to improve page composition and deterministic resume language while completing the planned career-stage normalization. Truth/evidence rules, optional-AI boundaries, content budgets, template DSL architecture and unrelated product features remain intact.

### Changes
- Added `server/utils/resume/careerStage.js` (`career-stage-v1`) with one canonical ladder across Resume OS and Template OS: `student → early → mid → senior → executive`. Historical aliases such as `fresher`, `professional`, `experienced`, `staff`, `principal`, `director`, `head` and `vp` remain accepted and normalize deterministically.
- Career-stage detection now combines target-title intent with real tenure when dates exist, plus a conservative work-history fallback for imported/renderer-shaped resumes whose dates are unavailable.
- Template recommender upgraded to `template-recommender-v2-career-stage`: old metadata such as `careerStages:['professional']` is scored correctly as `mid`, adjacent stages receive partial fit, and distant stage mismatches are explainably penalized.
- Resume Shape upgraded to `resume-shape-v3-career-stage`; Template OS adapter, deterministic synthesis, Template Builder controls and premium builtin stage metadata now use the same canonical stage vocabulary. Template generation accepts the `executive` stage and uses education-first ordering for student/early profiles plus impact-first experience for senior/executive profiles.
- Added `page-composition-v1` in the layout compiler (`layout-compiler-v16`). One-page under-filled resumes receive bounded increases in body confidence, line height, section rhythm, item rhythm, skill-group spacing and (for sparse single-column layouts) a slightly narrower narrative measure. The pass never removes content or shrinks base typography.
- Added a conservative estimator safety ceiling so whitespace expansion cannot turn a healthy one-page resume into an accidental two-page export. Sparse resumes receive a stronger but still capped editorial rhythm; genuinely sparse data is not padded with fake content or arbitrary footer spacers.
- PDF writer upgraded to `template-pdf-writer-v15` with exact `geometry.pageUsage` telemetry: per-page used height, bottom whitespace and utilization are recorded from the owned paginator for regression/proof without adding visible parser noise.
- Added premium two-page orphan rebalancing for single-column PDFs. When page 2 would contain only a tiny tail, the writer moves a whole late semantic section (never individual claims) to page 2. This keeps text/font sizes unchanged, preserves extraction order, and replaces accidental 99%/11% pagination with a deliberate continuation-page composition when a safe section boundary exists.
- Deterministic resume language expanded substantially across BUILD/DEVELOP/DESIGN/AUTOMATE/OPTIMIZE/DELIVER/OPERATE/LEAD/ANALYZE/IMPROVE/MIGRATE/SECURE/TEST/MONITOR/COLLABORATE/RESEARCH/MANAGE families. Added additional fact-bound grammar structures; every slot still requires supplied facts.
- Role-action dictionaries were expanded for DevOps, Cloud, Software Engineering, Data Engineering, Data Analysis, Data Science, QA, Security and Product Management.
- Role dictionary resolution now ignores seniority modifiers for ontology lookup: e.g. `Senior DevOps Engineer` correctly uses the DevOps skill/action dictionary rather than falling back to generic vocabulary. The displayed target title is preserved, avoiding wording such as `Senior Senior DevOps Engineer`.
- Summary compiler upgraded to `summary-compiler-v4-career-stage-vocabulary`, carries canonical stage + resolved role family, adds stage-aware professional/leadership summary families, and retains sentence-safe clipping and truth-only composition.

### Page-composition proof
- Project-heavy student / Campus Portfolio: first-page bottom whitespace reduced from **281.54 pt → 117.85 pt**, still one-page A4.
- Mid-career / Balanced Two Column: **337.44 pt → 190.81 pt**, still one-page A4.
- Mid-career DevOps / Editorial Professional: **91.67 pt → 19.73 pt**, still one-page A4 and visually much more complete.
- Dense Executive Technology 2-page proof: previous pagination used ~98.9% of page 1 but only ~11.4% of page 2. Owned orphan balancing moves `Skills` as a whole to page 2, producing approximately **71.0% / 35.6%** utilization without changing content or shrinking typography.

### Validation
- Added `test/templateCareerStageComposition.test.js` covering alias normalization, stage detection, historical template metadata scoring, ResumeShape integration, one-page whitespace reduction, no typography shrink, exact page-usage telemetry, orphan-page rebalancing, expanded same-family verbs and stage-aware summary generation.
- Phase 1–20 focused Template OS suite: **100/100 tests pass**.
- Actual A4 vector PDFs were rendered and visually inspected for student, mid-career balanced, mid-career editorial and executive two-page cases. PDF render/compare workflow confirms no clipping or accidental page growth in the inspected one-page samples.
- Broader `templateOs.test.js` / `templateOsGaps.test.js` were attempted but this extracted archive lacks installed `express` and `jszip`, so those suites cannot load and are not claimed as passing.
- Full Vite build/lint remain unavailable because the supplied archive lacks installed `vite` / `eslint` binaries; those checks are not claimed as passing.

### Deferred intentionally
Complete ResumeDocument section support, strict Template DSL security, admin authorization/lifecycle, generator diversity/UI, multi-parser ATS certification and broader owned-pagination refinement remain later phases.


## Phase 21 — Full ResumeDocument sections + premium optional-section rendering

- Template OS now renders the complete canonical ResumeDocument surface: publications, patents, volunteer work, languages, custom sections and additional contact links, in addition to the existing core sections.
- Omitted optional sections are appended deterministically to each TemplateDefinition order so populated ResumeDocument content can never disappear simply because an older template definition predates the section.
- HTML/PDF parity includes premium record styling for publications/patents, compact language lines, semantic volunteer lists and titled custom sections.
- ResumeShape v4 measures optional-section pressure and reading-order anchors now cover the full section surface.
- Runtime registry cards advertise the complete section capability.
- Deterministic resume vocabulary expanded with transformation, documentation, communication, operations, analysis and testing verbs while preserving same-meaning alternative groups and truth constraints.

### Phase 21 hardening / validation
- `page-composition-v2-safe-expansion` adds a near-full single-column expansion guard. This preserves the Phase 20 premium whitespace treatment while preventing line-wrap variance from creating an avoidable second page after the full-section estimator became more accurate. DevOps Editorial proof remains one page and reduces footer whitespace from 91.67 pt to about 29 pt without typography shrink.
- Programming-language skill groups are disambiguated from spoken `Languages` when both are present (`Programming Languages` vs `Languages`), avoiding duplicate semantic headings in full-section resumes.
- Corrected seniority/family role-regex word boundaries and closed the remaining role-action vocabulary gaps (`scaled`, `trained`, `predicted`). Added further precise transformation/documentation/communication terms (`reengineer`, `formalize`, `record`, `convey`). All configured role-action verbs are now recognized by the grammar vocabulary.
- Phase 1–21 focused Template OS suite: **108/108 tests pass**.
- Additional broad Template OS suites were attempted but cannot load in this extracted archive because installed `express` and `jszip` dependencies are absent; those suites are not claimed as passing.
- Actual A4 vector proofs were rendered and visually inspected for Editorial, Balanced Two Column and Campus Portfolio. The same rich Balanced fixture grows from the Phase 20 core-only surface (~60.4% page utilization) to a one-page full-section composition (~86.9%) while preserving searchable/selectable text.

## Phase 22 — Strict Template DSL Security + Source-Backed Project Depth + Vocabulary Expansion

Security hardening on top of Phase 21, while carrying forward the explicit resume-composition constraint: whitespace may be improved through layout/spacing and richer existing project evidence, but Template OS must never invent or auto-enable unrelated sections merely to make a page look full.

### Strict Template DSL / package security
- Upgraded the DSL to `template-dsl-v2-strict` with `template-security-v2-allowlist`. Imported definitions are accepted only when the root and every nested renderer-facing object use known fields, known primitives and bounded value ranges.
- Added fail-closed limits for depth, total nodes, array sizes, individual/aggregate string size, non-plain objects, prototype-manipulation keys, control/bidi characters and dangerous HTML/CSS/script constructs.
- Typography, spacing, colors, header geometry, column geometry, content budgets, export settings, license state and certification metadata now have explicit type/range checks; arbitrary font/CSS/renderer hook fields are not part of the allowlist.
- Package security upgraded to `template-package-security-v2-strict`: executable/markup entries, traversal/absolute paths, oversize content, mismatched image signatures and unsafe CSS now reject the package rather than being silently ignored.
- `styles.css` is palette-only: exactly one `:root` block and only `--tpl-accent`, `--tpl-rule`, `--tpl-side`, `--tpl-text`, `--tpl-muted`, each a validated 3/6-digit hex color.
- `metadata.json` is allowlisted to `source`, `licenseName`, `author`, `notes`; metadata/license text rejects markup delimiters and control/bidi characters. A package still cannot grant itself production rights.
- Server Template OS validate/import/certify/thumbnail boundaries pass the shared primitive registry into sanitization so unknown renderer primitives fail before compilation.
- Strict validation preserves the existing Template Builder license vocabulary (`INTERNAL_ORIGINAL`, `OWNED`, `OPEN_SOURCE`, `LICENSED`, `LICENSE_PENDING`, `DEVELOPMENT_REFERENCE`) so the security boundary does not break legitimate lifecycle states.

### No synthetic resume sections for whitespace
- Page composition upgraded to `page-composition-v3-intentional-whitespace` with explicit `contentPolicy: spacing-only-no-synthetic-sections`.
- Sparse-page expansion is intentionally more conservative than Phase 20/21. Genuine whitespace is allowed when the ResumeDocument does not contain enough useful content.
- Full-section compiler support remains intact, but empty Publications/Patents/Volunteer/Languages/Custom Sections produce zero visible layout and are never enabled or synthesized by composition.

### Source-backed project depth
- Master profile/project seeding upgraded to `master-profile-v3-project-depth` + `project-bullet-enrichment-v2-source-only-depth`.
- A Project OS record can preserve up to four distinct resume pointers, but every pointer must be copied from an existing project description sentence or stored project outcome. No technology, metric, claim or result is synthesized.
- Deduplication prevents description/outcome overlap while preserving evidence ids, project id, verification status and provenance on every candidate bullet.
- Infrastructure `evidence-compact` presentation now permits up to four actual project bullets; Student Portfolio remains capped at three to protect student-layout density. Template content budgets continue to decide how many source bullets survive tailoring.

### Deterministic vocabulary
- Grammar vocabulary expanded to **252 recognized action verbs** with additional precise families such as `scaffold`, `materialize`, `augment`, `ingest`, `partition`, `rebalance`, `backfill`, `calculate`, `decompose`, `contain`, `mask`, `smoke-test`, `load-test`, `stress-test`, `baseline`, `curate`, `demonstrate`, `translate`, `replicate`, `onboard`, `project` and `simulate`.
- DevOps, Cloud, Software, Data Engineering, Data Analysis, Data Science, QA, Security and Product role dictionaries now expose additional domain-appropriate actions while every configured role action remains recognized by the same-family grammar engine.
- Vocabulary changes remain wording-only: they cannot add unsupported numbers, tools, responsibilities or outcomes.

### Validation
- Phase 1–22 focused Template OS/runtime/content/security suite: **115/115 tests pass**.
- Phase 22 dependency-free security tests cover builtin strict validation, CSS/renderer injection, prototype/depth/size attacks, package palette/path/magic-byte/metadata guards, no-synthetic-section composition, four source-backed project pointers and complete role-vocabulary recognition.
- Rendered and visually inspected one-page A4 vector PDFs for Cloud Infrastructure Pro and Editorial Professional showing four verified source-backed project bullets, plus a deliberately sparse Editorial proof that retains honest whitespace instead of inventing optional sections.
- All inspected PDFs are PDF 1.4 A4 with searchable/selectable text and no visible clipping/overlap.
- `templateOsGaps.test.js` was attempted but cannot load because this extracted archive lacks installed `jszip`. Full Vite build/lint were also attempted and stop at `vite: not found` / `eslint: not found`; those checks are not claimed as passing.

### Deferred intentionally
Admin authorization hardening / Template Builder lifecycle (Phase 23), generator diversity/UI, multi-parser ATS certification and later pagination/family expansion remain later phases.


## Phase 23 — Server-Authoritative Admin Authorization + Exact-Version Builder Publish + Vocabulary Expansion

Production hardening on top of Phase 22. Resume rendering, truth/evidence rules, no-synthetic-section composition and optional-AI boundaries remain unchanged.

### Admin authorization / runtime separation
- Added `template-admin-auth-v1-server-authoritative` and a pure, testable Template OS admin policy.
- Added `GET /api/template-os/admin/access`, guarded by the existing verified server-side admin middleware. Template Builder now probes this endpoint and no longer treats the client `user.role` value as authorization.
- `validate`, Builder save, JSON import, ZIP import, generation, deep certification, thumbnail generation and status mutation are all server-admin-only.
- Builder inventory (`GET /api/template-os/templates` without runtime flags) is admin-only. The student-facing catalog remains explicit and read-only at `?catalog=1&publishedOnly=1`.
- Runtime publication is fail-closed: a template must be `PUBLISHED`, `productionEnabled:true`, and use a cleared license state (`INTERNAL_ORIGINAL`, `OWNED`, `OPEN_SOURCE`, `LICENSED`). Missing/ambiguous license state no longer counts as production-cleared.
- Exact public template reads use a restricted projection and omit internal fields such as `createdBy` / internal notes. Stored DRAFT/GENERATED definitions cannot be used by public render/PDF endpoints.
- Admin audit telemetry is bounded to action/template/version/status/source and never copies template/request bodies into audit events.

### Exact-version Builder lifecycle hardening
- Added admin-only `POST /api/template-os/save` for internally authored Builder drafts. Unlike external import, it may preserve an explicitly cleared license state but **never auto-publishes**.
- External JSON import ordering was fixed so payload fields cannot override forced `LICENSE_PENDING` / `productionEnabled:false`.
- Template Builder now tracks the exact saved version and a deterministic draft fingerprint. Any edit after save invalidates certification/publish readiness.
- Deep certification can bind to `templateId + version`; when bound it certifies the stored definition, not an arbitrary client payload, and persists that certification onto the same immutable version.
- Added template-store + Mongo support for updating certification metadata without creating a new template version.
- Publishing now requires `certified:true` **and** `evidence:'real-pdf-text-layer'` on that exact stored version plus explicit license clearance. The old UI hard-coded `version:1` publish bug is removed.
- Updated broader route tests (for environments with dependencies installed) to reflect server-admin-only builder operations and to exercise Save → blocked premature publish → bound deep certification → successful publish.

### Deterministic resume vocabulary
- Expanded the grammar dictionary from **252 → 285 recognized action verbs** while preserving semantic-family replacement rules.
- Added stronger but controlled language such as `modularize`, `encapsulate`, `outline`, `refine`, `shield`, `probe`, `cooperate`, `interface`, `reshape`, `rework`, `reinvent`, `capture`, `chronicle`, `clarify`, `relay`, `showcase`, `extrapolate`, `rectify`, `correct` and `repair`.
- Added a dedicated `REMEDIATE` family so repeated `fix` wording can vary safely between `rectify / correct / repair` rather than jumping to an unrelated operational/security verb.
- Expanded DevOps, Cloud, Software, Data Engineering, Data Analysis, QA, Security and Product role action dictionaries; **all configured role actions remain recognized** by the deterministic grammar engine.

### Validation
- Added `test/templateAdminAuthorizationPhase23.test.js` covering runtime-vs-builder policy, admin middleware wiring, server access probe, exact-version Builder state, certification persistence, bounded audit projection and vocabulary recognition.
- Phase 1–23 focused Template OS suite: **121/121 tests pass**.
- Rendered a one-page A4 vector/searchable Editorial Professional regression PDF after the security changes; renderer output remains intact and no synthetic sections were introduced.
- `npm ci --offline` was attempted to unlock the full Express/JSZip integration suites but the npm cache does not contain `zod`; therefore the missing runtime dependencies cannot be installed in this environment. Full `npm run build` / `npm run lint` were attempted and still stop at `vite: not found` / `eslint: not found`; those checks are not claimed as passing.

### Deferred intentionally
Full Template Builder lifecycle/state-machine UX (Phase 24), generator diversity/UI, multi-parser ATS certification and later pagination/family expansion remain later phases.

## Phase 24 — Immutable Template Builder Lifecycle + Version History + Vocabulary Expansion

Production lifecycle work on top of Phase 23. The public runtime catalog, exact-version pinning, source-only project enrichment and no-synthetic-section composition rules remain unchanged.

### Immutable lifecycle / release workflow
- Added `template-lifecycle-v1-immutable-approval` as a shared lifecycle contract with the primary path `DRAFT → VALIDATING → CERTIFIED → APPROVED → PUBLISHED` plus explicit disable/fork semantics.
- Added fail-closed lifecycle blockers for missing deep PDF/text-layer certification, uncleared production licenses and invalid state transitions. A direct `DRAFT → PUBLISHED` transition is rejected.
- Deep certification now owns the `DRAFT → VALIDATING → CERTIFIED` transition for the exact stored version. A failed deep certification returns the version to `DRAFT`; a certified/approved/published immutable version must be forked before content changes can be certified again.
- Added explicit admin approval before publication. Approval/publish/disable transitions record bounded actor/timestamp lifecycle events without copying template contents into audit metadata.
- Published and disabled versions remain immutable. Editing either in Template Builder loads it only as an edit source; saving creates a new `DRAFT` version with `baseVersion` provenance rather than mutating the source revision.

### Version history / persistence
- Upgraded Template Store to `template-store-v3-db-authoritative-version-lifecycle-history` with version history, `baseVersion`, change notes, lifecycle metadata and database-authoritative version allocation.
- Mongo TemplateDefinition persistence now stores bounded lifecycle history plus approved/published/disabled actor/timestamp metadata and exposes an exact version-history query.
- Added admin-only `GET /api/template-os/templates/:templateId/history` and `TemplateOsApi.history(templateId)` so Builder can inspect immutable revision history without widening the public runtime surface.
- Runtime catalog semantics remain unchanged: only explicitly production-enabled, license-cleared `PUBLISHED` definitions are advertised. A disabled revision disappears from the catalog while saved ResumeDocuments retain their version pin metadata.

### Template Builder UX
- Builder now exposes the lifecycle as five visible stages and tracks the exact saved version, deep-certification state and license clearance before enabling release actions.
- Added explicit Approve / Publish / Disable actions, version-history inspection, base-version/fork context and per-version certification/license status.
- Opening `PUBLISHED`, `DISABLED`, `GENERATED` or `LICENSE_PENDING` content enters immutable fork mode; saving creates a new version. Editing after save invalidates exact-version certification readiness until the new draft is saved/certified.
- Builtin templates continue to copy into a new custom template id rather than pretending a shipped builtin is an editable stored revision.

### Deterministic resume vocabulary
- Expanded the grammar library from **285 → 338 recognized action verbs** across **26 semantic families**, including a dedicated `DIAGNOSE` family.
- Added controlled vocabulary such as `root-cause`, `pinpoint`, `localize`, `fine-tune`, `debottleneck`, `triangulate`, `scrutinize`, `industrialize`, `modularize`, `reconfigure`, `disseminate`, `co-create`, `equip`, `redress` and related same-family alternatives.
- Expanded DevOps, Cloud, Software Engineering, Data Engineering, Data Analysis, Data Science, QA, Security and Product role dictionaries. All configured role actions remain recognized by the deterministic grammar engine.
- Vocabulary remains wording-only and fact-bound: semantic alternatives cannot add tools, scope, metrics, leadership or outcomes absent from the ResumeDocument/evidence source.

### Validation
- Added `test/templateBuilderLifecyclePhase24.test.js` covering lifecycle state transitions, blockers, content fingerprinting, immutable store history/forks, route/UI history wiring, Mongo lifecycle metadata and vocabulary coverage.
- Phase 1–24 focused Template OS suite: **129/129 tests pass**.
- Rendered and visually inspected a one-page A4 vector/searchable Editorial Professional regression PDF after lifecycle/store changes; no clipping/overlap or synthetic sections were introduced.
- Broader Express/JSZip Template OS tests were attempted but cannot load because this extracted archive lacks installed `express` / `jszip`. Full Vite build/lint are also unavailable because `vite` / `eslint` binaries are absent; those checks are not claimed as passing.

### Deferred intentionally
Generator diversity (Phase 25), generator UI, multi-parser ATS certification, owned pagination expansion and later flagship/template-family work remain later phases.

---

## Phase 25 — Generator Diversity

**Goal:** stop deterministic synthesis from producing palette swaps of one layout.

- Replaced the shallow generator with `template-synthesis-v3-structural-diversity`.
- Added 15 allowlisted structural archetypes spanning single-column, left/right rail, two-column, editorial, executive, student, research and ATS-first compositions.
- Added role-family archetype routing plus canonical career-stage adaptation.
- Added deterministic structural signatures and normalized structural-distance measurement.
- Candidate ranking now uses novelty-aware maximum-marginal-relevance scoring and will select unseen archetypes before cosmetic variants.
- Generated definitions remain `GENERATED`, `productionEnabled:false`, DSL-validated and lifecycle-gated.
- Student/early generation retains education/project priority even when it uses a non-student structural archetype.

Versions:
- `template-synthesis-v3-structural-diversity`
- `template-generator-diversity-v1`

## Phase 26 — Generator UI

**Goal:** expose structural generation safely in Template Builder.

- Added a deterministic Generator panel with target roles, career stage, density, ATS priority, layout preference and visual direction.
- Added diversity evidence: archetype count, layout count, average structural distance, minimum structural distance and survivor count.
- Candidate cards expose score, ATS level, archetype rationale and deterministic SVG preview.
- Loading a candidate always converts it to a non-production `DRAFT`; it cannot bypass save → certify → approve → publish.
- Server generator responses now include archetype, rationale, diversity score and structural signature.

## Phase 27 — Multi-Parser ATS Audit

**Goal:** measure robustness against more than one extraction order without claiming vendor-specific ATS behavior.

- Added `multi-parser-ats-v1-owned-pdf`, which reads the actual text-placement operators emitted by the owned vector-PDF writer.
- Added three explicit extraction models: semantic content-stream, spatial row-major and visual column-major.
- Added WinAnsi decoding for the writer's octal text escapes so punctuation/dates/certification names are measured accurately.
- Added field-integrity, critical-field, reading-order and robustness reporting per model.
- Certification is regime-aware: one-page and multi-page behavior are measured separately; alternate visual-order risk is reported rather than hidden.
- Deep PDF certification now includes the multi-parser evidence contract.
- No profile is named after Workday, Greenhouse, Lever or any other vendor; this is a parser-strategy audit, not vendor certification.

Versions:
- `template-os-cert-v2-multi-parser`
- `template-os-multi-parser-cert-v1`
- `multi-parser-ats-v1-owned-pdf`

## Phase 28 — Owned Semantic Pagination

**Goal:** make page breaks a renderer-owned semantic decision instead of a browser side effect.

- Upgraded PDF writer to `template-pdf-writer-v17-owned-pagination-groups`.
- Added semantic `keepWithNextLines` groups for section headings, role headers and project headers.
- The paginator moves the complete semantic group to the next page when the heading/title would otherwise be orphaned.
- Added telemetry for prevented semantic-group orphans.
- Preserved and widened the Phase 20 whole-section orphan rebalance so two-page executive resumes do not leave a tiny tail page after semantic grouping.
- Browser page-break behavior is not used by the owned PDF writer.

Versions:
- `owned-pagination-v2-semantic-groups`
- `template-pdf-writer-v17-owned-pagination-groups`

## Phase 29 — Signature Engineering Flagship

**Goal:** create a definitive Career Autopilot engineering resume family that demonstrates premium appearance and strict parser behavior together.

Added `Signature Engineering`:
- single-column ATS-safe narrative
- split corporate identity header
- signature sans typography
- graphite-blue restrained palette
- compact stack matrix
- cloud/platform experience hierarchy
- evidence-led projects with source-backed project depth
- native DOCX profile
- full ResumeDocument support with empty optional sections remaining invisible

The flagship is intentionally not decorative: its actual owned-PDF proof retains full critical-field recovery and very-high cross-parser reading order on the flagship fixture.

## Phase 30 — Premium Family Expansion

**Goal:** expand Template OS beyond the original seven families without producing clones.

Added seven published first-party Template OS families (14 total):

1. `signature-engineering` — flagship engineering/platform
2. `modern-corporate` — consulting/program/business
3. `security-engineering` — cloud security/devsecops
4. `analytics-insight` — data/analytics
5. `product-strategy` — product/strategy
6. `research-innovation` — publications/patents/research
7. `minimal-ats-premium` — strict ATS-first universal single-column

Also added reusable typography, color and single-column primitives for these families. Resume Studio now contains 42 static templates, including 14 Template OS definitions, and the Phase 16 real-preview cache was regenerated to cover every one of them.

### Vocabulary continuation through Phases 25–30

The deterministic grammar library now recognizes **384 action verbs**. Additional precise families include terms such as `Containerized`, `Packaged`, `Decoupled`, `Normalized`, `Denormalized`, `Pipelined`, `Cached`, `Memoized`, `Vectorized`, `Authenticated`, `Authorized`, `Sanitized`, `Segregated`, `Rotated`, `Attested`, `Fuzz-tested`, `Contract-tested`, `Canary-tested`, `Chaos-tested`, `Hypothesized`, `Ranked`, `Aggregated`, `Sharded` and `Mitigated`.

All configured role-specific action entries remain recognized by the grammar engine. Alternatives stay inside their semantic family; the vocabulary expansion does not authorize unsupported metrics, technologies, ownership, leadership or outcomes.

### Content discipline preserved

The Phase 22 constraint remains active through completion:

- no optional section is generated merely to fill whitespace;
- intentional whitespace is allowed on genuinely sparse resumes;
- project depth may increase only from source-backed/project-evidence facts;
- page composition can adjust safe spacing but cannot invent content.

### Final Phase 25–30 validation
- Added 23 focused tests across Phases 25–30; the complete focused Phase 1–30 suite now passes **152/152**.
- `test/resumeOs.test.js` also passes **28/28** in the supplied dependency set. The broader `test/templateOs.test.js` cannot load because the extracted archive does not include `express`; full Vite build/lint remain unavailable because `vite` / `eslint` binaries are absent. These unavailable checks are not claimed as passing.
- All 14 published Template OS builtins pass the deterministic multi-parser certification contract on the A4 certification fixtures. Parser-strategy risk for multi-column layouts is still reported rather than hidden.
- Regenerated the real Phase 16 preview cache for the expanded library: **42 Resume Studio previews + 8 legacy editor previews = 50 cached PNGs**.
- Rendered and visually inspected seven new family proof PDFs plus the owned-pagination proof. The seven family samples are one-page A4 PDF 1.4 documents with recoverable/searchable text; the pagination proof is an intentional two-page A4 document.
- Grammar vocabulary closes at **384 recognized verbs**, **271 role-specific action entries**, and **0 unrecognized role actions**. The no-fake-section and source-backed-project-depth rules remain active.

---

## Reference Premium Family Expansion — Uploaded Resume Design Migration

**Goal:** absorb the nine uploaded premium resume design directions into Template OS as first-party, editable, ATS-aware families instead of leaving them as legacy/editor-only layouts.

Added nine published Template OS families (23 Template OS families total):

1. `precision-engineering-classic` — compact one-page engineering/recruiter classic
2. `heritage-detailed` — detailed serif one/two-page professional
3. `graduate-violet` — education/project-first graduate portfolio with semantic skill chips
4. `cloud-devops-modern` — modern cloud/DevOps single-column with restrained sky accents
5. `midnight-technical-rail` — dark technical rail + narrative experience/project column
6. `minimal-serif-ats` — minimal serif ATS-first professional
7. `dark-executive-classic` — dark executive identity band with classic serif body
8. `centered-ats-engineering` — centered compact engineering ATS layout
9. `violet-modern-professional` — modern professional single-column with violet accents and semantic skill chips

### Renderer/primitives
- Added reusable classic serif, centered ATS, chip-based modern, and dark-rail design primitives.
- Added `soft-chips` skill presentation. Chips are visual only: skill text remains normal searchable/selectable PDF text and normal HTML text-layer content.
- Added literal-token color support to the shared HTML/PDF render-design contract so dark rails can use safe inverse typography without bespoke components.
- Added a full-height `midnight-solid` rail treatment and `dark-executive-classic` header treatment.
- Extended owned PDF rendering with semantic chip rows while preserving text extraction and parser audits.
- No uploaded HTML/code is copied; the references are re-expressed through allowlisted Template OS primitives and first-party definitions.

Versions:
- `template-primitives-v17-reference-premium-families`
- `template-render-design-v12-reference-premium-families`
- `layout-compiler-v18-reference-premium-families`
- `template-pdf-writer-v18-owned-pagination-reference-premium-families`
- `template-synthesis-v4-reference-premium-families`

### Generator/library integration
- Added the reference families to role-aware generator archetypes so they are genuine Template OS families, not gallery-only hard-coded cards.
- Resume Studio now exposes **51 static templates**, including **23 published Template OS definitions**.
- Real preview cache regenerated to **51 Resume Studio previews + 8 Resume Editor previews = 59 cached PNGs**.
- All new definitions stay subject to strict DSL validation, lifecycle/version pinning, runtime catalog rules, content budgets, full ResumeDocument rendering, owned pagination, page composition, and no-fake-section rules.

### Validation
- New reference-family tests verify all nine definitions, semantic chips, dark inverse rail rendering, parser-readable output, no synthesized empty sections, and preview-cache coverage.
- Complete focused renderer/lifecycle suite used for this expansion passes **125/125**.
- `test/resumeOs.test.js` passes **28/28**.
- Multi-parser proof: all nine new families recover critical fields. Eight single-column families are `VERY_HIGH` with 100/100 field integrity and reading order across all three owned parser models; `midnight-technical-rail` is intentionally reported as `BALANCED` because alternate visual column extraction can reorder sidebar/main content, while the semantic stream remains 100/100.
- Generated proof PDFs were rendered to PNG and visually inspected. Intentional whitespace remains preferable to synthetic sections.
