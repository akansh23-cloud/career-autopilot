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
| `ANTHROPIC_API_KEY` | Resume analysis, tailoring, vision, grounded support. |
| `ADMIN_EMAILS` | Comma-separated admin full-access emails (server-resolved). |
| `ALLOW_DEV_LOGIN` | `1`/`0` to force the demo login. Keep off in prod. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Google OAuth. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | Payments. |

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
The cohort is generated per request and never written anywhere.

Never set `DEMO_MODE=1` in production. See `docs/DEMO_RECORDING.md` for the
full walkthrough.
