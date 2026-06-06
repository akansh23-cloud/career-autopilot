# Security Notes — Career Autopilot

This document summarises the production security controls and how to operate them.

## Authentication & identity
- Sign-in is via **Google OAuth** (production) or a guarded **demo/dev login**
  (auto-disabled in production; force with `ALLOW_DEV_LOGIN`).
- Identity is carried by an **HMAC-signed, httpOnly `ca_user` cookie** plus the
  session. The backend **derives the user from the verified cookie/session**
  (`currentUser(req)`), never from a client-supplied `userId`/`email`.
- All sensitive feature routes are behind `requireAuth` and return **401** when
  unauthenticated, **403** for forbidden actions.

## User data isolation
- Every resume, job result, profile, ticket, network item, quota and dashboard
  read is scoped to the authenticated user server-side.
- Client cache keys are **user-scoped** in `localStorage`. The legacy *unscoped*
  fallback (which could leak a previous user's data on a shared browser) has been
  **removed**. On logout or a user change the entire `careerAutopilot.*`
  namespace is cleared (`web/src/lib/userCache.js`).

## Transport & headers
- **Helmet** sets CSP, `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`, COOP/CORP and HSTS (prod). `X-Powered-By` is disabled.
- CSP is tuned for the SPA bundles, blob PDF workers, data: images and Razorpay
  checkout. Disable only via `DISABLE_CSP=1` if a deployment needs extra origins.

## CORS
- Credentialed CORS uses a **strict allowlist** from `FRONTEND_ORIGIN` /
  `ALLOWED_ORIGINS` (plus localhost in dev). Reflected-origin wildcard with
  credentials has been removed. Same-origin deploys need no origins configured.

## CSRF
- **Double-submit cookie**: the server issues a readable `ca_csrf` cookie; the
  SPA echoes it in the `X-CSRF-Token` header on state-changing requests.
- Enforced for **authenticated, cookie-based mutations**. Exemptions: the
  signature-verified Razorpay webhook, and pre-auth bootstrap (`/auth/dev-login`,
  `/auth/logout`). Unauthenticated public POSTs remain validated + rate-limited.

## Rate limiting / abuse protection
Per-user (or per-IP) limits via `express-rate-limit`:
| Class | Default |
|---|---|
| Auth login | 10/min |
| AI generation | 60/hour |
| Job search | 60/hour |
| Contact lookup | 40/hour |
| Support chat | 20/min |
| Support tickets | 5/hour |
| Project/creator generation | 80/hour |
| Global ceiling | 300/min |
All tunable via `RATE_*` env vars. Normal dashboard reads are not throttled.

## Input validation
- `zod` schemas validate bodies for support, user-state, profile, payments,
  contacts, network and AI passthrough routes, plus base64 size/type for template
  image analysis. Malformed/oversized/unknown-key payloads get **400** before any
  handler logic.
- JSON body limit reduced to **2 MB**.

## Payments
- Razorpay order amounts are **server-trusted** (never from the client).
- Checkout signature and webhook signature are verified with **HMAC +
  timing-safe comparison**. Webhook uses the raw request body.

## Error handling & logging
- A centralized error handler returns generic messages in production and
  **never leaks stack traces or secrets**.
- Structured JSON logging (`logger.js`) **redacts** tokens, keys, passwords,
  cookies, signatures, emails and resume/message text.

## Dependencies
- `npm audit` is clean (0 vulnerabilities). `mongoose`, `mammoth` upgraded and
  the vulnerable `tar`/`node-pre-gyp` chain pinned via `overrides`.
- CI gate: `npm run audit:ci` fails on high/critical advisories.

## Reporting
Report suspected vulnerabilities privately to the maintainer; do not open public
issues with exploit details.
