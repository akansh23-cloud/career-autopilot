# Testing — Career Autopilot

## Commands
```bash
npm test          # backend integration + unit tests (node:test)
npm run lint      # ESLint (flat config) — 0 errors required
npm run typecheck # no TypeScript in this project (no-op)
npm run build     # production Vite build
npm run audit:ci  # fails on high/critical npm advisories
npm run test:e2e  # Playwright smoke flows (requires browsers installed)
```

## What `npm test` covers
The suite boots the **real Express app** on an ephemeral port (no mocks) with a
cookie-jar client that mirrors a browser (stores cookies, echoes the CSRF token).

`test/api.test.js`
- Public health endpoint + SPA root.
- **Unauthorized access** → 401 on protected routes.
- Unknown `/api/*` route → JSON 404 (never the SPA HTML).
- Dev login + `/auth/me` session reflection.
- **CSRF**: authenticated mutation without token → 403; with token → passes.
- **Input validation**: malformed ticket → 400; valid ticket → 200; empty chat
  → 400; unknown user-state keys → 400.
- **User isolation**: two concurrent users keep distinct identities; logout clears.
- **Job freshness**: `/jobs/search?freshness=3d` returns the correct window and a
  valid structured shape.
- **Concurrency**: 100 concurrent authenticated requests, 0 failures.

`test/support.test.js`
- Regression for report finding **F2**: "payment not working" routes to the
  billing FAQ (not Google login); gibberish is never answered confidently.

`test/config.test.js`
- Env validation reports a missing `MONGODB_URI` as a warning in non-prod.

## Test environment
`npm test` sets `NODE_ENV=test ALLOW_DEV_LOGIN=1` and short job timeouts so the
run is deterministic and fast (rate limiters are skipped in `test`). The app is
imported (auto-listen is skipped in the test env) and each test binds its own port.

## Notes / what is NOT covered automatically
- A real MongoDB is not started; persistence writes return the dev "local-only"
  shape (`db:false`). To test true persistence/isolation across devices, run the
  suite with a real `MONGODB_URI` pointing at a disposable test database.
- The job-search test runs with `verify=0` and short timeouts; with no provider
  keys it asserts shape/freshness rather than live listings.
- E2E (`npm run test:e2e`) needs `npx playwright install` first and a running app.
- Real load testing (k6/Artillery + Playwright at 100/250/500 VUs) against
  staging with live integrations is recommended before a public launch.
