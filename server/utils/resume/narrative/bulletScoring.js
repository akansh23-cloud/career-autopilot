/* ============================================================
   BULLET SCORING MODEL — deterministic reranking (stage 11)
   ------------------------------------------------------------
   Nine explainable dimensions, weights summing to 100:

     evidence support ......... 25   truth + traceability
     target-job relevance ..... 20   does this help THIS application
     specificity .............. 15   concrete nouns, systems, numbers
     domain authenticity ...... 10   practitioner vocabulary
     natural language ......... 10   reads human, not templated
     ATS usefulness ...........  8   parseable, keyword-bearing
     voice consistency ........  5   still sounds like this person
     conciseness ..............  4   information per word
     novelty / non-generic ....  3   not the default phrasing

   HARD FAILURE: a candidate carrying any unsupported claim gets
   finalScore = 0 and is excluded — it can never win on the
   strength of other dimensions.

   NO AI IN THIS FILE. Scoring is a verdict, and verdicts are
   deterministic and backend-owned throughout Career Autopilot.
   ============================================================ */
import { skillPresent } from '../skillMatcher.js';
import { analyzePhraseQuality } from './phraseQuality.js';
import { voiceConsistency } from './candidateIntelligence.js';
import { vocabularyFor } from './domainVocabulary.js';

import { scoreSentenceVerbFit } from './objectVerbFit.js';

export const BULLET_SCORING_VERSION = 'bullet-scoring-v1';

export const WEIGHTS = Object.freeze({
  evidence: 25,
  relevance: 20,
  specificity: 15,
  domain: 10,
  naturalness: 10,
  ats: 8,
  voice: 5,
  conciseness: 4,
  novelty: 3,
});

/* Mode weight names → internal scoring dimensions. Explicit so a mode can be
   audited against real behaviour by reading one table instead of guessing. */
export const MODE_WEIGHT_DIMENSION = Object.freeze({
  evidenceUtilisation: 'evidence',
  jdRelevance: 'relevance',
  specificity: 'specificity',
  domainAuthenticity: 'domain',
  naturalness: 'naturalness',
  atsSemantics: 'ats',
  seniorityConsistency: 'voice',
  conciseness: 'conciseness',
  diversity: 'novelty',
});

/** Translate a mode weight profile into the engine's dimension weights. */
export function resolveWeights(modeWeights) {
  if (!modeWeights) return WEIGHTS;
  const out = { ...WEIGHTS };
  for (const [modeKey, value] of Object.entries(modeWeights)) {
    const dim = MODE_WEIGHT_DIMENSION[modeKey];
    if (dim && Number.isFinite(value)) out[dim] = value;
  }
  return out;
}

const VAGUE_NOUNS = /\b(things?|stuff|areas?|aspects?|activities|tasks?|items?|solutions?|initiatives?|deliverables?|efforts?|processes|various|numerous|several)\b/gi;
const CONCRETE_HINT = /\b(pipeline|service|cluster|database|table|endpoint|environment|repository|dashboard|report|module|component|schema|queue|job|workflow|policy|contract|model|dataset|account|ledger|invoice|campaign|requisition|drawing|circuit|assembly|board|study)\b/i;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/* ---------------- individual dimensions ---------------- */

/** Evidence support: how much of the sentence is directly traceable. */
/* Light deterministic stemmer. Evidence tracing must measure whether a word
   COMES FROM the evidence, not whether it is spelled identically to it.
   Without this, "Configured X deployments" scores worse than "Ran deployment
   configuration of X" against evidence containing "configuration" and
   "deployment" — the engine punishes exactly the morphological rewriting that
   makes a bullet read like a human edited it. */
function stem(word) {
  let w = String(word).toLowerCase();
  for (const suf of ['ations', 'ation', 'ments', 'ment', 'ingly', 'ing', 'ised', 'ized', 'ises', 'izes', 'ies', 'ied', 'ers', 'er', 'ed', 'es', 's']) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) { w = w.slice(0, -suf.length); break; }
  }
  /* Collapse the residual verb/noun alternation: configur(e|ation) → configur */
  return w.replace(/e$/, '');
}

export function scoreEvidence(text, evidence) {
  if (!evidence) return 0;
  const srcRaw = [evidence.rawText, evidence.object, evidence.method, evidence.scope, evidence.outcome]
    .filter(Boolean).join(' ').toLowerCase();
  const srcStems = new Set((srcRaw.match(/[a-z][a-z+#./-]{2,}/g) || []).map(stem));
  const words = (String(text).toLowerCase().match(/[a-z][a-z+#./-]{2,}/g) || []);
  if (!words.length) return 0;
  const STOP = new Set(['the', 'and', 'for', 'with', 'across', 'using', 'through', 'via', 'that', 'which', 'into', 'from', 'their', 'this', 'while', 'where', 'when', 'over', 'under', 'reducing', 'improving', 'removing', 'cutting', 'enabling', 'built', 'based']);
  const content = words.filter((w) => !STOP.has(w));
  if (!content.length) return 0.5;
  /* Traceable by stem OR by literal substring (keeps versioned tokens like
     "java 17" and "s3" matching exactly as before). */
  const traced = content.filter((w) => srcStems.has(stem(w)) || srcRaw.includes(w)).length;
  const coverage = traced / content.length;

  /* Verified evidence is worth more than user-typed evidence. */
  const levelBonus = evidence.verificationLevel === 'verified' ? 0.12
    : evidence.verificationLevel === 'profile_confirmed' ? 0.06 : 0;
  return clamp01(coverage * 0.9 + levelBonus + (evidence.numericEvidence?.length ? 0.05 : 0));
}

/** Target-job relevance: weighted JD skill + functional-expectation coverage. */
export function scoreRelevance(text, { jobIntel = null, intent = '', targetRole = '' } = {}) {
  if (!jobIntel) {
    /* Enhance mode: relevance to the general market for the role family —
       measured as concrete professional content rather than JD overlap. */
    return CONCRETE_HINT.test(text) ? 0.7 : 0.5;
  }
  const priority = jobIntel.prioritySkills || [];
  if (!priority.length) return 0.5;
  let earned = 0;
  let possible = 0;
  for (const p of priority.slice(0, 20)) {
    possible += p.weight;
    if (skillPresent(text, p.skill)) earned += p.weight;
  }
  const skillFit = possible ? earned / possible : 0;

  /* An intent the JD explicitly asks for is worth real credit even when no
     JD keyword appears in the sentence. */
  const fnMap = {
    automation: /automate manual processes/i,
    reliability: /improve reliability|operate and support/i,
    architecture: /design systems/i,
    leadership: /lead or mentor/i,
    security: /security and compliance/i,
    data: /data quality/i,
    delivery: /build and ship/i,
    stakeholder: /stakeholders/i,
    performance: /reliability and performance/i,
  };
  const fnRe = fnMap[intent];
  const fnFit = fnRe && (jobIntel.functionalExpectations || []).some((f) => fnRe.test(f)) ? 0.35 : 0;

  const roleFit = targetRole && new RegExp(String(targetRole).split(/\s+/)[0], 'i').test(text) ? 0.05 : 0;
  return clamp01(skillFit * 2.2 + fnFit + roleFit);
}

/** Specificity: named systems, technologies, scope, numbers; minus vagueness. */
export function scoreSpecificity(text, evidence) {
  const t = String(text);
  let s = 0;
  const techCount = (evidence?.skillsDisplay || []).filter((k) => skillPresent(t, k)).length;
  s += Math.min(0.35, techCount * 0.15);
  if (/\d/.test(t)) s += 0.2;
  if (CONCRETE_HINT.test(t)) s += 0.2;
  if (evidence?.scope && t.toLowerCase().includes(String(evidence.scope).toLowerCase().slice(0, 12))) s += 0.12;
  if (evidence?.method && t.toLowerCase().includes(String(evidence.method).toLowerCase().slice(0, 12))) s += 0.12;
  /* Proper nouns (real system/tool names) are a strong specificity signal. */
  const propers = (t.match(/\b[A-Z][a-zA-Z0-9]{2,}\b/g) || []).filter((w, i) => i > 0);
  s += Math.min(0.15, propers.length * 0.05);
  const vague = (t.match(VAGUE_NOUNS) || []).length;
  s -= vague * 0.18;
  return clamp01(s);
}

/** Domain authenticity: practitioner nouns and collocations, not adjectives. */
export function scoreDomain(text, { roleFamily = 'general', seniority = 'mid' } = {}) {
  const vocab = vocabularyFor(roleFamily, { seniority });
  const t = String(text).toLowerCase();
  let hits = 0;
  for (const n of vocab.nouns) {
    if (new RegExp(`(?<![a-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(t)) hits += 1;
  }
  let colloc = 0;
  for (const [, phrase] of vocab.collocations) {
    if (t.includes(phrase.toLowerCase())) colloc += 1;
  }
  /* A domain verb used for its intent counts, but far less than a real noun. */
  let verbHit = 0;
  for (const list of Object.values(vocab.verbs)) {
    if (list.some((v) => new RegExp(`(?<![a-z])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(t))) { verbHit = 1; break; }
  }
  const penalty = vocab.avoid.some((w) => t.includes(String(w).toLowerCase())) ? 0.3 : 0;
  return clamp01(Math.min(0.5, hits * 0.18) + Math.min(0.35, colloc * 0.22) + verbHit * 0.15 - penalty);
}

/* Opening with one of these is a structural weakness, not a word choice — no
   amount of concrete detail later in the sentence redeems the lead. */
const WEAK_OPENER_RE = /^(responsible for|worked on|worked with|helped (?:with|to|in)|assisted (?:with|in)|involved in|participated in|tasked with|duties included|exposure to|familiar with|was part of|part of|contributed to the)\b/i;

/** Natural professional language: cliché load + structural naturalness. */
export function scoreNaturalness(text, { documentFrequency = null, technologies = [], domainAvoid = [] } = {}) {
  const pq = analyzePhraseQuality(text, { documentFrequency, technologies, domainAvoid });
  let s = pq.score;
  const t = String(text);
  /* Applied before anything else and never context-rescued. */
  if (WEAK_OPENER_RE.test(t.trim())) s -= 0.45;
  /* Stacked adjectives read as marketing copy. */
  const adjRuns = (t.match(/\b(\w+(?:ive|ous|ful|ic|al|able|ible))\s+(\w+(?:ive|ous|ful|ic|al|able|ible))\b/gi) || []).length;
  s -= adjRuns * 0.15;
  /* Excessive subordinate clauses. */
  const commas = (t.match(/,/g) || []).length;
  if (commas >= 4) s -= 0.2;
  /* "resulting in" is the single most recognisable AI resume tic. */
  if (/\bresulting in\b/i.test(t)) s -= 0.12;
  /* Em-dash stacking. */
  if ((t.match(/—/g) || []).length >= 2) s -= 0.15;
  /* First person never belongs on a resume. */
  if (/\b(I|my|we|our)\b/.test(t)) s -= 0.3;
  /* Nominalisation density (P2.10, "awkward noun phrases"). A buried verb
     — "deployment configuration of X", "performed migration of Y" — is
     measurably harder to read than the verb form, and it is the dominant
     texture of weak corporate resume writing. Penalised per occurrence so a
     sentence carrying two buried verbs is scored worse than one carrying one.
     "of"-linked nominals are the strongest signal, so they count double. */
  const nominals = (t.match(/\b\w{4,}(?:tion|ment|ance|ence|sion)\b/gi) || []).length;
  const ofLinked = (t.match(/\b\w{4,}(?:tion|ment|ance|ence|sion)\s+of\b/gi) || []).length;
  s -= Math.min(0.3, nominals * 0.05 + ofLinked * 0.05);

  /* Verb–object collocation (Phase A2). "Ran deployment configuration" is
     truthful and unidiomatic; without this the reranker cannot tell it apart
     from "Configured deployments", and a two-word synonym swap keeps beating
     a real rewrite. Centred on 0.5 so an unknown pairing is neutral rather
     than punished — absence of data is not evidence of awkwardness. */
  const fit = scoreSentenceVerbFit(t);
  s += (fit.score - 0.5) * 0.5;
  return clamp01(s);
}

/** ATS usefulness: parseable shape and keyword presence, not density. */
export function scoreAts(text, { jobIntel = null } = {}) {
  const t = String(text);
  let s = 0.55;
  const words = t.split(/\s+/).filter(Boolean).length;
  if (words >= 8 && words <= 30) s += 0.15; else s -= 0.1;
  if (/^[A-Z]/.test(t)) s += 0.05;
  if (!/[|•►▪]/.test(t)) s += 0.05;         // no glyphs that break parsers
  if (!/\([^)]{40,}\)/.test(t)) s += 0.05;   // no giant parentheticals
  if (jobIntel) {
    const hits = (jobIntel.prioritySkills || []).slice(0, 12).filter((p) => skillPresent(t, p.skill)).length;
    s += Math.min(0.2, hits * 0.1);
    /* Repeating the SAME term three times in one bullet is stuffing. */
    for (const p of (jobIntel.prioritySkills || []).slice(0, 12)) {
      const esc = p.skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const n = (t.match(new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, 'gi')) || []).length;
      if (n >= 3) s -= 0.25;
    }
  }
  return clamp01(s);
}

export function scoreConciseness(text, evidence, { targetBulletLength = 19 } = {}) {
  const words = String(text).split(/\s+/).filter(Boolean).length;
  if (!words) return 0;
  const informative = new Set(String(text).toLowerCase().match(/[a-z][a-z+#./-]{3,}/g) || []).size;
  const density = informative / words;
  /* Readable band centred on the mode's target length. "concise" mode moves
     the centre to 17 words and the band with it, so shorter candidates
     genuinely win rather than merely being described as preferred. */
  const centre = Math.max(10, Math.min(30, Number(targetBulletLength) || 19));
  const lo = Math.max(8, centre - 7);
  const hi = centre + 7;
  const band = words >= lo && words <= hi ? 1 : 1 - Math.min(0.7, Math.abs(words - centre) / 22);
  const shrink = evidence?.wordCount ? clamp01(1 - Math.max(0, words - evidence.wordCount) / 20) : 1;
  return clamp01(band * 0.5 + density * 0.3 + shrink * 0.2);
}

/** Novelty: is this sentence structurally different from the default shape? */
export function scoreNovelty(text, { corpusShapes = null, structure = '' } = {}) {
  const t = String(text);
  let s = 0.6;
  if (/^(Developed|Implemented|Managed|Responsible for|Worked on|Led)\b/i.test(t)) s -= 0.2;
  if (/\b(and|,)\s+resulting in\b/i.test(t)) s -= 0.25;
  if (structure && structure !== 'ORIGINAL') s += 0.15;
  if (corpusShapes) {
    const shape = shapeOf(t);
    const seen = corpusShapes.get(shape) || 0;
    s -= Math.min(0.5, seen * 0.15); // structural repetition across the document
  }
  return clamp01(s);
}

/** A coarse syntactic signature used for structural-repetition detection. */
export function shapeOf(text) {
  const t = String(text).trim();
  const lead = (t.split(/\s+/)[0] || '').toLowerCase();
  const commas = Math.min(3, (t.match(/,/g) || []).length);
  const hasBy = /\bby \w+ing\b/i.test(t) ? 'by' : '';
  const hasUsing = /\b(using|via|through|with)\b/i.test(t) ? 'u' : '';
  const hasResult = /\b(reducing|improving|increasing|cutting|removing|eliminating|resulting in)\b/i.test(t) ? 'r' : '';
  const buckets = t.split(/\s+/).length < 14 ? 's' : t.split(/\s+/).length < 24 ? 'm' : 'l';
  return `${lead.slice(0, 4)}|${commas}|${hasBy}${hasUsing}${hasResult}|${buckets}`;
}

/* ---------------- composite ---------------- */
/**
 * Score one candidate. `hardFail` is set when the truth validator rejected it —
 * such candidates score exactly 0 and can never be selected.
 */
export function scoreCandidate(candidate, {
  evidence, jobIntel = null, roleFamily = 'general', seniority = 'mid',
  voice = null, documentFrequency = null, corpusShapes = null, intent = '',
  targetRole = '', domainAvoid = [], hardFail = false,
  weights = null, targetBulletLength = 19,
} = {}) {
  const W = resolveWeights(weights);
  const text = String(candidate.text || '');
  const dims = {
    evidenceScore: scoreEvidence(text, evidence),
    relevanceScore: scoreRelevance(text, { jobIntel, intent, targetRole }),
    specificityScore: scoreSpecificity(text, evidence),
    domainScore: scoreDomain(text, { roleFamily, seniority }),
    naturalnessScore: scoreNaturalness(text, {
      documentFrequency, technologies: evidence?.skillsDisplay || [], domainAvoid,
    }),
    atsScore: scoreAts(text, { jobIntel }),
    voiceScore: voiceConsistency(text, voice),
    concisenessScore: scoreConciseness(text, evidence, { targetBulletLength }),
    noveltyScore: scoreNovelty(text, { corpusShapes, structure: candidate.structure }),
  };

  const finalScore = hardFail ? 0 : Number((
    dims.evidenceScore * W.evidence
    + dims.relevanceScore * W.relevance
    + dims.specificityScore * W.specificity
    + dims.domainScore * W.domain
    + dims.naturalnessScore * W.naturalness
    + dims.atsScore * W.ats
    + dims.voiceScore * W.voice
    + dims.concisenessScore * W.conciseness
    + dims.noveltyScore * W.novelty
  ).toFixed(2));

  return {
    ...candidate,
    metadata: {
      version: BULLET_SCORING_VERSION,
      ...Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, Number(v.toFixed(3))])),
      redundancyScore: 0, // filled by the resume-level pass
      hardFail,
      finalScore,
    },
    finalScore,
  };
}

/** Rank a candidate set. Deterministic tiebreak keeps output reproducible. */
export function rerankCandidates(candidates, ctx = {}) {
  const scored = candidates.map((c) => scoreCandidate(c, ctx));
  scored.sort((a, b) => b.finalScore - a.finalScore
    || a.text.length - b.text.length
    || a.text.localeCompare(b.text));
  /* Depth controls how many ranked alternatives survive for the consistency
     pass to choose from. Deeper mode keeps more real options, which is what
     makes a second consistency pass worth running. */
  const keep = Number(ctx.keep) > 0 ? Number(ctx.keep) : scored.length;
  return scored.slice(0, Math.max(1, keep));
}

export { WEAK_OPENER_RE };

export default {
  BULLET_SCORING_VERSION, WEIGHTS, MODE_WEIGHT_DIMENSION, resolveWeights,
  scoreCandidate, rerankCandidates, shapeOf,
  scoreEvidence, scoreRelevance, scoreSpecificity, scoreDomain,
  scoreNaturalness, scoreAts, scoreConciseness, scoreNovelty,
};
