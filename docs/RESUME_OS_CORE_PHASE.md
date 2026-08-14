# Resume OS core architecture — completion before final rendering

This phase makes Career Autopilot's hardened deterministic resume engine the
single product-wide content authority. It intentionally does **not** implement
the final Playwright/Gotenberg rendering layer.

## Runtime path

```
UI / compatibility API
        ↓
Resume OS application service
        ↓
Canonical ResumeTailoringService
        ↓
Narrative Intelligence
        ↓
Truth firewall
        ↓
ResumeDocument
        ↓
Fixed global quality + optimization history
        ↓
Existing Template OS / measured Auto-Fit
```

AI polish is opt-in. Gemini may propose bounded wording alternatives but never
owns facts, skills, actions, metrics, responsibility, structure or formatting.
AI-off resume operations make zero LLM calls.

## Progressive optimization

`Improve Again` detects the highest-value unattempted actionable weakness,
generates a canonical candidate, re-runs truth checks and accepts only a
meaningful global-quality improvement. Every attempt is recorded, including
rejected attempts, so an objective cannot loop forever.

`Optimize Resume` repeats that process for at most eight passes, rejects visited
resume states and never replaces the best version with a lower-scoring one.

## Quality

The public/global score is fixed and mode-independent. Layout is reported N/A
until the final rendering phase supplies a canonical server-side layout score.
General Enhance does not fabricate JD relevance; Job Tailor evaluates it
separately.

## Current gates

Run:

```
npm run quality:resume-core
```

Expected core gates:

```
SAFETY       PASS
QUALITY      PASS
OPTIMIZATION PASS
INTEGRATION  PASS
```

`FINAL RENDERING` remains `PENDING` by design. The next patch adds the canonical
ResumeRenderService, normalizes the existing vector PDF path, adds Chromium/
Playwright Unicode fallback, preview/PDF parity checks, Render Gate and
Regression Gate.
