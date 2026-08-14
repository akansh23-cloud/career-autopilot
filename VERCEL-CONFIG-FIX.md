# Vercel configuration fix

Removed the `functions` property from `vercel.json` because this project still uses the legacy `builds` property. Vercel rejects configurations containing both `builds` and `functions`.

The existing static Vite + Node server build mapping, routes, and Job Discovery cron schedules remain unchanged.
