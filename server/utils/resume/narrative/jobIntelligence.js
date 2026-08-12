/* ============================================================
   JOB INTELLIGENCE ENGINE — Narrative stage 3
   ------------------------------------------------------------
   Built ON TOP OF the canonical parseJDv2 (which already does
   weighted, section-aware skill extraction). This layer adds the
   things a keyword parser cannot express:

     ROLE IDENTITY      canonical role, family, seniority, IC vs
                        leadership, domain, functional expectations
     REQUIREMENT TIERS  mandatory / strong preference / optional /
                        domain knowledge / leadership / collaboration /
                        architecture / operational / security
     TECHNICAL SIGNALS  bucketed by kind (language, platform, cloud,
                        data, architecture pattern, security concept)
     SEMANTIC EXPECT.   concepts a requirement IMPLIES but does not
                        literally name. These exist to help us
                        UNDERSTAND the job — never to claim the
                        candidate has them. Every semantic expansion
                        is tagged `claimable: false`.

   The whole object is content-hashed so job analysis can be cached
   and never recomputed while a user edits one bullet.
   ============================================================ */
import crypto from 'node:crypto';
import { parseJDv2 } from '../jdParserV2.js';
import { canonicalSkill } from '../skillOntology.js';
import { resolveRoleFamily } from './domainVocabulary.js';
import { normalizeCareerStage } from '../careerStage.js';

export const JOB_INTELLIGENCE_VERSION = 'job-intelligence-v1';

const lower = (s) => String(s || '').toLowerCase();

/* ---------------- role identity ---------------- */
const SENIORITY_SIGNALS = [
  { stage: 'executive', re: /\b(head of|director|vice president|\bvp\b|chief|c[teoid]o|general manager)\b/i, weight: 5 },
  { stage: 'senior', re: /\b(staff|principal|senior|sr\.?|lead|architect|manager)\b/i, weight: 4 },
  { stage: 'mid', re: /\b(mid[- ]level|experienced|\b[3-6]\+? years)\b/i, weight: 3 },
  { stage: 'early', re: /\b(junior|jr\.?|entry[- ]level|associate|\b[0-2]\+? years)\b/i, weight: 2 },
  { stage: 'student', re: /\b(intern|internship|trainee|fresher|graduate (?:programme|program|scheme)|campus)\b/i, weight: 1 },
];

const LEADERSHIP_RE = /\b(lead a team|manage a team|line management|direct reports|mentor(?:ing|ship)?|coach(?:ing)?|hiring|performance review|stakeholder management|set (?:the )?(?:technical )?direction|own the roadmap)\b/i;
const IC_RE = /\b(hands[- ]on|individual contributor|write code|coding|implementation|build and ship)\b/i;

const DOMAIN_SIGNALS = [
  { domain: 'banking / financial services', re: /\b(bank|banking|bfsi|capital markets|payments?|trading|risk|regulator|basel|sox|kyc|aml|fintech|lending|insurance)\b/i },
  { domain: 'healthcare', re: /\b(health ?care|clinical|patient|hipaa|ehr|medical device|pharma)\b/i },
  { domain: 'e-commerce / retail', re: /\b(e-?commerce|retail|marketplace|checkout|catalog(?:ue)?|fulfilment|fulfillment)\b/i },
  { domain: 'telecom', re: /\b(telecom|5g|network operator|bss|oss)\b/i },
  { domain: 'public sector', re: /\b(government|public sector|civil service|municipal)\b/i },
  { domain: 'manufacturing / industrial', re: /\b(manufactur|industrial|plant|factory|scada|plc)\b/i },
  { domain: 'media / entertainment', re: /\b(streaming|media|content platform|gaming|advertis)\b/i },
  { domain: 'education', re: /\b(edtech|university|student|curriculum|learning platform)\b/i },
  { domain: 'logistics', re: /\b(logistics|supply chain|warehouse|shipment|freight)\b/i },
];

/* ---------------- requirement tiering ---------------- */
const TIER_MARKERS = [
  { tier: 'mandatory', re: /\b(must have|required|essential|mandatory|minimum (?:qualification|requirement)|you (?:must|will need to) have|proven experience (?:in|with)|strong experience|hands[- ]on experience (?:in|with)|\d\+? years?(?: of)? experience)\b/i },
  { tier: 'strong_preference', re: /\b(strongly preferred|highly desirable|ideally|we'?d love|significant plus|preferred)\b/i },
  { tier: 'optional', re: /\b(nice to have|bonus|a plus|good to have|desirable|exposure to|familiarity with|willingness to learn)\b/i },
];

const CATEGORY_MARKERS = [
  { category: 'business_domain', re: /\b(domain knowledge|business (?:knowledge|acumen|process)|regulatory|compliance|financial products?|industry experience)\b/i },
  { category: 'leadership', re: LEADERSHIP_RE },
  { category: 'collaboration', re: /\b(collaborat|cross[- ]functional|work(?:ing)? closely with|partner with|stakeholder|communicat(?:e|ion)|present to)\b/i },
  { category: 'architecture', re: /\b(architect|design (?:patterns?|systems?)|system design|scalab|high[- ]availability|distributed system|technical design|solution design)\b/i },
  { category: 'operational', re: /\b(on[- ]call|production support|incident|monitor|observab|runbook|sla|troubleshoot|maintenance|bau)\b/i },
  { category: 'security', re: /\b(security|secure coding|vulnerab|penetration|encryption|iam|least privilege|compliance scan|audit)\b/i },
  { category: 'delivery', re: /\b(agile|scrum|sprint|ci\/cd|release|deploy|kanban|delivery)\b/i },
  { category: 'data', re: /\b(data (?:pipeline|model|quality|warehouse|lake)|etl|elt|analytics|sql|reporting)\b/i },
];

/* Semantic expansions: what a requirement genuinely implies operationally.
   USED ONLY TO UNDERSTAND THE JOB. Never claimable. */
const SEMANTIC_EXPANSIONS = [
  { trigger: /\bkubernetes\b|\bk8s\b|\beks\b|\baks\b|\bgke\b|\bopenshift\b/i, concepts: ['deployment manifests', 'rollout strategy', 'pod troubleshooting', 'resource requests and limits', 'service discovery', 'ingress and networking', 'horizontal scaling', 'secrets and config management', 'cluster upgrades'] },
  { trigger: /\bci\/?cd\b|\bpipeline\b|\bjenkins\b|\bgitlab ci\b|\bgithub actions\b/i, concepts: ['build automation', 'artifact promotion', 'environment promotion', 'release gating', 'pipeline as code', 'rollback strategy'] },
  { trigger: /\bterraform\b|\binfrastructure as code\b|\bpulumi\b|\bcloudformation\b/i, concepts: ['state management', 'reusable modules', 'plan and apply review', 'drift detection', 'environment parameterisation'] },
  { trigger: /\bspark\b|\bpyspark\b|\bdatabricks\b/i, concepts: ['partitioning', 'shuffle tuning', 'job orchestration', 'incremental processing', 'schema evolution', 'cluster sizing'] },
  { trigger: /\bairflow\b|\borchestrat/i, concepts: ['DAG design', 'task dependencies', 'retry and backfill', 'SLA monitoring'] },
  { trigger: /\bmicroservices?\b/i, concepts: ['service boundaries', 'API contracts', 'inter-service communication', 'distributed tracing', 'independent deployability'] },
  { trigger: /\bobservab|\bmonitoring\b|\bprometheus\b|\bgrafana\b|\bdatadog\b/i, concepts: ['metrics instrumentation', 'alert thresholds', 'dashboards', 'log aggregation', 'tracing'] },
  { trigger: /\bproduction support\b|\bon[- ]call\b|\bincident\b/i, concepts: ['incident response', 'severity triage', 'root cause analysis', 'postmortems', 'runbooks'] },
  { trigger: /\bsql\b|\bdata warehouse\b|\bsnowflake\b|\bredshift\b|\bbigquery\b/i, concepts: ['query optimisation', 'dimensional modelling', 'incremental loads', 'data quality checks'] },
  { trigger: /\bmachine learning\b|\bml\b|\bmodel\b/i, concepts: ['feature engineering', 'model evaluation', 'training pipelines', 'model deployment', 'drift monitoring'] },
  { trigger: /\breact\b|\bfrontend\b|\bfront[- ]end\b/i, concepts: ['component architecture', 'state management', 'accessibility', 'bundle performance', 'responsive layout'] },
  { trigger: /\bapi\b|\brest\b|\bgraphql\b/i, concepts: ['endpoint design', 'versioning', 'authentication', 'rate limiting', 'contract testing'] },
  { trigger: /\bstakeholder\b|\bproduct\b|\broadmap\b/i, concepts: ['requirement gathering', 'prioritisation', 'trade-off communication', 'delivery reporting'] },
  { trigger: /\bsecurity\b|\bvulnerab|\bcompliance\b/i, concepts: ['secure configuration', 'vulnerability remediation', 'access control', 'audit evidence'] },
];

/* Technical signal bucketing. */
const SIGNAL_BUCKETS = [
  { kind: 'cloud', re: /^(aws|amazon web services|azure|gcp|google cloud platform|openshift|oci|alibaba cloud)$/i },
  { kind: 'language', re: /^(python|java|javascript|typescript|go|golang|c\+\+|c#|scala|ruby|rust|php|bash|shell|sql|r|kotlin|swift|groovy)$/i },
  { kind: 'platform', re: /^(kubernetes|docker|openshift|databricks|snowflake|kafka|linux|windows server|vmware)$/i },
  { kind: 'framework', re: /^(react|angular|vue|next\.js|spring boot|django|flask|express|node\.js|\.net|fastapi|rails)$/i },
  { kind: 'data', re: /^(spark|pyspark|airflow|dbt|hadoop|hive|iceberg|delta lake|redshift|bigquery|postgresql|mysql|mongodb|cassandra|elasticsearch|redis|etl|data pipeline|data warehouse|data modeling)$/i },
  { kind: 'devops_tool', re: /^(jenkins|gitlab ci|github actions|terraform|ansible|helm|argocd|puppet|chef|vault|nexus|artifactory|sonarqube|prometheus|grafana)$/i },
  { kind: 'security', re: /^(veracode|prisma|snyk|owasp|iam|oauth|jwt|siem|soc|penetration testing|encryption)$/i },
  { kind: 'practice', re: /^(ci\/cd|agile|scrum|microservices|system design|design patterns|tdd|unit testing|devops|sre|mlops)$/i },
];

function bucketFor(skill) {
  const s = String(skill).trim();
  for (const b of SIGNAL_BUCKETS) if (b.re.test(s)) return b.kind;
  return 'other';
}

/* ------------------------------------------------------------------ */
function splitStatements(raw) {
  return String(raw || '')
    .replace(/\r/g, '')
    .split(/\n+|(?<=[.;])\s+(?=[A-Z])/)
    .map((s) => s.replace(/^\s*[•*\-–—o]\s*/, '').trim())
    .filter((s) => s.length >= 12 && s.length <= 400);
}

export function hashJobDescription(jobDescription, extra = '') {
  return crypto.createHash('sha256')
    .update(String(jobDescription || '').replace(/\s+/g, ' ').trim().toLowerCase())
    .update('\u0000').update(String(extra || ''))
    .digest('hex').slice(0, 32);
}

/**
 * @param {string} jobDescription
 * @param {object} opts.job     { company, title }
 * @param {string} opts.targetRole
 */
export function buildJobIntelligence({ jobDescription = '', job = {}, targetRole = '' } = {}) {
  const raw = String(jobDescription || '');
  const jd = parseJDv2({ jobDescription: raw, targetRole });
  const statements = splitStatements(raw);
  const title = String(job.title || jd.jobTitle || targetRole || '').trim();

  /* ---- role identity ---- */
  let seniority = 'mid';
  let bestWeight = 0;
  for (const s of SENIORITY_SIGNALS) {
    if (s.re.test(title) && s.weight > bestWeight) { seniority = s.stage; bestWeight = s.weight; }
  }
  if (!bestWeight) {
    for (const s of SENIORITY_SIGNALS) {
      if (s.re.test(raw) && s.weight > bestWeight) { seniority = s.stage; bestWeight = s.weight; }
    }
  }
  if (jd.yearsOfExperience != null && bestWeight <= 3) {
    seniority = jd.yearsOfExperience >= 8 ? 'senior' : jd.yearsOfExperience >= 4 ? 'mid'
      : jd.yearsOfExperience >= 1 ? 'early' : 'student';
  }
  seniority = normalizeCareerStage(seniority, 'mid');

  const leadershipHits = (raw.match(new RegExp(LEADERSHIP_RE.source, 'gi')) || []).length;
  const icHits = (raw.match(new RegExp(IC_RE.source, 'gi')) || []).length;
  const track = leadershipHits >= 2 && leadershipHits > icHits ? 'leadership'
    : leadershipHits >= 1 ? 'hybrid' : 'individual_contributor';

  const domain = (DOMAIN_SIGNALS.find((d) => d.re.test(raw)) || {}).domain || '';
  const family = resolveRoleFamily(title || jd.detectedRole || targetRole, {
    skills: [...(jd.required || []), ...(jd.responsibilities || [])],
  });

  /* ---- requirement tiering ---- */
  const requirements = [];
  for (const st of statements) {
    let tier = '';
    for (const t of TIER_MARKERS) if (t.re.test(st)) { tier = t.tier; break; }
    const categories = CATEGORY_MARKERS.filter((c) => c.re.test(st)).map((c) => c.category);
    const skills = (jd.weighted || [])
      .filter((w) => new RegExp(`(?<![a-z0-9])${w.skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i').test(st))
      .map((w) => w.skill);
    if (!tier && !categories.length && !skills.length) continue;
    requirements.push({
      text: st.slice(0, 300),
      tier: tier || (skills.some((s) => (jd.required || []).includes(s)) ? 'mandatory' : 'optional'),
      categories,
      skills,
    });
  }

  const byTier = (t) => requirements.filter((r) => r.tier === t);
  const byCategory = (c) => requirements.filter((r) => r.categories.includes(c));

  /* ---- technical signals ---- */
  const technicalSignals = (jd.weighted || []).map((w) => ({
    skill: w.skill,
    canonical: w.canonical,
    weight: w.weight,
    mentions: w.mentions,
    kind: bucketFor(w.skill),
    tier: w.weight >= 2.5 ? 'mandatory' : w.weight >= 1.8 ? 'core_responsibility' : w.weight >= 1.0 ? 'preferred' : 'optional',
  }));

  const grouped = {};
  for (const s of technicalSignals) (grouped[s.kind] = grouped[s.kind] || []).push(s.skill);

  /* ---- semantic expectations (understanding only, never claimable) ---- */
  const semanticExpectations = [];
  for (const exp of SEMANTIC_EXPANSIONS) {
    if (!exp.trigger.test(raw)) continue;
    semanticExpectations.push({
      trigger: exp.trigger.source.replace(/\\b|\(|\)|\?:|\|/g, ' ').trim().split(/\s+/)[0],
      concepts: exp.concepts,
      claimable: false,
      note: 'Vocabulary and framing only — the candidate is never described as having done these unless their own evidence says so.',
    });
  }

  /* ---- functional expectations: what the job actually wants done ---- */
  const functionalExpectations = [];
  const addFn = (label, cond) => { if (cond) functionalExpectations.push(label); };
  addFn('build and ship features', /\b(build|develop|implement|deliver|ship)\b/i.test(raw));
  addFn('operate and support production systems', /\b(production support|on[- ]call|incident|maintain|monitor)\b/i.test(raw));
  addFn('automate manual processes', /\b(automat|manual (?:effort|process|steps?)|toil)\b/i.test(raw));
  addFn('design systems and make architectural decisions', /\b(architect|design (?:the )?(?:system|solution|architecture)|technical design)\b/i.test(raw));
  addFn('improve reliability and performance', /\b(reliab|performance|latency|uptime|availability|optimis|optimiz)\b/i.test(raw));
  addFn('work with stakeholders and communicate outcomes', /\b(stakeholder|business (?:users?|teams?)|communicat|present)\b/i.test(raw));
  addFn('lead or mentor other engineers', leadershipHits > 0);
  addFn('own data quality and correctness', /\b(data quality|reconcil|accuracy|validation)\b/i.test(raw));
  addFn('meet security and compliance obligations', /\b(security|compliance|audit|regulat)\b/i.test(raw));

  /* ---- vocabulary the JD itself uses (the employer's own words) ---- */
  const jdVocabulary = extractEmployerVocabulary(raw);

  return {
    version: JOB_INTELLIGENCE_VERSION,
    hash: hashJobDescription(raw, `${job.company || ''}|${title}`),
    jd, // the canonical parse is always carried through untouched
    roleIdentity: {
      title,
      company: String(job.company || '').slice(0, 200),
      canonicalRole: jd.detectedRole || title,
      roleFamily: family,
      seniority,
      track,
      domain,
      yearsOfExperience: jd.yearsOfExperience,
      education: jd.education,
      certifications: jd.certifications,
    },
    requirements: {
      all: requirements,
      mandatory: byTier('mandatory'),
      strongPreference: byTier('strong_preference'),
      optional: byTier('optional'),
      businessDomain: byCategory('business_domain'),
      leadership: byCategory('leadership'),
      collaboration: byCategory('collaboration'),
      architecture: byCategory('architecture'),
      operational: byCategory('operational'),
      security: byCategory('security'),
    },
    technicalSignals,
    technicalSignalsByKind: grouped,
    semanticExpectations,
    functionalExpectations,
    jdVocabulary,
    /* Convenience for downstream ranking — canonical, weight-ordered. */
    prioritySkills: technicalSignals
      .slice()
      .sort((a, b) => b.weight - a.weight)
      .map((s) => ({ skill: s.skill, canonical: canonicalSkill(s.skill), weight: s.weight, tier: s.tier })),
    statements: statements.length,
  };
}

/* Multi-word noun phrases the employer repeats — the terminology this specific
   company uses. Purely lexical; used to align wording, never to add claims. */
function extractEmployerVocabulary(raw) {
  const text = lower(raw).replace(/[^a-z0-9\s/+#.-]/g, ' ');
  const words = text.split(/\s+/).filter(Boolean);
  const STOP = new Set(['the', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'by', 'a', 'an', 'as', 'at', 'is', 'are', 'be', 'we', 'you', 'your', 'our', 'will', 'have', 'has', 'that', 'this', 'from', 'their', 'they', 'it', 'its', 'can', 'all', 'more', 'other', 'also', 'across', 'within', 'who', 'what', 'how', 'about', 'into', 'work', 'role', 'team', 'teams', 'job', 'position']);
  const counts = new Map();
  for (let i = 0; i < words.length - 1; i += 1) {
    const a = words[i]; const b = words[i + 1];
    if (STOP.has(a) || STOP.has(b) || a.length < 3 || b.length < 3) continue;
    const bg = `${a} ${b}`;
    counts.set(bg, (counts.get(bg) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 25)
    .map(([phrase, count]) => ({ phrase, count }));
}

export default { JOB_INTELLIGENCE_VERSION, buildJobIntelligence, hashJobDescription };
