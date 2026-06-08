import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSkillXP } from '../web/src/lib/xp.js';
import { deterministicValidation } from '../web/src/lib/projectCreator.js';

/* ---- #12: skills must not show completed/verified without real evidence ---- */

test('a skill with only an in-progress project is "in_progress", not completed', () => {
  const skills = deriveSkillXP([{ id: 'p', title: 'P', skillsCovered: ['SQL'], tasks: [{ status: 'done' }] }]);
  const sql = skills.find((s) => s.skillName === 'SQL');
  assert.ok(sql, 'SQL skill should be derived');
  assert.equal(sql.state, 'in_progress');
});

test('a skill reaches "completed" only when its project meets the completed gate', () => {
  const completedProject = {
    id: 'p1', title: 'A', skillsCovered: ['React'],
    tasks: [{ status: 'done' }],
    checklist: [{ done: true }, { done: true }],
    githubUrl: 'https://github.com/x/y', github: { success: true },
    readme: 'x'.repeat(150),
    liveDemoUrl: 'https://demo', liveVerification: { reachable: true },
    architecture: 'graph TD; A-->B',
  };
  const skills = deriveSkillXP([completedProject]);
  const react = skills.find((s) => s.skillName === 'React');
  assert.ok(['completed', 'verified'].includes(react.state), `expected completed/verified, got ${react.state}`);
});

test('skills with zero evidence are not emitted at all', () => {
  const skills = deriveSkillXP([{ id: 'p', title: 'P', skillsCovered: ['Rust'] }]); // no evidence → 0 XP
  assert.equal(skills.find((s) => s.skillName === 'Rust'), undefined);
});

/* ---- #6: deterministic validation is objective and blocks on required fields ---- */

test('deterministic validation blocks when required fields are missing', () => {
  const v = deterministicValidation({ title: '', targetRole: '', skillsCovered: [] });
  assert.equal(v.requiredOk, false);
  const ids = v.blocking.map((b) => b.id).sort();
  assert.deepEqual(ids, ['skillGap', 'targetRole', 'title']);
});

test('deterministic validation passes required fields when present', () => {
  const v = deterministicValidation({
    title: 'Resume gap analyzer', targetRole: 'DevOps Engineer',
    skillsCovered: ['AWS'], duration: '2 weeks',
    problemStatement: 'Candidates do not know which skills they are missing.',
  });
  assert.equal(v.requiredOk, true);
});

test('deterministic validation flags an unrealistic roadmap duration', () => {
  const v = deterministicValidation({ title: 'X', targetRole: 'Y', skillsCovered: ['Z'], duration: '18 months' });
  const dur = v.checks.find((c) => c.id === 'duration');
  assert.equal(dur.ok, false);
});

test('deterministic validation flags empty architecture and milestones', () => {
  const v = deterministicValidation({ title: 'X', targetRole: 'Y', skillsCovered: ['Z'] });
  assert.equal(v.checks.find((c) => c.id === 'architecture').ok, false);
  assert.equal(v.checks.find((c) => c.id === 'milestones').ok, false);
});
