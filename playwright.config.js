import { defineConfig } from '@playwright/test';

/* Playwright smoke config. Requires browsers: `npx playwright install`.
   Boots the app with demo login enabled and runs the SPA core flows. */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000',
    headless: true,
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run build && ALLOW_DEV_LOGIN=1 SESSION_SECRET=e2e-secret-please-ignore node server.js',
        url: 'http://127.0.0.1:3000/health',
        timeout: 120_000,
        reuseExistingServer: true,
      },
});
