// Starter pack — check runner regression tests.
//
// Bug being guarded: `node scripts/check.mjs 18` failed with
// "workspace/checks.json not found — re-download the starter pack" for any
// user whose project path contained a space, because the runner resolved its
// own root with `new URL('..', import.meta.url).pathname` — a percent-encoded
// URL path, so "/my project" became "/my%20project". Re-downloading produced
// the identical broken pack, so the error message sent users in a circle.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { renderCheckRunner } from '../server/utils/starterPack/kitFiles.js';

const MANIFEST = {
  tasks: [
    { no: '01', title: 'First task', check: { criteria: ['does a thing'] }, checks: [] },
    { no: '18', title: 'Build the score result screen', check: { criteria: ['renders'] }, checks: [] },
  ],
};

/* Lay a minimal pack down at `root` and return a runner invoker. */
function makePack(root) {
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'check.mjs'), renderCheckRunner());
  fs.writeFileSync(path.join(root, 'workspace', 'checks.json'), JSON.stringify(MANIFEST, null, 2));
  return (...args) => execFileSync(process.execPath, ['scripts/check.mjs', ...args],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function tmp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

test('the runner works when the project path contains a space', () => {
  // The exact reported failure. A space is extremely common on Windows
  // ("C:\\Users\\John Doe") and on macOS ("~/My Drive").
  const base = tmp('pack space ');
  const root = path.join(base, 'my project');
  const run = makePack(root);
  const out = run('18');
  assert.match(out, /Build the score result screen/);
  assert.doesNotMatch(out, /not found/);
});

test('the runner works with other URL-escapable characters in the path', () => {
  const base = tmp('pack-odd-');
  const root = path.join(base, "a project (v2) & more");
  const run = makePack(root);
  const out = run('01');
  assert.match(out, /First task/);
  assert.doesNotMatch(out, /not found/);
});

test('the runner works from a plain path with no special characters', () => {
  const root = tmp('pack-plain-');
  const run = makePack(root);
  assert.match(run('01'), /First task/);
});

test('the runner resolves the pack root, not the current working directory', () => {
  // A student running the script from inside a subfolder must still find the
  // manifest — the path is derived from the script's location.
  const root = tmp('pack-cwd-');
  makePack(root);
  fs.mkdirSync(path.join(root, 'backend', 'src'), { recursive: true });
  const out = execFileSync(process.execPath, [path.join(root, 'scripts', 'check.mjs'), '01'],
    { cwd: path.join(root, 'backend', 'src'), encoding: 'utf8' });
  assert.match(out, /First task/);
});

test('no argument shows a progress board with every task', () => {
  /* v2: an unadorned prompt ("Which task?") told a stuck student nothing.
     The board answers the question they actually have — where am I? */
  const root = tmp('pack-list-');
  const run = makePack(root);
  const out = run();
  assert.match(out, /Your build so far/);
  assert.match(out, /18\s+Build the score result screen/);
  assert.match(out, /01\s+First task/);
  assert.match(out, /machine-checkable tasks passing/);
});

test('an unknown task number names the recovery command', () => {
  const root = tmp('pack-bad-');
  makePack(root);
  let out = '';
  try {
    execFileSync(process.execPath, ['scripts/check.mjs', '99'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }
  assert.match(out, /No task "99"/);
  assert.match(out, /npm run check/, 'names the command that shows every task');
});

test('a genuinely missing manifest still reports it', () => {
  // The message is correct when the file really is absent — the bug was that
  // it fired when the file was present.
  const root = tmp('pack-missing-');
  makePack(root);
  fs.rmSync(path.join(root, 'workspace', 'checks.json'));
  let out = '';
  try {
    execFileSync(process.execPath, ['scripts/check.mjs', '01'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }
  assert.match(out, /checks\.json not found/);
});

test('the runner never resolves its root through URL.pathname', () => {
  // Guards the fix itself: .pathname percent-encodes and, on Windows, prefixes
  // a drive path with a slash. fileURLToPath is the only correct conversion.
  const src = renderCheckRunner();
  assert.doesNotMatch(src, /import\.meta\.url\)\.pathname/);
  assert.match(src, /fileURLToPath\(new URL\('\.\.', import\.meta\.url\)\)/);
  assert.match(src, /import \{ fileURLToPath \} from 'node:url'/);
});
