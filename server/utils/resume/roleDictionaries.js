/* ============================================================
   ROLE DICTIONARIES + SKILL ALIASES
   ------------------------------------------------------------
   Each role declares weighted skill buckets. mustHave carries the most
   weight. Every keyword may have aliases so word-boundary matching can
   recognise common variants (e.g. "k8s" -> "kubernetes").
   ============================================================ */

/* Canonical skill -> alias list. Matching is done on aliases too. */
export const SKILL_ALIASES = {
  kubernetes: ['k8s', 'kube'],
  docker: ['containerization', 'containers'],
  'ci/cd': ['cicd', 'ci cd', 'continuous integration', 'continuous delivery', 'continuous deployment'],
  'github actions': ['gh actions'],
  'gitlab ci': ['gitlab-ci', 'gitlab pipelines'],
  javascript: ['js', 'es6', 'ecmascript'],
  typescript: ['ts'],
  'node.js': ['node', 'nodejs'],
  'react': ['react.js', 'reactjs'],
  'next.js': ['next', 'nextjs'],
  postgresql: ['postgres', 'psql'],
  mongodb: ['mongo'],
  'rest api': ['rest', 'restful', 'rest apis'],
  graphql: ['gql'],
  'machine learning': ['ml'],
  'deep learning': ['dl'],
  'natural language processing': ['nlp'],
  python: ['py'],
  'amazon web services': ['aws'],
  'google cloud platform': ['gcp', 'google cloud'],
  azure: ['microsoft azure'],
  terraform: ['iac', 'infrastructure as code'],
  'power bi': ['powerbi'],
  kubernetes_sre: ['sre', 'site reliability'],
  'unit testing': ['unit tests'],
  'a/b testing': ['ab testing', 'split testing'],
};

export const ROLE_DICTIONARIES = {
  'Data Engineer': {
    mustHave: ['sql', 'python', 'spark', 'etl', 'data pipeline'],
    goodToHave: ['pyspark', 'airflow', 'kafka', 'data warehouse', 'data modeling', 'dbt', 'streaming', 'data lake', 'iceberg', 'databricks'],
    tools: ['airflow', 'dbt', 'git', 'docker', 'glue', 'emr'],
    cloud: ['aws', 'azure', 'gcp', 's3', 'redshift', 'bigquery'],
    languages: ['python', 'sql', 'scala', 'java'],
    databases: ['snowflake', 'redshift', 'postgresql', 'mysql', 'mongodb', 'cassandra'],
    testing: ['great expectations', 'pytest', 'data quality'],
  },
  'DevOps Engineer': {
    mustHave: ['kubernetes', 'docker', 'ci/cd', 'terraform', 'jenkins'],
    goodToHave: ['gitlab ci', 'github actions', 'ansible', 'openshift', 'helm', 'sre', 'incident', 'deployment', 'monitoring'],
    tools: ['jenkins', 'helm', 'ansible', 'sonarqube', 'veracode', 'argocd', 'vault'],
    cloud: ['aws', 'azure', 'gcp', 'openshift'],
    languages: ['bash', 'python', 'go', 'groovy', 'shell'],
    databases: ['postgresql', 'mysql', 'redis'],
    testing: ['prometheus', 'grafana', 'sonarqube', 'veracode'],
  },
  'Software Engineer': {
    mustHave: ['data structures', 'algorithms', 'oop', 'git', 'rest api'],
    goodToHave: ['microservices', 'design patterns', 'system design', 'agile', 'unit testing', 'ci/cd'],
    tools: ['git', 'docker', 'jira', 'postman', 'maven', 'gradle'],
    cloud: ['aws', 'azure', 'gcp'],
    languages: ['java', 'python', 'c++', 'javascript', 'typescript', 'go', 'c#'],
    databases: ['sql', 'postgresql', 'mysql', 'mongodb', 'redis'],
    testing: ['junit', 'jest', 'pytest', 'selenium'],
  },
  'Frontend Developer': {
    mustHave: ['react', 'javascript', 'html', 'css', 'responsive design'],
    goodToHave: ['typescript', 'redux', 'next.js', 'tailwind', 'accessibility', 'web performance', 'vite'],
    tools: ['webpack', 'vite', 'git', 'figma', 'storybook', 'npm'],
    cloud: ['vercel', 'netlify', 'aws amplify'],
    languages: ['javascript', 'typescript', 'html', 'css', 'sass'],
    databases: ['graphql', 'rest api', 'firebase'],
    testing: ['jest', 'cypress', 'react testing library', 'playwright'],
  },
  'Backend Developer': {
    mustHave: ['rest api', 'database', 'authentication', 'node.js', 'sql'],
    goodToHave: ['microservices', 'caching', 'message queue', 'docker', 'system design', 'orm'],
    tools: ['docker', 'git', 'postman', 'kafka', 'rabbitmq', 'redis'],
    cloud: ['aws', 'azure', 'gcp'],
    languages: ['node.js', 'java', 'python', 'go', 'c#', 'express', 'spring boot'],
    databases: ['postgresql', 'mysql', 'mongodb', 'redis', 'sql', 'nosql'],
    testing: ['jest', 'junit', 'pytest', 'mocha'],
  },
  'Full Stack Developer': {
    mustHave: ['react', 'node.js', 'rest api', 'database', 'javascript'],
    goodToHave: ['typescript', 'mern', 'express', 'docker', 'next.js', 'authentication', 'deployment'],
    tools: ['git', 'docker', 'webpack', 'vite', 'postman'],
    cloud: ['aws', 'azure', 'gcp', 'vercel', 'netlify'],
    languages: ['javascript', 'typescript', 'node.js', 'python', 'java'],
    databases: ['mongodb', 'postgresql', 'mysql', 'sql', 'redis'],
    testing: ['jest', 'cypress', 'mocha', 'playwright'],
  },
  'Data Analyst': {
    mustHave: ['sql', 'excel', 'data visualization', 'dashboard', 'analysis'],
    goodToHave: ['power bi', 'tableau', 'python', 'statistics', 'reporting', 'etl', 'kpi'],
    tools: ['power bi', 'tableau', 'excel', 'looker', 'google analytics'],
    cloud: ['aws', 'azure', 'bigquery', 'snowflake'],
    languages: ['sql', 'python', 'r', 'dax'],
    databases: ['sql', 'mysql', 'postgresql', 'snowflake', 'bigquery'],
    testing: [],
  },
  'Data Scientist': {
    mustHave: ['python', 'machine learning', 'statistics', 'pandas', 'model'],
    goodToHave: ['deep learning', 'nlp', 'feature engineering', 'scikit-learn', 'tensorflow', 'pytorch', 'numpy'],
    tools: ['jupyter', 'mlflow', 'airflow', 'spark', 'docker'],
    cloud: ['aws', 'azure', 'gcp', 'sagemaker', 'databricks'],
    languages: ['python', 'r', 'sql', 'scala'],
    databases: ['sql', 'postgresql', 'mongodb', 'bigquery', 'snowflake'],
    testing: ['scikit-learn', 'tensorflow', 'pytorch', 'keras'],
  },
  'QA Engineer': {
    mustHave: ['test cases', 'automation testing', 'selenium', 'bug tracking', 'manual testing'],
    goodToHave: ['api testing', 'regression testing', 'test plan', 'cypress', 'ci/cd', 'jmeter'],
    tools: ['selenium', 'cypress', 'jira', 'postman', 'jmeter', 'testng'],
    cloud: ['aws', 'browserstack', 'sauce labs'],
    languages: ['java', 'python', 'javascript'],
    databases: ['sql', 'mysql'],
    testing: ['selenium', 'cypress', 'junit', 'testng', 'pytest', 'playwright', 'appium'],
  },
  'Cloud Engineer': {
    mustHave: ['aws', 'terraform', 'cloud', 'networking', 'iam'],
    goodToHave: ['azure', 'gcp', 'kubernetes', 'docker', 'ci/cd', 'serverless', 'cloudformation'],
    tools: ['terraform', 'cloudformation', 'ansible', 'docker', 'kubernetes'],
    cloud: ['aws', 'azure', 'gcp', 'ec2', 'lambda', 's3', 'eks', 'vpc'],
    languages: ['python', 'bash', 'go', 'shell'],
    databases: ['rds', 'dynamodb', 'postgresql', 'redis'],
    testing: ['cloudwatch', 'prometheus', 'grafana'],
  },
  'Business Analyst': {
    mustHave: ['requirements', 'stakeholder', 'documentation', 'analysis', 'process'],
    goodToHave: ['brd', 'user stories', 'agile', 'sql', 'data analysis', 'wireframes', 'uat'],
    tools: ['jira', 'confluence', 'excel', 'power bi', 'visio', 'tableau'],
    cloud: [],
    languages: ['sql'],
    databases: ['sql'],
    testing: [],
  },
  'Product Manager': {
    mustHave: ['roadmap', 'stakeholder', 'product strategy', 'user research', 'prioritization'],
    goodToHave: ['agile', 'a/b testing', 'metrics', 'user stories', 'go-to-market', 'analytics', 'backlog'],
    tools: ['jira', 'figma', 'confluence', 'amplitude', 'mixpanel', 'productboard'],
    cloud: [],
    languages: ['sql'],
    databases: ['sql'],
    testing: [],
  },
  'HR / Recruiter': {
    mustHave: ['recruitment', 'screening', 'onboarding', 'interview', 'sourcing'],
    goodToHave: ['talent acquisition', 'employee engagement', 'ats', 'hr policies', 'payroll', 'stakeholder'],
    tools: ['linkedin recruiter', 'workday', 'greenhouse', 'naukri', 'ats'],
    cloud: [],
    languages: [],
    databases: [],
    testing: [],
  },
};

const ROLE_ALIASES = {
  'data engineer': 'Data Engineer',
  'big data engineer': 'Data Engineer',
  'etl developer': 'Data Engineer',
  'data platform engineer': 'Data Engineer',
  'analytics engineer': 'Data Engineer',
  'cloud data engineer': 'Data Engineer',
  'frontend engineer': 'Frontend Developer',
  'frontend developer': 'Frontend Developer',
  'backend engineer': 'Backend Developer',
  'backend developer': 'Backend Developer',
  'full stack developer': 'Full Stack Developer',
  'full stack engineer': 'Full Stack Developer',
  'mobile developer': 'Software Engineer',
  'platform engineer': 'DevOps Engineer',
  'site reliability engineer (sre)': 'DevOps Engineer',
  sre: 'DevOps Engineer',
  'devops engineer': 'DevOps Engineer',
  'cloud engineer': 'Cloud Engineer',
  'software engineer': 'Software Engineer',
  'software engineering intern': 'Software Engineer',
  'machine learning engineer': 'Data Scientist',
  'data analyst': 'Data Analyst',
  'data analyst intern': 'Data Analyst',
  'data scientist': 'Data Scientist',
  'qa / test engineer': 'QA Engineer',
  'qa engineer': 'QA Engineer',
  'security engineer': 'DevOps Engineer',
  'product manager': 'Product Manager',
  'associate product manager': 'Product Manager',
  'business analyst': 'Business Analyst',
  'hr executive / recruiter': 'HR / Recruiter',
  'hr / recruiter': 'HR / Recruiter',
};

export const GENERIC_DICTIONARY = {
  mustHave: ['communication', 'teamwork', 'problem solving', 'project', 'leadership'],
  goodToHave: ['git', 'documentation', 'agile', 'analysis', 'collaboration', 'stakeholder'],
  tools: ['git', 'excel', 'jira'],
  cloud: ['aws', 'azure', 'gcp'],
  languages: ['python', 'java', 'javascript', 'sql'],
  databases: ['sql', 'mysql', 'mongodb'],
  testing: [],
};

function normalizeRoleLookupText(role = '') {
  return String(role || '').trim().toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/\b(sr\.?|senior|jr\.?|junior|staff|principal|lead|associate)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function resolveDictionary(role = '') {
  const r = String(role || '').trim() || 'General';
  if (ROLE_DICTIONARIES[r]) return { name: r, dict: ROLE_DICTIONARIES[r], known: true };
  const lower = r.toLowerCase();
  const directAlias = ROLE_ALIASES[lower];
  if (directAlias && ROLE_DICTIONARIES[directAlias]) return { name: directAlias, dict: ROLE_DICTIONARIES[directAlias], known: true };

  /* Seniority is presentation metadata, not a different skill ontology. A
     target such as "Senior DevOps Engineer" should still receive the DevOps
     dictionary instead of falling back to the generic vocabulary. */
  const normalized = normalizeRoleLookupText(r);
  const normalizedAlias = ROLE_ALIASES[normalized];
  if (normalizedAlias && ROLE_DICTIONARIES[normalizedAlias]) return { name: normalizedAlias, dict: ROLE_DICTIONARIES[normalizedAlias], known: true };

  /* Conservative role-family recognition for common leadership titles. Keep
     the mapping specific enough that "platform product manager" does not get
     treated as infrastructure engineering. */
  const family = /product manager/.test(normalized) ? 'Product Manager'
    : /data platform|data engineer|analytics engineer|etl/.test(normalized) ? 'Data Engineer'
      : /devops|site reliability|\bsre\b|platform engineer|platform engineering/.test(normalized) ? 'DevOps Engineer'
        : /cloud engineer|cloud infrastructure/.test(normalized) ? 'Cloud Engineer'
          : /security|cyber/.test(normalized) ? 'DevOps Engineer'
            : /frontend/.test(normalized) ? 'Frontend Developer'
              : /backend/.test(normalized) ? 'Backend Developer'
                : /full[ -]?stack/.test(normalized) ? 'Full Stack Developer'
                  : /software engineer|software developer/.test(normalized) ? 'Software Engineer'
                    : /data scientist|machine learning|\bml engineer/.test(normalized) ? 'Data Scientist'
                      : /data analyst|business intelligence/.test(normalized) ? 'Data Analyst'
                        : /qa|test engineer|quality assurance/.test(normalized) ? 'QA Engineer'
                          : '';
  if (family && ROLE_DICTIONARIES[family]) return { name: family, dict: ROLE_DICTIONARIES[family], known: true };
  return { name: r, dict: GENERIC_DICTIONARY, known: false };
}

/* Role-relevant action verbs (impact signal). */
export const GENERIC_ACTION_VERBS = ['developed', 'built', 'designed', 'implemented', 'engineered', 'architected', 'established', 'led', 'managed', 'coordinated', 'created', 'delivered', 'executed', 'improved', 'optimized', 'standardized', 'automated', 'orchestrated', 'reduced', 'increased', 'analyzed', 'evaluated', 'quantified', 'collaborated', 'aligned', 'maintained', 'stabilized', 'integrated', 'migrated', 'modernized', 'launched', 'streamlined', 'secured', 'validated', 'transformed', 'restructured', 'operationalized', 'reconciled', 'documented', 'articulated', 'influenced'];
export const ROLE_ACTION_VERBS = {
  'DevOps Engineer': ['deployed', 'automated', 'orchestrated', 'configured', 'standardized', 'instrumented', 'monitored', 'migrated', 'replatformed', 'optimized', 'rightsized', 'secured', 'hardened', 'stabilized', 'integrated', 'troubleshot', 'codified', 'governed', 'systematized', 'parameterized', 'baselined', 'smoke-tested', 'provisioned', 'operationalized', 'restored', 'recovered', 'patched', 'triaged', 'debugged', 'root-caused', 'debottlenecked', 'templatized', 'industrialized', 'containerized', 'pipelined', 'triggered', 'snapshotted', 'rolled back', 'rotated', 'attested', 'canary-tested'],
  'Cloud Engineer': ['provisioned', 'architected', 'deployed', 'migrated', 'replatformed', 'automated', 'configured', 'scaled', 'rightsized', 'secured', 'fortified', 'isolated', 'optimized', 'standardized', 'monitored', 'baselined', 'contained', 'encrypted', 'restored', 'recovered', 'governed', 'root-caused', 'pinpointed', 'reconfigured', 'debottlenecked', 'containerized', 'federated', 'segregated', 'rotated', 'snapshotted', 'mitigated'],
  'Software Engineer': ['engineered', 'developed', 'designed', 'architected', 'implemented', 'integrated', 'embedded', 'refactored', 'optimized', 'parallelized', 'shipped', 'launched', 'stabilized', 'validated', 'scaffolded', 'augmented', 'bootstrapped', 'prototyped', 'modularized', 'encapsulated', 'instrumented', 'debugged', 'root-caused', 'fine-tuned', 'reconfigured', 'packaged', 'containerized', 'decoupled', 'cached', 'memoized', 'serialized', 'contract-tested'],
  'Data Engineer': ['engineered', 'modeled', 'orchestrated', 'integrated', 'transformed', 'optimized', 'parallelized', 'automated', 'standardized', 'validated', 'monitored', 'migrated', 'reconciled', 'backfilled', 'partitioned', 'ingested', 'materialized', 'replicated', 'profiled', 'surfaced', 'triangulated', 'parsed', 'debottlenecked', 'root-caused', 'normalized', 'denormalized', 'batched', 'pipelined', 'deduplicated', 'sharded', 'serialized', 'checkpointed'],
  'Data Analyst': ['analyzed', 'evaluated', 'quantified', 'visualized', 'reported', 'modeled', 'forecasted', 'automated', 'queried', 'identified', 'tracked', 'interpreted', 'segmented', 'compared', 'derived', 'calculated', 'decomposed', 'reconciled', 'benchmarked', 'synthesized', 'surfaced', 'triangulated', 'interrogated', 'parsed', 'ranked', 'scored', 'aggregated', 'sampled'],
  'Data Scientist': ['modeled', 'trained', 'analyzed', 'engineered', 'predicted', 'anticipated', 'inferred', 'classified', 'optimized', 'deployed', 'evaluated', 'benchmarked', 'experimented', 'forecasted', 'quantified', 'simulated', 'projected', 'triangulated', 'fine-tuned', 'hypothesized', 'calibrated', 'vectorized', 'tokenized', 'ensembled', 'scored'],
  'QA Engineer': ['tested', 'regression-tested', 'automated', 'validated', 'verified', 'qualified', 'inspected', 'identified', 'reproduced', 'executed', 'stabilized', 'improved', 'smoke-tested', 'load-tested', 'stress-tested', 'probed', 'checked', 'triaged', 'root-caused', 'pinpointed', 'debugged', 'confirmed', 'fuzz-tested', 'contract-tested', 'canary-tested', 'chaos-tested'],
  'Security Engineer': ['secured', 'hardened', 'remediated', 'enforced', 'audited', 'protected', 'fortified', 'isolated', 'restricted', 'encrypted', 'investigated', 'validated', 'monitored', 'contained', 'masked', 'detected', 'traced', 'triaged', 'shielded', 'root-caused', 'pinpointed', 'authenticated', 'authorized', 'sanitized', 'segregated', 'rotated', 'revoked', 'attested', 'quarantined', 'mitigated'],
  'Product Manager': ['defined', 'prioritized', 'aligned', 'launched', 'validated', 'analyzed', 'coordinated', 'facilitated', 'delivered', 'measured', 'scoped', 'sequenced', 'demonstrated', 'scoped', 'synthesized', 'articulated', 'championed', 'framed', 'steered', 'sponsored', 'disseminated', 'hypothesized', 'ranked', 'scored', 'allocated', 'budgeted'],
};

export function actionVerbsFor(roleName) {
  return Array.from(new Set([...(ROLE_ACTION_VERBS[roleName] || []), ...GENERIC_ACTION_VERBS]));
}

export default { ROLE_DICTIONARIES, SKILL_ALIASES, GENERIC_DICTIONARY, resolveDictionary, actionVerbsFor };
