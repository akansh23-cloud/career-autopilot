# Career Autopilot

## Production readiness (v7 hardening)

This release hardens the app for real users. Highlights:

- **Dependencies:** `npm audit` is clean (0 vulnerabilities). Run `npm run audit:ci` as a CI gate.
- **Persistence:** MongoDB is **required in production** — the server fails fast on missing `MONGODB_URI`/`SESSION_SECRET` instead of silently running without persistence. Persistence writes return **503** in production when the DB is unavailable (never a misleading 200).
- **User data isolation:** all data is scoped to the authenticated user server-side; the unscoped `localStorage` fallback that could leak data across users on a shared browser has been removed, and the client cache is cleared on logout / user change.
- **Auth:** identity is derived from a verified signed cookie/session (never a client-supplied id); protected routes return 401/403.
- **Abuse protection:** per-user/IP rate limits on auth, AI, job search, contacts, support, and generation routes.
- **Transport:** Helmet security headers + strict CSP, `X-Powered-By` off, strict credentialed-CORS allowlist, and **CSRF** double-submit protection for cookie-authenticated mutations.
- **Validation & errors:** `zod` body validation, a 2 MB JSON cap, a centralized error handler that never leaks stack traces, and structured logging with secret redaction.
- **Performance:** job search has shorter per-source timeouts, an overall budget, and a short result cache; the frontend bundle is code-split (main chunk ~1.15 MB → ~0.5 MB).
- **Tests:** `npm test` (integration + unit), `npm run lint`, `npm run build`, `npm run typecheck`.

Setup & operations docs live in **`docs/`** (`docs/ENVIRONMENT.md`, `docs/DEPLOYMENT.md`, `docs/TESTING.md`, `docs/AI_COST_SETUP.md`) plus **`SECURITY.md`** at the root. Internal build notes and changelogs are under `docs/internal/`. Start from `.env.example`.

### Quick production start
```bash
npm install
npm run build
NODE_ENV=production \
SESSION_SECRET="$(openssl rand -hex 32)" \
MONGODB_URI="<your-mongodb-uri>" \
FRONTEND_ORIGIN="https://your-domain" \
npm start
```

### Remaining risks (track before public launch)
- **Session store** is Mongo-backed automatically when `MONGODB_URI` is set (`sessionStore.js`), so sessions and OAuth flow state survive restarts and multiple instances. Only the DB-less dev mode falls back to in-memory sessions.
- **Live load test** (k6/Artillery + Playwright at 100/250/500 VUs) against staging with real MongoDB/AI/job/payment credentials is still recommended before onboarding any college above ~500 students. The college observability endpoint is cached per college (60s TTL) to keep dashboards cheap.
- **Heavy parser libs** (mammoth ~500 KB) are already dynamically imported; further route-level lazy-loading can shave first paint on slow mobile networks.

---

## Multi-college tenancy (how multiple colleges coexist safely)

Career Autopilot is multi-tenant by college. The model, end to end:

**The registry.** Every college is a `College` document: canonical `key`, `status` (`pending → active → suspended`), verified email `domains`, a rotatable 8-character `joinCode`, auto-approve settings, and legacy name `aliases`. Colleges register in-app (Settings → My College → "Register your college"), start `pending`, and go live only when a platform admin activates them (`/api/admin/colleges/:key/approve`) — activation also verifies the registrant as that college's `college_admin` (TPO) in one step.

**How students bind (trust order, no self-declared names):**
1. **Roster import** — the TPO uploads the placement-cell CSV (`email,name,branch,batch,rollno`); existing accounts link instantly, everyone else auto-links the moment they sign in with a listed email.
2. **Verified email domains** — sign-ins from a listed domain (subdomains included) auto-bind; public providers (gmail.com etc.) are rejected as college domains so nobody can claim the internet.
3. **Join code** — students enter the code from Settings; joins are auto-approved or held for TPO approval per college settings.
Typing a college name into a profile no longer grants dashboard membership; a bounded legacy-alias scan keeps pre-tenancy pilot data visible while it migrates.

**Sign-in handling with many colleges live:** one account, at most one college binding, resolved at login by `autoBindCollege` (roster match first, then domain match). TPO accounts are role-verified and pinned to their `collegeId`; every `/api/college/*` query filters on that scope server-side (`requireCollegeScope` + tenant filters in `db.js`), so College A can never read College B — enforced in data access, not just UI. The observability dashboard is cached per college (60s TTL, `?fresh=1` to bypass).

**Consent (DPDP).** A blocking, versioned consent screen runs on first sign-in; college visibility is a separate explicit choice, and the placement-cell queries filter on it server-side. Students can export everything (`GET /api/account/export`), leave a college, or delete their account (7-day grace, full cascade). See `docs/legal/PRIVACY_POLICY.md` and `docs/DPDP_DATA_HANDLING.md` (the one-pager to hand colleges).

**Comms.** Nudges and task assignments from the command center are real: in-app delivery is guaranteed (notifications bell), email is attempted when `SMTP_URL` is configured, and the API reports exactly what was delivered — never a fake success.

**Demo.** `POST /api/admin/demo/seed` (or the "Seed demo college" button in Admin) creates *Demo Institute of Technology* — deterministic synthetic students across all funnel stages, join code `DEMO2026` — so sales demos never show an empty dashboard. `docs/GO_LIVE_RUNBOOK.md` has the full launch sequence.

---

## Vercel deployment fix

This version includes `vercel.json`, an explicit `/` route, SPA fallback, and `export default app` so Vercel can serve the frontend instead of showing `Cannot GET /`.

Required Vercel environment variables:
- `SESSION_SECRET`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`
- Optional Resume OS wording polish: `GEMINI_API_KEY` (optional model override: `GEMINI_RESUME_MODEL`)
- `FRONTEND_ORIGIN=https://your-vercel-domain.vercel.app`
- Optional job source keys: `SERPAPI_KEY` and/or `RAPIDAPI_KEY` for LinkedIn/Indeed/Naukri-style coverage; `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `USAJOBS_EMAIL`, `USAJOBS_API_KEY` for additional APIs


An AI job-application studio: upload a resume, analyze it for ATS, find **real, currently-open, URL-verified** jobs, truthfully tailor your resume per job, prep interviews, use the **assisted apply** flow for LinkedIn/Indeed, and track applications — with an **OAuth-ready** backend.


## v3.3 — Resume Template Engine (8 templates + length selector)

The AI now returns **structured resume JSON only**. All page layout is produced by **separate template renderer functions** — so the **selected template controls the actual PDF/DOCX/TXT/LaTeX download**, not the AI.

**8 genuinely distinct templates, grouped by length:**

| Length | Template | Best for |
|---|---|---|
| Single page | **Modern Blue Sidebar** | Left navy sidebar (contact/skills/education) + main column; modern look |
| Single page | **Executive Clean** | Centered, letter-spaced, ruled header, no color — senior/exec |
| Single page | **Jake Tech Compact** | Classic Overleaf "Jake" — ruled sections, grouped skills (LaTeX export) |
| Single page | **ATS Compact Classic** | Plain, left-aligned, no graphics — strictest ATS |
| Multi page | **Modern Professional** | Polished two-tone headings, full experience + projects |
| Multi page | **ATS Detailed** | Plain detailed multi-page, maximum ATS safety |
| Multi page | **Technical Detailed** | Categorised skill blocks up top (monospace), tech tags on projects |
| Multi page | **Project Heavy Detailed** | Projects lead with stack tags — strong-project / fresher profiles |

**Resume length selector — Auto / Single Page / Multi Page**
- **Single Page** guarantees a 1-page fit (low-priority content is trimmed, like the reference resume).
- **Multi Page** paginates cleanly with no overflow.
- **Auto** picks single vs multi from your content volume, then recommends the best-fitting template for your target role, level and profile.

**How it works**
- Open a job's tailored kit → the panel shows the **length control**, **template cards** (best use, ATS estimate, Preview, Select) and **download buttons**.
- **Preview** renders your real tailored content as it will print. **Select** a template, then download **PDF / DOCX / TXT** (and **LaTeX** for Jake Tech Compact). The chosen template decides the output.
- Set **Default resume length** and **Default template** in **Settings**.

**Truthful by design:** renderers only use the structured data extracted from your real resume + JD. Empty sections are omitted — no fabricated skills, companies, metrics, projects or dates.

All existing features are unchanged: verified job search, resume tailoring, assisted apply, OAuth-ready settings, tracker, follow-up reminders, and document downloads.

## What changed in this version (read this)

**Job search is now strict and real-only. AI never invents jobs.**

- ✅ Jobs come **only** from structured, verifiable public sources (Remotive, RemoteOK, Arbeitnow, Jobicy) via the backend.
- ✅ Every job has a real **title, company, direct URL, source, posted date, and location**.
- ✅ Each job **URL is verified server-side** before it is shown.
- ✅ Jobs are **removed** when the URL is broken/expired, the posted date is missing, the date is outside the selected window, or it is a duplicate.
- ✅ **Freshness filters are strict**: `24 hours`, `3 days`, `7 days`.
- ✅ Results are sorted **newest first, then by highest resume-match score**.
- ✅ If nothing passes, you see: **“No verified fresh jobs found. Try widening filters.”**
- ✅ **No AI-generated job fallback exists anywhere.** AI is used only for resume analysis, tailoring, match scoring, cover letters, recruiter messages and interview prep.
- ✅ If the backend is not configured, the Jobs tab shows: **“Backend required for verified job search. Static HTML cannot reliably verify job openings.”** and returns zero jobs (it never shows unverified listings).

### Verification badges shown on each job
| Badge | Meaning |
|---|---|
| **Verified Open** | The job URL was reachable (HTTP 2xx/redirect) at search time. |
| **Open · source-listed** | The structured source lists the job as active and it has a fresh date, but the page could not be crawled (bot-blocked: HTTP 401/403/405/429 or timeout). |
| **Posted today / Posted 1 day ago / Posted N days ago** | Real posted date from the source. |
| _source name_ | Which structured source the job came from. |

### Freshness Audit
Below the results, a **Freshness Audit** table lists every job the sources returned and exactly **why it was kept or rejected** (too old, posted date missing, role/location/mode mismatch, duplicate, dead/expired URL, bot-blocked, etc.), plus per-source fetch status.

## Design principles

- **No passwords.** The tool never asks for LinkedIn/Indeed usernames/passwords. Connection is **OAuth only**, through the official provider screen.
- **Final submit stays manual.** The apply flow opens the posting and prepares your tailored docs; you click the final *Submit* and confirm “I applied”. Official API auto-submit only activates if your backend has provider-approved apply permissions.
- **Truthful tailoring.** The AI reframes and prioritises your real experience. It never invents skills, employers, dates, metrics, or projects.
- **Secrets stay server-side.** Your Anthropic key and OAuth client secrets live in `.env`, not in the frontend.

## Project structure

```
career-autopilot/
├── index.html        # full frontend (single file)
├── server.js         # backend: verified job search + verify + sources + health + AI proxy + OAuth
├── package.json
├── .env.example
└── README.md
```

## Quick start

This app is now a **React + Vite + Tailwind + Framer Motion** frontend served by the existing **Node/Express** backend from a single origin (so Google OAuth + the session cookie work with zero CORS config).

### Development (hot reload)

```bash
npm install
cp .env.example .env
# edit .env — set GOOGLE_CLIENT_ID/SECRET for Google sign-in, ANTHROPIC_API_KEY for AI features
npm run dev
```

`npm run dev` runs both processes together (via `concurrently`):
- **API** — Express on `http://localhost:3000`
- **Web** — Vite dev server on `http://localhost:5173` (proxies `/auth`, `/ai`, `/jobs`, `/contacts`, `/opportunities`, `/profile`, `/apply`, `/health` → the API)

Open **http://localhost:5173** while developing.

### Production / preview

```bash
npm install
npm run build      # Vite builds the React app into dist/
npm start          # Express serves dist/ + the API on http://localhost:3000
```

Open **http://localhost:3000**. The backend automatically serves the built `dist/` app; if `dist/` is missing it falls back to the bundled `legacy_index.html`, so the server never hard-fails.

> No Google keys? A **demo sign-in** is available in dev (`ALLOW_DEV_LOGIN=1`, on by default when Google is off and not in production).


### Resume PDF renderer

Resume Studio PDF downloads are server-owned through `ResumeRenderService`.
`auto` uses the deterministic Template OS vector PDF writer for ATS-first Latin
content and switches to a Unicode-capable HTML renderer when required. The
Playwright/Chromium provider is the preferred high-fidelity HTML path; a
WeasyPrint adapter is available as a fail-safe. Preview and export compile from
the same Template OS definition, including deterministically adapted legacy
templates. Screenshot-only PDF export is no longer the normal Resume Studio
path.

## What needs which env var

| Feature | Works without config | Needs env var |
|---|---|---|
| Resume parsing (PDF/DOCX/TXT) | ✅ | — |
| Verified job search (Remotive/RemoteOK/Arbeitnow/Jobicy) | ✅ (via backend, no keys) | — |
| Resume analysis, deterministic tailoring, fixed quality scoring, Improve Again / Optimize Resume | ✅ | — |
| Optional Resume OS wording polish | deterministic engine remains the default | `GEMINI_API_KEY` (optional `GEMINI_RESUME_MODEL`) |
| Resume PDF rendering | vector ATS renderer works without external API; Unicode needs an HTML renderer | `RESUME_RENDER_PROVIDER` optional; Playwright/Chromium preferred, WeasyPrint supported as fail-safe |
| Cover letters, recruiter messages and other non-resume AI features | — | `ANTHROPIC_API_KEY` where the feature still uses the generic AI proxy |
| Plan upgrades (Razorpay checkout) | shows "gateway not configured" message | `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` |
| Admin full access (bypass all plan limits, no payment) | normal Free/Pro/Premium for everyone | `ADMIN_EMAILS` (comma-separated emails) |
| Connect LinkedIn (OAuth) | — | `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` |
| Connect Indeed (OAuth) | — | Indeed partner approval + `INDEED_*` |

## Backend endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/jobs/search?role=&location=&mode=&freshness=24h\|3d\|7d&limit=&verify=1` | Fetch → normalise → freshness-gate → filter → de-dupe → URL-verify. Returns `{ jobs, sources, audit, verified, freshnessDays, fetchedAt }`. |
| POST | `/jobs/verify` | Verify one or many URLs. Body `{ url }` or `{ jobs: [{ url }] }`. Returns per-URL `{ verified, exists, verifyLevel, status, reason }`. |
| GET | `/jobs/sources` | List the structured sources used (and confirms AI job generation is off). |
| GET | `/health` | Liveness + whether the AI key is set + source list. |
| POST | `/ai/messages` | Anthropic Messages API proxy (key from `.env`). Resume/tailoring/interview only. |
| GET | `/auth/:provider/start` | Begin OAuth (linkedin/indeed). |
| GET | `/auth/:provider/callback` | OAuth redirect handler. |
| GET | `/auth/status` | Connected providers + profile. |
| POST | `/auth/:provider/logout` | Disconnect a provider. |
| POST | `/apply/:provider/submit` | Manual-only by default (202); add approved API logic here. |
| GET | `/api/admin/users` | **Admin only.** Paginated User Directory / Talent Intelligence. Query: `q, skill, speciality, targetRole, experienceLevel, location, userType, minCompletion, projectStatus, recruiterVisible, activity, sort, page, pageSize`. Returns `{ ok, users:[safeDTO], total, page, pageSize, totalPages, stats }`. |
| GET | `/api/admin/users/:id` | **Admin only.** Detailed safe view: profile DTO + grouped skills + safe project list + job stats + recent activity. |
| PATCH | `/api/admin/users/:id/visibility` | **Admin only.** Body `{ recruiterVisible }`. Toggles the user's recruiter opt-in (`NetworkProfile.openToRecruiters`). |
| PATCH | `/api/admin/users/:id/admin-notes` | **Admin only.** Body `{ adminNotes }`. Internal admin-only note (≤4000 chars). |
| PATCH | `/api/admin/users/:id/featured` | **Admin only.** Body `{ featuredTalent }`. Marks/unmarks featured talent. |

### Admin User Directory / Talent Intelligence

A dedicated admin-only screen (sidebar → **Admin → User Directory**, deep-link `#/admin/users`) listing every account with XP, speciality, skills, target role, completed projects, profile completion, visibility status, account type and last-active date. Supports search, multi-field filtering (incl. by skill — DevOps, Kubernetes, React, Java, AI/ML, Cloud…), sorting and pagination, plus a per-user detail drawer.

- **Authorization is server-side only.** Every `/api/admin/*` route runs `requireAuth` then `requireAdmin`; admin status is resolved from `ADMIN_EMAILS` or a persisted `User.role === 'admin'` — the client role is never trusted. Unauthenticated → `401`, authenticated non-admin (including recruiters) → `403`. The sidebar item and command-palette entry are hidden for non-admins, and the page itself renders **Access Denied** if opened directly.
- **No data leakage.** Responses are mapped through `adminUserDTO()`, which only ever emits safe fields — never `googleId`, OAuth/access/refresh tokens, sessions, passwords, raw resume files or API keys. Adding a field to a schema does not auto-expose it.
- **Privacy-first recruiter visibility.** Recruiter visibility reuses the existing `NetworkProfile.openToRecruiters` opt-in (default **private**). The future recruiter-facing Talent Directory should consume `/api/network/candidates`, which only returns opted-in profiles — recruiters never get the admin directory.
- **Scaling note.** `adminListUsers` hydrates up to `ADMIN_DIRECTORY_FETCH_CAP` (2000) user docs, then filters/sorts/paginates in memory (skill data lives in a Mixed `metrics` field, so an in-memory pass is simplest and the filter/sort/paginate logic is pure + unit-tested). Past that size, move to an indexed aggregation pipeline.

### Example: verify a URL
```bash
curl -s -X POST http://localhost:3000/jobs/verify \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://remotive.com/remote-jobs/some-listing"}'
```

### Example: search
```bash
curl -s "http://localhost:3000/jobs/search?role=devops%20engineer&freshness=3d&limit=12"
```

## Why a backend (instead of opening the file directly)

- **Verified jobs:** public job APIs don’t send browser CORS headers, and a static page cannot reliably HEAD/GET-check whether a posting URL is still live. The backend fetches sources server-side, returns jobs with real posted dates, removes expired/dead/duplicate links, and verifies each URL. The frontend then displays only what the backend verified — and shows the audit.
- **AI key safety:** `/ai/messages` attaches your Anthropic key on the server, so it never ships to the browser.

## Verification policy (how URLs are judged)

- **HTTP 2xx / clean redirect** → `Verified Open`.
- **HTTP 404 / 410 / 451**, or a final URL containing `expired/closed/not-found` → **removed** (broken/expired).
- **HTTP 401 / 403 / 405 / 429 / timeout** → kept as **`Open · source-listed`** (the page is bot-blocked and cannot be crawled, but the structured source returned it as an active listing with a fresh date). Always confirm the posting before applying.

## Production notes

- Set `NODE_ENV=production`, a strong `SESSION_SECRET`, and your real `FRONTEND_ORIGIN`.
- Put the server behind HTTPS (session cookie is `secure` in production).
- Register your real OAuth redirect URIs in the LinkedIn / Indeed consoles.

## Kept features (unchanged)

Resume upload & parsing (PDF/DOCX/TXT), AI resume analysis & ATS score, truthful resume tailoring (Jake’s template + LaTeX), PDF/DOCX/TXT download, LinkedIn/Indeed assisted apply, OAuth-ready settings, application tracker with status, follow-up reminders, and the skill-gap growth plan.


## v3.2 enhancements

### Resume page mode
The tailored resume modal now lets the user choose:

- **Single page - compact professional**: screenshot-inspired one-page PDF with a compact left/right layout. It trims overflow safely instead of letting text run past page boundaries.
- **Multi page - full detail**: clean ATS-safe PDF that wraps bullets and sections across pages without clipping or continuous-line overflow.

A default page mode can be set in Settings.

### Expanded verified job sources
Structured sources now include public sources such as Remotive, RemoteOK, Arbeitnow, Jobicy, and The Muse. Optional sources can be enabled with keys:

- `ADZUNA_APP_ID` / `ADZUNA_APP_KEY`
- `RAPIDAPI_KEY` for JSearch

Job search still does not use AI-generated openings. In strict mode, blocked, timed-out, or unreachable job pages are excluded instead of shown.

### Multi-source job search

The job engine now uses a provider-based backend pipeline. Public fallback APIs remain available without keys, but major boards such as LinkedIn, Indeed, Naukri, Foundit/Monster, Wellfound, Instahyre, Cutshort, Hirist, Shine and TimesJobs are enabled through SerpAPI/JSearch-style search-provider APIs. This avoids brittle server-side scraping and stays compatible with Vercel.

Recommended for India coverage:

```env
SERPAPI_KEY=your-serpapi-key
RAPIDAPI_KEY=your-rapidapi-jsearch-key
DEFAULT_JOB_LOCATION=India
ADZUNA_COUNTRY=in
```

The UI shows active/inactive sources, fetched count per source, source filters, and a warning when only one or two sources return results.


## Job source provider notes

LinkedIn, Indeed, Naukri, Foundit, Instahyre, Cutshort, Hirist, Shine and TimesJobs are queried through compliant search providers such as RapidAPI JSearch or SerpAPI. They are not scraped directly from Vercel.

For RapidAPI JSearch, set:

```env
RAPIDAPI_KEY=your_rapidapi_key
RAPIDAPI_HOST=jsearch.p.rapidapi.com
DEFAULT_JOB_LOCATION=India
JSEARCH_COUNTRY=in
```

After adding the key in Vercel, redeploy. Also make sure the RapidAPI app is subscribed to the JSearch API plan; otherwise the diagnostics endpoint will show a 401/403/subscription error.

Use `/jobs/diagnostics?role=DevOps%20Engineer&location=India` to confirm whether JSearch is reachable without exposing the key.

## v3.7 RapidAPI/JSearch rate-limit fix

This build fixes the `JSearch: failed 429 Too Many Requests` issue by making only **one** JSearch call per job search instead of firing many parallel board-specific calls for LinkedIn, Indeed, Naukri, Foundit, Instahyre, Cutshort, Hirist, Shine, TimesJobs, and Wellfound. Those boards are now treated as provider-backed sources from the same JSearch response and are inferred from the returned publisher/apply URL.

Recommended env variables:

```env
RAPIDAPI_KEY=your_rapidapi_key
RAPIDAPI_HOST=jsearch.p.rapidapi.com
DEFAULT_JOB_LOCATION=India
JSEARCH_COUNTRY=in
JSEARCH_NUM_PAGES=1
JSEARCH_CACHE_TTL_MS=600000
STRICT_JOB_VERIFICATION=0
```

If `429 Too Many Requests` still appears after this build, the RapidAPI plan/quota is rate-limited or exhausted. Wait for the rate window to reset or upgrade the JSearch subscription.


## Recruiter Contact + Referral API setup

The Outreach module uses compliant provider APIs only. It does not scrape LinkedIn, use browser automation, cookies, CAPTCHA bypassing, or private APIs.

Add these in Vercel → Project → Settings → Environment Variables, then redeploy:

```env
HUNTER_API_KEY=your_hunter_key
PDL_API_KEY=your_people_data_labs_key
SERPAPI_KEY=your_serpapi_key_optional
```

Supported aliases are also accepted by the backend:

```env
HUNTERIO_API_KEY=your_hunter_key
HUNTER_KEY=your_hunter_key
PEOPLE_DATA_LABS_API_KEY=your_pdl_key
PEOPLEDATALABS_API_KEY=your_pdl_key
```

Use Hunter.io mainly for recruiter/HR email discovery by company domain. Use People Data Labs mainly for referral/current-employee style lookup by company and role. SerpAPI is optional and is used only to return safe public search-result links; it does not scrape profile pages.

After deploy, test provider detection with:

```text
/contacts/providers
```

Test live provider calls with a company/domain:

```text
/contacts/diagnostics?company=Google&domain=google.com&title=DevOps%20Engineer
```

On a job card, use **Find Hiring Contact** for recruiter/HR contacts and **Find Referral** for possible employee/referral candidates. If the company domain is missing, enter it manually in the contact modal for better Hunter.io results.

---

## Opportunity Arena

A discovery module at **`/opportunities`** (navbar: **Opportunity Arena**) for hackathons, hiring challenges, coding/case competitions, innovation and internship programs that can lead to jobs, internships, referrals, networking, portfolio projects or prize money.

**Compliant by design** — public APIs (Codeforces, Devpost), optional SerpAPI public search-result links, curated fallbacks and safe public search links only. No scraping, no CAPTCHA bypass, no login/cookie/session scraping, no browser automation.

Works fully without any keys. Set `SERPAPI_KEY` to additionally surface safe public Google search-result links:

```env
SERPAPI_KEY=            # Optional. Returns safe public search-result links only.
```

Backend endpoints:

```text
GET  /opportunities/providers
GET  /opportunities/search?keyword=&category=&type=&location=&mode=&skills=&hiringOnly=&internshipOnly=
GET  /opportunities/details/:id
POST /opportunities/prep-plan
POST /opportunities/convert-to-resume
```

Integrated with the resume editor, tracker (statuses incl. Saved → Registered → Submitted → Shortlisted/Winner → Converted to Resume Project), contact/referral/outreach tools and the dashboard (upcoming deadlines, best-fit, hiring challenges, saved). Includes per-opportunity fit score, prep-plan generator, hackathon-to-resume converter, a local Team Finder MVP, deadline reminders and free/pro/premium usage limits. State persists in `localStorage` (`careerAutopilot_opportunities`, `careerAutopilot_savedOpportunities`, `careerAutopilot_opportunityTracker`, `careerAutopilot_teamFinder`, `careerAutopilot_opportunityPrepPlans`, `careerAutopilot_opportunityResumeProjects`).


### Production Chromium for Resume PDFs

The canonical ResumeRenderService uses the vector PDF provider for ATS-first Latin resumes and prefers Playwright/Chromium when Unicode or HTML fidelity requires it. After installing Node dependencies in a production image, install the Playwright Chromium browser explicitly:

```bash
npx playwright install --with-deps chromium
```

Alternatively provide `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` / `CHROMIUM_EXECUTABLE_PATH`. WeasyPrint remains an optional fail-safe Unicode HTML provider rather than the preferred production renderer.
