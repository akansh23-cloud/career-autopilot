/* ============================================================
   Demo college cohort — in-memory, deterministic, DB-free.
   ------------------------------------------------------------
   `seedDemoCollege()` in db.js already builds a rich demo world,
   but it needs MongoDB (`if (!URI) return { reason: 'db_disabled' }`).
   Every college read then short-circuits to `[]`, so with no
   MONGODB_URI the placement-cell command center renders completely
   empty — nothing to record, nothing to show.

   This module supplies the same world in memory so the workspace is
   populated with zero infrastructure. It is the same keyless-fallback
   pattern used elsewhere in the codebase (see `_memDrives`).

   SAFETY: this data is only ever served when DEMO_MODE is explicitly
   on AND no real database is connected. Every record is obviously
   synthetic — the college key is `demo-institute-of-technology`, all
   addresses end in `.test` (an IANA-reserved TLD that can never
   route), and ids are prefixed `demo_`. It can never mix with or
   overwrite a real user's records because it is never written
   anywhere; it is generated per call and thrown away.

   Deterministic: the same seed produces the same 50 students on
   every process start, so a re-recorded take looks identical to the
   first one.
   ============================================================ */

import { computeReadiness } from './readinessEngine.js';

export const DEMO_COLLEGE_ID = 'demo-institute-of-technology';
export const DEMO_COLLEGE_NAME = 'Demo Institute of Technology';
export const DEMO_DOMAIN = 'demo-institute.test';
export const DEMO_JOIN_CODE = 'DEMO2026';
export const DEMO_TPO_EMAIL = `tpo@${DEMO_DOMAIN}`;
export const DEMO_STUDENT_COUNT = 50;

/** Demo data is served only when explicitly enabled and no real DB is present. */
export function demoModeEnabled(env = process.env) {
  const flag = String(env.DEMO_MODE || '').toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

/* ---------------- deterministic RNG ---------------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/* One epoch for the whole process. Every relative timestamp below is derived
   from EPOCH rather than a fresh Date.now(), so repeated calls return byte-
   identical records and a re-recorded demo take looks like the first one. */
const EPOCH = Date.now();
const between = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

/* ---------------- vocabulary ---------------- */

const FIRST = ['Aarav', 'Ananya', 'Rohan', 'Priya', 'Vivaan', 'Isha', 'Aditya', 'Sneha', 'Kabir', 'Diya',
  'Arjun', 'Meera', 'Dev', 'Kavya', 'Nikhil', 'Riya', 'Sahil', 'Tanvi', 'Yash', 'Pooja',
  'Harsh', 'Nandini', 'Om', 'Shruti', 'Raghav', 'Aisha', 'Kunal', 'Divya', 'Manav', 'Sakshi',
  'Ishaan', 'Anika', 'Rudra', 'Trisha', 'Advait', 'Neha', 'Veer', 'Simran', 'Aryan', 'Gauri'];
const LAST = ['Sharma', 'Patil', 'Deshmukh', 'Kulkarni', 'Verma', 'Iyer', 'Joshi', 'Reddy', 'Nair', 'Gupta',
  'Singh', 'Mehta', 'Chavan', 'Pawar', 'Agarwal', 'Bhosale', 'Rane', 'Sawant', 'Jadhav', 'Shetty'];
// Weighted so CSE is the largest branch, as it is in most Indian engineering
// colleges — an even split across branches reads as synthetic at a glance.
const BRANCHES = ['CSE', 'CSE', 'CSE', 'CSE', 'IT', 'IT', 'IT', 'ENTC', 'ENTC', 'Mechanical'];
const BRANCH_LIST = ['CSE', 'IT', 'ENTC', 'Mechanical'];
const BATCHES = ['2026', '2027'];
const YEARS = ['3rd year', '4th year'];
const SKILLS = ['Python', 'Java', 'JavaScript', 'React', 'Node.js', 'SQL', 'MongoDB', 'AWS', 'Docker',
  'Kubernetes', 'Git', 'Linux', 'C++', 'Machine Learning', 'Data Structures', 'REST APIs',
  'Spring Boot', 'Flask', 'TypeScript', 'Pandas', 'Embedded C', 'MATLAB'];
const ROLES = ['Backend Engineer', 'Full-stack Engineer', 'Data Analyst', 'ML Engineer',
  'DevOps Engineer', 'QA Engineer', 'Embedded Engineer', 'Frontend Engineer'];
const PROJECTS = ['Campus Event Portal', 'Attendance Anomaly Detector', 'Mess Menu Optimizer',
  'Placement Prep Tracker', 'Smart Parking Allocator', 'Lab Inventory System',
  'Bus Route Predictor', 'Alumni Connect Graph', 'Exam Seating Planner',
  'Hostel Complaint Triage', 'Library Seat Finder', 'Crop Advisory Bot'];

const DAY = 24 * 60 * 60 * 1000;

/* ---------------- cohort generation ----------------
   Built once per process and memoised. Timestamps are computed
   relative to generation time so the funnel always looks current. */

let _cache = null;

function generate(count = DEMO_STUDENT_COUNT) {
  const rng = mulberry32(20260727);
  const now = Date.now();
  const rows = [];
  const events = [];
  const usedNames = new Set();

  for (let i = 0; i < count; i++) {
    let first = pick(rng, FIRST);
    let last = pick(rng, LAST);
    let guard = 0;
    while (usedNames.has(`${first} ${last}`) && guard++ < 40) { first = pick(rng, FIRST); last = pick(rng, LAST); }
    usedNames.add(`${first} ${last}`);

    const name = `${first} ${last}`;
    const seq = String(i + 1).padStart(3, '0');
    const email = `${first}.${last}.${seq}@${DEMO_DOMAIN}`.toLowerCase();
    const branch = pick(rng, BRANCHES);
    const batch = pick(rng, BATCHES);

    // Funnel: registered 8% · profile 14% · building 18% · submitted 16% ·
    // verified 24% · recruiter-ready 20%. Weighted toward a healthy but
    // honest placement cell — a visible ready cohort at the top AND a real
    // tail of students who are not ready, because a cohort where everyone
    // scores well makes the readiness engine look like it does nothing.
    const roll = rng();
    const stage = roll < 0.08 ? 0 : roll < 0.22 ? 1 : roll < 0.40 ? 2 : roll < 0.56 ? 3 : roll < 0.80 ? 4 : 5;

    const skillCount = stage === 0 ? between(rng, 0, 1)
      : stage === 1 ? between(rng, 2, 4)
        : stage >= 4 ? between(rng, 6, 10) : between(rng, 3, 7);
    const skills = [...new Set(Array.from({ length: skillCount }, () => pick(rng, SKILLS)))];
    const verifiedCount = stage === 5 ? Math.min(skills.length, between(rng, 6, 9))
      : stage === 4 ? Math.min(skills.length, between(rng, 4, 7))
        : stage === 3 ? Math.min(skills.length, between(rng, 1, 3)) : 0;
    const verifiedSkills = skills.slice(0, verifiedCount);
    const pendingSkills = stage >= 2 ? skills.slice(verifiedCount, verifiedCount + between(rng, 0, 2)) : [];

    const projectsTotal = stage === 0 ? 0 : stage === 1 ? between(rng, 0, 1)
      : stage === 5 ? between(rng, 3, 5) : between(rng, 1, 4);
    const projectsVerified = stage === 5 ? Math.min(projectsTotal, between(rng, 2, 4))
      : stage === 4 ? Math.min(projectsTotal, between(rng, 1, 3)) : 0;
    const projectsPending = stage === 3 ? Math.min(projectsTotal, between(rng, 1, 2))
      : stage >= 4 ? Math.max(0, Math.min(projectsTotal - projectsVerified, between(rng, 0, 1))) : 0;
    const projectsNeedsReview = stage === 3 && rng() > 0.75 ? 1 : 0;
    const projectsRejected = stage >= 3 && rng() > 0.85 ? 1 : 0;
    const recruiterReadyProjects = stage === 5 ? Math.max(2, projectsVerified) : stage === 4 ? between(rng, 0, projectsVerified) : 0;

    // Engagement — recruiter-ready students lean active, registered lean dormant.
    const engRoll = rng() + stage * 0.08;
    const lastActiveDaysAgo = engRoll > 0.85 ? between(rng, 1, 6)
      : engRoll > 0.55 ? between(rng, 8, 29)
        : engRoll > 0.30 ? between(rng, 35, 150)
          : null;

    const resumeScore = stage === 0 ? null
      : stage === 1 ? between(rng, 32, 55)
        : stage === 2 ? between(rng, 45, 68)
          : stage === 3 ? between(rng, 55, 75)
            : stage === 4 ? between(rng, 65, 84)
              : between(rng, 78, 94);

    const totalVerifiedXp = verifiedSkills.length * between(rng, 200, 380);
    const totalPendingXp = pendingSkills.length * between(rng, 40, 140);

    const memberSinceDays = between(rng, 40, 150);
    const oldestPendingAt = projectsPending > 0 ? new Date(now - between(rng, 2, 26) * DAY).toISOString() : null;

    // Readiness comes from the product's own engine, not a made-up number —
    // so the cohort stats a viewer sees are internally consistent with how
    // every real student is scored.
    const readiness = computeReadiness({
      verifiedSkills,
      totalVerifiedXp,
      verifiedProjectCount: projectsVerified,
      recruiterReadyProjectCount: recruiterReadyProjects,
      resumeScore,
    });

    const row = {
      id: `demo_${seq}`,
      name,
      email,
      branch,
      batch,
      year: pick(rng, YEARS),
      targetRole: stage === 0 ? '' : pick(rng, ROLES),
      skills,
      verifiedSkills,
      pendingSkills,
      totalVerifiedXp,
      totalPendingXp,
      projectsTotal,
      projectsVerified,
      projectsPending,
      projectsNeedsReview,
      projectsRejected,
      recruiterReadyProjects,
      verifiedProjects: projectsVerified,
      oldestPendingAt,
      resumeScore,
      resumeAts: resumeScore == null ? null : Math.max(20, Math.min(100, resumeScore + between(rng, -8, 8))),
      resumeImpact: resumeScore == null ? null : Math.max(20, Math.min(100, resumeScore + between(rng, -12, 6))),
      resumeClarity: resumeScore == null ? null : Math.max(20, Math.min(100, resumeScore + between(rng, -6, 10))),
      lastActiveAt: lastActiveDaysAgo == null ? null : new Date(now - lastActiveDaysAgo * DAY).toISOString(),
      memberSince: new Date(now - memberSinceDays * DAY).toISOString(),
      membership: { status: 'active', via: pick(rng, ['roster', 'roster', 'domain', 'code']), at: new Date(now - memberSinceDays * DAY).toISOString() },
      readinessScore: readiness.score,
      readinessCategory: readiness.category,
      readinessComponents: readiness.components,
      readinessGaps: readiness.gaps,
      _stage: stage,
      _projectNames: Array.from({ length: projectsTotal }, () => pick(rng, PROJECTS)),
      _demo: true,
    };
    rows.push(row);

    // Activity events power the 60-day momentum series and engagement buckets.
    for (let v = 0; v < projectsVerified; v++) events.push({ type: 'verification', at: new Date(now - between(rng, 1, 55) * DAY).toISOString() });
    if (resumeScore != null) {
      const revisions = stage >= 4 ? between(rng, 2, 4) : 1;
      for (let r = 0; r < revisions; r++) events.push({ type: 'resume', at: new Date(now - between(rng, 1, 58) * DAY).toISOString() });
    }
  }

  return { rows, events };
}

function cohort() {
  if (!_cache) _cache = generate(DEMO_STUDENT_COUNT);
  return _cache;
}

/** Test hook — forces regeneration (also lets a test request a different size). */
export function _regenerate(count = DEMO_STUDENT_COUNT) {
  _cache = generate(count);
  return _cache;
}

/* ---------------- shaped accessors ---------------- */

function matchesFilters(row, f = {}) {
  if (f.branch && String(row.branch) !== String(f.branch)) return false;
  if (f.batch && String(row.batch) !== String(f.batch)) return false;
  if (f.year && String(row.year) !== String(f.year)) return false;
  if (f.skill && !row.skills.some((s) => s.toLowerCase().includes(String(f.skill).toLowerCase()))) return false;
  if (f.minResume && Number(row.resumeScore || 0) < Number(f.minResume)) return false;
  if (f.verifiedOnly && !(row.projectsVerified > 0)) return false;
  return true;
}

/** Matches the shape of db.listCollegeStudents (readiness is added by the route). */
export function demoStudents({ filters = {} } = {}) {
  return cohort().rows
    .filter((r) => matchesFilters(r, filters))
    .map(({ _stage, _projectNames, ...r }) => ({ ...r }));
}

/** Matches db.collegeStudentsDeep — { rows, events }. */
export function demoStudentsDeep() {
  const { rows, events } = cohort();
  return { rows: rows.map(({ _stage, _projectNames, ...r }) => ({ ...r })), events: [...events] };
}

/** Matches db.collegeStudentDetail. */
export function demoStudentDetail(studentId) {
  const row = cohort().rows.find((r) => r.id === String(studentId));
  if (!row) return null;
  const now = Date.now();
  const statuses = ['verified', 'verified', 'pending', 'needs_review', 'rejected'];
  const projects = row._projectNames.map((title, i) => ({
    id: `${row.id}_p${i + 1}`,
    title,
    verificationStatus: i < row.projectsVerified ? 'verified'
      : i < row.projectsVerified + row.projectsPending ? 'pending'
        : statuses[Math.min(i, statuses.length - 1)],
    githubUrl: i < row.recruiterReadyProjects ? `https://github.com/demo-institute/${title.toLowerCase().replace(/\s+/g, '-')}` : '',
    liveDemoUrl: '',
    createdAt: new Date(now - (30 - i * 4) * DAY).toISOString(),
    updatedAt: new Date(now - (12 - i * 2) * DAY).toISOString(),
  }));
  const skillLedger = row.skills.map((skillName) => ({
    skillName,
    verifiedXp: row.verifiedSkills.includes(skillName) ? Math.round(row.totalVerifiedXp / Math.max(1, row.verifiedSkills.length)) : 0,
    pendingXp: row.pendingSkills.includes(skillName) ? Math.round(row.totalPendingXp / Math.max(1, row.pendingSkills.length)) : 0,
  }));
  const resumeHistory = row.resumeScore == null ? [] : [
    { score: row.resumeScore, ats: row.resumeAts, impact: row.resumeImpact, clarity: row.resumeClarity, createdAt: new Date(now - 6 * DAY).toISOString() },
    { score: Math.max(20, row.resumeScore - 9), ats: row.resumeAts, impact: row.resumeImpact, clarity: row.resumeClarity, createdAt: new Date(now - 34 * DAY).toISOString() },
  ];
  const { _stage, _projectNames, ...student } = row;
  return {
    student,
    projects,
    skillLedger,
    resumeHistory,
    activity: projects.slice(0, 5).map((p) => ({ type: 'project', label: p.title, at: p.updatedAt })),
    demo: true,
  };
}

export function demoDrives() {
  const now = EPOCH;
  // A believable placement season for a mid-tier Indian engineering college:
  // one high-volume service recruiter doing the bulk of the hiring, a few
  // mid-tier product roles, an internship drive for the pre-final year, and a
  // single "dream offer" almost nobody clears. `selectivity` is consumed by
  // demoOutcomes to shape each funnel — mass recruiters convert far more of
  // their applicants than a 28 LPA platform role does.
  return [
    {
      id: 'demo_drive_1', title: 'Backend Engineer \u2014 Campus Hire 2026', company: 'Northwind Systems',
      role: 'SDE-1', location: 'Pune', ctcLpa: 11,
      eligibility: { branches: ['CSE', 'IT'], batches: ['2026'], minResume: 65 },
      status: 'in_progress', selectivity: 1.0,
      createdAt: new Date(now - 24 * DAY).toISOString(), demo: true,
    },
    {
      id: 'demo_drive_2', title: 'Graduate Engineer Trainee', company: 'Sundaram TechServices',
      role: 'GET', location: 'Chennai / Pune', ctcLpa: 4.2,
      eligibility: { batches: ['2026'], minResume: 45 },
      status: 'closed', selectivity: 1.7,
      createdAt: new Date(now - 46 * DAY).toISOString(), demo: true,
    },
    {
      id: 'demo_drive_3', title: 'Full-Stack Developer', company: 'Meridian Labs',
      role: 'Software Engineer', location: 'Bengaluru', ctcLpa: 9.5,
      eligibility: { branches: ['CSE', 'IT'], batches: ['2026'], minResume: 60 },
      status: 'in_progress', selectivity: 1.0,
      createdAt: new Date(now - 17 * DAY).toISOString(), demo: true,
    },
    {
      id: 'demo_drive_4', title: 'Embedded Systems Trainee', company: 'Halcyon Devices',
      role: 'Embedded Engineer', location: 'Pune', ctcLpa: 6.5,
      eligibility: { branches: ['ENTC', 'Mechanical'], batches: ['2026'], minResume: 50 },
      status: 'closed', selectivity: 1.3,
      createdAt: new Date(now - 38 * DAY).toISOString(), demo: true,
    },
    {
      id: 'demo_drive_5', title: 'Manufacturing Graduate Programme', company: 'Ironvale Industries',
      role: 'Graduate Trainee', location: 'Nashik', ctcLpa: 5.4,
      eligibility: { branches: ['Mechanical', 'ENTC'], batches: ['2026'], minResume: 45 },
      status: 'closed', selectivity: 1.5,
      createdAt: new Date(now - 33 * DAY).toISOString(), demo: true,
    },
    {
      id: 'demo_drive_6', title: 'Platform Engineer \u2014 Dream Offer', company: 'Aurelia Cloud',
      role: 'Platform Engineer', location: 'Remote', ctcLpa: 28,
      eligibility: { branches: ['CSE', 'IT'], batches: ['2026'], minReadiness: 72, minVerifiedProjects: 1 },
      status: 'in_progress', selectivity: 0.75,
      createdAt: new Date(now - 8 * DAY).toISOString(), demo: true,
    },
    {
      id: 'demo_drive_7', title: 'Data Analyst Internship', company: 'Kestrel Analytics',
      role: 'Data Analyst Intern', location: 'Pune', ctcLpa: 5.5,
      eligibility: { branches: ['CSE', 'IT', 'ENTC'], batches: ['2027'], minResume: 55 },
      status: 'open', selectivity: 1.1,
      createdAt: new Date(now - 4 * DAY).toISOString(), demo: true,
    },
  ];
}

export function demoMembers(status = '') {
  const members = cohort().rows.map((r) => ({
    id: r.id, name: r.name, email: r.email,
    status: r.membership.status, via: r.membership.via, at: r.membership.at,
    accountType: 'student', demo: true,
  }));
  // A few pending join requests give the approve/remove controls something to act on.
  members.push(
    { id: 'demo_pending_1', name: 'Aarav Kulkarni', email: `aarav.kulkarni.901@${DEMO_DOMAIN}`, status: 'pending', via: 'code', at: new Date(Date.now() - 2 * DAY).toISOString(), accountType: 'student', demo: true },
    { id: 'demo_pending_2', name: 'Nandini Rane', email: `nandini.rane.902@${DEMO_DOMAIN}`, status: 'pending', via: 'domain', at: new Date(Date.now() - 1 * DAY).toISOString(), accountType: 'student', demo: true },
  );
  return status ? members.filter((m) => m.status === status) : members;
}

export function demoRoster() {
  const rows = cohort().rows.slice(0, 40).map((r, i) => ({
    email: r.email, name: r.name, branch: r.branch, batch: r.batch,
    rollNo: `${r.branch}${r.batch.slice(-2)}${String(i + 1).padStart(3, '0')}`,
    status: 'joined', createdAt: r.memberSince, demo: true,
  }));
  for (let i = 0; i < 8; i++) {
    rows.push({
      email: `invited.student.${String(i + 1).padStart(2, '0')}@${DEMO_DOMAIN}`,
      name: `Invited Student ${i + 1}`, branch: BRANCH_LIST[i % BRANCH_LIST.length], batch: '2027',
      rollNo: `INV${String(i + 1).padStart(3, '0')}`, status: 'invited',
      createdAt: new Date(Date.now() - (i + 3) * DAY).toISOString(), demo: true,
    });
  }
  return { rows, counts: { invited: 8, joined: 40 } };
}

export function demoTasks() {
  const now = Date.now();
  return [
    { id: 'demo_task_1', title: 'Upload your latest resume', description: 'Placement season opens in six weeks — get a scored resume on file.', dueAt: new Date(now + 5 * DAY).toISOString(), assignedCount: 18, completedCount: 7, createdAt: new Date(now - 4 * DAY).toISOString(), demo: true },
    { id: 'demo_task_2', title: 'Submit one project for verification', description: 'Verified projects are what recruiters filter on.', dueAt: new Date(now + 12 * DAY).toISOString(), assignedCount: 24, completedCount: 11, createdAt: new Date(now - 11 * DAY).toISOString(), demo: true },
    { id: 'demo_task_3', title: 'Complete mock interview round 1', description: 'Slots are open all of next week.', dueAt: new Date(now - 2 * DAY).toISOString(), assignedCount: 30, completedCount: 26, createdAt: new Date(now - 21 * DAY).toISOString(), demo: true },
  ];
}

/* Placement outcomes for the demo drives. Deterministic and deliberately
   imperfect: not everyone who applies is shortlisted, a couple of strong
   students hold two offers, and one accepted offer has no CTC recorded — so
   the "package coverage" warning has something real to report. */
export function demoOutcomes() {
  const rng = mulberry32(0x5150ACED);
  const now = EPOCH;
  const rows = cohort().rows;
  const drives = demoDrives();
  const out = [];
  const placed = new Set(); // a student who accepts stops applying elsewhere

  // Package bands per drive, centred on the advertised CTC.
  const band = (ctc) => [ctc * 0.85, ctc * 1.2];

  // Day-1 order: the most selective companies pick first, mass recruiters last.
  // Generating in list order let the volume hirer absorb the cohort and left
  // every premium drive with an empty funnel.
  const ordered = [...drives].sort((a, b) => (a.selectivity ?? 1) - (b.selectivity ?? 1));

  for (const drive of ordered) {
    const e = drive.eligibility || {};
    const sel = drive.selectivity ?? 1;
    // Applicants are drawn from students who genuinely clear eligibility, so
    // the demo funnel is consistent with what the eligibility engine reports.
    const pool = rows.filter((r) => {
      if (e.branches?.length && !e.branches.includes(r.branch)) return false;
      if (e.batches?.length && !e.batches.includes(r.batch)) return false;
      if (e.minResume != null && Number(r.resumeScore || 0) < e.minResume) return false;
      if (e.minReadiness != null && Number(r.readinessScore || 0) < e.minReadiness) return false;
      if (e.minVerifiedProjects != null && Number(r.projectsVerified || 0) < e.minVerifiedProjects) return false;
      return true;
    });

    const [lo, hi] = band(drive.ctcLpa || 6);

    for (const r of pool) {
      // Someone who has already accepted an offer is off the market. This is
      // what keeps the placement percentage honest instead of double-counting.
      if (placed.has(r.id)) continue;
      if (rng() > 0.86) continue; // a few students skip a drive

      const strength = Number(r.readinessScore || 0) / 100;
      const gate = (base, weight) => rng() < Math.min(0.96, (base + strength * weight) * sel);

      let stage = 'applied';
      if (gate(0.55, 0.35)) stage = 'shortlisted';
      if (stage === 'shortlisted' && gate(0.55, 0.35)) stage = 'interviewed';
      if (stage === 'interviewed' && gate(0.40, 0.40)) stage = 'offered';
      if (stage === 'offered' && rng() < 0.82) stage = 'accepted';
      else if (stage !== 'offered' && rng() < 0.45) stage = 'rejected';

      if (stage === 'accepted') placed.add(r.id);

      const offered = stage === 'offered' || stage === 'accepted';
      // One accepted offer per run intentionally has no package recorded, so
      // the "package coverage" data-quality warning has something real to flag.
      const skipCtc = stage === 'accepted' && rng() < 0.06;
      const ctc = offered && !skipCtc ? Math.round((lo + rng() * (hi - lo)) * 10) / 10 : null;

      out.push({
        id: `out_${drive.id}_${r.id}`,
        driveId: drive.id,
        studentId: r.id,
        stage,
        furthestStage: stage === 'rejected' ? (rng() < 0.5 ? 'shortlisted' : 'interviewed') : stage,
        ctcLpa: ctc,
        company: drive.company,
        role: drive.role,
        note: '',
        offerAt: offered ? new Date(now - between(rng, 2, 30) * DAY).toISOString() : null,
        updatedAt: new Date(now - between(rng, 1, 34) * DAY).toISOString(),
        demo: true,
      });
    }
  }
  return out;
}

/* 90 days of daily cohort snapshots ending YESTERDAY — today's snapshot is
   written for real by the observability route, so the delta a viewer sees is
   a genuine comparison between stored history and a freshly computed value. */
export function demoSnapshots() {
  const rows = cohort().rows;
  const now = EPOCH;
  const students = rows.length;
  const curAvgReadiness = Math.round(rows.reduce((s, r) => s + (r.readinessScore || 0), 0) / Math.max(1, students));
  const withResume = rows.filter((r) => r.resumeScore != null);
  const curAvgResume = withResume.length
    ? Math.round(withResume.reduce((s, r) => s + r.resumeScore, 0) / withResume.length) : 0;
  const curRecruiterReady = rows.filter((r) => (r.recruiterReadyProjects || 0) > 0).length;
  const curVerified = rows.filter((r) => (r.projectsVerified || 0) > 0).length;
  const curReady = rows.filter((r) => (r.readinessScore || 0) >= 70).length;

  const snaps = [];
  for (let d = 90; d >= 1; d--) {
    const t = now - d * DAY;
    // progress runs 0 (90 days ago) -> ~0.99 (yesterday)
    const p = (90 - d) / 90;
    const ramp = (curr, startFactor) => Math.round(curr * (startFactor + (1 - startFactor) * p));
    snaps.push({
      date: new Date(t).toISOString().slice(0, 10),
      at: new Date(t).toISOString(),
      students: ramp(students, 0.72),
      avgReadiness: ramp(curAvgReadiness, 0.78),
      avgResume: ramp(curAvgResume, 0.85),
      recruiterReady: ramp(curRecruiterReady, 0.45),
      verifiedStudents: ramp(curVerified, 0.55),
      withResume: ramp(withResume.length, 0.6),
      active7: ramp(Math.round(students * 0.4), 0.7),
      placementReady: ramp(curReady, 0.5),
      demo: true,
    });
  }
  return snaps;
}

export function demoCollege() {
  return {
    key: DEMO_COLLEGE_ID, id: DEMO_COLLEGE_ID, name: DEMO_COLLEGE_NAME, city: 'Pune',
    status: 'active', domains: [DEMO_DOMAIN], joinCode: DEMO_JOIN_CODE,
    settings: { autoApproveDomainJoins: true, autoApproveCodeJoins: true },
    demo: true, studentCount: DEMO_STUDENT_COUNT,
  };
}

export default {
  DEMO_COLLEGE_ID, DEMO_COLLEGE_NAME, DEMO_DOMAIN, DEMO_JOIN_CODE, DEMO_TPO_EMAIL, DEMO_STUDENT_COUNT,
  demoModeEnabled, demoStudents, demoStudentsDeep, demoStudentDetail,
  demoDrives, demoMembers, demoRoster, demoTasks, demoCollege,
  demoOutcomes, demoSnapshots,
};
