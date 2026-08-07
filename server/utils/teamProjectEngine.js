/* ============================================================
   TEAM PROJECT ENGINE — deterministic team formation + project fit
   ------------------------------------------------------------
   The gap this closes: a placement coordinator could see the cohort,
   nudge individuals and assign tasks — but had no way to say
   "these five students, together, build this thing, and show me it
   running." Group capstone work is how most Indian placement cells
   actually generate proof-of-work before a drive season, and it was
   the one workflow the platform could not express.

   This module is the brain behind that. It does three things and
   none of them touch a network or an AI provider:

     1. analyzeTeamSkills(members)
        Rolls the team's declared + verified skills into capability
        AREAS (frontend, backend, data, ML, devops, mobile, hardware,
        QA). Reports covered areas, gaps, and per-area depth. This is
        what makes the assignment "customised based on team skills"
        rather than a generic brief with names attached.

     2. suggestTeams({ students, teamSize, strategy })
        Snake-draft team formation. 'balanced' interleaves by
        readiness so no team is all-stars vs all-strugglers, then
        repairs coverage gaps by swapping members between teams.
        Deterministic: the same cohort always produces the same
        teams, so a re-run during a demo looks identical.

     3. generateTeamProject({ members, analysis, options })
        Picks the archetype whose required areas the team already
        covers best, then customises it: the stack is drawn from the
        team's OWN skills (never a skill nobody has), every member
        gets a named role and owned modules matched to their
        strongest area, and milestones are sized to the deadline.

   HOUSE RULE (see architecture-philosophy): the structure and every
   score here are deterministic and backend-owned. No AI writes any
   part of an assignment a coordinator will be held to. Nothing here
   throws; every function degrades to a usable default.
   ============================================================ */

/* ---------------- capability areas ----------------
   Skill → area mapping. Lowercased substring match, longest first so
   'spring boot' wins over 'boot'. Deliberately generous: a student who
   wrote "Node" and one who wrote "Node.js" land in the same area. */

const AREA_SKILLS = {
  frontend: ['react', 'next.js', 'nextjs', 'vue', 'angular', 'svelte', 'javascript', 'typescript',
    'html', 'css', 'tailwind', 'bootstrap', 'redux', 'jquery', 'figma', 'ui/ux', 'ui design'],
  backend: ['node', 'node.js', 'express', 'java', 'spring', 'spring boot', 'django', 'flask',
    'fastapi', 'php', 'laravel', 'ruby', 'rails', '.net', 'c#', 'go', 'golang', 'rest api',
    'rest apis', 'graphql', 'microservices'],
  data: ['sql', 'mysql', 'postgres', 'postgresql', 'mongodb', 'mongo', 'redis', 'oracle',
    'data structures', 'dbms', 'pandas', 'numpy', 'excel', 'power bi', 'tableau', 'etl',
    'data analysis', 'data analytics'],
  ml: ['machine learning', 'deep learning', 'tensorflow', 'pytorch', 'scikit', 'sklearn', 'nlp',
    'computer vision', 'opencv', 'ai', 'llm', 'data science', 'r'],
  devops: ['docker', 'kubernetes', 'aws', 'azure', 'gcp', 'ci/cd', 'jenkins', 'terraform',
    'linux', 'git', 'github actions', 'ansible', 'devops', 'nginx'],
  mobile: ['android', 'ios', 'flutter', 'react native', 'kotlin', 'swift', 'dart'],
  hardware: ['embedded c', 'arduino', 'raspberry pi', 'iot', 'vhdl', 'verilog', 'matlab',
    'plc', 'autocad', 'solidworks', 'catia', 'ansys', 'pcb', 'microcontroller'],
  qa: ['testing', 'selenium', 'jest', 'junit', 'pytest', 'cypress', 'manual testing',
    'automation testing', 'qa', 'postman'],
};

export const AREA_LABELS = {
  frontend: 'Frontend / UI',
  backend: 'Backend / APIs',
  data: 'Data & storage',
  ml: 'ML / analytics',
  devops: 'Deployment & DevOps',
  mobile: 'Mobile',
  hardware: 'Hardware / embedded',
  qa: 'Testing & QA',
};

export const AREA_IDS = Object.keys(AREA_SKILLS);

/* Longest-first so multi-word skills match before their fragments. */
const AREA_INDEX = Object.entries(AREA_SKILLS)
  .flatMap(([area, list]) => list.map((token) => ({ area, token })))
  .sort((a, b) => b.token.length - a.token.length);

const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const lower = (v) => clean(v).toLowerCase();
const uniq = (list) => [...new Set(list.filter(Boolean))];

/** Which capability area a single declared skill belongs to ('' if unknown). */
export function areaForSkill(skill) {
  const s = lower(skill);
  if (!s) return '';
  for (const { area, token } of AREA_INDEX) {
    if (s === token || s.includes(token)) return area;
  }
  return '';
}

/* ---------------- team skill analysis ---------------- */

/**
 * Roll a team's members up into a capability profile.
 *
 * A verified skill counts double: the whole point of the platform is
 * that verified proof outranks a self-declared list, and a team brief
 * built on unverified claims would be a brief built on nothing.
 *
 * @param {Array} members - rows shaped like db.listCollegeStudents output
 * @returns {{ areas, covered, gaps, strongest, skillCounts, allSkills,
 *             verifiedSkills, coverageScore, avgReadiness }}
 */
export function analyzeTeamSkills(members = []) {
  const rows = Array.isArray(members) ? members : [];
  const areas = {};
  for (const id of AREA_IDS) areas[id] = { id, label: AREA_LABELS[id], depth: 0, members: [], skills: [] };

  const skillCounts = new Map();
  const allSkills = [];
  const verifiedAll = [];

  for (const m of rows) {
    const declared = uniq((m.skills || []).map((s) => clean(s, 60)));
    const verified = new Set(uniq((m.verifiedSkills || []).map(lower)));
    for (const skill of declared) {
      allSkills.push(skill);
      const key = lower(skill);
      skillCounts.set(key, (skillCounts.get(key) || 0) + 1);
      if (verified.has(key)) verifiedAll.push(skill);
      const area = areaForSkill(skill);
      if (!area) continue;
      const bucket = areas[area];
      // Verified counts double — see note above.
      bucket.depth += verified.has(key) ? 2 : 1;
      bucket.skills.push(skill);
      if (!bucket.members.includes(m.id)) bucket.members.push(m.id);
    }
  }

  for (const id of AREA_IDS) {
    areas[id].skills = uniq(areas[id].skills).slice(0, 12);
    areas[id].memberCount = areas[id].members.length;
  }

  const ranked = AREA_IDS
    .map((id) => areas[id])
    .sort((a, b) => b.depth - a.depth || a.id.localeCompare(b.id));

  const covered = ranked.filter((a) => a.depth > 0).map((a) => a.id);
  const gaps = ranked.filter((a) => a.depth === 0).map((a) => a.id);

  const readinessValues = rows.map((m) => Number(m.readinessScore || 0));
  const avgReadiness = readinessValues.length
    ? Math.round(readinessValues.reduce((a, b) => a + b, 0) / readinessValues.length)
    : 0;

  // Coverage score is a plain 0–100 read of "how much of a full-stack build
  // can this team actually staff", weighted toward the areas any shippable
  // student project needs. It is NOT a quality judgement of the students.
  const CORE = ['frontend', 'backend', 'data', 'devops'];
  const coreCovered = CORE.filter((id) => areas[id].depth > 0).length;
  const bonus = ['ml', 'mobile', 'hardware', 'qa'].filter((id) => areas[id].depth > 0).length;
  const coverageScore = Math.min(100, Math.round((coreCovered / CORE.length) * 80 + bonus * 5));

  return {
    areas: ranked,
    covered,
    gaps,
    strongest: ranked[0]?.depth > 0 ? ranked[0].id : '',
    skillCounts: [...skillCounts.entries()]
      .map(([skill, count]) => ({ skill, count }))
      .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
      .slice(0, 30),
    allSkills: uniq(allSkills),
    verifiedSkills: uniq(verifiedAll),
    coverageScore,
    avgReadiness,
    size: rows.length,
  };
}

/* ---------------- team formation ---------------- */

/**
 * Split a set of students into teams.
 *
 * 'balanced'  — snake draft by readiness, so every team gets one of the
 *               strongest and one of the weakest students. This is what a
 *               coordinator actually wants: peer lift, not a top team and
 *               a bottom team.
 * 'similar'   — contiguous blocks by readiness, for when a coordinator is
 *               deliberately streaming (e.g. a fast track before a drive).
 *
 * Deterministic: ties break on id, so the same cohort always yields the
 * same teams. No randomness anywhere.
 */
export function suggestTeams({ students = [], teamSize = 4, strategy = 'balanced', maxTeams = 0 } = {}) {
  const size = Math.min(8, Math.max(2, Number(teamSize) || 4));
  const pool = (Array.isArray(students) ? students : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => (Number(b.readinessScore || 0) - Number(a.readinessScore || 0))
      || String(a.id).localeCompare(String(b.id)));

  if (!pool.length) return { teams: [], strategy, teamSize: size, unassigned: [] };

  const teamCount = Math.max(1, Math.floor(pool.length / size)) || 1;
  const buckets = Array.from({ length: teamCount }, () => []);

  if (strategy === 'similar') {
    pool.forEach((s, i) => { buckets[Math.min(teamCount - 1, Math.floor(i / size))].push(s); });
  } else {
    // Snake draft: 0,1,2,2,1,0,0,1,2…
    let idx = 0; let dir = 1;
    for (const s of pool) {
      if (buckets[idx].length >= size) {
        // This row is full; find the next team with room, preserving order.
        const open = buckets.findIndex((b) => b.length < size);
        if (open === -1) break;
        idx = open;
      }
      buckets[idx].push(s);
      if (teamCount === 1) continue;
      idx += dir;
      if (idx >= teamCount) { idx = teamCount - 1; dir = -1; } else if (idx < 0) { idx = 0; dir = 1; }
    }
  }

  const assignedIds = new Set(buckets.flat().map((s) => String(s.id)));
  const unassigned = pool.filter((s) => !assignedIds.has(String(s.id)));

  // Leftovers ride along on the smallest teams rather than being dropped —
  // a coordinator selecting 11 students expects 11 students placed.
  for (const s of unassigned) {
    const smallest = buckets.reduce((a, b) => (b.length < a.length ? b : a), buckets[0]);
    smallest.push(s);
  }

  const teams = buckets
    .filter((b) => b.length)
    .slice(0, maxTeams > 0 ? maxTeams : undefined)
    .map((members, i) => {
      const analysis = analyzeTeamSkills(members);
      return {
        index: i + 1,
        name: `Team ${i + 1}`,
        memberIds: members.map((m) => String(m.id)),
        members: members.map(shapeMember),
        analysis,
      };
    });

  return { teams, strategy, teamSize: size, unassigned: [] };
}

/** The member shape stored on an assignment and rendered in both dashboards. */
export function shapeMember(m = {}) {
  return {
    studentId: String(m.id || ''),
    name: clean(m.name, 120) || 'Student',
    email: lower(m.email || ''),
    branch: clean(m.branch, 60),
    batch: clean(m.batch, 20),
    year: clean(m.year, 20),
    skills: uniq((m.skills || []).map((s) => clean(s, 60))).slice(0, 20),
    verifiedSkills: uniq((m.verifiedSkills || []).map((s) => clean(s, 60))).slice(0, 20),
    readinessScore: Number(m.readinessScore || 0),
    resumeScore: m.resumeScore == null ? null : Number(m.resumeScore),
    verifiedProjects: Number(m.verifiedProjects ?? m.projectsVerified ?? 0),
  };
}

/* ---------------- project archetypes ----------------
   Each archetype declares the areas it NEEDS. Selection picks the one the
   team already staffs best, so the assignment is a stretch, not a wall.
   Every archetype is a build a placement cell can plausibly demo to a
   recruiter and a student can plausibly ship in 3–6 weeks. */

const ARCHETYPES = [
  {
    id: 'campus_ops_platform',
    title: 'Campus Operations Platform',
    needs: ['frontend', 'backend', 'data'],
    problem: 'Placement cells and departments still run drives, attendance and approvals over WhatsApp groups and spreadsheets, so nobody can answer "what is the current status" without asking three people.',
    users: 'Placement staff, department coordinators and the students they manage',
    core: [
      'Role-based login (staff vs student) with real server-side authorization',
      'A record that moves through explicit states, with every transition recorded',
      'A staff dashboard with counts that reconcile against the underlying rows',
      'Student self-service view of only their own records',
    ],
    differentiator: 'The audit trail. Any staff action can be replayed from stored events — that is what turns a CRUD app into something an institution would actually adopt.',
  },
  {
    id: 'verification_service',
    title: 'Document & Claim Verification Service',
    needs: ['backend', 'data', 'devops'],
    problem: 'Certificates, internship letters and project claims are accepted on trust. Verifying one means emailing an issuer and waiting days, so in practice nobody verifies anything.',
    users: 'Placement cells, recruiters, and any institution issuing credentials',
    core: [
      'Issue a credential with a tamper-evident hash and a public verify endpoint',
      'A verifier page that takes an id and returns valid / invalid / unknown — never a maybe',
      'Bulk issuance from a CSV, with per-row error reporting',
      'Rate limiting and input validation on every public route',
    ],
    differentiator: 'The verify endpoint is public and stateless. Anyone can check a credential without an account, which is the only property that makes a verification system useful.',
  },
  {
    id: 'analytics_intelligence',
    title: 'Cohort Analytics & Early-Warning System',
    needs: ['data', 'ml', 'backend'],
    problem: 'Institutions discover a student is falling behind at the end of the semester, when nothing can be done about it. The signals existed weeks earlier and nobody was watching them.',
    users: 'Department heads, mentors and placement coordinators',
    core: [
      'An ingestion path that takes messy real data (CSV / API) and normalises it',
      'A rule-based risk score with every contributing factor shown, not a black box',
      'A trend view comparing this cohort against stored historical snapshots',
      'An export the institution can put in a report without reformatting it',
    ],
    differentiator: 'Explainability. Every flagged student comes with the exact rules that fired — a score nobody can interrogate gets ignored by the people who need to act on it.',
  },
  {
    id: 'realtime_coordination',
    title: 'Real-Time Coordination & Notification System',
    needs: ['frontend', 'backend', 'devops'],
    problem: 'Time-sensitive announcements reach students late or not at all, and the sender has no idea who actually saw them.',
    users: 'Any organisation that needs a message to reliably reach a specific group',
    core: [
      'Targeted broadcast to a filtered group, not a blanket send-to-all',
      'Delivery and read state per recipient, reported honestly',
      'Live updates in the UI without a manual refresh',
      'A retry path for failed deliveries that does not duplicate messages',
    ],
    differentiator: 'Honest delivery reporting. Most student projects claim a notification was sent; this one distinguishes sent, delivered, read and failed, and shows which is which.',
  },
  {
    id: 'ml_decision_support',
    title: 'ML-Backed Decision Support Tool',
    needs: ['ml', 'data', 'backend'],
    problem: 'A repeated judgement call in the domain is made from experience alone, so it is inconsistent between people and impossible to review.',
    users: 'The practitioners who make that call daily',
    core: [
      'A measured baseline before any model — the dumbest approach that works',
      'A trained model evaluated on a held-out set, reported with its failure cases',
      'An API that serves a prediction with a confidence value',
      'A UI that shows the prediction AND the inputs that drove it',
    ],
    differentiator: 'The baseline comparison. Reporting that the model beats a documented baseline is the difference between a project and a notebook.',
  },
  {
    id: 'mobile_field_tool',
    title: 'Mobile Field-Data Tool',
    needs: ['mobile', 'backend', 'data'],
    problem: 'Data is collected on paper in the field and typed in later, which loses time, loses forms, and makes the data unusable while it still matters.',
    users: 'Field staff — surveyors, inspectors, health workers, campus volunteers',
    core: [
      'Offline-first capture that syncs when the connection returns',
      'Conflict handling when the same record was edited in two places',
      'Photo / location capture attached to the record',
      'A web dashboard where the collected data is immediately visible',
    ],
    differentiator: 'Working offline. Handling sync conflicts correctly is a genuinely hard problem and interviewers know it.',
  },
  {
    id: 'iot_monitoring',
    title: 'Sensor Monitoring & Alerting System',
    needs: ['hardware', 'backend', 'data'],
    problem: 'Equipment or environmental conditions are checked manually on a schedule, so a failure between checks is only found after it has caused damage.',
    users: 'Facilities, lab and maintenance teams',
    core: [
      'A sensor node publishing readings on a defined interval',
      'An ingestion API that stores time-series readings and rejects bad ones',
      'Threshold alerting with hysteresis, so a borderline reading does not spam',
      'A dashboard showing live values and history together',
    ],
    differentiator: 'Calibration and hysteresis. A monitoring project that alerts on every noisy reading gets muted on day two — handling that is the actual engineering.',
  },
  {
    id: 'quality_automation',
    title: 'Automated Quality & Regression Harness',
    needs: ['qa', 'backend', 'devops'],
    problem: 'Testing is manual and only happens before a release, so regressions are found by users rather than by the team.',
    users: 'Any software team, including the other project teams in this cohort',
    core: [
      'A test suite covering the critical paths, running in CI on every push',
      'A reporting layer that shows what broke, when, and in which commit',
      'Seeded test data so runs are repeatable rather than flaky',
      'A visible pass/fail badge tied to the real latest run',
    ],
    differentiator: 'Green CI on a public repo. It is the single most verifiable proof artifact a student can produce, and almost nobody has one.',
  },
];

/* ---------------- role assignment ---------------- */

const ROLE_FOR_AREA = {
  frontend: 'Frontend Lead',
  backend: 'Backend Lead',
  data: 'Data & Schema Owner',
  ml: 'ML / Analytics Owner',
  devops: 'Deployment & CI Owner',
  mobile: 'Mobile Lead',
  hardware: 'Hardware / Firmware Owner',
  qa: 'QA & Test Owner',
};

const MODULES_FOR_AREA = {
  frontend: ['UI screens and routing', 'Form validation and error states', 'Responsive layout pass'],
  backend: ['API endpoints and request validation', 'Authentication and authorization', 'Business-logic services'],
  data: ['Schema design and migrations', 'Query layer and indexes', 'Seed and fixture data'],
  ml: ['Baseline and evaluation harness', 'Model training pipeline', 'Prediction API and confidence reporting'],
  devops: ['Deployment to a public URL', 'CI workflow running tests on every push', 'Environment config and secrets handling'],
  mobile: ['App screens and navigation', 'Offline storage and sync', 'Device permissions and capture'],
  hardware: ['Sensor wiring and firmware', 'Calibration procedure and record', 'Bill of materials'],
  qa: ['Test plan and critical-path cases', 'Automated test suite', 'Bug triage and regression log'],
};

/** Each member's strongest area, resolved so no two members get the same
    lead role while an uncovered area is still going spare. */
function assignRoles(members, analysis) {
  const rankedAreas = analysis.areas.filter((a) => a.depth > 0).map((a) => a.id);
  const taken = new Set();

  const strengthOf = (member) => {
    const counts = {};
    for (const s of member.skills || []) {
      const area = areaForSkill(s);
      if (!area) continue;
      const verified = (member.verifiedSkills || []).some((v) => lower(v) === lower(s));
      counts[area] = (counts[area] || 0) + (verified ? 2 : 1);
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([a]) => a);
  };

  // Strongest members pick first — deterministic, and it means the lead roles
  // land with the people most likely to actually deliver them.
  const order = members
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (b.m.readinessScore - a.m.readinessScore) || a.m.studentId.localeCompare(b.m.studentId));

  const roles = new Map();
  for (const { m } of order) {
    const prefs = strengthOf(m);
    let area = prefs.find((a) => !taken.has(a))
      || rankedAreas.find((a) => !taken.has(a))
      || prefs[0]
      || 'backend';
    taken.add(area);
    roles.set(m.studentId, area);
  }

  return members.map((m) => {
    const area = roles.get(m.studentId) || 'backend';
    const matched = (m.skills || []).filter((s) => areaForSkill(s) === area).slice(0, 6);
    return {
      studentId: m.studentId,
      name: m.name,
      email: m.email,
      area,
      areaLabel: AREA_LABELS[area] || area,
      role: ROLE_FOR_AREA[area] || 'Contributor',
      // Modules are the concrete, checkable deliverables this person owns.
      modules: MODULES_FOR_AREA[area] || ['Assigned feature module'],
      matchedSkills: matched,
      // Stated plainly so a student assigned outside their comfort zone knows
      // it was deliberate, not an oversight.
      stretch: matched.length === 0,
    };
  });
}

/* ---------------- milestones ---------------- */

function buildMilestones({ dueAt, archetype, hasDevops }) {
  const end = dueAt ? Date.parse(dueAt) : NaN;
  const now = Date.now();
  const totalDays = Number.isFinite(end) && end > now
    ? Math.max(7, Math.round((end - now) / 86400000))
    : 28;

  const plan = [
    { key: 'setup', pct: 0.15, title: 'Repo, skeleton and first commit from every member', detail: 'Public GitHub repo created, README with the problem statement, project skeleton running locally, and at least one commit from every single team member. A team where one person pushes everything fails this milestone.' },
    { key: 'core', pct: 0.45, title: 'Core path working end to end', detail: `The happy path only: ${archetype.core[0]}. It should be possible to run one complete cycle through the system, even if it is ugly.` },
    { key: 'feature', pct: 0.70, title: 'Remaining modules integrated', detail: 'Every member\'s owned modules are merged and working together. Error states handled. Seed data committed so a reviewer can run it.' },
    { key: 'deploy', pct: 0.88, title: 'Deployed to a public URL', detail: hasDevops
      ? 'Live deployment reachable without a login wall, plus a CI workflow running the tests on every push.'
      : 'Live deployment reachable without a login wall. Free tiers (Vercel / Render / Railway / Netlify) are fine — the requirement is that it is publicly reachable, not that it is expensive.' },
    { key: 'proof', pct: 1.0, title: 'Proof pack submitted', detail: 'Live URL and repo URL submitted through the platform, README documenting setup and screenshots, and each member able to explain their own module without notes.' },
  ];

  return plan.map((m, i) => {
    const day = Math.max(1, Math.round(totalDays * m.pct));
    return {
      key: m.key,
      index: i + 1,
      title: m.title,
      detail: m.detail,
      dayOffset: day,
      dueAt: new Date(now + day * 86400000).toISOString(),
    };
  });
}

/* ---------------- generation ---------------- */

/** Pick the archetype the team can staff best; ties break on id for determinism. */
export function selectArchetype(analysis, preferredId = '') {
  if (preferredId) {
    const forced = ARCHETYPES.find((a) => a.id === preferredId);
    if (forced) return { archetype: forced, fit: scoreArchetype(forced, analysis), forced: true };
  }
  const scored = ARCHETYPES
    .map((a) => ({ archetype: a, fit: scoreArchetype(a, analysis) }))
    .sort((x, y) => y.fit.score - x.fit.score || x.archetype.id.localeCompare(y.archetype.id));
  return { ...scored[0], forced: false, runnersUp: scored.slice(1, 4).map((s) => ({ id: s.archetype.id, title: s.archetype.title, score: s.fit.score })) };
}

function scoreArchetype(archetype, analysis) {
  const depthOf = (id) => (analysis.areas.find((a) => a.id === id)?.depth || 0);
  const met = archetype.needs.filter((id) => depthOf(id) > 0);
  const missing = archetype.needs.filter((id) => depthOf(id) === 0);
  // Depth beyond "someone has it" is worth a little, capped so one member with
  // twelve React skills cannot outweigh a genuinely uncovered area.
  const depthBonus = archetype.needs.reduce((s, id) => s + Math.min(3, depthOf(id)), 0);
  const score = Math.round((met.length / archetype.needs.length) * 70 + (depthBonus / (archetype.needs.length * 3)) * 30);
  return { score, met, missing };
}

export const ARCHETYPE_LIST = ARCHETYPES.map((a) => ({ id: a.id, title: a.title, needs: a.needs }));

/**
 * Build the full customised assignment for one team.
 *
 * @param {Array}  members   raw cohort rows (or already-shaped members)
 * @param {Object} options   { title, dueAt, archetypeId, difficulty, notes, domain }
 */
export function generateTeamProject({ members = [], options = {} } = {}) {
  const shaped = members.map((m) => (m.studentId ? m : shapeMember(m)));
  const analysis = analyzeTeamSkills(shaped.map((m) => ({
    id: m.studentId, skills: m.skills, verifiedSkills: m.verifiedSkills, readinessScore: m.readinessScore,
  })));

  const { archetype, fit, runnersUp = [], forced } = selectArchetype(analysis, clean(options.archetypeId, 40));
  const assignments = assignRoles(shaped, analysis);
  const hasDevops = analysis.areas.some((a) => a.id === 'devops' && a.depth > 0);

  // The stack is drawn from skills the team ACTUALLY has. Suggesting a stack
  // nobody knows is how a capstone assignment quietly becomes undeliverable.
  const stack = {};
  for (const area of ['frontend', 'backend', 'data', 'devops', 'ml', 'mobile', 'hardware', 'qa']) {
    const bucket = analysis.areas.find((a) => a.id === area);
    if (bucket?.depth > 0) stack[area] = bucket.skills.slice(0, 4);
  }
  if (!stack.devops) {
    // Deployment is non-negotiable — it is the thing the coordinator verifies —
    // so if nobody has listed it, it is named explicitly as a gap to close.
    stack.devops = ['To be learned: any free host (Vercel / Render / Railway)'];
  }

  const domain = clean(options.domain, 80);
  const title = clean(options.title, 160)
    || `${archetype.title}${domain ? ` for ${domain}` : ''}`;

  const dueAt = clean(options.dueAt, 40);
  const milestones = buildMilestones({ dueAt, archetype, hasDevops });

  const difficulty = ['starter', 'standard', 'stretch'].includes(options.difficulty) ? options.difficulty : 'standard';
  const scopeCount = difficulty === 'starter' ? 3 : difficulty === 'stretch' ? archetype.core.length : archetype.core.length;

  return {
    archetypeId: archetype.id,
    title,
    oneLine: `${title} — built by a ${shaped.length}-person team, staffed to their own verified skills, and judged on a working public deployment.`,
    problem: archetype.problem + (domain ? ` Scoped here to ${domain}.` : ''),
    targetUsers: archetype.users,
    difficulty,

    // Why THIS team got THIS project — the sentence a coordinator reads out.
    whyThisTeam: buildWhyThisTeam(analysis, archetype, fit, shaped.length),

    mustBuild: archetype.core.slice(0, scopeCount),
    differentiator: archetype.differentiator,
    outOfScope: [
      'Payments, unless the core problem is payments',
      'A mobile app AND a web app — pick one surface and finish it',
      'Custom auth from scratch when a library or provider will do',
      'Anything not on the path to the demo you will give',
    ],

    stack,
    assignments,
    milestones,

    // What the coordinator will actually check. Stated up front so there is
    // no argument at submission time.
    proofRequirements: [
      { key: 'live_url', label: 'Live hosted URL', required: true, detail: 'Publicly reachable without a login wall. The coordinator verifies this automatically.' },
      { key: 'repo_url', label: 'Public GitHub repository', required: true, detail: 'Public, with source (not just a README) and commits from every member.' },
      { key: 'readme', label: 'README with setup instructions', required: true, detail: 'What it does, why, and how to run it locally.' },
      { key: 'screenshots', label: 'Screenshots in the repo', required: false, detail: 'docs/screenshots and embedded in the README.' },
      { key: 'ci', label: 'Green CI run', required: false, detail: 'A workflow under .github/workflows passing on the default branch.' },
    ],

    acceptanceCriteria: [
      'The live URL loads and the core path can be completed by someone who was not on the team',
      'The repository is public and contains real source, not only a README',
      'Every team member has commits in the repository history',
      'The README explains setup well enough that a reviewer can run it locally',
      'Each member can explain their own module and one trade-off they made',
    ],

    coverage: {
      score: analysis.coverageScore,
      covered: analysis.covered,
      gaps: analysis.gaps,
      archetypeFit: fit.score,
      metNeeds: fit.met,
      missingNeeds: fit.missing,
      forced,
      alternatives: runnersUp,
    },

    // Gaps become learning goals rather than silent risk.
    gapPlan: fit.missing.map((id) => ({
      area: id,
      label: AREA_LABELS[id] || id,
      note: `Nobody on this team has listed ${AREA_LABELS[id] || id} skills. Assign one member to own it and budget the first week for learning — or descope the parts of the build that need it.`,
    })),

    notes: clean(options.notes, 2000),
    generatedAt: new Date().toISOString(),
    engine: 'deterministic-v1',
  };
}

function buildWhyThisTeam(analysis, archetype, fit, size) {
  const strong = analysis.areas.filter((a) => a.depth > 0).slice(0, 3).map((a) => a.label);
  const metLabels = fit.met.map((id) => AREA_LABELS[id] || id);
  const missLabels = fit.missing.map((id) => AREA_LABELS[id] || id);
  const parts = [];
  parts.push(`This ${size}-person team's declared and verified skills cluster in ${strong.length ? strong.join(', ') : 'no clearly identified area yet'}.`);
  if (metLabels.length) parts.push(`That covers ${metLabels.join(' and ')}, which is what ${archetype.title} needs most.`);
  if (missLabels.length) parts.push(`It does not yet cover ${missLabels.join(' and ')} — that is the deliberate stretch in this assignment.`);
  parts.push(`Average readiness across the team is ${analysis.avgReadiness}.`);
  return parts.join(' ');
}

/* ---------------- progress roll-up ---------------- */

/** Status a coordinator reads at a glance, derived — never hand-set. */
export function summarizeAssignment(assignment = {}) {
  const submission = assignment.submission || {};
  const verification = assignment.verification || null;
  const dueMs = assignment.dueAt ? Date.parse(assignment.dueAt) : NaN;
  const overdue = Number.isFinite(dueMs) && dueMs < Date.now() && !verification?.passed;

  let status = 'assigned';
  if (verification?.passed) status = 'verified';
  else if (verification && !verification.passed) status = 'needs_work';
  else if (submission.liveUrl || submission.repoUrl) status = 'submitted';
  else if (overdue) status = 'overdue';

  return {
    status,
    overdue,
    hasSubmission: !!(submission.liveUrl || submission.repoUrl),
    verified: !!verification?.passed,
    memberCount: (assignment.members || []).length,
    daysLeft: Number.isFinite(dueMs) ? Math.ceil((dueMs - Date.now()) / 86400000) : null,
  };
}

export default {
  AREA_LABELS, AREA_IDS, ARCHETYPE_LIST,
  areaForSkill, analyzeTeamSkills, suggestTeams, shapeMember,
  selectArchetype, generateTeamProject, summarizeAssignment,
};
