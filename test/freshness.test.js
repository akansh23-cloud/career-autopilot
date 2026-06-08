import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maxFreshDaysFromQuery, isBoundedFreshness, passesFreshness } from '../freshness.js';

/* Regression coverage for issue #2 — job freshness filtering must be enforced,
   the Month/Latest options must work, and undated jobs must never be treated
   as fresh inside a bounded window. */

test('maxFreshDaysFromQuery maps every UI token correctly', () => {
  assert.equal(maxFreshDaysFromQuery('24h'), 1);
  assert.equal(maxFreshDaysFromQuery('1d'), 1);
  assert.equal(maxFreshDaysFromQuery('3d'), 3);
  assert.equal(maxFreshDaysFromQuery('7d'), 7);
  assert.equal(maxFreshDaysFromQuery('week'), 7);
  assert.equal(maxFreshDaysFromQuery('30d'), 30);
  assert.equal(maxFreshDaysFromQuery('month'), 30);
  assert.equal(maxFreshDaysFromQuery('latest'), Infinity);
  assert.equal(maxFreshDaysFromQuery('all'), Infinity);
  // Unknown tokens fall back to the safe "last week" default.
  assert.equal(maxFreshDaysFromQuery('garbage'), 7);
});

test('isBoundedFreshness is true for windows, false for latest/all', () => {
  assert.equal(isBoundedFreshness('24h'), true);
  assert.equal(isBoundedFreshness('30d'), true);
  assert.equal(isBoundedFreshness('latest'), false);
  assert.equal(isBoundedFreshness('all'), false);
});

test('passesFreshness enforces the window for dated jobs', () => {
  assert.equal(passesFreshness(0, '24h').ok, true);
  assert.equal(passesFreshness(1, '24h').ok, true);
  assert.equal(passesFreshness(2, '24h').ok, false);
  assert.equal(passesFreshness(3, '3d').ok, true);
  assert.equal(passesFreshness(4, '3d').ok, false);
  assert.equal(passesFreshness(8, '7d').ok, false);
  assert.equal(passesFreshness(29, '30d').ok, true);
  assert.equal(passesFreshness(31, '30d').ok, false);
});

test('undated jobs are NOT treated as fresh in a bounded window', () => {
  for (const token of ['24h', '3d', '7d', '30d']) {
    const r = passesFreshness(null, token);
    assert.equal(r.ok, false, `undated should be excluded for ${token}`);
    assert.match(r.reason, /unavailable/);
  }
});

test('undated jobs are allowed only under the unbounded "latest" option', () => {
  assert.equal(passesFreshness(null, 'latest').ok, true);
  assert.equal(passesFreshness(undefined, 'all').ok, true);
});
