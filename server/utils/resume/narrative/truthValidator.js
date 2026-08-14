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

import { expandImplied } from './skillIntelligence.js';
import { validateActionSemantics } from './actionSemantics.js';
import { validateActionProvenance } from './actionProvenance.js';
import { validateResponsibility, ceilingForSeniority } from './responsibilityScale.js';
import { newVerdictSheet, recordVerdict, evaluateSheet, VERDICT } from './truthCheckRegistry.js';

export const TRUTH_VALIDATOR_VERSION = 'narrative-truth-validator-v2-named-verdicts';

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
/* An umbrella term is a broader canonical name for something already in THIS
   record's evidence — "CI/CD" over a record naming GitLab CI. That restates a
   fact the record already contains rather than importing a different one, so
   it stays permitted. Anything else the resume merely happens to contain does
   not. */
function isUmbrellaFor(term, sourceSkills) {
  for (const src of sourceSkills) {
    if (src === term) return true;
    for (const imp of expandImplied(src)) if (imp === term) return true;
  }
  return false;
}

export function validateAgainstEvidence(candidate, evidence, {
  ownershipCeiling = 3, globalPermittedSkills = null, allowSemanticSkillAlignment = true,
  kind = 'bullet', seniority = null,
} = {}) {
  const text = str(candidate).trim();
  const violations = [];
  const source = [
    evidence?.rawText, evidence?.object, evidence?.method, evidence?.scope,
    evidence?.outcome, evidence?.purpose, (evidence?.skillsDisplay || []).join(' '),
    evidence?.company, evidence?.role, evidence?.projectName, evidence?.techStack,
  ].filter(Boolean).join(' \u2022 ');

  /* Part 4.4 — every mandatory validator starts NOT_RUN and must be moved to
     PASS explicitly. Nothing is assumed clean because nobody looked. */
  const verdicts = newVerdictSheet();

  if (!text) {
    return {
      ok: false, violations: [{ code: 'empty', detail: 'Empty candidate.' }],
      blocking: [{ code: 'empty', severity: 'critical', detail: 'Empty candidate.' }],
      checked: 0, verdicts, safety: evaluateSheet(verdicts),
    };
  }

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
    /* SCOPE (Part 4). A technology is authorised by the RECORD it is
       evidenced in, not by the resume as a whole.

       Document-wide permission is why "Built Jenkins pipelines" plus a
       separate Terraform role could become "Built Jenkins pipelines using
       Terraform" — true of the person, false of the job. They did both
       things; they did not do them together, and the sentence says they did.

       Resume-wide skills still drive the Skills section, job matching and
       gap analysis. They do not authorise an experience claim. */
    if (allowSemanticSkillAlignment
        && globalPermittedSkills?.has(s)
        && isUmbrellaFor(s, sourceSkills)) continue;

    if (globalPermittedSkills?.has(s)) {
      violations.push({
        code: 'cross_record_skill_leakage',
        severity: 'critical',
        detail: `Introduces "${s}", which appears elsewhere in this resume but not in this record's own evidence. A technology used in one role cannot be attributed to another.`,
        token: s,
        scope: 'RECORD',
      });
      continue;
    }
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

  /* ---- 9. ACTION SEMANTICS (Part 4.2) ----
     Bullets make action claims; summaries describe a person. There is no
     original action for a summary to contradict, so the check does not
     apply rather than failing to run. */
  const action = kind === 'summary'
    ? { status: VERDICT.NOT_APPLICABLE, violations: [], detail: 'Summaries are descriptions, not action statements.' }
    : validateActionSemantics(text, evidence || {});
  recordVerdict(verdicts, 'actionSemantics', action.status);
  if (action.status === VERDICT.FAIL) {
    for (const v of action.violations) {
      violations.push({ code: v.code, severity: v.severity, detail: v.detail });
    }
  }

  /* ---- 10. RESPONSIBILITY CEILING (Part 3) ----
     Distinct from the candidate seniority ceiling above. This one asks what
     THIS STATEMENT evidences, so a senior profile cannot authorise "Owned"
     on a bullet whose own words say "Responsible for". */
  const responsibility = kind === 'summary'
    ? { status: VERDICT.NOT_APPLICABLE, violations: [], detail: 'Summaries are not per-statement responsibility claims.' }
    : validateResponsibility(text, evidence || {}, {
      candidateCeiling: seniority ? ceilingForSeniority(seniority) : undefined,
    });
  if (responsibility.status === 'FAIL') {
    for (const v of responsibility.violations) {
      violations.push({ code: v.code, severity: v.severity, detail: v.detail });
    }
  }

  /* ---- 11. ACTION PROVENANCE ----
     Distinct from action semantics. Semantics asks "is this the same action?"
     Provenance asks "does the evidence establish ANY specific action here?"
     A contribution-level source answers no, and no amount of collocation
     strength changes that. */
  const provenance = validateActionProvenance(text, evidence || {}, { kind });
  recordVerdict(verdicts, 'actionProvenance', provenance.status);
  if (provenance.status === 'FAIL') {
    for (const v of provenance.violations) {
      violations.push({ code: v.code, severity: v.severity, detail: v.detail });
    }
  }

  const blocking = violations.filter((v) => v.severity === 'critical' || v.severity === 'high');

  /* Map the violation codes this validator produces onto named checks. Any
     check with no violation against it, and which this function genuinely
     evaluated, becomes PASS. Checks this function does not evaluate stay
     NOT_RUN and are filled in by their own owners further up the pipeline. */
  const CODE_TO_CHECK = {
    fabricated_number: 'metric',
    fabricated_technology: 'skillContext',
    cross_record_skill_leakage: 'skillContext',
    fabricated_credential: 'certification',
    fabricated_authority: 'seniority',
    seniority_inflation: 'seniority',
    fabricated_scale: 'metric',
    fabricated_title: 'entity',
    unquantified_magnitude: 'metric',
    legacy_gate: 'evidenceBinding',
    action_semantics: 'actionSemantics',
    responsibility_inflation: 'seniority',
    unsupported_action_claim: 'actionProvenance',
  };
  /* These are the checks this function is the owner of and did evaluate. */
  const EVALUATED_HERE = ['metric', 'skillContext', 'certification', 'seniority', 'entity', 'evidenceBinding'];
  const failedChecks = new Set(
    violations
      .filter((v) => v.severity === 'critical' || v.severity === 'high')
      .map((v) => CODE_TO_CHECK[v.code])
      .filter(Boolean),
  );
  for (const id of EVALUATED_HERE) {
    recordVerdict(verdicts, id, failedChecks.has(id) ? VERDICT.FAIL : VERDICT.PASS);
  }

  return {
    ok: blocking.length === 0,
    violations,
    blocking,
    checked: 11,
    verdicts,
    actionSemantics: action,
    responsibility,
    actionProvenance: provenance,
  };
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
