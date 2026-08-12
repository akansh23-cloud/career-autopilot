/* ============================================================
   ATS ALIGNMENT WITHOUT KEYWORD STUFFING (stage 15)
   ------------------------------------------------------------
   Four separate measurements, deliberately not collapsed into one
   number until the very end:

     keywordCoverage    literal JD terms present, weighted by tier
     semanticCoverage   JD requirements met through EQUIVALENT
                        candidate vocabulary ("automated GitLab
                        deployment workflows" covers "CI/CD
                        pipelines")
     density            occurrences per 100 words
     repetitionPenalty  the same term hammered repeatedly
     unsupportedPenalty terms present in text but NOT backed by
                        the evidence graph

   THE INVARIANT: the ATS score can never rise because an
   unsupported keyword was inserted. `unsupportedPenalty` is
   subtracted at exactly the rate the keyword would have earned,
   plus a margin — so stuffing is strictly worse than honesty.
   ============================================================ */
import { canonicalSkill } from '../skillOntology.js';
import { skillPresent } from '../skillMatcher.js';
import { expandImplied } from './skillIntelligence.js';

export const ATS_SEMANTICS_VERSION = 'ats-semantics-v1';

/* Requirement concept → the candidate vocabularies that genuinely satisfy it.
   These are equivalences, not similarities: each right-hand phrase, if the
   candidate really did it, IS an instance of the left-hand concept. */
const SEMANTIC_EQUIVALENTS = [
  { concept: 'ci/cd', satisfiedBy: [/\b(jenkins|gitlab ci|github actions|azure devops|bamboo|teamcity|circleci)\b/i, /\b(build|deployment|release)\s+(pipeline|workflow|automation)\b/i, /\bautomated (?:build|deploy|release)\w*/i] },
  { concept: 'infrastructure as code', satisfiedBy: [/\b(terraform|cloudformation|pulumi|arm template|bicep)\b/i, /\b(ansible|puppet|chef)\b/i, /\bconfiguration (?:as code|management)\b/i] },
  { concept: 'container orchestration', satisfiedBy: [/\b(kubernetes|k8s|openshift|eks|aks|gke|ecs|nomad)\b/i, /\b(helm|deployment manifest|pod|namespace)\b/i] },
  { concept: 'monitoring', satisfiedBy: [/\b(prometheus|grafana|datadog|splunk|new relic|cloudwatch|elk|kibana)\b/i, /\b(alert|dashboard|instrument\w*|observab\w*)\b/i] },
  { concept: 'data pipeline', satisfiedBy: [/\b(airflow|dbt|glue|nifi|luigi|dagster|prefect)\b/i, /\b(etl|elt|ingestion|batch job|streaming job)\b/i, /\bdata (?:pipeline|flow|load)\b/i] },
  { concept: 'data warehouse', satisfiedBy: [/\b(snowflake|redshift|bigquery|synapse|teradata|databricks)\b/i, /\b(dimensional model|fact table|star schema|warehouse layer)\b/i] },
  { concept: 'rest api', satisfiedBy: [/\b(rest|restful|graphql|grpc|openapi|swagger)\b/i, /\bapi (?:endpoint|contract|service)\b/i, /\bmicroservice\w*/i] },
  { concept: 'agile', satisfiedBy: [/\b(scrum|kanban|sprint|standup|retrospective|backlog grooming)\b/i, /\biterative delivery\b/i] },
  { concept: 'cloud', satisfiedBy: [/\b(aws|amazon web services|azure|gcp|google cloud|oci|openshift)\b/i, /\b(ec2|s3|lambda|eks|rds|blob storage|cloud run)\b/i] },
  { concept: 'testing', satisfiedBy: [/\b(junit|pytest|jest|cypress|selenium|playwright|testng)\b/i, /\b(unit test|integration test|regression|test coverage|test automation)\b/i] },
  { concept: 'security', satisfiedBy: [/\b(sonarqube|veracode|snyk|prisma|checkmarx|owasp|vault)\b/i, /\b(vulnerability|security scan|access control|least privilege|encryption)\b/i] },
  { concept: 'stakeholder management', satisfiedBy: [/\b(stakeholder|business (?:user|team)|steering|sponsor)\b/i, /\b(present(?:ed|ation)|briefed|aligned with)\b/i] },
  { concept: 'machine learning', satisfiedBy: [/\b(scikit-learn|pytorch|tensorflow|xgboost|lightgbm|keras)\b/i, /\b(model (?:training|evaluation|deployment)|feature engineering|cross-validation)\b/i] },
  { concept: 'sql', satisfiedBy: [/\b(sql|postgres\w*|mysql|oracle|snowflake|redshift|bigquery|t-sql|pl\/sql)\b/i, /\b(quer(?:y|ies)|stored procedure|join|index)\b/i] },
  { concept: 'version control', satisfiedBy: [/\b(git|github|gitlab|bitbucket|svn)\b/i, /\b(branch|merge request|pull request|code review)\b/i] },
];

const wordCount = (t) => String(t || '').split(/\s+/).filter(Boolean).length;

/**
 * @param {string} resumeText  the assembled resume text (or joined bullets)
 * @param {object} jobIntel    Job Intelligence
 * @param {object} graph       evidence graph — the support authority
 */
export function analyzeAtsAlignment(resumeText, jobIntel, graph, { classification = null } = {}) {
  const text = String(resumeText || '');
  const words = wordCount(text) || 1;
  const priority = jobIntel?.prioritySkills || [];

  /* ---- keyword coverage (tier-weighted) ---- */
  const covered = [];
  const missing = [];
  let earned = 0;
  let possible = 0;
  for (const p of priority) {
    possible += p.weight;
    const present = skillPresent(text, p.skill);
    if (present) { earned += p.weight; covered.push({ skill: p.skill, weight: p.weight, tier: p.tier }); }
    else missing.push({ skill: p.skill, weight: p.weight, tier: p.tier });
  }
  const keywordCoverage = possible ? Number((earned / possible).toFixed(3)) : 1;

  /* ---- semantic coverage ---- */
  const semanticHits = [];
  for (const eq of SEMANTIC_EQUIVALENTS) {
    const wanted = priority.find((p) => canonicalSkill(p.skill) === canonicalSkill(eq.concept)
      || String(p.skill).toLowerCase().includes(eq.concept));
    const jdMentions = wanted || new RegExp(eq.concept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(jobIntel?.jd?.jobTitle || '');
    if (!jdMentions) continue;
    const literal = skillPresent(text, eq.concept);
    const equivalent = eq.satisfiedBy.some((re) => re.test(text));
    if (!literal && equivalent) {
      semanticHits.push({
        concept: eq.concept,
        satisfiedByEquivalent: true,
        weight: wanted?.weight || 1,
        note: `Not stated literally, but the resume shows work that is an instance of ${eq.concept}.`,
      });
    }
  }
  const semanticEarned = semanticHits.reduce((s, h) => s + h.weight, 0);
  const semanticCoverage = possible ? Number(Math.min(1, (earned + semanticEarned) / possible).toFixed(3)) : 1;

  /* ---- density + repetition ---- */
  const occurrences = [];
  let repetitionPenalty = 0;
  for (const p of priority.slice(0, 25)) {
    const esc = p.skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const n = (text.match(new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, 'gi')) || []).length;
    if (!n) continue;
    occurrences.push({ skill: p.skill, count: n, per100Words: Number(((n / words) * 100).toFixed(2)) });
    /* More than ~1 per 100 words of the same term reads as stuffing. */
    const allowance = Math.max(3, Math.ceil(words / 120));
    if (n > allowance) repetitionPenalty += (n - allowance) * 0.04;
  }
  repetitionPenalty = Number(Math.min(0.6, repetitionPenalty).toFixed(3));
  const density = Number((occurrences.reduce((s, o) => s + o.count, 0) / words * 100).toFixed(2));

  /* ---- unsupported keyword penalty: the anti-stuffing invariant ---- */
  const supported = new Set();
  for (const r of graph?.records || []) {
    if (r.type === 'achievement' || r.type === 'skill' || r.type === 'available_project' || r.type === 'certification') {
      for (const s of r.skills || []) for (const imp of expandImplied(s)) supported.add(imp);
    }
  }
  const classificationSupported = new Set((classification?.supported || []).map((s) => s.canonical));

  const unsupportedPresent = [];
  let unsupportedPenalty = 0;
  for (const c of covered) {
    const canon = canonicalSkill(c.skill);
    if (supported.has(canon) || classificationSupported.has(canon)) continue;
    unsupportedPresent.push({ skill: c.skill, weight: c.weight });
    /* Subtract MORE than the keyword earned — stuffing must be net-negative. */
    unsupportedPenalty += (c.weight / (possible || 1)) * 1.4;
  }
  unsupportedPenalty = Number(Math.min(1, unsupportedPenalty).toFixed(3));

  const score = Math.max(0, Math.min(100, Math.round(
    (semanticCoverage * 78 + keywordCoverage * 22) * (1 - repetitionPenalty) - unsupportedPenalty * 100,
  )));

  return {
    version: ATS_SEMANTICS_VERSION,
    score,
    keywordCoverage,
    semanticCoverage,
    density,
    repetitionPenalty,
    unsupportedPenalty,
    covered,
    missing: missing.sort((a, b) => b.weight - a.weight),
    semanticHits,
    occurrences: occurrences.sort((a, b) => b.count - a.count),
    unsupportedPresent,
    /* Explicit statement of the guarantee, surfaced to the UI. */
    guarantee: 'Adding a keyword you cannot evidence lowers this score. Coverage is only credited when the resume can back it.',
  };
}

/** Where honest coverage could still be improved without adding a claim. */
export function alignmentOpportunities(alignment, classification) {
  const out = [];
  const supported = new Map((classification?.supported || []).map((s) => [s.canonical, s]));
  for (const m of alignment.missing.slice(0, 12)) {
    const c = canonicalSkill(m.skill);
    if (supported.has(c)) {
      out.push({
        type: 'supported_but_absent', skill: m.skill, weight: m.weight,
        action: `You have evidence for ${m.skill} but the resume never names it — surface it in a bullet.`,
        evidenceIds: supported.get(c)?.evidenceIds || [],
      });
    }
  }
  for (const h of alignment.semanticHits) {
    out.push({
      type: 'semantic_only', concept: h.concept, weight: h.weight,
      action: `A recruiter will see it; a keyword filter may not. Where it is already true, naming "${h.concept}" once is honest and helps.`,
    });
  }
  return out;
}

export default { ATS_SEMANTICS_VERSION, analyzeAtsAlignment, alignmentOpportunities };
