/* ============================================================
   Guided Build Kit — non-guide kit files shipped in the starter
   pack: the local check runner and the Codespaces devcontainer.

   v2 runner changes, all driven by one question — "how does the
   student know they are done?":
   - runs the task's ACCEPTANCE TEST, not just "did you delete the
     TODO comment". Deleting a comment proves nothing; a passing
     test proves the endpoint works.
   - `node scripts/check.mjs` with no argument prints a progress
     board across every task instead of an unhelpful prompt.
   - auto-starts nothing and blames nothing: when a check needs a
     running server it says so, with the command.
   ============================================================ */

export function renderCheckRunner() {
  return `#!/usr/bin/env node
/* Guided Build Kit — local task checker.
 *
 *   npm run check        progress board for every task
 *   npm run check 05     just task 05
 *   npm run check all    run everything (slower)
 *
 * Reads workspace/checks.json, generated with this pack.
 * These checks are FEEDBACK for you. "Verified" in Career Autopilot
 * always comes from real evidence (repo, tests, deployment) — this
 * script cannot and does not verify anything on the platform. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

/* fileURLToPath is REQUIRED: URL.pathname percent-encodes spaces, so
   "/my project" becomes "/my%20project" and every lookup fails. On Windows
   it also yields a leading slash ("/C:/Users/..."). */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = path.join(ROOT, 'workspace', 'checks.json');
if (!fs.existsSync(manifestPath)) {
  console.error('workspace/checks.json not found — re-download the starter pack.');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const GREEN = '\\u2705'; const RED = '\\u274c'; const HAND = '\\u2611\\ufe0f';
const ok = (m) => { console.log('  ' + GREEN + ' ' + m); return true; };
const bad = (m, hint) => { console.log('  ' + RED + ' ' + m + (hint ? '\\n     \\u21b3 ' + hint : '')); return false; };
const manual = (m) => { console.log('  ' + HAND + '  (check yourself) ' + m); return true; };

const want = String(process.argv[2] || '').trim();

/* ---------- no argument: the progress board ---------- */
if (!want) {
  console.log('\\nYour build so far\\n');
  let done = 0;
  for (const t of manifest.tasks) {
    const auto = t.checks.filter((c) => c.kind !== 'manual');
    let state = '\\u25cb';
    if (auto.length) {
      const results = [];
      for (const c of auto) results.push(await runCheck(c, { quiet: true }));
      const passed = results.filter(Boolean).length;
      state = passed === auto.length ? GREEN : passed ? '\\u25d0' : '\\u25cb';
      if (passed === auto.length) done += 1;
    } else {
      state = HAND;
    }
    console.log('  ' + state + '  ' + t.no + '  ' + t.title);
  }
  const autoTotal = manifest.tasks.filter((t) => t.checks.some((c) => c.kind !== 'manual')).length;
  console.log('\\n' + done + ' of ' + autoTotal + ' machine-checkable tasks passing.');
  console.log('Details for one task:  npm run check ' + (manifest.tasks[0] ? manifest.tasks[0].no : '01') + '\\n');
  process.exit(0);
}

const tasks = want === 'all' ? manifest.tasks : manifest.tasks.filter((t) => t.no === want.padStart(2, '0'));
if (!tasks.length) {
  console.error('No task "' + want + '" in the manifest. Try:  npm run check');
  process.exit(1);
}

async function runCheck(c, { quiet = false } = {}) {
  const say = {
    ok: (m) => (quiet ? true : ok(m)),
    bad: (m, h) => (quiet ? false : bad(m, h)),
    manual: (m) => (quiet ? true : manual(m)),
  };
  try {
    if (c.kind === 'fileExists') {
      return fs.existsSync(path.join(ROOT, c.path))
        ? say.ok(c.label)
        : say.bad(c.label, 'Create the file at exactly this path: ' + c.path);
    }

    if (c.kind === 'fileContains') {
      const p = path.join(ROOT, c.path);
      if (!fs.existsSync(p)) return say.bad(c.label, 'File is missing: ' + c.path);
      const body = fs.readFileSync(p, 'utf8');
      return new RegExp(c.pattern).test(body)
        ? say.ok(c.label)
        : say.bad(c.label, c.hint || ('Nothing in ' + c.path + ' matches what this task asks for yet.'));
    }

    if (c.kind === 'fileChanged') {
      /* Did the student actually edit the generated file, or only read it? */
      const p = path.join(ROOT, c.path);
      if (!fs.existsSync(p)) return say.bad(c.label, 'File is missing: ' + c.path);
      const body = fs.readFileSync(p, 'utf8');
      const markers = (body.match(/TODO\\(/g) || []).length;
      return markers < Number(c.maxTodos ?? 0) + 1
        ? say.ok(c.label)
        : say.bad(c.label, markers + ' TODO marker(s) still open in ' + c.path + '.');
    }

    if (c.kind === 'todoCleared') {
      const p = path.join(ROOT, c.path);
      if (!fs.existsSync(p)) return say.bad(c.label, 'File is missing: ' + c.path);
      const left = (fs.readFileSync(p, 'utf8').match(new RegExp('TODO\\\\(' + c.prefix, 'g')) || []).length;
      return left === 0
        ? say.ok(c.label)
        : say.bad(c.label, left + ' TODO(' + c.prefix + '\\u2026) marker(s) still in ' + c.path + ' \\u2014 implement them, then delete the comment.');
    }

    if (c.kind === 'httpOk') {
      try {
        const res = await fetch(c.url, { signal: AbortSignal.timeout(3000) });
        return res.ok
          ? say.ok(c.label)
          : say.bad(c.label, 'Got HTTP ' + res.status + ' from ' + c.url);
      } catch {
        return say.bad(c.label, 'Could not reach ' + c.url + ' \\u2014 start the app first:  npm run dev');
      }
    }

    if (c.kind === 'httpNot501') {
      try {
        const res = await fetch(c.url, {
          method: c.method || 'GET',
          headers: { 'content-type': 'application/json' },
          body: (c.method && c.method !== 'GET') ? '{}' : undefined,
          signal: AbortSignal.timeout(3000),
        });
        if (res.status === 501) return say.bad(c.label, 'Still 501 Not Implemented \\u2014 open ' + (c.file || 'the feature module') + ' and write the handler.');
        return res.ok ? say.ok(c.label) : say.bad(c.label, 'Got HTTP ' + res.status + ' \\u2014 expected 200.');
      } catch {
        return say.bad(c.label, 'Could not reach ' + c.url + ' \\u2014 start the app first:  npm run dev');
      }
    }

    if (c.kind === 'testCmd') {
      try { execSync(c.cmd, { cwd: ROOT, stdio: 'pipe' }); return say.ok(c.label); }
      catch (e) {
        const out = String(e.stdout || '') + String(e.stderr || '');
        const first = out.split('\\n').find((l) => /not ok|FAIL|AssertionError|Error:/.test(l));
        return say.bad(c.label, 'Test failed. First failing line:\\n     ' + (first || 'run "' + c.cmd + '" yourself to see the full output'));
      }
    }

    if (c.kind === 'manual') return say.manual(c.label);
    return say.manual(c.label || JSON.stringify(c));
  } catch (e) { return say.bad(c.label || c.kind, e.message); }
}

let pass = 0, fail = 0;
for (const t of tasks) {
  console.log('\\nTask ' + t.no + ' \\u2014 ' + t.title);
  for (const c of t.checks) ((await runCheck(c)) ? pass++ : fail++);
}
console.log('\\n' + pass + ' passed \\u00b7 ' + fail + ' failed'
  + (fail ? '\\n\\nWork through the \\u21b3 hints above, one at a time.' : '\\n\\nNice. Commit your work and open the next guide file.'));
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
    postCreateCommand: 'npm run setup',
    postAttachCommand: { welcome: 'echo "\\n\\ud83d\\udc4b Open guide/00-start-here.md, then run: npm run dev\\n"' },
    customizations: {
      vscode: {
        extensions: ['dbaeumer.vscode-eslint', 'esbenp.prettier-vscode'],
        settings: { 'workbench.startupEditor': 'none' },
      },
    },
  }, null, 2) + '\n';
}
