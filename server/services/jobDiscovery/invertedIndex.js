/* ============================================================
   JOB DISCOVERY OS — INVERTED INDEX  (SEARCH_SCALE_GATE)
   ------------------------------------------------------------
   The phase-1 memory/file store answered searchCandidates() by
   walking every job and filtering in Node. At 100k jobs that is
   both slow AND WRONG: the first-N slice silently hides relevant
   postings behind an arbitrary scan limit.

   This module replaces that with a real inverted index:

     term      -> sorted postings list of dense integer doc ids
     family    -> postings
     company   -> postings
     country / city / workplace / employment / seniority /
     sourceClass / status  -> postings

   Retrieval never touches a document the query cannot match. When
   a posting list is larger than the candidate budget the index
   does NOT take the first N — it scores every matching doc with a
   cheap deterministic prefilter (family weight, term hits, source
   authority, recency) and returns the strongest `cap`, reporting
   `matchedTotal` and `truncated` so the caller can prove nothing
   relevant was dropped by an arbitrary limit.

   Ids are dense integers, postings are plain ascending arrays and
   removals are tombstoned, so 100k documents cost tens of MB
   rather than hundreds.
   ============================================================ */

import { tokens } from './normalize/text.js';
import { JOB_STATUS, SOURCE_AUTHORITY, WORKPLACE_TYPE } from './schema.js';

/** Tokens indexed from the description body. Bounded so memory stays linear. */
export const MAX_BODY_TERMS = 48;
export const COMPACT_TOMBSTONE_RATIO = 0.25;

function pushPosting(map, key, docId) {
  if (!key) return;
  let arr = map.get(key);
  if (!arr) { arr = []; map.set(key, arr); }
  /* Doc ids are allocated monotonically, so append keeps the list sorted. */
  if (arr[arr.length - 1] !== docId) arr.push(docId);
}

/** Field terms carry more weight than body terms and are tracked separately. */
export function indexableTerms(job) {
  const field = new Set();
  for (const t of tokens(job.title || '')) field.add(t);
  for (const t of tokens(job.company?.name || '')) field.add(t);
  for (const t of tokens(job.department || '')) field.add(t);
  for (const tag of job.tags || []) for (const t of tokens(tag)) field.add(t);
  for (const loc of job.locations || []) {
    for (const t of tokens(`${loc.city || ''} ${loc.region || ''} ${loc.country || ''}`)) field.add(t);
  }

  const body = new Set();
  const text = String(job.description?.text || '').slice(0, 6000);
  for (const t of tokens(text)) {
    if (field.has(t) || body.has(t)) continue;
    body.add(t);
    if (body.size >= MAX_BODY_TERMS) break;
  }
  return { field, body };
}

export class InvertedIndex {
  constructor() {
    this.docs = [];              // docId -> job
    this.meta = [];              // docId -> precomputed scoring metadata
    this.idToDoc = new Map();    // job.id -> docId
    this.deleted = new Set();    // tombstoned docIds

    this.terms = new Map();      // field term -> postings
    this.bodyTerms = new Map();  // body term  -> postings
    this.families = new Map();
    this.companies = new Map();
    this.countries = new Map();
    this.cities = new Map();
    this.workplace = new Map();
    this.employment = new Map();
    this.seniority = new Map();
    this.sourceClasses = new Map();
    this.statuses = new Map();
    this.providers = new Map();
    this.remoteRegions = new Map();
    this.directApply = [];       // postings of jobs whose apply url is original
    this.dated = [];             // postings of jobs with a real sourcePublishedAt
  }

  get size() { return this.idToDoc.size; }

  add(job) {
    const prev = this.idToDoc.get(job.id);
    if (prev != null) this.deleted.add(prev);

    const docId = this.docs.length;
    this.docs.push(job);
    this.idToDoc.set(job.id, docId);
    /* Everything the retrieval prefilter needs, computed ONCE at insert.
       Re-deriving title tokens and source authority for every matched document
       on every query was the dominant cost in the 100k benchmark — retrieval
       spent longer preparing to score than the ranker spent scoring. */
    this.meta.push(buildMeta(job));

    const { field, body } = indexableTerms(job);
    for (const t of field) pushPosting(this.terms, t, docId);
    for (const t of body) pushPosting(this.bodyTerms, t, docId);

    for (const fam of new Set([job.titleFamily, ...(job.titleFamilies || [])].filter(Boolean))) {
      pushPosting(this.families, fam, docId);
    }
    pushPosting(this.companies, job.company?.normalizedName || '', docId);
    for (const loc of job.locations || []) {
      pushPosting(this.countries, loc.countryCode || '', docId);
      pushPosting(this.cities, loc.city || '', docId);
    }
    for (const r of job.workplace?.remoteRegions || []) pushPosting(this.remoteRegions, r, docId);
    pushPosting(this.workplace, job.workplace?.type || WORKPLACE_TYPE.UNKNOWN, docId);
    pushPosting(this.employment, job.employmentType || 'UNKNOWN', docId);
    pushPosting(this.seniority, job.seniority || 'UNKNOWN', docId);
    pushPosting(this.statuses, job.status || JOB_STATUS.NEW, docId);
    for (const s of job.sourceInstances || []) {
      pushPosting(this.sourceClasses, s.sourceClass, docId);
      pushPosting(this.providers, s.provider, docId);
    }
    if (isDirectApply(job)) this.directApply.push(docId);
    if (job.sourcePublishedAt) this.dated.push(docId);

    if (this.deleted.size > Math.max(1000, this.docs.length * COMPACT_TOMBSTONE_RATIO)) this.compact();
    return docId;
  }

  remove(id) {
    const docId = this.idToDoc.get(id);
    if (docId == null) return false;
    this.deleted.add(docId);
    this.idToDoc.delete(id);
    return true;
  }

  get(id) {
    const docId = this.idToDoc.get(id);
    if (docId == null || this.deleted.has(docId)) return null;
    return this.docs[docId];
  }

  /** Rebuild without tombstones. O(live docs); amortised across many writes. */
  compact() {
    const live = [];
    for (const [id, docId] of this.idToDoc.entries()) {
      if (!this.deleted.has(docId)) live.push([id, this.docs[docId]]);
    }
    this.docs = [];
    this.meta = [];
    this.idToDoc = new Map();
    this.deleted = new Set();
    for (const m of [this.terms, this.bodyTerms, this.families, this.companies, this.countries,
      this.cities, this.workplace, this.employment, this.seniority, this.sourceClasses,
      this.statuses, this.providers, this.remoteRegions]) m.clear();
    this.directApply = [];
    this.dated = [];
    for (const [, job] of live) this.add(job);
    return this.docs.length;
  }

  *live() {
    for (let i = 0; i < this.docs.length; i += 1) {
      if (!this.deleted.has(i)) yield this.docs[i];
    }
  }

  /**
   * Bounded, exhaustive-then-ranked candidate retrieval.
   *
   * @param spec.familyKeys      role families with weights (Map or array)
   * @param spec.queryTerms      free-text terms
   * @param spec.statuses        allowed job statuses
   * @param spec.filters         { companyNormalized, countryCode, city, workplaceType,
   *                               employmentType, seniority, sourceClass, remoteRegions }
   * @param spec.cap             candidate budget
   * @returns { docs, matchedTotal, truncated, strategy }
   */
  retrieve(spec = {}) {
    const cap = Math.max(1, Number(spec.cap) || 500);
    const statuses = spec.statuses?.length ? spec.statuses : [JOB_STATUS.NEW, JOB_STATUS.ACTIVE, JOB_STATUS.LIKELY_ACTIVE];
    const statusMask = new Set(statuses);

    const familyWeights = normalizeFamilyWeights(spec.familyKeys);
    const queryTerms = [...new Set(spec.queryTerms || [])];
    const filters = spec.filters || {};

    /* -------- 1. pick the driving posting set -------- */
    const seeds = [];
    for (const fam of familyWeights.keys()) {
      const p = this.families.get(fam);
      if (p) seeds.push({ postings: p, kind: 'family', key: fam });
    }
    for (const term of queryTerms) {
      const p = this.terms.get(term);
      if (p) seeds.push({ postings: p, kind: 'term', key: term });
      const b = this.bodyTerms.get(term);
      if (b) seeds.push({ postings: b, kind: 'body', key: term });
    }

    /* Structural filters can themselves be the driver when there is no query. */
    const filterPostings = this.filterPostings(filters);
    let strategy = 'union';
    let scan;

    if (!seeds.length) {
      if (filterPostings.length) {
        strategy = 'filter-driven';
        scan = smallestOf(filterPostings);
      } else {
        strategy = 'full-status';
        scan = unionPostings(statuses.map((s) => this.statuses.get(s)).filter(Boolean));
      }
    } else {
      /* When a filter is far more selective than the query union, drive from it —
         this is what keeps "company + rare title" queries cheap on 100k docs. */
      const seedCost = seeds.reduce((a, s) => a + s.postings.length, 0);
      const smallestFilter = filterPostings.length ? smallestOf(filterPostings) : null;
      if (smallestFilter && smallestFilter.length * 4 < seedCost) {
        strategy = 'filter-driven';
        scan = smallestFilter;
      } else {
        scan = null; // handled by weighted union below
      }
    }

    /* -------- 2. score every matching doc (never a blind first-N slice) -------- */
    const scores = new Map(); // docId -> prefilter score
    const addScore = (docId, delta) => {
      const cur = scores.get(docId);
      scores.set(docId, cur == null ? delta : cur + delta);
    };

    if (scan) {
      for (const docId of scan) {
        if (this.deleted.has(docId)) continue;
        const job = this.docs[docId];
        if (!statusMask.has(job.status)) continue;
        if (!this.matchesFilters(job, filters)) continue;
        addScore(docId, 1 + this.familyBonus(docId, familyWeights) + this.termBonus(docId, queryTerms));
      }
    } else {
      for (const seed of seeds) {
        const weight = seed.kind === 'family'
          ? 6 * (familyWeights.get(seed.key) ?? 0.4)
          : (seed.kind === 'term' ? 2 : 0.6);
        for (const docId of seed.postings) {
          if (this.deleted.has(docId)) continue;
          const job = this.docs[docId];
          if (!statusMask.has(job.status)) continue;
          if (!this.matchesFilters(job, filters)) continue;
          addScore(docId, weight);
        }
      }
    }

    const matchedTotal = scores.size;
    if (!matchedTotal) return { docs: [], matchedTotal: 0, truncated: false, strategy };

    /* Quality tie-breakers so truncation, when it happens, drops the WEAKEST
       candidates rather than whichever ones the store happened to visit last. */
    const nowMs = Date.now();
    const entries = new Array(matchedTotal);
    let i = 0;
    for (const [docId, base] of scores) {
      entries[i] = [docId, base + qualityBonus(this.meta[docId], nowMs)];
      i += 1;
    }

    if (matchedTotal <= cap) {
      entries.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      return { docs: entries.map(([docId]) => this.docs[docId]), matchedTotal, truncated: false, strategy };
    }

    const top = selectTop(entries, cap);
    return { docs: top.map(([docId]) => this.docs[docId]), matchedTotal, truncated: true, strategy };
  }

  familyBonus(docId, familyWeights) {
    if (!familyWeights.size) return 0;
    const fams = this.meta[docId]?.families;
    if (!fams) return 0;
    let best = 0;
    for (const fam of fams) {
      const w = familyWeights.get(fam);
      if (w != null && w > best) best = w;
    }
    return best * 6;
  }

  termBonus(docId, queryTerms) {
    if (!queryTerms.length) return 0;
    const title = this.meta[docId]?.titleTerms;
    if (!title) return 0;
    let hits = 0;
    for (const t of queryTerms) if (title.has(t)) hits += 1;
    return hits * 2;
  }

  /**
   * Posting lists that may DRIVE a scan.
   *
   * A driver must be a SUPERSET of everything the filter can accept. Several
   * filters are disjunctions rather than equalities — an employment-type filter
   * also accepts UNKNOWN, and a location filter also accepts an unrestricted
   * remote role with no offices at all. Driving a scan from the narrow half of
   * such a filter silently deletes the other half from the result set, which is
   * exactly the class of bug that makes a search engine quietly lose jobs.
   */
  filterPostings(filters = {}) {
    const out = [];
    const push = (map, key) => { const p = key ? map.get(key) : null; if (p) out.push(p); };

    /* --- true equalities: safe to drive from --- */
    push(this.companies, filters.companyNormalized);
    push(this.workplace, filters.workplaceType);
    push(this.sourceClasses, filters.sourceClass);
    if (filters.directApply) out.push(this.directApply);

    /* --- disjunctions: drive only from the full union --- */
    if (filters.employmentType) {
      out.push(unionPostings([
        this.employment.get(filters.employmentType),
        this.employment.get('UNKNOWN'),
      ].filter(Boolean)));
    }
    if (Array.isArray(filters.seniority) && filters.seniority.length) {
      out.push(unionPostings([
        ...filters.seniority.map((s) => this.seniority.get(s)),
        this.seniority.get('UNKNOWN'),
      ].filter(Boolean)));
    }
    const locationDriver = this.locationDriver(filters);
    if (locationDriver) out.push(locationDriver);

    return out.filter((p) => p && p.length);
  }

  /** Superset of every doc a location filter can accept, remote roles included. */
  locationDriver(filters = {}) {
    if (!filters.city && !filters.countryCode && !(filters.remoteRegions || []).length) return null;
    const parts = [
      filters.city ? this.cities.get(filters.city) : null,
      filters.countryCode ? this.countries.get(filters.countryCode) : null,
      ...(filters.remoteRegions || []).map((r) => this.remoteRegions.get(r)),
      /* Any remote role can be location-compatible; the evidence-based ranker
         makes the final call, so the driver must include all of them. */
      this.workplace.get(WORKPLACE_TYPE.REMOTE),
    ].filter(Boolean);
    return parts.length ? unionPostings(parts) : null;
  }

  matchesFilters(job, filters = {}) {
    if (filters.companyNormalized && (job.company?.normalizedName || '') !== filters.companyNormalized) return false;
    if (filters.workplaceType && job.workplace?.type !== filters.workplaceType) return false;
    if (filters.employmentType) {
      const have = job.employmentType || 'UNKNOWN';
      if (have !== 'UNKNOWN' && have !== filters.employmentType) return false;
    }
    if (Array.isArray(filters.seniority) && filters.seniority.length) {
      const have = job.seniority || 'UNKNOWN';
      if (have !== 'UNKNOWN' && !filters.seniority.includes(have)) return false;
    }
    if (filters.sourceClass) {
      const has = (job.sourceInstances || []).some((s) => s.sourceClass === filters.sourceClass || s.sourceType === filters.sourceClass);
      if (!has) return false;
    }
    if (filters.city || filters.countryCode || (filters.remoteRegions || []).length) {
      /* Location is a CANDIDATE hint only. Remote roles that could serve the
         query location must survive to the deterministic ranker, which owns
         the evidence-based compatibility decision. */
      const cityHit = filters.city && (job.locations || []).some((l) => l.city === filters.city);
      const countryHit = filters.countryCode && (job.locations || []).some((l) => l.countryCode === filters.countryCode);
      const regionHit = (filters.remoteRegions || []).some((r) => (job.workplace?.remoteRegions || []).includes(r));
      const openRemote = job.workplace?.type === WORKPLACE_TYPE.REMOTE
        && ['REMOTE_WORLDWIDE', 'UNKNOWN'].includes(job.workplace?.remoteScope);
      if (!cityHit && !countryHit && !regionHit && !openRemote) return false;
    }
    return true;
  }

  stats() {
    return {
      docs: this.idToDoc.size,
      tombstones: this.deleted.size,
      fieldTerms: this.terms.size,
      bodyTerms: this.bodyTerms.size,
      families: this.families.size,
      companies: this.companies.size,
      cities: this.cities.size,
      countries: this.countries.size,
    };
  }
}

/* ------------------------------ helpers ------------------------------ */

function isDirectApply(job) {
  const url = job.canonicalApplyUrl;
  if (!url) return false;
  return (job.sourceInstances || []).some(
    (s) => s.applyUrl === url && (s.sourceClass === 'ORIGINAL_ATS' || s.sourceClass === 'ORIGINAL_CAREER_SITE'),
  );
}

function buildMeta(job) {
  let best = 0;
  for (const s of job.sourceInstances || []) {
    const a = SOURCE_AUTHORITY[s.sourceClass] ?? 0;
    if (a > best) best = a;
  }
  return {
    titleTerms: new Set(tokens(job.title || '')),
    families: [job.titleFamily, ...(job.titleFamilies || [])].filter(Boolean),
    authority: best / 400,
    complete: (job.completeness ?? 0) / 100,
    atMs: Date.parse(job.sourcePublishedAt || job.firstSeenAt || '') || 0,
  };
}

function qualityBonus(meta, nowMs) {
  if (!meta) return 0;
  const days = meta.atMs ? (nowMs - meta.atMs) / 86400000 : 999;
  const recency = Math.max(0, 1 - Math.min(1, days / 60)); // 0..1 over ~2 months
  return meta.authority * 1.5 + recency * 1.2 + meta.complete * 0.6;
}

function normalizeFamilyWeights(familyKeys) {
  const out = new Map();
  if (!familyKeys) return out;
  if (familyKeys instanceof Map) {
    for (const [k, v] of familyKeys) out.set(k, typeof v === 'number' ? v : (v?.weight ?? 0.5));
    return out;
  }
  for (const k of familyKeys) out.set(k, 1);
  return out;
}

function smallestOf(lists) {
  let best = lists[0];
  for (const l of lists) if (l.length < best.length) best = l;
  return best;
}

function unionPostings(lists) {
  if (!lists.length) return [];
  if (lists.length === 1) return lists[0];
  const seen = new Set();
  for (const l of lists) for (const d of l) seen.add(d);
  return [...seen].sort((a, b) => a - b);
}

/**
 * Bounded top-k selection. Avoids sorting a 60k-entry array to keep 300 rows.
 * Deterministic: ties break on ascending docId.
 */
export function selectTop(entries, k) {
  if (entries.length <= k) return entries.slice().sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  /* Quickselect-style threshold pass, then an exact sort of the survivors. */
  const scores = entries.map((e) => e[1]);
  const threshold = approximateKthLargest(scores, k);
  const kept = [];
  const ties = [];
  for (const e of entries) {
    if (e[1] > threshold) kept.push(e);
    else if (e[1] === threshold) ties.push(e);
  }
  ties.sort((a, b) => a[0] - b[0]);
  for (const t of ties) { if (kept.length >= k) break; kept.push(t); }
  kept.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return kept.slice(0, k);
}

function approximateKthLargest(values, k) {
  let lo = 0;
  let hi = values.length - 1;
  const arr = values.slice();
  const target = k - 1;
  while (lo < hi) {
    const pivot = arr[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (arr[i] > pivot) i += 1;
      while (arr[j] < pivot) j -= 1;
      if (i <= j) { const t = arr[i]; arr[i] = arr[j]; arr[j] = t; i += 1; j -= 1; }
    }
    if (target <= j) hi = j;
    else if (target >= i) lo = i;
    else break;
  }
  return arr[target];
}

export default { InvertedIndex, indexableTerms, selectTop, MAX_BODY_TERMS };
