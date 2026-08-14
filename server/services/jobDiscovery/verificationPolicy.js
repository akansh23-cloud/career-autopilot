/* ============================================================
   JOB DISCOVERY OS — ADAPTIVE VERIFICATION POLICY
   ------------------------------------------------------------
   Freshness is a COMPETITIVE feature, not a cron job. A fixed
   "re-verify everything after 7 days" spends the same budget on a
   two-hour-old direct-ATS posting as on a four-month-old aggregator
   record, which is exactly backwards: the new one is what users are
   about to click, and the old one is unlikely to change today.

   So verification frequency is earned. A job's tier is derived from
   evidence we actually hold:

       age            new postings churn; old ones rarely change
       source class   an original board answers definitively;
                      an aggregator link dying proves nothing
       velocity       a board that changes constantly needs
                      re-checking sooner than a dormant one
       volatility     a job that has already changed will change again
       status         anything already suspected gone is checked first

   Nothing here invents a date. It only decides WHEN to look again,
   and every decision carries the reason that produced it.
   ============================================================ */

import { JOB_STATUS, SOURCE_CLASS, SOURCE_AUTHORITY } from './schema.js';
import { ageDays } from './normalize/text.js';

export const VERIFY_TIER = Object.freeze({
  URGENT: 'URGENT',       // suspected closed / explicitly flagged
  HOT: 'HOT',             // brand new, high-value, direct source
  WARM: 'WARM',           // recent and active
  STEADY: 'STEADY',       // established listing
  COLD: 'COLD',           // old, low-velocity
  DORMANT: 'DORMANT',     // very old; verified rarely, never dropped
});

/** Hours between verifications, per tier. */
export const TIER_INTERVAL_HOURS = Object.freeze({
  [VERIFY_TIER.URGENT]: 1,
  [VERIFY_TIER.HOT]: 12,
  [VERIFY_TIER.WARM]: 48,
  [VERIFY_TIER.STEADY]: 24 * 7,
  [VERIFY_TIER.COLD]: 24 * 14,
  [VERIFY_TIER.DORMANT]: 24 * 30,
});

export function bestSourceClass(job) {
  const instances = job.sourceInstances || [];
  if (!instances.length) return null;
  let best = null;
  let bestScore = -1;
  for (const s of instances) {
    const score = SOURCE_AUTHORITY[s.sourceClass] ?? 0;
    if (score > bestScore) { bestScore = score; best = s.sourceClass; }
  }
  return best;
}

/**
 * Classify one job. Pure: takes the job and optional source health, returns a
 * tier plus the reasons that produced it.
 */
export function verificationTier(job, { now = Date.now(), sourceHealth = null } = {}) {
  const reasons = [];

  if (job.status === JOB_STATUS.REMOVED) {
    return { tier: VERIFY_TIER.DORMANT, reasons: ['job is REMOVED; no further verification'], intervalHours: null };
  }
  if (job.needsVerification || job.status === JOB_STATUS.STALE) {
    return { tier: VERIFY_TIER.URGENT, reasons: ['flagged for verification or missing from its source'], intervalHours: TIER_INTERVAL_HOURS[VERIFY_TIER.URGENT] };
  }

  /* Age is measured from the strongest date we hold, and the freshness engine's
     rule applies here too: a discovery time is not a posting date, it is just
     the best age evidence available when the source stated nothing. */
  const postedAge = ageDays(job.sourcePublishedAt, now);
  const seenAge = ageDays(job.firstSeenAt, now);
  const age = postedAge ?? seenAge ?? 999;

  const cls = bestSourceClass(job);
  const direct = cls === SOURCE_CLASS.ORIGINAL_ATS || cls === SOURCE_CLASS.ORIGINAL_CAREER_SITE;

  let score = 0;
  if (age <= 3) { score += 3; reasons.push('posting is less than 3 days old'); }
  else if (age <= 14) { score += 2; reasons.push('posting is less than 2 weeks old'); }
  else if (age <= 45) { score += 1; reasons.push('posting is less than 45 days old'); }
  else reasons.push('posting is over 45 days old');

  if (direct) { score += 1; reasons.push('carried by an original board, so a check is conclusive'); }
  else reasons.push('supplemental source only; a dead link here proves little');

  if (job.lastChangedAt && ageDays(job.lastChangedAt, now) <= 14) {
    score += 1;
    reasons.push('content changed recently, so it is likely to change again');
  }
  if (job.status === JOB_STATUS.LIKELY_ACTIVE) {
    score += 1;
    reasons.push('last observation was inconclusive');
  }
  const velocity = sourceHealth?.newJobRate;
  if (typeof velocity === 'number' && velocity > 0.15) {
    score += 1;
    reasons.push('source is high-velocity');
  }
  if ((job.completeness ?? 0) >= 80 && direct) {
    score += 1;
    reasons.push('high-completeness direct record is worth keeping accurate');
  }

  let tier;
  if (score >= 5) tier = VERIFY_TIER.HOT;
  else if (score >= 4) tier = VERIFY_TIER.WARM;
  else if (score >= 2) tier = VERIFY_TIER.STEADY;
  else if (score >= 1) tier = VERIFY_TIER.COLD;
  else tier = VERIFY_TIER.DORMANT;

  return { tier, reasons, intervalHours: TIER_INTERVAL_HOURS[tier], score };
}

/**
 * Stamp a job with its next verification time. Returns the SAME object when
 * nothing changed, so callers can skip a pointless write.
 */
export function applyVerificationSchedule(job, { now = Date.now(), sourceHealth = null, from = null } = {}) {
  const { tier, intervalHours, reasons } = verificationTier(job, { now, sourceHealth });
  if (intervalHours == null) {
    if (job.nextVerifyAt == null && job.verificationTier === tier) return job;
    return { ...job, nextVerifyAt: null, verificationTier: tier, verificationReasons: reasons };
  }
  const anchor = from ? Date.parse(from) : (job.lastVerifiedAt ? Date.parse(job.lastVerifiedAt) : now);
  const base = Number.isFinite(anchor) ? anchor : now;
  const nextVerifyAt = new Date(base + intervalHours * 3600000).toISOString();
  if (job.nextVerifyAt === nextVerifyAt && job.verificationTier === tier) return job;
  return { ...job, nextVerifyAt, verificationTier: tier, verificationReasons: reasons };
}

/** Is this job due right now under the adaptive policy? */
export function isVerificationDue(job, { now = Date.now() } = {}) {
  if (job.status === JOB_STATUS.REMOVED) return false;
  if (job.needsVerification || job.status === JOB_STATUS.STALE) return true;
  if (!job.nextVerifyAt) {
    /* Never scheduled: a job we have never verified is due once it has had a
       chance to settle, which preserves the pre-existing behaviour. */
    const seen = ageDays(job.firstSeenAt, now);
    return job.lastVerifiedAt ? false : (seen == null || seen >= 1);
  }
  return Date.parse(job.nextVerifyAt) <= now;
}

/**
 * Budget allocation across tiers. Given N checks per tick, spend them where
 * they buy the most freshness rather than in id order.
 */
export function allocateVerificationBudget(jobs = [], { limit = 25, now = Date.now(), sourceHealth = () => null } = {}) {
  const ranked = jobs
    .filter((j) => isVerificationDue(j, { now }))
    .map((job) => {
      const t = verificationTier(job, { now, sourceHealth: sourceHealth(job) });
      return { job, tier: t.tier, weight: TIER_WEIGHT[t.tier] ?? 0, overdueMs: overdueBy(job, now) };
    })
    .sort((a, b) => b.weight - a.weight || b.overdueMs - a.overdueMs || String(a.job.id).localeCompare(String(b.job.id)));
  return ranked.slice(0, limit);
}

const TIER_WEIGHT = Object.freeze({
  [VERIFY_TIER.URGENT]: 100,
  [VERIFY_TIER.HOT]: 60,
  [VERIFY_TIER.WARM]: 40,
  [VERIFY_TIER.STEADY]: 20,
  [VERIFY_TIER.COLD]: 10,
  [VERIFY_TIER.DORMANT]: 1,
});

function overdueBy(job, now) {
  if (!job.nextVerifyAt) return 0;
  const due = Date.parse(job.nextVerifyAt);
  return Number.isFinite(due) ? Math.max(0, now - due) : 0;
}

export default {
  VERIFY_TIER, TIER_INTERVAL_HOURS, verificationTier, applyVerificationSchedule,
  isVerificationDue, allocateVerificationBudget, bestSourceClass,
};
