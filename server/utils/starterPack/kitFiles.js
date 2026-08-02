/* ============================================================
   Guided Build Kit — non-guide kit files shipped in the starter
   pack: the local check runner and the Codespaces devcontainer.
   Rendered as plain strings; no dependencies inside the pack
   beyond Node built-ins, so `node scripts/check.mjs 01` works
   the moment the ZIP is extracted.
   ============================================================ */

export function renderCheckRunner() {
  return `#!/usr/bin/env node
/* Guided Build Kit — local task checker.
 * Usage:  node scripts/check.mjs 01     (one task)
 *         node scripts/check.mjs all    (every task so far)
 * Reads workspace/checks.json (generated with this pack).
 * These checks are FEEDBACK for you. "Verified" in Career Autopilot
 * always comes from real evidence (repo, tests, deployment) — this
 * script cannot and does not verify anything on the platform. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

/* Resolve the pack root from this file's own location.
 * fileURLToPath is REQUIRED here — URL.pathname is percent-encoded, so any
 * space in the path becomes %20 and every lookup fails ("/my project" ->
 * "/my%20project"). On Windows it also yields a leading slash ("/C:/Users/..").
 * Both break the manifest lookup below. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = path.join(ROOT, 'workspace', 'checks.json');
if (!fs.existsSync(manifestPath)) { console.error('workspace/checks.json not found — re-download the starter pack.'); process.exit(1); }
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const want = String(process.argv[2] || '').trim();
if (!want) {
  console.log('Which task? e.g.  node scripts/check.mjs 01   (or "all")\\n');
  for (const t of manifest.tasks) console.log('  ' + t.no + '  ' + t.title);
  process.exit(0);
}
const tasks = want === 'all' ? manifest.tasks : manifest.tasks.filter((t) => t.no === want.padStart(2, '0'));
if (!tasks.length) { console.error('No task "' + want + '" in the manifest. Try: node scripts/check.mjs all'); process.exit(1); }

const ok = (m) => console.log('  \\u2705 ' + m);
const bad = (m, hint) => { console.log('  \\u274c ' + m + (hint ? '\\n     \\u21b3 ' + hint : '')); return false; };
const manual = (m) => console.log('  \\u2611\\ufe0f  (check yourself) ' + m);

async function runCheck(c) {
  try {
    if (c.kind === 'fileExists') {
      return fs.existsSync(path.join(ROOT, c.path)) ? (ok(c.label), true)
        : bad(c.label, 'Create the file at exactly this path: ' + c.path);
    }
    if (c.kind === 'todoCleared') {
      const p = path.join(ROOT, c.path);
      if (!fs.existsSync(p)) return bad(c.label, 'File is missing: ' + c.path);
      const left = (fs.readFileSync(p, 'utf8').match(new RegExp('TODO\\\\(' + c.prefix, 'g')) || []).length;
      return left === 0 ? (ok(c.label), true)
        : bad(c.label, left + ' TODO(' + c.prefix + '\\u2026) marker(s) still in ' + c.path + ' \\u2014 implement them, then delete the comment.');
    }
    if (c.kind === 'httpOk') {
      try {
        const res = await fetch(c.url, { signal: AbortSignal.timeout(3000) });
        return res.ok ? (ok(c.label), true) : bad(c.label, 'Got HTTP ' + res.status + ' from ' + c.url);
      } catch {
        return bad(c.label, 'Could not reach ' + c.url + ' \\u2014 is the backend running? (npm run dev --prefix backend)');
      }
    }
    if (c.kind === 'testCmd') {
      try { execSync(c.cmd, { cwd: ROOT, stdio: 'pipe' }); ok(c.label); return true; }
      catch (e) {
        const out = String(e.stdout || '') + String(e.stderr || '');
        return bad(c.label, 'Tests failed. First failing line:\\n     ' + (out.split('\\n').find((l) => /not ok|FAIL|Error/.test(l)) || 'run the command yourself to see the full output'));
      }
    }
    if (c.kind === 'manual') { manual(c.label); return true; }
    manual(c.label || JSON.stringify(c));
    return true;
  } catch (e) { return bad(c.label || c.kind, e.message); }
}

let pass = 0, fail = 0;
for (const t of tasks) {
  console.log('\\nTask ' + t.no + ' \\u2014 ' + t.title);
  for (const c of t.checks) ((await runCheck(c)) ? pass++ : fail++);
}
console.log('\\n' + pass + ' passed \\u00b7 ' + fail + ' failed' + (fail ? '' : ' \\u2014 nice. Commit your work and open the next guide file.'));
process.exit(fail ? 1 : 0);
`;
}

export function renderDevcontainer(projectName = 'starter-project') {
  return JSON.stringify({
    name: projectName,
    image: 'mcr.microsoft.com/devcontainers/javascript-node:20',
    features: { 'ghcr.io/devcontainers/features/git:1': {} },
    forwardPorts: [5050, 5173],
    portsAttributes: {
      5050: { label: 'API (Express)' },
      5173: { label: 'App (Vite)' },
    },
    postCreateCommand: 'npm install --prefix backend && npm install --prefix frontend',
    postAttachCommand: { welcome: 'echo "\\n\\ud83d\\udc4b Open guide/00-start-here.md to begin. Backend: npm run dev --prefix backend \\u00b7 Frontend: npm run dev --prefix frontend\\n"' },
    customizations: {
      vscode: {
        extensions: ['dbaeumer.vscode-eslint', 'esbenp.prettier-vscode'],
        settings: { 'workbench.startupEditor': 'none' },
      },
    },
  }, null, 2) + '\n';
}
