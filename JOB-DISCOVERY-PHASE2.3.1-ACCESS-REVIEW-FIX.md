# Job Discovery OS — Phase 2.3.1 Access Review Fix

This patch closes the operator gap exposed by manual career-site fetching: a generic source could be placed in `REVIEW` when its robots policy could not be established, while the UI told the administrator to “Approve the source first” without providing any approval action.

## What changed

- Added an admin-only source access endpoint: `POST /api/admin/job-discovery/sources/:sourceId/access`.
- Added `Approve & retry` directly on manual fetch results that are blocked in `ACCESS / REVIEW`.
- Stores a durable `accessApproval` audit record with approver, time, reason and robots state at approval.
- Generic career-site crawling now honors explicit admin approval only when live robots policy remains indeterminate (`REVIEW`).
- An explicit robots `DENY` always wins and cannot be manually overridden.
- Source health output now includes `robotsPolicy` and `accessApproval` for operator visibility.
- Approval immediately retries the selected source and refreshes job inventory, company inventory and run receipts.

## Verification

`node --test --test-concurrency=1 test/jobDiscovery*.test.js`

Result: **228 passed, 0 failed**.

Two additional regression tests cover:

1. A `REVIEW` source whose robots endpoint is unavailable can be explicitly approved and successfully retried.
2. A source with explicit robots `DENY` cannot be approved.
