/* ============================================================
   Career Intelligence — intent router
   ------------------------------------------------------------
   Deterministic keyword + scoring classification of a natural
   language query. NO AI call is required for routing — this is
   pure, fast and testable. The AI layer (if configured) only
   enriches prose later; it never changes routing or scores.
   ============================================================ */
import { lc, extractKeywords, sanitizeText } from '../problemIntelligence/util.js';

export const INTENTS = [
  'project_idea', 'patent_research', 'resume_value', 'career_roadmap',
  'market_validation', 'local_business', 'dataset_project', 'security_project',
  'healthcare_project', 'ai_ml_project', 'startup_idea', 'learning_plan',
];

/* Each intent has weighted keyword patterns. Score = sum of weights of
   matching patterns. Ties resolve by INTENT_PRIORITY order (specific intents
   beat generic ones). */
const RULES = {
  patent_research: [
    [/\bpatent(able|ability)?\b/, 5], [/prior[- ]art/, 5], [/\bnovel(ty)?\b/, 3],
    [/\binvention\b/, 4], [/\bip\b.*(potential|protect)/, 3], [/\bclaims?\b.*(outline|draft)/, 3],
  ],
  security_project: [
    [/\bcve(s)?\b/, 6], [/\bcyber ?security\b/, 5], [/\bvulnerabilit/, 5], [/\bnvd\b/, 5],
    [/\bsecurity\b/, 3], [/\bpentest|threat model|malware|exploit db\b/, 4], [/\binfosec\b/, 4],
  ],
  healthcare_project: [
    [/\bhealth ?care\b/, 5], [/\bmedical|medicine|clinical|hospital|patient(s)?\b/, 4],
    [/\bdrug(s)?\b/, 3], [/\bfda\b/, 4], [/\bdiagnos/, 3], [/\bpharma/, 3],
  ],
  ai_ml_project: [
    [/\bai\b/, 3], [/\bmachine learning\b|\bml\b/, 4], [/\bdeep learning|neural|llm|genai|generative ai\b/, 4],
    [/\bnlp|computer vision|recommendation engine\b/, 4], [/\bmodel(s)? (training|tuning)\b/, 3],
  ],
  local_business: [
    [/\blocal\b/, 4], [/\bshop ?owners?|kirana|store owners?|restaurants?|salons?\b/, 5],
    [/\bsmall business(es)?\b/, 5], [/\bneighbou?rhood|city|town\b/, 2],
  ],
  dataset_project: [
    [/\bdataset(s)?\b/, 5], [/\bpublic data\b/, 5], [/\bopen data\b/, 5], [/\bdata\.gov\b/, 5],
    [/\breal (public )?data\b/, 4], [/\bcsv|api data\b/, 2],
  ],
  career_roadmap: [
    [/\broadmap\b/, 5], [/\bcareer (path|plan|switch|transition)\b/, 5], [/\bskills? (gap|i need|to learn)\b/, 4],
    [/\bbecome a\b/, 3], [/\bjob market\b/, 2], [/\bupskill/, 4],
  ],
  learning_plan: [
    [/\blearn(ing)? (plan|path)\b/, 6], [/\bstudy plan\b/, 5], [/\bcurriculum\b/, 4],
    [/\btutorial(s)?\b/, 3], [/\bteach me|how (do|to) i learn\b/, 4], [/\b30[- ]day|weekly plan\b/, 2],
  ],
  market_validation: [
    [/\bvalidat(e|ion)\b/, 5], [/\bmarket (size|demand|signal|research)\b/, 5], [/\bcompetitor(s)?\b/, 4],
    [/\bis there demand\b/, 5], [/\bproduct[- ]market fit\b/, 5],
  ],
  startup_idea: [
    [/\bsaas\b/, 5], [/\bstartup\b/, 5], [/\bbusiness idea\b/, 5], [/\bmicro[- ]saas\b/, 5],
    [/\bmonetiz/, 3], [/\bfounders?\b/, 2],
  ],
  resume_value: [
    [/\bresume\b|\bcv\b/, 5], [/\bats\b/, 4], [/\brecruiters?\b/, 3], [/\binterview\b/, 3],
    [/\blinkedin\b/, 3], [/\bbullet(s| points?)\b/, 3], [/\bhelp my (resume|profile)\b/, 5],
  ],
  project_idea: [
    [/\bproject(s)?\b/, 4], [/\bbuild (me )?(a|an)\b/, 3], [/\bcreate (a|an)\b/, 2],
    [/\bportfolio\b/, 3], [/\bside project\b/, 4], [/\bidea(s)?\b/, 2], [/\bmvp\b/, 3],
  ],
};

/* Specific → generic. First match wins ties. */
const INTENT_PRIORITY = ['security_project', 'healthcare_project', 'startup_idea', 'local_business', 'dataset_project', 'patent_research', 'career_roadmap', 'learning_plan', 'market_validation', 'ai_ml_project', 'resume_value', 'project_idea'];

const DOMAIN_HINTS = [
  ['healthcare', /\bhealth|medical|clinical|patient|pharma|hospital|drug\b/],
  ['cybersecurity', /\bsecurity|cve|vulnerab|cyber|infosec\b/],
  ['fintech', /\bfintech|banking|bfsi|payments?|finance|trading|stocks?\b/],
  ['education', /\beducation|exam(s)?|students?|learning platform|edtech|school|college\b/],
  ['devops', /\bdevops|kubernetes|ci\/?cd|docker|infrastructure|sre\b/],
  ['data engineering', /\bdata (engineer|pipeline|warehouse|lake)|etl|spark|snowflake|databricks\b/],
  ['ai/ml', /\bai\b|\bml\b|machine learning|deep learning|llm|genai\b/],
  ['climate', /\bclimate|weather|environment|sustainab\b/],
  ['retail', /\bshop|retail|store|e-?commerce|kirana\b/],
  ['space', /\bnasa|space|satellite|astronom\b/],
  ['agriculture', /\bagri|farm(ing|er)?|crop(s)?\b/],
  ['logistics', /\blogistics|supply chain|delivery|fleet\b/],
];

const ROLE_HINTS = [
  ['Data Engineer', /\bdata engineer/], ['DevOps Engineer', /\bdevops/], ['ML Engineer', /\bml engineer|machine learning engineer/],
  ['Security Engineer', /\bsecurity engineer|cyber/], ['Backend Engineer', /\bbackend/], ['Frontend Engineer', /\bfrontend/],
  ['Full-Stack Developer', /\bfull[- ]stack/], ['Cloud Engineer', /\bcloud engineer|aws|azure|gcp\b/],
  ['Product Manager', /\bproduct manager|\bpm\b/], ['Data Scientist', /\bdata scien/], ['Software Engineer', /\bsoftware engineer|sde\b/],
];

const TARGET_USER_HINTS = [
  ['shop owners', /\bshop ?owners?|store owners?|kirana\b/], ['students', /\bstudents?\b/],
  ['patients', /\bpatients?\b/], ['doctors', /\bdoctors?|clinicians?\b/], ['recruiters', /\brecruiters?\b/],
  ['developers', /\bdevelopers?|engineers?\b/], ['teachers', /\bteachers?|educators?\b/],
  ['farmers', /\bfarmers?\b/], ['small businesses', /\bsmall business(es)?|smb(s)?\b/],
  ['job seekers', /\bjob ?seekers?|candidates?\b/], ['exam takers', /\bexam (takers|candidates)|online exams?\b/],
];

const COUNTRY_HINTS = [
  ['India', /\bindia(n)?\b|\bnse\b|\bupsc\b|\bbfsi\b/], ['United States', /\b(usa?|united states|american)\b/],
  ['United Kingdom', /\buk\b|britain|united kingdom/], ['Europe', /\beurope(an)?|\beu\b/],
  ['Germany', /german/], ['Japan', /japan/], ['Australia', /australia/], ['Canada', /canada/], ['Singapore', /singapore/],
];

const DIFFICULTY_HINTS = [
  ['beginner', /\bbeginner|easy|simple|starter|first project\b/],
  ['advanced', /\badvanced|complex|hard|production[- ]grade|enterprise\b/],
  ['intermediate', /\bintermediate|mid[- ]level\b/],
];

function scoreIntents(text) {
  const scores = {};
  for (const intent of INTENTS) {
    let s = 0;
    for (const [re, w] of RULES[intent] || []) if (re.test(text)) s += w;
    scores[intent] = s;
  }
  return scores;
}

function firstMatch(text, table, fallback = '') {
  for (const [label, re] of table) if (re.test(text)) return label;
  return fallback;
}

/* mode (auto|project|patent|resume|market|career) can force/boost an intent. */
const MODE_INTENT = { project: 'project_idea', patent: 'patent_research', resume: 'resume_value', market: 'market_validation', career: 'career_roadmap' };

export function detectIntent(query = '', { mode = 'auto' } = {}) {
  const raw = sanitizeText(query, 600);
  const text = lc(raw);
  const scores = scoreIntents(text);

  if (mode !== 'auto' && MODE_INTENT[mode]) scores[MODE_INTENT[mode]] = (scores[MODE_INTENT[mode]] || 0) + 6;

  /* Primary selection uses an ADJUSTED copy of the scores (raw scores stay
     in intentScores for transparency):
     1. In a project-building query ("create/build … project"), resume and
        patent mentions are desired OUTPUTS of the project, not the primary
        intent — halve them for the primary contest only. They still set the
        needs.* flags below from the raw scores.
     2. A domain word qualifies the project ("healthcare … project"), so
        domain intents get a small boost when generic project intent also
        fired — the specific intent should beat the generic one. */
  const DOMAIN_PROJECT_INTENTS = ['healthcare_project', 'security_project', 'ai_ml_project', 'dataset_project', 'local_business', 'startup_idea'];
  const buildContext = /\b(build|create|make|develop|design)\b/.test(text) || /\bproject(s)?\b/.test(text);
  const adjusted = { ...scores };
  if (mode === 'auto' && buildContext && [...DOMAIN_PROJECT_INTENTS, 'project_idea'].some((i) => (scores[i] || 0) > 0)) {
    adjusted.resume_value = Math.floor((adjusted.resume_value || 0) / 2);
    adjusted.patent_research = Math.floor((adjusted.patent_research || 0) / 2);
  }
  if ((scores.project_idea || 0) > 0) {
    for (const i of DOMAIN_PROJECT_INTENTS) if ((adjusted[i] || 0) > 0) adjusted[i] += 2;
  }

  let primaryIntent = 'project_idea';
  let best = -1;
  for (const intent of INTENT_PRIORITY) {
    if ((adjusted[intent] || 0) > best) { best = adjusted[intent] || 0; primaryIntent = intent; }
  }
  if (best <= 0) primaryIntent = MODE_INTENT[mode] || 'project_idea';

  const secondaryIntents = INTENT_PRIORITY
    .filter((i) => i !== primaryIntent && (scores[i] || 0) >= 3)
    .slice(0, 3);

  const wantsPatent = primaryIntent === 'patent_research' || (scores.patent_research || 0) >= 3 || mode === 'patent';
  const wantsResume = primaryIntent === 'resume_value' || (scores.resume_value || 0) >= 3 || mode === 'resume';
  const wantsProject = ['project_idea', 'dataset_project', 'security_project', 'healthcare_project', 'ai_ml_project', 'startup_idea', 'local_business'].includes(primaryIntent)
    || (scores.project_idea || 0) >= 3 || mode === 'project';
  const wantsWorkspace = wantsProject && /\bworkspace|build|create|mvp|starter\b/.test(text);

  const confidence = best >= 8 ? 'high' : best >= 4 ? 'medium' : 'low';

  return {
    query: raw,
    primaryIntent,
    secondaryIntents,
    intentScores: scores,
    confidence,
    domain: firstMatch(text, DOMAIN_HINTS, ''),
    targetRole: firstMatch(text, ROLE_HINTS, ''),
    targetUser: firstMatch(text, TARGET_USER_HINTS, ''),
    country: firstMatch(text, COUNTRY_HINTS, ''),
    difficulty: firstMatch(text, DIFFICULTY_HINTS, 'intermediate'),
    desiredOutput: wantsPatent && wantsProject ? 'project_with_patent_angle'
      : wantsPatent ? 'patent_research'
        : wantsResume && wantsProject ? 'project_with_resume_value'
          : wantsResume ? 'resume_assets'
            : primaryIntent === 'career_roadmap' || primaryIntent === 'learning_plan' ? 'roadmap'
              : primaryIntent === 'market_validation' ? 'market_report' : 'project_blueprint',
    needs: { patent: wantsPatent, resume: wantsResume, project: wantsProject, workspace: wantsWorkspace },
    keywords: extractKeywords(raw, 10),
  };
}

export default { detectIntent, INTENTS };
