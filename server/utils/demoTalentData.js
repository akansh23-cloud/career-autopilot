/* ============================================================
   Demo talent world — the RECRUITER side of the demo.
   ------------------------------------------------------------
   The placement-cell demo (server/utils/demoCollegeData.js) builds
   a 200-student cohort with drives, outcomes and 90 days of
   snapshots. This module does NOT invent a second, parallel
   population. It reads that same cohort and projects it through a
   recruiter's lens.

   That is the whole point. If the recruiter console showed a
   different set of people than the college console, the "bridge"
   between them would be a claim rather than a demonstration. Here,
   when a TPO verifies a student's project in the college view, that
   student is the one a recruiter can find — same id, same skills,
   same proof. One world, two doors.

   WHAT THIS MODULE ADDS ON TOP OF THE COHORT:
     · A recruiting org (Northwind Systems) with its own requisitions
     · A consent-gated talent pool (only students whose proof a
       recruiter can actually open)
     · A pipeline (applied -> shortlisted -> interviewed -> offered
       -> accepted/rejected) generated against those requisitions
     · Campus partners — the bridge object: one connected college
       with live cohort numbers, plus invited/pending ones
     · Skill supply-vs-demand, computed by comparing what the
       requisitions ask for against what the cohort actually has

   CONSENT MODEL (mirrors the real /api/network/candidates rules):
     A student is only visible to recruiters if they have at least
     one RECRUITER-READY project — that is, verified work with a
     reachable link. Verified-but-not-published students stay
     invisible. Within the visible pool, roughly two thirds are
     openToRecruiters (direct contact allowed) and the rest are
     published_only (introduction requests only). The UI already
     distinguishes these two; this data exercises both paths.

   SAFETY: served only when DEMO_MODE is on AND no real database is
   connected — the same gate demoCollegeData uses. Every record is
   obviously synthetic: ids are prefixed `demo_`, every address ends
   in the IANA-reserved `.test` TLD that can never route, and
   nothing here is ever written anywhere. It is generated per call
   and thrown away, so it can never mix with a real recruiter's
   records.

   Deterministic: seeded RNG + a fixed epoch, so a re-recorded demo
   take looks identical to the first one.
   ============================================================ */

import {
  DEMO_COLLEGE_ID, DEMO_COLLEGE_NAME, DEMO_DOMAIN, DEMO_TPO_EMAIL,
  DEMO_STUDENT_COUNT, BRANCH_LIST,
  demoModeEnabled, demoStudentsDeep, demoStudentDetail, demoDrives, demoOutcomes,
} from './demoCollegeData.js';

/* Matching, skill-gap and KPI maths live in recruiterAnalytics.js so the
   seeded MongoDB world runs through exactly the same code as this in-memory
   one. This module owns the WORLD (who exists, what they applied to); it does
   not own the arithmetic. */
import {
  PIPELINE_STAGES, meetsEligibility, matchScore,
  computeMatches, computeSkillGap, computeSummary, avg,
} from './recruiterAnalytics.js';

export { demoModeEnabled };
export { PIPELINE_STAGES, meetsEligibility, matchScore };

export const DEMO_ORG_ID = 'demo-northwind-systems';
export const DEMO_ORG_NAME = 'Northwind Systems';
export const DEMO_ORG_DOMAIN = 'northwind-systems.test';
export const DEMO_RECRUITER_EMAIL = `talent@${DEMO_ORG_DOMAIN}`;

const DAY = 24 * 60 * 60 * 1000;
/* One epoch for the whole process — every relative timestamp derives from it,
   so repeated calls return byte-identical payloads. */
const EPOCH = Date.now();

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const ago = (d) => new Date(EPOCH - d * DAY).toISOString();
const ahead = (d) => new Date(EPOCH + d * DAY).toISOString();

/* ============================================================
   1. TALENT POOL
   ============================================================ */

const LEVELS = [
  [3000, 'Principal'], [2200, 'Lead'], [1500, 'Senior Builder'],
  [900, 'Builder'], [400, 'Apprentice'], [0, 'Starter'],
];
const levelFor = (xp) => (LEVELS.find(([min]) => xp >= min) || LEVELS[LEVELS.length - 1])[1];

const TRACK_BY_BRANCH = {
  'CSE (AI & ML)': 'AI/ML',
  'CSE (Big Data)': 'Data',
  'CSE (Cloud Computing)': 'Cloud',
  'CSE (DevOps)': 'DevOps',
};

let _talentCache = null;

function buildTalent() {
  const rng = mulberry32(0x7A1E27);
  const { rows } = demoStudentsDeep();

  /* Consent gate: a recruiter may only see students whose proof they can
     actually open. `recruiterReadyProjects` is exactly that — verified work
     with a live link — so it is the honest gate, and it is the same field the
     college console reports as "recruiter ready". */
  const eligible = rows.filter((r) => (r.recruiterReadyProjects || 0) > 0);

  return eligible.map((row) => {
    const detail = demoStudentDetail(row.id) || { projects: [], skillLedger: [] };
    const projects = detail.projects || [];
    const openProjects = projects.filter((p) => p.githubUrl || p.liveDemoUrl);

    const careerXP = (row.totalVerifiedXp || 0) + Math.round((row.totalPendingXp || 0) * 0.4);
    const perSkill = Math.max(1, row.verifiedSkills.length);

    /* Skill XP is split across the student's VERIFIED skills only, then jittered
       so the ordering is not a flat line. Unverified skills are listed by name
       but carry no XP — a recruiter filtering on XP should not be able to match
       on something nobody checked. */
    const topSkills = row.verifiedSkills.map((skillName, i) => {
      const xp = Math.max(40, Math.round((row.totalVerifiedXp / perSkill) * (1.25 - i * 0.12)));
      return {
        // Both keys on purpose: the metrics snapshot written by the web client
        // uses `name`, the recruiter console reads `skillName`. Emitting both
        // means demo and real profiles render identically in every surface.
        skillName, name: skillName, xp,
        level: xp >= 900 ? 'Expert' : xp >= 500 ? 'Proficient' : xp >= 200 ? 'Practised' : 'Familiar',
      };
    }).sort((a, b) => b.xp - a.xp);

    const avgProofScore = Math.max(
      35,
      Math.min(98, Math.round((row.readinessScore || 50) * 0.6 + (row.resumeScore || 50) * 0.4 + between(rng, -5, 5))),
    );

    /* Two thirds allow direct contact; the rest are discoverable but must be
       approached through an introduction request. Seeded, so the split is
       stable across runs. */
    const openToRecruiters = rng() < 0.66;

    const trustScore = Math.max(
      20,
      Math.min(99, Math.round(
        (row.readinessScore || 0) * 0.45
        + Math.min(100, (row.projectsVerified || 0) * 22) * 0.25
        + Math.min(100, (row.recruiterReadyProjects || 0) * 30) * 0.20
        + (row.resumeScore || 0) * 0.10,
      )),
    );
    const trustLevel = trustScore >= 80 ? 'Verified' : trustScore >= 60 ? 'Established' : trustScore >= 40 ? 'Emerging' : 'New';

    const daysSinceActive = row.lastActiveAt
      ? Math.round((EPOCH - new Date(row.lastActiveAt).getTime()) / DAY) : 999;

    return {
      userId: row.id,
      name: row.name,
      picture: null,
      role: 'student',
      targetRole: row.targetRole || '',
      track: TRACK_BY_BRANCH[row.branch] || 'Software',
      visibility: openToRecruiters ? 'public' : 'published_only',
      openToRecruiters,
      openToReferrals: true,
      openToCollaboration: rng() < 0.5,
      openToInternships: row.batch !== '2026',
      openToJobs: row.batch === '2026',
      location: pick(rng, ['Pune', 'Pune', 'Nashik', 'Mumbai', 'Pune / Remote']),
      college: DEMO_COLLEGE_NAME,
      collegeId: DEMO_COLLEGE_ID,
      company: '',
      /* Campus context — this is what the college console knows and what makes
         a recruiter's campus filters (branch, batch, CGPA) work at all. */
      campus: {
        collegeId: DEMO_COLLEGE_ID,
        collegeName: DEMO_COLLEGE_NAME,
        branch: row.branch,
        branchShort: row.branchShort,
        batch: row.batch,
        year: row.year,
        rollNo: row.rollNo,
        cgpa: row.cgpa,
        backlogs: row.backlogs,
        readinessScore: row.readinessScore,
        readinessCategory: row.readinessCategory,
        placementCell: DEMO_TPO_EMAIL,
      },
      links: {
        github: openProjects[0]?.githubUrl ? `https://github.com/demo-institute` : '',
        linkedin: '',
        portfolio: openProjects[0]?.liveDemoUrl || '',
      },
      metrics: {
        careerXP,
        level: levelFor(careerXP),
        topSkills: topSkills.slice(0, 6),
        skillNames: row.skills,
        verifiedSkillNames: row.verifiedSkills,
        verifiedBadges: row.verifiedSkills.length,
        badgeCount: row.skills.length,
        avgProofScore,
        readiness: row.readinessScore,
        publishedCount: row.recruiterReadyProjects || 0,
        verifiedProjectCount: row.projectsVerified || 0,
        hasGithub: openProjects.some((p) => !!p.githubUrl),
        hasGithubVerified: openProjects.some((p) => !!p.githubUrl),
        hasLive: openProjects.some((p) => !!p.liveDemoUrl),
        hasLiveVerified: openProjects.some((p) => !!p.liveDemoUrl),
        resumeScore: row.resumeScore,
        recentActiveDays: daysSinceActive,
        bestProjects: openProjects.slice(0, 4).map((p) => ({
          id: p.id, title: p.title, proofScore: avgProofScore,
          github: p.githubUrl || '', live: p.liveDemoUrl || '',
          skills: row.verifiedSkills.slice(0, 5),
          discipline: p.discipline,
          updatedRecently: true,
        })),
        /* Credentials feed the verification report modal the console already
           renders. Each one points at a project that genuinely exists in the
           college-side data for this same student. */
        credentials: openProjects.slice(0, 3).map((p, i) => ({
          id: `demo_cred_${row.id}_${i + 1}`,
          type: 'project_verification',
          subject: p.title,
          skill: row.verifiedSkills[i] || row.verifiedSkills[0] || 'Engineering',
          issuer: DEMO_COLLEGE_NAME,
          issuedAt: p.updatedAt,
          status: 'verified',
          evidence: { github: p.githubUrl || '', live: p.liveDemoUrl || '' },
        })),
      },
      trustScore,
      trustLevel,
      completeness: Math.min(100, 55 + (row.recruiterReadyProjects || 0) * 12 + (row.resumeScore ? 10 : 0)),
      updatedAt: row.lastActiveAt || ago(3),
      demo: true,
    };
  }).sort((a, b) => b.trustScore - a.trustScore);
}

/** The consent-gated talent pool, shaped exactly like db.networkPublicView. */
export function demoTalentProfiles() {
  if (!_talentCache) _talentCache = buildTalent();
  return _talentCache.map((p) => ({ ...p }));
}

/* ============================================================
   2. REQUISITIONS
   ============================================================ */

/* The demo recruiter works at ONE company, so their console shows their own
   openings — not the college's whole drive calendar. Two of these are campus
   requisitions raised against Demo Institute (they mirror drives the college
   console already shows), the rest are off-campus. That mix is what makes the
   campus-vs-market comparison on the dashboard meaningful. */
export function demoRequisitions() {
  const AIML = 'CSE (AI & ML)';
  const BDA = 'CSE (Big Data)';
  const CC = 'CSE (Cloud Computing)';
  const DVO = 'CSE (DevOps)';

  return [
    {
      id: 'demo_req_1', title: 'Backend Engineer — Campus Hire 2026', role: 'SDE-1',
      department: 'Platform', location: 'Pune', workMode: 'Hybrid', ctcLpa: 11,
      openings: 6, type: 'campus', status: 'open', priority: 'high',
      collegeId: DEMO_COLLEGE_ID, collegeName: DEMO_COLLEGE_NAME,
      linkedDriveId: 'demo_drive_1',
      hiringManager: 'R. Deshpande', recruiter: 'You',
      mustHaveSkills: ['Node.js', 'REST APIs', 'SQL', 'Docker'],
      niceToHaveSkills: ['Kubernetes', 'Redis', 'Microservices'],
      eligibility: { branches: [CC, DVO], batches: ['2026'], minResume: 65, minCgpa: 6.5, maxBacklogs: 0 },
      slaDays: 30, createdAt: ago(24), targetCloseAt: ahead(11), demo: true,
    },
    {
      id: 'demo_req_2', title: 'Machine Learning Engineer — New Grad', role: 'ML Engineer',
      department: 'Applied AI', location: 'Bengaluru', workMode: 'Onsite', ctcLpa: 14,
      openings: 3, type: 'campus', status: 'open', priority: 'high',
      collegeId: DEMO_COLLEGE_ID, collegeName: DEMO_COLLEGE_NAME,
      linkedDriveId: 'demo_drive_3',
      hiringManager: 'S. Krishnan', recruiter: 'You',
      mustHaveSkills: ['Python', 'Machine Learning', 'PyTorch'],
      niceToHaveSkills: ['NLP', 'Computer Vision', 'MLflow'],
      eligibility: { branches: [AIML], batches: ['2026'], minResume: 68, minVerifiedProjects: 1, minCgpa: 7 },
      slaDays: 45, createdAt: ago(17), targetCloseAt: ahead(28), demo: true,
    },
    {
      id: 'demo_req_3', title: 'Data Engineer — Analytics Platform', role: 'Data Engineer',
      department: 'Data', location: 'Pune', workMode: 'Hybrid', ctcLpa: 9.5,
      openings: 4, type: 'campus', status: 'open', priority: 'medium',
      collegeId: DEMO_COLLEGE_ID, collegeName: DEMO_COLLEGE_NAME,
      linkedDriveId: 'demo_drive_4',
      hiringManager: 'A. Fernandes', recruiter: 'You',
      mustHaveSkills: ['SQL', 'Apache Spark', 'ETL', 'Python'],
      niceToHaveSkills: ['Kafka', 'Hive', 'Power BI'],
      eligibility: { branches: [BDA, AIML], batches: ['2026'], minResume: 60, minCgpa: 6.5 },
      slaDays: 30, createdAt: ago(38), targetCloseAt: ahead(4), demo: true,
    },
    {
      id: 'demo_req_4', title: 'SRE Intern — Summer 2027', role: 'SRE Intern',
      department: 'Reliability', location: 'Pune', workMode: 'Hybrid', ctcLpa: 6,
      openings: 8, type: 'internship', status: 'open', priority: 'medium',
      collegeId: DEMO_COLLEGE_ID, collegeName: DEMO_COLLEGE_NAME,
      linkedDriveId: 'demo_drive_8',
      hiringManager: 'P. Nair', recruiter: 'You',
      mustHaveSkills: ['Linux', 'Docker', 'CI/CD'],
      niceToHaveSkills: ['Kubernetes', 'Prometheus', 'Terraform'],
      eligibility: { branches: [DVO, CC], batches: ['2027'], minResume: 50 },
      slaDays: 60, createdAt: ago(2), targetCloseAt: ahead(52), demo: true,
    },
    {
      id: 'demo_req_5', title: 'Cloud Platform Engineer (Lateral)', role: 'Platform Engineer',
      department: 'Platform', location: 'Remote', workMode: 'Remote', ctcLpa: 24,
      openings: 2, type: 'off_campus', status: 'open', priority: 'high',
      collegeId: null, collegeName: null, linkedDriveId: null,
      hiringManager: 'R. Deshpande', recruiter: 'You',
      mustHaveSkills: ['Kubernetes', 'Terraform', 'AWS'],
      niceToHaveSkills: ['Helm', 'Go', 'Service Mesh'],
      eligibility: { minExperienceYears: 3 },
      slaDays: 60, createdAt: ago(31), targetCloseAt: ahead(29), demo: true,
    },
    {
      id: 'demo_req_6', title: 'Frontend Engineer — Design Systems', role: 'Frontend Engineer',
      department: 'Product', location: 'Pune', workMode: 'Hybrid', ctcLpa: 12,
      openings: 2, type: 'off_campus', status: 'on_hold', priority: 'low',
      collegeId: null, collegeName: null, linkedDriveId: null,
      hiringManager: 'M. Iyer', recruiter: 'You',
      mustHaveSkills: ['JavaScript', 'React', 'CSS'],
      niceToHaveSkills: ['TypeScript', 'Accessibility', 'Storybook'],
      eligibility: { minExperienceYears: 2 },
      slaDays: 45, createdAt: ago(52), targetCloseAt: ahead(6), demo: true,
    },
  ];
}

/* ============================================================
   3. MATCHING — the actual bridge mechanic
   ============================================================ */

/** Ranked candidates for one requisition, eligibility-gated. */
export function demoMatchesForRequisition(reqId, { limit = 25 } = {}) {
  const requisition = demoRequisitions().find((r) => r.id === reqId) || null;
  return computeMatches({ requisition, profiles: demoTalentProfiles(), limit });
}

/* ============================================================
   4. PIPELINE
   ============================================================ */

let _pipelineCache = null;

/* Candidates move through the funnel with a probability weighted by their own
   match score — a strong match converts more often than a weak one, which is
   what makes the funnel drop-off read as a real hiring process rather than a
   fixed percentage. A candidate who accepts an offer is removed from every
   other requisition, so the headcount never double-counts. */
function buildPipeline() {
  const rng = mulberry32(0x0FF3E5);
  const reqs = demoRequisitions().filter((r) => r.status !== 'closed');
  const profiles = demoTalentProfiles();
  const accepted = new Set();
  const rows = [];

  // Highest-priority requisitions pick from the pool first.
  const order = { high: 0, medium: 1, low: 2 };
  const ordered = [...reqs].sort((a, b) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1));

  for (const req of ordered) {
    const pool = profiles
      .map((p) => ({ p, m: matchScore(p, req) }))
      .filter((x) => x.m.eligible)
      .sort((a, b) => b.m.score - a.m.score);

    for (const { p, m } of pool) {
      if (accepted.has(p.userId)) continue;
      if (rng() > 0.88) continue; // not everyone eligible actually enters the funnel

      const strength = m.score / 100;
      const gate = (base, weight) => rng() < Math.min(0.95, base + strength * weight);

      let stage = 'sourced';
      if (gate(0.45, 0.40)) stage = 'shortlisted';
      if (stage === 'shortlisted' && gate(0.40, 0.42)) stage = 'interviewed';
      if (stage === 'interviewed' && gate(0.30, 0.45)) stage = 'offered';
      if (stage === 'offered' && rng() < 0.78) stage = 'accepted';
      else if (stage !== 'offered' && stage !== 'accepted' && rng() < 0.28) stage = 'rejected';

      if (stage === 'accepted') accepted.add(p.userId);

      const offered = stage === 'offered' || stage === 'accepted';
      const enteredDaysAgo = between(rng, 3, 34);

      rows.push({
        id: `demo_pipe_${req.id}_${p.userId}`,
        requisitionId: req.id,
        requisitionTitle: req.title,
        candidateId: p.userId,
        candidateName: p.name,
        collegeId: p.campus?.collegeId || null,
        collegeName: p.campus?.collegeName || null,
        branch: p.campus?.branch || '',
        batch: p.campus?.batch || '',
        source: req.type === 'campus' || req.type === 'internship' ? 'campus' : 'inbound',
        stage,
        matchScore: m.score,
        trustScore: p.trustScore,
        mustHaveMissing: m.mustHaveMissing,
        ctcLpa: offered ? Math.round(((req.ctcLpa || 6) * (0.9 + rng() * 0.25)) * 10) / 10 : null,
        enteredAt: ago(enteredDaysAgo),
        updatedAt: ago(Math.max(1, enteredDaysAgo - between(rng, 1, 3))),
        // Days from entering the funnel to the current stage — feeds the
        // time-to-shortlist and time-to-offer medians on the dashboard.
        daysToShortlist: ['shortlisted', 'interviewed', 'offered', 'accepted'].includes(stage) ? between(rng, 2, 9) : null,
        daysToOffer: offered ? between(rng, 11, 27) : null,
        demo: true,
      });
    }
  }
  return rows;
}

export function demoPipeline({ requisitionId = '', stage = '' } = {}) {
  if (!_pipelineCache) _pipelineCache = buildPipeline();
  return _pipelineCache.filter((r) => {
    if (requisitionId && r.requisitionId !== requisitionId) return false;
    if (stage && r.stage !== stage) return false;
    return true;
  }).map((r) => ({ ...r }));
}

/* ============================================================
   5. INTERVIEWS
   ============================================================ */

const ROUNDS = ['Technical screen', 'System design', 'Project deep-dive', 'Hiring manager', 'Culture fit'];
const PANEL = ['R. Deshpande', 'S. Krishnan', 'A. Fernandes', 'P. Nair', 'M. Iyer', 'K. Bhatia'];

/* Scheduled rounds for everyone currently sitting at shortlisted or
   interviewed. Shortlisted candidates have an UPCOMING slot; interviewed ones
   have a completed round with a scorecard. Nothing is scheduled for a stage
   where an interview would make no sense, so the calendar always agrees with
   the board. */
export function demoInterviews() {
  const rng = mulberry32(0x1B7C4E);
  const rows = [];

  demoPipeline().forEach((p) => {
    if (p.stage === 'shortlisted') {
      const inDays = between(rng, 1, 9);
      rows.push({
        id: `demo_iv_${p.id}`,
        pipelineId: p.id,
        requisitionId: p.requisitionId,
        requisitionTitle: p.requisitionTitle,
        candidateId: p.candidateId,
        candidateName: p.candidateName,
        collegeName: p.collegeName,
        round: pick(rng, ROUNDS.slice(0, 3)),
        panel: pick(rng, PANEL),
        mode: pick(rng, ['Video call', 'Video call', 'On campus', 'Onsite']),
        scheduledAt: ahead(inDays),
        durationMins: pick(rng, [45, 45, 60, 60, 90]),
        status: 'scheduled',
        outcome: null, score: null, notes: '',
        demo: true,
      });
    } else if (p.stage === 'interviewed' || p.stage === 'offered' || p.stage === 'accepted') {
      const daysAgo = between(rng, 2, 21);
      // A completed round's score tracks the candidate's match, so a strong
      // profile does not come back with an implausible scorecard.
      const score = Math.max(1, Math.min(5, Math.round(p.matchScore / 22) + between(rng, -1, 1)));
      rows.push({
        id: `demo_iv_${p.id}`,
        pipelineId: p.id,
        requisitionId: p.requisitionId,
        requisitionTitle: p.requisitionTitle,
        candidateId: p.candidateId,
        candidateName: p.candidateName,
        collegeName: p.collegeName,
        round: pick(rng, ROUNDS),
        panel: pick(rng, PANEL),
        mode: pick(rng, ['Video call', 'On campus', 'Onsite']),
        scheduledAt: ago(daysAgo),
        durationMins: pick(rng, [45, 60, 60, 90]),
        status: 'completed',
        outcome: p.stage === 'interviewed' ? (rng() < 0.5 ? 'hold' : 'advance') : 'advance',
        score,
        notes: score >= 4 ? 'Strong project depth; could explain trade-offs unprompted.'
          : score === 3 ? 'Solid fundamentals, thin on system-level reasoning.'
            : 'Struggled to justify design choices under follow-up.',
        demo: true,
      });
    }
  });

  return rows.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
}

/* ============================================================
   6. CAMPUS PARTNERS — the bridge object
   ============================================================ */

/* One genuinely connected college (live cohort numbers computed from the same
   200 students the placement cell sees) plus three at earlier stages of the
   partnership. A recruiter's campus programme is always a portfolio at mixed
   maturity, and the invited/pending cards give the "connect a campus" flow
   something to act on. */
export function demoCampusPartners() {
  const { rows } = demoStudentsDeep();
  const pipeline = demoPipeline();
  const reqs = demoRequisitions();

  const readyPool = rows.filter((r) => (r.recruiterReadyProjects || 0) > 0);
  const graduating = rows.filter((r) => r.batch === '2026');
  const gradReady = graduating.filter((r) => (r.recruiterReadyProjects || 0) > 0);

  const campusPipe = pipeline.filter((p) => p.collegeId === DEMO_COLLEGE_ID);
  const offers = campusPipe.filter((p) => p.stage === 'offered' || p.stage === 'accepted');
  const acceptedRows = campusPipe.filter((p) => p.stage === 'accepted');

  // Skill supply for this campus — what the cohort can actually prove.
  const supply = {};
  readyPool.forEach((r) => (r.verifiedSkills || []).forEach((s) => { supply[s] = (supply[s] || 0) + 1; }));
  const topSkills = Object.entries(supply)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([skill, count]) => ({ skill, count }));

  const connected = {
    id: DEMO_COLLEGE_ID,
    name: DEMO_COLLEGE_NAME,
    city: 'Pune',
    domain: DEMO_DOMAIN,
    status: 'connected',
    connectedAt: ago(214),
    placementCellEmail: DEMO_TPO_EMAIL,
    placementCellName: 'Training & Placement Cell',
    tier: 'Tier 2',
    // Live cohort numbers — the same values the college console reports.
    cohortSize: DEMO_STUDENT_COUNT,
    graduatingCount: graduating.length,
    recruiterReadyCount: readyPool.length,
    graduatingReadyCount: gradReady.length,
    verifiedProjectStudents: rows.filter((r) => (r.projectsVerified || 0) > 0).length,
    avgReadiness: avg(rows.map((r) => r.readinessScore || 0)),
    avgResume: avg(rows.filter((r) => r.resumeScore != null).map((r) => r.resumeScore)),
    avgCgpa: Math.round(avg(rows.map((r) => (r.cgpa || 0) * 100)) / 100 * 100) / 100,
    branches: BRANCH_LIST,
    topSkills,
    // Our own activity with this campus.
    openRequisitions: reqs.filter((r) => r.collegeId === DEMO_COLLEGE_ID && r.status === 'open').length,
    inPipeline: campusPipe.length,
    offersExtended: offers.length,
    offersAccepted: acceptedRows.length,
    acceptanceRate: offers.length ? Math.round((acceptedRows.length / offers.length) * 100) : 0,
    avgOfferCtc: acceptedRows.length
      ? Math.round(avg(acceptedRows.filter((r) => r.ctcLpa).map((r) => r.ctcLpa * 10)) / 10 * 10) / 10 : 0,
    lastDriveAt: ago(24),
    nextDriveAt: ahead(11),
    demo: true,
  };

  const others = [
    {
      id: 'demo-college-sahyadri', name: 'Sahyadri College of Engineering', city: 'Nashik',
      domain: 'sahyadri-engg.test', status: 'invited', invitedAt: ago(9),
      placementCellEmail: 'tpo@sahyadri-engg.test', placementCellName: 'Placement Office',
      tier: 'Tier 3', cohortSize: 0, note: 'Invitation sent — awaiting placement cell response.',
    },
    {
      id: 'demo-college-deccan', name: 'Deccan Institute of Technology', city: 'Pune',
      domain: 'deccan-it.test', status: 'pending_mou', invitedAt: ago(26),
      placementCellEmail: 'placements@deccan-it.test', placementCellName: 'Corporate Relations',
      tier: 'Tier 2', cohortSize: 0, note: 'MoU under review with their legal team.',
    },
    {
      id: 'demo-college-konkan', name: 'Konkan University — School of CS', city: 'Ratnagiri',
      domain: 'konkan-cs.test', status: 'prospect', invitedAt: null,
      placementCellEmail: '', placementCellName: '',
      tier: 'Tier 3', cohortSize: 0, note: 'Identified from regional talent-gap analysis. Not yet contacted.',
    },
  ].map((c) => ({
    ...c,
    recruiterReadyCount: 0, graduatingCount: 0, graduatingReadyCount: 0,
    verifiedProjectStudents: 0, avgReadiness: 0, avgResume: 0, avgCgpa: 0,
    branches: [], topSkills: [], openRequisitions: 0, inPipeline: 0,
    offersExtended: 0, offersAccepted: 0, acceptanceRate: 0, avgOfferCtc: 0,
    lastDriveAt: null, nextDriveAt: null, demo: true,
  }));

  return [connected, ...others];
}

/* ============================================================
   7. SKILL SUPPLY vs DEMAND
   ============================================================ */

/* The single most useful thing a recruiter and a placement cell can look at
   together: what our open roles require, against what the cohort can prove.
   A positive gap means the campus cannot currently fill the role — which is
   exactly the signal a TPO needs to change what they teach next semester. */
export function demoSkillGap() {
  return computeSkillGap({ requisitions: demoRequisitions(), profiles: demoTalentProfiles() });
}

/* ============================================================
   8. SUMMARY / KPIs
   ============================================================ */

export function demoTalentSummary() {
  return computeSummary({
    org: { id: DEMO_ORG_ID, name: DEMO_ORG_NAME, domain: DEMO_ORG_DOMAIN },
    profiles: demoTalentProfiles(),
    requisitions: demoRequisitions(),
    pipeline: demoPipeline(),
    partners: demoCampusPartners(),
    now: EPOCH,
  });
}

/** Test hook — clears memoised state so a test can rebuild the world. */
export function _reset() {
  _talentCache = null;
  _pipelineCache = null;
}

export default {
  DEMO_ORG_ID, DEMO_ORG_NAME, DEMO_ORG_DOMAIN, DEMO_RECRUITER_EMAIL,
  PIPELINE_STAGES,
  demoModeEnabled, demoTalentProfiles, demoRequisitions, demoPipeline,
  demoCampusPartners, demoSkillGap, demoTalentSummary, demoMatchesForRequisition,
  demoInterviews,
  matchScore, meetsEligibility, _reset,
};
