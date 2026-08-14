# Third-Party Notices

## Libraries used by Resume OS

| Library | License | Use |
|---|---|---|
| jszip | MIT | Packaging real OOXML (.docx) archives and reading Template OS `.zip` template packages server-side |
| pdfjs-dist (Mozilla) | Apache-2.0 | Deterministic PDF text extraction for import, real PDF export validation, and Template OS PDF text-layer certification (lazy-loaded in the browser, legacy build under Node) |
| mammoth | BSD-2-Clause | Deterministic DOCX text extraction for import (lazy-loaded client-side) |
| jspdf | MIT | Client-side PDF generation |
| html2canvas | MIT | Rasterization support for PDF export |

All are used as unmodified npm dependencies under their respective licenses.

The Template OS vector PDF writer (`web/src/lib/templateOs/pdfWriter.js`) is original Career Autopilot code with no third-party dependency. It uses the PDF base-14 standard fonts (Helvetica, Times) by reference only — no font files are embedded or redistributed; their metric tables are published in the PDF specification.

## Resume templates

All 28 shipped resume templates are **original Career Autopilot designs** (`licenseStatus: INTERNAL_ORIGINAL`, `productionEnabled: true`). No third-party template designs are reproduced.

The template platform supports externally sourced designs via license metadata (`OWNED`, `OPEN_SOURCE`, `LICENSED`, `LICENSE_PENDING`, `DEVELOPMENT_REFERENCE`). Any template whose production rights are not yet cleared must ship with `licenseStatus: LICENSE_PENDING` (or `DEVELOPMENT_REFERENCE`) and `productionEnabled: false` — such templates are excluded from the gallery and the recommender until the status is flipped in configuration. General resume layout conventions (single-column ATS structure, section ordering, typographic hierarchy) are not subject to design licensing.

## Job Discovery company seed data

Career Autopilot includes an internally curated starter catalog of direct employer career-entry URLs. To expand that persisted CompanyRegistry to 1,000+ companies on an operator/cron request, Job Discovery can import company/ATS seed metadata at runtime from **Outscal/OpenJobs** (`outscal/OpenJobs`, `data/companies_v2.json`). OpenJobs is published under the MIT license and states that its company dataset contains public ATS/career links. The external dataset itself is **not bundled or redistributed in this package**; only normalized company seed records selected at runtime are persisted into the application's own database. External seed rows are marked `SEEDED_UNVERIFIED` until Career Autopilot's normal discovery/verification pipeline validates them.

Upstream ATS/career links can become stale when an employer changes recruiting systems. Seed presence therefore does not mean a job or career URL has been verified recently, and all automated fetching remains subject to Career Autopilot's robots/access, SSRF and rate-control policies.
