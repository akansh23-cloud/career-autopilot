/* ============================================================
   JOB DISCOVERY OS — ROLE / TITLE TAXONOMY
   ------------------------------------------------------------
   Deterministic query expansion that requires NO resume, no
   profile and no evidence graph (§17, §31, §50).

   Relationship strengths are explicit and DIFFERENT (§32):
     EXACT   1.00  the query string itself
     ALIAS   0.85  a different name for the same job
     STRONG  0.62  adjacent role, frequently interchangeable
     RELATED 0.38  same discipline, materially different job

   SRE is deliberately STRONG — not ALIAS — of DevOps Engineer.
   ============================================================ */

import { tokens } from './text.js';

export const RELATION_WEIGHT = Object.freeze({
  EXACT: 1.0,
  ALIAS: 0.85,
  STRONG: 0.62,
  RELATED: 0.38,
  /* Second-degree adjacency, derived rather than hand-listed: a family reachable
     only through another family's STRONG edge. Present so a thin result set can
     be widened honestly, at a weight low enough that it can never outrank a
     real family match. */
  WEAK: 0.16,
});

export const RELATION_ORDER = Object.freeze(['EXACT', 'ALIAS', 'STRONG', 'RELATED', 'WEAK_RELATED']);

/**
 * Each family: canonical label, aliases (same job, different words),
 * strong (adjacent), related (same discipline, different job).
 */
export const ROLE_FAMILIES = Object.freeze({
  DEVOPS_ENGINEER: {
    label: 'DevOps Engineer',
    aliases: ['devops engineer', 'devops', 'dev ops engineer', 'devops specialist', 'ci cd engineer', 'cicd engineer', 'build and release engineer', 'build release engineer', 'release engineer'],
    strong: ['SRE', 'PLATFORM_ENGINEER', 'CLOUD_ENGINEER', 'INFRASTRUCTURE_ENGINEER', 'DEVSECOPS_ENGINEER'],
    related: ['SYSTEMS_ENGINEER', 'KUBERNETES_ENGINEER', 'BACKEND_ENGINEER'],
  },
  SRE: {
    label: 'Site Reliability Engineer',
    aliases: ['site reliability engineer', 'sre', 'reliability engineer', 'production engineer'],
    strong: ['DEVOPS_ENGINEER', 'PLATFORM_ENGINEER', 'INFRASTRUCTURE_ENGINEER'],
    related: ['SYSTEMS_ENGINEER', 'CLOUD_ENGINEER'],
  },
  PLATFORM_ENGINEER: {
    label: 'Platform Engineer',
    aliases: ['platform engineer', 'platform infrastructure engineer', 'developer platform engineer', 'internal platform engineer'],
    strong: ['DEVOPS_ENGINEER', 'SRE', 'INFRASTRUCTURE_ENGINEER', 'KUBERNETES_ENGINEER'],
    related: ['CLOUD_ENGINEER', 'BACKEND_ENGINEER'],
  },
  CLOUD_ENGINEER: {
    label: 'Cloud Engineer',
    aliases: ['cloud engineer', 'aws engineer', 'azure engineer', 'gcp engineer', 'cloud infrastructure engineer'],
    strong: ['DEVOPS_ENGINEER', 'INFRASTRUCTURE_ENGINEER', 'PLATFORM_ENGINEER'],
    related: ['SRE', 'CLOUD_ARCHITECT', 'SYSTEMS_ENGINEER'],
  },
  CLOUD_ARCHITECT: {
    label: 'Cloud Architect',
    aliases: ['cloud architect', 'solutions architect cloud', 'cloud solution architect'],
    strong: ['CLOUD_ENGINEER', 'SOLUTIONS_ARCHITECT'],
    related: ['DEVOPS_ENGINEER', 'PLATFORM_ENGINEER'],
  },
  INFRASTRUCTURE_ENGINEER: {
    label: 'Infrastructure Engineer',
    aliases: ['infrastructure engineer', 'infra engineer', 'it infrastructure engineer'],
    strong: ['DEVOPS_ENGINEER', 'SRE', 'CLOUD_ENGINEER', 'PLATFORM_ENGINEER'],
    related: ['SYSTEMS_ENGINEER', 'NETWORK_ENGINEER'],
  },
  DEVSECOPS_ENGINEER: {
    label: 'DevSecOps Engineer',
    aliases: ['devsecops engineer', 'devsecops', 'security devops engineer'],
    strong: ['DEVOPS_ENGINEER', 'SECURITY_ENGINEER'],
    related: ['PLATFORM_ENGINEER', 'CLOUD_ENGINEER'],
  },
  KUBERNETES_ENGINEER: {
    label: 'Kubernetes Engineer',
    aliases: ['kubernetes engineer', 'k8s engineer', 'openshift engineer', 'container platform engineer'],
    strong: ['PLATFORM_ENGINEER', 'DEVOPS_ENGINEER'],
    related: ['SRE', 'INFRASTRUCTURE_ENGINEER'],
  },
  SYSTEMS_ENGINEER: {
    label: 'Systems Engineer',
    aliases: ['systems engineer', 'system engineer', 'linux engineer', 'linux administrator', 'systems administrator', 'sysadmin'],
    strong: ['INFRASTRUCTURE_ENGINEER'],
    related: ['DEVOPS_ENGINEER', 'NETWORK_ENGINEER'],
  },
  NETWORK_ENGINEER: {
    label: 'Network Engineer',
    aliases: ['network engineer', 'network administrator', 'noc engineer'],
    strong: ['SYSTEMS_ENGINEER'],
    related: ['INFRASTRUCTURE_ENGINEER', 'SECURITY_ENGINEER'],
  },
  SECURITY_ENGINEER: {
    label: 'Security Engineer',
    aliases: ['security engineer', 'information security engineer', 'infosec engineer', 'application security engineer', 'appsec engineer'],
    strong: ['DEVSECOPS_ENGINEER'],
    related: ['SECURITY_ANALYST', 'INFRASTRUCTURE_ENGINEER'],
  },
  SECURITY_ANALYST: {
    label: 'Security Analyst',
    aliases: ['security analyst', 'soc analyst', 'cybersecurity analyst'],
    strong: ['SECURITY_ENGINEER'],
    related: ['DATA_ANALYST'],
  },

  BACKEND_ENGINEER: {
    label: 'Backend Engineer',
    aliases: ['backend engineer', 'back end engineer', 'backend developer', 'back-end developer', 'backend software engineer', 'server side engineer', 'api engineer'],
    strong: ['JAVA_ENGINEER', 'PYTHON_ENGINEER', 'NODE_ENGINEER', 'GOLANG_ENGINEER', 'FULLSTACK_ENGINEER'],
    related: ['SOFTWARE_ENGINEER', 'DEVOPS_ENGINEER', 'DATA_ENGINEER'],
  },
  JAVA_ENGINEER: {
    label: 'Java Engineer',
    aliases: ['java engineer', 'java developer', 'java backend developer', 'java backend engineer', 'spring boot developer', 'spring boot engineer', 'j2ee developer', 'core java developer'],
    strong: ['BACKEND_ENGINEER', 'SOFTWARE_ENGINEER'],
    related: ['FULLSTACK_ENGINEER', 'ANDROID_ENGINEER'],
  },
  PYTHON_ENGINEER: {
    label: 'Python Engineer',
    aliases: ['python engineer', 'python developer', 'django developer', 'fastapi developer', 'flask developer'],
    strong: ['BACKEND_ENGINEER', 'SOFTWARE_ENGINEER'],
    related: ['DATA_ENGINEER', 'ML_ENGINEER'],
  },
  NODE_ENGINEER: {
    label: 'Node.js Engineer',
    aliases: ['node engineer', 'node js developer', 'nodejs developer', 'node.js engineer', 'express developer'],
    strong: ['BACKEND_ENGINEER', 'FULLSTACK_ENGINEER'],
    related: ['FRONTEND_ENGINEER', 'SOFTWARE_ENGINEER'],
  },
  GOLANG_ENGINEER: {
    label: 'Go Engineer',
    aliases: ['go engineer', 'golang engineer', 'golang developer', 'go developer'],
    strong: ['BACKEND_ENGINEER'],
    related: ['PLATFORM_ENGINEER', 'SOFTWARE_ENGINEER'],
  },
  FRONTEND_ENGINEER: {
    label: 'Frontend Engineer',
    aliases: ['frontend engineer', 'front end engineer', 'frontend developer', 'front-end developer', 'react developer', 'react engineer', 'angular developer', 'vue developer', 'ui engineer'],
    strong: ['FULLSTACK_ENGINEER', 'SOFTWARE_ENGINEER'],
    related: ['MOBILE_ENGINEER', 'UX_DESIGNER'],
  },
  FULLSTACK_ENGINEER: {
    label: 'Full Stack Engineer',
    aliases: ['full stack engineer', 'fullstack engineer', 'full-stack developer', 'full stack developer', 'mern developer', 'mean developer'],
    strong: ['BACKEND_ENGINEER', 'FRONTEND_ENGINEER', 'SOFTWARE_ENGINEER'],
    related: ['MOBILE_ENGINEER'],
  },
  SOFTWARE_ENGINEER: {
    label: 'Software Engineer',
    aliases: ['software engineer', 'software developer', 'sde', 'software development engineer', 'programmer', 'application developer'],
    strong: ['BACKEND_ENGINEER', 'FULLSTACK_ENGINEER', 'FRONTEND_ENGINEER'],
    related: ['QA_ENGINEER', 'DEVOPS_ENGINEER', 'MOBILE_ENGINEER'],
  },
  MOBILE_ENGINEER: {
    label: 'Mobile Engineer',
    aliases: ['mobile engineer', 'mobile developer', 'react native developer', 'flutter developer'],
    strong: ['ANDROID_ENGINEER', 'IOS_ENGINEER'],
    related: ['FRONTEND_ENGINEER', 'SOFTWARE_ENGINEER'],
  },
  ANDROID_ENGINEER: {
    label: 'Android Engineer',
    aliases: ['android engineer', 'android developer', 'kotlin developer'],
    strong: ['MOBILE_ENGINEER'],
    related: ['SOFTWARE_ENGINEER', 'JAVA_ENGINEER'],
  },
  IOS_ENGINEER: {
    label: 'iOS Engineer',
    aliases: ['ios engineer', 'ios developer', 'swift developer'],
    strong: ['MOBILE_ENGINEER'],
    related: ['SOFTWARE_ENGINEER'],
  },
  QA_ENGINEER: {
    label: 'QA Engineer',
    aliases: ['qa engineer', 'quality assurance engineer', 'test engineer', 'sdet', 'automation test engineer', 'qa automation engineer'],
    strong: ['SOFTWARE_ENGINEER'],
    related: ['DEVOPS_ENGINEER'],
  },

  DATA_ENGINEER: {
    label: 'Data Engineer',
    aliases: ['data engineer', 'big data engineer', 'etl developer', 'etl engineer', 'data platform engineer', 'analytics engineer'],
    strong: ['DATA_SCIENTIST', 'ML_ENGINEER', 'BACKEND_ENGINEER'],
    related: ['DATA_ANALYST', 'DEVOPS_ENGINEER'],
  },
  DATA_SCIENTIST: {
    label: 'Data Scientist',
    aliases: ['data scientist', 'applied scientist', 'research scientist machine learning'],
    strong: ['ML_ENGINEER', 'DATA_ANALYST'],
    related: ['DATA_ENGINEER'],
  },
  ML_ENGINEER: {
    label: 'Machine Learning Engineer',
    aliases: ['machine learning engineer', 'ml engineer', 'mlops engineer', 'ai engineer', 'deep learning engineer'],
    strong: ['DATA_SCIENTIST', 'DATA_ENGINEER'],
    related: ['BACKEND_ENGINEER', 'DEVOPS_ENGINEER'],
  },
  DATA_ANALYST: {
    label: 'Data Analyst',
    aliases: ['data analyst', 'business intelligence analyst', 'bi analyst', 'reporting analyst', 'analytics analyst'],
    strong: ['DATA_SCIENTIST', 'BUSINESS_ANALYST'],
    related: ['DATA_ENGINEER', 'PRODUCT_ANALYST'],
  },
  BUSINESS_ANALYST: {
    label: 'Business Analyst',
    aliases: ['business analyst', 'ba', 'functional analyst'],
    strong: ['DATA_ANALYST', 'PRODUCT_ANALYST'],
    related: ['PRODUCT_MANAGER', 'PROJECT_MANAGER'],
  },
  PRODUCT_ANALYST: {
    label: 'Product Analyst',
    aliases: ['product analyst'],
    strong: ['DATA_ANALYST', 'BUSINESS_ANALYST'],
    related: ['PRODUCT_MANAGER'],
  },

  PRODUCT_MANAGER: {
    label: 'Product Manager',
    aliases: ['product manager', 'pm product', 'technical product manager', 'product owner', 'associate product manager'],
    strong: ['PRODUCT_ANALYST', 'PROGRAM_MANAGER'],
    related: ['PROJECT_MANAGER', 'BUSINESS_ANALYST', 'UX_DESIGNER'],
  },
  PROGRAM_MANAGER: {
    label: 'Program Manager',
    aliases: ['program manager', 'technical program manager', 'tpm'],
    strong: ['PROJECT_MANAGER', 'PRODUCT_MANAGER'],
    related: ['BUSINESS_ANALYST'],
  },
  PROJECT_MANAGER: {
    label: 'Project Manager',
    aliases: ['project manager', 'delivery manager', 'scrum master', 'agile coach'],
    strong: ['PROGRAM_MANAGER'],
    related: ['PRODUCT_MANAGER', 'BUSINESS_ANALYST'],
  },
  UX_DESIGNER: {
    label: 'UX Designer',
    aliases: ['ux designer', 'product designer', 'ui ux designer', 'user experience designer', 'ui designer'],
    strong: ['UX_RESEARCHER'],
    related: ['FRONTEND_ENGINEER', 'PRODUCT_MANAGER'],
  },
  UX_RESEARCHER: {
    label: 'UX Researcher',
    aliases: ['ux researcher', 'user researcher', 'design researcher'],
    strong: ['UX_DESIGNER'],
    related: ['PRODUCT_ANALYST'],
  },

  MARKETING_MANAGER: {
    label: 'Marketing Manager',
    aliases: ['marketing manager', 'digital marketing manager', 'brand manager', 'growth marketing manager'],
    strong: ['CONTENT_MARKETER', 'GROWTH_MANAGER'],
    related: ['PRODUCT_MARKETING_MANAGER', 'SALES_MANAGER'],
  },
  PRODUCT_MARKETING_MANAGER: {
    label: 'Product Marketing Manager',
    aliases: ['product marketing manager', 'pmm'],
    strong: ['MARKETING_MANAGER'],
    related: ['PRODUCT_MANAGER', 'CONTENT_MARKETER'],
  },
  CONTENT_MARKETER: {
    label: 'Content Marketer',
    aliases: ['content marketer', 'content marketing manager', 'seo specialist', 'content strategist'],
    strong: ['MARKETING_MANAGER'],
    related: ['PRODUCT_MARKETING_MANAGER'],
  },
  GROWTH_MANAGER: {
    label: 'Growth Manager',
    aliases: ['growth manager', 'growth lead', 'performance marketing manager'],
    strong: ['MARKETING_MANAGER'],
    related: ['PRODUCT_MANAGER'],
  },
  SALES_MANAGER: {
    label: 'Sales Manager',
    aliases: ['sales manager', 'account executive', 'business development manager', 'bdm'],
    strong: ['ACCOUNT_MANAGER'],
    related: ['MARKETING_MANAGER', 'CUSTOMER_SUCCESS_MANAGER'],
  },
  ACCOUNT_MANAGER: {
    label: 'Account Manager',
    aliases: ['account manager', 'client partner', 'key account manager'],
    strong: ['SALES_MANAGER', 'CUSTOMER_SUCCESS_MANAGER'],
    related: ['SUPPORT_ENGINEER'],
  },
  CUSTOMER_SUCCESS_MANAGER: {
    label: 'Customer Success Manager',
    aliases: ['customer success manager', 'csm', 'customer success lead'],
    strong: ['ACCOUNT_MANAGER', 'SUPPORT_ENGINEER'],
    related: ['SALES_MANAGER'],
  },
  SUPPORT_ENGINEER: {
    label: 'Support Engineer',
    aliases: ['support engineer', 'technical support engineer', 'customer support engineer', 'application support engineer', 'production support engineer', 'service desk engineer', 'help desk engineer'],
    strong: ['CUSTOMER_SUCCESS_MANAGER', 'SYSTEMS_ENGINEER'],
    related: ['DEVOPS_ENGINEER', 'QA_ENGINEER'],
  },
  HR_MANAGER: {
    label: 'HR Manager',
    aliases: ['hr manager', 'human resources manager', 'people operations manager', 'hr business partner', 'hrbp'],
    strong: ['RECRUITER'],
    related: ['OPERATIONS_MANAGER'],
  },
  RECRUITER: {
    label: 'Recruiter',
    aliases: ['recruiter', 'technical recruiter', 'talent acquisition specialist', 'talent partner'],
    strong: ['HR_MANAGER'],
    related: [],
  },
  OPERATIONS_MANAGER: {
    label: 'Operations Manager',
    aliases: ['operations manager', 'ops manager', 'business operations manager'],
    strong: ['PROJECT_MANAGER'],
    related: ['HR_MANAGER', 'PROGRAM_MANAGER'],
  },
  FINANCE_ANALYST: {
    label: 'Financial Analyst',
    aliases: ['financial analyst', 'finance analyst', 'fp&a analyst'],
    strong: ['BUSINESS_ANALYST'],
    related: ['DATA_ANALYST', 'ACCOUNTANT'],
  },
  ACCOUNTANT: {
    label: 'Accountant',
    aliases: ['accountant', 'chartered accountant', 'staff accountant', 'accounts executive'],
    strong: ['FINANCE_ANALYST'],
    related: [],
  },
});

/* -------------------------- alias index -------------------------- */

function canonKey(s) { return tokens(s).join(' '); }

const ALIAS_INDEX = new Map();
for (const [familyId, def] of Object.entries(ROLE_FAMILIES)) {
  for (const alias of def.aliases) {
    const key = canonKey(alias);
    if (!ALIAS_INDEX.has(key)) ALIAS_INDEX.set(key, familyId);
  }
  ALIAS_INDEX.set(canonKey(def.label), familyId);
}

/* Token-level hints used only when no alias matched. Deliberately conservative. */
const TOKEN_HINTS = [
  [['devops'], 'DEVOPS_ENGINEER'],
  [['devsecops'], 'DEVSECOPS_ENGINEER'],
  [['sre'], 'SRE'],
  [['reliability'], 'SRE'],
  [['kubernetes'], 'KUBERNETES_ENGINEER'],
  [['openshift'], 'KUBERNETES_ENGINEER'],
  [['terraform'], 'DEVOPS_ENGINEER'],
  [['platform', 'engineer'], 'PLATFORM_ENGINEER'],
  [['cloud', 'engineer'], 'CLOUD_ENGINEER'],
  [['cloud', 'architect'], 'CLOUD_ARCHITECT'],
  [['infrastructure'], 'INFRASTRUCTURE_ENGINEER'],
  [['java'], 'JAVA_ENGINEER'],
  [['spring'], 'JAVA_ENGINEER'],
  [['python'], 'PYTHON_ENGINEER'],
  [['django'], 'PYTHON_ENGINEER'],
  [['golang'], 'GOLANG_ENGINEER'],
  [['node'], 'NODE_ENGINEER'],
  [['react'], 'FRONTEND_ENGINEER'],
  [['angular'], 'FRONTEND_ENGINEER'],
  [['frontend'], 'FRONTEND_ENGINEER'],
  [['backend'], 'BACKEND_ENGINEER'],
  [['fullstack'], 'FULLSTACK_ENGINEER'],
  [['full', 'stack'], 'FULLSTACK_ENGINEER'],
  [['android'], 'ANDROID_ENGINEER'],
  [['ios'], 'IOS_ENGINEER'],
  [['mobile'], 'MOBILE_ENGINEER'],
  [['sdet'], 'QA_ENGINEER'],
  [['qa'], 'QA_ENGINEER'],
  [['data', 'engineer'], 'DATA_ENGINEER'],
  [['etl'], 'DATA_ENGINEER'],
  [['data', 'scientist'], 'DATA_SCIENTIST'],
  [['machine', 'learning'], 'ML_ENGINEER'],
  [['mlops'], 'ML_ENGINEER'],
  [['data', 'analyst'], 'DATA_ANALYST'],
  [['business', 'analyst'], 'BUSINESS_ANALYST'],
  [['product', 'manager'], 'PRODUCT_MANAGER'],
  [['product', 'owner'], 'PRODUCT_MANAGER'],
  [['program', 'manager'], 'PROGRAM_MANAGER'],
  [['project', 'manager'], 'PROJECT_MANAGER'],
  [['scrum'], 'PROJECT_MANAGER'],
  [['ux'], 'UX_DESIGNER'],
  [['product', 'designer'], 'UX_DESIGNER'],
  [['marketing', 'manager'], 'MARKETING_MANAGER'],
  [['seo'], 'CONTENT_MARKETER'],
  [['growth'], 'GROWTH_MANAGER'],
  [['sales'], 'SALES_MANAGER'],
  [['account', 'manager'], 'ACCOUNT_MANAGER'],
  [['customer', 'success'], 'CUSTOMER_SUCCESS_MANAGER'],
  [['support', 'engineer'], 'SUPPORT_ENGINEER'],
  [['recruiter'], 'RECRUITER'],
  [['talent', 'acquisition'], 'RECRUITER'],
  [['human', 'resources'], 'HR_MANAGER'],
  [['financial', 'analyst'], 'FINANCE_ANALYST'],
  [['accountant'], 'ACCOUNTANT'],
  [['security', 'engineer'], 'SECURITY_ENGINEER'],
  [['security', 'analyst'], 'SECURITY_ANALYST'],
  [['network'], 'NETWORK_ENGINEER'],
  [['software', 'engineer'], 'SOFTWARE_ENGINEER'],
  [['software', 'developer'], 'SOFTWARE_ENGINEER'],
];

const SENIORITY_TOKENS = new Set([
  'senior', 'sr', 'junior', 'jr', 'staff', 'principal', 'lead', 'associate',
  'entry', 'level', 'mid', 'midlevel', 'fresher', 'intern', 'trainee', 'graduate',
  'i', 'ii', 'iii', 'iv', 'apprentice', 'head', 'chief', 'vp', 'director', 'manager',
]);

const NOISE_TOKENS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'with', 'in', 'at', 'to',
  'remote', 'hybrid', 'onsite', 'on-site', 'contract', 'fulltime', 'full-time',
  'parttime', 'part-time', 'permanent', 'temporary', 'urgent', 'hiring', 'immediate',
  'f', 'm', 'd', 'w', 'x', 'gn',
]);

/** Title stripped of seniority/noise decoration, for matching only. */
export function coreTitleTokens(title) {
  return tokens(title).filter((t) => !SENIORITY_TOKENS.has(t) && !NOISE_TOKENS.has(t));
}

/**
 * Resolve a free-text title/query to zero or more role families.
 * Returns { families: [id], primary: id|null, method }.
 */
export function resolveFamilies(text) {
  const raw = canonKey(text);
  if (!raw) return { families: [], primary: null, method: 'empty' };

  const direct = ALIAS_INDEX.get(raw);
  if (direct) return { families: [direct], primary: direct, method: 'alias-exact' };

  const core = coreTitleTokens(text);
  const coreKey = core.join(' ');
  const coreHit = ALIAS_INDEX.get(coreKey);
  if (coreHit) return { families: [coreHit], primary: coreHit, method: 'alias-core' };

  /* Longest alias contained in the title wins — "senior java backend engineer"
     should resolve on "java backend engineer", not on "engineer". */
  let best = null; let bestLen = 0;
  const hay = ` ${raw} `;
  for (const [aliasKey, familyId] of ALIAS_INDEX.entries()) {
    if (aliasKey.split(' ').length < 2) continue;
    if (hay.includes(` ${aliasKey} `)) {
      if (aliasKey.length > bestLen) { best = familyId; bestLen = aliasKey.length; }
    }
  }
  if (best) return { families: [best], primary: best, method: 'alias-contains' };

  const set = new Set();
  const coreSet = new Set(core);
  const tokenSet = new Set(tokens(text));
  for (const [need, familyId] of TOKEN_HINTS) {
    if (need.every((t) => coreSet.has(t) || tokenSet.has(t))) set.add(familyId);
  }
  const families = [...set];
  return { families, primary: families[0] || null, method: families.length ? 'token-hint' : 'unresolved' };
}

/**
 * Weighted expansion for a query. Returns a Map familyId -> { weight, relation }.
 * Exact/alias/strong/related weights are DISTINCT so ranking can reflect them.
 */
export function expandQuery(text, { includeWeak = true, extraFamilies = [] } = {}) {
  const { families } = resolveFamilies(text);
  const seeds = [...new Set([...families, ...extraFamilies])].filter((id) => ROLE_FAMILIES[id]);
  return expandFamilies(seeds, { includeWeak });
}

/**
 * Weighted expansion from an explicit seed set. Kept separate from expandQuery
 * so query understanding can contribute families discovered from technology
 * tokens ("kubernetes", "aws") without re-parsing the string.
 */
export function expandFamilies(seeds = [], { includeWeak = true } = {}) {
  const out = new Map();
  const put = (id, weight, relation) => {
    if (!ROLE_FAMILIES[id]) return;
    const prev = out.get(id);
    if (!prev || prev.weight < weight) out.set(id, { weight, relation });
  };
  for (const id of seeds) {
    put(id, RELATION_WEIGHT.EXACT, 'EXACT');
    const def = ROLE_FAMILIES[id];
    for (const s of def.strong || []) put(s, RELATION_WEIGHT.STRONG, 'STRONG');
    for (const r of def.related || []) put(r, RELATION_WEIGHT.RELATED, 'RELATED');
  }
  if (!includeWeak) return out;

  /* Second degree: reachable only through a STRONG edge of a STRONG neighbour.
     Derived, so adding a family never requires hand-maintaining a weak list. */
  const firstDegree = [...out.keys()];
  for (const id of firstDegree) {
    if (out.get(id).relation !== 'STRONG') continue;
    for (const s of ROLE_FAMILIES[id]?.strong || []) {
      if (out.has(s)) continue;
      put(s, RELATION_WEIGHT.WEAK, 'WEAK_RELATED');
    }
  }
  return out;
}

/**
 * Every family a free-text string can plausibly refer to, not just the single
 * best one. "java backend" legitimately means JAVA_ENGINEER *and*
 * BACKEND_ENGINEER; collapsing to one loses half the intent.
 */
export function resolveAllFamilies(text) {
  const primary = resolveFamilies(text);
  const set = new Set(primary.families);
  const coreSet = new Set(coreTitleTokens(text));
  const tokenSet = new Set(tokens(text));
  for (const [need, familyId] of TOKEN_HINTS) {
    if (need.every((t) => coreSet.has(t) || tokenSet.has(t))) set.add(familyId);
  }
  return { families: [...set], primary: primary.primary || [...set][0] || null, method: primary.method };
}

export function familyLabel(id) { return ROLE_FAMILIES[id]?.label || null; }

export function relationBetween(queryText, familyId) {
  const map = expandQuery(queryText);
  return map.get(familyId)?.relation || 'NONE';
}

export default {
  ROLE_FAMILIES, RELATION_WEIGHT, RELATION_ORDER, resolveFamilies, resolveAllFamilies,
  expandQuery, expandFamilies, familyLabel, relationBetween, coreTitleTokens,
};
