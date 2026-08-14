/* ============================================================
   JOB DISCOVERY OS — RANKING  (§31, §32, §33)
   ------------------------------------------------------------
   A general relevance model that requires ZERO candidate data.
   No resume, no profile, no evidence graph, no Career Autopilot
   score is read anywhere in this file — that is enforced by the
   function signature: rankJob(job, query) takes only a job and a
   query.

   Title relevance is TIERED, not boolean (§32):
       exact string      1.00
       alias of family   0.85
       strongly related  0.62
       related           0.38
   so "SRE" ranks below an exact "DevOps Engineer" for a DevOps
   query, but well above an unrelated role.

   Scores are honest granularity — 0-100 integers with a stated
   basis. No "98.743728% perfect match".
   ============================================================ */

import { expandQuery, resolveFamilies, RELATION_WEIGHT, coreTitleTokens } from './normalize/taxonomy.js';
import { understandQuery, techRelevance } from './normalize/queryUnderstanding.js';
import { tokens } from './normalize/text.js';
import { locationCompatibility } from './normalize/location.js';
import { salaryCompatibility } from './normalize/compensation.js';
import { freshnessScore } from './freshness.js';
import { SOURCE_AUTHORITY, SOURCE_CLASS, WORKPLACE_TYPE, EMPLOYMENT_TYPE } from './schema.js';

export const WEIGHTS = Object.freeze({
  title: 34,
  query: 14,
  location: 18,
  freshness: 12,
  source: 8,
  directApply: 6,
  completeness: 4,
  salary: 4,
  /* Technology overlap. Deliberately small: it sharpens ordering INSIDE a
     relevant role family, it never lifts an unrelated role into the results. */
  tech: 6,
});

/** Tiered title relevance. Returns { score 0..1, relation, basis }. */
export function titleRelevance(job, queryText, { expansion: providedExpansion = null, roleText = null } = {}) {
  const q = String(queryText || '').trim();
  if (!q) return { score: 0.5, relation: 'NO_QUERY', basis: 'no title query supplied' };

  const jobTitleNorm = coreTitleTokens(job.title || '').join(' ');
  /* When query understanding has stripped location/work-model/seniority words,
     match the ROLE remainder — "Remote data engineer India" must be able to
     match the title "Data Engineer" exactly. */
  const queryNorm = coreTitleTokens(roleText || q).join(' ');

  if (queryNorm && jobTitleNorm === queryNorm) {
    return { score: RELATION_WEIGHT.EXACT, relation: 'EXACT', basis: 'exact normalized title match' };
  }
  if (queryNorm && job.normalizedTitle === queryNorm) {
    return { score: RELATION_WEIGHT.EXACT, relation: 'EXACT', basis: 'exact normalized title match' };
  }

  const expansion = providedExpansion || expandQuery(q);
  const jobFamilies = new Set([job.titleFamily, ...(job.titleFamilies || [])].filter(Boolean));

  let best = null;
  for (const fam of jobFamilies) {
    const hit = expansion.get(fam);
    if (hit && (!best || hit.weight > best.weight)) best = { ...hit, family: fam };
  }
  if (best) {
    /* The query's OWN family is EXACT only for a title that matches the query
       string. A different title in the same family is an ALIAS — otherwise
       "Digital Marketing Manager" ties with "Marketing Manager" on a
       "Marketing Manager" query, and the exact match loses on a tiebreak. */
    const relation = best.relation === 'EXACT' ? 'ALIAS' : best.relation;
    const score = relation === 'ALIAS' ? RELATION_WEIGHT.ALIAS : best.weight;
    return {
      score,
      relation,
      basis: relation === 'ALIAS'
        ? `alias of the queried role family (${best.family})`
        : `${relation.toLowerCase()} role family (${best.family})`,
    };
  }

  /* No family relationship. Fall back to token overlap, capped low so a
     coincidental word cannot outrank a real family match. */
  const qTok = new Set(coreTitleTokens(q));
  const tTok = new Set(coreTitleTokens(job.title || ''));
  if (!qTok.size || !tTok.size) return { score: 0, relation: 'NONE', basis: 'no title overlap' };
  let overlap = 0;
  for (const t of qTok) if (tTok.has(t)) overlap += 1;
  const ratio = overlap / qTok.size;
  if (!overlap) return { score: 0, relation: 'NONE', basis: 'no title overlap' };
  return { score: Math.min(0.3, ratio * 0.3), relation: 'WEAK', basis: `${overlap}/${qTok.size} title words overlap` };
}

/**
 * Token set for one job, memoised.
 *
 * Ranking touches every candidate, and tokenising 3 KB of description per
 * candidate per query dominated search latency at scale — it was the single
 * largest cost in the 100k benchmark. The cache is a WeakMap keyed on the job
 * object, so it costs nothing when a job is evicted and never has to be
 * invalidated: an updated job is a NEW object from the store.
 */
const JOB_TOKEN_CACHE = new WeakMap();

export function jobTokenSet(job) {
  if (!job || typeof job !== 'object') return new Set();
  const cached = JOB_TOKEN_CACHE.get(job);
  if (cached) return cached;
  const set = new Set(tokens([
    job.title, job.company?.name, job.department,
    (job.tags || []).join(' '),
    String(job.description?.text || '').slice(0, 3000),
  ].filter(Boolean).join(' ')));
  JOB_TOKEN_CACHE.set(job, set);
  return set;
}

/** Description/company/tag relevance — secondary to the title signal. */
export function queryRelevance(job, queryText) {
  const q = tokens(queryText || '');
  if (!q.length) return { score: 0.5, basis: 'no query' };
  const hay = jobTokenSet(job);
  if (!hay.size) return { score: 0, basis: 'no indexable text' };
  let hits = 0;
  for (const t of new Set(q)) if (hay.has(t)) hits += 1;
  const ratio = hits / new Set(q).size;
  return { score: ratio, basis: `${hits}/${new Set(q).size} query terms present` };
}

/** Source reliability + authority. An original ATS outranks an aggregator. */
export function sourceScore(job) {
  const instances = job.sourceInstances || [];
  if (!instances.length) return { score: 0, basis: 'no source instances' };
  const best = Math.max(...instances.map((s) => SOURCE_AUTHORITY[s.sourceClass] ?? 0));
  const authority = best / 400;
  const corroboration = Math.min(0.2, (instances.length - 1) * 0.07);
  const cls = instances.find((s) => (SOURCE_AUTHORITY[s.sourceClass] ?? 0) === best)?.sourceClass;
  return {
    score: Math.min(1, authority * 0.8 + corroboration),
    basis: `${cls} (${instances.length} source${instances.length === 1 ? '' : 's'})`,
  };
}

export function directApplyScore(job) {
  const url = job.canonicalApplyUrl;
  if (!url) return { score: 0, basis: 'no apply url' };
  const originalInstance = (job.sourceInstances || []).find(
    (s) => s.applyUrl === url
      && (s.sourceClass === SOURCE_CLASS.ORIGINAL_ATS || s.sourceClass === SOURCE_CLASS.ORIGINAL_CAREER_SITE),
  );
  return originalInstance
    ? { score: 1, basis: 'direct company/ATS apply url' }
    : { score: 0.4, basis: 'apply url via supplemental source' };
}

/** Remote-preference compatibility, evidence-based. */
export function remoteCompatibility(job, remotePref) {
  if (!remotePref || remotePref === 'any') return { compatible: true, score: 0.5, reason: 'no remote filter' };
  const type = job.workplace?.type || WORKPLACE_TYPE.UNKNOWN;
  const want = String(remotePref).toLowerCase();
  if (want === 'remote') {
    if (type === WORKPLACE_TYPE.REMOTE) return { compatible: true, score: 1, reason: 'remote role' };
    if (type === WORKPLACE_TYPE.UNKNOWN) return { compatible: true, score: 0.25, reason: 'workplace type not stated by source' };
    return { compatible: false, score: 0, reason: `role is ${type.toLowerCase()}` };
  }
  if (want === 'hybrid') {
    if (type === WORKPLACE_TYPE.HYBRID) return { compatible: true, score: 1, reason: 'hybrid role' };
    if (type === WORKPLACE_TYPE.UNKNOWN) return { compatible: true, score: 0.25, reason: 'workplace type not stated by source' };
    return { compatible: false, score: 0, reason: `role is ${type.toLowerCase()}` };
  }
  if (want === 'onsite' || want === 'on-site') {
    if (type === WORKPLACE_TYPE.ONSITE) return { compatible: true, score: 1, reason: 'onsite role' };
    if (type === WORKPLACE_TYPE.HYBRID) return { compatible: true, score: 0.6, reason: 'hybrid role has office presence' };
    if (type === WORKPLACE_TYPE.UNKNOWN) return { compatible: true, score: 0.25, reason: 'workplace type not stated by source' };
    return { compatible: false, score: 0, reason: 'role is remote' };
  }
  return { compatible: true, score: 0.5, reason: 'unrecognised remote filter' };
}

export function employmentCompatibility(job, wanted) {
  if (!wanted) return { compatible: true, score: 0.5, reason: 'no employment-type filter' };
  const want = String(wanted).toUpperCase().replace(/[\s-]+/g, '_');
  const have = job.employmentType || EMPLOYMENT_TYPE.UNKNOWN;
  if (have === EMPLOYMENT_TYPE.UNKNOWN) return { compatible: true, score: 0.25, reason: 'employment type not stated by source', unknown: true };
  return have === want
    ? { compatible: true, score: 1, reason: `employment type ${have}` }
    : { compatible: false, score: 0, reason: `employment type is ${have}` };
}

/**
 * Score one job against a query. Pure: no candidate data, no I/O.
 *
 * @returns {{ overall, title, query, location, freshness, source, ...,
 *             excluded, exclusionReason, explanations }}
 */
export function rankJob(job, criteria = {}, { now = Date.now(), understanding = null } = {}) {
  const u = understanding;
  const title = titleRelevance(job, criteria.q, {
    expansion: u?.familyWeights || null,
    roleText: u?.roleText || null,
  });
  const query = queryRelevance(job, criteria.q);
  const tech = techRelevance(job, u?.techs || []);
  /* Understanding may recover an intent the caller never filtered on
     ("Remote data engineer India" -> location India, remote). Those values
     SCORE, but they never hard-exclude: the user typed a search box, not a
     filter, and an inference is not permission to delete results. Only an
     EXPLICIT criterion can exclude a job. */
  const location = locationCompatibility(job, criteria.location ?? u?.location ?? null);
  const remote = remoteCompatibility(job, criteria.remote ?? u?.remote ?? null);
  const salary = salaryCompatibility(job, criteria);
  const employment = employmentCompatibility(job, criteria.employmentType ?? u?.employmentType ?? null);
  const explicit = {
    location: criteria.location != null && criteria.location !== '',
    remote: criteria.remote != null && criteria.remote !== '',
    employmentType: criteria.employmentType != null && criteria.employmentType !== '',
  };
  const fresh = freshnessScore(job, { now });
  const source = sourceScore(job);
  const apply = directApplyScore(job);
  const completeness = (job.completeness ?? 0) / 100;

  const hardFails = [];
  if (explicit.location && !location.compatible) hardFails.push(`location: ${location.reason}`);
  if (explicit.remote && !remote.compatible) hardFails.push(`remote: ${remote.reason}`);
  if (!salary.compatible) hardFails.push(`salary: ${salary.reason}`);
  if (explicit.employmentType && !employment.compatible) hardFails.push(`employment type: ${employment.reason}`);

  const raw = (
    title.score * WEIGHTS.title
    + query.score * WEIGHTS.query
    + location.score * WEIGHTS.location
    + fresh.score * WEIGHTS.freshness
    + source.score * WEIGHTS.source
    + apply.score * WEIGHTS.directApply
    + completeness * WEIGHTS.completeness
    + salary.score * WEIGHTS.salary
    + tech.score * WEIGHTS.tech
  );
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

  /* RELEVANCE GATE.
     Location, freshness, source authority, direct-apply and completeness are
     QUALITY signals. Without a gate they sum to a respectable score for a job
     that has nothing to do with the query — a fresh, well-formed, direct-source
     "Remote Support Engineer" would land mid-table on a DevOps search purely on
     the word "Engineer". Quality may only AMPLIFY relevance, never substitute
     for it, so the composite is scaled by how relevant the role actually is.
     An exact match is unaffected (factor 1.0); a weak token overlap is damped. */
  const relevance = Math.max(title.score, query.score * 0.8, tech.score * 0.55);
  const gate = criteria.q ? (0.35 + 0.65 * relevance) : 1;
  const overall = Math.round((raw / total) * 100 * gate);

  return {
    overall,
    title: Math.round(title.score * 100),
    query: Math.round(query.score * 100),
    location: Math.round(location.score * 100),
    freshness: Math.round(fresh.score * 100),
    source: Math.round(source.score * 100),
    directApply: Math.round(apply.score * 100),
    completeness: Math.round(completeness * 100),
    tech: Math.round(tech.score * 100),
    techHits: tech.hits,
    titleRelation: title.relation,
    freshnessBasis: fresh.basis,
    excluded: hardFails.length > 0,
    exclusionReason: hardFails[0] || null,
    explanations: {
      title: title.basis,
      query: query.basis,
      location: location.reason,
      remote: remote.reason,
      salary: salary.reason,
      employmentType: employment.reason,
      source: source.basis,
      directApply: apply.basis,
      tech: tech.basis,
    },
  };
}

/** Is this role family relevant to the query at all? Used for cheap filtering. */
export function familyRelevant(job, queryText, expansion0 = null) {
  if (!queryText) return true;
  const expansion = expansion0 || expandQuery(queryText);
  if (!expansion.size) return true; // unresolvable query — fall back to text scoring
  for (const fam of [job.titleFamily, ...(job.titleFamilies || [])].filter(Boolean)) {
    if (expansion.has(fam)) return true;
  }
  return false;
}

export { resolveFamilies, expandQuery, understandQuery, techRelevance };

export default {
  rankJob, titleRelevance, queryRelevance, sourceScore, directApplyScore,
  remoteCompatibility, employmentCompatibility, familyRelevant, WEIGHTS,
  understandQuery, techRelevance,
};
