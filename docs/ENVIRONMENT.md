# Environment Variables — Career Autopilot

`[REQUIRED IN PROD]` values cause the server to refuse to start in production if
missing. Everything else degrades gracefully. Full template: `.env.example`.

## Core
| Var | Required | Purpose |
|---|---|---|
| `NODE_ENV` | recommended | `production` enables fail-fast + secure cookies + HSTS. |
| `PORT` | no | Listen port (default 3000). |
| `SESSION_SECRET` | **prod** | Signs sessions + the `ca_user` identity cookie. >= 32 random chars. |
| `MONGODB_URI` | **prod** | MongoDB connection. Without it in prod the server won't start. |

## Origins / cookies
| Var | Purpose |
|---|---|
| `FRONTEND_ORIGIN` | Allowed browser origin for credentialed CORS (split-origin deploys). |
| `ALLOWED_ORIGINS` | Extra comma-separated allowed origins. |
| `COOKIE_CROSS_SITE` | `1` for SameSite=None;Secure (different frontend/backend domains, HTTPS). |
| `COOKIE_SAMESITE` / `COOKIE_SECURE` | Manual overrides (auto-derived otherwise). |
| `DISABLE_CSP` | `1` to disable the strict Content-Security-Policy. |

## AI / payments / auth
| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Non-resume AI features that still use the generic AI proxy (for example outreach/support where configured). |
| `ADMIN_EMAILS` | Comma-separated admin full-access emails (server-resolved). |
| `ALLOW_DEV_LOGIN` | `1`/`0` to force the demo login. Keep off in prod. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Google OAuth. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | Payments. |

## Resume Narrative Intelligence (optional)
All optional. With none of these set the narrative layer runs fully
deterministically: no AI calls, no network access.
| Var | Default | Purpose |
|---|---|---|
| `RESUME_NARRATIVE_AI` | `1` | `0` disables the AI layer for resume narrative generation only. |
| `RESUME_NARRATIVE_MODEL` | `AI_MODEL` / `claude-sonnet-4-6` | Strong-tier model (final synthesis, hard reranks). |
| `RESUME_NARRATIVE_SMALL_MODEL` | `claude-haiku-4-5-20251001` | Cheap-tier model (classification, extraction). |
| `RESUME_RESEARCH_ENABLED` | `0` | Must be `1` before any external company/role research is possible. |
| `RESUME_RESEARCH_ENDPOINT` | — | Vendor-neutral search endpoint (JSON). |
| `RESUME_RESEARCH_API_KEY` | falls back to `SERPAPI_KEY` | Search credential. |
| `RESUME_RESEARCH_PROVIDER` | `http` | Provider label reported in telemetry. |
| `RESUME_RESEARCH_QUERY_PARAM` | `q` | Query parameter name. |
| `RESUME_RESEARCH_RESULTS_PATH` | `organic_results` | Dotted path to the results array. |
| `RESUME_RESEARCH_HEADER` | — | Header name for the API key (preferred over the query string). |
| `RESUME_RESEARCH_TIMEOUT_MS` | `8000` | Per-search timeout. |

All research fetches go through the existing SSRF-safe fetcher
(`server/utils/workspace/ssrfGuard.js`) with a 512 KB response cap and a
content-type allow-list. External research can influence vocabulary only — it
can never become a candidate claim. See
`docs/RESUME-NARRATIVE-INTELLIGENCE.md`.


## Resume PDF rendering
Resume OS now has one server-owned render pipeline. The ATS vector writer is the
normal default; HTML/CSS rendering is selected automatically when meaningful
non-Latin glyphs must be preserved.

| Var | Default | Purpose |
|---|---|---|
| `RESUME_RENDER_PROVIDER` | `auto` | `auto`, `vector`, `chromium`, or `weasyprint`. `auto` prefers vector for compatible Latin content and an HTML renderer for Unicode. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Playwright-managed Chromium | Optional explicit Chromium executable for the Playwright provider. |
| `CHROMIUM_EXECUTABLE_PATH` | common system paths | Alias used by the Chromium provider. |
| `CHROMIUM_CLI_FALLBACK` | `0` | `1` enables direct Chrome `--print-to-pdf` only as an operational fallback when Playwright is unavailable. |
| `CHROMIUM_NO_SANDBOX` | auto for root | Force Chromium `--no-sandbox`; avoid unless required by the container runtime. |
| `WEASYPRINT_EXECUTABLE_PATH` | common system paths | Optional fail-safe HTML/CSS Unicode renderer when Chromium is unavailable. |

Production recommendation: install the normal Node dependencies so Playwright
is available, and provide a Chromium binary in the runtime/container. The
renderer never silently sends Unicode-heavy resumes through the Base-14 vector
writer; if no Unicode-capable provider exists, export fails explicitly instead
of dropping glyphs.

## Jobs / contacts (optional)
| Var | Purpose |
|---|---|
| `RAPIDAPI_KEY` / `RAPIDAPI_HOST` | JSearch job discovery. |
| `SERPAPI_KEY` | Opportunity/job discovery fallback. |
| `JOB_FETCH_TIMEOUT` / `JOB_VERIFY_TIMEOUT` / `JOB_SEARCH_BUDGET` / `JOB_CACHE_TTL_MS` | Job perf tuning (ms). |
| `STRICT_JOB_VERIFICATION` | `1` to require a known posted date. |
| `HUNTER_API_KEY` / `APOLLO_API_KEY` / `PDL_API_KEY` | Verified contact providers. |
| `LINKEDIN_*` / `INDEED_*` | Optional connector OAuth. |

## Rate limits (optional overrides)
`RATE_AI_PER_HOUR`, `RATE_JOBS_PER_HOUR`, `RATE_CONTACTS_PER_HOUR`,
`RATE_TICKETS_PER_HOUR`, `RATE_GENERATION_PER_HOUR`, `RATE_GLOBAL_PER_MIN`.

## Validation behavior
On startup the server logs warnings for missing optional services and, in
production, **exits** on missing `SESSION_SECRET` / `MONGODB_URI`. See `config.js`.

## Demo mode (recording / pitching without a database)

| Var | Meaning |
| --- | --- |
| `DEMO_MODE` | `1` to serve the in-memory 50-student demo cohort when **no** `MONGODB_URI` is set. |

`DEMO_MODE` is gated on two conditions at once: the flag must be on **and**
there must be no database connected. With a real `MONGODB_URI` present the flag
does nothing, so demo records can never mix with, mask, or overwrite live data.

The read-only cohort (students, readiness, skills) is generated per request and
never stored. The **writable** placement features behave differently: creating a
drive, recording an outcome, or loading the command center writes to a
per-process in-memory store, seeded from the demo world on first write. Nothing
touches disk or a database, and everything is discarded when the process exits.

Two consequences worth knowing:

- **Never enable `DEMO_MODE` on Vercel or any serverless host.** Each invocation
  gets a fresh container, so a drive created during a demo disappears on the very
  next request. Demo mode is for a local machine or a single long-running server
  only. `npm run preflight` fails the build if it detects this combination.
- Restarting the process resets the demo world to its deterministic initial
  state — which is what you want between recording takes.

Never set `DEMO_MODE=1` in production. See `docs/DEMO_RECORDING.md` for the
full walkthrough.

## AI model override

| Var | Meaning |
| --- | --- |
| `AI_MODEL` / `ANTHROPIC_MODEL` | Optional. Overrides the server's default model. Leave unset unless you have a reason. |

`resolveAiModel()` validates the value against `/^claude-[a-z0-9.-]+$/` — shape
only. Two failure modes follow from that:

1. A non-Claude id (`gemini-2.0-flash`) fails the pattern and is **silently
   discarded**; the Claude default is used instead. Switching providers is what
   `AI_PROVIDER` is for.
2. The id is never checked against the provider, so a **retired** model passes
   validation here and returns 404 at request time. In the app this appears as
   "tailoring is temporarily unavailable" with no further detail.

`npm run preflight` reports both cases. If AI features break after a deploy,
check this variable first.


### Playwright browser installation

`playwright` is a production dependency, but the Chromium browser binary must be installed in the deployment image. Recommended container/build step:

```bash
npx playwright install --with-deps chromium
```

If your image manages Chromium separately, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` or `CHROMIUM_EXECUTABLE_PATH`.
