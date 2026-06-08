/* ============================================================
   FABRICATION CHECKER
   ------------------------------------------------------------
   Compares facts present in the ORIGINAL resume against a tailored
   version and flags anything that appears to be newly invented:
   new companies, roles, certifications, tools without evidence, new
   metrics, inflated years of experience, unsupported project claims.
   Deterministic — no AI.
   ============================================================ */
import { normalizeResumeText } from './normalizeResumeText.js';
import { skillPresent } from './skillMatcher.js';

const round = (n) => Math.round(n);

function extractMetrics(text) {
  return Array.from(new Set([
    ...(text.match(/\b\d{1,3}(?:\.\d+)?\s*%/g) || []),
    ...(text.match(/\b\d{1,3}(?:,\d{3})+\b/g) || []),
    ...(text.match(/\b\d+\s*(?:k|m|million|lakh|crore|users|records|requests|transactions)\b/gi) || []),
  ].map((s) => s.toLowerCase().replace(/\s+/g, ' ').trim())));
}
function extractYears(text) {
  const m = text.match(/\b(\d{1,2})\+?\s*years?\b/);
  return m ? Number(m[1]) : null;
}
function extractCerts(text) {
  const re = /\b(aws|azure|gcp|google|oracle|cisco|comptia|pmp|scrum|databricks|snowflake|kubernetes|cka|ckad)[\w +./-]*?(certified|certification|associate|professional|practitioner|expert|foundation)\b/gi;
  return Array.from(new Set((text.match(re) || []).map((s) => s.toLowerCase().trim())));
}
function extractCompaniesRoles(text) {
  // Heuristic: lines with "at <Company>" or "<Role> | <Company>"
  const lines = text.split('\n');
  const tokens = new Set();
  for (const l of lines) {
    const at = l.match(/\bat\s+([A-Z][\w&.\- ]{2,40})/);
    if (at) tokens.add(at[1].toLowerCase().trim());
    const pipe = l.match(/([\w &.-]{3,40})\s*[|@]\s*([\w &.-]{3,40})/);
    if (pipe) { tokens.add(pipe[1].toLowerCase().trim()); tokens.add(pipe[2].toLowerCase().trim()); }
  }
  return tokens;
}

const KNOWN_TOOLS = ['kubernetes', 'docker', 'terraform', 'jenkins', 'ansible', 'aws', 'azure', 'gcp', 'react', 'node.js', 'python', 'java', 'spring boot', 'kafka', 'spark', 'snowflake', 'tableau', 'power bi', 'tensorflow', 'pytorch', 'selenium', 'cypress'];

export function checkFabrication({ originalResume = '', tailoredResume = '' } = {}) {
  const orig = normalizeResumeText(originalResume);
  const tail = normalizeResumeText(tailoredResume);
  const risks = [];

  // New metrics not in the original.
  const origMetrics = new Set(extractMetrics(orig));
  for (const m of extractMetrics(tail)) {
    if (!origMetrics.has(m)) risks.push({ type: 'new_metric', detail: `Metric "${m}" not present in original resume.`, severity: 'high' });
  }

  // Inflated years of experience.
  const oy = extractYears(orig); const ty = extractYears(tail);
  if (ty != null && (oy == null || ty > oy)) risks.push({ type: 'fake_experience_years', detail: `Tailored resume claims ${ty} years vs original ${oy ?? 'none stated'}.`, severity: 'high' });

  // New certifications.
  const origCerts = new Set(extractCerts(orig));
  for (const c of extractCerts(tail)) if (!origCerts.has(c)) risks.push({ type: 'new_certification', detail: `Certification "${c}" not in original.`, severity: 'high' });

  // New companies / roles.
  const origCR = extractCompaniesRoles(originalResume);
  for (const t of extractCompaniesRoles(tailoredResume)) {
    if (t.length > 3 && !origCR.has(t) && !orig.includes(t)) risks.push({ type: 'new_company_or_role', detail: `Possible new company/role "${t}".`, severity: 'medium' });
  }

  // New tools claimed without evidence in original.
  for (const tool of KNOWN_TOOLS) {
    if (skillPresent(tail, tool) && !skillPresent(orig, tool)) {
      risks.push({ type: 'new_tool_without_evidence', detail: `Tool "${tool}" appears in tailored resume but not in original.`, severity: 'medium' });
    }
  }

  const score = round(Math.max(0, 100 - risks.reduce((s, r) => s + (r.severity === 'high' ? 25 : 10), 0)));
  return {
    integrityScore: score,
    safe: risks.length === 0,
    risks: risks.slice(0, 25),
  };
}

export default { checkFabrication };
