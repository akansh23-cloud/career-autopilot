# Phase 2.3.2 — robots.txt 404 fix

## Fixed
- `/robots.txt` HTTP 404/410 is treated as an unavailable policy file instead of a crawl-policy REVIEW failure.
- Explicit robots `Disallow` remains DENY and cannot be overridden.
- Network, 5xx, authentication, and rate-limit robots failures remain conservative REVIEW states.
- Admin “Approve & retry” retries the original human-readable target URL when available rather than displaying only `src_...`.
- Added regression tests for 404/410 robots behavior and end-to-end manual ingestion.
