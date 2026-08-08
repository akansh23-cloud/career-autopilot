# Light mode — token map

Verified against your tree: **3,475 dark-coupled class usages across 94 `.jsx` files.**
The codemod dry-run covers **3,326 of them (96%)** across 93 files. The remaining ~150 are
inline `style={{}}`, `text-[#…]` literals, and canvas/SVG colours — those need eyes.

## Step 1 — add the utilities the codemod targets

The codemod rewrites classes to names that don't exist yet. Define them once. Add to
`tailwind.config.js` under `theme.extend`:

```js
colors: {
  // …keep everything you already have…
  fg: {
    DEFAULT:   'var(--text-primary)',
    secondary: 'var(--text-secondary)',
    muted:     'var(--text-muted)',
    inverse:   'var(--text-inverse)',
  },
  base:     'var(--bg-base)',
  elevated: 'var(--bg-elevated)',
  sunken:   'var(--bg-sunken)',
  surface: {
    1:     'var(--surface-1)',
    2:     'var(--surface-2)',
    hover: 'var(--surface-hover)',
  },
  subtle: 'var(--border-subtle)',
  strong: 'var(--border-strong)',
},
```

That gives you `text-fg`, `text-fg-secondary`, `text-fg-muted`, `bg-base`, `bg-elevated`,
`bg-sunken`, `bg-surface-1`, `bg-surface-2`, `hover:bg-surface-hover`, `border-subtle`,
`border-strong` — exactly the names the codemod emits.

## Step 2 — paste the token layer

`web/src/index.light-tokens.css` → paste into `web/src/index.css` after the existing
`:root {}` block, and replace the hardcoded `body` / `.panel` / `.glass` /
`.gradient-border` / scrollbar rules as marked in that file.

Note `:root` currently declares `color-scheme: dark` — remove it. `theme.js` sets
`color-scheme` on `<html>` per resolved theme.

## Step 3 — wire the toggle

```js
// web/src/main.jsx — BEFORE ReactDOM.createRoot(...).render(...)
import { initTheme } from './lib/theme.js';
initTheme();
```

Calling it before render prevents the dark flash on a light-mode load.

Then add the control to `components/app/Shell.jsx` (top bar) and `views/Settings.jsx`:

```jsx
import { useTheme } from '../../lib/theme.js';
const { theme, setTheme } = useTheme();
// three-way: System / Light / Dark
```

Default to `system`. A placement cell demoing on a projector in a bright room gets light
automatically, which is exactly the complaint behind the review.

## Step 4 — run the codemod

```bash
node scripts/theme-codemod.mjs                 # dry run, top 20 files
node scripts/theme-codemod.mjs --report=full   # all 93
node scripts/theme-codemod.mjs --write         # apply
git diff --stat
```

## Step 5 — the manual long tail

Automation cannot decide these. Ordered by how visible they are on a demo:

| What | Where | Why manual |
|---|---|---|
| Atmosphere canvas | `components/Atmosphere.jsx` | Additive-light particles; on white they read as grey smudge. Dim to ~0.28 opacity in light (already in the token file) or skip render. |
| NetworkSphere | `components/landing/NetworkSphere.jsx` | Three.js scene with baked dark-scene glow. Needs a light material set or hide on the light landing page. |
| `.text-aurora` / `.text-flow` | `index.css` | Foil gradient on white is ~2:1 contrast. Token file already swaps these to a solid `--brand-text` in light. |
| Resume renderers | `lib/resumeRenderer.js`, `resumeTemplates.js`, `resumeTemplateRegistry.js` | These generate the **printed PDF**, which is always dark-ink-on-white. Must NOT follow app theme. Codemod skips them — keep it that way. |
| Mermaid diagrams | `components/common/MermaidDiagram.jsx` | Mermaid has its own theme config; pass `theme: 'default'` vs `'dark'` from `resolveTheme()`. |
| `text-[#…]` literals | 46 occurrences | Read each; most are status colours that need a light variant. |
| Charts / proof SVGs | `components/proof/ProofViews.jsx` | Hardcoded dark stroke/fill. |

## Step 6 — contrast check before you show a college

The current palette fails AA on white in several places — that's why the light values in the
token file are darker than the dark-theme brand values:

- `--brand-text` dark `#BCA8FF` → light `#5B47C4`
- `--ok` `#57E6A8` → `#0E8F5C`
- `--warn` `#EAC97C` → `#8A6A12`

Run Lighthouse or axe DevTools on Dashboard, Jobs, Project Studio and College Workspace in
light mode. Body text needs 4.5:1, large headings 3:1.

## Realistic estimate

| Phase | Effort |
|---|---|
| Steps 1–4 (tokens + codemod + toggle) | ~1 day → ~85% of screens usable in light |
| Step 5 (manual long tail) | ~1–2 days |
| Step 6 (contrast pass + fixes) | ~0.5 day |

If the college demo is close: **ship Steps 1–4 only**, default to `system`, and put the
toggle in Settings. That alone answers the review.
