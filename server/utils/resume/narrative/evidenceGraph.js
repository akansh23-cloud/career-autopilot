/* ============================================================
   CANDIDATE EVIDENCE GRAPH — Narrative Intelligence stage 1
   ------------------------------------------------------------
   Every sentence the narrative layer ever emits must trace back
   to an EvidenceRecord created here. The graph is assembled from
   candidate-OWNED sources only:

     • the working ResumeDocument (experience / project bullets)
     • the Master Career Profile (profile, verified submissions,
       verified skills, GitHub-proven skills)
     • certifications, achievements, education, patents
     • user-entered metrics already present in the text

   NOTHING external ever becomes an EvidenceRecord. External
   research produces CONTEXT (see externalContext.js) which can
   change *vocabulary*, never *claims*.

   An EvidenceRecord is a parsed, structured view of one claim:

     { id, type, source, sourceId, company, role, section,
       skills[], action, actionBase, object, method, scope,
       outcome, outcomeVerb, numericEvidence[], rawText,
       verificationLevel, confidence, current, tense }

   The parse is deterministic and conservative: a field is only
   populated when it is literally recoverable from the candidate's
   own words. Empty is always safer than guessed.
   ============================================================ */
import { normalizeResumeDocument, collectBullets, PROVENANCE } from '../resumeDocument.js';
import { canonicalSkill, allKnownSkills, toCanonicalSet } from '../skillOntology.js';
import { skillPresent, termsForSkill } from '../skillMatcher.js';
import { verbInfo } from '../grammarLibrary.js';
import { parseResumeDate } from '../dateEngine.js';

export const EVIDENCE_GRAPH_VERSION = 'evidence-graph-v1';

/* Verification ladder. Only the top two may support a strong ownership claim. */
export const VERIFICATION_LEVEL = Object.freeze({
  VERIFIED: 'verified',            // server-verified project / evidence id
  PROFILE_CONFIRMED: 'profile_confirmed',
  USER_PROVIDED: 'user_provided',  // typed into Resume OS
  IMPORTED_UNCONFIRMED: 'imported_unconfirmed',
});

const CONFIDENCE = Object.freeze({
  verified: 1.0,
  profile_confirmed: 0.9,
  user_provided: 0.8,
  imported_unconfirmed: 0.55,
});

const str = (v, n = 400) => String(v == null ? '' : v).trim().slice(0, n);
const arr = (v) => (Array.isArray(v) ? v : []);

/* ------------------------------------------------------------------ */
/* Numeric evidence — the single most abused field in resume AI.       */
/* We record every number the candidate actually wrote, with its unit  */
/* and the span it came from, so the validator can prove provenance.   */
/* ------------------------------------------------------------------ */
const NUMERIC_RE = /(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s*(%|percent|x|×|k|m|bn?|tb|gb|mb|ms|sec(?:onds?)?|s\b|min(?:utes?)?|hrs?|hours?|days?|weeks?|months?|years?|yrs?|users?|customers?|records?|requests?|rps|qps|tps|people|members?|engineers?|teams?|clients?|₹|\$|usd|inr|eur|£)?/gi;

export function extractNumericEvidence(text) {
  const out = [];
  const src = String(text || '');
  for (const m of src.matchAll(NUMERIC_RE)) {
    const value = m[1];
    const unit = (m[2] || '').toLowerCase();
    /* Bare years (2019, 2024) are dates, not achievement metrics. */
    if (!unit && /^(19|20)\d{2}$/.test(value.replace(/,/g, ''))) continue;
    out.push({
      raw: m[0].trim(),
      value: value.replace(/,/g, ''),
      unit,
      index: m.index,
      /* the clause this number lives in — used when a metric is re-rendered */
      clause: clauseAround(src, m.index),
    });
  }
  return out.slice(0, 12);
}

function clauseAround(text, index) {
  const before = text.lastIndexOf(',', index);
  const afterComma = text.indexOf(',', index);
  const afterStop = text.search(/[.;]/) >= 0 ? text.indexOf('.', index) : -1;
  const start = before === -1 ? 0 : before + 1;
  const ends = [afterComma, afterStop].filter((x) => x > index);
  const end = ends.length ? Math.min(...ends) : text.length;
  return text.slice(start, end).trim();
}

/* ------------------------------------------------------------------ */
/* Sentence anatomy parse                                              */
/* ------------------------------------------------------------------ */
const OUTCOME_LEAD = /(?:,\s*|\s+—\s*|\s+-\s+)(reducing|cutting|improving|increasing|saving|boosting|lowering|eliminating|removing|shortening|accelerating|enabling|allowing|supporting|resulting in|leading to|which reduced|which improved|which cut|so that)\s+([^.;]+)/i;
const METHOD_LEAD = /\b(using|via|through|with|by leveraging|built on|based on|on top of)\s+([^,.;]{3,90})/i;
const SCOPE_LEAD = /\b(?:across|spanning|covering|for|serving|over)\s+((?:\d[\d,]*\s+)?[a-z][\w\s/&+-]{2,60})/i;
const PURPOSE_LEAD = /\b(?:to|in order to)\s+([a-z][^,.;]{4,80})/i;

/* Weak/vague openers we detect but never silently delete — they mark the
   evidence unit as low-specificity so the composer knows to work harder. */
const WEAK_OPENERS = [
  'responsible for', 'worked on', 'helped with', 'helped to', 'involved in',
  'assisted with', 'participated in', 'tasked with', 'duties included',
  'exposure to', 'familiar with', 'part of', 'contributed to the',
];

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'with', 'by', 'at', 'as', 'from', 'that', 'which', 'into', 'across', 'over', 'under']);

/* Irregular pasts and -ed forms: the shapes a resume verb actually takes. */
const IRREGULAR_PAST = /^(built|rebuilt|led|ran|wrote|rewrote|made|remade|drove|set|reset|took|retook|brought|kept|held|sent|met|dealt|grew|shipped|spent|left|paid|began|chose|found|gave|got|went|had|knew|saw|taught|told|won|cut|put|read|ran|sold|built|broke|caught|thought|brought|understood|oversaw|rebuilt|shrank|split|spread|stood|struck|swept|withdrew)$/;
const VERB_SHAPED = new RegExp(`(?:ed|ised|ized)$|${IRREGULAR_PAST.source.slice(1, -1)}`);

/* First word, if it looks like an action verb, is the action. */
function parseLeadAction(text) {
  const t = String(text || '').trim();
  const weak = WEAK_OPENERS.find((w) => t.toLowerCase().startsWith(w));
  if (weak) {
    /* "Responsible for managing X" -> action = managing (gerund) */
    const rest = t.slice(weak.length).trim().replace(/^(the|a|an)\s+/i, '');
    const g = rest.match(/^(\w+ing)\b/);
    /* "-ing" is not proof of a verb: "Worked on a Spring Boot service" starts
       with a capitalised proper noun that happens to end in -ing. Only a
       dictionary-known verb, in lowercase, is accepted as the action. */
    const gInfo = g ? (verbInfo(g[1]) || verbInfo(g[1].replace(/ing$/i, '')) || verbInfo(g[1].replace(/ing$/i, 'e'))) : null;
    if (g && gInfo) {
      return { action: g[1].toLowerCase(), base: gInfo.base, weakOpener: weak, remainder: rest.slice(g[0].length).trim(), verbKnown: true };
    }
    return { action: '', base: '', weakOpener: weak, remainder: rest };
  }
  const m = t.match(/^([A-Za-z][\w-]*)\b\s*(.*)$/s);
  if (!m) return { action: '', base: '', weakOpener: '', remainder: t };
  const word = m[1].toLowerCase();
  const info = verbInfo(word);
  if (info) return { action: word, base: info.base, weakOpener: '', remainder: m[2].trim(), verbKnown: true };
  /* The grammar dictionary is finite; the candidate's vocabulary is not.
     An unknown first word is accepted as the action ONLY when it is
     unambiguously verb-shaped, so "Various tasks…" is never treated as a verb
     while "Rebuilt…", "Cut…" and "Wrote…" are kept as the candidate wrote them. */
  if (VERB_SHAPED.test(word) && m[2].trim()) {
    return { action: word, base: word, weakOpener: '', remainder: m[2].trim(), verbKnown: false };
  }
  return { action: '', base: '', weakOpener: '', remainder: t };
}

/* A clause span stops at the next connective. Without this, "across OpenShift
   environments using Helm" yields a scope that swallows the method. */
function trimClause(span) {
  let t = String(span || '');
  const cut = [
    t.search(/\s+(?:using|via|through|with|by leveraging|built on|based on)\s+/i),
    t.search(/\s+(?:across|spanning|covering|serving)\s+/i),
    t.search(/\s+(?:to|in order to)\s+/i),
    t.search(OUTCOME_LEAD),
  ].filter((x) => x > 0);
  if (cut.length) t = t.slice(0, Math.min(...cut));
  return t.replace(/[.;,\s]+$/, '').trim().slice(0, 90);
}

/* Past vs present, read off the candidate's own leading verb. */
function detectTense(lead) {
  const w = String(lead.action || '').toLowerCase();
  if (!w) return '';
  if (/ing$/.test(w)) return 'present';
  const info = verbInfo(w);
  if (info && info.base && info.base.toLowerCase() === w) return 'present';
  if (/ed$/.test(w)) return 'past';
  if (IRREGULAR_PAST.test(w)) return 'past';
  return /^(?:manage|build|lead|run|own|maintain|support|develop|design|deliver|write|handle|operate|automate|monitor)s?$/.test(w) ? 'present' : '';
}

/* The object is the noun phrase directly governed by the action, stopping at
   the first method/scope/outcome/purpose boundary. */
function parseObject(remainder) {
  let o = String(remainder || '').trim();
  const boundaries = [
    o.search(OUTCOME_LEAD),
    o.search(METHOD_LEAD),
    o.search(/\b(?:across|spanning|covering|serving)\b/i),
    o.search(/\b(?:in order to)\b/i),
    o.indexOf(';'),
  ].filter((x) => x > 0);
  if (boundaries.length) o = o.slice(0, Math.min(...boundaries));
  o = o.replace(/[,.;:\s]+$/, '')
    /* vague quantifiers carry no information and corrupt every downstream
       sentence they appear in — they are dropped, not replaced. */
    .replace(/^\s*(?:various|numerous|several|multiple|different|many|some)\s+/i, '')
    .replace(/^\s*(?:tasks?|activities|work|things?|items?|duties)\s+(?:related to|around|on|for)\s+/i, '')
    .trim();
  return o.slice(0, 180);
}

/* A purpose clause that merely restates the object adds nothing and produces
   sentences like "X to X". It is discarded rather than rendered. */
function purposeOf(match, object) {
  if (!match) return '';
  const p = str(match[1], 120).replace(/[.;,]+$/, '').trim();
  if (!p) return '';
  const o = String(object || '').toLowerCase();
  const pl = p.toLowerCase();
  if (o && (o.includes(pl) || pl.includes(o))) return '';
  return p;
}

/* How the candidate actually wrote this technology in this sentence. Aliases
   are searched too, so the surface reflects the real match — which is what
   lets a spurious alias hit ("js" inside "Node.js") be detected and dropped. */
function surfaceForm(text, skill) {
  for (const term of termsForSkill(skill)) {
    const esc = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = String(text).match(new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, 'i'));
    if (m) return m[0];
  }
  return '';
}

/* Canonical-deduped display list; a skill that is a substring of another
   ("analytics" inside "google analytics") is dropped so generated sentences
   never read "using analytics and google analytics". */
function dedupeSurfaces(skills, surfaces) {
  const pairs = skills.map((s, i) => ({ canonical: canonicalSkill(s), display: surfaces[i] || s }));
  const seen = new Map();
  for (const p of pairs) if (!seen.has(p.canonical)) seen.set(p.canonical, p.display);
  const out = [...seen.values()];
  return out.filter((a) => !out.some((b) => b !== a && b.toLowerCase().includes(a.toLowerCase())));
}

export function parseEvidenceText(text, { skillPool = null } = {}) {
  const raw = String(text || '').trim();
  const lead = parseLeadAction(raw);
  /* Clause extraction runs on the text AFTER the weak opener. Otherwise the
     "for" inside "Responsible for X" is read as a scope marker and swallows
     the object. */
  const body = lead.weakOpener ? lead.remainder : raw;
  const outcomeM = body.match(OUTCOME_LEAD);
  const methodM = body.match(METHOD_LEAD);
  const scopeM = body.match(SCOPE_LEAD);
  const purposeM = body.match(PURPOSE_LEAD);

  const pool = skillPool || allKnownSkills();
  const matched = [];
  for (const s of pool) {
    if (!skillPresent(raw, s)) continue;
    matched.push({ skill: s, surface: surfaceForm(raw, s) || s });
  }
  /* An alias can match inside a longer technology name: the "js" alias of
     JavaScript matches inside "Node.js" because the boundary rule ignores
     punctuation. A skill whose only surface is contained in another matched
     surface is a spurious match and is dropped from BOTH lists. */
  const kept = matched.filter((m) => !matched.some((o) => o !== m
    && o.surface.length > m.surface.length
    && o.surface.toLowerCase().includes(m.surface.toLowerCase())));

  const object = parseObject(lead.remainder);
  const outcome = outcomeM ? str(outcomeM[2], 200).replace(/[.;,]+$/, '') : '';
  const outcomeVerb = outcomeM ? outcomeM[1].toLowerCase() : '';

  /* Method must not simply repeat the object. */
  let method = methodM ? trimClause(str(methodM[2], 120)) : '';
  /* The candidate chose "with"; swapping it for "via" changes their voice for
     no gain, so the original connective travels with the span. */
  const methodConnective = methodM ? String(methodM[1]).toLowerCase() : '';
  if (method && object) {
    const mo = method.toLowerCase(); const oo = object.toLowerCase();
    if (mo === oo || oo.includes(mo)) method = '';
  }

  let scope = scopeM ? trimClause(str(scopeM[1], 120)) : '';
  /* A scope span that is already inside the object produces "X across X".
     Containment, not equality — "for automated build and deployment" is a
     substring of the object it was pulled from. */
  if (scope && object) {
    const so = scope.toLowerCase(); const oo = object.toLowerCase();
    if (so === oo || oo.includes(so) || so.includes(oo)) scope = '';
  }
  /* "…via retry and backfill handling for late-arriving files" already states
     the scope; repeating it as a separate span produces a stutter. */
  if (scope && method) {
    const so = scope.toLowerCase(); const mo = method.toLowerCase();
    if (mo.includes(so) || so.includes(mo)) scope = '';
  }

  const contentWords = raw.toLowerCase().match(/[a-z][a-z+#./-]{2,}/g) || [];
  const distinct = new Set(contentWords.filter((w) => !STOPWORDS.has(w)));

  return {
    rawText: raw,
    action: lead.action,
    actionBase: lead.base,
    verbKnown: lead.verbKnown !== false,
    weakOpener: lead.weakOpener,
    object,
    method,
    methodConnective,
    scope,
    outcome,
    outcomeVerb,
    purpose: purposeOf(purposeM, object),
    skills: [...new Set(kept.map((m) => canonicalSkill(m.skill)))],
    /* The candidate's own capitalisation — "JUnit", not "junit". */
    skillsDisplay: dedupeSurfaces(kept.map((m) => m.skill), kept.map((m) => m.surface)),
    numericEvidence: extractNumericEvidence(raw),
    /* Tense comes from how the candidate actually wrote it, not from whether
       the role is current — this is what keeps one role internally consistent. */
    detectedTense: detectTense(lead),
    wordCount: raw.split(/\s+/).filter(Boolean).length,
    distinctContentWords: distinct.size,
    /* Specificity precursor: does the sentence carry any concrete anchor? */
    hasConcreteAnchor: !!(kept.length || scope || method || /\d/.test(raw)),
  };
}

/* ------------------------------------------------------------------ */
/* Graph assembly                                                      */
/* ------------------------------------------------------------------ */
/* Total months across dated roles, floored to years. Undated roles contribute
   nothing — tenure is computed, never estimated. */
function computeTenureYears(d) {
  let months = 0;
  const now = new Date();
  for (const e of d.experience || []) {
    if (e.enabled === false) continue;
    const start = parseResumeDate(e.startDate);
    if (!start.ok) continue;
    const end = e.current
      ? { ok: true, year: now.getFullYear(), month: now.getMonth() }
      : parseResumeDate(e.endDate);
    if (!end.ok) continue;
    months += Math.max(0, (end.year - start.year) * 12 + (end.month - start.month));
  }
  return Math.floor(months / 12);
}

function verificationLevelFor(bullet, { verifiedSet, profileSet }) {
  if (bullet.verified || (bullet.evidenceIds || []).length || bullet.projectVerified) return VERIFICATION_LEVEL.VERIFIED;
  if (bullet.userConfirmed === false) return VERIFICATION_LEVEL.IMPORTED_UNCONFIRMED;
  if (bullet.provenance === PROVENANCE.PROFILE_CONFIRMED) return VERIFICATION_LEVEL.PROFILE_CONFIRMED;
  /* A bullet whose every named skill is verified inherits confidence. */
  const parsed = bullet._parsed;
  if (parsed && parsed.skills.length && parsed.skills.every((s) => verifiedSet.has(s))) return VERIFICATION_LEVEL.VERIFIED;
  if (parsed && parsed.skills.length && parsed.skills.every((s) => profileSet.has(s) || verifiedSet.has(s))) return VERIFICATION_LEVEL.PROFILE_CONFIRMED;
  return VERIFICATION_LEVEL.USER_PROVIDED;
}

let _evSeq = 0;
function evidenceId(prefix, key) {
  const safe = String(key || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  if (safe) return `ev_${prefix}_${safe}`;
  _evSeq = (_evSeq + 1) % 1e6;
  return `ev_${prefix}_${_evSeq.toString(36)}`;
}
export function resetEvidenceSequence() { _evSeq = 0; }

/**
 * Build the candidate evidence graph.
 *
 * @param {object} doc            canonical ResumeDocument (already trust-sanitized)
 * @param {object} opts.master    Master Career Profile (optional)
 * @param {string[]} opts.verifiedSkills
 * @param {string[]} opts.profileSkills
 * @param {object[]} opts.githubEvidence  [{ repo, technologies[], signals{} }]
 */
export function buildEvidenceGraph(doc, {
  master = null, verifiedSkills = [], profileSkills = [], githubEvidence = [],
} = {}) {
  const d = normalizeResumeDocument(doc);
  const verifiedSet = toCanonicalSet(verifiedSkills);
  const profileSet = toCanonicalSet([...profileSkills, ...d.skills.map((s) => s.name)]);
  const skillPool = [...new Set([
    ...allKnownSkills(),
    ...d.skills.map((s) => s.name.toLowerCase()),
    ...verifiedSkills.map((s) => String(s).toLowerCase()),
  ])];

  const records = [];
  const byId = new Map();
  const push = (rec) => { records.push(rec); byId.set(rec.id, rec); return rec; };

  /* ---- experience + project bullets: the primary achievement evidence ---- */
  const expById = new Map(d.experience.map((e) => [e.id, e]));
  const projById = new Map(d.projects.map((p) => [p.id, p]));

  for (const b of collectBullets(d)) {
    if (!b.text) continue;
    const parsed = parseEvidenceText(b.text, { skillPool });
    b._parsed = parsed;
    const parent = b.section === 'experience' ? expById.get(b.itemId) : projById.get(b.itemId);
    const level = verificationLevelFor(b, { verifiedSet, profileSet });
    push({
      id: evidenceId(b.section === 'experience' ? 'xp' : 'pj', b.id),
      type: 'achievement',
      source: b.section,
      sourceId: b.itemId,
      bulletId: b.id,
      company: b.section === 'experience' ? str(parent?.company, 120) : '',
      role: b.section === 'experience' ? str(parent?.role, 120) : '',
      projectName: b.section === 'projects' ? str(parent?.name, 140) : '',
      techStack: b.section === 'projects' ? str(parent?.techStack, 240) : '',
      section: b.section,
      current: !!b.current,
      /* The candidate's own tense wins; `current` only breaks ties. */
      tense: parsed.detectedTense || (b.current ? 'present' : 'past'),
      detectedTense: parsed.detectedTense,
      startDate: str(parent?.startDate, 20),
      endDate: str(parent?.endDate, 20),
      skills: parsed.skills,
      skillsDisplay: parsed.skillsDisplay,
      action: parsed.action,
      actionBase: parsed.actionBase,
      verbKnown: parsed.verbKnown,
      weakOpener: parsed.weakOpener,
      object: parsed.object,
      method: parsed.method,
      methodConnective: parsed.methodConnective,
      scope: parsed.scope,
      outcome: parsed.outcome,
      outcomeVerb: parsed.outcomeVerb,
      purpose: parsed.purpose,
      numericEvidence: parsed.numericEvidence,
      rawText: parsed.rawText,
      wordCount: parsed.wordCount,
      hasConcreteAnchor: parsed.hasConcreteAnchor,
      evidenceIds: arr(b.evidenceIds),
      verificationLevel: level,
      confidence: CONFIDENCE[level] ?? 0.7,
      enabled: b.enabled !== false,
    });
  }

  /* ---- declared / verified skills ---- */
  for (const sk of d.skills) {
    const c = canonicalSkill(sk.name);
    const level = verifiedSet.has(c) ? VERIFICATION_LEVEL.VERIFIED
      : profileSet.has(c) ? VERIFICATION_LEVEL.PROFILE_CONFIRMED
        : VERIFICATION_LEVEL.USER_PROVIDED;
    push({
      id: evidenceId('sk', sk.id || c),
      type: 'skill',
      source: 'skills',
      sourceId: sk.id,
      section: 'skills',
      skills: [c],
      skillsDisplay: [sk.name],
      rawText: sk.name,
      group: sk.group,
      numericEvidence: [],
      verificationLevel: level,
      confidence: CONFIDENCE[level] ?? 0.7,
      enabled: sk.enabled !== false,
    });
  }

  /* ---- credentials: certifications / achievements / patents / publications ---- */
  const credential = (list, type, prefix) => {
    for (const it of list) {
      if (!it.text) continue;
      const parsed = parseEvidenceText(it.text, { skillPool });
      push({
        id: evidenceId(prefix, it.id),
        type,
        source: type,
        sourceId: it.id,
        section: type,
        skills: parsed.skills,
        skillsDisplay: parsed.skillsDisplay,
        rawText: parsed.rawText,
        numericEvidence: parsed.numericEvidence,
        object: parsed.object || parsed.rawText,
        verificationLevel: it.provenance === PROVENANCE.VERIFIED ? VERIFICATION_LEVEL.VERIFIED
          : it.provenance === PROVENANCE.PROFILE_CONFIRMED ? VERIFICATION_LEVEL.PROFILE_CONFIRMED
            : VERIFICATION_LEVEL.USER_PROVIDED,
        confidence: 0.85,
        enabled: it.enabled !== false,
      });
    }
  };
  credential(d.certifications, 'certification', 'ct');
  credential(d.achievements, 'achievement_item', 'ac');
  credential(d.patents, 'patent', 'pt');
  credential(d.publications, 'publication', 'pb');

  /* ---- education ---- */
  for (const e of d.education) {
    push({
      id: evidenceId('ed', e.id),
      type: 'education',
      source: 'education',
      sourceId: e.id,
      section: 'education',
      skills: [],
      rawText: [e.degree, e.school].filter(Boolean).join(', '),
      school: e.school,
      degree: e.degree,
      dates: e.dates || [e.startDate, e.endDate].filter(Boolean).join(' – '),
      numericEvidence: [],
      verificationLevel: VERIFICATION_LEVEL.PROFILE_CONFIRMED,
      confidence: 0.9,
      enabled: e.enabled !== false,
    });
  }

  /* ---- master-profile-only evidence (not yet on the document) ---- */
  const docProjectIds = new Set(d.projects.map((p) => p.sourceProjectId).filter(Boolean));
  for (const p of arr(master?.projects)) {
    if (!p.sourceProjectId || docProjectIds.has(p.sourceProjectId)) continue;
    push({
      id: evidenceId('mp', p.sourceProjectId),
      type: 'available_project',
      source: 'master_profile',
      sourceId: p.sourceProjectId,
      section: 'projects',
      projectName: p.name,
      rawText: [p.description, p.outcome].filter(Boolean).join(' '),
      skills: arr(p.technologies).map(canonicalSkill),
      skillsDisplay: arr(p.technologies),
      numericEvidence: extractNumericEvidence([p.description, p.outcome].join(' ')),
      evidenceIds: arr(p.evidenceIds),
      verificationLevel: p.verified ? VERIFICATION_LEVEL.VERIFIED : VERIFICATION_LEVEL.PROFILE_CONFIRMED,
      confidence: p.verified ? 1 : 0.85,
      enabled: true,
      onDocument: false,
    });
  }

  /* ---- connected GitHub evidence: strengthens confidence, never a claim ----
     A technology found in a dependency manifest proves the repo used it. It
     does NOT prove expertise, so it lands as a `signal`, never an achievement. */
  for (const g of arr(githubEvidence)) {
    const techs = arr(g.technologies).map(canonicalSkill).filter(Boolean);
    if (!techs.length) continue;
    push({
      id: evidenceId('gh', g.repo || g.id),
      type: 'connected_signal',
      source: 'github',
      sourceId: str(g.repo || g.id, 80),
      section: 'external',
      skills: techs,
      skillsDisplay: arr(g.technologies),
      rawText: '',
      numericEvidence: [],
      /* classification: manifest presence is weaker than authored code */
      signalStrength: g.authored ? 'authored' : 'declared_dependency',
      verificationLevel: g.authored ? VERIFICATION_LEVEL.PROFILE_CONFIRMED : VERIFICATION_LEVEL.USER_PROVIDED,
      confidence: g.authored ? 0.75 : 0.45,
      enabled: true,
      claimable: false, // NEVER rendered as an achievement
    });
  }

  /* ---- DERIVED facts ----
     Years of experience is COMPUTED from the candidate's own dated roles, and
     verified-project counts are counted from real records. These are derived,
     not invented, so they are registered as evidence — which is what allows a
     summary to say "7 years" while the firewall still rejects any number the
     candidate cannot account for. */
  const tenure = computeTenureYears(d);
  const verifiedProjectCount = d.projects.filter((p) => p.verified && p.enabled).length;
  push({
    id: 'ev_derived_profile',
    type: 'derived',
    source: 'computed',
    section: 'derived',
    skills: [],
    rawText: [
      tenure ? `${tenure} years of dated experience` : '',
      verifiedProjectCount ? `${verifiedProjectCount} verified projects` : '',
    ].filter(Boolean).join('; '),
    numericEvidence: [
      ...(tenure ? [{ value: String(tenure), raw: String(tenure), unit: 'years', derivedFrom: 'dated_experience' }] : []),
      ...(verifiedProjectCount ? [{ value: String(verifiedProjectCount), raw: String(verifiedProjectCount), unit: 'projects', derivedFrom: 'verified_projects' }] : []),
    ],
    verificationLevel: VERIFICATION_LEVEL.PROFILE_CONFIRMED,
    confidence: 0.95,
    enabled: true,
    claimable: false, // it is context for the summary, never an achievement
  });

  /* ---- derived indexes the rest of the pipeline needs ---- */
  const skillIndex = new Map();
  for (const r of records) {
    for (const s of r.skills || []) {
      if (!skillIndex.has(s)) skillIndex.set(s, []);
      skillIndex.get(s).push(r.id);
    }
  }
  const allNumbers = new Set();
  for (const r of records) for (const n of r.numericEvidence || []) allNumbers.add(n.value);

  const achievements = records.filter((r) => r.type === 'achievement');

  return {
    version: EVIDENCE_GRAPH_VERSION,
    records,
    byId,
    skillIndex,
    /* The permitted-number universe. The truth validator refuses any number
       outside this set — this is the hard fabrication firewall. */
    permittedNumbers: allNumbers,
    permittedSkills: new Set(records.flatMap((r) => r.skills || [])),
    counts: {
      total: records.length,
      achievements: achievements.length,
      verified: records.filter((r) => r.verificationLevel === VERIFICATION_LEVEL.VERIFIED).length,
      withMetrics: achievements.filter((r) => (r.numericEvidence || []).length).length,
      weakOpeners: achievements.filter((r) => r.weakOpener).length,
      noAnchor: achievements.filter((r) => !r.hasConcreteAnchor).length,
    },
    get: (id) => byId.get(id) || null,
    forSection: (section) => records.filter((r) => r.section === section),
  };
}

export default {
  EVIDENCE_GRAPH_VERSION, VERIFICATION_LEVEL, buildEvidenceGraph,
  parseEvidenceText, extractNumericEvidence, resetEvidenceSequence,
};
