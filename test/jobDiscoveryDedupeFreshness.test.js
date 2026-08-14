/* ============================================================
   JOB DISCOVERY OS — DEDUPE + FRESHNESS TESTS
   ------------------------------------------------------------
   Covers DEDUPE_GATE (§54) and FRESHNESS_GATE (§55, §58).
   ============================================================ */

import test from 'node:test';
import assert from 'node:assert/strict';

import { toCanonicalJob } from '../server/services/jobDiscovery/normalize/index.js';
import {
  isDuplicate, mergeJobs, findDuplicate, overmergeGuard, blockingKeys, DEDUPE_STAGE,
} from '../server/services/jobDiscovery/dedupe.js';
import {
  observeSeen, observeMissing, observeSourceFailure, applyVerification,
  applyContentChange, needsVerification, freshnessLabel, freshnessScore, sweepStaleness,
} from '../server/services/jobDiscovery/freshness.js';
import {
  PROVIDER, SOURCE_CLASS, JOB_STATUS, ERROR_CLASS, SOURCE_TYPE,
} from '../server/services/jobDiscovery/schema.js';
import GreenhouseAdapter from '../server/services/jobDiscovery/adapters/greenhouse.js';
import AggregatorAdapter from '../server/services/jobDiscovery/adapters/aggregator.js';
import AshbyAdapter from '../server/services/jobDiscovery/adapters/ashby.js';
import fx from './fixtures/jobDiscovery/providers.js';
import { makeService, silentLogger } from './fixtures/jobDiscovery/harness.js';

const NOW = '2026-08-14T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);

const ghSource = {
  id: 'src_gh', provider: PROVIDER.GREENHOUSE, sourceType: SOURCE_TYPE.ATS,
  sourceClass: SOURCE_CLASS.ORIGINAL_ATS, tenant: 'northwindlabs',
  companyName: 'Northwind Labs', companyDomain: 'northwindlabs.example',
};
const ashbySource = {
  id: 'src_ab', provider: PROVIDER.ASHBY, sourceType: SOURCE_TYPE.ATS,
  sourceClass: SOURCE_CLASS.ORIGINAL_ATS, tenant: 'vellumsystems',
  companyName: 'Vellum Systems', companyDomain: 'vellumsystems.example',
};
const aggSource = {
  id: 'src_agg', provider: PROVIDER.API, sourceType: SOURCE_TYPE.AGGREGATOR,
  sourceClass: SOURCE_CLASS.AGGREGATOR, tenant: 'Remotive',
};

const gh = new GreenhouseAdapter({ logger: silentLogger() });
const ashby = new AshbyAdapter({ logger: silentLogger() });
const agg = new AggregatorAdapter({ logger: silentLogger() });

function ghJob(i) { return toCanonicalJob(gh.normalize(fx.greenhouseBoard.jobs[i], ghSource), ghSource, { now: NOW }); }
function ashbyJob(i) { return toCanonicalJob(ashby.normalize(fx.ashbyBoard.jobs[i], ashbySource), ashbySource, { now: NOW }); }
function aggJob(i, source = aggSource) { return toCanonicalJob(agg.normalize(fx.aggregatorJobs[i], source), source, { now: NOW }); }

/* ============================ §54 dedupe ============================ */

test('DEDUPE_GATE — same vacancy across ATS + aggregator collapses to ONE canonical job', () => {
  const ats = ashbyJob(0);                 // Vellum Systems, DevOps Engineer, Remote India
  const aggregator = aggJob(0);            // same role via Remotive
  const r = isDuplicate(ats, aggregator);
  assert.equal(r.match, true, r.reason);

  const merged = mergeJobs(ats, aggregator, { now: NOW });
  assert.equal(merged.sourceInstances.length, 2, 'both instances are clustered, not collapsed');

  /* §35 — the ORIGINAL apply URL wins even though the aggregator was merged in. */
  assert.ok(merged.canonicalApplyUrl.includes('ashbyhq.com'));
  assert.equal(merged.provenance.canonicalApplyUrl.sourceClass, SOURCE_CLASS.ORIGINAL_ATS);
});

test('DEDUPE_GATE — same title, same company, DIFFERENT cities stay two jobs', () => {
  const bengaluru = ghJob(0);
  const london = ghJob(1);
  assert.notEqual(bengaluru.id, london.id);
  assert.equal(overmergeGuard(bengaluru, london), 'different-location');
  const r = isDuplicate(bengaluru, london);
  assert.equal(r.match, false);
  assert.equal(r.reason, 'different-location', 'identical descriptions must not merge them');
});

test('DEDUPE_GATE — same title, same location, different requisition IDs stay separate', () => {
  const a = ghJob(0);
  const b = JSON.parse(JSON.stringify(ghJob(0)));
  b.id = 'cj_other';
  b.sourceInstances[0].sourceJobId = '9999999';
  b.sourceInstances[0].requisitionId = 'REQ-9999';
  const r = isDuplicate(a, b);
  assert.equal(r.match, false);
  assert.equal(r.reason, 'different-requisition');
});

test('DEDUPE_GATE — Backend Engineer vs Senior Backend Engineer do not merge', () => {
  const base = {
    company: { name: 'Harborstack' }, locationsRaw: ['Pune, India'],
    descriptionText: 'Build payment services in Java and Spring Boot with strong reliability guarantees.',
    jobUrl: 'https://jobs.lever.co/harborstack/1', applyUrl: 'https://jobs.lever.co/harborstack/1/apply',
    sourceJobId: '1',
  };
  const src = { id: 'src_x', provider: PROVIDER.LEVER, sourceClass: SOURCE_CLASS.ORIGINAL_ATS, tenant: 'harborstack' };
  const junior = toCanonicalJob({ ...base, title: 'Backend Engineer' }, src, { now: NOW });
  const senior = toCanonicalJob({ ...base, title: 'Senior Backend Engineer', sourceJobId: '2', jobUrl: 'https://jobs.lever.co/harborstack/2' }, src, { now: NOW });
  const r = isDuplicate(junior, senior);
  assert.equal(r.match, false, 'seniority difference is not weak evidence');
});

test('DEDUPE_GATE — description reformatting alone does not create a second job', () => {
  const a = ashbyJob(0);
  const b = JSON.parse(JSON.stringify(a));
  b.description.text = `  ${a.description.text.replace(/\. /g, '.\n\n')}  `;
  const r = isDuplicate(a, b);
  assert.equal(r.match, true, r.reason);
  assert.equal(r.stage, DEDUPE_STAGE.PROVIDER_ID);
});

test('DEDUPE_GATE — a salary update is the SAME job with changed content', () => {
  const a = ashbyJob(0);
  const b = JSON.parse(JSON.stringify(a));
  b.compensation = { ...b.compensation, min: 2000000, max: 3200000 };

  const dup = isDuplicate(a, b);
  assert.equal(dup.match, true);

  const change = applyContentChange(a, b, { at: NOW });
  assert.equal(change.changed, true);
  assert.ok(change.changedFields.includes('compensationMin'));
  assert.equal(change.job.previousContentHash, a.contentHash);
  assert.equal(change.job.lastChangedAt, NOW);
});

test('blocking keys give dedupe a cheap prefilter', () => {
  const job = ashbyJob(0);
  const keys = blockingKeys(job);
  assert.ok(keys.some((k) => k.startsWith('pid:ASHBY::')));
  assert.ok(keys.some((k) => k.startsWith('fp:')));
  assert.ok(keys.some((k) => k.startsWith('co:')));
});

test('findDuplicate picks the highest-confidence candidate', () => {
  const ats = ashbyJob(0);
  const unrelated = ashbyJob(1);
  const incoming = aggJob(0);
  const hit = findDuplicate(incoming, [unrelated, ats]);
  assert.ok(hit);
  assert.equal(hit.job.id, ats.id);
});

/* ============================ §59 authority ============================ */

test('SOURCE AUTHORITY — ATS beats aggregator, and the disagreement is retained', () => {
  const atsHybrid = ghJob(0);                     // Greenhouse says on-site/hybrid
  assert.notEqual(atsHybrid.workplace.type, 'REMOTE');

  const aggregatorSaysRemote = aggJob(1, aggSource);
  const forcedRemote = JSON.parse(JSON.stringify(aggregatorSaysRemote));
  forcedRemote.workplace = { type: 'REMOTE', remoteScope: 'REMOTE_WORLDWIDE', remoteRegions: ['ANYWHERE'], evidence: 'aggregator' };
  forcedRemote.sourceInstances[0].asserted.workplaceType = 'REMOTE';

  const merged = mergeJobs(atsHybrid, forcedRemote, { now: NOW });
  assert.notEqual(merged.workplace.type, 'REMOTE', 'the ATS value stands');
  assert.ok(merged.conflicts.workplaceType?.length, 'the aggregator claim is preserved as a conflict');
  assert.equal(merged.sourceInstances.length, 2, 'the aggregator instance is NOT discarded');
});

/* ============================ §55 freshness ============================ */

test('FRESHNESS_GATE — a transient 500 does not remove a job', () => {
  let job = ashbyJob(0);
  job = observeSeen(job, { sourceId: ashbySource.id, at: NOW });
  assert.equal(job.status, JOB_STATUS.ACTIVE);

  const after = observeSourceFailure(job, { sourceId: ashbySource.id, errorClass: ERROR_CLASS.NETWORK, at: NOW });
  assert.notEqual(after.status, JOB_STATUS.REMOVED);
  assert.equal(after.status, JOB_STATUS.LIKELY_ACTIVE);

  const verifyFailed = applyVerification(after, { ok: false, status: 500, closed: false, errorClass: ERROR_CLASS.NETWORK }, { sourceId: ashbySource.id, at: NOW });
  assert.notEqual(verifyFailed.status, JOB_STATUS.REMOVED, 'a 500 is never proof of closure');
});

test('FRESHNESS_GATE — a verified 404 removes the job', () => {
  let job = observeSeen(ashbyJob(0), { sourceId: ashbySource.id, at: NOW });
  job = applyVerification(job, { ok: false, status: 404, closed: false }, { sourceId: ashbySource.id, at: NOW });
  assert.equal(job.status, JOB_STATUS.REMOVED);
  assert.equal(job.closedAt, NOW);
  assert.equal(job.lastVerifiedAt, NOW);
});

test('FRESHNESS_GATE — absence from an INCOMPLETE response is not evidence', () => {
  const job = observeSeen(ashbyJob(0), { sourceId: ashbySource.id, at: NOW });
  const after = observeMissing(job, { sourceId: ashbySource.id, at: NOW, authoritative: false });
  assert.equal(after.status, JOB_STATUS.ACTIVE, 'a keyword-filtered miss changes nothing');
  assert.equal(after.sourceInstances[0].missCount ?? 0, 0);
});

test('FRESHNESS_GATE — repeated absence from an AUTHORITATIVE feed flags for verification, not deletion', () => {
  let job = observeSeen(ashbyJob(0), { sourceId: ashbySource.id, at: NOW });
  for (let i = 0; i < 3; i += 1) {
    job = observeMissing(job, { sourceId: ashbySource.id, at: NOW, authoritative: true });
  }
  assert.equal(job.sourceInstances[0].active, false);
  assert.equal(job.status, JOB_STATUS.STALE);
  assert.equal(job.needsVerification, true);
  assert.notEqual(job.status, JOB_STATUS.REMOVED, 'closure still requires verification');

  /* Verification says it is alive after all — the record recovers. */
  const recovered = applyVerification(job, { ok: true, status: 200 }, { sourceId: ashbySource.id, at: NOW });
  assert.equal(recovered.status, JOB_STATUS.ACTIVE);
  assert.equal(recovered.needsVerification, false);
});

test('FRESHNESS_GATE — a reappearing job recovers from REMOVED', () => {
  let job = observeSeen(ashbyJob(0), { sourceId: ashbySource.id, at: NOW });
  job = applyVerification(job, { ok: false, status: 410 }, { sourceId: ashbySource.id, at: NOW });
  assert.equal(job.status, JOB_STATUS.REMOVED);
  const back = observeSeen(job, { sourceId: ashbySource.id, at: '2026-08-15T09:00:00.000Z' });
  assert.equal(back.status, JOB_STATUS.ACTIVE);
  assert.equal(back.closedAt, null);
});

/* ============================ §58 date semantics ============================ */

test('§58 — sourcePublishedAt, firstSeenAt, lastSeenAt and lastVerifiedAt are never substituted', () => {
  const dated = ghJob(0);      // board stated first_published
  const undated = ghJob(2);    // board stated NO publication date

  assert.equal(dated.sourcePublishedAt, '2026-08-11T14:00:00.000Z');
  assert.equal(dated.firstSeenAt, NOW);
  assert.equal(dated.lastVerifiedAt, null, 'never verified yet — not backfilled from firstSeenAt');

  assert.equal(undated.sourcePublishedAt, null);
  assert.equal(undated.firstSeenAt, NOW);
  assert.notEqual(undated.sourcePublishedAt, undated.firstSeenAt);

  const datedLabel = freshnessLabel(dated, { now: NOW_MS });
  assert.equal(datedLabel.kind, 'posted');
  assert.ok(datedLabel.label.startsWith('Posted '));

  const undatedLabel = freshnessLabel(undated, { now: NOW_MS });
  assert.equal(undatedLabel.kind, 'discovered');
  assert.ok(undatedLabel.label.startsWith('First discovered '));
  assert.ok(!/^Posted/.test(undatedLabel.label), 'never claims a posting time it does not have');
  assert.equal(undatedLabel.verifiedLabel, 'Not yet re-verified');

  const score = freshnessScore(undated, { now: NOW_MS });
  assert.equal(score.basis, 'discovered', 'ranking states WHICH date it used');
  assert.equal(freshnessScore(dated, { now: NOW_MS }).basis, 'posted');
});

test('staleness sweep downgrades but never deletes', () => {
  const old = { ...ashbyJob(0), lastSeenAt: '2026-06-01T00:00:00.000Z', status: JOB_STATUS.ACTIVE };
  const swept = sweepStaleness(old, { now: NOW_MS });
  assert.equal(swept.status, JOB_STATUS.STALE);
  assert.equal(swept.needsVerification, true);
  assert.notEqual(swept.status, JOB_STATUS.REMOVED);

  const removed = { ...ashbyJob(0), status: JOB_STATUS.REMOVED, lastSeenAt: '2026-06-01T00:00:00.000Z' };
  assert.equal(sweepStaleness(removed, { now: NOW_MS }).status, JOB_STATUS.REMOVED);
});

test('needsVerification schedules by age and by explicit flag', () => {
  const fresh = { ...ashbyJob(0), lastVerifiedAt: NOW, firstSeenAt: NOW };
  assert.equal(needsVerification(fresh, { now: NOW_MS }), false);

  const stale = { ...ashbyJob(0), lastVerifiedAt: '2026-07-01T00:00:00.000Z' };
  assert.equal(needsVerification(stale, { now: NOW_MS }), true);

  const flagged = { ...fresh, needsVerification: true };
  assert.equal(needsVerification(flagged, { now: NOW_MS }), true);
});

/* ==================== end-to-end dedupe through ingest ==================== */

test('ingesting the same vacancy from two sources yields ONE canonical job', async () => {
  const service = await makeService({
    routes: [[/api\.ashbyhq\.com/, { body: fx.ashbyBoard }]],
    legacySources: [{ name: 'Remotive', home: 'https://remotive.example', fetch: async () => fx.aggregatorJobs }],
  });

  const { source: ats } = await service.registerSource({
    provider: PROVIDER.ASHBY, sourceType: SOURCE_TYPE.ATS, sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
    tenant: 'vellumsystems', companyName: 'Vellum Systems', companyDomain: 'vellumsystems.example',
  });
  await service.crawlSource(ats.id);
  const afterAts = await service.store.listJobs({});
  assert.equal(afterAts.length, 2);

  const aggregators = await service.listSources({ provider: PROVIDER.API });
  assert.equal(aggregators.length, 1, 'the legacy source was bootstrapped into the registry');
  const run = await service.crawlSource(aggregators[0].id);
  assert.ok(run.merged >= 1, 'the aggregator duplicate merged rather than creating a new job');

  const all = await service.store.listJobs({});
  const devops = all.filter((j) => j.titleFamily === 'DEVOPS_ENGINEER');
  assert.equal(devops.length, 1, 'one vacancy, one canonical job');
  assert.equal(devops[0].sourceInstances.length, 2, 'two source instances retained');
  assert.ok(devops[0].canonicalApplyUrl.includes('ashbyhq.com'), 'direct apply URL preferred');
});
