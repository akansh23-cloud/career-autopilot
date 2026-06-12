/* ============================================================
   Synthesis Intelligence — domain classifier
   ------------------------------------------------------------
   Deterministic, dependency-free classification that runs BEFORE
   final idea generation and influences everything downstream:
   idea framing, build brief, blueprint, evidence selection, and
   IP-readiness scoring. No AI key required — keyword scoring
   over query + cluster + evidence text.
   ============================================================ */
import { lc, extractKeywords, sanitizeText } from '../problemIntelligence/util.js';
import { DOMAIN_PROFILES, GENERIC_PROFILE } from './domainProfiles.js';

const INTENT_RULES = [
  ['patent_readiness', /\bpatent|prior[- ]art|invention|ip[- ](review|potential|readiness)|novel(ty)?\b/],
  ['research', /\bresearch|thesis|paper|study|academic|publication\b/],
  ['startup', /\bstartup|saas|monetiz|business idea|founders?\b/],
  ['learning', /\blearn(ing)?\b.*\b(plan|path)\b|\btutorial|study plan|curriculum\b/],
  ['portfolio_project', /.*/], // default
];

const PROJECT_TYPE_RULES = [
  ['simulation', /\bsimulat|digital twin|training (sim|environment)\b/],
  ['iot_system', /\biot\b|\bsensor|embedded|esp32|arduino|raspberry|mqtt\b/],
  ['ml_system', /\bmodel|machine learning|\bml\b|\bai\b|classif|detect(ion)?|vision|nlp|llm|recommend/],
  ['data_pipeline', /\bpipeline|etl|ingest|dataset|analytics|aggregat/],
  ['dashboard_plus_engine', /\bdashboard|monitor|intelligence|tracking|visibility\b/],
  ['cli_tool', /\bcli\b|command[- ]line|developer tool|automation tool\b/],
  ['platform', /\bplatform|marketplace|portal|collaboration|community\b/],
  ['web_app', /.*/], // default
];

const DIFFICULTY_HEAVY = /\btrain(ing)? (a |the )?model|computer vision|sensor fusion|real[- ]?time|distributed|kubernetes|gpu|hardware|simulation engine|knowledge graph|optimization algorithm\b/;
const DIFFICULTY_LIGHT = /\bsimple|basic|beginner|starter|first project\b/;

/* Score one profile against the combined text + structured hints. */
function profileScore(profile, text, hints) {
  let score = 0;
  for (const kw of profile.match) {
    if (text.includes(kw)) score += kw.includes(' ') ? 3 : 2; // multiword matches are stronger
  }
  const hintText = lc(`${hints.domain || ''} ${hints.technology || ''} ${hints.targetUser || ''}`);
  for (const kw of profile.match) if (hintText.includes(kw)) score += 2;
  return score;
}

function pickSubdomain(profile, text) {
  let best = profile.subdomains[0] || '';
  let bestHits = -1;
  for (const sd of profile.subdomains) {
    const tokens = lc(sd).split(/[\s/]+/).filter((t) => t.length > 3);
    const hits = tokens.filter((t) => text.includes(t)).length;
    if (hits > bestHits) { bestHits = hits; best = sd; }
  }
  return best;
}

function detectIntentLabel(text) {
  for (const [label, re] of INTENT_RULES) if (re.test(text)) return label;
  return 'portfolio_project';
}

function detectProjectType(text, profileKey) {
  // Domain key gives a strong prior for some domains.
  if (profileKey === 'simulation') return 'simulation';
  if (profileKey === 'iot') return 'iot_system';
  for (const [label, re] of PROJECT_TYPE_RULES) if (re.test(text)) return label;
  return 'web_app';
}

function detectDifficulty(text, requested) {
  const r = lc(requested || '');
  if (/advanced|hard|expert/.test(r)) return 'advanced';
  if (/beginner|easy|simple/.test(r)) return 'beginner';
  if (/intermediate|medium/.test(r)) return 'intermediate';
  if (DIFFICULTY_LIGHT.test(text)) return 'beginner';
  if (DIFFICULTY_HEAVY.test(text)) return 'advanced';
  return 'intermediate';
}

/* Pull concrete target users: explicit hint > profile defaults. */
function resolveTargetUsers(profile, hints, text) {
  const explicit = sanitizeText(hints.targetUser || '', 120);
  const users = [];
  if (explicit && !/^(users?|people|everyone|end users?)$/i.test(explicit)) users.push(explicit);
  for (const u of profile.targetUsers) {
    if (users.length >= 3) break;
    if (!users.some((x) => lc(x) === lc(u))) users.push(u);
  }
  // Light re-ranking: profile users whose tokens appear in the query float up.
  return users
    .map((u) => ({ u, hit: lc(u).split(/\s+/).some((t) => t.length > 4 && text.includes(t)) ? 1 : 0 }))
    .sort((a, b) => b.hit - a.hit)
    .map((x) => x.u)
    .slice(0, 3);
}

/**
 * classifyIdeaContext — the single classification entry point.
 * Accepts the original query plus any structured hints (domain, technology,
 * targetUser), the source cluster, and normalized evidence items.
 */
export function classifyIdeaContext({ query = '', domain = '', technology = '', targetUser = '', cluster = null, evidence = [] } = {}) {
  const clusterText = cluster ? `${cluster.title || ''} ${cluster.summary || ''} ${(cluster.keywords || []).join(' ')}` : '';
  const evidenceText = (evidence || []).slice(0, 12).map((e) => `${e.title || ''} ${e.summary || e.contentSummary || ''}`).join(' ');
  const text = lc(`${query} ${domain} ${technology} ${targetUser} ${clusterText} ${evidenceText}`);
  const hints = { domain, technology, targetUser };

  let bestKey = 'generic';
  let bestScore = 0;
  const scores = {};
  for (const [key, profile] of Object.entries(DOMAIN_PROFILES)) {
    const s = profileScore(profile, text, hints);
    scores[key] = s;
    if (s > bestScore) { bestScore = s; bestKey = key; }
  }
  const profile = bestScore >= 2 ? DOMAIN_PROFILES[bestKey] : GENERIC_PROFILE;
  const resolvedKey = bestScore >= 2 ? bestKey : 'generic';

  const keywords = extractKeywords(`${query} ${clusterText}`, 12);
  const projectType = detectProjectType(text, resolvedKey);
  const difficulty = detectDifficulty(text, cluster?.difficulty || '');
  const intent = detectIntentLabel(text);
  const targetUsers = resolveTargetUsers(profile, hints, text);

  // IP analysis is appropriate only when the domain isn't structurally weak
  // for IP AND the intent or domain suggests a technical mechanism exists.
  const ipAppropriate = profile.ip.appropriate !== 'weak';

  return {
    domain: resolvedKey,
    domainLabel: profile.label,
    subdomain: pickSubdomain(profile, text),
    intent,
    targetUsers,
    projectType,
    expectedPrototypeType: profile.prototypeType,
    difficulty,
    dataNeeds: profile.dataSources.slice(0, 4),
    sensitivityConstraints: profile.sensitivity.slice(),
    ipAnalysisAppropriate: ipAppropriate,
    ipCaution: profile.ip.caution,
    keywords,
    classificationConfidence: bestScore >= 6 ? 'high' : bestScore >= 2 ? 'medium' : 'low',
    matchedScore: bestScore,
    allScores: scores,
  };
}

export default { classifyIdeaContext };
