/* ============================================================
   Synthesis Intelligence — Build Brief generator
   ------------------------------------------------------------
   Generates the detailed, idea-specific build brief from the
   classification + the synthesized idea + grounded evidence.
   Deterministic and dependency-free; AI prose (if any) is
   layered on top by callers, never required.
   ============================================================ */
import { sanitizeText, lc } from '../problemIntelligence/util.js';
import { getProfile } from './domainProfiles.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const titleCase = (s) => String(s || '').split(/\s+/).map(cap).join(' ');

/* Pick the profile mechanism that best matches the idea text. */
export function selectMechanism(profile, ideaText) {
  const text = lc(ideaText);
  let best = profile.mechanisms[0];
  let bestHits = -1;
  for (const m of profile.mechanisms) {
    const tokens = lc(m.name).split(/[\s/+-]+/).filter((t) => t.length > 3);
    const hits = tokens.filter((t) => text.includes(t)).length;
    if (hits > bestHits) { bestHits = hits; best = m; }
  }
  return best;
}

/* Build a specific title from focus keywords + mechanism + target. */
export function composeTitle({ classification, idea = {}, mechanism }) {
  if (idea.title && !isWeakTitle(idea.title)) return sanitizeText(idea.title, 140);
  const focusWords = (classification.keywords || []).filter((k) => k.length > 3).slice(0, 2).map(titleCase);
  const focus = focusWords.join(' ') || classification.domainLabel.split('/')[0].trim();
  const mech = titleCase(mechanism.name.replace(/ (engine|pipeline|module|workflow|system|algorithm)$/, ' $1'));
  const target = classification.targetUsers[0] || 'practitioners';
  return sanitizeText(`${focus} ${shortMechanismNoun(mechanism.name)} for ${titleCase(target)}`.replace(/\s+/g, ' '), 140) || mech;
}

function shortMechanismNoun(name) {
  const m = lc(name);
  if (m.includes('simulation')) return 'Simulator';
  if (m.includes('anomaly')) return 'Anomaly Monitor';
  if (m.includes('vision')) return 'Vision Pipeline';
  if (m.includes('route')) return 'Route Optimizer';
  if (m.includes('knowledge graph')) return 'Knowledge Graph';
  if (m.includes('fusion')) return 'Fusion System';
  if (m.includes('alert')) return 'Alerting System';
  if (m.includes('telemetry')) return 'Telemetry Platform';
  if (m.includes('recommendation') || m.includes('matching')) return 'Matching Engine';
  if (m.includes('validation')) return 'Validation Engine';
  if (m.includes('correlation') || m.includes('root-cause')) return 'Triage Engine';
  if (m.includes('retrieval')) return 'Grounded Assistant';
  if (m.includes('scoring') || m.includes('ranking')) return 'Intelligence Engine';
  if (m.includes('prediction') || m.includes('fill-level')) return 'Prediction System';
  if (m.includes('verification') || m.includes('attendance') || m.includes('adherence')) return 'Verification System';
  if (m.includes('escalation') || m.includes('case-review') || m.includes('workflow')) return 'Workflow Engine';
  return 'System';
}

const WEAK_TITLE = /^(a |an |the )?(new |my |cool |awesome |great |smart )?\s*(project|app|tool|system|platform|idea|assistant|solution)\s*(for (end )?users?)?$/i;
export function isWeakTitle(title) {
  const t = String(title || '').trim();
  if (t.length < 10) return true;
  if (WEAK_TITLE.test(t)) return true;
  if (/assistant for end users/i.test(t)) return true;
  return false;
}

/**
 * generateBuildBrief — the full brief the spec requires. Specific to the
 * generated idea and domain: every field derives from classification,
 * the idea's own text, the selected mechanism, and the evidence.
 */
export function generateBuildBrief({ classification, idea = {}, evidence = {}, skills = [] }) {
  const profile = getProfile(classification.domain);
  const ideaText = `${idea.title || ''} ${idea.painPoint || idea.problemStatement || ''} ${idea.proposedSolution || ''} ${idea.noveltyAngle || ''}`;
  const mechanism = selectMechanism(profile, ideaText || classification.keywords.join(' '));
  const title = composeTitle({ classification, idea, mechanism });
  const targets = classification.targetUsers;
  const targetPhrase = targets.join('; ');
  const pain = sanitizeText(
    idea.painPoint || idea.problemStatement
    || `${cap(targets[0] || 'practitioners')} in ${classification.domainLabel.toLowerCase()} currently handle ${classification.subdomain} manually across disconnected tools, with no single trustworthy view or auditable record.`,
    900,
  );
  const solution = sanitizeText(
    idea.proposedSolution
    || `Build ${title}: ${mechanism.summary} The output is rendered for ${targets[0] || 'the primary user'} with the contributing evidence always visible.`,
    1200,
  );
  const evidenceNote = evidence.sourceCategoriesUsed && evidence.sourceCategoriesUsed.length
    ? `Grounded in ${evidence.sourceCategoriesUsed.join(', ')} evidence${evidence.strongestSignals?.length ? ` — strongest signal: ${evidence.strongestSignals[0]}` : ''}.`
    : 'No external evidence was available this run — validate the problem with real sources before committing build time.';

  const mergedSkills = dedupe([...profile.skills, ...(skills || [])]).slice(0, 8);

  return {
    overview: sanitizeText(`${title} — a ${classification.subdomain} ${classification.projectType.replace(/_/g, ' ')} for ${targetPhrase}, built around a ${mechanism.name}.`, 400),
    problem: pain,
    targetUsers: targets,
    whyItMatters: sanitizeText(`${cap(classification.subdomain)} failures cost ${targets[0] || 'these users'} real time, money or safety today. ${evidenceNote}`, 500),
    proposedSolution: solution,
    technicalMechanism: sanitizeText(`${mechanism.name}: ${mechanism.summary}`, 600),
    keyModules: profile.modules.slice(0, 6),
    dataSources: classification.dataNeeds,
    expectedOutput: sanitizeText(profile.expectedOutput, 400),
    skillsGained: mergedSkills,
    facultyEvaluationValue: sanitizeText(`Demonstrates a non-trivial ${mechanism.name} with deterministic, testable logic — the proof checklist (${profile.proofChecklist[0]}) gives faculty objective verification points instead of a demo-day impression.`, 400),
    recruiterValue: sanitizeText(`Shows end-to-end ownership of a ${classification.domainLabel.toLowerCase()} system: data modelling, the ${mechanism.name}, and verifiable evidence (tests, benchmarks, recorded demo) that survives interview scrutiny.`, 400),
    ipReadinessAngle: classification.ipAnalysisAppropriate
      ? sanitizeText(`Possible IP interest sits in the specific ${mechanism.name} — not the app around it. ${classification.ipCaution} Treat this as "worth faculty/IP-cell review", never as guaranteed novelty.`, 500)
      : sanitizeText(`This idea is weak ground for IP (${classification.ipCaution}) — treat it as a portfolio/learning build, not a patent route.`, 400),
    risksAndLimitations: dedupe([...profile.risks, ...classification.sensitivityConstraints]).slice(0, 6),
    _meta: { mechanismName: mechanism.name, profileKey: profile.key, title },
  };
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = lc(String(it).trim());
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

export default { generateBuildBrief, selectMechanism, composeTitle, isWeakTitle };
