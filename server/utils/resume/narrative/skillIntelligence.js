/* ============================================================
   SKILL INTELLIGENCE (stage 14)
   ------------------------------------------------------------
   A JD's skill list is not a shopping list to copy onto a resume.
   Every JD skill is classified against the candidate's evidence:

     SUPPORTED            evidence shows practical use, or the skill
                          is server-verified. Safe to state plainly.
     PARTIALLY_SUPPORTED  an adjacent/parent skill is supported, or
                          the skill is declared but never used in an
                          achievement. Surfaced to the USER as a
                          suggestion — never auto-inserted.
     UNSUPPORTED          no evidence at all. NEVER enters the
                          resume. Becomes a gap with a build-evidence
                          route, exactly as Resume OS already does.

   SEMANTIC NORMALISATION uses the existing skillOntology (one
   taxonomy, no competing list) plus an adjacency graph for the
   relationships an alias table cannot express:
     AWS EKS  → Kubernetes (implies) + AWS (implies)
     GitLab CI→ CI/CD (parent practice)
   Adjacency NEVER upgrades a skill to SUPPORTED on its own; it can
   only lift UNSUPPORTED → PARTIALLY_SUPPORTED.
   ============================================================ */
import { canonicalSkill, toCanonicalSet } from '../skillOntology.js';

export const SKILL_INTELLIGENCE_VERSION = 'skill-intelligence-v1';

export const SUPPORT = Object.freeze({
  SUPPORTED: 'SUPPORTED',
  PARTIALLY_SUPPORTED: 'PARTIALLY_SUPPORTED',
  UNSUPPORTED: 'UNSUPPORTED',
});

/* Three relationships, deliberately kept distinct, because collapsing them
   is how a deterministic engine starts lying politely.

   implies:   using X means you genuinely did Y, and Y may be WRITTEN.
              These are language, practice and engine relationships —
              PySpark means you wrote Python; GitLab CI means you did CI/CD.
              Nobody is misrepresented by either sentence.

   substrate: X runs on Y. You touched Y's substrate without necessarily
              doing Y as a product. Satisfies a requirement, never writable.
              OpenShift engineers have real container-platform depth, but a
              recruiter screening for Kubernetes means Kubernetes, and the
              candidate is the one who has to survive that conversation.

   adjacent:  neighbours. A partial signal for ranking and gap advice only. */
const ADJACENCY = [
  { skill: 'aws eks', implies: ['amazon web services'], substrate: ['kubernetes'], adjacent: ['docker', 'helm'] },
  { skill: 'openshift', implies: [], substrate: ['kubernetes'], adjacent: ['docker', 'helm', 'ci/cd'] },
  { skill: 'helm', implies: [], substrate: ['kubernetes'], adjacent: ['ci/cd'] },
  { skill: 'gitlab ci', implies: ['ci/cd'], adjacent: ['jenkins', 'github actions', 'docker'] },
  { skill: 'github actions', implies: ['ci/cd'], adjacent: ['gitlab ci', 'jenkins'] },
  { skill: 'jenkins', implies: ['ci/cd'], adjacent: ['gitlab ci', 'github actions', 'groovy'] },
  { skill: 'argocd', implies: ['ci/cd'], substrate: ['kubernetes'], adjacent: ['helm'] },
  { skill: 'terraform', implies: [], adjacent: ['ansible', 'cloudformation', 'pulumi'] },
  { skill: 'pyspark', implies: ['apache spark', 'python'], adjacent: ['databricks', 'scala'] },
  { skill: 'databricks', implies: ['apache spark'], adjacent: ['pyspark', 'delta lake'] },
  { skill: 'airflow', implies: ['python'], adjacent: ['dbt', 'prefect'] },
  { skill: 'dbt', implies: ['sql'], adjacent: ['snowflake', 'bigquery', 'airflow'] },
  { skill: 'snowflake', implies: ['sql'], adjacent: ['redshift', 'bigquery', 'data warehouse'] },
  { skill: 'redshift', implies: ['sql', 'amazon web services'], adjacent: ['snowflake', 'bigquery'] },
  { skill: 'bigquery', implies: ['sql', 'google cloud platform'], adjacent: ['snowflake', 'redshift'] },
  { skill: 'postgresql', implies: ['sql'], adjacent: ['mysql', 'oracle'] },
  { skill: 'mysql', implies: ['sql'], adjacent: ['postgresql'] },
  { skill: 'react', implies: ['javascript'], adjacent: ['typescript', 'next.js', 'redux'] },
  { skill: 'next.js', implies: ['react', 'javascript'], adjacent: ['typescript'] },
  { skill: 'typescript', implies: ['javascript'], adjacent: [] },
  { skill: 'node.js', implies: ['javascript'], adjacent: ['express', 'typescript'] },
  { skill: 'spring boot', implies: ['java'], adjacent: ['maven', 'gradle', 'rest api'] },
  { skill: 'django', implies: ['python'], adjacent: ['flask', 'fastapi'] },
  { skill: 'flask', implies: ['python'], adjacent: ['django', 'fastapi'] },
  { skill: 'pytorch', implies: ['python', 'deep learning'], adjacent: ['tensorflow'] },
  { skill: 'tensorflow', implies: ['python', 'deep learning'], adjacent: ['pytorch', 'keras'] },
  { skill: 'scikit-learn', implies: ['python', 'machine learning'], adjacent: ['pandas', 'numpy'] },
  { skill: 'pandas', implies: ['python'], adjacent: ['numpy', 'scikit-learn'] },
  { skill: 'kafka', implies: [], adjacent: ['rabbitmq', 'kinesis', 'streaming'] },
  { skill: 'prometheus', implies: [], adjacent: ['grafana', 'datadog'] },
  { skill: 'grafana', implies: [], adjacent: ['prometheus', 'kibana'] },
  { skill: 'sonarqube', implies: [], adjacent: ['veracode', 'snyk', 'code quality'] },
  { skill: 'veracode', implies: [], adjacent: ['sonarqube', 'snyk', 'prisma'] },
  { skill: 'docker', implies: [], adjacent: ['kubernetes', 'podman', 'containerization'] },
  { skill: 'kubernetes', implies: [], adjacent: ['docker', 'helm', 'openshift'] },
  { skill: 'power bi', implies: [], adjacent: ['tableau', 'looker', 'excel'] },
  { skill: 'tableau', implies: [], adjacent: ['power bi', 'looker'] },
];

const IMPLIES = new Map();
const SUBSTRATE = new Map();
const ADJACENT = new Map();
for (const row of ADJACENCY) {
  const k = canonicalSkill(row.skill);
  IMPLIES.set(k, (row.implies || []).map(canonicalSkill));
  SUBSTRATE.set(k, (row.substrate || []).map(canonicalSkill));
  ADJACENT.set(k, (row.adjacent || []).map(canonicalSkill));
  /* Adjacency is symmetric. */
  for (const a of (row.adjacent || []).map(canonicalSkill)) {
    if (!ADJACENT.has(a)) ADJACENT.set(a, []);
    if (!ADJACENT.get(a).includes(k)) ADJACENT.get(a).push(k);
  }
}

/** Expand one skill into everything its use demonstrably implies. */
export function expandImplied(skill) {
  const c = canonicalSkill(skill);
  const out = new Set([c]);
  const queue = [c];
  while (queue.length) {
    const cur = queue.pop();
    for (const imp of IMPLIES.get(cur) || []) {
      if (!out.has(imp)) { out.add(imp); queue.push(imp); }
    }
  }
  return [...out];
}

export function adjacentSkills(skill) {
  return ADJACENT.get(canonicalSkill(skill)) || [];
}

/** Platforms X runs on. Satisfies requirements; never writable. */
export function substrateOf(skill) {
  const c = canonicalSkill(skill);
  const out = new Set();
  for (const sub of SUBSTRATE.get(c) || []) out.add(sub);
  /* Substrate of an implied skill is substrate too: pyspark → spark → (none),
     argocd → ci/cd → (none). Bounded by the table's shallow depth. */
  for (const imp of IMPLIES.get(c) || []) {
    for (const sub of SUBSTRATE.get(imp) || []) out.add(sub);
  }
  return [...out];
}

/**
 * Classify a set of target skills against the candidate's evidence graph.
 *
 * @param {string[]} targetSkills   from Job Intelligence (or role dictionary)
 * @param {object}   graph          evidence graph
 * @param {string[]} verifiedSkills server-verified
 */
export function classifySkills(targetSkills = [], graph, { verifiedSkills = [] } = {}) {
  const verified = toCanonicalSet(verifiedSkills);

  /* Skills PROVEN BY USE — the term is literally named inside an achievement.
     These are the ONLY skills that may be written into the resume.

     Implication is tracked SEPARATELY. "OpenShift implies Kubernetes" is true
     as a statement about technology and false as a statement about a person:
     a recruiter filtering for Kubernetes wants someone who has run Kubernetes,
     and an OpenShift engineer who lets the engine write "Kubernetes" into
     their resume will be found out in the first screening call. Implication
     therefore earns PARTIALLY_SUPPORTED — good enough to satisfy a
     requirement group and to inform gap advice, never good enough to claim. */
  const usedDirect = new Set();
  const usedImplied = new Set();
  const usageEvidence = new Map();
  const impliedBy = new Map();
  for (const r of graph?.records || []) {
    if (r.type !== 'achievement' && r.type !== 'available_project') continue;
    for (const s of r.skills || []) {
      const direct = canonicalSkill(s);
      usedDirect.add(direct);
      if (!usageEvidence.has(direct)) usageEvidence.set(direct, []);
      if (usageEvidence.get(direct).length < 4) usageEvidence.get(direct).push(r.id);
      /* Claimable implications join the direct set — writing "Python" for a
         PySpark engineer is accurate, not generous. */
      for (const imp of expandImplied(s)) {
        if (imp === direct) continue;
        usedDirect.add(imp);
        if (!usageEvidence.has(imp)) usageEvidence.set(imp, []);
        if (usageEvidence.get(imp).length < 4) usageEvidence.get(imp).push(r.id);
      }
      for (const imp of substrateOf(s)) {
        if (imp === direct) continue;
        usedImplied.add(imp);
        if (!impliedBy.has(imp)) impliedBy.set(imp, []);
        if (!impliedBy.get(imp).includes(direct)) impliedBy.get(imp).push(direct);
        if (!usageEvidence.has(imp)) usageEvidence.set(imp, []);
        if (usageEvidence.get(imp).length < 4) usageEvidence.get(imp).push(r.id);
      }
    }
  }
  /* A term that is both used directly and implied is simply used. */
  for (const d of usedDirect) usedImplied.delete(d);
  const usedInAchievement = usedDirect;

  /* Skills merely DECLARED (skills section, GitHub manifest, profile). */
  const declared = new Set();
  for (const r of graph?.records || []) {
    if (r.type !== 'skill' && r.type !== 'connected_signal' && r.type !== 'certification') continue;
    for (const s of r.skills || []) declared.add(canonicalSkill(s));
  }

  const results = [];
  for (const raw of targetSkills) {
    const skill = String(raw);
    const c = canonicalSkill(skill);
    let status = SUPPORT.UNSUPPORTED;
    let basis = 'no_evidence';
    let evidenceIds = [];
    let confidence = 0;

    if (verified.has(c)) {
      status = SUPPORT.SUPPORTED; basis = 'server_verified'; confidence = 1;
      evidenceIds = usageEvidence.get(c) || [];
    } else if (usedInAchievement.has(c)) {
      status = SUPPORT.SUPPORTED; basis = 'used_in_achievement'; confidence = 0.85;
      evidenceIds = usageEvidence.get(c) || [];
    } else if (usedImplied.has(c)) {
      /* Satisfies a requirement, does not license the word. */
      const via = impliedBy.get(c) || [];
      results.push({
        skill, canonical: c, status: SUPPORT.PARTIALLY_SUPPORTED,
        basis: 'implied_by_related_technology', confidence: 0.6,
        evidenceIds: usageEvidence.get(c) || [],
        impliedBy: via,
        note: `Your ${via.join(' and ')} experience covers much of what ${skill} requires, so this requirement is not a blocker. It is not written into your resume as ${skill}, because you have not named ${skill} in your own evidence.`,
        insertable: false,
      });
      continue;
    } else if (declared.has(c)) {
      status = SUPPORT.PARTIALLY_SUPPORTED; basis = 'declared_not_demonstrated'; confidence = 0.5;
    } else {
      const neighbours = adjacentSkills(c).filter((n) => usedInAchievement.has(n) || verified.has(n));
      if (neighbours.length) {
        status = SUPPORT.PARTIALLY_SUPPORTED; basis = 'adjacent_experience'; confidence = 0.35;
        evidenceIds = neighbours.flatMap((n) => usageEvidence.get(n) || []).slice(0, 3);
        results.push({
          skill, canonical: c, status, basis, confidence, evidenceIds,
          adjacentTo: neighbours,
          note: `No direct ${skill} evidence. You have evidence for ${neighbours.join(', ')} — related, but not the same claim.`,
          insertable: false,
        });
        continue;
      }
    }

    results.push({
      skill, canonical: c, status, basis, confidence, evidenceIds,
      /* THE RULE: only SUPPORTED skills may ever be written into the resume. */
      insertable: status === SUPPORT.SUPPORTED,
      note: status === SUPPORT.SUPPORTED
        ? (basis === 'server_verified' ? 'Server-verified.' : 'Demonstrated in your own work history.')
        : status === SUPPORT.PARTIALLY_SUPPORTED
          ? 'Listed but never shown in an achievement — add a bullet that proves it, or leave it as a skills-section entry.'
          : 'No evidence anywhere in your profile. This is a genuine gap, not a wording problem.',
    });
  }

  const by = (s) => results.filter((r) => r.status === s);
  return {
    version: SKILL_INTELLIGENCE_VERSION,
    results,
    supported: by(SUPPORT.SUPPORTED),
    partiallySupported: by(SUPPORT.PARTIALLY_SUPPORTED),
    unsupported: by(SUPPORT.UNSUPPORTED),
    /* The ONLY list downstream code may insert. */
    insertable: results.filter((r) => r.insertable).map((r) => r.skill),
    coverage: targetSkills.length
      ? Number((by(SUPPORT.SUPPORTED).length / targetSkills.length).toFixed(3))
      : 1,
  };
}

/**
 * Order the resume's own skills for a target. Never adds; only reorders and
 * groups. Unsupported JD skills are deliberately absent from the result.
 */
export function prioritizeSkills(docSkills = [], classification, { maxPerGroup = 12 } = {}) {
  const rank = new Map();
  for (const r of classification?.results || []) {
    rank.set(r.canonical, r.status === 'SUPPORTED' ? 3 : r.status === 'PARTIALLY_SUPPORTED' ? 1 : 0);
  }
  const scored = docSkills.map((s, i) => ({
    ...s,
    _rank: (rank.get(canonicalSkill(s.name)) || 0) + (s.status === 'VERIFIED' ? 1.5 : 0),
    _i: i,
  }));
  scored.sort((a, b) => b._rank - a._rank || a._i - b._i);
  const groups = new Map();
  for (const s of scored) {
    const g = s.group || 'Core';
    if (!groups.has(g)) groups.set(g, []);
    if (groups.get(g).length < maxPerGroup) groups.get(g).push(s);
  }
  return {
    ordered: scored.map(({ _rank, _i, ...rest }) => rest),
    groups: [...groups.entries()].map(([group, items]) => ({ group, items: items.map(({ _rank, _i, ...r }) => r) })),
  };
}

/** Terminology alignment pairs: candidate's word → JD's canonical word. */
/* Only PRACTICE-level umbrellas may be substituted in. Replacing a specific
   tool with a language or platform ("Snowflake" -> "SQL", "Spring Boot" ->
   "Java") destroys information and misrepresents the work, so those
   implications are never used for wording alignment. */
const UMBRELLA_TERMS = new Set([
  'ci/cd', 'infrastructure as code', 'data pipeline', 'etl', 'data warehouse',
  'machine learning', 'deep learning', 'rest api', 'unit testing', 'version control',
  'containerization', 'monitoring', 'streaming', 'microservices', 'data modeling',
]);

export function buildTerminologyAlignment(classification, jobIntel) {
  if (!jobIntel) return [];
  const out = [];
  const supported = new Set((classification?.supported || []).map((s) => s.canonical));
  for (const p of jobIntel.prioritySkills || []) {
    const c = p.canonical;
    if (!supported.has(c)) continue;
    if (!UMBRELLA_TERMS.has(c)) continue;
    /* If the JD says "CI/CD" and the candidate proved it through "GitLab CI",
       we may introduce the canonical umbrella term — because the umbrella is
       genuinely implied by what they did. */
    for (const row of ADJACENCY) {
      const from = canonicalSkill(row.skill);
      if ((IMPLIES.get(from) || []).includes(c) && supported.has(from)) {
        out.push({ from: row.skill, to: p.skill, reason: `${row.skill} demonstrably involves ${p.skill}` });
      }
    }
  }
  /* Dedupe on `from`. */
  const seen = new Set();
  return out.filter((x) => (seen.has(x.from) ? false : (seen.add(x.from), true))).slice(0, 8);
}

export default {
  substrateOf,
  SKILL_INTELLIGENCE_VERSION, SUPPORT, classifySkills, prioritizeSkills,
  expandImplied, adjacentSkills, buildTerminologyAlignment,
};
