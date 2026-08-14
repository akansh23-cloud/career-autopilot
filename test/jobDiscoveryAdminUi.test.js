import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('INTEGRATION_GATE — admin manual fetch — UI is a dedicated admin-only navigation surface', () => {
  const shell = read('web/src/components/app/Shell.jsx');
  const groups = read('web/src/lib/navGroups.js');
  const app = read('web/src/App.jsx');
  assert.match(shell, /id:\s*'adminjobs'.*adminOnly:\s*true/);
  assert.match(groups, /Admin[\s\S]*adminjobs/);
  assert.match(app, /adminjobs:\s*AdminJobDiscovery/);
});

test('INTEGRATION_GATE — admin manual fetch — UI calls only the canonical admin endpoint', () => {
  const api = read('web/src/lib/api.js');
  const view = read('web/src/views/AdminJobDiscovery.jsx');
  assert.match(api, /AdminJobDiscovery[\s\S]*\/api\/admin\/job-discovery\/manual-fetch/);
  assert.match(view, /AdminJobDiscovery\.manualFetch/);
  assert.doesNotMatch(view, /remotive|remoteok|jsearch|jobicy/i);
});

test('SECURITY_GATE — admin manual fetch — operator messaging explicitly preserves access-policy safety', () => {
  const view = read('web/src/views/AdminJobDiscovery.jsx');
  assert.match(view, /same source-policy, SSRF, normalization, dedupe and freshness pipeline/i);
  assert.match(view, /never overrides DENY\/REVIEW access policy/i);
});
