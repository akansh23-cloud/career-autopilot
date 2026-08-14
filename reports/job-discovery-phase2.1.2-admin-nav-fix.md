# Job Discovery Phase 2.1.2 — Admin Navigation Fix

- Adds a dedicated **Admin → Job Discovery** navigation item.
- Adds the `jobdiscoveryadmin` routed view backed by the existing canonical `AdminJobIngestPanel`.
- Keeps admin authorization enforced by server-side admin endpoints.
- Removes the ingestion panel from User Directory to avoid hiding operational controls in an unrelated screen.
- Adds `#/admin/job-discovery` deep-link support.
- Existing ingestion, company registry, pagination, queue, cron and Resume OS logic are unchanged.
