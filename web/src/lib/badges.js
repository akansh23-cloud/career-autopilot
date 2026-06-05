// Verified skill badges (Part 4).
// Badges are awarded ONLY from project evidence - never from a manually
// selected skill. Each badge records its level, a confidence score, the
// concrete evidence behind it, and the project that earned it. Specific skills
// (Docker, Kubernetes, React, Node.js, AWS/Cloud) require specific evidence
// (detected files, mention in README, completed checklist task, deployment).
// Plan tier caps the maximum badge level a user can display.

import { proofScore } from './proofScore.js';
import { engagementFor } from './engagement.js';
import { calculateProjectStatus } from './projectStatus.js';

export const BADGE_LEVELS = [
  'Practiced',
  'Project Verified',
  'GitHub Verified',
  'Deployment Verified',
  'Recruiter Ready',
];
const RANK = Object.fromEntries(BADGE_LEVELS.map((l, i) => [l, i]));

// Highest badge level each plan may display.
export const PLAN_BADGE_CAP = {
  free: 'Practiced',
  pro: 'Project Verified',
  premium: 'Recruiter Ready',
  admin: 'Recruiter Ready',
};

const has = (s) => typeof s === 'string' && s.trim().length > 0;
const len = (a) => (Array.isArray(a) ? a.length : 0);
const norm = (s) => String(s || '').trim().toLowerCase();

function checklistPct(p = {}) {
  const c = p.checklist || [];
  return c.length ? c.filter((x) => x.done).length / c.length : 0;
}
function checklistMentions(p = {}, kw = []) {
  const hay = (p.checklist || []).filter((c) => c.done).map((c) => norm(c.label)).join(' ');
  return kw.some((k) => hay.includes(k));
}
function docMentions(p = {}, kw = []) {
  const hay = [p.readme, p.architecture, p.useCase, (p.techStack || []).join(' '), (p.skillsCovered || []).join(' ')]
    .map(norm).join(' ');
  return kw.some((k) => hay.includes(k));
}
const ghOk = (p) => !!(p.github && p.github.success);
const ghFiles = (p) => (ghOk(p) ? p.github.files || {} : {});
const liveVerified = (p) => !!(p.liveVerification && p.liveVerification.reachable);
const deployEvidence = (p) => {
  const f = ghFiles(p);
  return liveVerified(p) || has(p.liveDemoUrl) || !!(f.githubWorkflows || f.Dockerfile || f['docker-compose.yml'] || f.deployment || f.terraform || f.kubernetes);
};

/* Per-skill evidence detectors. Each returns { found, github, deploy, evidence[] }. */
const SKILL_DETECTORS = {
  docker: (p) => {
    const f = ghFiles(p);
    const github = !!(f.Dockerfile || f['docker-compose.yml']);
    const doc = docMentions(p, ['docker']) || checklistMentions(p, ['docker', 'container']);
    const ev = [];
    if (github) ev.push('Dockerfile / docker-compose detected');
    if (doc) ev.push('Docker documented / checklist done');
    return { found: github || doc, github, deploy: github && deployEvidence(p), evidence: ev };
  },
  kubernetes: (p) => {
    const f = ghFiles(p);
    const github = !!f.kubernetes;
    const doc = docMentions(p, ['kubernetes', 'k8s', 'helm']) || checklistMentions(p, ['kubernetes', 'k8s', 'deploy']);
    const ev = [];
    if (github) ev.push('Kubernetes manifests detected');
    if (doc) ev.push('Kubernetes documented / checklist done');
    return { found: github || doc, github, deploy: github || deployEvidence(p), evidence: ev };
  },
  react: (p) => {
    const tech = (ghOk(p) ? p.github.detectedTechStack : []).map(norm);
    const github = tech.includes('react') || !!ghFiles(p).src;
    const doc = docMentions(p, ['react']);
    const ev = [];
    if (tech.includes('react')) ev.push('package.json includes React');
    else if (ghFiles(p).src) ev.push('Source/components structure detected');
    if (doc) ev.push('Frontend work documented');
    return { found: tech.includes('react') || doc, github, deploy: deployEvidence(p), evidence: ev };
  },
  'node.js': (p) => {
    const tech = (ghOk(p) ? p.github.detectedTechStack : []).map(norm);
    const github = tech.includes('node.js') || tech.includes('express');
    const doc = docMentions(p, ['node', 'express', 'backend', 'server']);
    const ev = [];
    if (github) ev.push('package.json includes Express/Node');
    if (doc) ev.push('Backend/server documented');
    return { found: github || doc, github, deploy: deployEvidence(p), evidence: ev };
  },
  aws: (p) => {
    const doc = docMentions(p, ['aws', 'cloud', 'lambda', 's3', 'ec2', 'dynamodb']);
    const deploy = liveVerified(p) || !!ghFiles(p).terraform || !!ghFiles(p).deployment;
    const ev = [];
    if (deploy) ev.push('Cloud deployment / IaC evidence');
    if (doc) ev.push('Cloud work documented');
    return { found: doc || deploy, github: !!ghFiles(p).terraform, deploy, evidence: ev };
  },
};
function detectorFor(skill) {
  const k = norm(skill);
  if (k.includes('docker')) return SKILL_DETECTORS.docker;
  if (k.includes('kubernetes') || k === 'k8s') return SKILL_DETECTORS.kubernetes;
  if (k.includes('react')) return SKILL_DETECTORS.react;
  if (k.includes('node') || k.includes('express')) return SKILL_DETECTORS['node.js'];
  if (k.includes('aws') || k.includes('cloud') || k.includes('lambda')) return SKILL_DETECTORS.aws;
  return null;
}

/* Decide level + confidence for one skill on one project from evidence. */
function skillBadge(p, skill) {
  const det = detectorFor(skill);
  const score = proofScore(p);
  const status = calculateProjectStatus(p).status;
  const pct = checklistPct(p);
  const githubConfirms = det ? det(p).github : ghOk(p);
  const deploy = det ? det(p).deploy : deployEvidence(p);
  const baseEvidence = det ? det(p).evidence.slice() : [];

  // strongest applicable level
  let level = null;
  const evidence = [...baseEvidence];
  if (pct > 0 || len(p.tasks)) { level = 'Practiced'; }
  if (score >= 70) { level = 'Project Verified'; evidence.push(`Proof score ${score}/100`); }
  if (githubConfirms && ghOk(p)) { level = 'GitHub Verified'; evidence.push('GitHub analysis confirms files/stack'); }
  if (deploy) { level = 'Deployment Verified'; evidence.push(liveVerified(p) ? 'Verified live deployment' : 'Deployment / CI evidence'); }
  if (status === 'Recruiter Ready') { level = 'Recruiter Ready'; evidence.push('Project is Recruiter Ready'); }
  if (!level) return null;

  // confidence bands (Part 4)
  const strongGithub = githubConfirms && ghOk(p);
  const liveOrDemo = liveVerified(p) || len(p.screenshots) > 0;
  let confidence;
  if (strongGithub && liveOrDemo) confidence = 90 + Math.min(9, Math.round(score / 12));
  else if (strongGithub) confidence = 70 + Math.min(18, Math.round(score / 6));
  else if (pct > 0 || len(p.screenshots)) confidence = 50 + Math.min(18, Math.round(pct * 18));
  else confidence = 40;
  confidence = Math.max(20, Math.min(99, confidence));

  // below 50 -> do not award a verified badge (cap at Practiced)
  if (confidence < 50 && RANK[level] > RANK.Practiced) level = 'Practiced';

  return { level, confidence, evidence: Array.from(new Set(evidence)) };
}

/* Build every badge a candidate has earned across their projects. */
export function deriveBadges(projects = [], access = null) {
  const capLevel = (access && PLAN_BADGE_CAP[access.effectivePlan]) || 'Project Verified';
  const cap = RANK[capLevel];

  const bySkill = {};
  for (const p of projects) {
    // candidate skills: explicit + github-detected
    const detected = ghOk(p) ? (p.github.detectedSkills || []) : [];
    const skills = Array.from(new Set([
      ...(p.skillsCovered && p.skillsCovered.length ? p.skillsCovered : [p.type].filter(Boolean)),
      ...detected,
    ]));

    for (const raw of skills) {
      const skillName = String(raw).trim();
      if (!skillName) continue;
      const res = skillBadge(p, skillName);
      if (!res) continue;
      const displayRank = Math.min(RANK[res.level], cap);
      const displayLevel = BADGE_LEVELS[displayRank];
      const key = skillName.toLowerCase();
      const candidate = {
        badgeName: `${skillName} - ${displayLevel}`,
        skillName,
        level: displayLevel,
        rawLevel: res.level,
        confidence: res.confidence,
        evidence: res.evidence,
        projectId: p.id,
        projectTitle: p.title,
        githubUrl: p.githubUrl || '',
        liveDemoUrl: p.liveDemoUrl || '',
        checklist: p.checklist || [],
        awardedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
        gated: RANK[res.level] > cap,
      };
      const prev = bySkill[key];
      if (!prev || RANK[candidate.level] > RANK[prev.level] || (RANK[candidate.level] === RANK[prev.level] && candidate.confidence > prev.confidence)) {
        bySkill[key] = candidate;
      }
    }
  }
  return Object.values(bySkill).sort((a, b) => RANK[b.level] - RANK[a.level] || b.confidence - a.confidence);
}

export function badgeTone(level) {
  return {
    'Practiced': 'default',
    'Project Verified': 'cyan',
    'GitHub Verified': 'violet',
    'Deployment Verified': 'mint',
    'Recruiter Ready': 'amber',
  }[level] || 'default';
}
