/* ============================================================
   RELEVANCE CORPUS
   ------------------------------------------------------------
   One shared corpus containing every graded title from every
   benchmark, exactly once.

   Sharing it is the point. A title that is the "irrelevant"
   distractor for one benchmark is the "exact" answer for another,
   so every distractor genuinely exists in the index. A per-query
   corpus would let a search engine pass the irrelevant-leak check
   by never having indexed the distractor at all.

   Every job is deliberately made EQUAL on the non-title signals —
   same company class, same recency, same completeness — so the
   benchmark measures title and taxonomy relevance rather than
   accidentally measuring the freshness boost.
   ============================================================ */

import { toCanonicalJob } from '../../../server/services/jobDiscovery/normalize/index.js';
import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS, JOB_STATUS } from '../../../server/services/jobDiscovery/schema.js';
import { RELEVANCE_BENCHMARKS, gradedTitles } from '../../../server/services/jobDiscovery/searchQualityEvaluator.js';

const SOURCE = {
  id: 'src_rel_gh',
  provider: PROVIDER.GREENHOUSE,
  sourceType: SOURCE_TYPE.ATS,
  sourceClass: SOURCE_CLASS.ORIGINAL_ATS,
  tenant: 'relevance-fixture',
};

/** Distinct titles across every benchmark, in a stable order. */
export function relevanceTitles() {
  const seen = new Set();
  const out = [];
  for (const b of RELEVANCE_BENCHMARKS) {
    for (const { title } of gradedTitles(b)) {
      if (seen.has(title)) continue;
      seen.add(title);
      out.push(title);
    }
  }
  return out;
}

export function buildRelevanceCorpus({ now = '2026-08-14T12:00:00.000Z' } = {}) {
  const titles = relevanceTitles();
  const jobs = titles.map((title, i) => {
    const job = toCanonicalJob({
      sourceJobId: `rel-${i}`,
      requisitionId: `REL-${i}`,
      title,
      company: { name: `Relevance Co ${i}`, domain: `relevance-co-${i}.example` },
      /* A neutral description: mentioning the title once and nothing else keeps
         the body signal identical across every document, so ordering differences
         come from the taxonomy rather than from description keyword stuffing. */
      descriptionText: `We are hiring a ${title}. You will collaborate with partner teams on delivery, quality and day-to-day operations.`,
      descriptionHtml: null,
      locationsRaw: ['Bengaluru, India'],
      applicantRegions: [],
      explicitRemote: null,
      workplaceHint: null,
      employmentTypeRaw: 'Full-time',
      department: null,
      jobUrl: `https://relevance.example/jobs/${i}`,
      applyUrl: `https://relevance.example/jobs/${i}/apply`,
      /* Identical dates: freshness must not decide these orderings. */
      sourcePublishedAt: '2026-08-10',
      validThrough: null,
      compensationStructured: null,
      compensationRaw: null,
      tags: [],
    }, SOURCE, { now });
    job.status = JOB_STATUS.ACTIVE;
    job.firstSeenAt = '2026-08-10T00:00:00.000Z';
    job.lastVerifiedAt = '2026-08-13T00:00:00.000Z';
    return job;
  });

  return { jobs, titles, source: SOURCE };
}

export default { buildRelevanceCorpus, relevanceTitles };
