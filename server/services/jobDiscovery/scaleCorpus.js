/* ============================================================
   JOB DISCOVERY OS — DETERMINISTIC SCALE CORPUS
   ------------------------------------------------------------
   Generates a large, REPRODUCIBLE job corpus for benchmarking.

   Deterministic on purpose: same seed, same corpus, byte for byte.
   A benchmark whose input changes between runs cannot tell you
   whether a regression is in your code or in your test data.

   The corpus deliberately contains the awkward cases, because a
   benchmark made only of clean rows measures nothing:

       duplicates              the same vacancy from several sources
       closed jobs             REMOVED records that must never surface
       stale jobs              downgraded but retained
       remote restrictions     "Remote — US only" is not worldwide
       multi-location roles    one posting, several offices
       undated postings        no sourcePublishedAt at all
       aggregator-only jobs    no direct provenance
       rare titles             one-in-100k roles that MUST stay findable

   THIS IS FIXTURE DATA. Every metric derived from it is a
   measurement of the ENGINE, never a claim about real coverage —
   which is why coverageMetrics refuses to emit it unlabelled.
   ============================================================ */

import { toCanonicalJob } from './normalize/index.js';
import { PROVIDER, SOURCE_TYPE, SOURCE_CLASS, JOB_STATUS } from './schema.js';

/** xorshift32 — small, fast, and identical across Node versions. */
export function makeRng(seed = 1) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0x100000000;
  };
}

const TITLE_BANK = [
  'DevOps Engineer', 'Senior DevOps Engineer', 'Platform Engineer', 'Site Reliability Engineer',
  'Cloud Engineer', 'Infrastructure Engineer', 'DevSecOps Engineer', 'Kubernetes Engineer',
  'Backend Engineer', 'Java Backend Engineer', 'Spring Boot Developer', 'Python Developer',
  'Node.js Engineer', 'Go Engineer', 'Frontend Engineer', 'React Developer', 'Full Stack Engineer',
  'Software Engineer', 'Senior Software Engineer', 'Mobile Engineer', 'Android Engineer',
  'iOS Engineer', 'QA Engineer', 'SDET', 'Data Engineer', 'ETL Developer', 'Data Scientist',
  'Machine Learning Engineer', 'Data Analyst', 'Business Analyst', 'Product Manager',
  'Product Owner', 'Program Manager', 'Project Manager', 'UX Designer', 'UX Researcher',
  'Marketing Manager', 'Digital Marketing Manager', 'Content Marketing Manager', 'Growth Manager',
  'Sales Manager', 'Account Manager', 'Customer Success Manager', 'Support Engineer',
  'Security Engineer', 'Security Analyst', 'Network Engineer', 'Systems Engineer',
  'Recruiter', 'HR Manager', 'Financial Analyst', 'Accountant', 'Operations Manager',
];

const LOCATION_BANK = [
  ['Bengaluru, India'], ['Pune, India'], ['Hyderabad, India'], ['Chennai, India'],
  ['Mumbai, India'], ['Gurugram, India'], ['Noida, India'],
  ['London, United Kingdom'], ['Berlin, Germany'], ['Amsterdam, Netherlands'],
  ['New York, United States'], ['San Francisco, United States'], ['Austin, United States'],
  ['Singapore'], ['Sydney, Australia'], ['Toronto, Canada'],
  ['Bengaluru, India', 'Pune, India'],
  ['London, United Kingdom', 'Berlin, Germany', 'Amsterdam, Netherlands'],
];

const TECH_BANK = [
  'kubernetes', 'terraform', 'aws', 'azure', 'gcp', 'docker', 'jenkins', 'argocd',
  'java', 'spring', 'python', 'django', 'react', 'typescript', 'kafka', 'spark',
  'airflow', 'pytorch', 'selenium', 'linux', 'helm', 'vault',
];

const DEPARTMENTS = ['Engineering', 'Platform', 'Data', 'Product', 'Marketing', 'Security', 'Operations', 'Finance'];

/**
 * Rare titles. These exist so the scale gate can prove the specific failure it
 * cares about: a one-in-100k posting must still be retrievable, and must not be
 * hidden behind a candidate budget.
 */
export const RARE_TITLES = Object.freeze([
  'Quantum Compiler Engineer',
  'Seismic Data Platform Engineer',
  'Cryogenic Systems Technician',
]);

function makeSourceDefs() {
  return {
    greenhouse: {
      id: 'src_fx_gh', provider: PROVIDER.GREENHOUSE, sourceType: SOURCE_TYPE.ATS,
      sourceClass: SOURCE_CLASS.ORIGINAL_ATS, tenant: 'fixture-gh',
    },
    lever: {
      id: 'src_fx_lv', provider: PROVIDER.LEVER, sourceType: SOURCE_TYPE.ATS,
      sourceClass: SOURCE_CLASS.ORIGINAL_ATS, tenant: 'fixture-lv',
    },
    workday: {
      id: 'src_fx_wd', provider: PROVIDER.WORKDAY, sourceType: SOURCE_TYPE.ATS,
      sourceClass: SOURCE_CLASS.ORIGINAL_ATS, tenant: 'fixture/wd1/External',
    },
    careersite: {
      id: 'src_fx_cs', provider: PROVIDER.GENERIC, sourceType: SOURCE_TYPE.CAREER_SITE,
      sourceClass: SOURCE_CLASS.ORIGINAL_CAREER_SITE, tenant: 'careers.fixture.example',
    },
    aggregator: {
      id: 'src_fx_agg', provider: PROVIDER.API, sourceType: SOURCE_TYPE.AGGREGATOR,
      sourceClass: SOURCE_CLASS.AGGREGATOR, tenant: 'fixture-aggregator',
    },
  };
}

/**
 * Generate the corpus.
 *
 * @returns {{ jobs, companies, sources, stats }}
 */
export function generateCorpus({
  jobCount = 100000,
  companyCount = 4000,
  sourceCount = 5200,
  seed = 20260814,
  now = '2026-08-14T12:00:00.000Z',
  duplicateRate = 0.08,
  closedRate = 0.05,
  staleRate = 0.03,
  undatedRate = 0.12,
  aggregatorOnlyRate = 0.15,
  remoteRate = 0.22,
} = {}) {
  const rng = makeRng(seed);
  const srcs = makeSourceDefs();
  const nowMs = Date.parse(now);

  const companies = [];
  for (let i = 0; i < companyCount; i += 1) {
    const name = `Fixture Company ${i}`;
    companies.push({
      id: `co_fx_${i}`,
      name,
      normalizedName: `fixture company ${i}`,
      /* Each fixture company gets its own REGISTRABLE domain. Sharing one
         parent domain ("companyN.fixture.example") collapses to a single
         registrable domain for every company, which turns the company blocking
         key into a match against the entire corpus — a fixture artefact that
         would make the dedupe benchmark meaningless. */
      domain: `fixture-company-${i}.example`,
      sourceIds: i % 4 === 0 ? [] : [srcs.greenhouse.id],
      atsProvider: i % 4 === 0 ? null : PROVIDER.GREENHOUSE,
      atsTenant: i % 4 === 0 ? null : `fixture-gh-${i}`,
      discoveryAttempts: i % 4 === 0 ? 1 : 0,
    });
  }

  const sources = [];
  for (let i = 0; i < sourceCount; i += 1) {
    const pick = i % 5;
    const base = [srcs.greenhouse, srcs.lever, srcs.workday, srcs.careersite, srcs.aggregator][pick];
    sources.push({
      ...base,
      id: `${base.id}_${i}`,
      tenant: `${base.tenant}-${i}`,
      companyId: `co_fx_${i % companyCount}`,
      status: i % 97 === 0 ? 'DEGRADED' : 'ACTIVE',
      accessPolicy: 'ALLOW',
      health: { successRate: i % 97 === 0 ? 0.3 : 0.95, window: [], newJobRate: rng() * 0.3 },
    });
  }

  const jobs = [];
  const stats = {
    duplicates: 0, closed: 0, stale: 0, undated: 0, aggregatorOnly: 0,
    remoteRestricted: 0, multiLocation: 0, rare: 0,
  };

  let seq = 0;
  const pushJob = (spec) => {
    seq += 1;
    const source = spec.source;
    const canonical = toCanonicalJob({
      sourceJobId: `fx-${seq}`,
      /* `null` means "this source published no requisition id" — which is
         exactly the aggregator case. Coalescing null to a generated id gave the
         duplicate a DIFFERENT requisition number, and the anti-overmerge guard
         then correctly refused to merge it, making the dedupe benchmark
         measure nothing. undefined means "not specified by this fixture". */
      requisitionId: spec.requisitionId === undefined ? `FXREQ-${seq}` : spec.requisitionId,
      title: spec.title,
      company: { name: spec.company.name, domain: spec.company.domain },
      descriptionText: spec.description,
      descriptionHtml: null,
      locationsRaw: spec.locations,
      applicantRegions: spec.applicantRegions ?? [],
      explicitRemote: spec.explicitRemote ?? null,
      workplaceHint: spec.workplaceHint ?? null,
      employmentTypeRaw: spec.employmentType ?? null,
      department: spec.department ?? null,
      jobUrl: `https://fixture.example/${source.tenant}/jobs/${seq}`,
      applyUrl: `https://fixture.example/${source.tenant}/jobs/${seq}/apply`,
      sourcePublishedAt: spec.publishedAt,
      validThrough: null,
      compensationStructured: spec.salary ?? null,
      compensationRaw: null,
      tags: spec.tags ?? [],
    }, source, { now: spec.firstSeenAt || now });

    canonical.status = spec.status ?? JOB_STATUS.ACTIVE;
    if (spec.firstSeenAt) canonical.firstSeenAt = spec.firstSeenAt;
    if (spec.lastVerifiedAt) canonical.lastVerifiedAt = spec.lastVerifiedAt;
    /* Ids are derived from company+title+location, so a distinct requisition id
       keeps intentionally-distinct fixtures from collapsing into one record. */
    canonical.id = `${canonical.id}_${seq}`;
    jobs.push(canonical);
    return canonical;
  };

  const target = jobCount;
  while (jobs.length < target) {
    const i = jobs.length;
    const company = companies[Math.floor(rng() * companyCount)];
    /* Rare titles are placed proportionally so the "1-in-N posting is still
       findable" property is exercised at ANY corpus size, not only at 100k. */
    const rareStride = Math.max(1, Math.floor(target / (RARE_TITLES.length + 1)));
    const isRare = i > 0 && i % rareStride === 0 && stats.rare < RARE_TITLES.length;
    const title = isRare
      ? RARE_TITLES[stats.rare % RARE_TITLES.length]
      : TITLE_BANK[Math.floor(rng() * TITLE_BANK.length)];
    if (isRare) stats.rare += 1;

    const locations = LOCATION_BANK[Math.floor(rng() * LOCATION_BANK.length)];
    if (locations.length > 1) stats.multiLocation += 1;

    const r = rng();
    const undated = r < undatedRate;
    if (undated) stats.undated += 1;
    const ageDays = Math.floor(rng() * 120);
    const publishedAt = undated ? null : new Date(nowMs - ageDays * 86400000).toISOString();

    const aggregatorOnly = rng() < aggregatorOnlyRate;
    if (aggregatorOnly) stats.aggregatorOnly += 1;
    const sourcePool = aggregatorOnly
      ? [srcs.aggregator]
      : [srcs.greenhouse, srcs.lever, srcs.workday, srcs.careersite];
    const source = sourcePool[Math.floor(rng() * sourcePool.length)];

    let explicitRemote = null;
    let applicantRegions = [];
    let workplaceHint = null;
    if (rng() < remoteRate) {
      explicitRemote = true;
      if (rng() < 0.5) {
        /* Scoped remote. The evidence-based classifier must NOT turn this into
           worldwide remote, and the scale gate checks exactly that. */
        applicantRegions = ['United States'];
        workplaceHint = 'Remote — US only';
        stats.remoteRestricted += 1;
      } else {
        workplaceHint = 'Remote';
      }
    }

    const techs = [
      TECH_BANK[Math.floor(rng() * TECH_BANK.length)],
      TECH_BANK[Math.floor(rng() * TECH_BANK.length)],
    ];

    let status = JOB_STATUS.ACTIVE;
    const s = rng();
    if (!isRare) {
      if (s < closedRate) { status = JOB_STATUS.REMOVED; stats.closed += 1; }
      else if (s < closedRate + staleRate) { status = JOB_STATUS.STALE; stats.stale += 1; }
    }

    const job = pushJob({
      title,
      company,
      source,
      locations,
      publishedAt,
      explicitRemote,
      applicantRegions,
      workplaceHint,
      department: DEPARTMENTS[Math.floor(rng() * DEPARTMENTS.length)],
      employmentType: rng() < 0.08 ? 'Internship' : 'Full-time',
      status,
      firstSeenAt: new Date(nowMs - Math.floor(rng() * 90) * 86400000).toISOString(),
      lastVerifiedAt: rng() < 0.55 ? new Date(nowMs - Math.floor(rng() * 10) * 86400000).toISOString() : null,
      description: `We are hiring a ${title}. The role works with ${techs.join(' and ')} alongside partner teams on delivery, quality and operational excellence. Responsibilities include design, implementation, review and on-call participation.`,
      tags: techs,
      salary: rng() < 0.25 ? { minValue: 800000 + Math.floor(rng() * 2000000), maxValue: 3000000, currency: 'INR', interval: 'YEAR' } : null,
    });

    /* Duplicates: the SAME vacancy arriving from an aggregator as well. These
       exist to exercise dedupe throughput and the original-source preference. */
    if (jobs.length < target && rng() < duplicateRate) {
      stats.duplicates += 1;
      pushJob({
        title: job.title,
        company,
        source: srcs.aggregator,
        locations,
        publishedAt,
        explicitRemote,
        applicantRegions,
        workplaceHint,
        department: job.department,
        status: JOB_STATUS.ACTIVE,
        requisitionId: null,
        firstSeenAt: new Date(nowMs - Math.floor(rng() * 5) * 86400000).toISOString(),
        /* A real cross-posting carries the employer's own description, which is
           what makes content-similarity dedupe work at all. A trailing
           aggregator banner is added so the texts are near-identical rather
           than byte-identical — the realistic case. */
        description: `${job.description.text} Apply now via our partner listing.`,
        tags: techs,
      });
    }
  }

  return { jobs: jobs.slice(0, target), companies, sources, stats, seed, generatedFor: 'FIXTURE' };
}

export default { generateCorpus, makeRng, RARE_TITLES, TITLE_BANK };
