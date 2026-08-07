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

   THE WORLD (pilot-demo scale):
     One college, four CSE specialisations, 50 students each = 200.
       CSE (AI & ML) · CSE (Big Data) · CSE (Cloud Computing) ·
       CSE (DevOps)
     Four academic years (1st–4th) mapped to graduating batches
     2029→2026, ~12–13 students per year per branch, so every
     year-wise and branch-wise chart has real bars rather than one
     tall column.

     Skills, projects, target roles and drive eligibility are all
     SPECIALISATION-AWARE: an AI & ML student carries PyTorch and
     scikit-learn, a DevOps student carries Kubernetes and Terraform.
     That is what makes team-project skill matching visibly do
     something on stage — a mixed-branch team gets a genuinely
     different brief from a single-branch team.

     Seniority is modelled, not random: a 1st-year cannot be
     recruiter-ready, a 4th-year mostly is. That is what makes the
     year filter meaningful and the at-risk list credible — the
     students flagged are the ones who are behind for THEIR year.

   SAFETY: this data is only ever served when DEMO_MODE is explicitly
   on AND no real database is connected. Every record is obviously
   synthetic — the college key is `demo-institute-of-technology`, all
   addresses end in `.test` (an IANA-reserved TLD that can never
   route), and ids are prefixed `demo_`. It can never mix with or
   overwrite a real user's records because it is never written
   anywhere; it is generated per call and thrown away.

   Deterministic: the same seed produces the same 200 students on
   every process start, so a re-recorded take looks identical to the
   first one.
   ============================================================ */

import { computeReadiness } from './readinessEngine.js';

export const DEMO_COLLEGE_ID = 'demo-institute-of-technology';
export const DEMO_COLLEGE_NAME = 'Demo Institute of Technology';
export const DEMO_DOMAIN = 'demo-institute.test';
export const DEMO_JOIN_CODE = 'DEMO2026';
export const DEMO_TPO_EMAIL = `tpo@${DEMO_DOMAIN}`;

/** 50 per specialisation × 4 specialisations. */
export const DEMO_PER_BRANCH = 50;
export const DEMO_STUDENT_COUNT = 200;

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
  'Ishaan', 'Anika', 'Rudra', 'Trisha', 'Advait', 'Neha', 'Veer', 'Simran', 'Aryan', 'Gauri',
  'Atharva', 'Ira', 'Parth', 'Saanvi', 'Reyansh', 'Myra', 'Vihaan', 'Aarohi', 'Krish', 'Janhavi',
  'Soham', 'Aditi', 'Naman', 'Prisha', 'Tejas', 'Vaishnavi', 'Ansh', 'Khushi', 'Ayush', 'Rutuja',
  'Shreyas', 'Mitali', 'Onkar', 'Sanika', 'Chirag', 'Bhavna', 'Pranav', 'Sharvari', 'Rohit', 'Ketki'];
const LAST = ['Sharma', 'Patil', 'Deshmukh', 'Kulkarni', 'Verma', 'Iyer', 'Joshi', 'Reddy', 'Nair', 'Gupta',
  'Singh', 'Mehta', 'Chavan', 'Pawar', 'Agarwal', 'Bhosale', 'Rane', 'Sawant', 'Jadhav', 'Shetty',
  'Kadam', 'Salunkhe', 'Thorat', 'Wagh', 'Naik', 'Bhat', 'Gaikwad', 'More', 'Shinde', 'Dubey',
  'Kale', 'Pandit', 'Khandelwal', 'Mane', 'Bagade', 'Ghorpade', 'Nikam', 'Suryawanshi'];

/* ---------------- specialisations ----------------
   Four CSE branches. Each carries its own core skill set, plus a shared pool of
   fundamentals every CSE student has regardless of specialisation, and a
   project vocabulary that reads as that specialisation's actual coursework.

   `roles` is what a student in that branch targets — it drives the target-role
   column in the directory and in exports. */

const SHARED_SKILLS = ['Python', 'Java', 'C++', 'Data Structures', 'SQL', 'Git', 'Linux',
  'JavaScript', 'REST APIs', 'DBMS', 'Operating Systems'];

const BRANCH_DEFS = [
  {
    id: 'CSE (AI & ML)',
    short: 'AIML',
    core: ['Machine Learning', 'Deep Learning', 'PyTorch', 'TensorFlow', 'scikit-learn',
      'NLP', 'Computer Vision', 'Pandas', 'NumPy', 'OpenCV'],
    roles: ['ML Engineer', 'Data Scientist', 'AI Research Intern', 'Computer Vision Engineer', 'NLP Engineer'],
    projects: ['Crop Disease Classifier', 'Attendance Face Recognition', 'Resume Ranking Model',
      'Regional Language Sentiment Analyser', 'Traffic Sign Detection', 'Medical Report Summariser',
      'Student Dropout Predictor', 'Sign Language Translator'],
  },
  {
    id: 'CSE (Big Data)',
    short: 'BDA',
    core: ['Hadoop', 'Apache Spark', 'Kafka', 'Hive', 'Pandas', 'Power BI', 'Tableau',
      'MongoDB', 'PostgreSQL', 'ETL', 'Data Analysis'],
    roles: ['Data Engineer', 'Data Analyst', 'BI Developer', 'Analytics Engineer', 'ETL Developer'],
    projects: ['Retail Sales Warehouse', 'Real-Time Log Analytics Pipeline', 'Weather Data Lake',
      'Streaming Fraud Detector', 'Campus Energy Usage Dashboard', 'Crop Price Trend Analyser',
      'Clickstream Aggregation Engine', 'Public Transport Ridership Model'],
  },
  {
    id: 'CSE (Cloud Computing)',
    short: 'CC',
    core: ['AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'Serverless',
      'Microservices', 'Node.js', 'Nginx', 'Redis'],
    roles: ['Cloud Engineer', 'Backend Engineer', 'Solutions Architect Intern', 'Site Reliability Intern', 'Platform Engineer'],
    projects: ['Serverless Notes API', 'Multi-Region File Store', 'Autoscaling Chat Backend',
      'Cloud Cost Optimiser', 'Campus SSO Gateway', 'Container Image Scanner',
      'Event-Driven Order Service', 'Static Site Deployment Pipeline'],
  },
  {
    id: 'CSE (DevOps)',
    short: 'DVO',
    core: ['Docker', 'Kubernetes', 'Jenkins', 'GitHub Actions', 'Ansible', 'Terraform',
      'CI/CD', 'Prometheus', 'Grafana', 'Bash', 'Helm'],
    roles: ['DevOps Engineer', 'SRE Intern', 'Build & Release Engineer', 'Platform Engineer', 'Infrastructure Engineer'],
    projects: ['One-Click Deploy Pipeline', 'Cluster Health Dashboard', 'Blue-Green Release Tool',
      'Infrastructure Drift Detector', 'Log Aggregation Stack', 'Automated Rollback Controller',
      'Secrets Rotation Service', 'Load Test Harness'],
  },
];

export const BRANCH_LIST = BRANCH_DEFS.map((b) => b.id);

/* ---------------- academic years ----------------
   Year drives almost everything about a student's plausible state. A first-year
   with three verified projects and a 90 resume would make the whole cohort read
   as fabricated; a fourth-year with nothing is exactly the student a TPO needs
   to find before placement season.

   `stageWeights` are the funnel probabilities for that year:
     0 registered · 1 profile · 2 building · 3 submitted · 4 verified ·
     5 recruiter-ready */

const YEAR_DEFS = [
  {
    year: '1st year', batch: '2029', share: 0.24,
    stageWeights: [0.30, 0.38, 0.22, 0.08, 0.02, 0.00],
    skillRange: [1, 4], sharedBias: 0.85,
  },
  {
    year: '2nd year', batch: '2028', share: 0.25,
    stageWeights: [0.10, 0.26, 0.34, 0.20, 0.08, 0.02],
    skillRange: [2, 6], sharedBias: 0.65,
  },
  {
    year: '3rd year', batch: '2027', share: 0.25,
    stageWeights: [0.04, 0.12, 0.24, 0.26, 0.24, 0.10],
    skillRange: [4, 9], sharedBias: 0.45,
  },
  {
    year: '4th year', batch: '2026', share: 0.26,
    stageWeights: [0.03, 0.07, 0.12, 0.18, 0.32, 0.28],
    skillRange: [6, 12], sharedBias: 0.35,
  },
];

export const YEAR_LIST = YEAR_DEFS.map((y) => y.year);
export const BATCH_LIST = YEAR_DEFS.map((y) => y.batch);

/** Weighted stage draw — deterministic given the rng. */
function drawStage(rng, weights) {
  const roll = rng();
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (roll < acc) return i;
  }
  return weights.length - 1;
}

const DAY = 24 * 60 * 60 * 1000;

/* ---------------- cohort generation ----------------
   Built once per process and memoised. Timestamps are computed
   relative to generation time so the funnel always looks current. */

let _cache = null;

function generate(perBranch = DEMO_PER_BRANCH) {
  const rng = mulberry32(20260807);
  const now = Date.now();
  const rows = [];
  const events = [];
  const usedNames = new Set();
  let seq = 0;

  for (const branch of BRANCH_DEFS) {
    // Split this branch's intake across the four years by share, with the
    // remainder landing on the final year so the branch total is exact.
    const perYear = YEAR_DEFS.map((y) => Math.floor(perBranch * y.share));
    perYear[perYear.length - 1] += perBranch - perYear.reduce((a, b) => a + b, 0);

    YEAR_DEFS.forEach((yearDef, yi) => {
      for (let k = 0; k < perYear[yi]; k++) {
        seq += 1;
        let first = pick(rng, FIRST);
        let last = pick(rng, LAST);
        let guard = 0;
        while (usedNames.has(`${first} ${last}`) && guard++ < 80) { first = pick(rng, FIRST); last = pick(rng, LAST); }
        usedNames.add(`${first} ${last}`);

        const name = `${first} ${last}`;
        const id = `demo_${String(seq).padStart(3, '0')}`;
        const email = `${first}.${last}.${String(seq).padStart(3, '0')}@${DEMO_DOMAIN}`.toLowerCase();

        const stage = drawStage(rng, yearDef.stageWeights);

        /* ---- skills: specialisation core + shared fundamentals ----
           Junior years lean on the shared pool (they have not reached the
           specialisation electives yet); seniors lean on their branch core.
           This is what makes a mixed-branch team visibly different from a
           single-branch team when the team-project engine analyses it. */
        const [loSkills, hiSkills] = yearDef.skillRange;
        const skillCount = stage === 0
          ? between(rng, 0, Math.max(1, loSkills - 1))
          : between(rng, loSkills, hiSkills);
        const skillSet = new Set();
        for (let s = 0; s < skillCount * 3 && skillSet.size < skillCount; s++) {
          const fromShared = rng() < yearDef.sharedBias;
          skillSet.add(pick(rng, fromShared ? SHARED_SKILLS : branch.core));
        }
        const skills = [...skillSet];

        const verifiedCount = stage === 5 ? Math.min(skills.length, between(rng, 5, 9))
          : stage === 4 ? Math.min(skills.length, between(rng, 3, 6))
            : stage === 3 ? Math.min(skills.length, between(rng, 1, 3)) : 0;
        const verifiedSkills = skills.slice(0, verifiedCount);
        const pendingSkills = stage >= 2 ? skills.slice(verifiedCount, verifiedCount + between(rng, 0, 2)) : [];

        const projectsTotal = stage === 0 ? 0 : stage === 1 ? between(rng, 0, 1)
          : stage === 5 ? between(rng, 3, 5) : between(rng, 1, 4);

        /* Each status is drawn independently, then spent against a shared
           budget of the student's actual projects. Without the budget the
           counts could describe more outcomes than the student has work: a
           third-year with 2 projects could report 2 pending + 1 needs-review
           + 1 rejected. In memory nothing cross-checked that, but a database
           stores one row per project and the sum has to close. */
        let remaining = projectsTotal;
        const take = (n) => { const v = Math.max(0, Math.min(n, remaining)); remaining -= v; return v; };

        const projectsVerified = take(stage === 5 ? between(rng, 2, 4) : stage === 4 ? between(rng, 1, 3) : 0);
        const projectsPending = take(stage === 3 ? between(rng, 1, 2) : stage >= 4 ? between(rng, 0, 1) : 0);
        const projectsNeedsReview = take(stage === 3 && rng() > 0.75 ? 1 : 0);
        const projectsRejected = take(stage >= 3 && rng() > 0.85 ? 1 : 0);

        /* Recruiter-ready is a subset of verified, never a superset: a project
           a recruiter can open is only proof if it has passed verification. */
        const recruiterReadyProjects = Math.min(
          projectsVerified,
          stage === 5 ? Math.max(2, projectsVerified) : stage === 4 ? between(rng, 0, projectsVerified) : 0,
        );

        // Engagement — recruiter-ready students lean active, registered lean
        // dormant. Seniors lean active across the board because placement
        // season is on them.
        const engRoll = rng() + stage * 0.08 + yi * 0.03;
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

        // A student cannot have been a member longer than they have been
        // enrolled, so membership age scales with year.
        const memberSinceDays = between(rng, 30, 90 + yi * 150);
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

        // Project titles are drawn from this branch's own vocabulary, so a
        // drill-down on a DevOps student never shows a computer-vision project.
        const projectPool = [...branch.projects];
        const projectNames = [];
        for (let p = 0; p < projectsTotal && projectPool.length; p++) {
          projectNames.push(projectPool.splice(Math.floor(rng() * projectPool.length), 1)[0]);
        }

        const row = {
          id,
          name,
          email,
          branch: branch.id,
          branchShort: branch.short,
          batch: yearDef.batch,
          year: yearDef.year,
          rollNo: `${branch.short}${yearDef.batch.slice(-2)}${String(k + 1).padStart(3, '0')}`,
          targetRole: stage === 0 ? '' : pick(rng, branch.roles),
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
          resumeVersions: resumeScore == null ? 0 : between(rng, 1, 4),
          cgpa: Math.round((6.2 + rng() * 3.5) * 100) / 100,
          backlogs: rng() > 0.88 ? between(rng, 1, 3) : 0,
          lastActiveAt: lastActiveDaysAgo == null ? null : new Date(now - lastActiveDaysAgo * DAY).toISOString(),
          memberSince: new Date(now - memberSinceDays * DAY).toISOString(),
          membership: { status: 'active', via: pick(rng, ['roster', 'roster', 'domain', 'code']), at: new Date(now - memberSinceDays * DAY).toISOString() },
          readinessScore: readiness.score,
          readinessCategory: readiness.category,
          readinessComponents: readiness.components,
          readinessGaps: readiness.gaps,
          _stage: stage,
          _yearIndex: yi,
          _projectNames: projectNames,
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
    });
  }

  return { rows, events };
}

function cohort() {
  if (!_cache) _cache = generate(DEMO_PER_BRANCH);
  return _cache;
}

/** Test hook — forces regeneration (also lets a test request a different size). */
export function _regenerate(perBranch = DEMO_PER_BRANCH) {
  _cache = generate(perBranch);
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

const strip = ({ _stage, _yearIndex, _projectNames, ...r }) => ({ ...r });

/** Matches the shape of db.listCollegeStudents (readiness is added by the route). */
export function demoStudents({ filters = {} } = {}) {
  return cohort().rows.filter((r) => matchesFilters(r, filters)).map(strip);
}

/** Matches db.collegeStudentsDeep — { rows, events }. */
export function demoStudentsDeep() {
  const { rows, events } = cohort();
  return { rows: rows.map(strip), events: [...events] };
}

/* Resume history is generated per student rather than being a fixed pair, so
   the drill-down shows a real revision curve: earlier versions score lower,
   and a student who iterated four times has a visibly steeper climb than one
   who uploaded once. A flat two-point history read as a stub on screen. */
function resumeHistoryFor(row, now) {
  if (row.resumeScore == null) return [];
  const versions = Math.max(1, row.resumeVersions || 1);
  const rng = mulberry32(row.id.split('_')[1] ? Number(row.id.split('_')[1]) * 977 : 977);
  const out = [];
  let cumulative = 0;
  for (let i = 0; i < versions; i++) {
    // i = 0 is the LATEST (newest-first, matching the DB path).
    if (i > 0) cumulative += between(rng, 4, 11);
    const score = Math.max(18, row.resumeScore - cumulative);
    out.push({
      version: versions - i,
      score,
      ats: Math.max(18, (row.resumeAts ?? score) - cumulative),
      impact: Math.max(18, (row.resumeImpact ?? score) - cumulative),
      clarity: Math.max(18, (row.resumeClarity ?? score) - cumulative),
      createdAt: new Date(now - (6 + i * 28) * DAY).toISOString(),
    });
  }
  return out;
}

/** Matches db.collegeStudentDetail. */
export function demoStudentDetail(studentId) {
  const row = cohort().rows.find((r) => r.id === String(studentId));
  if (!row) return null;
  const now = Date.now();
  const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const statuses = ['verified', 'verified', 'pending', 'needs_review', 'rejected'];

  const projects = row._projectNames.map((title, i) => {
    const verified = i < row.projectsVerified;
    const recruiterReady = i < row.recruiterReadyProjects;
    return {
      id: `${row.id}_p${i + 1}`,
      title,
      // The branch is carried on the project so a TPO or recruiter can see at a
      // glance that the work matches the specialisation on the profile.
      discipline: row.branch,
      verificationStatus: verified ? 'verified'
        : i < row.projectsVerified + row.projectsPending ? 'pending'
          : statuses[Math.min(i, statuses.length - 1)],
      status: verified ? 'verified' : 'pending',
      githubUrl: recruiterReady ? `https://github.com/demo-institute/${slug(title)}` : '',
      // A recruiter-ready project is one a recruiter can actually open, so it
      // carries a live URL too. (.test can never route — this is a label in the
      // UI, never something the verifier is pointed at during a real check.)
      liveDemoUrl: recruiterReady ? `https://${slug(title)}.demo-institute.test` : '',
      createdAt: new Date(now - (30 + i * 22) * DAY).toISOString(),
      updatedAt: new Date(now - Math.max(2, 12 - i * 2) * DAY).toISOString(),
    };
  });

  const skillLedger = row.skills.map((skillName) => ({
    skillName,
    verifiedXp: row.verifiedSkills.includes(skillName) ? Math.round(row.totalVerifiedXp / Math.max(1, row.verifiedSkills.length)) : 0,
    pendingXp: row.pendingSkills.includes(skillName) ? Math.round(row.totalPendingXp / Math.max(1, row.pendingSkills.length)) : 0,
  }));

  return {
    student: strip(row),
    projects,
    skillLedger,
    resumeHistory: resumeHistoryFor(row, now),
    activity: projects.slice(0, 5).map((p) => ({ type: 'project', label: p.title, at: p.updatedAt })),
    demo: true,
  };
}

/* ---------------- drives ----------------
   A believable placement season for a specialisation-led CSE department:
   volume hirers open to every branch, specialisation-targeted roles only one or
   two branches clear, internship drives for the pre-final year, and a single
   "dream offer" almost nobody clears. `selectivity` is consumed by demoOutcomes
   to shape each funnel — mass recruiters convert far more of their applicants
   than a 28 LPA platform role does. */

const AIML = 'CSE (AI & ML)';
const BDA = 'CSE (Big Data)';
const CC = 'CSE (Cloud Computing)';
const DVO = 'CSE (DevOps)';

export function demoDrives() {
  const now = EPOCH;
  return [
    {
      id: 'demo_drive_1', title: 'Backend Engineer \u2014 Campus Hire 2026', company: 'Northwind Systems',
      role: 'SDE-1', location: 'Pune', ctcLpa: 11,
      eligibility: { branches: [CC, DVO], batches: ['2026'], minResume: 65 },
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
      id: 'demo_drive_3', title: 'Machine Learning Engineer', company: 'Meridian Labs',
      role: 'ML Engineer', location: 'Bengaluru', ctcLpa: 14,
      eligibility: { branches: [AIML], batches: ['2026'], minResume: 68, minVerifiedProjects: 1 },
      status: 'in_progress', selectivity: 0.85,
      createdAt: new Date(now - 17 * DAY).toISOString(), demo: true,
    },
    {
      id: 'demo_drive_4', title: 'Data Engineer \u2014 Platform Team', company: 'Halcyon Data',
      role: 'Data Engineer', location: 'Pune', ctcLpa: 9.5,
      eligibility: { branches: [BDA, AIML], batches: ['2026'], minResume: 60 },
      status: 'closed', selectivity: 1.2,
      createdAt: new Date(now - 38 * DAY).toISOString(), demo: true,
    },
    {
      id: 'demo_drive_5', title: 'Cloud Support Associate', company: 'Ironvale Cloud',
      role: 'Cloud Associate', location: 'Nashik', ctcLpa: 5.4,
      eligibility: { branches: [CC, DVO], batches: ['2026'], minResume: 45 },
      status: 'closed', selectivity: 1.5,
      createdAt: new Date(now - 33 * DAY).toISOString(), demo: true,
    },
    {
      id: 'demo_drive_6', title: 'Platform Engineer \u2014 Dream Offer', company: 'Aurelia Cloud',
      role: 'Platform Engineer', location: 'Remote', ctcLpa: 28,
      eligibility: { branches: [CC, DVO, BDA], batches: ['2026'], minReadiness: 72, minVerifiedProjects: 1 },
      status: 'in_progress', selectivity: 0.7,
      createdAt: new Date(now - 8 * DAY).toISOString(), demo: true,
    },
    {
      id: 'demo_drive_7', title: 'Data Analyst Internship', company: 'Kestrel Analytics',
      role: 'Data Analyst Intern', location: 'Pune', ctcLpa: 5.5,
      eligibility: { branches: [BDA, AIML, CC], batches: ['2027'], minResume: 55 },
      status: 'open', selectivity: 1.1,
      createdAt: new Date(now - 4 * DAY).toISOString(), demo: true,
    },
    {
      id: 'demo_drive_8', title: 'SRE Internship \u2014 Pre-Final Year', company: 'Vantage Reliability',
      role: 'SRE Intern', location: 'Hybrid \u2014 Pune', ctcLpa: 6,
      eligibility: { branches: [DVO, CC], batches: ['2027'], minResume: 50 },
      status: 'open', selectivity: 1.0,
      createdAt: new Date(now - 2 * DAY).toISOString(), demo: true,
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
    { id: 'demo_pending_3', name: 'Tejas Salunkhe', email: `tejas.salunkhe.903@${DEMO_DOMAIN}`, status: 'pending', via: 'code', at: new Date(Date.now() - 4 * DAY).toISOString(), accountType: 'student', demo: true },
  );
  return status ? members.filter((m) => m.status === status) : members;
}

export function demoRoster() {
  // Most of the cohort arrived through a roster import — that is how a real
  // placement cell onboards — with a tail of invited students who have not
  // signed up yet, so "invited vs joined" is not a straight line.
  const joined = cohort().rows.slice(0, 160).map((r) => ({
    email: r.email, name: r.name, branch: r.branch, batch: r.batch,
    rollNo: r.rollNo, status: 'joined', createdAt: r.memberSince, demo: true,
  }));
  const invited = [];
  for (let i = 0; i < 24; i++) {
    const branch = BRANCH_DEFS[i % BRANCH_DEFS.length];
    const batch = BATCH_LIST[i % BATCH_LIST.length];
    invited.push({
      email: `invited.student.${String(i + 1).padStart(2, '0')}@${DEMO_DOMAIN}`,
      name: `Invited Student ${i + 1}`, branch: branch.id, batch,
      rollNo: `INV${branch.short}${String(i + 1).padStart(3, '0')}`, status: 'invited',
      createdAt: new Date(Date.now() - (i + 3) * DAY).toISOString(), demo: true,
    });
  }
  const rows = [...joined, ...invited];
  return { rows, counts: { invited: invited.length, joined: joined.length } };
}

export function demoTasks() {
  const now = Date.now();
  return [
    { id: 'demo_task_1', title: 'Upload your latest resume', description: 'Placement season opens in six weeks \u2014 get a scored resume on file.', dueAt: new Date(now + 5 * DAY).toISOString(), assignedCount: 52, completedCount: 21, createdAt: new Date(now - 4 * DAY).toISOString(), demo: true },
    { id: 'demo_task_2', title: 'Submit one project for verification', description: 'Verified projects are what recruiters filter on.', dueAt: new Date(now + 12 * DAY).toISOString(), assignedCount: 74, completedCount: 33, createdAt: new Date(now - 11 * DAY).toISOString(), demo: true },
    { id: 'demo_task_3', title: 'Complete mock interview round 1', description: 'Slots are open all of next week.', dueAt: new Date(now - 2 * DAY).toISOString(), assignedCount: 48, completedCount: 41, createdAt: new Date(now - 21 * DAY).toISOString(), demo: true },
    { id: 'demo_task_4', title: 'Deploy your capstone to a public URL', description: 'A project nobody can open is not proof. Free tiers are fine.', dueAt: new Date(now + 9 * DAY).toISOString(), assignedCount: 36, completedCount: 12, createdAt: new Date(now - 6 * DAY).toISOString(), demo: true },
    { id: 'demo_task_5', title: 'Third-year: pick an internship track', description: 'AI/ML, Data, Cloud or DevOps \u2014 tell us so we can match you to drives.', dueAt: new Date(now + 20 * DAY).toISOString(), assignedCount: 50, completedCount: 29, createdAt: new Date(now - 9 * DAY).toISOString(), demo: true },
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
    branches: BRANCH_LIST, years: YEAR_LIST, batches: BATCH_LIST,
  };
}

export default {
  DEMO_COLLEGE_ID, DEMO_COLLEGE_NAME, DEMO_DOMAIN, DEMO_JOIN_CODE, DEMO_TPO_EMAIL,
  DEMO_STUDENT_COUNT, DEMO_PER_BRANCH, BRANCH_LIST, YEAR_LIST, BATCH_LIST,
  demoModeEnabled, demoStudents, demoStudentsDeep, demoStudentDetail,
  demoDrives, demoMembers, demoRoster, demoTasks, demoCollege,
  demoOutcomes, demoSnapshots, _regenerate,
};
