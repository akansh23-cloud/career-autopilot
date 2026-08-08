#!/usr/bin/env node
/* ============================================================
   THEME CODEMOD  —  dark-coupled Tailwind classes -> theme classes
   ------------------------------------------------------------
   Your codebase has ~3,475 dark-coupled class usages across 94
   .jsx files. This maps the mechanical ~85% of them to
   theme-aware utilities so light mode is a token flip, not a
   rewrite.

   DRY RUN BY DEFAULT. Nothing is written unless you pass --write.

     node scripts/theme-codemod.mjs                 # report only
     node scripts/theme-codemod.mjs --report=full   # every hit
     node scripts/theme-codemod.mjs --write         # apply

   Prerequisite: add these utilities to tailwind.config.js (see
   docs/LIGHT-MODE-TOKEN-MAP.md) OR define them as @layer
   components in index.css. The codemod only rewrites class
   strings; it does not invent CSS.

   Always run `git diff` and click through Jobs, Project Studio,
   College Workspace and Recruiter Console after --write. The
   long tail (inline styles, `text-[#...]`, canvas colours) is
   deliberately NOT touched — those need eyes.
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv.find((a) => a.startsWith('--root='))?.split('=')[1] || 'web/src';
const WRITE = process.argv.includes('--write');
const FULL = process.argv.includes('--report=full');

/* Ordered: longest / most specific patterns first so a broad rule
   never swallows a narrow one. */
const MAP = [
  // text
  [/\btext-white\b/g,               'text-fg'],
  [/\btext-slate-100\b/g,           'text-fg'],
  [/\btext-slate-200\b/g,           'text-fg'],
  [/\btext-slate-300\b/g,           'text-fg-secondary'],
  [/\btext-slate-400\b/g,           'text-fg-secondary'],
  [/\btext-slate-500\b/g,           'text-fg-muted'],
  [/\btext-slate-600\b/g,           'text-fg-muted'],
  [/\btext-white\/(\d{1,3})\b/g,    'text-fg-secondary'],

  // backgrounds
  [/\bbg-white\/\[0\.0\d+\]/g,      'bg-surface-1'],
  [/\bbg-white\/5\b/g,              'bg-surface-1'],
  [/\bbg-white\/10\b/g,             'bg-surface-2'],
  [/\bbg-white\/(?:15|20)\b/g,      'bg-surface-2'],
  [/\bbg-ink-950\b/g,               'bg-base'],
  [/\bbg-ink-900\b/g,               'bg-base'],
  [/\bbg-ink-850\b/g,               'bg-elevated'],
  [/\bbg-ink-800\b/g,               'bg-elevated'],
  [/\bbg-ink-950\/\d{1,3}\b/g,      'bg-elevated'],
  [/\bbg-black\/(?:2|3|4)\d\b/g,    'bg-sunken'],

  // borders
  [/\bborder-white\/(?:5|8|10)\b/g, 'border-subtle'],
  [/\bborder-white\/(?:15|20|25)\b/g, 'border-strong'],

  // hover
  [/\bhover:bg-white\/\[0\.0\d+\]/g, 'hover:bg-surface-hover'],
  [/\bhover:bg-white\/(?:5|10)\b/g,  'hover:bg-surface-hover'],
];

/* Files where an automatic rewrite is likely WRONG — they render
   fixed-palette artefacts (resume PDFs, canvases, exported SVG)
   that must stay dark-on-white regardless of app theme. */
const SKIP = [
  'lib/resumeRenderer.js',
  'lib/resumeTemplates.js',
  'lib/resumeTemplateRegistry.js',
  'components/landing/NetworkSphere.jsx',
  'components/Atmosphere.jsx',
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(p);
  }
  return out;
}

if (!fs.existsSync(ROOT)) {
  console.error(`Not found: ${ROOT}  (run from the repo root, or pass --root=…)`);
  process.exit(1);
}

const files = walk(ROOT).filter((f) => !SKIP.some((s) => f.replace(/\\/g, '/').includes(s)));
let totalHits = 0;
const perFile = [];

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before;
  let hits = 0;
  for (const [re, replacement] of MAP) {
    after = after.replace(re, () => { hits += 1; return replacement; });
  }
  if (!hits) continue;
  totalHits += hits;
  perFile.push({ file, hits });
  if (WRITE) fs.writeFileSync(file, after, 'utf8');
}

perFile.sort((a, b) => b.hits - a.hits);
const shown = FULL ? perFile : perFile.slice(0, 20);
for (const r of shown) console.log(String(r.hits).padStart(5), r.file);
if (!FULL && perFile.length > shown.length) {
  console.log(`      …and ${perFile.length - shown.length} more files (--report=full)`);
}
console.log('\n' + '-'.repeat(52));
console.log(`${totalHits} replacements across ${perFile.length} files`);
console.log(WRITE ? 'WRITTEN — review with `git diff` before committing.' : 'DRY RUN — pass --write to apply.');
console.log(`Skipped ${SKIP.length} fixed-palette files (resume/canvas renderers).`);
