/* ============================================================
   RESPONSIBILITY SCALE  (Part 3)
   ------------------------------------------------------------
   Two different ceilings were being conflated:

     Candidate Seniority Ceiling
       "this person is senior, so senior language is plausible"

     Evidence Responsibility Ceiling
       "THIS STATEMENT says the person was responsible for X,
        so this statement may not claim they owned it"

   Only the first existed, which meant a senior profile
   authorised ownership language on every bullet it contained.
   "Responsible for deployment configuration" became "Owned
   deployment configuration" and passed the truth gate, because
   the gate was asking about the person rather than the sentence.

   Seniority makes strong language PLAUSIBLE. Only evidence makes
   it TRUE, and the evidence for a claim is the claim's own
   wording — not the job title three lines above it.
   ============================================================ */

export const RESPONSIBILITY_SCALE_VERSION = 'responsibility-scale-v1';

export const RESPONSIBILITY = Object.freeze({
  EXPOSURE: 0,
  ASSISTED: 1,
  CONTRIBUTED: 2,
  EXECUTED: 3,
  RESPONSIBLE: 4,
  OWNED: 5,
  LED: 6,
  ARCHITECTED: 7,
  STRATEGY: 8,
});

export const LEVEL_NAMES = Object.freeze(
  Object.entries(RESPONSIBILITY).sort((a, b) => a[1] - b[1]).map(([k]) => k),
);

/* The authority tier begins at RESPONSIBLE. Below it, verbs describe WHAT
   someone did; at and above it, they describe THEIR STANDING over the work.
   The distinction matters because "worked on" → "implemented" is a
   description becoming more precise, whereas "responsible for" → "owned" is
   a promotion. Only the second is a claim about authority, and only claims
   about authority need an authority ceiling. */
export const AUTHORITY_FLOOR = RESPONSIBILITY.RESPONSIBLE;

/* Phrases that SET the responsibility level of a source statement. Ordered
   longest-first at match time so "helped implement" beats "implement". */
const PHRASE_LEVELS = [
  // authority tier
  ['set the strategy', RESPONSIBILITY.STRATEGY],
  ['defined the strategy', RESPONSIBILITY.STRATEGY],
  ['architected', RESPONSIBILITY.ARCHITECTED],
  ['designed and owned', RESPONSIBILITY.ARCHITECTED],
  ['led', RESPONSIBILITY.LED],
  ['leading', RESPONSIBILITY.LED],
  ['headed', RESPONSIBILITY.LED],
  ['directed', RESPONSIBILITY.LED],
  ['spearheaded', RESPONSIBILITY.LED],
  ['managed a team', RESPONSIBILITY.LED],
  ['owned', RESPONSIBILITY.OWNED],
  ['ownership of', RESPONSIBILITY.OWNED],
  ['accountable for', RESPONSIBILITY.OWNED],
  ['responsible for', RESPONSIBILITY.RESPONSIBLE],
  ['responsibilities included', RESPONSIBILITY.RESPONSIBLE],
  ['in charge of', RESPONSIBILITY.RESPONSIBLE],
  ['managed', RESPONSIBILITY.RESPONSIBLE],
  ['oversaw', RESPONSIBILITY.RESPONSIBLE],
  ['overseeing', RESPONSIBILITY.RESPONSIBLE],
  // execution tier
  ['helped implement', RESPONSIBILITY.ASSISTED],
  ['helped with', RESPONSIBILITY.ASSISTED],
  ['helped', RESPONSIBILITY.ASSISTED],
  ['assisted with', RESPONSIBILITY.ASSISTED],
  ['assisted', RESPONSIBILITY.ASSISTED],
  ['supported', RESPONSIBILITY.ASSISTED],
  ['shadowed', RESPONSIBILITY.EXPOSURE],
  ['observed', RESPONSIBILITY.EXPOSURE],
  ['exposure to', RESPONSIBILITY.EXPOSURE],
  ['familiar with', RESPONSIBILITY.EXPOSURE],
  ['participated in', RESPONSIBILITY.CONTRIBUTED],
  ['contributed to', RESPONSIBILITY.CONTRIBUTED],
  ['collaborated on', RESPONSIBILITY.CONTRIBUTED],
  ['worked on', RESPONSIBILITY.CONTRIBUTED],
  ['worked with', RESPONSIBILITY.CONTRIBUTED],
  ['involved in', RESPONSIBILITY.CONTRIBUTED],
  ['part of', RESPONSIBILITY.CONTRIBUTED],
];

/* Verbs that CLAIM a level when they open a rewritten statement. */
const VERB_LEVELS = new Map(Object.entries({
  // authority
  architected: RESPONSIBILITY.ARCHITECTED,
  rearchitected: RESPONSIBILITY.ARCHITECTED,
  led: RESPONSIBILITY.LED,
  directed: RESPONSIBILITY.LED,
  headed: RESPONSIBILITY.LED,
  spearheaded: RESPONSIBILITY.LED,
  chaired: RESPONSIBILITY.LED,
  owned: RESPONSIBILITY.OWNED,
  drove: RESPONSIBILITY.OWNED,
  managed: RESPONSIBILITY.RESPONSIBLE,
  oversaw: RESPONSIBILITY.RESPONSIBLE,
  ran: RESPONSIBILITY.RESPONSIBLE,
  operated: RESPONSIBILITY.RESPONSIBLE,
  administered: RESPONSIBILITY.RESPONSIBLE,
  maintained: RESPONSIBILITY.RESPONSIBLE,
  // execution
  built: RESPONSIBILITY.EXECUTED,
  created: RESPONSIBILITY.EXECUTED,
  developed: RESPONSIBILITY.EXECUTED,
  implemented: RESPONSIBILITY.EXECUTED,
  delivered: RESPONSIBILITY.EXECUTED,
  automated: RESPONSIBILITY.EXECUTED,
  configured: RESPONSIBILITY.EXECUTED,
  migrated: RESPONSIBILITY.EXECUTED,
  integrated: RESPONSIBILITY.EXECUTED,
  standardised: RESPONSIBILITY.EXECUTED,
  standardized: RESPONSIBILITY.EXECUTED,
  consolidated: RESPONSIBILITY.EXECUTED,
  refactored: RESPONSIBILITY.EXECUTED,
  wrote: RESPONSIBILITY.EXECUTED,
  authored: RESPONSIBILITY.EXECUTED,
  designed: RESPONSIBILITY.EXECUTED,
  contributed: RESPONSIBILITY.CONTRIBUTED,
  participated: RESPONSIBILITY.CONTRIBUTED,
  collaborated: RESPONSIBILITY.CONTRIBUTED,
  assisted: RESPONSIBILITY.ASSISTED,
  helped: RESPONSIBILITY.ASSISTED,
  supported: RESPONSIBILITY.ASSISTED,
  shadowed: RESPONSIBILITY.EXPOSURE,
  observed: RESPONSIBILITY.EXPOSURE,
}));

/**
 * The responsibility level a source statement actually evidences.
 * Returns null when the statement says nothing about responsibility, in
 * which case the caller should not invent a ceiling from silence.
 */
export function evidenceResponsibilityLevel(text) {
  const t = ` ${String(text || '').toLowerCase()} `;
  let best = null;
  let bestLen = 0;
  for (const [phrase, level] of PHRASE_LEVELS) {
    if (!t.includes(` ${phrase} `) && !t.startsWith(` ${phrase} `)) {
      if (!new RegExp(`(?<![a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`).test(t)) continue;
    }
    /* Longest phrase wins: "helped implement" must not be read as "implement". */
    if (phrase.length > bestLen) { best = level; bestLen = phrase.length; }
  }
  if (best !== null) return best;

  /* Fall back to the opening verb. */
  const m = String(text || '').trim().match(/^([A-Za-z][\w-]*)/);
  if (m) {
    const v = m[1].toLowerCase();
    if (VERB_LEVELS.has(v)) return VERB_LEVELS.get(v);
  }
  return null;
}

/** The responsibility level a candidate sentence CLAIMS. */
export function claimedResponsibilityLevel(text) {
  const t = String(text || '').trim();
  const m = t.match(/^([A-Za-z][\w-]*)/);
  if (m) {
    const v = m[1].toLowerCase();
    if (VERB_LEVELS.has(v)) return VERB_LEVELS.get(v);
  }
  /* Ownership phrasing anywhere in the sentence still claims ownership. */
  for (const [phrase, level] of PHRASE_LEVELS) {
    if (level < AUTHORITY_FLOOR) continue;
    if (new RegExp(`(?<![a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'i').test(t)) {
      return level;
    }
  }
  return null;
}

export function levelName(level) {
  return LEVEL_NAMES[level] ?? String(level);
}

/**
 * Validate a rewrite against the responsibility the ORIGINAL statement
 * evidences, capped additionally by the candidate's seniority ceiling.
 *
 * The rule only bites in the authority tier. Below RESPONSIBLE, verbs
 * describe the work rather than the person's standing over it, and
 * action semantics is the right validator for those.
 *
 * @returns {{status:'PASS'|'FAIL'|'NOT_RUN', detail:string, violations:Array}}
 */
export function validateResponsibility(candidate, evidence = {}, {
  candidateCeiling = RESPONSIBILITY.STRATEGY,
} = {}) {
  const sourceText = evidence.rawText || evidence.originalText || '';
  const claimed = claimedResponsibilityLevel(candidate);

  if (claimed === null) {
    return { status: 'PASS', violations: [], detail: 'The rewrite makes no responsibility claim.' };
  }
  /* Execution-tier wording is not an authority claim. */
  if (claimed < AUTHORITY_FLOOR) {
    return {
      status: 'PASS', violations: [],
      detail: `"${levelName(claimed)}" describes the work, not authority over it.`,
    };
  }

  const evidenced = evidenceResponsibilityLevel(sourceText);
  if (evidenced === null) {
    return {
      status: 'FAIL',
      violations: [{
        code: 'responsibility_inflation', severity: 'critical',
        claimed: levelName(claimed), evidenced: 'UNSTATED',
        detail: `The rewrite claims ${levelName(claimed)}-level authority, but the original statement says nothing about responsibility. Authority language needs evidence, not silence.`,
      }],
      detail: 'Authority claimed with no responsibility stated in the source.',
    };
  }

  /* The binding ceiling is the LOWER of what this statement evidences and
     what the candidate's overall seniority supports. A senior title cannot
     lift an individual statement, and a strong statement cannot lift a
     junior profile. */
  const ceiling = Math.min(evidenced, candidateCeiling);

  if (claimed <= ceiling) {
    return {
      status: 'PASS', violations: [],
      detail: `${levelName(claimed)} is within the evidenced ceiling of ${levelName(ceiling)}.`,
    };
  }

  return {
    status: 'FAIL',
    violations: [{
      code: 'responsibility_inflation', severity: 'critical',
      claimed: levelName(claimed),
      evidenced: levelName(evidenced),
      ceiling: levelName(ceiling),
      detail: `The rewrite claims ${levelName(claimed)} but the original evidences only ${levelName(evidenced)}. Wording may improve; standing over the work may not.`,
    }],
    detail: `${levelName(claimed)} exceeds the evidenced ceiling ${levelName(ceiling)}.`,
  };
}

/** Map the engine's coarse seniority label onto the scale. */
export function ceilingForSeniority(seniority) {
  switch (String(seniority || '').toLowerCase()) {
    case 'student':
    case 'intern':
      return RESPONSIBILITY.CONTRIBUTED;
    case 'junior':
      return RESPONSIBILITY.EXECUTED;
    case 'mid':
      return RESPONSIBILITY.RESPONSIBLE;
    case 'senior':
      return RESPONSIBILITY.LED;
    case 'lead':
    case 'principal':
      return RESPONSIBILITY.ARCHITECTED;
    case 'director':
    case 'executive':
      return RESPONSIBILITY.STRATEGY;
    default:
      return RESPONSIBILITY.RESPONSIBLE;
  }
}

export default {
  RESPONSIBILITY_SCALE_VERSION, RESPONSIBILITY, LEVEL_NAMES, AUTHORITY_FLOOR,
  evidenceResponsibilityLevel, claimedResponsibilityLevel, validateResponsibility,
  ceilingForSeniority, levelName,
};
