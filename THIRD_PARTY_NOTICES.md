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

## Job Discovery company-catalog expansion

Career Autopilot can optionally extend its bundled direct-employer seed catalog from the public **Outscal/OpenJobs** `data/companies_v2.json` dataset at runtime. The OpenJobs repository is MIT licensed and describes the company/ATS dataset as a point-in-time source whose ATS links may become stale. Career Autopilot treats imported rows as `SEEDED_UNVERIFIED`; its own source-discovery, access-policy, and verification layers remain authoritative before jobs are trusted or reconciled.

The OpenJobs dataset itself is not bundled wholesale in this distribution; only Career Autopilot's curated direct-employer seed file ships locally. Runtime expansion is optional and failure-tolerant.
