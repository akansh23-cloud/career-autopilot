# Job Discovery OS — Phase 2.2 Inventory & Production Gap Hardening

This patch rebases the uploaded Phase 2 Scale branch onto the production fixes proven in Phase 2.1.3, without replacing the frozen Resume OS.

## Restored production fixes
- Vercel `builds`/`functions` conflict removed; four CRON_SECRET-protected Job Discovery cron phases retained.
- Dedicated Admin → Job Discovery navigation screen.
- Mongo-safe idempotent company seed upserts.
- Searchable/persisted company career registry, 20 companies per page.
- Canonical job browser and user Jobs results fixed at 20 per page.
- Serverless execution deadline + durable continuation; no artificial admin target/page count ceiling.
- Muse API key wiring.
- Duplicate Job Discovery Mongo indexes removed.

## New in Phase 2.2
The admin Job Discovery dashboard now shows an exact database-backed **Jobs currently available** number. It counts canonical jobs whose status is NEW, ACTIVE, or LIKELY_ACTIVE. STALE and REMOVED records remain in the canonical corpus for provenance but are explicitly excluded from the available count. The count refreshes on page load and after fetch/queue operations.
