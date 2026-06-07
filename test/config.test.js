import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnv } from '../config.js';

/* These run in NODE_ENV=test (set by the test runner env). They assert the
   shape of validateEnv rather than forcing a process exit. */

test('validateEnv reports missing MONGODB_URI as a warning in non-production', () => {
  const { problems, warnings } = validateEnv();
  // In test/dev a missing DB is a warning, never a fatal problem.
  assert.ok(Array.isArray(problems));
  assert.ok(Array.isArray(warnings));
  assert.equal(problems.length, 0);
  assert.ok(warnings.some((w) => /MONGODB_URI/.test(w)));
});
