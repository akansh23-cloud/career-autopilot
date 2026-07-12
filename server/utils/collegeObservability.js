/* ============================================================
   COLLEGE OBSERVABILITY ENGINE  (deterministic; pure functions)
   ------------------------------------------------------------
   Turns deep, college-scoped student rows into the placement-cell
   command-center payload: verification funnel, readiness & resume
   distributions, engagement cohorts, branch/batch matrices, skill
   coverage, momentum series and a rule-based risk register.

   INVARIANTS (mirrors the readiness engine):
   - Deterministic: identical inputs always produce identical output.
   - No AI in any verdict path — risk flags and funnel stages come
     from explicit rules over verified/recorded signals only.
   - Pure: no I/O, no clock reads — `now` is always injected so the
     module is unit-testable and reproducible.
   ============================================================ */

export const OBSERVABILITY_VERSION = 'college-observability-v1';

export const FUNNEL_STAGES = [
  'registered',       // account exists, profile essentially empty
  'profile_complete', // branch/batch + some skills declared
  'building',         // has at least one project submission (any status)
  'submitted',        // has a submission awaiting verification
  'verified',         // has ≥1 verified project
  'recruiter_ready',  // verified project with GitHub/live proof + readiness ≥ 65
];

export const ENGAGEMENT_BUCKETS = ['active7', 'active30', 'dormant', 'never'];

import { csvLine } from './csvSafe.js';
const DAY = 24 * 60 * 60 * 1000;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/* ---- Funnel stage: the furthest stage a student has objectively reached. */
export function funnelStage(row = {}) {
  const profileComplete = Boolean(row.branch) && Boolean(row.batch) && (row.skills || []).length >= 2;
  const submissions = num(row.projectsTotal);
  const pending = num(row.projectsPending) + num(row.projectsNeedsReview);
  const verified = num(row.projectsVerified);
  const recruiterReady = num(row.recruiterReadyProjects) > 0 && num(row.readinessScore) >= 65;

  if (recruiterReady) return 'recruiter_ready';
  if (verified > 0) return 'verified';
  if (pending > 0) return 'submitted';
  if (submissions > 0) return 'building';
  if (profileComplete) return 'profile_complete';
  return 'registered';
}

/* ---- Engagement bucket from the last recorded signal timestamp. */
export function engagementBucket(lastActiveISO, now) {
  if (!lastActiveISO) return 'never';
  const t = Date.parse(lastActiveISO);
  if (!Number.isFinite(t)) return 'never';
  const age = now - t;
  if (age <= 7 * DAY) return 'active7';
  if (age <= 30 * DAY) return 'active30';
  return 'dormant';
}

/* ---- Rule-based risk flags. Every flag carries an explicit, auditable
   reason; severity is the count-weighted sum used only for ordering. */
export const RISK_RULES = [
  {
    code: 'no_verified_proof',
    weight: 3,
    label: 'No verified projects',
    test: (r) => num(r.projectsVerified) === 0,
  },
  {
    code: 'stalled_submission',
    weight: 2,
    label: 'Submission stuck in review > 14 days',
    test: (r, now) => {
      if (num(r.projectsPending) + num(r.projectsNeedsReview) === 0) return false;
      const t = r.oldestPendingAt ? Date.parse(r.oldestPendingAt) : NaN;
      return Number.isFinite(t) && now - t > 14 * DAY;
    },
  },
  {
    code: 'low_readiness',
    weight: 2,
    label: 'Readiness below 40',
    test: (r) => r.readinessScore != null && num(r.readinessScore) < 40,
  },
  {
    code: 'no_resume',
    weight: 1,
    label: 'No analyzed resume',
    test: (r) => r.resumeScore == null,
  },
  {
    code: 'weak_resume',
    weight: 1,
    label: 'Resume score below 55',
    test: (r) => r.resumeScore != null && num(r.resumeScore) < 55,
  },
  {
    code: 'inactive_30d',
    weight: 2,
    label: 'No activity in 30+ days',
    test: (r, now) => ['dormant', 'never'].includes(engagementBucket(r.lastActiveAt, now)),
  },
  {
    code: 'skills_unverified',
    weight: 1,
    label: 'Declared skills but none verified',
    test: (r) => (r.skills || []).length >= 3 && (r.verifiedSkills || []).length === 0,
  },
];

export function riskFlags(row = {}, now = 0) {
  const flags = RISK_RULES.filter((rule) => {
    try { return rule.test(row, now); } catch { return false; }
  }).map(({ code, label, weight }) => ({ code, label, weight }));
  return { flags, severity: flags.reduce((s, f) => s + f.weight, 0) };
}

/* ---- Small distribution helpers. */
const scoreBucket = (v) => Math.min(4, Math.floor(num(v) / 20)); // 0-19 … 80-100
const inc = (m, k, by = 1) => { m[k] = (m[k] || 0) + by; return m; };
const isoWeek = (ts) => {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // Thursday of the week
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

/* ---- Weekly momentum series over a fixed trailing window. `events` is a
   flat list of { type, at } pairs harvested from verified submissions and
   resume analyses; only types in `types` are counted. */
export function momentumSeries(events = [], { now, weeks = 8, types = ['verification', 'resume'] } = {}) {
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const ts = now - i * 7 * DAY;
    buckets.push({ week: isoWeek(ts), counts: Object.fromEntries(types.map((t) => [t, 0])) });
  }
  const byWeek = new Map(buckets.map((b) => [b.week, b]));
  const horizon = now - weeks * 7 * DAY;
  for (const e of events) {
    if (!types.includes(e.type)) continue;
    const t = Date.parse(e.at);
    if (!Number.isFinite(t) || t < horizon || t > now) continue;
    const b = byWeek.get(isoWeek(t));
    if (b) b.counts[e.type] += 1;
  }
  return buckets;
}

/* ---- Main aggregate. `rows` are deep student rows (db.collegeStudentsDeep
   output, readiness already attached by the route); `drives` from the drive
   tracker; `events` optional momentum events; `now` injected epoch millis. */
export function buildObservability({ rows = [], drives = [], events = [], now = 0, riskLimit = 50 } = {}) {
  const n = rows.length;
  const avg = (sel) => {
    const vals = rows.map(sel).filter((v) => v != null && Number.isFinite(Number(v)));
    return vals.length ? Math.round(vals.reduce((a, b) => a + Number(b), 0) / vals.length) : 0;
  };

  const funnel = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0]));
  const engagement = Object.fromEntries(ENGAGEMENT_BUCKETS.map((b) => [b, 0]));
  const readinessBuckets = [0, 0, 0, 0, 0];
  const resumeBuckets = [0, 0, 0, 0, 0];
  const categories = {};
  const branch = new Map();
  const batch = new Map();
  const skills = new Map(); // skill -> { declared, verified }
  const risks = [];

  for (const r of rows) {
    inc(funnel, funnelStage(r));
    inc(engagement, engagementBucket(r.lastActiveAt, now));
    if (r.readinessScore != null) readinessBuckets[scoreBucket(r.readinessScore)] += 1;
    if (r.resumeScore != null) resumeBuckets[scoreBucket(r.resumeScore)] += 1;
    if (r.readinessCategory) inc(categories, r.readinessCategory);

    for (const [map, key] of [[branch, r.branch], [batch, r.batch]]) {
      const k = String(key || 'Unknown');
      if (!map.has(k)) map.set(k, { count: 0, readinessSum: 0, readinessN: 0, verified: 0, recruiterReady: 0, resumeSum: 0, resumeN: 0 });
      const e = map.get(k);
      e.count += 1;
      if (r.readinessScore != null) { e.readinessSum += num(r.readinessScore); e.readinessN += 1; }
      if (r.resumeScore != null) { e.resumeSum += num(r.resumeScore); e.resumeN += 1; }
      if (num(r.projectsVerified) > 0) e.verified += 1;
      if (num(r.recruiterReadyProjects) > 0) e.recruiterReady += 1;
    }

    for (const s of r.skills || []) {
      const k = String(s).trim(); if (!k) continue;
      if (!skills.has(k)) skills.set(k, { declared: 0, verified: 0 });
      skills.get(k).declared += 1;
    }
    for (const s of r.verifiedSkills || []) {
      const k = String(s).trim(); if (!k) continue;
      if (!skills.has(k)) skills.set(k, { declared: 0, verified: 0 });
      skills.get(k).verified += 1;
    }

    const risk = riskFlags(r, now);
    if (risk.severity > 0) {
      risks.push({
        id: r.id, name: r.name || r.email || 'Student', branch: r.branch || '', batch: r.batch || '',
        readinessScore: r.readinessScore ?? null, severity: risk.severity, flags: risk.flags,
      });
    }
  }

  const matrixOf = (map) => Array.from(map.entries())
    .map(([key, e]) => ({
      key, count: e.count,
      avgReadiness: e.readinessN ? Math.round(e.readinessSum / e.readinessN) : null,
      avgResume: e.resumeN ? Math.round(e.resumeSum / e.resumeN) : null,
      verifiedPct: e.count ? Math.round((e.verified / e.count) * 100) : 0,
      recruiterReadyPct: e.count ? Math.round((e.recruiterReady / e.count) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const openDrives = drives.filter((d) => (d.status || 'open') === 'open').length;
  const recruiterReadyCount = rows.filter((r) => funnelStage(r) === 'recruiter_ready').length;

  return {
    version: OBSERVABILITY_VERSION,
    computedAt: new Date(now).toISOString(),
    kpis: {
      students: n,
      avgReadiness: avg((r) => r.readinessScore),
      avgResume: avg((r) => r.resumeScore),
      placementReady: rows.filter((r) => num(r.readinessScore) >= 70).length,
      verifiedStudents: rows.filter((r) => num(r.projectsVerified) > 0).length,
      recruiterReady: recruiterReadyCount,
      active7: engagement.active7,
      atRisk: risks.length,
      openDrives,
      verifiedProjectsTotal: rows.reduce((s, r) => s + num(r.projectsVerified), 0),
      pendingReviews: rows.reduce((s, r) => s + num(r.projectsPending) + num(r.projectsNeedsReview), 0),
    },
    funnel: FUNNEL_STAGES.map((stage) => ({ stage, count: funnel[stage] })),
    readiness: { buckets: readinessBuckets, labels: ['0–19', '20–39', '40–59', '60–79', '80–100'], categories },
    resume: { buckets: resumeBuckets, labels: ['0–19', '20–39', '40–59', '60–79', '80–100'] },
    engagement,
    branchMatrix: matrixOf(branch),
    batchMatrix: matrixOf(batch),
    skillMatrix: Array.from(skills.entries())
      .map(([skill, v]) => ({ skill, declared: v.declared, verified: v.verified, gap: v.declared - v.verified }))
      .sort((a, b) => b.declared - a.declared)
      .slice(0, 30),
    riskRegister: risks.sort((a, b) => b.severity - a.severity).slice(0, riskLimit),
    momentum: momentumSeries(events, { now }),
    driveCoverage: { openDrives, recruiterReady: recruiterReadyCount, totalDrives: drives.length },
  };
}

/* ---- Extended CSV for the deep export (`/api/college/export?full=1`). */
export const DEEP_EXPORT_COLUMNS = [
  'id', 'name', 'email', 'branch', 'batch', 'year', 'targetRole',
  'readinessScore', 'readinessCategory', 'resumeScore', 'resumeAts', 'resumeImpact', 'resumeClarity',
  'skillsDeclared', 'skillsVerified', 'totalVerifiedXp',
  'projectsTotal', 'projectsVerified', 'projectsPending', 'projectsNeedsReview', 'projectsRejected',
  'recruiterReadyProjects', 'funnelStage', 'engagement', 'lastActiveAt', 'riskSeverity', 'riskFlags',
];

export function deepStudentCsv(rows = [], now = 0) {
  const line = csvLine; // csvSafe: neutralizes =,+,-,@ formula injection + RFC 4180 quoting
  const body = rows.map((r) => {
    const risk = riskFlags(r, now);
    const rec = {
      ...r,
      skillsDeclared: (r.skills || []).length,
      skillsVerified: (r.verifiedSkills || []).length,
      funnelStage: funnelStage(r),
      engagement: engagementBucket(r.lastActiveAt, now),
      riskSeverity: risk.severity,
      riskFlags: risk.flags.map((f) => f.code).join('|'),
    };
    return line(DEEP_EXPORT_COLUMNS.map((c) => rec[c]));
  });
  return [csvLine(DEEP_EXPORT_COLUMNS), ...body].join('\n');
}

export default {
  OBSERVABILITY_VERSION, FUNNEL_STAGES, ENGAGEMENT_BUCKETS, RISK_RULES,
  funnelStage, engagementBucket, riskFlags, momentumSeries, buildObservability, deepStudentCsv,
};
