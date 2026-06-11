// Job Search Engine v2 regression tests:
//  - progressive fallback returns broader results instead of "No matching
//    jobs found" when the exact pass is empty,
//  - undated jobs pass in inclusive/fallback mode (labelled dateUnknown) and
//    are excluded in strict mode,
//  - removal diagnostics count exactly why jobs were dropped,
//  - broad role matching strips seniority qualifiers and applies synonyms.
// Pure imports only — runs under `node --test` with no server/DB/network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FILTER_MODES, normalizeFilterMode, FALLBACK_STEPS,
  broadenRoleTokens, broadRoleMatch, gateJobs, rankJobs, progressiveGate, summarizeSearch,
} from '../server/utils/jobSearchEngine.js';
import {
  matchesWorkMode, matchesExperienceLevel, matchesJobType,
} from '../server/utils/jobFilters.js';
import { passesFreshness, maxFreshDaysFromQuery } from '../freshness.js';

/* Helpers mirroring what server.js injects, with simple role/location text match. */
const norm = (s) => String(s || '').toLowerCase();
const helpers = {
  passesFreshness,
  maxDaysOf: maxFreshDaysFromQuery,
  matchRole: (j, role) => !role || norm(`${j.title} ${j.summary}`).includes(norm(role)),
  matchLocation: (j, loc) => !loc || norm(`${j.location}`).includes(norm(loc)),
  matchesWorkMode, matchesExperienceLevel, matchesJobType,
  jobKey: (j) => `${norm(j.title)}|${norm(j.company)}`,
};

const job = (over = {}) => ({
  title: 'Java Developer', company: 'Acme', url: 'https://careers.acme.com/j/1',
  location: 'Pune, India', mode: 'Remote', summary: 'Build Java services',
  postedDays: 2, postedDate: '2026-06-10', source: 'Remotive', ...over,
});

test('engine constants are sane', () => {
  assert.deepEqual(FILTER_MODES, ['inclusive', 'strict']);
  assert.equal(normalizeFilterMode('STRICT'), 'strict');
  assert.equal(normalizeFilterMode(''), 'inclusive'); // default inclusive
  assert.equal(FALLBACK_STEPS[0].level, 0);
  assert.equal(FALLBACK_STEPS.length, 5);
});

test('broadenRoleTokens strips seniority qualifiers and adds synonyms', () => {
  const t = broadenRoleTokens('Senior Java Developer');
  assert.ok(t.includes('java'));
  assert.ok(t.includes('developer'));
  assert.ok(t.includes('engineer')); // synonym
  assert.ok(!t.includes('senior'));
  assert.equal(broadRoleMatch({ title: 'Backend Engineer (Java)' }, 'Senior Java Developer'), true);
  assert.equal(broadRoleMatch({ title: 'Sales Manager' }, 'Senior Java Developer'), false);
});

test('gateJobs counts removals per cause', () => {
  const jobs = [
    job(),                                                       // candidate
    job({ title: 'Java Developer 2', postedDays: 40 }),         // freshness
    job({ title: 'Python Developer', summary: 'python only' }), // role
    job({ title: 'Java Developer 3', location: 'Berlin' }),     // location
    job({ title: 'Java Developer', company: 'Acme' }),          // duplicate of #1
    job({ title: '', company: '' }),                             // invalid
  ];
  const out = gateJobs(jobs, { role: 'java developer', location: 'pune', mode: 'any', experience: 'any', jobType: 'any', freshness: '7d', filterMode: 'strict' }, helpers);
  assert.equal(out.candidates.length, 1);
  assert.equal(out.removed.freshness, 1);
  assert.equal(out.removed.role, 1);
  assert.equal(out.removed.location, 1);
  assert.equal(out.removed.duplicate, 1);
  assert.equal(out.removed.invalid, 1);
  assert.equal(out.audit.length, jobs.length);
});

test('undated jobs: excluded in strict mode, included + labelled in inclusive mode', () => {
  const undated = [job({ postedDays: null, postedDate: '' })];
  const crit = { role: 'java', location: '', mode: 'any', experience: 'any', jobType: 'any', freshness: '7d' };
  const strict = gateJobs(undated.map(j => ({ ...j })), { ...crit, filterMode: 'strict' }, helpers);
  assert.equal(strict.candidates.length, 0);
  assert.equal(strict.removed.freshness, 1);
  const inclusive = gateJobs(undated.map(j => ({ ...j })), { ...crit, filterMode: 'inclusive' }, helpers);
  assert.equal(inclusive.candidates.length, 1);
  assert.equal(inclusive.candidates[0].dateUnknown, true); // "date unavailable" label
});

test('progressive fallback: stale jobs surface at the 30-day step instead of an empty page', () => {
  const jobs = [job({ postedDays: 20 })]; // outside the 7d window
  const out = progressiveGate(jobs, { role: 'java developer', location: 'pune', mode: 'any', experience: 'any', jobType: 'any', freshness: '7d', filterMode: 'strict' }, helpers);
  assert.equal(out.candidates.length, 1);
  assert.equal(out.step.level, 1);
  assert.equal(out.step.group, 'broader-fresh');
  assert.equal(out.baseCount, 0);                 // exact pass was empty
  assert.equal(out.baseRemoved.freshness, 1);     // and diagnostics say why
  assert.equal(out.attempts[0].count, 0);
  assert.equal(out.attempts[1].count, 1);
});

test('progressive fallback: undated jobs surface at the source-listed step in strict mode', () => {
  const jobs = [job({ postedDays: null, postedDate: '' })];
  const out = progressiveGate(jobs, { role: 'java developer', location: 'pune', mode: 'any', experience: 'any', jobType: 'any', freshness: '7d', filterMode: 'strict' }, helpers);
  assert.equal(out.candidates.length, 1);
  assert.equal(out.step.group, 'source-listed');
  assert.equal(out.candidates[0].dateUnknown, true);
});

test('progressive fallback: role broadening rescues near-miss titles', () => {
  const jobs = [job({ title: 'Backend Engineer', summary: 'JVM microservices in java' })];
  // exact matchRole needs the literal phrase "java developer" -> fails
  const out = progressiveGate(jobs, { role: 'java developer', location: 'pune', mode: 'any', experience: 'any', jobType: 'any', freshness: '7d', filterMode: 'inclusive' }, helpers);
  assert.equal(out.candidates.length, 1);
  assert.equal(out.step.group, 'broader-role');
});

test('progressive fallback: location relaxes only at the final global step', () => {
  const jobs = [job({ location: 'Berlin, Germany' })];
  const out = progressiveGate(jobs, { role: 'java developer', location: 'pune', mode: 'any', experience: 'any', jobType: 'any', freshness: '7d', filterMode: 'inclusive' }, helpers);
  assert.equal(out.candidates.length, 1);
  assert.equal(out.step.group, 'broader-global');
  assert.equal(out.step.level, 4);
});

test('fallback never tightens a user-chosen freshness window', () => {
  // user chose "latest" (unbounded); step 1 would relax to 30d which is TIGHTER
  const jobs = [job({ title: 'Python Developer', summary: 'python', postedDays: 60 })]; // role mismatch at step 0
  const out = progressiveGate(jobs, { role: 'java developer', location: '', mode: 'any', experience: 'any', jobType: 'any', freshness: 'latest', filterMode: 'inclusive' }, helpers);
  // rescued by broad role at level 3 — and the 60-day-old job must NOT be
  // dropped by the level-1 '30d' relaxation overriding 'latest'
  assert.equal(out.candidates.length, 1);
  assert.equal(out.step.group, 'broader-role');
});

test('exact matches return at level 0 with no explanation banner', () => {
  const out = progressiveGate([job()], { role: 'java developer', location: 'pune', mode: 'any', experience: 'any', jobType: 'any', freshness: '7d', filterMode: 'inclusive' }, helpers);
  assert.equal(out.step.level, 0);
  assert.equal(summarizeSearch({ baseCount: 1, shownCount: 1, fallbackLevel: 0, fallbackLabel: 'Exact matches', removed: out.baseRemoved }), '');
});

test('summarizeSearch explains fallback results and names the biggest removal causes', () => {
  const msg = summarizeSearch({
    baseCount: 0, shownCount: 18, fallbackLevel: 2,
    fallbackLabel: 'Source-listed matches (any date)',
    removed: { freshness: 9, location: 1 }, verifiedRemoved: 6,
  });
  assert.ok(msg.includes('0 exact matches'));
  assert.ok(msg.includes('18'));
  assert.ok(msg.toLowerCase().includes('source-listed'));
  assert.ok(msg.includes('freshness'));
  assert.ok(msg.includes('verification') || msg.includes('link verification'));
  const empty = summarizeSearch({ baseCount: 0, shownCount: 0, fallbackLevel: 4, fallbackLabel: 'x', removed: { role: 5 } });
  assert.ok(empty.startsWith('0 jobs found even after relaxing'));
});

test('rankJobs is deterministic: fresher + verified first, undated last', () => {
  const a = job({ title: 'A', postedDays: 1, verified: true, verifyLevel: 'live' });
  const b = job({ title: 'B', postedDays: 25 });
  const c = job({ title: 'C', postedDays: null });
  const ranked = rankJobs([c, b, a], { role: 'java developer' }, helpers);
  assert.deepEqual(ranked.map(j => j.title), ['A', 'B', 'C']);
});

test('work mode / experience / job type filters still gate inside the engine', () => {
  const jobs = [
    job({ title: 'Java Developer Onsite', summary: 'java, fully on-site role in office', mode: 'On-site/Hybrid' }),
    job({ title: 'Senior Java Developer', summary: 'java 8+ years' }),
    job({ title: 'Java Developer Intern', summary: 'java internship' }),
  ];
  const crit = { role: 'java', location: '', mode: 'remote', experience: 'entry', jobType: 'full-time', freshness: '7d', filterMode: 'inclusive' };
  const out = gateJobs(jobs.map(j => ({ ...j })), crit, helpers);
  assert.equal(out.candidates.length, 0);
  assert.equal(out.removed.workMode, 1);    // onsite job vs remote filter
  assert.equal(out.removed.experience, 2);  // senior + intern vs entry filter
});
