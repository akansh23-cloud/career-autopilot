import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchFaq } from '../support-kb.js';

/* Regression tests for the support FAQ matcher (report finding F2: a payment
   question was confidently answered with the Google-login FAQ). */

test('payment question routes to billing, NOT google login', () => {
  const r = matchFaq('payment not working');
  assert.equal(r.best.id, 'payment-failed');
  assert.equal(r.confident, true);
});

test('google login question still routes to the login FAQ', () => {
  const r = matchFaq('why is google login not working');
  assert.equal(r.best.id, 'google-login-fail');
  assert.equal(r.confident, true);
});

test('resume upload question routes to upload FAQ confidently', () => {
  const r = matchFaq('how do I upload my resume');
  assert.equal(r.best.id, 'upload-resume');
  assert.equal(r.confident, true);
});

test('refund question routes to billing/refund FAQ', () => {
  const r = matchFaq('how do refunds work');
  assert.equal(r.best.id, 'refund');
});

test('gibberish does not produce a confident answer', () => {
  const r = matchFaq('asdf qwerty zzz nonsense');
  assert.equal(r.best, null);
  assert.equal(r.confident, false);
});

test('generic "not working" alone is not enough for a confident wrong answer', () => {
  const r = matchFaq('something is not working');
  // It may surface a related guess but must not be confident.
  assert.equal(r.confident, false);
});
