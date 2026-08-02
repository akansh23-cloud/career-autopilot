// Regression tests for the plan / quota / error-message fixes.
//
// The bug class these guard against: a student hits a limit and the UI says
// something that is either wrong ("temporarily unavailable" for a plan cap),
// meaningless ("coming next"), or leaks internals (an env var name). Each test
// below pins one of those contracts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { BUCKET_LIMITS, describeApiError, recordQuota, getBucketState, resetQuotaState } from '../web/src/lib/quota.js';
import { QUOTA_CONFIG } from '../server/utils/quotaMiddleware.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/* ---------------- client mirror must match the server ---------------- */

test('client quota mirror matches the server QUOTA_CONFIG exactly', () => {
  // Two sources of truth is what let the pricing card promise numbers the
  // backend never honoured. If someone edits one side, this fails.
  assert.deepEqual(Object.keys(BUCKET_LIMITS).sort(), Object.keys(QUOTA_CONFIG).sort());
  for (const plan of Object.keys(QUOTA_CONFIG)) {
    for (const bucket of Object.keys(QUOTA_CONFIG[plan])) {
      assert.equal(
        BUCKET_LIMITS[plan][bucket],
        QUOTA_CONFIG[plan][bucket],
        `${plan}.${bucket} drifted between client mirror and server config`,
      );
    }
  }
});

/* ---------------- error classification ---------------- */

test('a daily quota rejection is described as a limit, not an outage', () => {
  const err = Object.assign(new Error('Daily aiCalls limit reached'), {
    status: 429,
    code: 'quota_exceeded',
    quota: { bucket: 'aiCalls', limit: 10, remaining: 0, plan: 'free', resetAt: '2026-08-02T00:00:00.000Z' },
  });
  const d = describeApiError(err, 'Resume tailoring');
  assert.equal(d.kind, 'quota');
  assert.match(d.message, /resets/i);
  assert.equal(d.suggestPlan, 'pro');
  // The old copy said "temporarily unavailable", which told students to retry
  // forever instead of waiting for the reset or upgrading.
  assert.doesNotMatch(d.message, /temporarily unavailable/i);
});

test('a burst rate limit is described as transient and suggests no upgrade', () => {
  const err = Object.assign(new Error('rate limited'), { status: 429, code: 'rate_limited' });
  const d = describeApiError(err, 'Tailoring');
  assert.equal(d.kind, 'rate');
  assert.equal(d.suggestPlan, null);
});

test('an unconfigured-AI error never names an environment variable', () => {
  const err = Object.assign(new Error('nope'), { status: 400, code: 'ai_not_configured' });
  const d = describeApiError(err, 'Drafting');
  assert.equal(d.kind, 'config');
  assert.doesNotMatch(d.message, /API_KEY|ANTHROPIC|env/i);
});

test('an unknown failure never leaks the raw error text to the student', () => {
  const err = Object.assign(new Error('ECONNRESET at /internal/path/secret.js:44'), { status: 500 });
  const d = describeApiError(err, 'Tailoring');
  assert.equal(d.kind, 'unknown');
  assert.doesNotMatch(d.message, /ECONNRESET|secret\.js/);
});

test('quota state records what the server reported', () => {
  resetQuotaState();
  recordQuota({ bucket: 'generation', remaining: 2, limit: 15, plan: 'free', resetAt: '2026-08-02T00:00:00.000Z' });
  const s = getBucketState('generation');
  assert.equal(s.remaining, 2);
  assert.equal(s.limit, 15);
  resetQuotaState();
});

/* ---------------- no internal identifiers in shipped UI copy ---------------- */

test('no user-facing source file mentions the AI provider key by name', () => {
  const files = [
    'web/src/views/Outreach.jsx',
    'web/src/views/Jobs.jsx',
    'web/src/views/patent/PatentIdeaGenerator.jsx',
    'web/src/lib/projectCreator.js',
  ];
  for (const f of files) {
    assert.doesNotMatch(read(f), /ANTHROPIC_API_KEY/, `${f} still exposes the provider key name`);
  }
});

/* ---------------- verification honesty ---------------- */

test('workspace verification no longer advertises features as "coming next"', () => {
  const proof = read('web/src/components/workspace/WorkspaceDataSections.jsx');
  const inspector = read('web/src/components/workspace/WorkspaceInspector.jsx');
  assert.doesNotMatch(proof, /coming next/i);
  assert.doesNotMatch(inspector, /coming next/i);
  // and it explains what is actually checked
  assert.match(proof, /How each check works/);
});
