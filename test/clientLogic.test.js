// Unit tests for the pure client-side logic introduced by the tracker +
// skill-badge fixes. These exercise the storage-free helpers directly, so they
// run under `node --test` without a browser, DB or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_BOARD, COLUMN_ORDER, REMOVABLE_COLUMNS,
  trackerJobIdentity, addJobToBoard, removeFromBoard, moveInBoard,
  funnelFromBoard, boardTotal, normalizeBoard,
} from '../web/src/lib/trackerStore.js';

import {
  isStrongBadge, normalizeSkillName, dedupeBadges, classifyBadges, topVerifiedBadges,
} from '../web/src/lib/skillBadges.js';

/* ---------------- tracker store ---------------- */

test('job identity follows the documented priority order', () => {
  assert.equal(trackerJobIdentity({ externalJobId: 'A1', url: 'x', company: 'c' }), 'ext:a1');
  assert.equal(trackerJobIdentity({ source: 'Greenhouse', url: 'https://J/1' }), 'su:greenhouse|https://j/1');
  assert.equal(trackerJobIdentity({ url: 'https://J/2' }), 'u:https://j/2');
  assert.equal(trackerJobIdentity({ company: 'Acme', title: 'SRE', location: 'Pune' }), 'ctl:acme|sre|pune');
});

test('saving a job adds it to the Saved column', () => {
  const { board, status } = addJobToBoard(EMPTY_BOARD, { title: 'SRE', company: 'Acme', url: 'https://a/1' });
  assert.equal(status, 'saved');
  assert.equal(board.saved.length, 1);
  assert.equal(board.saved[0].role, 'SRE');
  assert.equal(boardTotal(board), 1);
});

test('a duplicate save does not create a second card (any column)', () => {
  const job = { title: 'SRE', company: 'Acme', url: 'https://a/1' };
  const first = addJobToBoard(EMPTY_BOARD, job);
  // Move it to applied, then try to save the same job again.
  const moved = moveInBoard(first.board, 'saved', trackerJobIdentity(job), 1);
  const second = addJobToBoard(moved, job);
  assert.equal(second.status, 'duplicate');
  assert.equal(boardTotal(second.board), 1);
});

test('funnel counts are derived from the board (dashboard source of truth)', () => {
  let b = addJobToBoard(EMPTY_BOARD, { url: 'u1' }).board;
  b = addJobToBoard(b, { url: 'u2' }).board;
  b = moveInBoard(b, 'saved', 'u:u2', 1); // -> applied
  const f = funnelFromBoard(b);
  assert.deepEqual(f, { saved: 1, applied: 1, interview: 0, offer: 0, rejected: 0 });
});

test('remove works for Saved/Applied/Interview but Offer is protected', () => {
  assert.deepEqual(REMOVABLE_COLUMNS, ['saved', 'applied', 'interview']);
  assert.ok(!REMOVABLE_COLUMNS.includes('offer'));
  const b = addJobToBoard(EMPTY_BOARD, { url: 'u1' }).board;
  const after = removeFromBoard(b, 'saved', 'u:u1');
  assert.equal(boardTotal(after), 0);
});

test('normalizeBoard coerces malformed input into a complete board', () => {
  const b = normalizeBoard({ saved: null, applied: [{ id: 1 }], junk: true });
  assert.deepEqual(Object.keys(b).sort(), [...COLUMN_ORDER].sort());
  assert.equal(b.applied.length, 1);
  assert.equal(b.saved.length, 0);
});

/* ---------------- skill badges ---------------- */

test('a badge is strong when proof >= 80 OR status is verified', () => {
  assert.ok(isStrongBadge({ skillName: 'Docker', level: 'Practiced', confidence: 80 }));
  assert.ok(isStrongBadge({ skillName: 'Docker', level: 'GitHub Verified', confidence: 55 }));
  assert.ok(isStrongBadge({ skillName: 'Docker', verificationStatus: 'verified', confidence: 30 }));
  assert.ok(!isStrongBadge({ skillName: 'Docker', level: 'Practiced', confidence: 40 }));
});

test('skill names normalize so CI/CD variants do not duplicate', () => {
  assert.equal(normalizeSkillName('CI/CD Integration'), normalizeSkillName('CI/CD'));
  assert.equal(normalizeSkillName('  Node.js  '), 'node.js');
});

test('dedupe keeps the single strongest badge per normalized skill', () => {
  const out = dedupeBadges([
    { skillName: 'CI/CD', level: 'Practiced', confidence: 40 },
    { skillName: 'CI/CD Integration', level: 'GitHub Verified', confidence: 88 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'GitHub Verified');
});

test('classifyBadges splits verified vs developing; dashboard shows only strong', () => {
  const badges = [
    { skillName: 'Docker', level: 'Deployment Verified', confidence: 92 },
    { skillName: 'React', level: 'Practiced', confidence: 40 },
    { skillName: 'AWS', level: 'Project Verified', confidence: 72 },
    { skillName: 'Terraform', level: 'Practiced', confidence: 45 },
  ];
  const { verified, developing } = classifyBadges(badges);
  assert.deepEqual(verified.map((b) => b.skillName), ['Docker', 'AWS']);
  assert.deepEqual(developing.map((b) => b.skillName).sort(), ['React', 'Terraform']);
  // verified sorted strongest-first
  assert.equal(verified[0].skillName, 'Docker');
});

test('topVerifiedBadges caps the visible count', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ skillName: `skill${i}`, level: 'GitHub Verified', confidence: 85 }));
  assert.equal(topVerifiedBadges(many, 16).length, 16);
});
