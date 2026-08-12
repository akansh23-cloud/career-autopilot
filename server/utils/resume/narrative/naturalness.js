/* ============================================================
   NATURALNESS ENGINE (stage 21) + GENERICITY GUARD (stage 24)
   ------------------------------------------------------------
   NATURALNESS is measured, not faked. We never introduce errors,
   never randomise punctuation, and never optimise for detector
   evasion. What we detect are the artefacts of MACHINE-DEFAULT
   WRITING:

     • the same opening verb repeatedly
     • the same syntactic shape repeatedly
     • "resulting in" as a universal connector
     • "by <gerund>" as a universal connector
     • em-dash stacking
     • inflated adjective density
     • unnatural business register
     • transition-phrase overuse
     • subordinate-clause pile-ups
     • suspiciously uniform sentence lengths

   GENERICITY GUARD prevents two different users from receiving the
   same sentences — WITHOUT ever storing, reading or comparing one
   user's private resume text against another's. It works on:
     (a) a static, public cliché/template corpus shipped in code
     (b) STRUCTURE hashes, not content
     (c) per-user deterministic variation seeds
   No user text ever leaves the request that produced it.
   ============================================================ */
import crypto from 'node:crypto';
import { shapeOf } from './bulletScoring.js';
import { analyzePhraseQuality, buildDocumentFrequency } from './phraseQuality.js';

export const NATURALNESS_VERSION = 'naturalness-v1';
export const GENERICITY_GUARD_VERSION = 'genericity-guard-v1';

const TRANSITIONS = /\b(additionally|furthermore|moreover|in addition|subsequently|consequently|therefore|thus|as a result|overall|notably)\b/gi;
const ADJECTIVES = /\b\w+(?:ive|ous|ful|istic|able|ible|ary|al|ent|ant)\b/gi;
const ADJ_STOPWORDS = new Set(['internal', 'external', 'technical', 'operational', 'financial', 'digital', 'manual', 'critical', 'annual', 'global', 'local', 'central', 'general', 'several', 'available', 'multiple', 'personal', 'physical', 'legal', 'medical', 'regional', 'national', 'initial', 'final', 'total', 'actual', 'current', 'different', 'various', 'relevant', 'consistent', 'compliant', 'client', 'component', 'incident', 'management', 'development', 'deployment', 'environment', 'requirement', 'agent', 'content', 'segment', 'statement', 'equipment', 'document', 'investment', 'assessment', 'improvement', 'measurement']);

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const stdev = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

/**
 * Analyse a set of sentences for machine-default patterns.
 * Returns a naturalness score in [0,1] plus explainable findings.
 */
export function analyzeNaturalness(texts = []) {
  const list = texts.map((t) => String(t || '').trim()).filter(Boolean);
  const findings = [];
  if (!list.length) {
    return { version: NATURALNESS_VERSION, score: 1, findings, metrics: {} };
  }

  const n = list.length;
  const add = (code, severity, detail, extra = {}) => findings.push({ code, severity, detail, ...extra });

  /* ---- opening verb repetition ---- */
  const openers = new Map();
  for (const t of list) {
    const w = t.split(/\s+/)[0].toLowerCase().replace(/[^a-z-]/g, '');
    if (w) openers.set(w, (openers.get(w) || 0) + 1);
  }
  const topOpener = [...openers.entries()].sort((a, b) => b[1] - a[1])[0];
  const openerRepetition = topOpener ? topOpener[1] / n : 0;
  if (topOpener && topOpener[1] >= 3) {
    add('repeated_opening_verb', topOpener[1] >= 4 ? 'high' : 'medium',
      `"${topOpener[0]}" opens ${topOpener[1]} of ${n} sentences.`, { verb: topOpener[0], count: topOpener[1] });
  }
  const openerDiversity = openers.size / n;

  /* ---- structural repetition ---- */
  const shapes = new Map();
  for (const t of list) {
    const s = shapeOf(t);
    shapes.set(s, (shapes.get(s) || 0) + 1);
  }
  const topShape = [...shapes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topShape && topShape[1] >= 3) {
    add('repeated_structure', 'medium', `${topShape[1]} sentences share one syntactic shape.`, { count: topShape[1] });
  }
  const structureDiversity = shapes.size / n;

  /* ---- connector overuse ---- */
  const resultingIn = list.filter((t) => /\bresulting in\b/i.test(t)).length;
  if (resultingIn >= 2) {
    add('resulting_in_overuse', resultingIn >= 3 ? 'high' : 'medium',
      `"resulting in" appears in ${resultingIn} sentences — the most recognisable machine-writing tic on a resume.`, { count: resultingIn });
  }
  const byGerund = list.filter((t) => /\bby \w+ing\b/i.test(t)).length;
  if (byGerund >= Math.max(3, Math.ceil(n * 0.5))) {
    add('by_gerund_overuse', 'medium', `${byGerund} sentences use the same "by <verb>ing" construction.`, { count: byGerund });
  }
  const transitions = list.reduce((s, t) => s + ((t.match(TRANSITIONS) || []).length), 0);
  if (transitions >= Math.ceil(n * 0.3)) {
    add('transition_overuse', 'low', `${transitions} transition phrases across ${n} sentences — resumes rarely need them.`);
  }

  /* ---- em-dash stacking ---- */
  const dashes = list.reduce((s, t) => s + ((t.match(/—/g) || []).length), 0);
  if (dashes >= Math.max(2, Math.ceil(n * 0.3))) {
    add('em_dash_stacking', 'medium', `${dashes} em-dashes across ${n} sentences.`);
  }

  /* ---- adjective density ---- */
  const adjRates = list.map((t) => {
    const words = t.split(/\s+/).filter(Boolean).length || 1;
    const adjs = (t.match(ADJECTIVES) || []).filter((a) => !ADJ_STOPWORDS.has(a.toLowerCase()));
    return adjs.length / words;
  });
  const adjectiveDensity = mean(adjRates);
  if (adjectiveDensity > 0.12) {
    add('inflated_adjective_density', 'medium', `Adjective rate ${(adjectiveDensity * 100).toFixed(0)}% — technical writing runs closer to 5%.`);
  }

  /* ---- subordinate clause pile-ups ---- */
  const clausey = list.filter((t) => (t.match(/,/g) || []).length >= 4).length;
  if (clausey >= 2) add('excessive_subordinate_clauses', 'medium', `${clausey} sentences carry 4+ clauses.`);

  /* ---- length uniformity ---- */
  const lengths = list.map((t) => t.split(/\s+/).filter(Boolean).length);
  const lenSd = stdev(lengths);
  const lenMean = mean(lengths);
  if (n >= 4 && lenSd < 2.2) {
    add('uniform_sentence_length', 'medium', `All sentences are ~${Math.round(lenMean)} words (σ=${lenSd.toFixed(1)}). Human resumes vary more.`);
  }

  /* ---- corporate register ---- */
  const freq = buildDocumentFrequency(list);
  const clicheLoad = mean(list.map((t) => analyzePhraseQuality(t, { documentFrequency: freq }).penalty));
  if (clicheLoad > 0.25) {
    add('unnatural_business_register', clicheLoad > 0.45 ? 'high' : 'medium',
      `Cliché load ${(clicheLoad * 100).toFixed(0)}% — the writing is reaching for impressiveness instead of information.`);
  }

  /* ---- composite ---- */
  let score = 1;
  score -= Math.max(0, openerRepetition - 0.3) * 0.9;
  score -= Math.max(0, (topShape ? topShape[1] / n : 0) - 0.35) * 0.7;
  score -= Math.min(0.25, resultingIn * 0.09);
  score -= Math.min(0.15, Math.max(0, byGerund / n - 0.4) * 0.5);
  score -= Math.min(0.2, Math.max(0, adjectiveDensity - 0.08) * 2.5);
  score -= clicheLoad * 0.55;
  score -= n >= 4 && lenSd < 2.2 ? 0.12 : 0;
  score -= Math.min(0.12, dashes * 0.03);
  score = Math.max(0, Math.min(1, score));

  return {
    version: NATURALNESS_VERSION,
    score: Number(score.toFixed(3)),
    findings,
    metrics: {
      sentences: n,
      openerDiversity: Number(openerDiversity.toFixed(3)),
      structureDiversity: Number(structureDiversity.toFixed(3)),
      resultingInCount: resultingIn,
      byGerundCount: byGerund,
      emDashCount: dashes,
      adjectiveDensity: Number(adjectiveDensity.toFixed(3)),
      clicheLoad: Number(clicheLoad.toFixed(3)),
      lengthMean: Number(lenMean.toFixed(1)),
      lengthStdev: Number(lenSd.toFixed(2)),
      transitionCount: transitions,
    },
  };
}

/* ------------------------------------------------------------------ */
/* GENERICITY GUARD                                                    */
/* ------------------------------------------------------------------ */
/* A PUBLIC corpus of template sentences that circulate on resume sites and
   in AI output. Shipped in code, derived from no user. Matching against it is
   a penalty signal — this is the only "corpus" the system has, by design. */
const TEMPLATE_CORPUS = [
  'leveraged cutting-edge technologies to optimize scalable solutions',
  'resulting in improved operational efficiency',
  'spearheaded cross-functional initiatives to drive business growth',
  'utilized industry best practices to deliver robust solutions',
  'collaborated with cross-functional teams to deliver high-quality solutions',
  'responsible for managing day-to-day operations',
  'demonstrated expertise in a wide range of technologies',
  'played a key role in the successful delivery of projects',
  'worked on various projects using different technologies',
  'implemented innovative solutions to complex business problems',
  'successfully delivered projects on time and within budget',
  'developed and maintained scalable and robust applications',
  'proven track record of delivering results in fast-paced environments',
  'results-driven professional with a passion for excellence',
  'seamlessly integrated multiple systems to enhance productivity',
  'championed a culture of continuous improvement across the organisation',
  'drove significant improvements in operational efficiency and effectiveness',
  'utilized strong analytical skills to solve complex problems',
];

const NORMALIZE = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

function tokens(s) { return new Set(NORMALIZE(s).split(' ').filter((w) => w.length > 2)); }

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

const CORPUS_TOKENS = TEMPLATE_CORPUS.map((t) => ({ text: t, tok: tokens(t) }));

/** Similarity to the public template corpus. Higher = more generic. */
export function templateSimilarity(text) {
  const tok = tokens(text);
  let best = 0;
  let match = '';
  for (const c of CORPUS_TOKENS) {
    const s = jaccard(tok, c.tok);
    if (s > best) { best = s; match = c.text; }
  }
  return { similarity: Number(best.toFixed(3)), closest: best >= 0.3 ? match : '' };
}

/**
 * A privacy-safe structural fingerprint. It encodes SHAPE ONLY — sentence
 * skeleton with all content words removed — so it can be compared or counted
 * without ever revealing what anyone wrote.
 */
export function structureFingerprint(text) {
  const skeleton = String(text)
    .toLowerCase()
    .replace(/\b[a-z][a-z+#./-]*\b/g, (w) => (
      /^(the|a|an|and|or|of|in|on|for|to|with|by|at|as|from|across|using|through|via|that|which|into|over|under|while|where|when|per|into)$/.test(w) ? w : 'X'
    ))
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('sha256').update(skeleton).digest('hex').slice(0, 16);
}

/**
 * Genericity assessment for a set of produced sentences.
 * @returns penalty in [0,1] + per-sentence detail
 */
export function assessGenericity(texts = []) {
  const list = texts.map((t) => String(t || '')).filter(Boolean);
  const perSentence = list.map((text) => {
    const sim = templateSimilarity(text);
    return {
      text: text.slice(0, 120),
      templateSimilarity: sim.similarity,
      closestTemplate: sim.closest,
      fingerprint: structureFingerprint(text),
      generic: sim.similarity >= 0.45,
    };
  });

  /* Internal structural repetition — same skeleton used many times. */
  const fp = new Map();
  for (const s of perSentence) fp.set(s.fingerprint, (fp.get(s.fingerprint) || 0) + 1);
  const repeated = [...fp.values()].filter((c) => c > 1).reduce((a, b) => a + (b - 1), 0);

  const avgSim = perSentence.length ? mean(perSentence.map((s) => s.templateSimilarity)) : 0;
  const penalty = Math.max(0, Math.min(1, avgSim * 1.3 + (list.length ? repeated / list.length : 0) * 0.5));

  return {
    version: GENERICITY_GUARD_VERSION,
    penalty: Number(penalty.toFixed(3)),
    score: Number((1 - penalty).toFixed(3)),
    averageTemplateSimilarity: Number(avgSim.toFixed(3)),
    genericSentences: perSentence.filter((s) => s.generic),
    structuralRepeats: repeated,
    uniqueStructures: fp.size,
    perSentence,
    privacyNote: 'Comparison uses a public template corpus and content-free structure hashes only. No other user\'s resume is ever read, stored, or compared.',
  };
}

export function templateCorpus() { return TEMPLATE_CORPUS.slice(); }

export default {
  NATURALNESS_VERSION, GENERICITY_GUARD_VERSION,
  analyzeNaturalness, assessGenericity, templateSimilarity, structureFingerprint, templateCorpus,
};
