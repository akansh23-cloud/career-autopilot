/* ============================================================
   JOB DISCOVERY OS — QUERY UNDERSTANDING
   ------------------------------------------------------------
   Users do not type structured filters. They type

       "AWS DevOps"
       "Remote data engineer India"
       "platform engineer kubernetes"
       "fresher software engineer"
       "Java backend"

   and every one of those strings carries a role, a technology, a
   location, a work-model preference or a seniority — mixed into
   one box. This module pulls those apart DETERMINISTICALLY.

   Hard rules:
     - No LLM, no embedding, no candidate data. Same input, same
       output, forever, and it works when the app knows nothing
       about the user (§50).
     - Nothing is invented. A signal is only reported when the
       query actually contains evidence for it, and everything
       consumed is reported in `consumed` so the caller can see
       exactly how the string was interpreted.
     - Technology tokens contribute FAMILIES and a separate skill
       signal — never a fake title match. "kubernetes" makes a
       Platform Engineer more relevant; it does not make one a
       literal title hit.
   ============================================================ */

import { tokens } from './text.js';
import { detectCountry, detectRegion, parseLocation } from './location.js';
import { resolveAllFamilies, expandFamilies, coreTitleTokens } from './taxonomy.js';
import { EMPLOYMENT_TYPE, SENIORITY } from '../schema.js';

/**
 * Technology / stack tokens and the role families they imply.
 * These are AFFINITIES, not titles: presence raises a family's weight but is
 * always weaker than the role words themselves.
 */
export const TECH_AFFINITY = Object.freeze({
  kubernetes: ['KUBERNETES_ENGINEER', 'PLATFORM_ENGINEER', 'DEVOPS_ENGINEER'],
  k8s: ['KUBERNETES_ENGINEER', 'PLATFORM_ENGINEER', 'DEVOPS_ENGINEER'],
  openshift: ['KUBERNETES_ENGINEER', 'PLATFORM_ENGINEER'],
  docker: ['DEVOPS_ENGINEER', 'PLATFORM_ENGINEER'],
  terraform: ['DEVOPS_ENGINEER', 'CLOUD_ENGINEER', 'INFRASTRUCTURE_ENGINEER'],
  ansible: ['DEVOPS_ENGINEER', 'INFRASTRUCTURE_ENGINEER'],
  jenkins: ['DEVOPS_ENGINEER'],
  argocd: ['DEVOPS_ENGINEER', 'PLATFORM_ENGINEER'],
  helm: ['KUBERNETES_ENGINEER', 'DEVOPS_ENGINEER'],
  prometheus: ['SRE', 'DEVOPS_ENGINEER'],
  grafana: ['SRE', 'DEVOPS_ENGINEER'],
  aws: ['CLOUD_ENGINEER', 'DEVOPS_ENGINEER', 'CLOUD_ARCHITECT'],
  azure: ['CLOUD_ENGINEER', 'DEVOPS_ENGINEER'],
  gcp: ['CLOUD_ENGINEER', 'DEVOPS_ENGINEER'],
  linux: ['SYSTEMS_ENGINEER', 'INFRASTRUCTURE_ENGINEER'],
  vault: ['DEVSECOPS_ENGINEER', 'DEVOPS_ENGINEER'],

  java: ['JAVA_ENGINEER', 'BACKEND_ENGINEER'],
  spring: ['JAVA_ENGINEER', 'BACKEND_ENGINEER'],
  springboot: ['JAVA_ENGINEER', 'BACKEND_ENGINEER'],
  hibernate: ['JAVA_ENGINEER'],
  python: ['PYTHON_ENGINEER', 'BACKEND_ENGINEER'],
  django: ['PYTHON_ENGINEER'],
  flask: ['PYTHON_ENGINEER'],
  fastapi: ['PYTHON_ENGINEER'],
  node: ['NODE_ENGINEER', 'BACKEND_ENGINEER'],
  nodejs: ['NODE_ENGINEER', 'BACKEND_ENGINEER'],
  express: ['NODE_ENGINEER'],
  golang: ['GOLANG_ENGINEER', 'BACKEND_ENGINEER'],
  go: ['GOLANG_ENGINEER'],
  rust: ['BACKEND_ENGINEER'],
  dotnet: ['BACKEND_ENGINEER'],
  csharp: ['BACKEND_ENGINEER'],
  php: ['BACKEND_ENGINEER'],
  laravel: ['BACKEND_ENGINEER'],
  ruby: ['BACKEND_ENGINEER'],
  rails: ['BACKEND_ENGINEER'],

  react: ['FRONTEND_ENGINEER', 'FULLSTACK_ENGINEER'],
  angular: ['FRONTEND_ENGINEER'],
  vue: ['FRONTEND_ENGINEER'],
  nextjs: ['FRONTEND_ENGINEER', 'FULLSTACK_ENGINEER'],
  typescript: ['FRONTEND_ENGINEER', 'FULLSTACK_ENGINEER'],
  javascript: ['FRONTEND_ENGINEER', 'FULLSTACK_ENGINEER'],
  tailwind: ['FRONTEND_ENGINEER'],

  android: ['ANDROID_ENGINEER', 'MOBILE_ENGINEER'],
  kotlin: ['ANDROID_ENGINEER'],
  swift: ['IOS_ENGINEER'],
  ios: ['IOS_ENGINEER', 'MOBILE_ENGINEER'],
  flutter: ['MOBILE_ENGINEER'],

  spark: ['DATA_ENGINEER'],
  hadoop: ['DATA_ENGINEER'],
  airflow: ['DATA_ENGINEER'],
  kafka: ['DATA_ENGINEER', 'BACKEND_ENGINEER'],
  dbt: ['DATA_ENGINEER'],
  snowflake: ['DATA_ENGINEER'],
  databricks: ['DATA_ENGINEER'],
  etl: ['DATA_ENGINEER'],
  sql: ['DATA_ANALYST', 'DATA_ENGINEER'],
  tableau: ['DATA_ANALYST'],
  powerbi: ['DATA_ANALYST'],
  pytorch: ['ML_ENGINEER', 'DATA_SCIENTIST'],
  tensorflow: ['ML_ENGINEER', 'DATA_SCIENTIST'],
  mlops: ['ML_ENGINEER'],
  llm: ['ML_ENGINEER'],
  nlp: ['ML_ENGINEER', 'DATA_SCIENTIST'],

  selenium: ['QA_ENGINEER'],
  cypress: ['QA_ENGINEER'],
  playwright: ['QA_ENGINEER'],
  appium: ['QA_ENGINEER'],

  siem: ['SECURITY_ANALYST'],
  soc: ['SECURITY_ANALYST'],
  pentest: ['SECURITY_ENGINEER'],
  owasp: ['SECURITY_ENGINEER'],

  figma: ['UX_DESIGNER'],
  seo: ['CONTENT_MARKETER'],
  hubspot: ['MARKETING_MANAGER'],
  salesforce: ['SALES_MANAGER'],
  jira: ['PROJECT_MANAGER'],
});

const REMOTE_TERMS = [
  [/\b(fully\s+remote|remote|work\s+from\s+home|wfh|telecommute)\b/i, 'remote'],
  [/\bhybrid\b/i, 'hybrid'],
  [/\b(on[\s-]?site|onsite|in[\s-]?office)\b/i, 'onsite'],
];

const EMPLOYMENT_TERMS = [
  [/\b(intern|internship|trainee)\b/i, EMPLOYMENT_TYPE.INTERNSHIP],
  [/\b(contract|contractor|freelance|c2h|corp[\s-]to[\s-]corp)\b/i, EMPLOYMENT_TYPE.CONTRACT],
  [/\bpart[\s-]?time\b/i, EMPLOYMENT_TYPE.PART_TIME],
  [/\bfull[\s-]?time\b/i, EMPLOYMENT_TYPE.FULL_TIME],
];

/** Indian-market vocabulary matters here: "fresher" is the standard word. */
const SENIORITY_TERMS = [
  [/\b(fresher|freshers|entry[\s-]level|graduate|campus|0[\s-]?[-–]?\s?1\s*(year|yr))\b/i, [SENIORITY.ENTRY, SENIORITY.INTERN]],
  [/\b(intern|internship)\b/i, [SENIORITY.INTERN]],
  [/\b(junior|jr)\b/i, [SENIORITY.ENTRY]],
  [/\b(senior|sr)\b/i, [SENIORITY.SENIOR]],
  [/\bstaff\b/i, [SENIORITY.STAFF]],
  [/\bprincipal\b/i, [SENIORITY.PRINCIPAL]],
  [/\blead\b/i, [SENIORITY.LEAD]],
  [/\bmanager\b/i, [SENIORITY.MANAGER]],
  [/\bdirector\b/i, [SENIORITY.DIRECTOR]],
];

const LOCATION_PREPOSITION = /\b(?:in|near|at|around|based\s+in|located\s+in)\s+([a-z][a-z\s.,'-]{2,40})$/i;

/**
 * A city we can actually resolve, as opposed to parseLocation()'s
 * treat-the-head-as-a-city fallback. Requires the parser to have attached a
 * country, which only happens for a city it recognises.
 */
export function knownCity(text) {
  const t = String(text || '').trim();
  if (!t || tokens(t).length > 3) return null;
  const parsed = parseLocation(t);
  return parsed?.city && parsed.countryCode ? parsed.city : null;
}

/**
 * Parse a free-text search box into structured intent.
 *
 * @returns {{
 *   raw, roleText, terms, techs, families, familyWeights, seedFamilies,
 *   location, remote, employmentType, seniority, consumed, confidence
 * }}
 */
export function understandQuery(text, { explicit = {} } = {}) {
  const raw = String(text || '').trim();
  const consumed = [];

  if (!raw) {
    return {
      raw: '', roleText: '', terms: [], techs: [], families: [], familyWeights: new Map(),
      seedFamilies: [], location: explicit.location ?? null, remote: explicit.remote ?? null,
      employmentType: explicit.employmentType ?? null, seniority: [], consumed,
      confidence: 0, method: 'empty',
    };
  }

  let residual = raw;

  /* ---------------- work model ---------------- */
  let remote = explicit.remote ?? null;
  for (const [re, value] of REMOTE_TERMS) {
    const m = residual.match(re);
    if (m) {
      if (!remote) { remote = value; consumed.push({ kind: 'remote', text: m[0], value }); }
      residual = residual.replace(re, ' ');
      break;
    }
  }

  /* ---------------- employment type ---------------- */
  let employmentType = explicit.employmentType ?? null;
  for (const [re, value] of EMPLOYMENT_TERMS) {
    const m = residual.match(re);
    if (m) {
      if (!employmentType) { employmentType = value; consumed.push({ kind: 'employmentType', text: m[0], value }); }
      /* "intern" is BOTH an employment type and a seniority; it is deliberately
         left in the residual so the seniority pass can also see it. */
      break;
    }
  }

  /* ---------------- seniority ---------------- */
  const seniority = new Set();
  for (const [re, values] of SENIORITY_TERMS) {
    const m = residual.match(re);
    if (!m) continue;
    for (const v of values) seniority.add(v);
    consumed.push({ kind: 'seniority', text: m[0], value: values });
  }

  /* ---------------- location ----------------
     Trailing prepositional phrase first ("data engineer in Pune"), then a bare
     country/region/city token anywhere ("Remote data engineer India"). */
  let location = explicit.location ?? null;
  if (!location) {
    const prep = residual.match(LOCATION_PREPOSITION);
    if (prep) {
      const candidate = prep[1].trim();
      if (detectCountry(candidate) || detectRegion(candidate) || knownCity(candidate)) {
        location = candidate;
        consumed.push({ kind: 'location', text: prep[0], value: candidate });
        residual = residual.replace(LOCATION_PREPOSITION, ' ');
      }
    }
  }
  if (!location) {
    const country = detectCountry(residual);
    const region = !country ? detectRegion(residual) : null;
    const hit = country || region;
    if (hit) {
      const m = residual.match(hit.match) || (hit.strict ? residual.match(hit.strict) : null);
      if (m) {
        location = hit.name;
        consumed.push({ kind: 'location', text: m[0], value: hit.name, code: hit.code });
        residual = residual.replace(m[0], ' ');
      }
    }
  }
  if (!location) {
    /* Only a RECOGNISED city counts. parseLocation() deliberately falls back to
       "treat the head of the string as a city" when it is parsing a location
       FIELD — applying that to a search box would turn "DevOps Engineer" into
       a city called DevOps Engineer and empty every result set. */
    for (const chunk of residual.split(/[,\n]/)) {
      const city = knownCity(chunk.trim());
      if (city) {
        location = city;
        consumed.push({ kind: 'location', text: chunk.trim(), value: city });
        residual = residual.replace(chunk, ' ');
        break;
      }
    }
  }

  /* ---------------- technology tokens ---------------- */
  const residualTokens = tokens(residual);
  const techs = [];
  const techFamilies = new Map(); // family -> affinity strength
  for (const t of residualTokens) {
    const fams = TECH_AFFINITY[t];
    if (!fams) continue;
    techs.push(t);
    fams.forEach((f, i) => {
      const strength = i === 0 ? 1 : (i === 1 ? 0.7 : 0.5);
      techFamilies.set(f, Math.max(techFamilies.get(f) ?? 0, strength));
    });
    consumed.push({ kind: 'tech', text: t, value: fams[0] });
  }

  /* ---------------- role families ---------------- */
  const roleText = residual.replace(/\s+/g, ' ').trim();
  const roleResolved = resolveAllFamilies(roleText);
  const roleFamilies = roleResolved.families;

  /* Role words dominate. Technology tokens only ADD families when the query
     did not already name a role, or reinforce one that it did. */
  const seeds = new Set(roleFamilies);
  if (!roleFamilies.length) {
    for (const [f, strength] of techFamilies) if (strength >= 0.7) seeds.add(f);
  } else {
    for (const [f, strength] of techFamilies) if (strength >= 1 && roleFamilies.length) seeds.add(f);
  }

  const familyWeights = expandFamilies([...seeds], { includeWeak: true });
  /* A technology token nudges its families up one notch without ever promoting
     them to EXACT — "kubernetes" is not the title "Kubernetes Engineer". */
  for (const [f, strength] of techFamilies) {
    const existing = familyWeights.get(f);
    const boosted = Math.min(0.8, 0.45 + strength * 0.3);
    if (!existing) familyWeights.set(f, { weight: boosted, relation: 'TECH_AFFINITY' });
    else if (existing.relation !== 'EXACT' && existing.weight < boosted) {
      familyWeights.set(f, { weight: boosted, relation: existing.relation });
    }
  }

  const method = roleResolved.families.length
    ? roleResolved.method
    : (techFamilies.size ? 'tech-affinity' : 'unresolved');

  return {
    raw,
    roleText,
    terms: coreTitleTokens(roleText),
    allTerms: tokens(raw),
    techs,
    families: [...familyWeights.keys()],
    familyWeights,
    seedFamilies: [...seeds],
    location,
    remote,
    employmentType,
    seniority: [...seniority],
    consumed,
    method,
    confidence: seeds.size ? (roleFamilies.length ? 0.9 : 0.6) : (residualTokens.length ? 0.3 : 0),
  };
}

const TECH_TOKEN_CACHE = new WeakMap();

/** Technology overlap between a query's tech tokens and a job. 0..1. */
export function techRelevance(job, techs = []) {
  if (!techs.length) return { score: 0.5, hits: [], basis: 'no technology terms in query' };
  /* Memoised for the same reason as the ranking token set: this runs once per
     candidate per query, and re-tokenising a description there is what makes a
     large index feel slow. */
  let hay = TECH_TOKEN_CACHE.get(job);
  if (!hay) {
    hay = new Set(tokens([
      job.title,
      (job.tags || []).join(' '),
      String(job.description?.text || '').slice(0, 4000),
    ].filter(Boolean).join(' ')));
    TECH_TOKEN_CACHE.set(job, hay);
  }
  const hits = techs.filter((t) => hay.has(t));
  return {
    score: hits.length / techs.length,
    hits,
    basis: `${hits.length}/${techs.length} technology terms present`,
  };
}

export default { understandQuery, techRelevance, knownCity, TECH_AFFINITY };
