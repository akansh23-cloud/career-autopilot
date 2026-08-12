/* ============================================================
   TRUTH VALIDATOR — the hallucination firewall (stage 12)
   ------------------------------------------------------------
   Nothing reaches a ResumeDocument without passing here. This is
   a HARD GATE, not a score: a violation removes the candidate
   from consideration entirely.

   What is refused, unconditionally:

     NUMBERS      any digit-bearing token absent from the evidence
                  record's own numericEvidence (revenue, %, team
                  sizes, latency, uptime, cost, volumes, durations)
     TECHNOLOGIES any ontology skill the evidence never mentioned
     CREDENTIALS  certification / award / patent / promotion shapes
     TITLES       job-title-shaped claims not in the evidence
     AUTHORITY    ownership/leadership escalation beyond what the
                  evidence verb supports and the seniority allows
     SCALE        "enterprise-wide", "company-wide", "global",
                  "across the organisation" without evidence scope
     ENTITIES     employer/product names not in the evidence

   It also runs the EXISTING `validateRewrite` gate from
   writingProviders.js, so the narrative layer can never be weaker
   than the shipped AI-assist gate.

   Design note: the validator is intentionally *conservative and
   dumb*. Cleverness here is a liability — a false rejection costs
   one candidate sentence out of five; a false acceptance costs the
   user their credibility in an interview.
   ============================================================ */
import { allKnownSkills, canonicalSkill } from '../skillOntology.js';
import { skillPresent } from '../skillMatcher.js';
import { validateRewrite } from '../writingProviders.js';

export const TRUTH_VALIDATOR_VERSION = 'narrative-truth-validator-v1';

/* A digit that is part of an identifier ("EC2", "p99", "Java17") is not a
   metric. The lookbehind mirrors extractNumericEvidence so the validator and
   the graph agree on what counts as a number. Trailing unit letters are still
   allowed, so "480ms" and "45%" are caught. */
const DIGIT_TOKEN_RE = /(?<![\w.])\d[\d,]*(?:\.\d+)?/g;

const CREDENTIAL_RE = /\b(certified|certification|accredited|awarded|award|patent(?:ed)?|published|promoted to|promotion to|recognis?ed as|winner|first place|top \d+)\b/i;

const AUTHORITY_RE = /\b(led a team of|managed a team of|head(?:ed)? (?:the|a) (?:team|function|department)|line[- ]managed|direct reports?|hired and|owned the (?:entire|whole|full)|architected the (?:entire|whole|platform|system)|set the (?:technical )?(?:strategy|direction|vision)|defined the (?:company|organisation|organization)|drove (?:the )?organisation(?:al)?)\b/i;

const SCALE_INFLATION_RE = /\b(enterprise[- ]wide|company[- ]wide|organisation[- ]wide|organization[- ]wide|global(?:ly)?|firm[- ]wide|across (?:the )?(?:entire |whole )?(?:company|organisation|organization|enterprise|firm|business)|nationwide|worldwide|industry[- ]leading|market[- ]leading)\b/i;

const TITLE_RE = /\b(?:as (?:the |a |an )?)(senior|lead|principal|staff|chief|head of|director of|manager of|architect|vp of)\b/i;

/* Words that assert a measured result without a number backing it. These are
   allowed ONLY when the evidence itself asserts the same direction. */
const RESULT_CLAIM_RE = /\b(significantly|substantially|dramatically|drastically|considerably|majorly|greatly)\b/i;

const str = (v) => String(v == null ? '' : v);

function numbersIn(text) {
  return [...String(text).matchAll(DIGIT_TOKEN_RE)].map((m) => m[0].replace(/,/g, ''));
}

/* Ontology skills present in a string. Cached module-level for speed. */
let _skillUniverse = null;
function skillUniverse() {
  if (!_skillUniverse) _skillUniverse = allKnownSkills();
  return _skillUniverse;
}

function skillsIn(text) {
  const out = new Set();
  for (const s of skillUniverse()) if (skillPresent(text, s)) out.add(canonicalSkill(s));
  return out;
}

/**
 * Validate ONE generated sentence against ONE evidence record.
 *
 * @param {string} candidate
 * @param {object} evidence      EvidenceRecord (the ONLY permitted source)
 * @param {object} opts
 * @param {number} opts.ownershipCeiling  1..5 from the seniority register
 * @param {Set}    opts.globalPermittedSkills  document-wide skills (for cross-
 *                 bullet terminology alignment, e.g. saying "CI/CD" once when
 *                 the evidence says "GitLab pipelines" — still must be a skill
 *                 the candidate demonstrably has somewhere)
 * @returns {{ok:boolean, violations:Array, checked:number}}
 */
export function validateAgainstEvidence(candidate, evidence, {
  ownershipCeiling = 3, globalPermittedSkills = null, allowSemanticSkillAlignment = true,
} = {}) {
  const text = str(candidate).trim();
  const violations = [];
  const source = [
    evidence?.rawText, evidence?.object, evidence?.method, evidence?.scope,
    evidence?.outcome, evidence?.purpose, (evidence?.skillsDisplay || []).join(' '),
    evidence?.company, evidence?.role, evidence?.projectName, evidence?.techStack,
  ].filter(Boolean).join(' \u2022 ');

  if (!text) return { ok: false, violations: [{ code: 'empty', detail: 'Empty candidate.' }], checked: 0 };

  /* ---- 1. NUMBERS: the strictest rule in the system ---- */
  const permitted = new Set((evidence?.numericEvidence || []).map((n) => str(n.value)));
  /* Dates/years already present in the source are permitted verbatim. */
  for (const n of numbersIn(source)) permitted.add(n);
  for (const n of numbersIn(text)) {
    if (!permitted.has(n)) {
      violations.push({
        code: 'fabricated_number',
        severity: 'critical',
        detail: `Introduces the number "${n}" which appears nowhere in the candidate's own evidence.`,
        token: n,
      });
    }
  }

  /* ---- 2. TECHNOLOGIES ---- */
  const sourceSkills = skillsIn(source);
  for (const s of (evidence?.skills || [])) sourceSkills.add(canonicalSkill(s));
  const candidateSkills = skillsIn(text);
  for (const s of candidateSkills) {
    if (sourceSkills.has(s)) continue;
    /* Semantic alignment: the composer is permitted to name the canonical
       umbrella term for something the candidate demonstrably did — but only
       when that term is already somewhere in their own evidence graph. */
    if (allowSemanticSkillAlignment && globalPermittedSkills?.has(s)) continue;
    violations.push({
      code: 'fabricated_technology',
      severity: 'critical',
      detail: `Introduces "${s}", which the candidate's evidence never mentions.`,
      token: s,
    });
  }

  /* ---- 3. CREDENTIAL / AWARD SHAPES ---- */
  if (CREDENTIAL_RE.test(text) && !CREDENTIAL_RE.test(source)) {
    violations.push({
      code: 'fabricated_credential',
      severity: 'critical',
      detail: 'Introduces a certification, award, patent or promotion claim absent from the evidence.',
      token: (text.match(CREDENTIAL_RE) || [])[0] || '',
    });
  }

  /* ---- 4. AUTHORITY ESCALATION ---- */
  if (AUTHORITY_RE.test(text) && !AUTHORITY_RE.test(source)) {
    violations.push({
      code: 'fabricated_authority',
      severity: 'critical',
      detail: 'Claims leadership or architectural authority the evidence does not support.',
      token: (text.match(AUTHORITY_RE) || [])[0] || '',
    });
  }
  /* Seniority ceiling: an early-career candidate may not be written as an
     architect / definer of standards even with softer wording. */
  if (ownershipCeiling <= 2 && /\b(architected|established (?:the )?standards?|defined (?:the )?(?:approach|standard|framework)|set (?:the )?direction)\b/i.test(text)) {
    violations.push({
      code: 'seniority_inflation',
      severity: 'critical',
      detail: 'Uses authority language above the evidence-supported seniority for this candidate.',
    });
  }

  /* ---- 5. SCALE INFLATION ---- */
  if (SCALE_INFLATION_RE.test(text) && !SCALE_INFLATION_RE.test(source)) {
    violations.push({
      code: 'fabricated_scale',
      severity: 'critical',
      detail: 'Introduces an organisational scale claim the evidence does not state.',
      token: (text.match(SCALE_INFLATION_RE) || [])[0] || '',
    });
  }

  /* ---- 6. TITLE CLAIMS ---- */
  const titleHit = text.match(TITLE_RE);
  if (titleHit && !new RegExp(titleHit[1], 'i').test(source)) {
    violations.push({
      code: 'fabricated_title',
      severity: 'critical',
      detail: `Introduces the title claim "${titleHit[1]}" absent from the evidence.`,
    });
  }

  /* ---- 7. UNQUANTIFIED MAGNITUDE CLAIMS ---- */
  if (RESULT_CLAIM_RE.test(text) && !RESULT_CLAIM_RE.test(source)) {
    violations.push({
      code: 'unquantified_magnitude',
      severity: 'high',
      detail: 'Asserts the size of an improvement without evidence for the magnitude.',
      token: (text.match(RESULT_CLAIM_RE) || [])[0] || '',
    });
  }

  /* ---- 8. the shipped assist gate, reused verbatim ---- */
  const legacy = validateRewrite(text, {
    sourceText: source,
    facts: null,
    allowedSkills: [...sourceSkills, ...(globalPermittedSkills || [])],
  });
  if (!legacy.accepted) {
    for (const reason of legacy.reasons) {
      /* Vocabulary drift is expected in this layer (we deliberately restructure),
         so it is downgraded; every factual reason stays critical. */
      const isDrift = /replaces too much of the source content/.test(reason);
      violations.push({
        code: isDrift ? 'vocabulary_drift' : 'legacy_gate',
        severity: isDrift ? 'low' : 'critical',
        detail: reason,
      });
    }
  }

  const blocking = violations.filter((v) => v.severity === 'critical' || v.severity === 'high');
  return { ok: blocking.length === 0, violations, blocking, checked: 8 };
}

/**
 * Document-level sweep. Runs after assembly as a belt-and-braces check that no
 * unsupported claim survived — this is what the acceptance criterion
 * "UNSUPPORTED CLAIM COUNT MUST BE ZERO" is measured against.
 */
export function auditGeneratedDocument(generated = [], graph, { ownershipCeiling = 3 } = {}) {
  const findings = [];
  for (const item of generated) {
    const evidence = item.evidenceId ? graph.get(item.evidenceId) : item.evidence;
    if (!evidence) {
      findings.push({
        bulletId: item.id || '', code: 'untraceable_claim', severity: 'critical',
        detail: 'Generated content has no evidence record backing it.',
        text: str(item.text).slice(0, 120),
      });
      continue;
    }
    const v = validateAgainstEvidence(item.text, evidence, {
      ownershipCeiling, globalPermittedSkills: graph.permittedSkills,
    });
    for (const violation of v.violations) {
      if (violation.severity === 'low') continue;
      findings.push({ bulletId: item.id || '', ...violation, text: str(item.text).slice(0, 120) });
    }
  }
  return {
    version: TRUTH_VALIDATOR_VERSION,
    findings,
    unsupportedClaimCount: findings.filter((f) => f.severity === 'critical').length,
    ok: findings.every((f) => f.severity !== 'critical'),
  };
}

/** Every number in a document that cannot be traced to the evidence graph. */
export function findUntracedMetrics(texts = [], graph) {
  const permitted = new Set(graph?.permittedNumbers || []);
  const out = [];
  for (const t of texts) {
    for (const n of numbersIn(t)) {
      if (permitted.has(n)) continue;
      if (/^(19|20)\d{2}$/.test(n)) continue; // years
      out.push({ number: n, text: str(t).slice(0, 120) });
    }
  }
  return out;
}

export default {
  TRUTH_VALIDATOR_VERSION, validateAgainstEvidence, auditGeneratedDocument, findUntracedMetrics,
};
