/* ============================================================
   JOB DISCOVERY OS — SEARCH QUALITY EVALUATOR
   ------------------------------------------------------------
   "Search feels better" is not a claim anyone can check. This is
   the deterministic benchmark that makes ranking quality a number
   we can regress against.

   For each benchmark query the corpus contains five graded roles:

       exact          the literal role that was asked for
       alias          a different name for the SAME job
       strong         an adjacent role, frequently interchangeable
       related        same discipline, materially different job
       irrelevant     must NOT be returned at all

   Two things are measured, and they are different:

     ORDERING      exact ≥ alias ≥ strong ≥ related, and the
                   irrelevant role absent. This is the contract the
                   taxonomy promises, so it is asserted strictly.

     nDCG@5        a single score for how good the ordering is
                   overall, so a change that technically preserves
                   the ordering but degrades the shape still shows up.

   No resume, no profile, no candidate data is used anywhere here.
   That is the point: this is the quality of search for a visitor
   the app knows nothing about.
   ============================================================ */

export const GRADE = Object.freeze({
  EXACT: 'exact',
  ALIAS: 'alias',
  STRONG: 'strong',
  RELATED: 'related',
  IRRELEVANT: 'irrelevant',
});

/** Gain used by nDCG. Irrelevant scores zero — and is separately forbidden. */
export const GRADE_GAIN = Object.freeze({
  [GRADE.EXACT]: 7,
  [GRADE.ALIAS]: 5,
  [GRADE.STRONG]: 3,
  [GRADE.RELATED]: 1,
  [GRADE.IRRELEVANT]: 0,
});

/**
 * Twelve benchmark queries spanning engineering, data, product, marketing,
 * security, QA, frontend and mobile — deliberately NOT only the roles this
 * codebase's author works in, because a taxonomy that is only good at DevOps is
 * not a job search engine.
 */
export const RELEVANCE_BENCHMARKS = Object.freeze([
  {
    id: 'devops',
    query: 'DevOps Engineer',
    exact: 'DevOps Engineer',
    alias: 'CI/CD Engineer',
    strong: 'Site Reliability Engineer',
    related: 'Systems Engineer',
    irrelevant: 'Accountant',
  },
  {
    id: 'platform',
    query: 'Platform Engineer',
    exact: 'Platform Engineer',
    alias: 'Internal Platform Engineer',
    strong: 'Kubernetes Engineer',
    related: 'Cloud Engineer',
    irrelevant: 'Content Marketing Manager',
  },
  {
    /* The graded roles must reflect the TAXONOMY's own semantics, not a hunch.
       A multi-family query like "Java Backend" resolves JAVA_ENGINEER and
       BACKEND_ENGINEER as equals, which makes "Spring Boot Developer" and
       "Backend Engineer" both exact-family matches — there is no defensible
       ordering between them, and asserting one would be tuning the engine to
       the benchmark. This single-family query has a determinate ordering.
       Free-text parsing of "Java backend" is covered by the UNDERSTANDING
       benchmarks below, where it belongs. */
    id: 'java',
    query: 'Java Developer',
    exact: 'Java Developer',
    /* Same family (JAVA_ENGINEER) — an alias by definition is. */
    alias: 'Spring Boot Developer',
    /* A genuinely STRONGLY_RELATED family, not another Java alias.
       "Java Backend Engineer" also resolves primary JAVA_ENGINEER, so grading
       it "strong" would demand an ordering the taxonomy does not express. */
    strong: 'Backend Engineer',
    related: 'Full Stack Engineer',
    irrelevant: 'UX Researcher',
  },
  {
    id: 'data-engineer',
    query: 'Data Engineer',
    exact: 'Data Engineer',
    alias: 'ETL Developer',
    strong: 'Machine Learning Engineer',
    related: 'Data Analyst',
    irrelevant: 'Recruiter',
  },
  {
    id: 'data-scientist',
    query: 'Data Scientist',
    exact: 'Data Scientist',
    alias: 'Applied Scientist',
    strong: 'Machine Learning Engineer',
    related: 'Data Engineer',
    irrelevant: 'Network Engineer',
  },
  {
    id: 'product-manager',
    query: 'Product Manager',
    exact: 'Product Manager',
    alias: 'Product Owner',
    strong: 'Program Manager',
    related: 'Business Analyst',
    irrelevant: 'Android Engineer',
  },
  {
    id: 'marketing',
    query: 'Marketing Manager',
    exact: 'Marketing Manager',
    alias: 'Digital Marketing Manager',
    strong: 'Content Marketing Manager',
    related: 'Sales Manager',
    irrelevant: 'Data Engineer',
  },
  {
    id: 'cloud',
    query: 'Cloud Engineer',
    exact: 'Cloud Engineer',
    alias: 'AWS Engineer',
    strong: 'Infrastructure Engineer',
    related: 'Cloud Architect',
    irrelevant: 'Accountant',
  },
  {
    id: 'security',
    query: 'Security Engineer',
    exact: 'Security Engineer',
    alias: 'Application Security Engineer',
    strong: 'DevSecOps Engineer',
    related: 'Security Analyst',
    irrelevant: 'Product Designer',
  },
  {
    id: 'qa',
    query: 'QA Engineer',
    exact: 'QA Engineer',
    alias: 'SDET',
    strong: 'Software Engineer',
    related: 'DevOps Engineer',
    irrelevant: 'Financial Analyst',
  },
  {
    id: 'frontend',
    query: 'Frontend Engineer',
    exact: 'Frontend Engineer',
    alias: 'React Developer',
    strong: 'Full Stack Engineer',
    related: 'Mobile Engineer',
    irrelevant: 'Data Scientist',
  },
  {
    id: 'mobile',
    query: 'Mobile Engineer',
    exact: 'Mobile Engineer',
    alias: 'React Native Developer',
    strong: 'Android Engineer',
    related: 'Frontend Engineer',
    irrelevant: 'Marketing Manager',
  },
]);

/**
 * Free-text understanding benchmarks. These check that the query PARSER pulled
 * the right intent out of a messy string — separate from ranking, because a
 * ranking bug and a parsing bug need different fixes.
 */
export const UNDERSTANDING_BENCHMARKS = Object.freeze([
  { query: 'Java backend', expectFamilies: ['JAVA_ENGINEER', 'BACKEND_ENGINEER'], expectTechs: ['java'] },
  { query: 'AWS DevOps', expectFamilies: ['DEVOPS_ENGINEER'], expectTechs: ['aws'] },
  { query: 'Remote data engineer India', expectFamilies: ['DATA_ENGINEER'], expectLocation: 'India', expectRemote: 'remote' },
  { query: 'platform engineer kubernetes', expectFamilies: ['PLATFORM_ENGINEER'], expectTechs: ['kubernetes'] },
  { query: 'fresher software engineer', expectFamilies: ['SOFTWARE_ENGINEER'], expectSeniority: ['ENTRY'] },
  { query: 'senior python developer in Pune', expectFamilies: ['PYTHON_ENGINEER'], expectLocation: 'Pune', expectSeniority: ['SENIOR'] },
]);

export function gradedTitles(benchmark) {
  return [
    { title: benchmark.exact, grade: GRADE.EXACT },
    { title: benchmark.alias, grade: GRADE.ALIAS },
    { title: benchmark.strong, grade: GRADE.STRONG },
    { title: benchmark.related, grade: GRADE.RELATED },
    { title: benchmark.irrelevant, grade: GRADE.IRRELEVANT },
  ];
}

function dcg(gains) {
  return gains.reduce((acc, g, i) => acc + g / Math.log2(i + 2), 0);
}

/** nDCG@k for one result list against the graded corpus. */
export function ndcg(resultTitles, benchmark, k = 5) {
  const gradeByTitle = new Map(gradedTitles(benchmark).map((g) => [g.title, g.grade]));
  const gains = resultTitles.slice(0, k).map((t) => GRADE_GAIN[gradeByTitle.get(t)] ?? 0);
  const ideal = [...gradedTitles(benchmark)]
    .map((g) => GRADE_GAIN[g.grade])
    .sort((a, b) => b - a)
    .slice(0, k);
  const idealDcg = dcg(ideal);
  return idealDcg ? Math.round((dcg(gains) / idealDcg) * 1000) / 1000 : 0;
}

/**
 * Evaluate one benchmark against a search result list.
 *
 * @returns {{ id, query, ndcg, ordering: {ok, violations}, irrelevantReturned, returned }}
 */
export function evaluateBenchmark(benchmark, results) {
  const titles = results.map((r) => r.job?.title ?? r.title);
  const rankOf = (t) => {
    const i = titles.indexOf(t);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };

  const order = [
    [GRADE.EXACT, benchmark.exact],
    [GRADE.ALIAS, benchmark.alias],
    [GRADE.STRONG, benchmark.strong],
    [GRADE.RELATED, benchmark.related],
  ];

  const violations = [];
  for (let i = 0; i < order.length - 1; i += 1) {
    const [gradeA, titleA] = order[i];
    const [gradeB, titleB] = order[i + 1];
    const a = rankOf(titleA);
    const b = rankOf(titleB);
    /* A lower-graded role outranking a higher-graded one is the failure that
       matters. A missing lower-graded role is acceptable — suppressing a weak
       match is a legitimate choice; promoting it above a strong one is not. */
    if (a > b) {
      violations.push({
        expectedHigher: `${gradeA}:${titleA}`,
        rankedBelow: `${gradeB}:${titleB}`,
        ranks: [a === Infinity ? null : a + 1, b === Infinity ? null : b + 1],
      });
    }
  }

  const irrelevantReturned = titles.includes(benchmark.irrelevant);
  if (irrelevantReturned) {
    violations.push({ expectedAbsent: benchmark.irrelevant, rank: rankOf(benchmark.irrelevant) + 1 });
  }
  if (rankOf(benchmark.exact) !== 0) {
    violations.push({ expectedFirst: benchmark.exact, actualFirst: titles[0] ?? null });
  }

  return {
    id: benchmark.id,
    query: benchmark.query,
    ndcg: ndcg(titles, benchmark, 5),
    ordering: { ok: violations.length === 0, violations },
    irrelevantReturned,
    returned: titles,
  };
}

/** Aggregate across the whole benchmark suite. */
export function summarizeEvaluation(evaluations) {
  const total = evaluations.length;
  const passed = evaluations.filter((e) => e.ordering.ok).length;
  const meanNdcg = total
    ? Math.round((evaluations.reduce((a, e) => a + e.ndcg, 0) / total) * 1000) / 1000
    : 0;
  const worst = [...evaluations].sort((a, b) => a.ndcg - b.ndcg)[0] ?? null;
  return {
    benchmarks: total,
    passed,
    failed: total - passed,
    meanNdcg,
    minNdcg: worst ? worst.ndcg : 0,
    worstBenchmark: worst ? worst.id : null,
    irrelevantLeaks: evaluations.filter((e) => e.irrelevantReturned).map((e) => e.id),
  };
}

/** Quality thresholds the gate enforces. Deliberately explicit, not implicit. */
export const RELEVANCE_THRESHOLDS = Object.freeze({
  minMeanNdcg: 0.9,
  minPerQueryNdcg: 0.75,
  maxIrrelevantLeaks: 0,
  maxOrderingFailures: 0,
});

export default {
  RELEVANCE_BENCHMARKS, UNDERSTANDING_BENCHMARKS, GRADE, GRADE_GAIN,
  gradedTitles, ndcg, evaluateBenchmark, summarizeEvaluation, RELEVANCE_THRESHOLDS,
};
