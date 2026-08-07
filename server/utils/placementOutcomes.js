/* ============================================================
   Placement outcomes engine
   ------------------------------------------------------------
   The readiness side of the product measures whether a student is
   ready. This module measures what actually HAPPENED — applications,
   shortlists, interviews, offers, acceptances — and turns them into
   the numbers a placement cell reports upward (placement %, median
   and highest package, recruiter list, branch-wise splits).

   Everything here is pure and deterministic: no AI, no I/O, no
   randomness. Give it rows + drives + outcomes and it returns the
   same answer every time, which is the only way a number is safe to
   print on an accreditation return.

   Vocabulary (deliberately the Indian TPO's, not a generic CRM's):
     - CTC is stored in LPA (lakhs per annum), the unit every Indian
       placement report uses. Never paise, never USD.
     - "Placed" means the student ACCEPTED an offer. An outstanding
       offer is not a placement — counting it as one is how placement
       percentages get quietly inflated.
     - "Eligible" is per drive and rule-based, never a human guess.
   ============================================================ */

export const PLACEMENT_ENGINE_VERSION = 'placement-outcomes-v1';

/* Ordered pipeline. Index = depth, used for funnel + "furthest stage". */
export const PLACEMENT_STAGES = [
  { id: 'applied', label: 'Applied', terminal: false },
  { id: 'shortlisted', label: 'Shortlisted', terminal: false },
  { id: 'interviewed', label: 'Interviewed', terminal: false },
  { id: 'offered', label: 'Offered', terminal: false },
  { id: 'accepted', label: 'Accepted', terminal: true },
  { id: 'rejected', label: 'Not selected', terminal: true },
  { id: 'withdrawn', label: 'Withdrawn', terminal: true },
];

export const STAGE_IDS = PLACEMENT_STAGES.map((s) => s.id);

/* The forward funnel only — rejected/withdrawn are exits, not depths. */
export const FUNNEL_STAGE_IDS = ['applied', 'shortlisted', 'interviewed', 'offered', 'accepted'];

export function isValidStage(stage) {
  return STAGE_IDS.includes(String(stage));
}

export function stageLabel(stage) {
  return (PLACEMENT_STAGES.find((s) => s.id === stage) || {}).label || String(stage || '');
}

export function stageDepth(stage) {
  const i = FUNNEL_STAGE_IDS.indexOf(String(stage));
  return i < 0 ? -1 : i;
}

/** Placed = accepted an offer. Nothing else counts. */
export function isPlaced(outcome = {}) {
  return String(outcome.stage) === 'accepted';
}

/** Holds an offer (accepted or outstanding) — used for package statistics. */
export function hasOffer(outcome = {}) {
  return String(outcome.stage) === 'offered' || String(outcome.stage) === 'accepted';
}

/* ------------------------------------------------------------------
   Eligibility — rule-based, explainable, and always reversible.
   Every rejection carries a human-readable reason so a TPO can tell a
   student exactly why they were filtered out of a drive.
   ------------------------------------------------------------------ */

function asList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (v == null || v === '') return [];
  return String(v).split(',').map((x) => x.trim()).filter(Boolean);
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const eqi = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * Check one student against one drive's eligibility rules.
 * @returns {{ eligible: boolean, reasons: string[] }} reasons are FAILURE reasons.
 */
export function eligibilityCheck(student = {}, eligibility = {}) {
  const reasons = [];

  const branches = asList(eligibility.branches);
  if (branches.length && !branches.some((b) => eqi(b, student.branch))) {
    reasons.push(`Branch ${student.branch || '—'} not in ${branches.join(', ')}`);
  }

  const batches = asList(eligibility.batches);
  if (batches.length && !batches.some((b) => eqi(b, student.batch))) {
    reasons.push(`Batch ${student.batch || '—'} not in ${batches.join(', ')}`);
  }

  const years = asList(eligibility.years);
  if (years.length && !years.some((y) => eqi(y, student.year))) {
    reasons.push(`Year ${student.year || '—'} not in ${years.join(', ')}`);
  }

  const minReadiness = num(eligibility.minReadiness);
  if (minReadiness != null && Number(student.readinessScore || 0) < minReadiness) {
    reasons.push(`Readiness ${student.readinessScore ?? 0} below ${minReadiness}`);
  }

  const minResume = num(eligibility.minResume);
  if (minResume != null && Number(student.resumeScore || 0) < minResume) {
    reasons.push(
      student.resumeScore == null
        ? `No resume on file (drive needs ${minResume}+)`
        : `Resume ${student.resumeScore} below ${minResume}`
    );
  }

  const minVerifiedProjects = num(eligibility.minVerifiedProjects);
  const verified = Number(student.projectsVerified ?? student.verifiedProjects ?? 0);
  if (minVerifiedProjects != null && verified < minVerifiedProjects) {
    reasons.push(`${verified} verified project(s), drive needs ${minVerifiedProjects}`);
  }

  // Skills are matched against DECLARED skills but reported honestly: a drive
  // can additionally demand the skill be verified.
  const skills = asList(eligibility.skills);
  if (skills.length) {
    const declared = (student.skills || []).map((s) => String(s).toLowerCase());
    const verifiedSkills = (student.verifiedSkills || []).map((s) => String(s).toLowerCase());
    const pool = eligibility.requireVerifiedSkills ? verifiedSkills : declared;
    const missing = skills.filter((s) => !pool.some((p) => p.includes(String(s).toLowerCase())));
    if (missing.length) {
      reasons.push(
        `Missing ${eligibility.requireVerifiedSkills ? 'verified ' : ''}skill(s): ${missing.join(', ')}`
      );
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

/**
 * Split a cohort against a drive.
 * @returns {{ eligible: object[], ineligible: object[], eligibleCount, total }}
 */
export function matchDriveCohort(rows = [], drive = {}) {
  const eligibility = drive.eligibility || {};
  const eligible = [];
  const ineligible = [];
  for (const r of rows) {
    const check = eligibilityCheck(r, eligibility);
    if (check.eligible) eligible.push({ ...r, eligible: true, reasons: [] });
    else ineligible.push({ ...r, eligible: false, reasons: check.reasons });
  }
  eligible.sort((a, b) => (b.readinessScore || 0) - (a.readinessScore || 0));
  ineligible.sort((a, b) => (b.readinessScore || 0) - (a.readinessScore || 0));
  return { eligible, ineligible, eligibleCount: eligible.length, total: rows.length };
}

/* ------------------------------------------------------------------
   Drive funnel
   ------------------------------------------------------------------ */

/**
 * Funnel for one drive. A student counts at their FURTHEST reached stage
 * and at every stage before it — that is what makes a funnel monotonic
 * and therefore honest. Rejected/withdrawn are reported separately.
 */
export function buildDriveFunnel(outcomes = []) {
  const counts = Object.fromEntries(FUNNEL_STAGE_IDS.map((s) => [s, 0]));
  let rejected = 0;
  let withdrawn = 0;

  for (const o of outcomes) {
    const stage = String(o.stage || '');
    if (stage === 'rejected') { rejected++; }
    if (stage === 'withdrawn') { withdrawn++; }
    // furthestStage lets a rejected candidate still be counted in the rounds
    // they genuinely cleared, instead of vanishing from the funnel entirely.
    const furthest = stageDepth(o.furthestStage || stage);
    const depth = furthest >= 0 ? furthest : (stage === 'rejected' || stage === 'withdrawn' ? 0 : -1);
    for (let i = 0; i <= depth; i++) counts[FUNNEL_STAGE_IDS[i]]++;
  }

  const stages = FUNNEL_STAGE_IDS.map((id, i) => {
    const count = counts[id];
    const prev = i === 0 ? count : counts[FUNNEL_STAGE_IDS[i - 1]];
    return {
      id,
      label: stageLabel(id),
      count,
      conversionFromPrev: prev > 0 ? Math.round((count / prev) * 100) : 0,
      conversionFromTop: counts[FUNNEL_STAGE_IDS[0]] > 0
        ? Math.round((count / counts[FUNNEL_STAGE_IDS[0]]) * 100) : 0,
    };
  });

  return {
    stages,
    rejected,
    withdrawn,
    participants: outcomes.length,
    offerRate: counts.applied > 0 ? Math.round((counts.offered / counts.applied) * 100) : 0,
  };
}

/* ------------------------------------------------------------------
   Cohort placement statistics
   ------------------------------------------------------------------ */

/* null and '' must never reach Number() here — Number(null) is 0, which would
   silently drag a median down and turn "package not recorded" into a ₹0 offer.
   A missing figure is excluded from the statistic, never counted as zero. */
const numeric = (values = []) => values
  .filter((v) => v != null && v !== '' && typeof v !== 'boolean')
  .map(Number)
  .filter((n) => Number.isFinite(n));

export function median(values = []) {
  const nums = numeric(values).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  const m = nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  return Math.round(m * 100) / 100;
}

function mean(values = []) {
  const nums = numeric(values);
  if (!nums.length) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

/**
 * The report a placement cell actually sends to its director.
 *
 * @param rows      cohort rows (readiness already attached)
 * @param drives    placement drives for the college
 * @param outcomes  flat outcome records { driveId, studentId, stage, ctcLpa, ... }
 */
export function buildPlacementStats({ rows = [], drives = [], outcomes = [], now = Date.now() } = {}) {
  const driveById = new Map(drives.map((d) => [String(d.id), d]));
  const studentById = new Map(rows.map((r) => [String(r.id), r]));

  // Collapse to one record per student per drive (latest wins), then to the
  // student's best result overall. A student with three offers is ONE placement.
  const perStudent = new Map(); // studentId -> { placed, offers: [], best }
  for (const o of outcomes) {
    const sid = String(o.studentId || '');
    if (!sid) continue;
    const entry = perStudent.get(sid) || { studentId: sid, offers: [], placedWith: null, deepest: -1, stages: [] };
    entry.stages.push(o);
    const depth = stageDepth(o.furthestStage || o.stage);
    if (depth > entry.deepest) entry.deepest = depth;
    if (hasOffer(o)) {
      entry.offers.push({
        driveId: String(o.driveId || ''),
        company: o.company || driveById.get(String(o.driveId))?.company || '',
        role: o.role || driveById.get(String(o.driveId))?.title || '',
        ctcLpa: num(o.ctcLpa),
        accepted: isPlaced(o),
        offerAt: o.offerAt || o.updatedAt || null,
      });
    }
    if (isPlaced(o)) entry.placedWith = entry.placedWith || o;
    perStudent.set(sid, entry);
  }

  const students = rows.length;

  /* ---- Placement rate is reported over the GRADUATING cohort, not the whole
     college. A department with four year-groups on the platform has ~75% of
     its students not yet placeable; dividing by all of them reports a rate no
     TPO recognises and no NAAC/NBA return would accept.

     The graduating cohort is derived from the drives themselves — the union of
     the batches the college's drives actually target — so it needs no separate
     configuration and stays correct as the season rolls over. When no drive
     declares a batch (a fresh college, or a single-batch pilot) this falls back
     to the full roster, which is the previous behaviour exactly.

     Both numbers are returned: `placementRate` over the graduating batch is
     the headline, `placementRateAllStudents` is kept so nothing that consumed
     the old figure silently changes meaning. ---- */
  const targetBatches = new Set(
    drives.flatMap((d) => (d.eligibility?.batches || []).map((x) => String(x)))
  );
  const placementCohort = targetBatches.size
    ? rows.filter((r) => targetBatches.has(String(r.batch)))
    : rows;
  const placementCohortSize = placementCohort.length || students;
  const graduatingBatches = [...targetBatches].sort();

  const participated = perStudent.size;
  const placedEntries = [...perStudent.values()].filter((e) => e.placedWith);
  const placed = placedEntries.length;

  // Package statistics are computed over ACCEPTED offers where a CTC was
  // actually recorded. Missing CTCs are excluded and counted, never treated
  // as zero — a zero would silently drag the median down.
  const acceptedCtcs = [];
  let offersWithoutCtc = 0;
  for (const e of placedEntries) {
    const accepted = e.offers.find((o) => o.accepted && o.ctcLpa != null);
    if (accepted) acceptedCtcs.push(accepted.ctcLpa);
    else offersWithoutCtc++;
  }

  const allOffers = [...perStudent.values()].flatMap((e) => e.offers);
  const multiOffer = [...perStudent.values()].filter((e) => e.offers.length > 1).length;

  // Branch / batch splits
  const groupBy = (key) => {
    const m = new Map();
    for (const r of rows) {
      const k = String(r[key] || 'Unknown');
      const g = m.get(k) || { key: k, total: 0, placed: 0, ctcs: [] };
      g.total++;
      const e = perStudent.get(String(r.id));
      if (e?.placedWith) {
        g.placed++;
        const acc = e.offers.find((o) => o.accepted && o.ctcLpa != null);
        if (acc) g.ctcs.push(acc.ctcLpa);
      }
      m.set(k, g);
    }
    return [...m.values()]
      .map((g) => ({
        key: g.key,
        total: g.total,
        placed: g.placed,
        placementRate: pct(g.placed, g.total),
        medianCtc: median(g.ctcs),
        highestCtc: g.ctcs.length ? Math.max(...g.ctcs) : 0,
      }))
      .sort((a, b) => b.placementRate - a.placementRate || b.total - a.total);
  };

  // Recruiters, ranked by hires then by package.
  const recruiterMap = new Map();
  for (const e of placedEntries) {
    const acc = e.offers.find((o) => o.accepted) || e.offers[0];
    if (!acc) continue;
    const name = acc.company || 'Unknown';
    const g = recruiterMap.get(name) || { company: name, hires: 0, ctcs: [] };
    g.hires++;
    if (acc.ctcLpa != null) g.ctcs.push(acc.ctcLpa);
    recruiterMap.set(name, g);
  }
  const topRecruiters = [...recruiterMap.values()]
    .map((g) => ({ company: g.company, hires: g.hires, medianCtc: median(g.ctcs), highestCtc: g.ctcs.length ? Math.max(...g.ctcs) : 0 }))
    .sort((a, b) => b.hires - a.hires || b.medianCtc - a.medianCtc);

  // The most actionable list in the whole product: students the system says
  // are ready, who still have nothing to show for it.
  const readyUnplaced = rows
    .filter((r) => Number(r.readinessScore || 0) >= 70 && !perStudent.get(String(r.id))?.placedWith)
    .map((r) => ({
      id: r.id, name: r.name, email: r.email, branch: r.branch, batch: r.batch,
      readinessScore: r.readinessScore,
      applications: (perStudent.get(String(r.id))?.stages || []).length,
    }))
    .sort((a, b) => (b.readinessScore || 0) - (a.readinessScore || 0));

  // ...and its mirror: students who got placed while scoring low, which is the
  // signal that the readiness model needs recalibration for this college.
  const placedLowReadiness = placedEntries
    .map((e) => studentById.get(e.studentId))
    .filter((s) => s && Number(s.readinessScore || 0) < 50)
    .length;

  const activeDrives = drives.filter((d) => String(d.status || 'open') === 'open').length;

  return {
    version: PLACEMENT_ENGINE_VERSION,
    generatedAt: new Date(now).toISOString(),
    summary: {
      students,
      // The cohort the placement rate is actually computed over.
      placementCohortSize,
      graduatingBatches,
      participated,
      participationRate: pct(participated, placementCohortSize),
      placed,
      placementRate: pct(placed, placementCohortSize),
      placementRateAllStudents: pct(placed, students),
      offers: allOffers.length,
      multiOffer,
      medianCtc: median(acceptedCtcs),
      avgCtc: mean(acceptedCtcs),
      highestCtc: acceptedCtcs.length ? Math.max(...acceptedCtcs) : 0,
      lowestCtc: acceptedCtcs.length ? Math.min(...acceptedCtcs) : 0,
      ctcCoverage: pct(acceptedCtcs.length, placed),
      offersWithoutCtc,
      drives: drives.length,
      activeDrives,
      recruiters: topRecruiters.length,
      placedLowReadiness,
    },
    byBranch: groupBy('branch'),
    byBatch: groupBy('batch'),
    topRecruiters,
    readyUnplaced,
  };
}

/** Per-drive roll-up for the drive list — cheap enough to compute for all. */
export function summarizeDrives({ drives = [], outcomes = [], rows = [] } = {}) {
  const byDrive = new Map();
  for (const o of outcomes) {
    const k = String(o.driveId || '');
    if (!byDrive.has(k)) byDrive.set(k, []);
    byDrive.get(k).push(o);
  }
  return drives.map((d) => {
    const mine = byDrive.get(String(d.id)) || [];
    const funnel = buildDriveFunnel(mine);
    const offers = mine.filter(hasOffer);
    const accepted = mine.filter(isPlaced);
    const ctcs = accepted.map((o) => num(o.ctcLpa)).filter((n) => n != null);
    const { eligibleCount } = matchDriveCohort(rows, d);
    return {
      ...d,
      eligibleCount,
      participants: mine.length,
      shortlisted: funnel.stages.find((s) => s.id === 'shortlisted')?.count || 0,
      offered: offers.length,
      placed: accepted.length,
      medianCtc: median(ctcs),
      highestCtc: ctcs.length ? Math.max(...ctcs) : 0,
      offerRate: funnel.offerRate,
    };
  });
}

export default {
  PLACEMENT_ENGINE_VERSION, PLACEMENT_STAGES, STAGE_IDS, FUNNEL_STAGE_IDS,
  isValidStage, stageLabel, stageDepth, isPlaced, hasOffer,
  eligibilityCheck, matchDriveCohort, buildDriveFunnel, buildPlacementStats,
  summarizeDrives, median,
};
