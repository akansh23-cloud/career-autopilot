# Admin Job Discovery Navigation Fix

The Job Discovery operator UI previously rendered inside the Admin User Directory, making the feature difficult to discover and leaving no dedicated Admin navigation entry.

## Changes

- Added `jobdiscoveryadmin` as an admin-only screen.
- Added **Admin → Job Discovery** to the main sidebar/navigation.
- Added `web/src/views/AdminJobDiscovery.jsx` as the dedicated operator dashboard wrapper.
- Wired the view into `App.jsx`.
- Added `#/admin/job-discovery` deep-link recognition.
- Removed the ingestion panel from User Directory so the operational dashboard has one clear home.
- Preserved the existing manual fetch, queue processing, 1,000-company registry, stored-job browser, 20-row pagination, cron routes, source policy, dedupe, freshness and Resume OS behavior.

## Deployment

Replace the existing repository contents with this package or copy the changed files, then commit and push the `develop` branch. After Vercel reports READY, hard-refresh the browser. An admin account should see **Job Discovery** under the **ADMIN** sidebar group.
