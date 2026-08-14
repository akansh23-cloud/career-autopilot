/* ============================================================
   JOB DISCOVERY OS — DEDUPLICATION ENGINE
   ------------------------------------------------------------
   Four deterministic stages, strongest evidence first. No LLM
   anywhere in this path (§20).

     1  same provider + same source job id
     2  same canonical company + same requisition/reference id
     3  company (domain/name) + normalized title + normalized
        location + apply-URL agreement
     4  content similarity (5-word shingles / MinHash) GATED by
        company + location + title-compatibility

   §20.1 anti-overmerge guards are enforced BEFORE any stage can
   return a match:
     - different normalized location  -> never merge
     - different seniority            -> never merge
     - different requisition ids on the same company -> never merge
   ============================================================ */

import {
  jaccard, shingles, signatureSimilarity, minhashSignature,
} from './normalize/text.js';
import { locationKeyOf } from './normalize/index.js';
import { sameCompany } from './normalize/entity.js';
import { normalizeWhitespace } from './normalize/text.js';
import { SOURCE_AUTHORITY, recordProvenance, finalizeJobDocument, JOB_STATUS } from './schema.js';

export const DEDUPE_STAGE = Object.freeze({
  PROVIDER_ID: 'PROVIDER_ID',
  REQUISITION: 'REQUISITION',
  IDENTITY: 'IDENTITY',
  CONTENT: 'CONTENT',
});

export const CONTENT_SIMILARITY_THRESHOLD = 0.82;
export const SIGNATURE_PREFILTER = 0.55;

function companyKeyOf(job) {
  return job.company?.domain || job.company?.normalizedName || '';
}

/**
 * Location identity for merge decisions.
 *
 * `resolved` is false when a job's locations carry no geography at all — an
 * aggregator that only says "Remote" has told us NOTHING about where the role
 * is, and treating that as a location that DIFFERS from "Remote, India" split
 * every cross-source duplicate in two. Unknown blocks nothing; two RESOLVED and
 * different locations still block, which is the §20.1 case.
 */
export function locationSignature(job) {
  const locs = job.locations || [];
  const resolved = locs.some((l) => l.city || l.region || l.countryCode);
  return { key: resolved ? locationKeyOf(locs.filter((l) => l.city || l.region || l.countryCode)) : '', resolved };
}

function sameLocation(a, b) {
  const la = locationSignature(a);
  const lb = locationSignature(b);
  if (!la.resolved || !lb.resolved) return true; // unknown never blocks
  return la.key === lb.key;
}

function requisitionIdsOf(job) {
  return new Set((job.sourceInstances || []).map((s) => s.requisitionId).filter(Boolean));
}

function providerIdPairs(job) {
  return (job.sourceInstances || [])
    .filter((s) => s.provider && s.sourceJobId)
    .map((s) => `${s.provider}::${s.sourceJobId}`);
}

/**
 * Hard blockers. Returns a reason string when the two jobs must NOT be merged,
 * or null when merging is permitted by the guards.
 */
export function overmergeGuard(a, b) {
  if (!sameLocation(a, b)) return 'different-location';

  const sa = a.seniority || 'UNKNOWN';
  const sb = b.seniority || 'UNKNOWN';
  if (sa !== sb) {
    /* Identical display titles read at different seniorities is a classifier
       artefact, not two vacancies. A title that actually SAYS "Senior" is a
       different posting from one that does not — §20.1 keeps those apart. */
    const ta = normalizeWhitespace(a.title || '').toLowerCase();
    const tb = normalizeWhitespace(b.title || '').toLowerCase();
    if (ta !== tb) return 'different-seniority';
  }

  if (a.normalizedTitle && b.normalizedTitle && a.normalizedTitle !== b.normalizedTitle) {
    /* Titles differ after normalization. Only a shared family plus identical
       seniority may still be the same vacancy — anything else stays separate. */
    const fa = new Set(a.titleFamilies || []);
    const shared = (b.titleFamilies || []).some((f) => fa.has(f));
    if (!shared) return 'different-title';
    if (sa !== sb) return 'different-title-seniority';
  }
  return null;
}

/** Requisition conflict is checked separately: it blocks even identical titles. */
export function requisitionConflict(a, b) {
  const ra = requisitionIdsOf(a);
  const rb = requisitionIdsOf(b);
  if (!ra.size || !rb.size) return false;
  for (const id of ra) if (rb.has(id)) return false; // they agree on at least one
  return true; // both have ids, none shared -> distinct requisitions
}

/**
 * Content similarity, deterministic and LLM-free.
 *
 * Jaccard alone is the wrong measure across source classes: aggregators publish
 * a TRUNCATED summary of the employer's description, so a genuine duplicate
 * scores ~0.3 on symmetric overlap purely because one text is shorter. When the
 * lengths differ materially we also compute CONTAINMENT — |A∩B| / min(|A|,|B|) —
 * which is ~1.0 when the short text is a fragment of the long one.
 */
function contentSimilarity(a, b) {
  const textA = a.description?.text || '';
  const textB = b.description?.text || '';
  const gramsA = shingles(textA);
  const gramsB = shingles(textB);
  if (!gramsA.length || !gramsB.length) return { approx: 0, exact: 0, containment: 0, minGrams: 0 };

  const setA = new Set(gramsA);
  const setB = new Set(gramsB);
  const minGrams = Math.min(setA.size, setB.size);
  const lengthRatio = minGrams / Math.max(setA.size, setB.size);

  /* The MinHash prefilter only earns its keep on similar-length texts; a short
     summary would be rejected before containment ever ran. */
  if (lengthRatio > 0.6) {
    const sigA = a.shingleSignature?.length ? a.shingleSignature : minhashSignature(textA);
    const sigB = b.shingleSignature?.length ? b.shingleSignature : minhashSignature(textB);
    const approx = signatureSimilarity(sigA, sigB);
    if (approx < SIGNATURE_PREFILTER) return { approx, exact: 0, containment: 0, minGrams };
  }

  let inter = 0;
  const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  for (const g of small) if (large.has(g)) inter += 1;

  return {
    approx: signatureSimilarity(
      a.shingleSignature?.length ? a.shingleSignature : minhashSignature(textA),
      b.shingleSignature?.length ? b.shingleSignature : minhashSignature(textB),
    ),
    exact: jaccard(setA, setB),
    containment: minGrams ? inter / minGrams : 0,
    minGrams,
  };
}

/** A short text fully contained in a longer one is the aggregator-summary case. */
export const CONTAINMENT_THRESHOLD = 0.85;
export const CONTAINMENT_MIN_GRAMS = 3;

function contentMatches({ exact, containment, minGrams }) {
  if (exact >= CONTENT_SIMILARITY_THRESHOLD) return { ok: true, basis: `jaccard ${exact.toFixed(2)}` };
  if (containment >= CONTAINMENT_THRESHOLD && minGrams >= CONTAINMENT_MIN_GRAMS) {
    return { ok: true, basis: `containment ${containment.toFixed(2)}` };
  }
  return { ok: false, basis: null };
}

/**
 * Decide whether `incoming` is the same vacancy as `existing`.
 * @returns { match: boolean, stage, confidence, reason }
 */
export function isDuplicate(existing, incoming) {
  /* Stage 1 — provider + source job id. Literally the same posting record, so
     it is CONCLUSIVE and runs ahead of the heuristic guards below. */
  const idsA = new Set(providerIdPairs(existing));
  for (const pair of providerIdPairs(incoming)) {
    if (idsA.has(pair)) {
      return { match: true, stage: DEDUPE_STAGE.PROVIDER_ID, confidence: 1, reason: `provider id ${pair}` };
    }
  }

  const blocked = overmergeGuard(existing, incoming);
  if (blocked) return { match: false, stage: null, confidence: 0, reason: blocked };

  const sameCo = !!companyKeyOf(existing) && !!companyKeyOf(incoming)
    && (companyKeyOf(existing) === companyKeyOf(incoming)
      || sameCompany(existing.company?.name, incoming.company?.name));

  /* Stage 2 — company + requisition id. */
  if (sameCo) {
    const ra = requisitionIdsOf(existing);
    const rb = requisitionIdsOf(incoming);
    for (const id of rb) {
      if (ra.has(id)) {
        return { match: true, stage: DEDUPE_STAGE.REQUISITION, confidence: 0.98, reason: `requisition ${id}` };
      }
    }
    if (requisitionConflict(existing, incoming)) {
      return { match: false, stage: null, confidence: 0, reason: 'different-requisition' };
    }
  }

  if (!sameCo) return { match: false, stage: null, confidence: 0, reason: 'different-company' };

  /* Stage 3 — identity: company + normalized title + normalized location. */
  const sameTitle = existing.normalizedTitle && existing.normalizedTitle === incoming.normalizedTitle;
  const la = locationSignature(existing).key;
  const lb = locationSignature(incoming).key;
  const sameLoc = sameLocation(existing, incoming); // guard already rejected differing resolved pairs
  const applyA = new Set((existing.sourceInstances || []).map((s) => s.applyUrl).filter(Boolean).concat([existing.canonicalApplyUrl].filter(Boolean)));
  const applyB = (incoming.sourceInstances || []).map((s) => s.applyUrl).filter(Boolean).concat([incoming.canonicalApplyUrl].filter(Boolean));
  const sameApply = applyB.some((u) => applyA.has(u));

  if (sameTitle && sameLoc && sameApply) {
    return { match: true, stage: DEDUPE_STAGE.IDENTITY, confidence: 0.95, reason: 'company+title+location+applyUrl' };
  }
  if (sameTitle && sameLoc && (la || lb)) {
    /* Same employer, same title, same stated location, no URL agreement.
       Strong but not conclusive — corroborate with content. */
    const sim = contentSimilarity(existing, incoming);
    const hit = contentMatches(sim);
    if (hit.ok) {
      return { match: true, stage: DEDUPE_STAGE.CONTENT, confidence: Math.min(0.94, 0.7 + Math.max(sim.exact, sim.containment) * 0.25), reason: hit.basis };
    }
    if (!existing.description?.text || !incoming.description?.text) {
      return { match: true, stage: DEDUPE_STAGE.IDENTITY, confidence: 0.8, reason: 'company+title+location, no description to compare' };
    }
    return { match: false, stage: null, confidence: sim.approx, reason: 'content-below-threshold' };
  }

  /* Stage 4 — content similarity, still gated by company + location. */
  if (sameLoc && sameTitle) {
    const sim = contentSimilarity(existing, incoming);
    const hit = contentMatches(sim);
    if (hit.ok) {
      return { match: true, stage: DEDUPE_STAGE.CONTENT, confidence: 0.9, reason: hit.basis };
    }
  }
  return { match: false, stage: null, confidence: 0, reason: 'no-stage-matched' };
}

/**
 * Merge `incoming` into `existing` in place-ish (returns a new object).
 * Source instances are clustered, never collapsed. Field authority follows
 * SOURCE_AUTHORITY; disagreements are retained in `conflicts` (§39).
 */
export function mergeJobs(existing, incoming, { now = new Date().toISOString() } = {}) {
  const job = { ...existing, sourceInstances: [...(existing.sourceInstances || [])] };

  for (const inc of incoming.sourceInstances || []) {
    const idx = job.sourceInstances.findIndex(
      (s) => s.sourceId === inc.sourceId
        && String(s.sourceJobId ?? '') === String(inc.sourceJobId ?? ''),
    );
    if (idx >= 0) {
      const prev = job.sourceInstances[idx];
      job.sourceInstances[idx] = {
        ...prev,
        ...inc,
        firstSeenAt: prev.firstSeenAt || inc.firstSeenAt,
        lastSeenAt: inc.lastSeenAt || now,
        lastVerifiedAt: inc.lastVerifiedAt || prev.lastVerifiedAt,
        missCount: 0,
        active: true,
      };
    } else {
      job.sourceInstances.push({ ...inc, firstSeenAt: inc.firstSeenAt || now, lastSeenAt: inc.lastSeenAt || now });
    }
  }

  /* firstSeenAt is the EARLIEST discovery across instances; lastSeenAt the latest. */
  const firsts = job.sourceInstances.map((s) => s.firstSeenAt).filter(Boolean).concat([existing.firstSeenAt].filter(Boolean));
  const lasts = job.sourceInstances.map((s) => s.lastSeenAt).filter(Boolean).concat([existing.lastSeenAt].filter(Boolean));
  job.firstSeenAt = firsts.sort()[0] || existing.firstSeenAt;
  job.lastSeenAt = lasts.sort().slice(-1)[0] || now;

  const verifieds = job.sourceInstances.map((s) => s.lastVerifiedAt).filter(Boolean);
  job.lastVerifiedAt = verifieds.length ? verifieds.sort().slice(-1)[0] : existing.lastVerifiedAt;

  /* sourcePublishedAt: prefer the highest-authority source that HAS one.
     Never synthesised from firstSeenAt. */
  const incInstance = (incoming.sourceInstances || [])[0];
  const fieldUpdates = {
    title: incoming.title,
    company: incoming.company?.name,
    workplaceType: incoming.workplace?.type,
    remoteScope: incoming.workplace?.remoteScope,
    compensation: (incoming.compensation?.min != null || incoming.compensation?.max != null) ? incoming.compensation : null,
    locations: incoming.locations?.length ? incoming.locations.map((l) => l.raw) : null,
    employmentType: incoming.employmentType !== 'UNKNOWN' ? incoming.employmentType : null,
    sourcePublishedAt: incoming.sourcePublishedAt,
    canonicalApplyUrl: incoming.canonicalApplyUrl,
    department: incoming.department,
    seniority: incoming.seniority !== 'UNKNOWN' ? incoming.seniority : null,
    description: incoming.description?.text ? incoming.description.text.length : null,
  };

  for (const [field, value] of Object.entries(fieldUpdates)) {
    const won = recordProvenance(job, field, value, incInstance, now);
    if (!won) continue;
    switch (field) {
      case 'title': job.title = incoming.title; job.normalizedTitle = incoming.normalizedTitle; job.titleFamily = incoming.titleFamily; job.titleFamilies = incoming.titleFamilies; break;
      case 'company': job.company = { ...job.company, ...incoming.company }; break;
      case 'workplaceType':
      case 'remoteScope': job.workplace = { ...incoming.workplace }; break;
      case 'compensation': job.compensation = { ...incoming.compensation }; break;
      case 'locations': job.locations = incoming.locations; break;
      case 'employmentType': job.employmentType = incoming.employmentType; break;
      case 'sourcePublishedAt': job.sourcePublishedAt = incoming.sourcePublishedAt; break;
      case 'canonicalApplyUrl': break; // handled by applyUrl authority below
      case 'department': job.department = incoming.department; break;
      case 'seniority': job.seniority = incoming.seniority; break;
      case 'description':
        if ((incoming.description?.text || '').length > (job.description?.text || '').length) {
          job.description = { ...incoming.description };
        }
        break;
      default: break;
    }
  }

  /* §35: prefer the ORIGINAL company/ATS apply URL. An aggregator redirect must
     never displace one, even when the aggregator was seen first. */
  const best = job.sourceInstances
    .filter((s) => s.applyUrl)
    .sort((a, b) => (SOURCE_AUTHORITY[b.sourceClass] ?? 0) - (SOURCE_AUTHORITY[a.sourceClass] ?? 0))[0];
  if (best) {
    job.canonicalApplyUrl = best.applyUrl;
    job.canonicalJobUrl = best.jobUrl || job.canonicalJobUrl;
  }

  /* sourcePublishedAt: if the current winner has none but another instance does,
     adopt the highest-authority instance that actually states one. */
  if (!job.sourcePublishedAt) {
    const dated = job.sourceInstances
      .filter((s) => s.sourcePublishedAt)
      .sort((a, b) => (SOURCE_AUTHORITY[b.sourceClass] ?? 0) - (SOURCE_AUTHORITY[a.sourceClass] ?? 0))[0];
    if (dated) job.sourcePublishedAt = dated.sourcePublishedAt;
  }

  if (job.status === JOB_STATUS.REMOVED) job.status = JOB_STATUS.ACTIVE;
  job.closedAt = null;

  return finalizeJobDocument(job);
}

/**
 * Find the duplicate of `incoming` among `candidates`.
 * @returns { job, stage, confidence, reason } | null
 */
export function findDuplicate(incoming, candidates = []) {
  let best = null;
  for (const c of candidates) {
    const r = isDuplicate(c, incoming);
    if (r.match && (!best || r.confidence > best.confidence)) {
      best = { job: c, ...r };
    }
  }
  return best;
}

/** Blocking key set — cheap pre-filter so dedupe is not O(n²) over the index. */
export function blockingKeys(job) {
  const keys = new Set();
  /* BOTH identities are emitted. A source that knows the employer's domain and
     one that only knows the name must land in the same block, or a genuine
     cross-source duplicate is never even offered to isDuplicate(). */
  const companyKeys = [job.company?.domain, job.company?.normalizedName].filter(Boolean);
  const locKey = locationKeyOf(job.locations || []);
  if (job.dedupeFingerprint) keys.add(`fp:${job.dedupeFingerprint}`);
  for (const companyKey of companyKeys) {
    keys.add(`co:${companyKey}`);
    if (job.normalizedTitle) keys.add(`ct:${companyKey}::${job.normalizedTitle}`);
    if (locKey) keys.add(`cl:${companyKey}::${locKey}`);
  }
  for (const s of job.sourceInstances || []) {
    if (s.provider && s.sourceJobId) keys.add(`pid:${s.provider}::${s.sourceJobId}`);
    if (s.applyUrl) keys.add(`ap:${s.applyUrl}`);
    if (!s.requisitionId) continue;
    for (const companyKey of companyKeys) keys.add(`req:${companyKey}::${s.requisitionId}`);
  }
  return [...keys];
}

export default {
  DEDUPE_STAGE, isDuplicate, findDuplicate, mergeJobs, blockingKeys,
  overmergeGuard, requisitionConflict, CONTENT_SIMILARITY_THRESHOLD,
};
