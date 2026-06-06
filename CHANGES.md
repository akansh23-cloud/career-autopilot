# v7.2 — Vercel serverless session/Mongo hotfix (2026-06-07)

Fixes a regression I introduced in v7.1: the Mongo-backed session store only
connected inside the `app.listen` block, which Vercel never runs — so every
request (including `/auth/me`) hit an un-connected Mongoose, timed out, and
returned a generic 500. The frontend then mis-read that as "Google OAuth isn't
configured".

Root cause: session middleware used the Mongo store before any `connectDB()`.

Changes:
- `server.js` — added a serverless-safe DB-readiness gate that `await db.connectDB()` (cached promise, reused on warm invocations) BEFORE the session middleware. On a configured-but-unreachable DB in production it returns a clear **503 JSON**, not a 500. `/health` and `/health/db` are exempt so status is always inspectable. `/auth/me` is now wrapped so it can never 500 — it always returns a well-formed `{authenticated:false, providers}` payload. Passes `connect: db.connectDB` into the session store. Added DB/session/google status to `/health` and a new `/health/db` probe.
- `sessionStore.js` — every method (`get/set/touch/destroy/clear/length`) now `await`s the injected `connect()` before touching Mongo and calls back with the error safely (never hangs). This is the serverless-safe ordering.
- `web/src/hooks/useAuth.jsx` + `web/src/components/SignInModal.jsx` — track an `authError` separately from provider config; when `/auth/me` is unreachable the UI now says “Auth server is unavailable. Check MongoDB/session configuration (/health/db).” instead of the misleading OAuth message, and no longer disables the Google button on a transient auth-server error.

Tests added (`test/auth.test.js`, `test/sessionStore.test.js`, `test/_googleEnv.js`):
- `/auth/me` returns 200 / `authenticated:false` for anonymous users (no crash).
- `/auth/me` reports `providers.google.enabled=true` when Google env is set.
- `/health` exposes db/sessionStore/google; `/health/db` returns db:off (200) with no URI.
- Simulated Mongo failure: every session-store method calls back with the error and does not hang, and `connect()` runs before any query (serverless ordering).

MemoryStore is still never used in production; Mongo-backed sessions preserved; local dev (no/unreachable DB) degrades gracefully; existing tests unaffected (DB off in test).

Run: `npm run build && npm run test && npm run lint && npm run audit:ci`

---

# v7.1 — Functional & UI regression fixes (2026-06-07)

Targeted fixes against the latest regression report. No major features removed;
all features remain scoped per authenticated user; no fabricated "verified" data.

New files:
- `freshness.js` — pure, unit-tested job-freshness helpers (24h/3d/7d/30d/latest).
- `sessionStore.js` — Mongoose-backed express-session store (no MemoryStore in prod; no new dependency).
- `test/freshness.test.js`, `test/creator.test.js` — runnable node:test unit coverage.
- `e2e/regression.spec.js` — Playwright specs for the fixed behaviours.

Issues fixed:
1. Sidebar — nav is now an independently scrollable container (fixed header/footer); lower items reachable on laptop/small-desktop/mobile; no body scroll-lock side effects. (`Shell.jsx`)
2. Job freshness — enforced server-side via `freshness.js`; added 30d + Latest; **undated jobs are never treated as fresh** under a bounded window. Posted date always shown or an explicit "Date unavailable" badge. (`server.js`, `validation.js`, `Jobs.jsx`)
3. Jobs discovery — removed application-tracking-only chips (recruiters/referrals/Not contacted) from job cards. (`Jobs.jsx`)
4. Job card — added a Details modal (full description + company/location/source/date/apply link); "Apply" link. (`Jobs.jsx`)
5. Build Project for Gaps — now shows a confirmation with the selected gaps/job context before seeding the guided studio. (`Jobs.jsx`)
6. Project Creator validation — added deterministic, non-AI checks (required fields, duplicate title, target role, skill gap, unrealistic duration, empty architecture/milestones) as the authoritative gate; AI report relabelled as **suggestions, not verified**. (`projectCreator.js`, `ProjectCreator.jsx`)
7. System architecture / blueprint — gated on real project context; prompts to complete required fields instead of generating generic output. (`ProjectCreator.jsx`)
8. Build roadmap — same context gate; tasks default to todo and persist per user in Mongo via `/api/user/state`. (`ProjectCreator.jsx`)
9. Duplicate projects — `saveProject` dedupes by normalized (title, target role, source job) and folds re-saves into the existing workspace. (`projectStore.js`)
10. Dashboard funnel — added the missing **rejected** stage (server + client); real per-user data with empty-state CTA. (`db.js`, `Dashboard.jsx`)
11. Navigation — guarded view switching so unknown ids can't blank-page or land on the wrong workspace. (`App.jsx`)
12. Skill states — explicit recommended/in_progress/completed/verified derived from real proving-project status; shown as a badge; never "verified" without an actually completed/verified project. (`xp.js`, `ProofViews.jsx`)
13. Settings — role/location/salary suggestion datalists (custom allowed), currency dropdown, LinkedIn URL validation that blocks save on bad format, helpful placeholders; saved per user. (`Settings.jsx`)
14. Search shortcut — platform-aware hint (⌘K on macOS, Ctrl K on Windows/Linux), hidden on mobile. (`Shell.jsx`)
- Regression: production session store is MongoDB-backed (no MemoryStore); production exits if a configured MongoDB is unreachable. (`server.js`)

Verification done in a no-network sandbox: `node --check` on every changed JS file; `node --test test/freshness.test.js test/creator.test.js` → 12/12 pass; brace/paren balance verified on all changed JSX. Full pipeline (install/build/lint/E2E) must run on a networked machine — see commands in TESTING.md / below.

Commands: `npm install && npm audit && npm run build && npm run test && npm run lint && npx playwright install && npm run test:e2e`

---

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
