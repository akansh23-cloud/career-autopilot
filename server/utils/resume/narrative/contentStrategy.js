/* ============================================================
   CONTENT STRATEGY (stages 8, 13 & 16)
   ------------------------------------------------------------
   Decides HOW MUCH SPACE each piece of the career gets, and in
   WHAT ORDER — before a single sentence is written. This is what
   makes tailoring an information-architecture change rather than
   a sentence-rewriting exercise.

   Allocation inputs, all evidence-derived:
     recency          months since the role ended
     relevance        weighted overlap with the target
     evidenceQuality  verified > profile > user-typed; anchored >
                      vague; metric-bearing > not
     seniority        senior candidates justify more depth per role
     achievementValue intent importance for the target

   COMPRESSION is real: older or less relevant roles lose bullets,
   weak bullets merge, overloaded bullets split, repeated
   achievements drop. Facts are never removed silently — every
   compression decision is recorded with a reason.
   ============================================================ */
import { parseResumeDate } from '../dateEngine.js';
import { skillPresent } from '../skillMatcher.js';
import { bulletSimilarity } from '../textQualityEngines.js';
import { inferIntent } from './bulletComposer.js';

export const CONTENT_STRATEGY_VERSION = 'content-strategy-v1';

const MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;

function monthsSince(endDate, current) {
  if (current) return 0;
  const p = parseResumeDate(endDate);
  if (!p.ok) return 24; // unknown → treated as moderately recent, never punished hard
  const then = new Date(p.year, p.month || 0, 1).getTime();
  return Math.max(0, Math.round((Date.now() - then) / MONTH_MS));
}

/* Intent importance per target — the JD's functional expectations decide. */
function intentValue(intent, jobIntel) {
  if (!jobIntel) {
    const generalWeights = {
      ownership: 1.0, architecture: 1.0, automation: 0.95, reliability: 0.9, migration: 0.9,
      data: 0.9, performance: 0.85, delivery: 0.85, security: 0.85, leadership: 0.85,
      scale: 0.8, cost: 0.8, analysis: 0.8, product_impact: 0.8,
      operational_excellence: 0.75, troubleshooting: 0.7, compliance: 0.7,
      innovation: 0.7, stakeholder: 0.65, research: 0.65,
    };
    return generalWeights[intent] ?? 0.7;
  }
  const fn = (jobIntel.functionalExpectations || []).join(' | ').toLowerCase();
  const map = {
    automation: /automate manual/,
    reliability: /reliability|operate and support/,
    architecture: /design systems/,
    leadership: /lead or mentor/,
    security: /security and compliance/,
    data: /data quality/,
    delivery: /build and ship/,
    stakeholder: /stakeholders/,
    performance: /reliability and performance/,
  };
  const re = map[intent];
  let v = 0.6;
  if (re && re.test(fn)) v = 1.0;
  /* Requirement-category presence also lifts value. */
  const reqs = jobIntel.requirements || {};
  const catMap = {
    architecture: reqs.architecture, leadership: reqs.leadership, security: reqs.security,
    operational_excellence: reqs.operational, stakeholder: reqs.collaboration, data: reqs.all,
  };
  if (catMap[intent]?.length) v = Math.max(v, 0.9);
  return v;
}

/** Relevance of one evidence record to the target. */
export function evidenceRelevance(record, jobIntel) {
  if (!jobIntel) {
    return record.hasConcreteAnchor ? 0.7 : 0.45;
  }
  const priority = jobIntel.prioritySkills || [];
  if (!priority.length) return 0.5;
  let earned = 0; let possible = 0;
  for (const p of priority.slice(0, 20)) {
    possible += p.weight;
    if ((record.skills || []).includes(p.canonical) || skillPresent(record.rawText, p.skill)) earned += p.weight;
  }
  const skillFit = possible ? earned / possible : 0;
  const intent = inferIntent(record).intent;
  return Math.max(0, Math.min(1, skillFit * 2.4 + intentValue(intent, jobIntel) * 0.35));
}

/** Evidence quality of one record. */
export function evidenceQuality(record) {
  let q = 0.4;
  if (record.verificationLevel === 'verified') q += 0.3;
  else if (record.verificationLevel === 'profile_confirmed') q += 0.15;
  else if (record.verificationLevel === 'imported_unconfirmed') q -= 0.1;
  if (record.hasConcreteAnchor) q += 0.15;
  if ((record.numericEvidence || []).length) q += 0.12;
  if (record.weakOpener) q -= 0.12;
  if ((record.skills || []).length >= 2) q += 0.08;
  if (record.wordCount < 6) q -= 0.15;
  return Math.max(0, Math.min(1, q));
}

/**
 * Allocate resume space across roles and projects.
 *
 * @returns {{ roles: [...], projects: [...], decisions: [...] }}
 */
export function planContentStrategy(doc, graph, {
  jobIntel = null, seniority = 'mid', mode = 'enhance',
  projectFirst = false, targetBulletLength = 24,
  maxBulletsCurrent = 5, maxBulletsPrevious = 4, maxBulletsOld = 2, maxProjects = 4,
} = {}) {
  const decisions = [];
  const achievements = graph.records.filter((r) => r.type === 'achievement' && r.enabled);

  /* ---- group by parent item ---- */
  const groups = new Map();
  for (const r of achievements) {
    const key = `${r.section}:${r.sourceId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key, section: r.section, itemId: r.sourceId,
        label: r.section === 'experience' ? [r.role, r.company].filter(Boolean).join(' — ') : r.projectName,
        current: r.current, startDate: r.startDate, endDate: r.endDate,
        records: [],
      });
    }
    groups.get(key).records.push(r);
  }

  const seniorityDepth = { student: 0, early: 0, mid: 1, senior: 1, executive: 1 }[seniority] ?? 0;

  const roles = [];
  const projects = [];

  for (const g of groups.values()) {
    const age = monthsSince(g.endDate, g.current);
    const recency = g.current ? 1 : Math.max(0.15, 1 - age / 96); // 8-year decay floor
    const relevances = g.records.map((r) => evidenceRelevance(r, jobIntel));
    const relevance = relevances.length ? Math.max(...relevances) : 0;
    const quality = g.records.length ? Math.max(...g.records.map(evidenceQuality)) : 0;

    /* Composite priority. In tailor mode relevance dominates; in enhance mode
       recency and quality carry more weight because there is no single target. */
    const priority = mode === 'tailor'
      ? recency * 0.3 + relevance * 0.5 + quality * 0.2
      : recency * 0.42 + relevance * 0.24 + quality * 0.34;

    /* Bullet budget. */
    let budget;
    if (g.current) budget = maxBulletsCurrent + seniorityDepth;
    else if (age <= 36) budget = maxBulletsPrevious;
    else budget = maxBulletsOld;
    if (mode === 'tailor' && relevance < 0.2 && !g.current) {
      budget = Math.max(1, budget - 2);
      decisions.push({
        action: 'compress_low_relevance_role', target: g.label,
        reason: `Little overlap with this job's requirements, so it keeps ${Math.max(1, budget)} bullet(s) to preserve the timeline without spending space.`,
      });
    }
    if (age > 84 && !g.current) {
      budget = Math.min(budget, 1);
      decisions.push({
        action: 'compress_dated_role', target: g.label,
        reason: `Ended over seven years ago — kept for continuity at one line.`,
      });
    }
    if (relevance >= 0.55 && !g.current && budget < maxBulletsPrevious) {
      budget = maxBulletsPrevious;
      decisions.push({
        action: 'expand_relevant_role', target: g.label,
        reason: 'Strong overlap with the target requirements, so it keeps full depth despite not being the current role.',
      });
    }

    const entry = {
      ...g, age, recency: Number(recency.toFixed(3)),
      relevance: Number(relevance.toFixed(3)),
      quality: Number(quality.toFixed(3)),
      priority: Number(priority.toFixed(3)),
      bulletBudget: Math.max(1, budget),
      records: g.records
        .map((r) => ({
          record: r,
          relevance: evidenceRelevance(r, jobIntel),
          quality: evidenceQuality(r),
          intent: inferIntent(r).intent,
        }))
        .sort((a, b) => (b.relevance * 0.55 + b.quality * 0.45) - (a.relevance * 0.55 + a.quality * 0.45)),
    };

    (g.section === 'experience' ? roles : projects).push(entry);
  }

  /* P1.5 — fresher mode. Projects and internships are the evidence a student
     actually has, so they get real budget and real priority rather than a
     config flag that changes nothing. This raises the WEIGHT of project
     evidence; it never invents professional seniority. */
  if (projectFirst) {
    for (const p of projects) {
      p.priority = Number(Math.min(1, p.priority * 1.35 + 0.1).toFixed(3));
      p.bulletBudget = Math.max(p.bulletBudget, maxBulletsPrevious);
    }
    decisions.push({
      action: 'weight_projects_first',
      target: 'projects',
      reason: 'Early-career mode: project and internship evidence carries the resume, so those sections keep full depth.',
    });
  }

  /* Experience keeps chronological order (recruiters expect it); projects are
     reordered by priority because they have no expected order. */
  roles.sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || a.age - b.age);
  projects.sort((a, b) => b.priority - a.priority);

  const projectCap = projectFirst ? maxProjects + 2 : maxProjects;
  const keptProjects = projects.slice(0, projectCap);
  for (const p of projects.slice(projectCap)) {
    decisions.push({
      action: 'drop_project', target: p.label,
      reason: `Lower relevance and evidence strength than the ${projectCap} projects kept. Nothing was deleted from your master resume.`,
    });
  }

  return {
    version: CONTENT_STRATEGY_VERSION,
    mode,
    projectFirst: !!projectFirst,
    targetBulletLength,
    roles,
    projects: keptProjects,
    droppedProjects: projects.slice(projectCap),
    decisions,
    /* Section ordering responds to the target. */
    sectionOrder: planSectionOrder(doc, { jobIntel, seniority, projects: keptProjects, roles }),
  };
}

/** Section order responds to seniority, evidence shape and the target job. */
export function planSectionOrder(doc, { jobIntel = null, seniority = 'mid', projects = [], roles = [] } = {}) {
  const base = ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements', 'publications', 'patents', 'volunteer', 'languages'];
  const order = base.slice();

  const move = (key, before) => {
    const i = order.indexOf(key); const j = order.indexOf(before);
    if (i === -1 || j === -1 || i < j) return;
    order.splice(i, 1);
    order.splice(order.indexOf(before), 0, key);
  };

  /* Students / freshers: education and projects carry the resume. */
  if (seniority === 'student' || (!roles.length && projects.length)) {
    move('education', 'experience');
    move('projects', 'experience');
  }
  /* When the JD leans on certifications, lift them. */
  if (jobIntel && (jobIntel.roleIdentity?.certifications || []).length) {
    move('certifications', 'education');
  }
  /* Projects outweigh a thin work history. */
  if (roles.length <= 1 && projects.length >= 2) move('projects', 'experience');

  return order.filter((k) => k in { summary: 1, skills: 1, experience: 1, projects: 1, education: 1, certifications: 1, achievements: 1, publications: 1, patents: 1, volunteer: 1, languages: 1 });
}

/* ------------------------------------------------------------------ */
/* Merge / split / drop                                                */
/* ------------------------------------------------------------------ */
/**
 * Identify compression operations within one role's records.
 * These are PROPOSALS carrying reasons; the engine applies them.
 */
export function planCompression(entry, { budget = 4 } = {}) {
  const ops = [];
  const records = entry.records.map((r) => r.record);

  /* --- drop near-duplicates (keep the stronger evidence) --- */
  const dropped = new Set();
  for (let i = 0; i < records.length; i += 1) {
    for (let k = i + 1; k < records.length; k += 1) {
      if (dropped.has(records[k].id)) continue;
      const sim = bulletSimilarity(records[i].rawText, records[k].rawText);
      if (sim >= 0.68) {
        const weaker = evidenceQuality(records[i]) >= evidenceQuality(records[k]) ? records[k] : records[i];
        dropped.add(weaker.id);
        ops.push({
          op: 'drop_duplicate', evidenceId: weaker.id,
          reason: `Overlaps ${Math.round(sim * 100)}% with another bullet in the same role — kept the one with stronger evidence.`,
        });
      }
    }
  }

  /* --- split overloaded bullets --- */
  for (const r of records) {
    if (dropped.has(r.id)) continue;
    if (r.wordCount > 38 && (r.rawText.match(/,/g) || []).length >= 3) {
      ops.push({
        op: 'split_candidate', evidenceId: r.id,
        reason: `${r.wordCount} words with several clauses — carries more than one achievement.`,
      });
    }
  }

  /* --- merge weak fragments --- */
  const weak = records.filter((r) => !dropped.has(r.id) && r.wordCount < 9 && !r.hasConcreteAnchor);
  if (weak.length >= 2) {
    ops.push({
      op: 'merge_candidates', evidenceIds: weak.slice(0, 2).map((r) => r.id),
      reason: 'Two short bullets with no concrete anchor read better as one specific statement.',
    });
  }

  /* --- trim to budget --- */
  const surviving = entry.records.filter((r) => !dropped.has(r.record.id));
  if (surviving.length > budget) {
    for (const s of surviving.slice(budget)) {
      ops.push({
        op: 'trim_to_budget', evidenceId: s.record.id,
        reason: `Ranked ${surviving.indexOf(s) + 1} of ${surviving.length} for this target; the role's space allows ${budget}.`,
      });
    }
  }

  return { ops, droppedIds: [...dropped] };
}

export default {
  CONTENT_STRATEGY_VERSION, planContentStrategy, planCompression,
  planSectionOrder, evidenceRelevance, evidenceQuality,
};
