/* ============================================================
   CANDIDATE INTELLIGENCE + VOICE FINGERPRINT (stages 2 & 5)
   ------------------------------------------------------------
   Two related jobs:

   1. CANDIDATE INTELLIGENCE — who is this person, professionally?
      role family, seniority, tenure, technology centre of mass,
      evidence strength, metric availability. Everything derived
      from the evidence graph; nothing assumed.

   2. VOICE FINGERPRINT — how does this person write? Measured
      from their own bullets: sentence length distribution,
      technical density, metric habit, verb register, clause
      style, acronym use, outcome orientation.

   The fingerprint is used to keep the enhanced resume sounding
   like the SAME PERSON. It is explicitly NOT used to preserve
   errors: grammar, filler and vagueness are always corrected.
   Two candidates applying to one job must not converge on the
   same sentences — the fingerprint is a large part of why.
   ============================================================ */
import { detectCareerStage, normalizeCareerStage } from '../careerStage.js';
import { canonicalSkill } from '../skillOntology.js';
import { resolveRoleFamily, SENIORITY_REGISTER } from './domainVocabulary.js';
import { analyzePhraseQuality, buildDocumentFrequency } from './phraseQuality.js';

export const CANDIDATE_INTELLIGENCE_VERSION = 'candidate-intelligence-v1';
export const VOICE_FINGERPRINT_VERSION = 'voice-fingerprint-v1';

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const stdev = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

/* ------------------------------------------------------------------ */
/* Voice fingerprint                                                   */
/* ------------------------------------------------------------------ */
const LEADERSHIP_MARKERS = /\b(led|leading|mentored|managed|coordinated|owned|drove|chaired|supervised|guided|reviewed)\b/i;
const EXECUTION_MARKERS = /\b(built|implemented|wrote|developed|configured|deployed|fixed|debugged|tested|automated|scripted)\b/i;
const ARCHITECTURE_MARKERS = /\b(architecture|architected|designed|design|pattern|topology|contract|interface|schema|module|component|boundary|layer)\b/i;
const RESULT_MARKERS = /\b(reducing|reduced|improving|improved|increasing|increased|resulting in|leading to|enabling|so that|cutting|saving)\b/i;

export function buildVoiceFingerprint(graph, { doc = null } = {}) {
  const achievements = (graph?.records || []).filter((r) => r.type === 'achievement' && r.rawText);
  const texts = achievements.map((r) => r.rawText);
  const summaryText = String(doc?.summary || '');

  if (!texts.length) {
    return {
      version: VOICE_FINGERPRINT_VERSION,
      sampleSize: 0,
      confidence: 'none',
      /* Neutral defaults — a resume with no prior content gets a professional,
         mid-length, evidence-forward voice rather than an invented persona. */
      avgWords: 20, sentenceLengthSpread: 5, targetWordRange: [14, 26],
      technicalDensity: 0.25, metricHabit: 0, acronymDensity: 0,
      registerBias: 'execution', resultOrientation: 0.4, architectureAffinity: 0.2,
      clauseStyle: 'single', prefersOxfordComma: false, usesAmpersand: false,
      leadVerbs: [], leadVerbDiversity: 0, clicheLoad: 0, spelling: 'us',
    };
  }

  const wordCounts = texts.map((t) => t.split(/\s+/).filter(Boolean).length);
  const avgWords = mean(wordCounts);
  const spread = stdev(wordCounts);

  const techCounts = achievements.map((r) => (r.skills || []).length);
  const technicalDensity = mean(achievements.map((r, i) => {
    const w = wordCounts[i] || 1;
    return Math.min(1, (techCounts[i] * 3) / w);
  }));

  const withMetrics = achievements.filter((r) => (r.numericEvidence || []).length).length;
  const metricHabit = withMetrics / achievements.length;

  const acronymDensity = mean(texts.map((t) => {
    const w = t.split(/\s+/).filter(Boolean).length || 1;
    return ((t.match(/\b[A-Z]{2,6}\b/g) || []).length) / w;
  }));

  const leadership = texts.filter((t) => LEADERSHIP_MARKERS.test(t)).length;
  const execution = texts.filter((t) => EXECUTION_MARKERS.test(t)).length;
  const architecture = texts.filter((t) => ARCHITECTURE_MARKERS.test(t)).length;
  const results = texts.filter((t) => RESULT_MARKERS.test(t)).length;

  const commaCounts = texts.map((t) => (t.match(/,/g) || []).length);
  const avgCommas = mean(commaCounts);

  const leadVerbs = achievements.map((r) => r.actionBase).filter(Boolean);
  const uniqueLead = new Set(leadVerbs);

  const freq = buildDocumentFrequency([...texts, summaryText]);
  const clicheLoad = mean([...texts, summaryText].filter(Boolean)
    .map((t) => analyzePhraseQuality(t, { documentFrequency: freq }).penalty));

  /* Spelling convention: keep the candidate's own (-ise vs -ize). */
  const ize = ([...texts, summaryText].join(' ').match(/\b\w+iz(?:e|ed|ing|ation)\b/gi) || []).length;
  const ise = ([...texts, summaryText].join(' ').match(/\b\w+is(?:e|ed|ing|ation)\b/gi) || []).length;

  return {
    version: VOICE_FINGERPRINT_VERSION,
    sampleSize: texts.length,
    confidence: texts.length >= 8 ? 'high' : texts.length >= 4 ? 'medium' : 'low',
    avgWords: Number(avgWords.toFixed(1)),
    sentenceLengthSpread: Number(spread.toFixed(1)),
    /* The band the composer should aim for — the candidate's own habit,
       clamped into what actually reads well on a resume. */
    targetWordRange: [
      Math.max(10, Math.round(avgWords - Math.max(3, spread * 0.6))),
      Math.min(32, Math.round(avgWords + Math.max(4, spread * 0.6))),
    ],
    technicalDensity: Number(technicalDensity.toFixed(3)),
    metricHabit: Number(metricHabit.toFixed(3)),
    acronymDensity: Number(acronymDensity.toFixed(3)),
    registerBias: leadership > execution ? 'leadership' : execution > leadership ? 'execution' : 'balanced',
    leadershipShare: Number((leadership / texts.length).toFixed(2)),
    resultOrientation: Number((results / texts.length).toFixed(2)),
    architectureAffinity: Number((architecture / texts.length).toFixed(2)),
    clauseStyle: avgCommas >= 2 ? 'multi' : avgCommas >= 1 ? 'paired' : 'single',
    avgCommas: Number(avgCommas.toFixed(2)),
    usesAmpersand: /\s&\s/.test(texts.join(' ')),
    leadVerbs: [...uniqueLead].slice(0, 20),
    leadVerbDiversity: leadVerbs.length ? Number((uniqueLead.size / leadVerbs.length).toFixed(2)) : 0,
    clicheLoad: Number(clicheLoad.toFixed(3)),
    spelling: ise > ize ? 'uk' : 'us',
  };
}

/** How close is a produced sentence to the candidate's voice? [0,1] */
export function voiceConsistency(text, fp) {
  if (!fp || !fp.sampleSize) return 0.75; // no signal — neutral, never punitive
  const words = String(text).split(/\s+/).filter(Boolean).length;
  const [lo, hi] = fp.targetWordRange;
  const lengthFit = words >= lo && words <= hi ? 1
    : 1 - Math.min(1, (words < lo ? lo - words : words - hi) / 12);

  const commas = (String(text).match(/,/g) || []).length;
  const expected = fp.clauseStyle === 'multi' ? 2 : fp.clauseStyle === 'paired' ? 1 : 0;
  const clauseFit = 1 - Math.min(1, Math.abs(commas - expected) / 3);

  const hasResult = RESULT_MARKERS.test(text) ? 1 : 0;
  const resultFit = 1 - Math.abs(hasResult - (fp.resultOrientation >= 0.5 ? 1 : 0)) * 0.4;

  return Number(Math.max(0, Math.min(1, lengthFit * 0.5 + clauseFit * 0.25 + resultFit * 0.25)).toFixed(3));
}

/** Apply the candidate's own spelling convention. Never changes meaning. */
export function applySpellingConvention(text, fp) {
  if (!fp || fp.spelling !== 'us') return text;
  return String(text)
    .replace(/\b(\w+)is(e|ed|ing|ation|ations)\b/g, (m, stem, tail) => (
      /^(rais|advis|revis|supervis|promis|exercis|comoris|compris|surpris|devis|precis|franchis|merchandis)$/i.test(stem)
        ? m : `${stem}iz${tail}`
    ));
}

/* ------------------------------------------------------------------ */
/* Candidate intelligence                                              */
/* ------------------------------------------------------------------ */
/* Seniority is a property of the CANDIDATE'S EVIDENCE, never of the job they
   are applying to. Two corrections to the shared detector are applied here:
     • "Manager" in a business title (Product/Marketing/Sales/HR/Account
       Manager) is a job family, not a seniority signal.
     • A graduate/intern signal on the candidate's own headline or education
       outranks a target-role string they have not held yet. */
const BUSINESS_MANAGER_RE = /\b(product|marketing|sales|account|hr|people|brand|category|community|partnership|customer success)\s+manager\b/i;
const STUDENT_SIGNAL_RE = /\b(graduate|fresher|intern(?:ship)?|trainee|student|campus)\b/i;

function detectSeniorityFromEvidence(doc, roleText) {
  let probe = String(roleText || '');
  if (BUSINESS_MANAGER_RE.test(probe)) probe = probe.replace(/\s*manager\b/i, '').trim();
  const stage = detectCareerStage(doc, { targetRole: probe });
  const ownSignals = [doc?.contact?.title, ...(doc?.experience || []).map((e) => e.role)].filter(Boolean).join(' ');
  if ((stage === 'early' || stage === 'mid') && STUDENT_SIGNAL_RE.test(ownSignals)) {
    const months = (doc?.experience || []).filter((e) => e.enabled !== false).length * 6;
    if (months <= 18) return 'student';
  }
  return stage;
}
export function buildCandidateIntelligence(doc, graph, {
  targetRole = '', declaredSeniority = '',
} = {}) {
  const skills = [...(graph?.permittedSkills || [])];
  const roleText = targetRole || doc?.targetRole || doc?.contact?.title || '';
  /* Two families, deliberately distinct:
       family        what the resume TARGETS — drives vocabulary, because the
                     reader is hiring for that role.
       evidenceFamily what the candidate has ACTUALLY been doing.
     When they differ the candidate is mid-transition, which the engine
     reports rather than papering over. */
  const family = resolveRoleFamily(roleText, { skills });
  const currentRole = (doc?.experience || []).find((e) => e.current && e.enabled !== false)
    || (doc?.experience || []).find((e) => e.enabled !== false);
  const evidenceFamily = resolveRoleFamily(currentRole?.role || doc?.contact?.title || '', { skills });

  const stage = declaredSeniority
    ? normalizeCareerStage(declaredSeniority)
    : detectSeniorityFromEvidence(doc, roleText);

  const achievements = (graph?.records || []).filter((r) => r.type === 'achievement');
  const withMetrics = achievements.filter((r) => (r.numericEvidence || []).length);

  /* Technology centre of mass — which skills the person actually uses in
     achievement sentences, not just lists in the skills section. */
  const usage = new Map();
  for (const r of achievements) {
    for (const s of r.skills || []) usage.set(s, (usage.get(s) || 0) + 1);
  }
  const coreTechnologies = [...usage.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([skill, count]) => ({ skill, count }));

  const evidenceStrength = achievements.length === 0 ? 'none'
    : graph.counts.verified >= 3 ? 'strong'
      : achievements.filter((r) => r.hasConcreteAnchor).length / achievements.length >= 0.6 ? 'moderate'
        : 'weak';

  const companies = [...new Set(achievements.map((r) => r.company).filter(Boolean))];

  return {
    version: CANDIDATE_INTELLIGENCE_VERSION,
    roleFamily: family,
    evidenceRoleFamily: evidenceFamily,
    /* A transition is a fact about the application, not a weakness. It is
       surfaced so the UI can explain why transferable work is emphasised. */
    careerTransition: evidenceFamily !== family && evidenceFamily !== 'general' && family !== 'general'
      ? { from: evidenceFamily, to: family }
      : null,
    roleText,
    seniority: stage,
    register: SENIORITY_REGISTER[stage] || SENIORITY_REGISTER.mid,
    coreTechnologies,
    skillUniverse: skills,
    companies,
    counts: {
      achievements: achievements.length,
      withMetrics: withMetrics.length,
      verified: graph?.counts?.verified || 0,
      weakOpeners: graph?.counts?.weakOpeners || 0,
      noAnchor: graph?.counts?.noAnchor || 0,
    },
    metricAvailability: achievements.length ? Number((withMetrics.length / achievements.length).toFixed(2)) : 0,
    evidenceStrength,
    /* Honest statement of what the engine may and may not claim. */
    ownershipCeiling: (SENIORITY_REGISTER[stage] || SENIORITY_REGISTER.mid).maxOwnership,
  };
}

/** Canonical technology display casing drawn only from candidate evidence.
    The candidate's own skills-section spelling wins — it is the form they
    chose for themselves, and it is almost always correctly capitalised. */
export function technologyDisplayMap(graph, doc = null) {
  const map = new Map();
  for (const sk of (doc?.skills || [])) {
    const c = canonicalSkill(sk.name);
    if (c && !map.has(c)) map.set(c, String(sk.name));
  }
  for (const r of graph?.records || []) {
    if (r.type !== 'achievement') continue;
    const display = r.skillsDisplay || [];
    (r.skills || []).forEach((c, i) => {
      const surface = display[i];
      if (!map.has(c) && surface && /[A-Z]/.test(surface)) map.set(c, surface);
    });
  }
  for (const r of graph?.records || []) {
    const display = r.skillsDisplay || [];
    (r.skills || []).forEach((c, i) => { if (!map.has(c) && display[i]) map.set(c, display[i]); });
  }
  return map;
}

/* Concepts that are practices, not tools. Naming them in a "tools include"
   list reads as padding, so the summary composer filters them out. */
const NON_TOOL_CONCEPTS = new Set([
  'ci/cd', 'etl', 'deployment', 'data pipeline', 'data warehouse', 'data modeling',
  'monitoring', 'incident', 'streaming', 'microservices', 'system design',
  'design patterns', 'agile', 'scrum', 'devops', 'sre', 'rest api', 'oop',
  'data structures', 'algorithms', 'unit testing', 'testing', 'documentation',
  'communication', 'teamwork', 'problem solving', 'leadership', 'collaboration',
  'stakeholder', 'analysis', 'project', 'data quality', 'data lake', 'security',
  'model', 'process', 'onboarding', 'roadmap', 'analytics', 'incident',
  'monitoring', 'deployment', 'reporting', 'automation', 'streaming',
  'responsive design', 'accessibility', 'web performance', 'system design',
]);
export function isNamedTool(skill) { return !NON_TOOL_CONCEPTS.has(String(skill).toLowerCase()); }

export { canonicalSkill };
export default {
  CANDIDATE_INTELLIGENCE_VERSION, VOICE_FINGERPRINT_VERSION,
  buildVoiceFingerprint, voiceConsistency, applySpellingConvention,
  buildCandidateIntelligence, technologyDisplayMap,
};
