/* ============================================================
   PHRASE QUALITY — cliché + generic-language model (stage 7)
   ------------------------------------------------------------
   NOT a banned-word list. Three deliberate design decisions:

   1. FREQUENCY, NOT PRESENCE. "Leveraged" once in a 20-bullet
      resume is a stylistic choice. "Leveraged" five times is a
      template. The penalty is a function of how often the phrase
      occurs relative to the document, not of it occurring.

   2. CONTEXT MATTERS. "Spearheaded a migration off Oracle" is a
      real claim with a real object. "Spearheaded initiatives" is
      noise. A cliché followed by a concrete anchor (technology,
      number, named system) is penalised far less than one
      followed by an abstract noun.

   3. SEVERITY TIERS. Some phrases are irredeemable on a resume
      ("dynamic professional", "results-driven"); others are only
      weak by default ("responsible for"). They score differently.

   Output is a numeric penalty in [0,1] plus explainable hits, so
   the bullet scorer can use it as a dimension rather than as a
   veto.
   ============================================================ */

export const PHRASE_QUALITY_VERSION = 'phrase-quality-v1';

/* tier: how bad the phrase is when it IS generic.
   contextRescue: whether a concrete anchor nearby can redeem it. */
const CLICHE_CORPUS = [
  /* --- irredeemable resume filler: pure self-description --- */
  { re: /\bresults[- ]driven\b/gi, phrase: 'results-driven', tier: 1.0, contextRescue: false },
  { re: /\bdynamic (?:professional|individual|leader)\b/gi, phrase: 'dynamic professional', tier: 1.0, contextRescue: false },
  { re: /\bhighly motivated\b/gi, phrase: 'highly motivated', tier: 1.0, contextRescue: false },
  { re: /\bproven track record\b/gi, phrase: 'proven track record', tier: 1.0, contextRescue: false },
  { re: /\bdemonstrated (?:expertise|ability|proficiency)\b/gi, phrase: 'demonstrated expertise', tier: 0.9, contextRescue: false },
  { re: /\bteam player\b/gi, phrase: 'team player', tier: 0.9, contextRescue: false },
  { re: /\bgo[- ]getter\b/gi, phrase: 'go-getter', tier: 1.0, contextRescue: false },
  { re: /\bpassionate about\b/gi, phrase: 'passionate about', tier: 0.7, contextRescue: false },
  { re: /\bhard[- ]working\b/gi, phrase: 'hard-working', tier: 0.9, contextRescue: false },
  { re: /\bdetail[- ]oriented\b/gi, phrase: 'detail-oriented', tier: 0.8, contextRescue: false },
  { re: /\bthink outside the box\b/gi, phrase: 'think outside the box', tier: 1.0, contextRescue: false },

  /* --- marketing adjectives applied to engineering --- */
  { re: /\bcutting[- ]edge\b/gi, phrase: 'cutting-edge', tier: 0.95, contextRescue: false },
  { re: /\bstate[- ]of[- ]the[- ]art\b/gi, phrase: 'state-of-the-art', tier: 0.85, contextRescue: false },
  { re: /\bbest[- ]in[- ]class\b/gi, phrase: 'best-in-class', tier: 0.9, contextRescue: false },
  { re: /\bworld[- ]class\b/gi, phrase: 'world-class', tier: 0.9, contextRescue: false },
  { re: /\bgame[- ]chang(?:ing|er)\b/gi, phrase: 'game-changing', tier: 0.95, contextRescue: false },
  { re: /\binnovative solutions?\b/gi, phrase: 'innovative solutions', tier: 0.95, contextRescue: false },
  { re: /\brobust (?:solutions?|systems?|architectures?)\b/gi, phrase: 'robust solutions', tier: 0.8, contextRescue: true },
  { re: /\bseamless(?:ly)? (?:integration|integrated|experience)\b/gi, phrase: 'seamless integration', tier: 0.85, contextRescue: true },
  { re: /\bscalable solutions?\b/gi, phrase: 'scalable solutions', tier: 0.9, contextRescue: true },
  { re: /\bsynerg(?:y|ies|istic)\b/gi, phrase: 'synergy', tier: 1.0, contextRescue: false },
  { re: /\bholistic approach\b/gi, phrase: 'holistic approach', tier: 0.85, contextRescue: false },
  { re: /\bmission[- ]critical\b/gi, phrase: 'mission-critical', tier: 0.5, contextRescue: true },
  { re: /\bnext[- ]generation\b/gi, phrase: 'next-generation', tier: 0.7, contextRescue: true },

  /* --- overused default verbs (frequency-sensitive, rescuable) --- */
  { re: /\bleverag(?:ed|ing|e)\b/gi, phrase: 'leveraged', tier: 0.6, contextRescue: true },
  { re: /\bspearhead(?:ed|ing)\b/gi, phrase: 'spearheaded', tier: 0.55, contextRescue: true },
  { re: /\butilis?(?:ed|ing|e)\b/gi, phrase: 'utilized', tier: 0.5, contextRescue: true },
  { re: /\borchestrat(?:ed|ing)\b/gi, phrase: 'orchestrated', tier: 0.35, contextRescue: true },
  { re: /\bchampion(?:ed|ing)\b/gi, phrase: 'championed', tier: 0.6, contextRescue: true },
  { re: /\bempower(?:ed|ing)\b/gi, phrase: 'empowered', tier: 0.6, contextRescue: true },
  { re: /\brevolutionis?(?:ed|ing)\b/gi, phrase: 'revolutionized', tier: 0.9, contextRescue: false },
  { re: /\btransform(?:ed|ing) (?:the )?(?:business|organisation|organization|landscape)\b/gi, phrase: 'transformed the business', tier: 0.8, contextRescue: true },

  /* --- weak ownership language --- */
  { re: /\bresponsible for\b/gi, phrase: 'responsible for', tier: 0.65, contextRescue: true },
  { re: /\bworked on\b/gi, phrase: 'worked on', tier: 0.6, contextRescue: true },
  { re: /\bhelped (?:with|to|in)\b/gi, phrase: 'helped with', tier: 0.7, contextRescue: true },
  { re: /\bassisted (?:with|in)\b/gi, phrase: 'assisted with', tier: 0.65, contextRescue: true },
  { re: /\bplayed a (?:key|vital|crucial|major) role\b/gi, phrase: 'played a key role', tier: 0.85, contextRescue: false },
  { re: /\binvolved in\b/gi, phrase: 'involved in', tier: 0.6, contextRescue: true },
  { re: /\bparticipated in\b/gi, phrase: 'participated in', tier: 0.55, contextRescue: true },
  { re: /\bwas part of\b/gi, phrase: 'was part of', tier: 0.6, contextRescue: true },
  { re: /\bexposure to\b/gi, phrase: 'exposure to', tier: 0.6, contextRescue: true },
  { re: /\bfamiliar with\b/gi, phrase: 'familiar with', tier: 0.55, contextRescue: true },

  /* --- vague quantity / vague outcome --- */
  { re: /\bvarious\b/gi, phrase: 'various', tier: 0.55, contextRescue: false },
  { re: /\bnumerous\b/gi, phrase: 'numerous', tier: 0.5, contextRescue: false },
  { re: /\bmultiple stakeholders\b/gi, phrase: 'multiple stakeholders', tier: 0.5, contextRescue: true },
  { re: /\bsuccessfully\b/gi, phrase: 'successfully', tier: 0.6, contextRescue: false },
  { re: /\beffectively\b/gi, phrase: 'effectively', tier: 0.5, contextRescue: false },
  { re: /\bimproved (?:operational )?efficienc(?:y|ies)\b/gi, phrase: 'improved efficiency', tier: 0.75, contextRescue: true },
  { re: /\boptimis?(?:ed|ing) efficienc(?:y|ies)\b/gi, phrase: 'optimized efficiency', tier: 0.85, contextRescue: true },
  { re: /\benhanc(?:ed|ing) productivity\b/gi, phrase: 'enhanced productivity', tier: 0.75, contextRescue: true },
  { re: /\bcross[- ]functional (?:collaboration|teams?)\b/gi, phrase: 'cross-functional collaboration', tier: 0.55, contextRescue: true },
  { re: /\bend[- ]to[- ]end (?:solutions?|ownership)\b/gi, phrase: 'end-to-end solutions', tier: 0.6, contextRescue: true },
  { re: /\bwide (?:range|variety) of\b/gi, phrase: 'wide range of', tier: 0.55, contextRescue: false },
];

/* A concrete anchor near a rescuable cliché reduces its penalty sharply. */
const ANCHOR_RE = /(\d[\d,.]*\s*(?:%|k|m|tb|gb|ms|hrs?|hours?|days?|weeks?|months?|years?|users?|records?|requests?)?|\b[A-Z][a-zA-Z]*(?:\.[a-z]+)?\b(?=\s|,|$))/;

const NEAR_WINDOW = 60; // characters either side

function hasNearbyAnchor(text, index, technologies = []) {
  const start = Math.max(0, index - NEAR_WINDOW);
  const window = text.slice(start, index + NEAR_WINDOW);
  if (/\d/.test(window)) return true;
  for (const t of technologies) {
    if (t && window.toLowerCase().includes(String(t).toLowerCase())) return true;
  }
  return ANCHOR_RE.test(window) && /[A-Z]/.test(window.slice(1));
}

/**
 * Analyse one string.
 * @param {string} text
 * @param {object} opts.technologies  evidence-backed technologies (anchors)
 * @param {Map} opts.documentFrequency  phrase -> count across the document
 * @param {string[]} opts.domainAvoid   family-specific words to also penalise
 */
export function analyzePhraseQuality(text, {
  technologies = [], documentFrequency = null, domainAvoid = [],
} = {}) {
  const src = String(text || '');
  if (!src.trim()) return { version: PHRASE_QUALITY_VERSION, penalty: 0, hits: [], score: 1 };

  const hits = [];
  let raw = 0;

  const consider = (phrase, tier, contextRescue, index, matchText) => {
    const docCount = documentFrequency?.get(phrase) || 1;
    /* Frequency multiplier: 1st occurrence 1.0, 2nd 1.35, 3rd 1.7, cap 2.2 */
    const freqMult = Math.min(2.2, 1 + Math.max(0, docCount - 1) * 0.35);
    const rescued = contextRescue && hasNearbyAnchor(src, index, technologies);
    const contextMult = rescued ? 0.3 : 1;
    const weight = tier * freqMult * contextMult;
    raw += weight;
    hits.push({
      phrase, match: matchText, tier, index,
      documentCount: docCount,
      rescuedByContext: rescued,
      weight: Number(weight.toFixed(3)),
      reason: rescued
        ? 'Generic by default, but anchored to a concrete technology or number here.'
        : docCount > 1
          ? `Used ${docCount}× across this resume — repetition is what makes it read as templated.`
          : 'Adds no verifiable information.',
    });
  };

  for (const entry of CLICHE_CORPUS) {
    const re = new RegExp(entry.re.source, entry.re.flags);
    let m;
    while ((m = re.exec(src)) !== null) {
      consider(entry.phrase, entry.tier, entry.contextRescue, m.index, m[0]);
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }

  for (const word of domainAvoid) {
    const esc = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${esc}\\b`, 'gi');
    let m;
    while ((m = re.exec(src)) !== null) {
      /* Domain-inappropriate words carry a moderate, always-applied tier. */
      if (!hits.some((h) => Math.abs(h.index - m.index) < 3)) {
        consider(String(word).toLowerCase(), 0.6, false, m.index, m[0]);
      }
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }

  /* Normalise by sentence length so a long sentence isn't automatically worse. */
  const words = src.split(/\s+/).filter(Boolean).length || 1;
  const density = raw / Math.max(6, words / 4);
  const penalty = Math.max(0, Math.min(1, density));

  return {
    version: PHRASE_QUALITY_VERSION,
    penalty: Number(penalty.toFixed(3)),
    score: Number((1 - penalty).toFixed(3)),
    hits: hits.sort((a, b) => b.weight - a.weight).slice(0, 12),
    rawWeight: Number(raw.toFixed(3)),
  };
}

/** Count cliché occurrences across many strings — feeds the frequency model. */
export function buildDocumentFrequency(texts = []) {
  const freq = new Map();
  for (const t of texts) {
    const src = String(t || '');
    for (const entry of CLICHE_CORPUS) {
      const re = new RegExp(entry.re.source, entry.re.flags);
      const n = (src.match(re) || []).length;
      if (n) freq.set(entry.phrase, (freq.get(entry.phrase) || 0) + n);
    }
  }
  return freq;
}

/** The phrases the corpus knows about — used by tests and the benchmark. */
export function clichePhrases() {
  return CLICHE_CORPUS.map((c) => c.phrase);
}

export default {
  PHRASE_QUALITY_VERSION, analyzePhraseQuality, buildDocumentFrequency, clichePhrases,
};
