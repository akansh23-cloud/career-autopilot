# Career Autopilot

## Vercel deployment fix

This version includes `vercel.json`, an explicit `/` route, SPA fallback, and `export default app` so Vercel can serve the frontend instead of showing `Cannot GET /`.

Required Vercel environment variables:
- `SESSION_SECRET`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`
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

## Quick start (recommended — everything from one origin)

```bash
npm install
cp .env.example .env
# edit .env — set ANTHROPIC_API_KEY to enable the AI resume features (job search needs no key)
npm run dev          # or: npm start
```

Open **http://localhost:3000** in your browser.

Because the page is served by the backend, the in-app **Backend URL** auto-fills to the current origin, so verified job search, the AI proxy, and OAuth all work with no extra config.

> Opening `index.html` directly as a `file://` page is supported for a quick look, but the Jobs tab will show the **“Backend required”** warning, because a static page cannot verify job URLs (browser CORS). Run the Node server for verified search.

## What needs which env var

| Feature | Works without config | Needs env var |
|---|---|---|
| Resume parsing (PDF/DOCX/TXT) | ✅ | — |
| Verified job search (Remotive/RemoteOK/Arbeitnow/Jobicy) | ✅ (via backend, no keys) | — |
| Resume analysis, tailoring, match scoring, cover letters, recruiter messages, interview prep | — | `ANTHROPIC_API_KEY` |
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
