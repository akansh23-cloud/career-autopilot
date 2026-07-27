# Cleanup pass — investor demo readiness

## Removed (dead code, 132 KB)

Seven files with **zero import statements anywhere** in the app or tests:

| File | Size | Why it was dead |
| --- | --- | --- |
| `web/src/views/CareerIntelligence.jsx` | 29.8 KB | Superseded; only its own API client referenced it |
| `web/src/components/project/Recommendations.jsx` | 17.5 KB | Replaced by the Project Creator flow |
| `web/src/views/PatentEngine.jsx` | 15.5 KB | Superseded by `views/patent/*` |
| `web/src/views/ResumeTemplateLab.jsx` | 11.0 KB | Superseded by `ResumeTemplates.jsx` |
| `web/src/views/Profile.jsx` | 8.7 KB | Superseded by `CareerProfile.jsx` |
| `web/src/components/architecture/ArchitectureDiagram.jsx` | 1.3 KB | Duplicate name — every caller imports the one in `proof/ProofViews.jsx` |
| `web/src/lib/careerIntelligence.js` | 1.0 KB | API client for the deleted view |

Verified after deletion: no broken relative imports, all 154 frontend files
parse, no test references any deleted path.

## Fixed

- **Command palette was never mounted.** `CommandPalette.jsx` existed, was
  RBAC-filtered and complete, but nothing rendered it and nothing bound the
  shortcut — ⌘K/Ctrl-K did nothing. Now mounted in `App.jsx` with the hotkey
  bound. Fast navigation demos well and no longer depends on the top nav.
- **"Legacy Generator" in the top navigation** → renamed "Generate Ideas".
  The screen is live (two empty-state CTAs route to it); only the label was
  wrong, and shipping the word "Legacy" in a nav reads badly in a demo.
- **`.data/verifications.json`** — RBAC test residue that shipped in the
  archive. Deleted; `.data/` is gitignored.

## Root directory: 22 files → 8

Everything a reviewer sees first is now current and load-bearing:

```
README.md  SECURITY.md  package.json  vercel.json
server.js  db.js  <config files>  docs/  server/  web/  test/  e2e/
```

- `docs/` — ENVIRONMENT, DEPLOYMENT, TESTING, AI_COST_SETUP, GO_LIVE_RUNBOOK,
  DPDP_DATA_HANDLING, plus a `docs/README.md` index
- `docs/legal/` — privacy, terms, refund
- `docs/internal/` — 13 build notes, changelogs and upgrade write-ups
  (historical record, not current documentation)

`SECURITY.md` deliberately stays at the root where scanners expect it.
Nothing in code loaded any moved file from disk; README and one
user-facing string were updated to the new paths.

## Not done — needs a product decision, not a refactor

**Surface count.** The nav carries 32 destinations. Seven of them are project
surfaces (Project OS, Project Creator, Marketplace, Live Inspirations,
Architecture Generator, Sandbox, Find Partner) and six are patent surfaces.
Each works, so none can be deleted safely — but an investor being walked
through thirteen overlapping entry points will read breadth as indecision
rather than depth. The consolidation worth considering before a demo:

- Project surfaces → one **Project OS** with internal tabs
- Patent surfaces → **Innovation OS** (discover) + **Patent OS** (work an idea)

That is a routing change, not a deletion: keep every view, change how many
doors lead to them. Roughly a day of work and it halves the perceived surface
area.

**File sizes.** `server.js` is 305 KB / 163 routes and `db.js` is 240 KB. Fine
in a demo, awkward in technical diligence. The `server/routes/` and
`server/services/` split already established is the pattern to continue.

**Dependency placement.** `jspdf`, `html2canvas`, `pdfjs-dist` and `mammoth`
are in `dependencies` but used only in `web/src`. They belong in
`devDependencies` alongside React.
