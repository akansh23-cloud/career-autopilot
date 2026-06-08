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

export function resolveDictionary(role = '') {
  const r = String(role || '').trim() || 'General';
  if (ROLE_DICTIONARIES[r]) return { name: r, dict: ROLE_DICTIONARIES[r], known: true };
  const alias = ROLE_ALIASES[r.toLowerCase()];
  if (alias && ROLE_DICTIONARIES[alias]) return { name: alias, dict: ROLE_DICTIONARIES[alias], known: true };
  return { name: r, dict: GENERIC_DICTIONARY, known: false };
}

/* Role-relevant action verbs (impact signal). */
export const GENERIC_ACTION_VERBS = ['developed', 'built', 'designed', 'implemented', 'led', 'managed', 'created', 'delivered', 'improved', 'optimized', 'automated', 'reduced', 'increased', 'analyzed', 'collaborated', 'maintained', 'integrated', 'migrated', 'launched', 'streamlined'];
export const ROLE_ACTION_VERBS = {
  'DevOps Engineer': ['deployed', 'automated', 'configured', 'monitored', 'containerized', 'migrated', 'optimized', 'secured', 'reduced', 'improved', 'integrated', 'maintained', 'troubleshot', 'orchestrated', 'provisioned'],
  'Cloud Engineer': ['provisioned', 'deployed', 'migrated', 'automated', 'configured', 'scaled', 'secured', 'optimized', 'architected', 'monitored'],
  'Data Analyst': ['analyzed', 'visualized', 'reported', 'modeled', 'forecasted', 'automated', 'cleaned', 'queried', 'identified', 'tracked'],
  'Data Scientist': ['modeled', 'trained', 'analyzed', 'engineered', 'predicted', 'optimized', 'deployed', 'evaluated', 'experimented', 'forecasted'],
  'QA Engineer': ['tested', 'automated', 'validated', 'verified', 'identified', 'reproduced', 'documented', 'executed', 'reduced', 'improved'],
};

export function actionVerbsFor(roleName) {
  return Array.from(new Set([...(ROLE_ACTION_VERBS[roleName] || []), ...GENERIC_ACTION_VERBS]));
}

export default { ROLE_DICTIONARIES, SKILL_ALIASES, GENERIC_DICTIONARY, resolveDictionary, actionVerbsFor };
