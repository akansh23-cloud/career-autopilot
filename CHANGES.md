# v7 — Production hardening (2026-06-06)

Security & production-readiness pass against the regression report:
- Dependencies: npm audit clean (mongoose/mammoth upgraded; tar/node-pre-gyp pinned via overrides).
- MongoDB required in production (fail-fast); persistence writes return 503 in prod when DB unavailable.
- Removed unscoped localStorage fallback (cross-user leak); client cache cleared on logout/user change.
- Helmet security headers + strict CSP; X-Powered-By off; strict credentialed-CORS allowlist.
- CSRF double-submit protection; per-route rate limiting; zod input validation; 5MB JSON cap.
- Centralized error handler (no stack/secret leaks) + structured redacting logger.
- Job search: shorter timeouts, overall budget, short result cache.
- Support FAQ matcher fixed (payment vs login); added billing FAQs.
- Vite code-splitting (main chunk 1.15MB -> 0.5MB).
- Tests (node:test), ESLint flat config, Playwright smoke scaffold; docs: SECURITY/TESTING/DEPLOYMENT/ENVIRONMENT.

# Career Autopilot — changes

Built & verified: `npm run build` (clean), `node --check server.js` (clean), parser/renderer unit-tested, contact fallback tested via authenticated request.

## New files
- `web/src/lib/resumeTemplates.js` — single source of truth for resumes: `parseResume()`, 8 real templates, live HTML render, **clean PDF export (html2canvas + jsPDF, no browser headers/footers)**, Word-openable DOCX export, custom-template builder.
- `web/src/components/ResumeTemplates.jsx` — `TemplateGallery`, `TemplatePreviewModal` (full A4 preview, auto/single/multi toggle), `ResumePaper` (isolated iframe render).
- `web/src/components/PricingModal.jsx` — global Free/Pro/Premium modal.

## Modified
`web/src/App.jsx`, `web/src/components/app/Shell.jsx`, `web/src/lib/resumeStore.js`, `web/src/views/Editor.jsx`, `web/src/views/Jobs.jsx`, `server.js`, `package.json` (+ `jspdf`, `html2canvas`).

## Requirement → what changed
1. **Template gallery** — 8 visually distinct templates (Jake ATS, Modern Pro, Dark Header Exec, Minimal ATS, Two-Column Tech, Cloud/DevOps, Fresher, Multi-Page) with live thumbnails, ATS score, single/multi-page label, recommended pick, and a full preview modal that renders the user's actual resume.
2. **Clean PDF** — no `window.print`. Rendered offscreen and captured at A4, scale 2; single-page fit or whitespace-aware multi-page slicing. No browser header/footer/URL.
3. **Create resume from uploaded template** — PNG/JPG/JPEG/WEBP/PDF (PDF page-1 rasterised via pdf.js). AI vision → layout spec → custom theme; graceful manual style fallback when AI is unavailable. Idle/reading/analysing/done/error/fallback states.
4. **Upgrade button** — sidebar + new top-bar pill open a real pricing modal (never null). Feature matrix + working CTAs with "Payment integration coming soon" notice.
5. **Extensive contact search** — server returns multiple contacts per job: recruiters, talent, technical recruiters, HR, hiring managers, engineering managers (role-gated). Probable company inboxes are **labelled "Probable email"**; everyone gets a LinkedIn link (real or scoped search). Confidence %, source, verified/relationship badges, mailto + Draft outreach. Scrollable modal with background lock.
6. **Legacy Jobs flow preserved** — all job-card actions intact; Tailor & Apply kit unchanged; "Open in Resume Editor" loads the tailored resume; editor downloads use the selected template; template dropdown updated to the 8 names; "Generate outreach" now opens contacts and auto-drafts.
7. **Dark theme** — all new UI matches the aurora dark theme; white A4 paper only inside preview surfaces; modals reuse the kit `Modal` (body-scroll lock + internal scroll).
8. **Persistence** — selected template and custom template persisted in `localStorage`; custom template rebuilt on load; tailor output cached.
9. **Testing** — install/build/check all pass; parser, 8 renderers, custom builder, and contact fallback exercised.

## Run
```
npm install
npm run build
node server.js   # http://localhost:3000  (demo sign-in is on)
```
Optional env for richer results: `ANTHROPIC_API_KEY` (AI tailoring + template vision), `HUNTER_API_KEY`/`APOLLO_API_KEY`/`PDL_API_KEY` (verified contact emails).
