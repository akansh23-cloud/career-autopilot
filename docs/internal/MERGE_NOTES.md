# Merge Notes — Project OS v2 + Patent Diagram Fixes

Merged base: Claude `career-autopilot-v2.zip`.
Preserved Project OS v2 enhancements:
- projectIntelligence backend routes and services
- Project Intelligence panels in Project Studio
- gap-driven recommendations in Project Creator/Studio
- project intelligence tests

Re-applied latest stability fixes from `career-autopilot-patent-diagram-generate-fix(1).zip`:
- Patent OS diagram generation hardening
- Mermaid renderer cycle-safety
- architecture parser/generator hardening
- Project Studio Architecture tab crash boundary and safe object/string rendering
- Project Creator Build Blueprint safe rendering for strings/objects/arrays
- ProblemCluster duplicate/skipped generation handling

Validation:
- npm run build: passed
- npm test: 169/169 passed
- npm run lint: 0 errors, warnings remain

Known note:
- npm audit reported 2 critical vulnerabilities during npm ci. Not fixed in this merge.
