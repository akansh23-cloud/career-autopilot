/* ============================================================
   REQUIREMENT GRAPH  (P2.11, P2.12, P2.13)
   ------------------------------------------------------------
   The bug this module exists to kill:

     JD says   "Kubernetes or OpenShift in production"
     Candidate has OpenShift, no Kubernetes
     Old behaviour: requirement satisfied → "Kubernetes" treated
       as a priority term → Kubernetes drifts into the resume.

   Correct behaviour:

     group.status         = SUPPORTED
     group.matchedAlt     = openshift
     group.unmatchedAlts  = [kubernetes]   ← FORBIDDEN vocabulary
     kubernetes never becomes claimable.

   The distinction that makes this work is equivalence vs
   relatedness. Equivalence (K8s ≡ Kubernetes) may rewrite
   terminology. Relatedness (Docker ~ Kubernetes) may inform
   ranking and gap advice and NOTHING else. Conflating the two is
   how deterministic engines quietly start lying.
   ============================================================ */
import { canonicalSkill } from '../skillOntology.js';

export const REQUIREMENT_GRAPH_VERSION = 'requirement-graph-v1';

export const SUPPORT_STATE = Object.freeze({
  SUPPORTED: 'SUPPORTED',
  PARTIALLY_SUPPORTED: 'PARTIALLY_SUPPORTED',
  TRANSFERABLE: 'TRANSFERABLE',
  UNSUPPORTED: 'UNSUPPORTED',
});

export const PRIORITY = Object.freeze({
  MUST: 'must',
  PREFERRED: 'preferred',
  NICE: 'nice-to-have',
});

/* ------------------------------------------------------------------ */
/* Equivalence: same thing, different spelling. Safe to normalise.      */
/* canonicalSkill() already covers most of this; these are the pairs    */
/* it does not, expressed as canonical→canonical.                       */
/* ------------------------------------------------------------------ */
const EQUIVALENCE_CLASSES = [
  ['kubernetes', 'k8s'],
  ['postgresql', 'postgres'],
  ['gitlab ci', 'gitlab pipelines', 'gitlab-ci'],
  ['ci/cd', 'continuous integration', 'continuous delivery', 'continuous deployment'],
  ['ec2', 'amazon ec2'],
  ['s3', 'amazon s3'],
  ['github actions', 'gh actions'],
  ['javascript', 'js'],
  ['typescript', 'ts'],
  ['node.js', 'nodejs', 'node'],
];

const EQUIV = new Map();
for (const cls of EQUIVALENCE_CLASSES) {
  const head = cls[0];
  for (const member of cls) EQUIV.set(member, head);
}

export function equivalenceKey(term) {
  const c = canonicalSkill(String(term || '').trim());
  return EQUIV.get(c) || c;
}

export function areEquivalent(a, b) {
  if (!a || !b) return false;
  return equivalenceKey(a) === equivalenceKey(b);
}

/* ------------------------------------------------------------------ */
/* Relatedness: adjacent, NOT interchangeable. Influences ranking and   */
/* gap guidance only. Explicitly asymmetric where the real world is.    */
/* ------------------------------------------------------------------ */
const RELATED = new Map(Object.entries({
  docker: ['kubernetes', 'openshift', 'containerd', 'podman'],
  kubernetes: ['openshift', 'docker', 'helm', 'rancher'],
  openshift: ['kubernetes', 'docker', 'helm'],
  jenkins: ['gitlab ci', 'github actions', 'circleci', 'bamboo', 'teamcity'],
  'gitlab ci': ['jenkins', 'github actions', 'circleci'],
  'github actions': ['jenkins', 'gitlab ci', 'circleci'],
  terraform: ['cloudformation', 'pulumi', 'ansible', 'arm templates'],
  cloudformation: ['terraform', 'pulumi'],
  ansible: ['puppet', 'chef', 'saltstack', 'terraform'],
  aws: ['azure', 'gcp'],
  azure: ['aws', 'gcp'],
  gcp: ['aws', 'azure'],
  prometheus: ['grafana', 'datadog', 'new relic', 'cloudwatch'],
  grafana: ['prometheus', 'kibana', 'datadog'],
  postgresql: ['mysql', 'oracle', 'sql server', 'mariadb'],
  mysql: ['postgresql', 'mariadb'],
  spark: ['hadoop', 'flink', 'databricks'],
  kafka: ['rabbitmq', 'kinesis', 'pubsub', 'activemq'],
  react: ['vue', 'angular', 'svelte'],
  java: ['kotlin', 'scala'],
  python: ['ruby', 'go'],
}));

export function isRelated(a, b) {
  const ka = equivalenceKey(a);
  const kb = equivalenceKey(b);
  if (ka === kb) return false; // equivalent, not merely related
  return (RELATED.get(ka) || []).some((r) => equivalenceKey(r) === kb)
      || (RELATED.get(kb) || []).some((r) => equivalenceKey(r) === ka);
}

/* ------------------------------------------------------------------ */
/* Requirement statement parsing                                        */
/* ------------------------------------------------------------------ */

const MUST_RE = /\b(must have|required|requirement|essential|mandatory|you (?:will )?(?:need|have)|minimum|at least|proven|demonstrated|strong (?:experience|background))\b/i;
const PREFERRED_RE = /\b(preferred|preferably|nice to have|nice-to-have|desirable|bonus|plus|advantageous|would be (?:a )?(?:plus|bonus)|ideally|good to have)\b/i;

/* "A or B", "A / B", "A, B or C" → OR group.
   Deliberately conservative: only splits when the alternatives are short
   noun-ish tokens, because "experience with X or ability to learn Y" is
   not an alternation between two technologies. */
const OR_SPLIT_RE = /\s*(?:\bor\b|\/)\s*/i;

function priorityOf(text) {
  /* Preferred wins when both markers appear, because JDs write
     "required: X. preferred: Y" and the local marker is the true one. */
  if (PREFERRED_RE.test(text)) return PRIORITY.PREFERRED;
  if (MUST_RE.test(text)) return PRIORITY.MUST;
  return PRIORITY.NICE;
}

/**
 * Given one requirement statement and the skills detected inside it,
 * decide whether those skills form an OR alternation or an AND conjunction.
 */
function detectLogic(statement, skills) {
  if (skills.length < 2) return { logic: 'SINGLE', alternatives: skills.slice() };

  const text = String(statement);
  /* Look for each adjacent skill pair and inspect the connector between
     them in the source text. If any adjacent pair is joined by or/slash,
     treat the whole set as an alternation — JDs rarely mix within one
     clause, and treating a mixed clause as OR is the safe direction
     (it claims less). */
  const positions = skills
    .map((s) => ({ skill: s, at: text.toLowerCase().indexOf(String(s).toLowerCase()) }))
    .filter((p) => p.at >= 0)
    .sort((a, b) => a.at - b.at);

  for (let i = 0; i < positions.length - 1; i += 1) {
    const between = text.slice(positions[i].at + String(positions[i].skill).length, positions[i + 1].at);
    if (between.length <= 12 && OR_SPLIT_RE.test(between)) {
      return { logic: 'OR', alternatives: positions.map((p) => p.skill) };
    }
  }
  return { logic: 'AND', alternatives: positions.length ? positions.map((p) => p.skill) : skills.slice() };
}

/* ------------------------------------------------------------------ */
/* Support resolution                                                   */
/* ------------------------------------------------------------------ */

function supportForTerm(term, { supportedKeys, partialKeys, evidenceIndex }) {
  const key = equivalenceKey(term);
  if (supportedKeys.has(key)) {
    return { state: SUPPORT_STATE.SUPPORTED, evidenceIds: evidenceIndex.get(key) || [] };
  }
  if (partialKeys.has(key)) {
    return { state: SUPPORT_STATE.PARTIALLY_SUPPORTED, evidenceIds: evidenceIndex.get(key) || [] };
  }
  /* Transferable: the candidate has something genuinely adjacent. This
     never authorises a claim; it only explains the gap and nudges ranking. */
  for (const owned of supportedKeys) {
    if (isRelated(owned, key)) {
      return {
        state: SUPPORT_STATE.TRANSFERABLE,
        evidenceIds: evidenceIndex.get(owned) || [],
        via: owned,
      };
    }
  }
  return { state: SUPPORT_STATE.UNSUPPORTED, evidenceIds: [] };
}

const STATE_RANK = {
  [SUPPORT_STATE.SUPPORTED]: 3,
  [SUPPORT_STATE.PARTIALLY_SUPPORTED]: 2,
  [SUPPORT_STATE.TRANSFERABLE]: 1,
  [SUPPORT_STATE.UNSUPPORTED]: 0,
};

/**
 * Build the requirement graph.
 *
 * @param {object} jobIntel   output of buildJobIntelligence()
 * @param {object} classification output of classifySkills()
 * @param {object} opts.evidenceIndex Map<equivalenceKey, evidenceId[]>
 * @param {number} opts.requirementDepth how many statements to analyse (depth-aware)
 */
export function buildRequirementGraph(jobIntel, classification, {
  evidenceIndex = new Map(), requirementDepth = 40,
} = {}) {
  const empty = {
    version: REQUIREMENT_GRAPH_VERSION,
    groups: [],
    claimableTerms: [],
    forbiddenTerms: [],
    transferableTerms: [],
    counts: { total: 0, supported: 0, partiallySupported: 0, transferable: 0, unsupported: 0 },
  };
  if (!jobIntel) return empty;

  const supportedKeys = new Set((classification?.supported || []).map((s) => equivalenceKey(s.canonical || s.skill)));
  const partialKeys = new Set((classification?.partiallySupported || []).map((s) => equivalenceKey(s.canonical || s.skill)));

  const statements = (jobIntel.requirements?.all || []).slice(0, requirementDepth);
  const groups = [];
  let seq = 0;

  for (const st of statements) {
    const skills = (st.skills || []).filter(Boolean);
    if (!skills.length) continue;

    const { logic, alternatives } = detectLogic(st.text, skills);
    const priority = st.tier === 'mandatory' ? PRIORITY.MUST
      : st.tier === 'strong_preference' ? PRIORITY.PREFERRED
        : priorityOf(st.text);

    const members = alternatives.map((term) => {
      const s = supportForTerm(term, { supportedKeys, partialKeys, evidenceIndex });
      return {
        term,
        key: equivalenceKey(term),
        state: s.state,
        evidenceIds: s.evidenceIds,
        via: s.via || null,
      };
    });

    /* Group resolution.
       OR  → the group is as strong as its STRONGEST member.
       AND → the group is as strong as its WEAKEST member. */
    let status;
    let matched = null;
    if (logic === 'OR' || logic === 'SINGLE') {
      const best = members.slice().sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state])[0];
      status = best.state;
      matched = best.state === SUPPORT_STATE.SUPPORTED ? best : null;
    } else {
      const worst = members.slice().sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state])[0];
      const anySupported = members.some((m) => m.state === SUPPORT_STATE.SUPPORTED);
      status = worst.state === SUPPORT_STATE.SUPPORTED
        ? SUPPORT_STATE.SUPPORTED
        : anySupported ? SUPPORT_STATE.PARTIALLY_SUPPORTED : worst.state;
      matched = members.find((m) => m.state === SUPPORT_STATE.SUPPORTED) || null;
    }

    seq += 1;
    groups.push({
      id: `req-${seq}`,
      text: String(st.text || '').slice(0, 300),
      logic,
      priority,
      categories: st.categories || [],
      members,
      status,
      matchedAlternative: matched ? matched.term : null,
      matchedEvidenceIds: matched ? matched.evidenceIds : [],
      /* THE IMPORTANT FIELD. Alternatives in this group that the candidate
         does NOT have. Satisfying the group via a sibling does not license
         these words. */
      unmatchedAlternatives: members
        .filter((m) => m.state !== SUPPORT_STATE.SUPPORTED)
        .map((m) => m.term),
    });
  }

  /* Vocabulary partitions used downstream. */
  const claimable = new Set();
  const forbidden = new Set();
  const transferable = new Set();

  for (const g of groups) {
    for (const m of g.members) {
      if (m.state === SUPPORT_STATE.SUPPORTED) claimable.add(m.key);
      else if (m.state === SUPPORT_STATE.TRANSFERABLE) { transferable.add(m.key); forbidden.add(m.key); }
      else forbidden.add(m.key);
    }
  }
  /* A term can never be both. Supported anywhere wins, because the same
     technology may appear in several statements. */
  for (const k of claimable) { forbidden.delete(k); transferable.delete(k); }

  /* Priority skills the JD mentions outside parseable statements are still
     subject to the same rule: unsupported means forbidden. */
  for (const p of jobIntel.prioritySkills || []) {
    const key = equivalenceKey(p.canonical || p.skill);
    if (claimable.has(key)) continue;
    if (supportedKeys.has(key)) { claimable.add(key); forbidden.delete(key); continue; }
    forbidden.add(key);
  }

  const counts = {
    total: groups.length,
    supported: groups.filter((g) => g.status === SUPPORT_STATE.SUPPORTED).length,
    partiallySupported: groups.filter((g) => g.status === SUPPORT_STATE.PARTIALLY_SUPPORTED).length,
    transferable: groups.filter((g) => g.status === SUPPORT_STATE.TRANSFERABLE).length,
    unsupported: groups.filter((g) => g.status === SUPPORT_STATE.UNSUPPORTED).length,
  };

  return {
    version: REQUIREMENT_GRAPH_VERSION,
    groups,
    claimableTerms: [...claimable],
    forbiddenTerms: [...forbidden],
    transferableTerms: [...transferable],
    counts,
  };
}

/**
 * Terms the composer is allowed to introduce. Strictly the intersection of
 * "JD wants it" and "candidate evidence supports it".
 */
export function claimableVocabulary(reqGraph) {
  return new Set((reqGraph?.claimableTerms) || []);
}

/**
 * Terms that must never appear in generated content that did not already
 * contain them. This is the leakage tripwire.
 */
export function forbiddenVocabulary(reqGraph) {
  return new Set((reqGraph?.forbiddenTerms) || []);
}

export default {
  REQUIREMENT_GRAPH_VERSION, SUPPORT_STATE, PRIORITY,
  buildRequirementGraph, claimableVocabulary, forbiddenVocabulary,
  equivalenceKey, areEquivalent, isRelated,
};
