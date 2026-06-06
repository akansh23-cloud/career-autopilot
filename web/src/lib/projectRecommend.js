// Career Project Studio — Project Recommendation Engine.
//
// Turns real user context (profile + resume + target role + missing skills +
// saved/matched jobs) and real-world source signals (GitHub / Kaggle /
// Product Hunt / Devpost / curated) into RANKED, scored ProjectCandidate
// recommendations with transparent "why" reasoning.
//
// External sources are used only as INSPIRATION. Candidates are normalised into
// one shape, scored with the Project Fit Score, deduped and ranked. Everything
// degrades gracefully: if the backend / external APIs are unavailable we still
// return curated + job-gap recommendations so the UI never breaks. No dummy data.

import { api } from './api.js';
import { uid } from './projectStore.js';

/* =============================================================================
   ProjectCandidate (shared shape — documented for callers)
   {
     id, title, summary, sourceType, sourceLabel, sourceUrl,
     targetRoles[], skillsCovered[], techStack[], difficulty, estimatedDuration,
     projectType, businessUseCase, proofPotential, startupPotential,
     beginnerFriendliness, marketRelevance, inspirationSignals[],
     fitScore, confidence, scoreBreakdown{}, whyRecommended[],
     coveredMissingSkills[], partiallyCoveredSkills[], stillMissingSkills[],
     expectedProofOutputs[], resumeImpactPreview, jobImpactPreview,
     risksOrWarnings[], category, createdAt
   }
   ============================================================================= */

const FEEDBACK_KEY = 'careerAutopilot.projectFeedback.v1';
const RECS_KEY = 'careerAutopilot.projectRecs.v1';
const SAVED_IDEAS_KEY = 'careerAutopilot.savedIdeas.v1';

const norm = (s) => String(s || '').trim().toLowerCase();
const dedupe = (arr) => Array.from(new Set((arr || []).map((s) => String(s).trim()).filter(Boolean)));
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/* ---------------- role → expected skill map (Part 3.1 + job-relevance fallback) */
export const ROLE_SKILLS = {
  devops: ['docker', 'ci/cd', 'kubernetes', 'cloud', 'monitoring', 'automation', 'terraform', 'helm'],
  cloud: ['aws', 'cloud', 'serverless', 'terraform', 'iam', 'lambda', 'monitoring', 'automation'],
  backend: ['api', 'database', 'auth', 'testing', 'scalability', 'caching', 'rest', 'sql'],
  frontend: ['responsive ui', 'state management', 'api integration', 'deployment', 'accessibility', 'react', 'testing'],
  'full stack': ['frontend', 'backend', 'database', 'auth', 'deployment', 'api', 'react', 'testing'],
  'ai/ml': ['dataset', 'model', 'evaluation', 'notebook', 'api', 'deployment', 'python', 'mlops'],
  'machine learning': ['dataset', 'model', 'evaluation', 'notebook', 'api', 'deployment', 'python', 'mlops'],
  'data scientist': ['dataset', 'model', 'evaluation', 'python', 'statistics', 'visualization', 'sql'],
  'data analyst': ['sql', 'dashboard', 'visualization', 'insights', 'dataset', 'excel', 'reporting'],
  data: ['sql', 'dashboard', 'visualization', 'insights', 'dataset', 'etl', 'pipeline'],
  cybersecurity: ['auth', 'scanning', 'logs', 'threat model', 'security controls', 'owasp', 'monitoring'],
  security: ['auth', 'scanning', 'logs', 'threat model', 'security controls', 'owasp', 'monitoring'],
};
const ROLE_KEYS = Object.keys(ROLE_SKILLS);

export function resolveRoleKey(role = '', type = '') {
  const hay = norm(role) + ' ' + norm(type);
  if (/devops|sre|site reliability|platform/.test(hay)) return 'devops';
  if (/cloud/.test(hay)) return 'cloud';
  if (/front[\s-]?end/.test(hay)) return 'frontend';
  if (/back[\s-]?end/.test(hay)) return 'backend';
  if (/full[\s-]?stack|mern|mean/.test(hay)) return 'full stack';
  if (/data analyst|business analyst|bi\b/.test(hay)) return 'data analyst';
  if (/machine learning|\bml\b|deep learning/.test(hay)) return 'machine learning';
  if (/ai\/ml|\bai\b/.test(hay)) return 'ai/ml';
  if (/data scien/.test(hay)) return 'data scientist';
  if (/\bdata\b/.test(hay)) return 'data';
  if (/cyber|security|infosec/.test(hay)) return 'cybersecurity';
  // softest match on raw keys
  const found = ROLE_KEYS.find((k) => hay.includes(k));
  return found || 'full stack';
}
export function roleExpectedSkills(role, type) { return ROLE_SKILLS[resolveRoleKey(role, type)] || ROLE_SKILLS['full stack']; }

/* ---------------- proof output catalogue (Part 3.6) */
const PROOF_OUTPUTS = ['GitHub repo', 'README', 'live demo', 'architecture diagram', 'screenshots', 'tests', 'CI/CD', 'deployment', 'interview explanation', 'resume bullets'];

/* =============================================================================
   Curated internal idea library (Part 5E) — original, student-buildable ideas
   spanning every requested domain. Used as inspiration + reliable fallback.
   ============================================================================= */
export const CURATED_IDEAS = [
  {
    title: 'Cloud Cost Guardrail Dashboard', projectType: 'DevOps', difficulty: 'Advanced', estimatedDuration: '1 month',
    summary: 'A FinOps dashboard that ingests cloud billing/usage and flags idle resources, budget breaches and cost spikes with alerts.',
    targetUsers: 'Student builders and early startups on AWS/GCP', targetRoles: ['DevOps Engineer', 'Cloud Engineer', 'SRE'],
    skillsCovered: ['Docker', 'CI/CD', 'Terraform', 'AWS', 'Monitoring', 'Automation'], techStack: ['Node.js', 'AWS Cost Explorer API', 'Docker', 'Terraform', 'Grafana'],
    businessUseCase: 'Lightweight FinOps tool that prevents cloud bill shocks.', startupPotential: 0.85,
    proofOutputs: ['GitHub repo', 'README', 'live demo', 'architecture diagram', 'CI/CD', 'deployment'],
  },
  {
    title: 'Deploy-to-Kubernetes CI/CD Pipeline Demo', projectType: 'DevOps', difficulty: 'Advanced', estimatedDuration: '2 weeks',
    summary: 'A sample app packaged as a container, deployed to managed Kubernetes via Helm, with a full GitHub Actions pipeline and Prometheus/Grafana monitoring.',
    targetUsers: 'Aspiring DevOps engineers building deployment proof', targetRoles: ['DevOps Engineer', 'Platform Engineer', 'SRE'],
    skillsCovered: ['Docker', 'Kubernetes', 'CI/CD', 'Helm', 'Monitoring', 'Automation'], techStack: ['Docker', 'Kubernetes', 'Helm', 'GitHub Actions', 'Prometheus'],
    businessUseCase: 'Reference deployment pattern teams reuse internally.', startupPotential: 0.3,
    proofOutputs: ['GitHub repo', 'README', 'architecture diagram', 'CI/CD', 'deployment', 'live demo'],
  },
  {
    title: 'Production-grade REST API with Auth & Observability', projectType: 'Backend', difficulty: 'Intermediate', estimatedDuration: '2 weeks',
    summary: 'A layered REST API with JWT auth, validation, rate limiting, structured logging, tests and OpenAPI docs.',
    targetUsers: 'Backend interns/juniors proving API design', targetRoles: ['Backend Engineer', 'Software Engineer'],
    skillsCovered: ['API', 'Database', 'Auth', 'Testing', 'Scalability', 'REST'], techStack: ['Node.js', 'Express', 'PostgreSQL', 'Prisma', 'JWT', 'Jest'],
    businessUseCase: 'The backbone any SaaS product needs.', startupPotential: 0.4,
    proofOutputs: ['GitHub repo', 'README', 'tests', 'deployment', 'live demo', 'interview explanation'],
  },
  {
    title: 'Accessible Analytics Dashboard with Component Library', projectType: 'Frontend', difficulty: 'Intermediate', estimatedDuration: '1 week',
    summary: 'A responsive, accessible dashboard SPA with reusable components, state management, real API integration and deploy previews.',
    targetUsers: 'Frontend candidates proving UI + integration skill', targetRoles: ['Frontend Engineer', 'UI Developer'],
    skillsCovered: ['Responsive UI', 'State Management', 'API Integration', 'Deployment', 'Accessibility', 'React'], techStack: ['React', 'Vite', 'TypeScript', 'Tailwind CSS', 'React Query'],
    businessUseCase: 'Internal analytics UIs that every company builds.', startupPotential: 0.3,
    proofOutputs: ['GitHub repo', 'README', 'live demo', 'screenshots', 'deployment'],
  },
  {
    title: 'Full-stack Task & Collaboration Platform', projectType: 'Full Stack', difficulty: 'Intermediate', estimatedDuration: '1 month',
    summary: 'A full-stack app with auth, a relational DB, real-time updates, tests and CI/CD across client and API.',
    targetUsers: 'Full-stack candidates needing an end-to-end flagship', targetRoles: ['Full Stack Developer', 'Software Engineer'],
    skillsCovered: ['Frontend', 'Backend', 'Database', 'Auth', 'Deployment', 'API'], techStack: ['React', 'Node.js', 'Express', 'PostgreSQL', 'Docker'],
    businessUseCase: 'A teamwork SaaS — clear monetisation path.', startupPotential: 0.65,
    proofOutputs: ['GitHub repo', 'README', 'live demo', 'tests', 'deployment', 'interview explanation'],
  },
  {
    title: 'ML Model Served as an API with Experiment Tracking', projectType: 'AI/ML', difficulty: 'Advanced', estimatedDuration: '1 month',
    summary: 'Prepare a dataset, train and evaluate a model with experiment tracking, serve predictions behind FastAPI and ship a demo UI.',
    targetUsers: 'AI/ML candidates proving end-to-end ML', targetRoles: ['Machine Learning Engineer', 'Data Scientist'],
    skillsCovered: ['Dataset', 'Model', 'Evaluation', 'API', 'Deployment', 'Python'], techStack: ['Python', 'PyTorch', 'FastAPI', 'MLflow', 'Docker'],
    businessUseCase: 'Pattern for any ML-powered product feature.', startupPotential: 0.6,
    proofOutputs: ['GitHub repo', 'README', 'live demo', 'tests', 'deployment', 'interview explanation'],
  },
  {
    title: 'SQL Insights & Visualization Dashboard', projectType: 'Data', difficulty: 'Beginner', estimatedDuration: '1 week',
    summary: 'Load a public dataset, model it in SQL, build a visual dashboard, and write a short insights report.',
    targetUsers: 'Data analyst candidates / early-year students', targetRoles: ['Data Analyst', 'Business Analyst'],
    skillsCovered: ['SQL', 'Dashboard', 'Visualization', 'Insights', 'Dataset', 'Reporting'], techStack: ['PostgreSQL', 'Metabase', 'Python', 'Pandas'],
    businessUseCase: 'Decision dashboards every business needs.', startupPotential: 0.35,
    proofOutputs: ['GitHub repo', 'README', 'screenshots', 'live demo', 'resume bullets'],
  },
  {
    title: 'OWASP Top-10 Security Assessment Lab', projectType: 'Cybersecurity', difficulty: 'Advanced', estimatedDuration: '2 weeks',
    summary: 'Deploy a target app, run automated + manual assessments, document findings against the OWASP Top 10, and add a CI security gate.',
    targetUsers: 'Security candidates proving practical AppSec', targetRoles: ['Security Engineer', 'Cybersecurity Analyst'],
    skillsCovered: ['Auth', 'Scanning', 'Logs', 'Threat Model', 'Security Controls', 'OWASP'], techStack: ['Python', 'OWASP ZAP', 'Docker', 'Nmap', 'GitHub Actions'],
    businessUseCase: 'Repeatable security review process for teams.', startupPotential: 0.3,
    proofOutputs: ['GitHub repo', 'README', 'CI/CD', 'architecture diagram', 'interview explanation'],
  },
  {
    title: 'Campus Skill Exchange Marketplace', projectType: 'Full Stack', difficulty: 'Intermediate', estimatedDuration: '1 month',
    summary: 'A platform where students trade help, form project teams and prove contributions with a matching algorithm.',
    targetUsers: 'College students and placement cells', targetRoles: ['Full Stack Developer', 'Product Engineer'],
    skillsCovered: ['Frontend', 'Backend', 'Database', 'Auth', 'API', 'Deployment'], techStack: ['React', 'Node.js', 'MongoDB', 'Matching Algorithm'],
    businessUseCase: 'College SaaS for collaboration and placement proof.', startupPotential: 0.8,
    proofOutputs: ['GitHub repo', 'README', 'live demo', 'deployment', 'screenshots'],
  },
  {
    title: 'AI CRM for Local Shops & Clinics', projectType: 'Full Stack', difficulty: 'Intermediate', estimatedDuration: '1 month',
    summary: 'A lightweight CRM that tracks follow-ups, reminders, service history and leads, with AI summaries for small businesses.',
    targetUsers: 'Local shops, clinics, tutors, salons', targetRoles: ['Backend Engineer', 'Full Stack Developer'],
    skillsCovered: ['Auth', 'API', 'Database', 'Analytics', 'Deployment', 'AI'], techStack: ['Node.js', 'PostgreSQL', 'React', 'WhatsApp API'],
    businessUseCase: 'Subscription SaaS for local service businesses.', startupPotential: 0.9,
    proofOutputs: ['GitHub repo', 'README', 'live demo', 'deployment', 'resume bullets'],
  },
  {
    title: 'Personal Finance & Budget Tracker with Insights', projectType: 'Full Stack', difficulty: 'Beginner', estimatedDuration: '1 week',
    summary: 'Track income/expenses, categorise transactions, and surface monthly insights and budget alerts.',
    targetUsers: 'Early-year students building a first full-stack app', targetRoles: ['Full Stack Developer', 'Frontend Engineer'],
    skillsCovered: ['Frontend', 'API Integration', 'Database', 'Auth', 'Deployment', 'Visualization'], techStack: ['React', 'Node.js', 'SQLite', 'Chart.js'],
    businessUseCase: 'A productivity/fintech micro-SaaS.', startupPotential: 0.55,
    proofOutputs: ['GitHub repo', 'README', 'live demo', 'screenshots', 'deployment'],
  },
  {
    title: 'Hospital Appointment & Queue Admin System', projectType: 'Full Stack', difficulty: 'Intermediate', estimatedDuration: '1 month',
    summary: 'A healthcare admin workflow for appointment booking, queue management and basic records with role-based access.',
    targetUsers: 'Small clinics and hospital front desks', targetRoles: ['Backend Engineer', 'Full Stack Developer'],
    skillsCovered: ['Auth', 'Database', 'API', 'Frontend', 'Deployment', 'Testing'], techStack: ['React', 'Node.js', 'PostgreSQL', 'Docker'],
    businessUseCase: 'Healthcare/admin workflow SaaS.', startupPotential: 0.7,
    proofOutputs: ['GitHub repo', 'README', 'live demo', 'tests', 'deployment'],
  },
];

/* =============================================================================
   Normalisation — bring any source row into the ProjectCandidate shape
   ============================================================================= */
export function normalizeCandidate(raw = {}, sourceType = 'curated') {
  const skillsCovered = dedupe(raw.skillsCovered || raw.detectedSkills || raw.skills || []);
  const techStack = dedupe(raw.techStack || raw.tech || skillsCovered);
  const targetRoles = dedupe(raw.targetRoles || (raw.targetRole ? [raw.targetRole] : []));
  return {
    id: raw.id || uid('cand'),
    title: raw.title || 'Untitled project idea',
    summary: raw.summary || raw.description || raw.problem || '',
    sourceType,
    sourceLabel: raw.sourceLabel || SOURCE_LABELS[sourceType] || 'Curated',
    sourceUrl: raw.sourceUrl || raw.url || '',
    targetRoles,
    skillsCovered,
    techStack,
    difficulty: raw.difficulty || 'Intermediate',
    estimatedDuration: raw.estimatedDuration || raw.duration || '2 weeks',
    projectType: raw.projectType || raw.type || 'Full Stack',
    businessUseCase: raw.businessUseCase || raw.businessAngle || '',
    targetUsers: raw.targetUsers || '',
    proofPotential: raw.proofOutputs ? raw.proofOutputs : PROOF_OUTPUTS.slice(0, 6),
    startupPotential: typeof raw.startupPotential === 'number' ? raw.startupPotential : 0.4,
    beginnerFriendliness: raw.beginnerFriendliness ?? (norm(raw.difficulty) === 'beginner' ? 1 : norm(raw.difficulty) === 'advanced' ? 0.3 : 0.6),
    marketRelevance: raw.marketRelevance ?? 0.5,
    inspirationSignals: dedupe(raw.inspirationSignals || raw.topics || []),
    createdAt: new Date().toISOString(),
  };
}

export const SOURCE_LABELS = {
  github: 'GitHub trending', kaggle: 'Kaggle', producthunt: 'Product Hunt', devpost: 'Hackathon', curated: 'Curated library', 'job-gap': 'Your job gaps', ai: 'AI-tailored',
};

/* job-gap candidates built from the user's own missing skills + matched jobs */
export function jobGapCandidates(ctx = {}) {
  const missing = dedupe(ctx.missingSkills);
  if (!missing.length) return [];
  const type = ctx.projectType || 'Full Stack';
  return [normalizeCandidate({
    title: `Gap-closing ${type} project for ${ctx.targetRole || 'your target role'}`,
    summary: `An original project designed around the skills you are missing (${missing.slice(0, 5).join(', ')}) so each one becomes recruiter-visible proof.`,
    skillsCovered: dedupe([...missing, ...roleExpectedSkills(ctx.targetRole, type)]).slice(0, 10),
    techStack: roleExpectedSkills(ctx.targetRole, type).slice(0, 6),
    targetRoles: [ctx.targetRole].filter(Boolean),
    difficulty: ctx.selectedDifficulty || 'Intermediate',
    estimatedDuration: ctx.selectedDuration || '2 weeks',
    projectType: type,
    businessUseCase: 'Tailored to your job search — built around the exact gaps in your matched jobs.',
    startupPotential: 0.45,
    proofOutputs: ['GitHub repo', 'README', 'live demo', 'tests', 'deployment', 'resume bullets'],
  }, 'job-gap')];
}

/* =============================================================================
   Job market relevance — skill frequency across saved/matched jobs (Part 3.4)
   ============================================================================= */
export function jobSkillFrequency(savedJobs = []) {
  const freq = {};
  let total = 0;
  for (const j of savedJobs) {
    total += 1;
    const skills = dedupe([...(j.requiredSkills || []), ...(j.skills || []), ...(j._missing || [])]);
    for (const s of skills) freq[norm(s)] = (freq[norm(s)] || 0) + 1;
  }
  return { freq, total };
}

/* =============================================================================
   PROJECT FIT SCORE (Part 3) — out of 100
   targetRoleMatch 25 · missingSkillCoverage 25 · resumeGapImprovement 15 ·
   jobMarketRelevance 15 · userLevelFit 10 · proofPotential 10
   ============================================================================= */
const WEIGHTS = { targetRoleMatch: 25, missingSkillCoverage: 25, resumeGapImprovement: 15, jobMarketRelevance: 15, userLevelFit: 10, proofPotential: 10 };

function skillHay(c) { return dedupe([...(c.skillsCovered || []), ...(c.techStack || []), c.projectType, c.summary]).map(norm).join(' '); }
function covers(hay, skill) { const s = norm(skill); return s && (hay.includes(s) || s.split(/[\s/]+/).some((w) => w.length > 2 && hay.includes(w))); }

function levelRank(d) { return norm(d) === 'beginner' ? 1 : norm(d) === 'advanced' ? 3 : 2; }
function userLevelRank(ctx) {
  if (ctx.experienceLevel) return levelRank(ctx.experienceLevel);
  const y = norm(ctx.yearSem);
  if (/1|first|fresher|beginner/.test(y)) return 1;
  if (/4|final|senior|advanced/.test(y)) return 3;
  if (ctx.userRole === 'professional') return 3;
  return 2;
}

export function scoreCandidate(candidate, ctx = {}, weightAdj = {}) {
  const c = candidate;
  const hay = skillHay(c);
  const expected = roleExpectedSkills(ctx.targetRole, c.projectType);
  const missing = dedupe(ctx.missingSkills);
  const { freq, total } = ctx._jobFreq || jobSkillFrequency(ctx.savedJobs || []);

  // 1) target role match (25)
  const roleHits = expected.filter((s) => covers(hay, s)).length;
  const typeMatch = norm(c.projectType) && (norm(ctx.targetRole).includes(norm(c.projectType)) || resolveRoleKey(ctx.targetRole) === resolveRoleKey(c.projectType, c.projectType)) ? 0.25 : 0;
  const roleFrac = clamp(roleHits / Math.max(3, expected.length), 0, 1);
  const targetRoleMatch = Math.round(WEIGHTS.targetRoleMatch * clamp(roleFrac + typeMatch, 0, 1));

  // 2) missing skill coverage (25)
  const covered = [], partial = [], still = [];
  const target = missing.length ? missing : expected;
  for (const m of target) {
    if (covers(hay, m)) covered.push(m);
    else if (norm(m).split(/[\s/]+/).some((w) => w.length > 2 && hay.includes(w))) partial.push(m);
    else still.push(m);
  }
  const covFrac = target.length ? (covered.length + 0.5 * partial.length) / target.length : 0.5;
  const missingSkillCoverage = Math.round(WEIGHTS.missingSkillCoverage * clamp(covFrac, 0, 1));

  // 3) resume gap improvement (15)
  const gaps = resumeGapFlags(ctx);
  const improved = gaps.filter((g) => g.test(hay, c)).map((g) => g.label);
  const gapFrac = gaps.length ? improved.length / gaps.length : 0.5;
  const resumeGapImprovement = Math.round(WEIGHTS.resumeGapImprovement * clamp(0.25 + gapFrac, 0, 1));

  // 4) job market relevance (15)
  let jobFrac, jobNote;
  if (total > 0) {
    const candSkills = dedupe([...(c.skillsCovered || []), ...(c.techStack || [])]);
    let hits = 0, best = { skill: '', n: 0 };
    for (const s of candSkills) { const n = freq[norm(s)] || 0; if (n) { hits += n; if (n > best.n) best = { skill: s, n }; } }
    jobFrac = clamp(hits / Math.max(1, total * 2), 0, 1);
    jobNote = best.n ? `${best.skill} appears in ${best.n}/${total} of your matching jobs` : `Limited overlap with your ${total} matched jobs`;
  } else {
    const overlap = expected.filter((s) => covers(hay, s)).length / Math.max(3, expected.length);
    jobFrac = clamp(overlap, 0, 1);
    jobNote = 'No matched jobs yet — using the role skill map as a fallback';
  }
  const jobMarketRelevance = Math.round(WEIGHTS.jobMarketRelevance * jobFrac);

  // 5) user level fit (10)
  const ur = userLevelRank(ctx), pr = levelRank(c.difficulty);
  const diff = Math.abs(ur - pr);
  const userLevelFit = Math.round(WEIGHTS.userLevelFit * (diff === 0 ? 1 : diff === 1 ? 0.7 : 0.35));
  const warnings = [];
  if (pr - ur >= 2) warnings.push('This is advanced for your level — start with the prerequisite mini-tasks before the core build.');
  if (pr - ur === 1) warnings.push('Slightly above your current level — pace the harder milestones.');

  // 6) proof potential (10)
  const proofFrac = clamp((c.proofPotential || []).length / PROOF_OUTPUTS.length, 0, 1);
  const proofPotential = Math.round(WEIGHTS.proofPotential * (0.4 + 0.6 * proofFrac));

  // weighted total with optional feedback adjustment
  const adj = { jobMarketRelevance: 1, startup: 1, ...weightAdj };
  let total100 = targetRoleMatch + missingSkillCoverage + resumeGapImprovement
    + Math.round(jobMarketRelevance * (adj.jobMarketRelevance || 1)) + userLevelFit + proofPotential;
  // startup feedback nudges startup-heavy ideas up a touch (kept inside 0-100)
  if (adj.startup > 1 && c.startupPotential >= 0.6) total100 += Math.round(4 * (adj.startup - 1) * 10);
  total100 = clamp(total100, 0, 100);

  const scoreBreakdown = { targetRoleMatch, missingSkillCoverage, resumeGapImprovement, jobMarketRelevance, userLevelFit, proofPotential, total: total100 };
  const confidence = total100 >= 80 ? 'High' : total100 >= 60 ? 'Medium' : 'Low';

  const why = buildWhy(c, { covered, partial, still, expected, jobNote, improved, ctx });

  return {
    ...c,
    fitScore: total100,
    confidence,
    scoreBreakdown,
    whyRecommended: why,
    coveredMissingSkills: covered,
    partiallyCoveredSkills: partial,
    stillMissingSkills: still,
    expectedProofOutputs: c.proofPotential,
    resumeImpactPreview: improved.length ? `Adds proof for: ${improved.join(', ')}.` : 'Strengthens your portfolio with a deployed, documented project.',
    jobImpactPreview: jobNote + '. Estimated based on skill overlap and available project/job data.',
    risksOrWarnings: warnings,
    marketRelevance: jobFrac,
  };
}

function resumeGapFlags(ctx) {
  const r = (ctx.resumeAnalysis || {});
  const resumeHay = [r.summary, (r.improvements || []).join(' '), (r.missingKeywords || []).join(' '), (ctx.resumeText || '')].join(' ').toLowerCase();
  const lacks = (kw) => !kw.some((k) => resumeHay.includes(k));
  return [
    { label: 'deployment proof', test: (h) => /deploy|docker|kubernetes|live|hosting|ci\/cd/.test(h), active: lacks(['deploy', 'live', 'docker']) },
    { label: 'full-stack proof', test: (h) => /full.?stack|frontend.*backend|api.*ui/.test(h), active: lacks(['full stack', 'full-stack']) },
    { label: 'cloud proof', test: (h) => /aws|azure|gcp|cloud|serverless/.test(h), active: lacks(['aws', 'cloud', 'azure', 'gcp']) },
    { label: 'testing proof', test: (h) => /test|jest|pytest|vitest|coverage/.test(h), active: lacks(['test', 'jest', 'pytest']) },
    { label: 'AI/ML proof', test: (h) => /model|ml|dataset|pytorch|tensorflow/.test(h), active: lacks(['model', 'machine learning', 'ml']) },
    { label: 'business-impact project', test: (h, c) => (c.startupPotential || 0) >= 0.6 || /business|saas|users|revenue/.test(h), active: true },
    { label: 'strong README / GitHub proof', test: (h) => /readme|github|repo|documentation/.test(h), active: lacks(['github', 'readme']) },
  ].filter((g) => g.active);
}

function buildWhy(c, { covered, still, expected, jobNote, improved, ctx }) {
  const why = [];
  const roleHit = expected.filter((s) => covers(skillHay(c), s)).slice(0, 3);
  if (roleHit.length) why.push(`Aligns with ${ctx.targetRole || 'your target role'}: covers ${roleHit.join(', ')}.`);
  if (covered.length) why.push(`Covers ${covered.length} of your missing skills: ${covered.slice(0, 4).join(', ')}.`);
  if (improved.length) why.push(`Improves resume gaps: ${improved.slice(0, 3).join(', ')}.`);
  why.push(jobNote + '.');
  why.push(`Produces ${(c.proofPotential || []).slice(0, 4).join(', ')} as recruiter-visible proof.`);
  if (still.length) why.push(`Will not cover on its own: ${still.slice(0, 4).join(', ')}.`);
  return why;
}

/* =============================================================================
   Categorisation (Part 4) — label the top picks
   ============================================================================= */
export function categorize(list = [], ctx = {}) {
  if (!list.length) return list;
  const byFit = [...list].sort((a, b) => b.fitScore - a.fitScore);
  const tag = (cand, label) => { if (cand && !cand.category) cand.category = label; };

  tag(byFit[0], 'Best Career Fit');
  const quick = [...list].filter((c) => /weekend|1 week/i.test(c.estimatedDuration)).sort((a, b) => b.fitScore - a.fitScore)[0]
    || [...list].sort((a, b) => durationRank(a.estimatedDuration) - durationRank(b.estimatedDuration))[0];
  tag(quick, 'Best Quick Win');
  const portfolio = [...list].sort((a, b) => (b.proofPotential.length - a.proofPotential.length) || (b.fitScore - a.fitScore))[0];
  tag(portfolio, 'Best Portfolio Impact');
  const startup = [...list].sort((a, b) => b.startupPotential - a.startupPotential)[0];
  if (startup && startup.startupPotential >= 0.55) tag(startup, 'Best Startup Potential');
  const earlyUser = userLevelRank(ctx) <= 1;
  const beginner = [...list].filter((c) => norm(c.difficulty) === 'beginner').sort((a, b) => b.fitScore - a.fitScore)[0];
  if (beginner && earlyUser) tag(beginner, 'Best Beginner-Friendly');
  return list;
}
function durationRank(d) { const x = norm(d); if (x.includes('weekend')) return 0; if (x.includes('1 week')) return 1; if (x.includes('2 week')) return 2; return 3; }

/* =============================================================================
   Dedupe similar ideas (title/skill overlap)
   ============================================================================= */
function dedupeCandidates(list = []) {
  const out = [];
  for (const c of list) {
    const sig = norm(c.title).replace(/[^a-z0-9 ]/g, '').split(' ').filter((w) => w.length > 3).slice(0, 4).join(' ');
    const dup = out.find((o) => {
      const osig = norm(o.title).replace(/[^a-z0-9 ]/g, '').split(' ').filter((w) => w.length > 3).slice(0, 4).join(' ');
      if (osig && sig && (osig === sig)) return true;
      const a = new Set(c.skillsCovered.map(norm)), b = new Set(o.skillsCovered.map(norm));
      const inter = [...a].filter((x) => b.has(x)).length;
      return inter >= 4 && norm(o.projectType) === norm(c.projectType) && norm(o.difficulty) === norm(c.difficulty);
    });
    if (!dup) out.push(c);
  }
  return out;
}

/* =============================================================================
   Orchestration — produce ranked recommendations (Part 1 + 6)
   ctx: { userRole, yearSem, branch, targetRole, currentSkills, resumeAnalysis,
          resumeText, missingSkills, savedJobs, selectedDuration,
          selectedDifficulty, projectType, allowedSources[], useExternalSources }
   ============================================================================= */
export async function recommendProjects(ctx = {}) {
  const allowed = ctx.allowedSources || ['curated', 'job-gap'];
  const wantExternal = ctx.useExternalSources && allowed.some((s) => ['github', 'kaggle', 'producthunt', 'devpost'].includes(s));
  const signalsUsed = { resume: !!ctx.resumeAnalysis, jobs: (ctx.savedJobs || []).length, github: false, kaggle: false, productHunt: false, devpost: false, curated: true };
  const warnings = [];
  let candidates = [];

  // job-gap (always, local)
  candidates.push(...jobGapCandidates(ctx));

  // external discovery via backend (Pro/Premium); backend handles fallback + caching
  if (wantExternal) {
    try {
      const r = await api.post('/api/projects/recommend', {
        targetRole: ctx.targetRole, skills: ctx.currentSkills, missingSkills: ctx.missingSkills,
        projectType: ctx.projectType, difficulty: ctx.selectedDifficulty, allowedSources: allowed,
      });
      if (r && r.ok) {
        (r.candidates || []).forEach((row) => candidates.push(normalizeCandidate(row, row.sourceType || 'github')));
        Object.assign(signalsUsed, r.signalsUsed || {});
        (r.warnings || []).forEach((w) => warnings.push(w));
      }
    } catch {
      warnings.push('External sources are unavailable right now — showing curated and job-gap recommendations.');
    }
  } else if (ctx.useExternalSources) {
    warnings.push('Deep external discovery is a Pro/Premium feature — showing curated and job-gap recommendations.');
  }

  // curated library (always available)
  CURATED_IDEAS.forEach((idea) => candidates.push(normalizeCandidate(idea, 'curated')));

  // score everything
  const weightAdj = feedbackWeights();
  const jobFreq = jobSkillFrequency(ctx.savedJobs || []);
  const scored = dedupeCandidates(candidates).map((c) => scoreCandidate(c, { ...ctx, _jobFreq: jobFreq }, weightAdj));

  // apply "not relevant" source/skill down-weighting from feedback
  const fb = getFeedback();
  const tuned = scored.map((c) => {
    let s = c.fitScore;
    if (fb.dislikedSources?.includes(c.sourceType)) s = clamp(s - 8, 0, 100);
    return { ...c, fitScore: s, scoreBreakdown: { ...c.scoreBreakdown, total: s } };
  });

  tuned.sort((a, b) => b.fitScore - a.fitScore);

  // ensure category coverage in the top set, then take top 5
  const top = pickWithCoverage(tuned, ctx, 5);
  categorize(top, ctx);

  const explanation = buildExplanation(top, ctx, signalsUsed);
  return { recommendations: top, signalsUsed, warnings, explanation };
}

function pickWithCoverage(sorted, ctx, n) {
  const picked = [];
  const FLOOR = 50; // don't surface a weak project just to fill a category
  const add = (c) => { if (c && !picked.find((x) => x.id === c.id)) picked.push(c); };
  const addIf = (c) => { if (c && c.fitScore >= FLOOR) add(c); };
  add(sorted[0]); // best career fit always
  addIf([...sorted].filter((c) => /weekend|1 week/i.test(c.estimatedDuration)).sort((a, b) => b.fitScore - a.fitScore)[0]); // quick win
  addIf([...sorted].sort((a, b) => (b.proofPotential.length - a.proofPotential.length) || (b.fitScore - a.fitScore))[0]); // portfolio
  const startup = [...sorted].filter((c) => c.startupPotential >= 0.55).sort((a, b) => (b.startupPotential - a.startupPotential) || (b.fitScore - a.fitScore))[0];
  addIf(startup);
  if (userLevelRank(ctx) <= 1) addIf([...sorted].filter((c) => norm(c.difficulty) === 'beginner').sort((a, b) => b.fitScore - a.fitScore)[0]);
  for (const c of sorted) { if (picked.length >= n) break; add(c); }
  return picked.slice(0, n).sort((a, b) => b.fitScore - a.fitScore);
}

function buildExplanation(top, ctx, signals) {
  const best = top[0];
  if (!best) return 'No recommendations could be generated yet — add a target role or analyse your resume first.';
  const srcs = [signals.curated && 'curated library', signals.jobs && `${signals.jobs} matched jobs`, signals.github && 'GitHub trends', signals.kaggle && 'Kaggle', signals.productHunt && 'Product Hunt', signals.devpost && 'hackathons', signals.resume && 'your resume analysis'].filter(Boolean).join(', ');
  return `Ranked ${top.length} projects for ${ctx.targetRole || 'your target role'} using ${srcs || 'curated ideas'}. Top pick "${best.title}" scores ${best.fitScore}/100 (${best.confidence} confidence). Estimated based on skill overlap and available project/job data.`;
}

/* =============================================================================
   Feedback (Part 12) — store + translate into future weighting
   ============================================================================= */
function read(key, fallback) { if (typeof window === 'undefined') return fallback; try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } }
function write(key, v) { if (typeof window === 'undefined') return v; try { localStorage.setItem(key, JSON.stringify(v)); } catch {} return v; }

export function getFeedback() { return read(FEEDBACK_KEY, { difficultyBias: 0, startupBias: 0, jobBias: 0, dislikedSources: [], log: [] }); }
export function recordFeedback(candidate, type) {
  const fb = getFeedback();
  if (type === 'too_hard') fb.difficultyBias = clamp(fb.difficultyBias - 1, -3, 3);
  if (type === 'too_easy') fb.difficultyBias = clamp(fb.difficultyBias + 1, -3, 3);
  if (type === 'not_relevant') { if (candidate?.sourceType && !fb.dislikedSources.includes(candidate.sourceType)) fb.dislikedSources.push(candidate.sourceType); }
  if (type === 'more_startup') fb.startupBias = clamp(fb.startupBias + 1, 0, 3);
  if (type === 'more_jobs') fb.jobBias = clamp(fb.jobBias + 1, 0, 3);
  fb.log = [{ type, title: candidate?.title || '', at: new Date().toISOString() }, ...(fb.log || [])].slice(0, 30);
  write(FEEDBACK_KEY, fb);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('career-project-feedback'));
  return fb;
}
function feedbackWeights() {
  const fb = getFeedback();
  return { jobMarketRelevance: 1 + 0.15 * (fb.jobBias || 0), startup: 1 + 0.15 * (fb.startupBias || 0) };
}
/* difficulty preference derived from feedback, used to bias the default level */
export function preferredDifficulty(base = 'Intermediate') {
  const fb = getFeedback();
  const order = ['Beginner', 'Intermediate', 'Advanced'];
  let i = order.indexOf(base); if (i < 0) i = 1;
  i = clamp(i + (fb.difficultyBias || 0), 0, 2);
  return order[i];
}

/* =============================================================================
   Persistence (Part 12) — recommendations + saved ideas
   ============================================================================= */
export function saveRecommendations(payload) { return write(RECS_KEY, { ...payload, savedAt: new Date().toISOString() }); }
export function getSavedRecommendations() { return read(RECS_KEY, null); }
export function clearRecommendations() { if (typeof window !== 'undefined') { try { localStorage.removeItem(RECS_KEY); } catch {} } }

export function getSavedIdeas() { return read(SAVED_IDEAS_KEY, []); }
export function saveIdea(candidate) {
  const list = getSavedIdeas();
  if (list.find((c) => c.id === candidate.id)) return list;
  const next = [{ ...candidate, savedAt: new Date().toISOString() }, ...list].slice(0, 50);
  write(SAVED_IDEAS_KEY, next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('career-saved-ideas'));
  return next;
}
export function removeSavedIdea(id) {
  const next = getSavedIdeas().filter((c) => c.id !== id);
  write(SAVED_IDEAS_KEY, next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('career-saved-ideas'));
  return next;
}

export const FIT_WEIGHTS = WEIGHTS;
