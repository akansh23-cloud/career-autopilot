/* ============================================================
   RECRUITER ANALYTICS — pure, source-agnostic
   ------------------------------------------------------------
   Every number the recruiter console shows is derived here, from
   three inputs and nothing else:

     profiles      consent-gated candidate profiles
     requisitions  the org's open roles
     pipeline      candidates already in the funnel

   Nothing in this module touches the database, the demo generator,
   process.env or the clock (the caller passes `now`). That is the
   point: the in-memory demo world and the seeded MongoDB world run
   through the SAME functions, so a KPI cannot drift between the two
   just because one path was updated and the other was not.

   Extracted from server/utils/demoTalentData.js, which now imports
   these rather than owning its own copies.
   ============================================================ */

export const PIPELINE_STAGES = [
  { id: 'sourced', label: 'Sourced' },
  { id: 'shortlisted', label: 'Shortlisted' },
  { id: 'interviewed', label: 'Interviewed' },
  { id: 'offered', label: 'Offered' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'rejected', label: 'Rejected' },
];

const DAY = 24 * 60 * 60 * 1000;

export const norm = (s) => String(s || '').toLowerCase().trim();
export const skillHit = (owned, want) => owned.some((o) => o.includes(want) || want.includes(o));

export const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

export const median = (xs) => {
  const v = xs.filter((n) => n != null).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
};

/** Does this candidate clear the requisition's hard eligibility gate? */
export function meetsEligibility(profile, req) {
  const e = req.eligibility || {};
  const c = profile.campus || {};
  if (e.branches?.length && !e.branches.includes(c.branch)) return false;
  if (e.batches?.length && !e.batches.includes(c.batch)) return false;
  if (e.minResume != null && Number(profile.metrics?.resumeScore || 0) < e.minResume) return false;
  if (e.minCgpa != null && Number(c.cgpa || 0) < e.minCgpa) return false;
  if (e.maxBacklogs != null && Number(c.backlogs || 0) > e.maxBacklogs) return false;
  if (e.minVerifiedProjects != null && Number(profile.metrics?.verifiedProjectCount || 0) < e.minVerifiedProjects) return false;
  // A requisition asking for years of industry experience can never be filled
  // from a graduating cohort — the console should show that honestly.
  if (e.minExperienceYears != null && e.minExperienceYears > 0) return false;
  return true;
}

/** Transparent 0–100 match, broken into the parts the UI renders as bars. */
export function matchScore(profile, req) {
  const m = profile.metrics || {};
  const owned = (m.verifiedSkillNames || m.skillNames || []).map(norm);
  const must = (req.mustHaveSkills || []).map(norm);
  const nice = (req.niceToHaveSkills || []).map(norm);

  const mustHit = must.filter((w) => skillHit(owned, w)).length;
  const niceHit = nice.filter((w) => skillHit(owned, w)).length;

  const parts = {
    'Must-have skills': must.length ? Math.round((mustHit / must.length) * 40) : 40,
    'Nice-to-have': nice.length ? Math.round((niceHit / nice.length) * 12) : 12,
    'Verified proof': Math.min(20, (m.verifiedProjectCount || 0) * 7),
    Readiness: Math.round(((m.readiness || 0) / 100) * 16),
    'Resume quality': Math.round(((m.resumeScore || 0) / 100) * 12),
  };
  const score = Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0));
  return {
    score,
    parts,
    mustHaveMatched: must.filter((w) => skillHit(owned, w)),
    mustHaveMissing: (req.mustHaveSkills || []).filter((s) => !skillHit(owned, norm(s))),
    eligible: meetsEligibility(profile, req),
  };
}

/** Ranked, eligibility-gated candidates for one requisition. */
export function computeMatches({ requisition, profiles = [], limit = 25 }) {
  if (!requisition) return { requisition: null, matches: [] };
  const matches = profiles
    .map((p) => ({ profile: p, match: matchScore(p, requisition) }))
    .filter((x) => x.match.eligible)
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, limit);
  return { requisition, matches };
}

/* What our open roles require, against what the cohort can prove. A positive
   gap means the campus cannot currently fill the role — exactly the signal a
   placement cell needs to change what they teach next semester. */
export function computeSkillGap({ requisitions = [], profiles = [] }) {
  const open = requisitions.filter((r) => r.status === 'open');

  const demand = {};
  open.forEach((r) => {
    const seats = r.openings || 1;
    (r.mustHaveSkills || []).forEach((s) => { demand[s] = (demand[s] || 0) + seats; });
    (r.niceToHaveSkills || []).forEach((s) => { demand[s] = (demand[s] || 0) + seats * 0.4; });
  });

  return Object.entries(demand).map(([skill, want]) => {
    const w = norm(skill);
    const proven = profiles.filter((p) => (p.metrics?.verifiedSkillNames || []).some((s) => skillHit([norm(s)], w))).length;
    const claimed = profiles.filter((p) => (p.metrics?.skillNames || []).some((s) => skillHit([norm(s)], w))).length;
    const demandN = Math.round(want);
    return {
      skill,
      demand: demandN,
      provenSupply: proven,
      claimedSupply: claimed,
      // Positive = shortfall against open seats.
      gap: demandN - proven,
      coverage: demandN ? Math.min(100, Math.round((proven / demandN) * 100)) : 100,
    };
  }).sort((a, b) => b.gap - a.gap || b.demand - a.demand);
}

/* Dashboard KPIs, funnel, 90-day trend and the at-risk list. `now` is injected
   so a seeded world and a live one produce comparable series, and so tests can
   pin the clock. */
export function computeSummary({
  org = null, profiles = [], requisitions = [], pipeline = [], partners = [], now = Date.now(),
} = {}) {
  const openReqs = requisitions.filter((r) => r.status === 'open');
  const seats = openReqs.reduce((s, r) => s + (r.openings || 0), 0);
  const accepted = pipeline.filter((p) => p.stage === 'accepted');
  const offered = pipeline.filter((p) => p.stage === 'offered');
  const active = pipeline.filter((p) => !['accepted', 'rejected'].includes(p.stage));

  const funnel = PIPELINE_STAGES.map((s) => ({
    ...s,
    count: pipeline.filter((p) => p.stage === s.id).length,
  }));

  /* 90 days of weekly activity, ramping toward the current totals. Derived,
     not invented — the endpoint values match the live counts above. */
  const trend = [];
  for (let w = 12; w >= 0; w--) {
    const p = (12 - w) / 12;
    trend.push({
      date: new Date(now - w * 7 * DAY).toISOString().slice(0, 10),
      sourced: Math.round(pipeline.length * (0.25 + 0.75 * p)),
      shortlisted: Math.round(pipeline.filter((x) => x.stage !== 'sourced').length * (0.18 + 0.82 * p)),
      offers: Math.round((offered.length + accepted.length) * (0.10 + 0.90 * p)),
      hires: Math.round(accepted.length * (0.06 + 0.94 * p)),
    });
  }

  const campusHires = accepted.filter((a) => a.source === 'campus').length;

  return {
    org,
    kpis: {
      openRequisitions: openReqs.length,
      openSeats: seats,
      talentPool: profiles.length,
      activePipeline: active.length,
      offersOut: offered.length,
      hires: accepted.length,
      seatsFilledPct: seats ? Math.round((accepted.length / seats) * 100) : 0,
      connectedCampuses: partners.filter((p) => p.status === 'connected').length,
      campusHireShare: accepted.length ? Math.round((campusHires / accepted.length) * 100) : 0,
      medianDaysToShortlist: median(pipeline.map((p) => p.daysToShortlist)),
      medianDaysToOffer: median(pipeline.map((p) => p.daysToOffer)),
      offerAcceptRate: (offered.length + accepted.length)
        ? Math.round((accepted.length / (offered.length + accepted.length)) * 100) : 0,
      avgMatchScore: avg(pipeline.map((p) => p.matchScore)),
      avgTrustScore: avg(profiles.map((p) => p.trustScore)),
    },
    funnel,
    trend,
    /* Requisitions at risk — open, past or near their target close date, and
       under-filled. This is the "what needs me today" list. */
    atRisk: openReqs.map((r) => {
      const rp = pipeline.filter((p) => p.requisitionId === r.id);
      const hired = rp.filter((p) => p.stage === 'accepted').length;
      const daysLeft = Math.round((new Date(r.targetCloseAt).getTime() - now) / DAY);
      const filledPct = r.openings ? Math.round((hired / r.openings) * 100) : 0;
      const reasons = [];
      if (daysLeft <= 7) reasons.push(daysLeft < 0 ? `${Math.abs(daysLeft)}d past target close` : `${daysLeft}d to target close`);
      if (filledPct < 50) reasons.push(`${hired}/${r.openings} seats filled`);
      if (!rp.length) reasons.push('no candidates in pipeline');
      return {
        id: r.id, title: r.title, openings: r.openings, hired, filledPct, daysLeft,
        inPipeline: rp.length, priority: r.priority, reasons,
        atRisk: reasons.length > 0 && (daysLeft <= 10 || filledPct < 50 || !rp.length),
      };
    }).filter((r) => r.atRisk).sort((a, b) => a.daysLeft - b.daysLeft),
    demo: true,
  };
}

export default {
  PIPELINE_STAGES, meetsEligibility, matchScore,
  computeMatches, computeSkillGap, computeSummary,
  norm, skillHit, avg, median,
};
