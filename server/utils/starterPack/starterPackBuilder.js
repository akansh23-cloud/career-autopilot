/* ============================================================
   Starter Pack — deterministic ZIP content builder.
   Safeguards (section 13 of the spec):
   - project name sanitized for file paths
   - only files with an allowlisted templateKey are generated
   - every path validated against traversal before zipping
   - total ZIP size + file count limited
   - never includes secrets: .env.example only, env var NAMES only
   ============================================================ */
import crypto from 'crypto';
import { arr, str, obj, slug } from '../workspace/planUtils.js';
import { generateForFile } from '../codegen/codegenEngine.js';
import { planGuide, planChecks, guideEntryToMarkdown, guideFileName, promptFileName, startHereMarkdown } from '../workspace/guidePlanner.js';
import { renderCheckRunner, renderDevcontainer } from './kitFiles.js';
import { createZip, isSafeZipPath } from './zipWriter.js';

const MAX_FILES = 140; // higher ceiling: the kit adds one guide + one prompt per task
const MAX_TOTAL_BYTES = 4 * 1024 * 1024; // 4MB — guides are text, still tiny

const SECRET_PATTERNS = [/\.env$/i, /id_rsa/i, /\.pem$/i, /secret/i, /credential/i];

export function sanitizeProjectName(title = '') {
  return slug(title, 'starter-project').slice(0, 50) || 'starter-project';
}

/* Build { name, files:[{path,content}], setupCommands, warnings } from a plan. */
export function buildStarterPack(plan = {}) {
  const p = obj(plan);
  const root = sanitizeProjectName(obj(p.projectSummary).title || p.title);
  const warnings = [...arr(obj(p.stack).warnings)];
  const files = [];
  let total = 0;

  const candidates = arr(p.fileTree).filter((f) => f.starterPackIncluded && f.templateKey);
  for (const entry of candidates) {
    if (files.length >= MAX_FILES) { warnings.push(`File limit (${MAX_FILES}) reached — remaining planned files were skipped.`); break; }
    if (SECRET_PATTERNS.some((re) => re.test(entry.path)) && !/\.env\.example$/.test(entry.path)) {
      warnings.push(`Skipped "${entry.path}" — looks secret-like; starter packs never include secrets.`);
      continue;
    }
    const rel = entry.path.replace(/^\/+/, '');
    const full = `${root}/${rel}`;
    if (!isSafeZipPath(full)) { warnings.push(`Skipped unsafe path "${entry.path}".`); continue; }
    let out;
    try { out = generateForFile(p, entry.path); }
    catch (err) { warnings.push(`Template failed for "${entry.path}": ${err.message}`); continue; }
    const g = out.generatedFiles[0];
    if (!g) { warnings.push(...out.warnings); continue; }
    total += Buffer.byteLength(g.content, 'utf8');
    if (total > MAX_TOTAL_BYTES) { warnings.push('Starter pack size limit reached — remaining files were skipped.'); break; }
    files.push({ path: full, content: g.content, templateKey: g.templateKey });
  }

  /* ---- Guided Build Kit: the layer that turns a skeleton into a
     self-guided, learn-by-building journey. All deterministic, generated
     from the same plan. A safe text-adder shared by every kit file. */
  const addText = (relPath, content) => {
    if (files.length >= MAX_FILES) { warnings.push(`File limit reached before adding "${relPath}".`); return; }
    const full = `${root}/${relPath.replace(/^\/+/, '')}`;
    if (!isSafeZipPath(full)) { warnings.push(`Skipped unsafe kit path "${relPath}".`); return; }
    const bytes = Buffer.byteLength(content, 'utf8');
    if (total + bytes > MAX_TOTAL_BYTES) { warnings.push(`Size limit reached before adding "${relPath}".`); return; }
    total += bytes;
    files.push({ path: full, content });
  };

  let guide;
  try { guide = planGuide(p); }
  catch (err) { warnings.push(`Guide generation failed (${err.message}); pack still includes the code skeleton.`); guide = { entries: [] }; }

  if (guide.entries.length) {
    addText('guide/00-start-here.md', startHereMarkdown(p, guide));
    for (const entry of guide.entries) {
      addText(guideFileName(entry), guideEntryToMarkdown(entry, { total: guide.entries.length }));
      addText(promptFileName(entry), `# AI pair prompt — Task ${entry.no}: ${entry.title}\n\nCopy the block below into ChatGPT, Claude, or Gemini. It makes any chatbot a tutor that knows your exact task, files, and goal. Paste your errors in as you go.\n\n\`\`\`text\n${entry.aiPrompt}\n\`\`\`\n`);
    }
    // Machine-checkable acceptance manifest + the local runner.
    // These ship ALL-OR-NOTHING. Previously check.mjs was added outside this
    // try block, so a failed manifest shipped a runner with nothing to read —
    // the student got "workspace/checks.json not found — re-download the
    // starter pack", and re-downloading produced the identical broken pack.
    try {
      addText('workspace/checks.json', JSON.stringify(planChecks(p), null, 2) + '\n');
      addText('scripts/check.mjs', renderCheckRunner());
    } catch (err) {
      warnings.push(`Checks manifest could not be generated (${err.message}), so the local check runner was omitted from this pack. Everything else in the kit works — task checks are optional feedback, not verification.`);
    }
    addText('.devcontainer/devcontainer.json', renderDevcontainer(root));
  }

  const setupCommands = [
    `unzip ${root}.zip && cd ${root}`,
    'open guide/00-start-here.md   # ← READ THIS FIRST: pick your lane, then follow guide/01, 02, …',
    'cp .env.example backend/.env   # optional — leave MONGODB_URI empty to run in MEMORY MODE',
    'npm install --prefix backend && npm run dev --prefix backend',
    'npm install --prefix frontend && npm run dev --prefix frontend',
    'node scripts/check.mjs 01   # check your progress on task 01 (then 02, 03, …)',
  ];
  warnings.push('This is a starter skeleton + guided kit, not a completed project. Downloading it does not mark anything Done or Verified. Follow guide/00-start-here.md and build it yourself.');

  return { name: root, files, setupCommands, warnings, guideTaskCount: guide.entries.length };
}

export function packToZip(pack) {
  // Fixed epoch keeps the bytes deterministic for identical plans.
  return createZip(pack.files.map(({ path, content }) => ({ path, content })), { date: new Date('2026-01-01T00:00:00Z') });
}

export function newPackId() { return 'pack_' + crypto.randomBytes(8).toString('hex'); }
