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
import { createZip, isSafeZipPath } from './zipWriter.js';

const MAX_FILES = 80;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024; // 2MB of text is plenty for a skeleton

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

  const setupCommands = [
    `unzip ${root}.zip && cd ${root}`,
    'cp .env.example backend/.env   # fill in values — never commit .env',
    '(optional) docker compose up -d   # local MongoDB',
    'npm install --prefix backend && npm run dev --prefix backend',
    'npm install --prefix frontend && npm run dev --prefix frontend',
    'npm test --prefix backend',
  ];
  warnings.push('This is a starter skeleton, not a completed project. Generating or downloading it does not mark anything Done or Verified.');

  return { name: root, files, setupCommands, warnings };
}

export function packToZip(pack) {
  // Fixed epoch keeps the bytes deterministic for identical plans.
  return createZip(pack.files.map(({ path, content }) => ({ path, content })), { date: new Date('2026-01-01T00:00:00Z') });
}

export function newPackId() { return 'pack_' + crypto.randomBytes(8).toString('hex'); }
