# Deployment — Career Autopilot

The app is a single Express server that serves the built Vite SPA from `dist/`
and exposes the API on the same origin. It deploys to Vercel, Render, Railway,
Fly, or any Node host.

## Prerequisites
- Node.js >= 18 (tested on 22).
- A MongoDB database (Atlas works well). **Required in production.**
- A long random `SESSION_SECRET` (`openssl rand -hex 32`).
- Optional: Anthropic, Razorpay, Google OAuth, job/contact provider keys.

## Build & run
```bash
npm install
npm run build        # outputs dist/
NODE_ENV=production npm start
```
In production the server **refuses to start** if `SESSION_SECRET` or
`MONGODB_URI` are missing (fail-fast — no silent no-persistence mode).

## Required production env
See `ENVIRONMENT.md` / `.env.example`. Minimum:
```
NODE_ENV=production
SESSION_SECRET=<32+ random chars>
MONGODB_URI=<mongodb connection string>
FRONTEND_ORIGIN=https://your-domain        # only if SPA is on a different origin
```
Recommended for full functionality: `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `RAZORPAY_*`.

Keep `ALLOW_DEV_LOGIN` **unset/0** for a public launch.

## Vercel
`vercel.json` already ships a dual build: a static build for the SPA (`dist/`)
and `@vercel/node` for `server.js`, routing API prefixes to the function and
SPA-falling-back everything else.

Steps:
1. Import the repo in Vercel.
2. Set the env vars above in Project → Settings → Environment Variables.
3. Add the OAuth callback `https://<your-vercel-domain>/auth/google/callback` to
   Google Cloud Console and set the same value as `GOOGLE_REDIRECT_URI`.
4. Deploy.

**Serverless note:** the current session store is in-memory (see Remaining risks
in `README.md`). Identity survives via the signed `ca_user` cookie, but OAuth
*flow state* lives in the session. For multi-instance / serverless reliability,
back sessions with a shared store (e.g. `connect-mongo`) or move OAuth state to a
signed cookie.

## Render / Railway / Fly
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Set the same env vars. These platforms run a single long-lived process, so the
  in-memory session store is fine for a single instance; use a shared store if
  you scale horizontally.

## Post-deploy smoke checks
```
GET  /health                       -> { ok: true }
GET  /jobs/search (no auth)         -> 401
POST /api/user/state (no CSRF)      -> 403 when authenticated
```
Verify `npm audit` is clean and `Set-Cookie: ca_csrf` + CSP headers are present.
