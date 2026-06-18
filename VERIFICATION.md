# Verification

## Fixes in this package
- Added a visible **Pending verification requests** panel at the top of Admin → User Directory.
- Admin can now approve/reject recruiter or placement-cell requests directly from that panel even when the directory table is empty.
- Fixed Admin User Directory frontend mapping: backend returns paginated `items`; the UI now renders `items`/`users` correctly.
- Added persisted verification fields to admin user DTOs so the detail drawer shows current `accountType`, `roleVerified`, `verificationStatus`, `organizationId`, and `collegeId`.
- Cleaned desktop top navigation: role-prioritized top items stay visible and overflow modules move into **More**, preventing the nav from crowding the Full Access/search/avatar controls.

## Admin approval flow
1. Login as admin.
2. Open **Admin → User Directory**.
3. Use **Pending verification requests**.
4. Click **Approve** or **Reject**.
5. For manual changes, open a user and use **Role & verification** in the detail drawer.

## Verification commands run
- `npm ci --ignore-scripts` — PASS
- `npm run build` — PASS
- `npm run lint` — PASS, 0 errors, existing warnings only
- `npm test` — PASS, 423/423

## Packaging
- Excluded `node_modules`, `dist`, `.git`, `.data`, logs, caches, and `.env` files.
