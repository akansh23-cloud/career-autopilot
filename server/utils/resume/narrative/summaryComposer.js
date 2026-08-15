/* ============================================================
   SUMMARY COMPOSER (stage 17)
   ------------------------------------------------------------
   Generic summaries are the most obviously machine-written part
   of a resume, so this composer never has access to a persona
   template. It only ever assembles from:

     • the candidate's real role / role family
     • years computed from DATED experience (never estimated)
     • technologies that appear in achievement sentences
     • the intents their evidence actually demonstrates
     • verified-project / certification counts
     • the target role and its terminology (tailor mode)

   Structure is chosen per candidate from a seeded set of shapes,
   so two people in the same field do not receive the same
   sentence skeleton. Every candidate summary is validated against
   a synthetic evidence record built from these same facts, so the
   truth firewall applies to summaries exactly as it does to
   bullets.
   ============================================================ */
import { computeYears } from '../summaryCompiler.js';
import { vocabularyFor } from './domainVocabulary.js';
import { variationSeed, inferIntent } from './bulletComposer.js';
import { validateAgainstEvidence } from './truthValidator.js';
import { applySpellingConvention, technologyDisplayMap, isNamedTool } from './candidateIntelligence.js';
import { analyzePhraseQuality } from './phraseQuality.js';
import { templateSimilarity } from './naturalness.js';

export const SUMMARY_COMPOSER_VERSION = 'narrative-summary-composer-v1';

const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/\s+([,.;])/g, '$1').replace(/,\s*,/g, ',').trim();

function sentence(s) {
  const t = clean(s);
  if (!t) return '';
  const out = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(out) ? out : `${out}.`;
}

/* ------------------------------------------------------------------
   Slot enforcement.

   A structure is a sentence with holes in it. When a hole is empty the
   result is not a shorter sentence, it is a broken one: "Early-career
   engineer with project experience in." — a real string this composer
   shipped, because joinList() returns '' for an empty list and the
   template interpolated it after the preposition "in".

   The selection loop already intends to skip structures that cannot be
   filled ("a structure that cannot be filled is simply skipped"), but it
   only caught structures that THREW. Nothing threw. So required slots now
   throw, which turns that intent into behaviour.
   ------------------------------------------------------------------ */
class EmptySlot extends Error {}

/** Value for a slot the sentence cannot survive without. */
function req(value) {
  const v = typeof value === 'string' ? value.trim() : value;
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) {
    throw new EmptySlot('required slot empty');
  }
  return v;
}

/* Defence in depth: even a structure with no explicit req() must not emit a
   sentence that ends on a connector, or doubles its punctuation. This catches
   the next structure someone adds without reading the note above. */
const DANGLING = /\b(in|on|with|across|for|of|and|to|at|using|including|covering|spanning|combining|from|by)\s*[.,;:]\s*$/i;

function wellFormed(text) {
  const t = clean(text);
  if (!t) return false;
  if (DANGLING.test(t)) return false;
  if (/[,;:]\s*$/.test(t)) return false;
  /* "Engineer with  ." — a slot that collapsed to whitespace. */
  if (/\s{2,}\./.test(t)) return false;
  return true;
}

function joinList(items, { max = 4, conj = 'and' } = {}) {
  /* Case-insensitive dedupe, and drop any item that is contained in another
     ("kubernetes" alongside "Kubernetes", "analytics" alongside "Google
     Analytics") — both produce visibly machine-written lists. */
  const seen = new Map();
  for (const raw of items.filter(Boolean)) {
    const k = String(raw).toLowerCase();
    if (!seen.has(k)) seen.set(k, String(raw));
  }
  let list = [...seen.values()];
  list = list.filter((a) => !list.some((b) => b !== a && b.toLowerCase().includes(a.toLowerCase())));
  list = list.slice(0, max);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  /* When the items themselves contain "and", another "and" is unreadable. */
  if (list.some((x) => / and /.test(x))) return list.join('; ');
  if (list.length === 2) return `${list[0]} ${conj} ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} ${conj} ${list[list.length - 1]}`;
}

/* Intent → the phrase describing the WORK, not an adjective about the person. */
const INTENT_PHRASES = {
  automation: 'automating manual delivery steps',
  migration: 'migration and consolidation work',
  reliability: 'production stability and incident handling',
  security: 'security and compliance checks in the delivery path',
  performance: 'performance and runtime tuning',
  cost: 'cost and resource rationalisation',
  architecture: 'system and component design',
  data: 'data modelling and pipeline correctness',
  delivery: 'release and deployment work',
  leadership: 'mentoring and review of other engineers',
  troubleshooting: 'diagnosis of production issues',
  scale: 'work at production volume',
  operational_excellence: 'standardising how work is delivered',
  product_impact: 'shipping user-facing capability',
  analysis: 'analysis and reporting',
  compliance: 'audit and control evidence',
  stakeholder: 'working directly with business stakeholders',
  innovation: 'prototyping new approaches',
  research: 'experimental and research work',
  ownership: 'end-to-end ownership of running systems',
};

/* Summary prose never semicolon-splices. joinList falls back to "; " when an
   item already contains "and", which is right for a dense bullet and wrong
   for an opening sentence — "across delivery automation; build and release
   engineering" is visibly assembled. Here we simply say less instead. */
function joinProse(items, max) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return '';
  const wouldSplice = list.slice(0, max).some((x) => / and /.test(x));
  return joinList(list, { max: wouldSplice ? 1 : max });
}

/* Noun-phrase forms of the same intents, for slots that read as
   "across ___" or "in ___". "across automating manual delivery steps" is
   ungrammatical; "across delivery automation" is how a person writes it.
   Two registers for the same fact, chosen by sentence position. */
const INTENT_DOMAINS = {
  automation: 'process automation',
  migration: 'migration and consolidation',
  reliability: 'reliability',
  security: 'security and compliance',
  performance: 'performance improvement',
  cost: 'cost optimisation',
  architecture: 'design work',
  data: 'data quality',
  delivery: 'delivery',
  leadership: 'mentoring',
  troubleshooting: 'troubleshooting',
  scale: 'work at scale',
  operational_excellence: 'process standardisation',
  product_impact: 'product delivery',
  analysis: 'analysis and reporting',
  compliance: 'audit and controls',
  stakeholder: 'stakeholder engagement',
  innovation: 'prototyping',
  research: 'applied research',
  ownership: 'ownership of running work',
};

/* Technical role families get the specific engineering register. A marketing
   manager must never be described as working "across build and release
   engineering" — that is DevOps vocabulary leaking into a non-technical
   resume, and it is exactly the failure P2.9 warns about. Domain-neutral
   wording is the default; the specific phrasing is opt-in by role family. */
const TECHNICAL_FAMILIES = new Set([
  'devops', 'platform', 'sre', 'cloud', 'backend', 'frontend', 'fullstack',
  'data_engineering', 'data_science', 'machine_learning', 'security',
  'qa', 'mobile', 'embedded',
]);

const TECHNICAL_INTENT_DOMAINS = {
  automation: 'delivery automation',
  reliability: 'production reliability',
  delivery: 'build and release engineering',
  architecture: 'system design',
  data: 'data modelling and pipeline correctness',
  operational_excellence: 'delivery standardisation',
  scale: 'production-scale operations',
  troubleshooting: 'production troubleshooting',
  leadership: 'technical mentoring',
  ownership: 'system ownership',
  security: 'delivery security and compliance',
  performance: 'performance tuning',
};

/* The gerund register has the same leak risk: "release and deployment work"
   is DevOps phrasing and must not describe a marketing manager's day. */
const TECHNICAL_INTENT_PHRASES = {
  delivery: 'release and deployment work',
  automation: 'automating manual delivery steps',
  reliability: 'production stability and incident handling',
  scale: 'work at production volume',
  architecture: 'system and component design',
  ownership: 'end-to-end ownership of running systems',
};

const NEUTRAL_INTENT_PHRASES = {
  delivery: 'end-to-end delivery',
  automation: 'automating repetitive work',
  reliability: 'keeping delivery consistent',
  scale: 'work at volume',
  architecture: 'planning and structuring work',
  ownership: 'end-to-end ownership',
};

function intentPhrase(intent, roleFamily) {
  if (TECHNICAL_FAMILIES.has(String(roleFamily || '').toLowerCase())) {
    return TECHNICAL_INTENT_PHRASES[intent] || INTENT_PHRASES[intent] || '';
  }
  return NEUTRAL_INTENT_PHRASES[intent] || INTENT_PHRASES[intent] || '';
}

function intentDomain(intent, roleFamily) {
  if (TECHNICAL_FAMILIES.has(String(roleFamily || '').toLowerCase())) {
    return TECHNICAL_INTENT_DOMAINS[intent] || INTENT_DOMAINS[intent] || '';
  }
  return INTENT_DOMAINS[intent] || '';
}

/**
 * Build the fact set. Everything here is derived, never assumed.
 */
export function collectSummaryFacts(doc, graph, intelligence, { jobIntel = null } = {}) {
  const yearsInfo = computeYears(doc);
  const achievements = graph.records.filter((r) => r.type === 'achievement' && r.enabled);

  /* Named tools only: practices ("CI/CD", "ETL") describe the work and are
     expressed as intent phrases instead of being listed as tools. */
  const displayFor = technologyDisplayMap(graph, doc);
  const technologies = (intelligence.coreTechnologies || [])
    .map((t) => t.skill)
    .filter(isNamedTool)
    .slice(0, 8);
  const techDisplay = technologies.map((t) => displayFor.get(t) || t);

  const intentCounts = new Map();
  for (const r of achievements) {
    const { intent } = inferIntent(r);
    intentCounts.set(intent, (intentCounts.get(intent) || 0) + 1);
  }
  const topIntents = [...intentCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([intent]) => intent);

  const currentRole = doc.experience.find((e) => e.current && e.enabled) || doc.experience.find((e) => e.enabled);
  const domains = [...new Set(achievements.map((r) => r.company).filter(Boolean))];

  return {
    /* The candidate's OWN current title leads. A target role they have not
       held is never presented as if it were theirs. */
    roleTitle: currentRole?.role || doc.targetRole || doc.contact?.title || (jobIntel?.roleIdentity?.canonicalRole) || '',
    targetTitle: (jobIntel?.roleIdentity?.title) || doc.targetRole || '',
    actualRole: currentRole?.role || doc.contact?.title || '',
    roleFamilyLabel: vocabularyFor(intelligence.roleFamily, { seniority: intelligence.seniority }).label,
    years: yearsInfo.years || 0,
    yearsKnown: !!yearsInfo.years,
    technologies: techDisplay,
    topIntents,
    intentPhrases: topIntents.map((i) => intentPhrase(i, intelligence?.roleFamily)).filter(Boolean),
    intentDomains: topIntents.map((i) => intentDomain(i, intelligence?.roleFamily)).filter(Boolean),
    verifiedProjects: doc.projects.filter((p) => p.verified && p.enabled).length,
    certifications: doc.certifications.filter((c) => c.enabled).map((c) => c.text).slice(0, 3),
    employers: domains.slice(0, 3),
    seniority: intelligence.seniority,
    education: doc.education.filter((e) => e.enabled).map((e) => e.degree).filter(Boolean).slice(0, 1),
    hasExperience: achievements.length > 0,
    /* P2.17 — the single strongest QUANTIFIED achievement, carried with its
       own metric and its own action. Reusing the metric's home clause is what
       keeps metric binding intact: the number never travels to a different
       claim, because the claim travels with it. */
    headlineAchievement: strongestAchievement(achievements),
  };
}

/* The most summary-worthy achievement: quantified, recent, and specific.
   Returns null rather than guessing when nothing qualifies — a summary with
   no metric is better than a summary with a borrowed one. */
function strongestAchievement(achievements) {
  const scored = achievements
    .filter((r) => (r.numericEvidence || []).length && r.action && r.object)
    .map((r) => {
      const metric = (r.numericEvidence || [])
        .slice()
        .sort((a, b) => (b.unit === '%' ? 1 : 0) - (a.unit === '%' ? 1 : 0))[0];
      const hasOutcome = !!r.outcome;
      const score = (metric?.unit === '%' ? 2 : 1) + (hasOutcome ? 2 : 0) + (r.current ? 1 : 0);
      return {
        action: r.action,
        object: r.object,
        outcome: r.outcome || '',
        outcomeVerb: r.outcomeVerb || '',
        metric: metric?.raw || '',
        metricUnit: metric?.unit || '',
        evidenceId: r.id,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

/* ------------------------------------------------------------------ */
/* Structures — seeded per candidate so no two people get the same one */
/* ------------------------------------------------------------------ */
const STRUCTURES = [
  /* S1: role → what they work across → what they have done */
  (f) => [
    sentence(`${f.roleTitle || f.roleFamilyLabel}${f.yearsKnown && f.years >= 1 ? ` with ${f.years}+ ${f.years === 1 ? 'year' : 'years'}` : ''} working across ${req(joinList(f.technologies, { max: 4 }))}`),
    f.intentPhrases.length ? sentence(`Experience covers ${joinProse(f.intentPhrases, 2)}`) : '',
  ].filter(Boolean).join(' '),

  /* S2: work-first — leads with what they actually do */
  (f) => [
    sentence(`${f.roleTitle || f.roleFamilyLabel} focused on ${req(joinProse(f.intentPhrases, 2))}${f.technologies.length ? ` across ${joinList(f.technologies, { max: 3 })}` : ''}`),
    f.yearsKnown && f.years >= 2 ? sentence(`${f.years} years across ${f.employers.length ? joinList(f.employers, { max: 2 }) : 'delivery teams'}`) : '',
  ].filter(Boolean).join(' '),

  /* S3: technology-anchored */
  (f) => [
    sentence(`${f.roleTitle || f.roleFamilyLabel} focused on ${req(joinList(f.technologies, { max: 3 }))}${f.yearsKnown && f.years >= 1 ? `, ${f.years}+ years in delivery roles` : ''}`),
    f.intentPhrases.length ? sentence(`Recent work has centred on ${joinProse(f.intentPhrases, 2)}`) : '',
  ].filter(Boolean).join(' '),

  /* S4: outcome-shaped, still factual */
  (f) => [
    f.intentPhrases.length
      ? sentence(`${f.roleTitle || f.roleFamilyLabel} with hands-on ${req(joinProse(f.intentPhrases, 2))}`)
      : sentence(`${f.roleTitle || f.roleFamilyLabel}`),
    f.technologies.length ? sentence(`Works day to day with ${joinList(f.technologies, { max: 4 })}`) : '',
  ].filter(Boolean).join(' '),
];

/* S5–S7: capability sentence + a real, evidence-bound achievement sentence.
   This is the shape that separates a mechanical summary from one a human
   would write: it says what the person does, then proves it once. */
const OUTCOME_STRUCTURES = [
  /* Identity + domain + tooling, then one proven outcome. This is the shape
     the brief's target example uses, and the shape a human writes. */
  (f) => {
    const a = f.headlineAchievement;
    if (!a) return '';
    const domain = joinProse(f.intentDomains, 2);
    return [
      sentence(`${f.roleTitle || f.roleFamilyLabel}${f.yearsKnown && f.years >= 1 ? ` with ${f.years} ${f.years === 1 ? 'year' : 'years'} of experience` : ''}${domain ? ` across ${domain}` : ''}${f.technologies.length ? `, including ${joinList(f.technologies, { max: 4 })}` : ''}`),
      achievementSentence(a),
    ].filter(Boolean).join(' ');
  },
  (f) => {
    const a = f.headlineAchievement;
    if (!a) return '';
    const domain = joinProse(f.intentDomains, 1);
    return [
      sentence(`${f.roleTitle || f.roleFamilyLabel} working across ${joinList(f.technologies, { max: 4 })}${domain ? `, with a focus on ${domain}` : ''}`),
      achievementSentence(a),
    ].filter(Boolean).join(' ');
  },
];

/* Renders the headline achievement as its own sentence, keeping the metric
   attached to the action that produced it. The metric is never re-pointed at
   a different outcome — the clause it came from travels with it. */
function achievementSentence(a) {
  if (!a || !a.action || !a.object) return '';
  const verb = a.action.charAt(0).toUpperCase() + a.action.slice(1);
  if (a.outcome) {
    const link = a.outcomeVerb ? `, ${a.outcomeVerb}` : ', reducing';
    return sentence(`${verb} ${a.object}${link} ${a.outcome}`);
  }
  return sentence(`${verb} ${a.object}`);
}

/* Student / early-career shapes never imply years or authority. */
const STUDENT_STRUCTURES = [
  (f) => [
    sentence(`${f.education.length ? `${f.education[0]} graduate` : 'Graduate'} building with ${req(joinList(f.technologies, { max: 4 }))}`),
    f.intentPhrases.length ? sentence(`Project work covers ${joinProse(f.intentPhrases, 2)}`) : '',
  ].filter(Boolean).join(' '),
  (f) => [
    sentence(`${f.roleTitle || 'Early-career engineer'} with project experience in ${req(joinList(f.technologies, { max: 3 }))}`),
    f.verifiedProjects ? sentence(`${f.verifiedProjects} verified ${f.verifiedProjects === 1 ? 'project' : 'projects'} on record`) : '',
  ].filter(Boolean).join(' '),

  /* The shape that works when we know almost nothing: education and intent
     only. Without this, a profile with no technologies has no student
     structure left and would fall through to no summary at all. */
  (f) => [
    sentence(`${f.education.length ? `${f.education[0]} graduate` : 'Early-career candidate'}${f.roleTitle ? ` targeting ${f.roleTitle} roles` : ''}`),
    f.intentPhrases.length ? sentence(`Project work covers ${joinProse(f.intentPhrases, 2)}`)
      : (f.verifiedProjects ? sentence(`${f.verifiedProjects} verified ${f.verifiedProjects === 1 ? 'project' : 'projects'} on record`) : ''),
  ].filter(Boolean).join(' '),
];

/* ------------------------------------------------------------------ */
export function composeSummary(doc, graph, intelligence, {
  jobIntel = null, userKey = 'anon', voice = null, maxChars = 420,
  aiCandidates = [], maxCandidates = 4, forbiddenTerms = null,
} = {}) {
  const facts = collectSummaryFacts(doc, graph, intelligence, { jobIntel });

  /* A synthetic evidence record for the summary: the union of everything the
     graph permits. The truth firewall then applies unchanged. */
  const summaryEvidence = {
    id: 'ev_summary',
    rawText: [
      facts.roleTitle, facts.actualRole, facts.roleFamilyLabel,
      facts.technologies.join(' '), facts.intentPhrases.join(' '),
      facts.employers.join(' '), facts.certifications.join(' '),
      facts.education.join(' '),
      facts.yearsKnown ? `${facts.years} years` : '',
      facts.verifiedProjects ? `${facts.verifiedProjects} verified projects` : '',
      /* The headline achievement's own words. Without this the truth gate
         rejects the summary structures that quote it — correctly, because
         the metric would otherwise be untraceable from the summary's
         evidence record. The fix is to give the record the evidence, never
         to loosen the gate. */
      facts.headlineAchievement
        ? [facts.headlineAchievement.action, facts.headlineAchievement.object,
          facts.headlineAchievement.outcomeVerb, facts.headlineAchievement.outcome].filter(Boolean).join(' ')
        : '',
    ].filter(Boolean).join(' '),
    skills: [...graph.permittedSkills],
    skillsDisplay: facts.technologies,
    numericEvidence: [
      ...(facts.yearsKnown ? [{ value: String(facts.years), raw: `${facts.years}`, unit: 'years' }] : []),
      ...(facts.verifiedProjects ? [{ value: String(facts.verifiedProjects), raw: String(facts.verifiedProjects), unit: '' }] : []),
      /* ONLY the headline achievement's metric, and only together with the
         clause it belongs to. The number cannot be re-pointed at a different
         claim because the claim travels with it. */
      ...(facts.headlineAchievement?.metric
        ? [{
          value: String(facts.headlineAchievement.metric).replace(/[^0-9.]/g, ''),
          raw: facts.headlineAchievement.metric,
          unit: facts.headlineAchievement.metricUnit || '',
          clause: facts.headlineAchievement.outcome || '',
        }]
        : []),
    ],
    verificationLevel: 'profile_confirmed',
    tense: 'present',
  };

  const seed = variationSeed(userKey, doc.id || 'doc', 'summary');
  /* Outcome-carrying shapes lead when there is a real quantified achievement
     to carry. Without one they are skipped entirely rather than padded. */
  const pool = (intelligence.seniority === 'student' || !facts.hasExperience)
    ? STUDENT_STRUCTURES
    : (facts.headlineAchievement ? [...OUTCOME_STRUCTURES, ...STRUCTURES] : STRUCTURES);

  const raw = [];
  for (let i = 0; i < pool.length; i += 1) {
    const fn = pool[(seed + i) % pool.length];
    try {
      const text = fn(facts);
      /* Both gates matter: req() rejects a structure whose slot was empty, and
         wellFormed() rejects one that produced a dangling clause anyway. */
      if (text && wellFormed(text)) {
        raw.push({ text, source: 'deterministic', structureIndex: (seed + i) % pool.length });
      }
    } catch { /* a structure that cannot be filled is simply skipped */ }
  }
  for (const ai of aiCandidates) raw.push({ text: sentence(ai.text), source: 'ai' });

  /* Tailor mode: prefer the job's own canonical role wording where it is the
     candidate's actual role family — never a title they have not held. */
  if (jobIntel && facts.roleTitle) {
    /* Case-insensitive throughout: the JD writes "kubernetes", the candidate
       writes "Kubernetes", and listing both is the clearest possible tell that
       a machine assembled the sentence. */
    const techLower = new Set(facts.technologies.map((t) => t.toLowerCase()));
    const targetTerms = (jobIntel.prioritySkills || [])
      .filter((p) => p.tier === 'mandatory')
      .map((p) => facts.technologies.find((t) => t.toLowerCase() === String(p.skill).toLowerCase()))
      .filter(Boolean);
    const targetLower = new Set(targetTerms.map((t) => t.toLowerCase()));
    if (targetTerms.length && techLower.size) {
      raw.push({
        text: [
          /* One list, one conjunction — two joined lists produce "A, B and C and D". */
        sentence(`${facts.roleTitle} working across ${joinList([
          ...targetTerms,
          ...facts.technologies.filter((t) => !targetLower.has(t.toLowerCase())),
        ], { max: 4 })}`),
          facts.intentPhrases.length ? sentence(`Experience covers ${joinList(facts.intentPhrases, { max: 2 })}`) : '',
        ].filter(Boolean).join(' '),
        source: 'deterministic',
        structureIndex: -1,
      });
    }
  }

  /* Deduplicate, clip, validate, score. */
  const seen = new Set();
  const candidates = [];
  for (const c of raw) {
    let text = applySpellingConvention(clean(c.text), voice);
    if (!text) continue;
    if (text.length > maxChars) {
      /* Sentence-safe clip. */
      const parts = text.split(/(?<=\.)\s+/);
      text = '';
      for (const p of parts) {
        if ((text + p).length > maxChars) break;
        text += (text ? ' ' : '') + p;
      }
      if (!text) text = `${parts[0].slice(0, maxChars - 1)}.`;
    }
    const key = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const truth = validateAgainstEvidence(text, summaryEvidence, {
      kind: 'summary',
      ownershipCeiling: intelligence.ownershipCeiling,
      globalPermittedSkills: graph.permittedSkills,
    });
    if (!truth.ok) continue;

    /* Defence in depth: an unsupported JD term must not reach the summary. */
    if (forbiddenTerms && forbiddenTerms.size) {
      let leaked = false;
      for (const term of forbiddenTerms) {
        const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(text)) { leaked = true; break; }
      }
      if (leaked) continue;
    }

    const pq = analyzePhraseQuality(text, { technologies: facts.technologies });
    const gen = templateSimilarity(text);
    const words = text.split(/\s+/).length;
    const score = Number((
      pq.score * 40
      + (1 - gen.similarity) * 25
      + Math.min(1, facts.technologies.filter((t) => text.toLowerCase().includes(t.toLowerCase())).length / 3) * 20
      + (words >= 18 && words <= 60 ? 15 : 8)
      /* A summary that proves a claim with the candidate's own number beats
         one that only lists technologies. Only a metric that is actually in
         the evidence can earn this, because the text had to pass the truth
         gate above to get here. */
      + (facts.headlineAchievement?.metric
        && text.includes(facts.headlineAchievement.metric) ? 18 : 0)
    ).toFixed(2));

    /* Carry the named verdicts so the engine's audit stage does not re-check
       from NOT_RUN and revert a summary that already passed here. */
    candidates.push({
      text, source: c.source, score, clicheHits: pq.hits.length,
      templateSimilarity: gen.similarity, words, verdicts: truth.verdicts,
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
  /* Depth bounds how many summary alternatives are carried forward. */
  if (candidates.length > maxCandidates) candidates.length = maxCandidates;

  return {
    version: SUMMARY_COMPOSER_VERSION,
    ok: candidates.length > 0,
    facts,
    candidates,
    best: candidates[0] || null,
    evidenceId: summaryEvidence.id,
    _evidence: summaryEvidence,
  };
}

export default { SUMMARY_COMPOSER_VERSION, composeSummary, collectSummaryFacts };
