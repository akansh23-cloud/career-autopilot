/* ============================================================
   Career Intelligence Engine (collectiveIntelligence)
   ------------------------------------------------------------
   Orchestrates: query → intent detection → source routing →
   multi-source connectors (new + reused Innovation OS ones) →
   normalized evidence → scoring → knowledge-base recall/store →
   generated outputs (ideas, blueprint, patent angle, resume
   value, XP mapping, workspace plan suggestion).

   Deterministic by design: ranking and scores never depend on
   an AI key. Partial source failures degrade into limitations,
   never into errors. No raw API payloads leave this module.
   ============================================================ */
import { ciConfig, sourceRunnable, CI_DISCLAIMER, REUSED_SOURCES } from './config.js';
import { detectIntent } from './intentRouter.js';
import { routeSources } from './sourceRouter.js';
import { makeEvidence, fromCommunitySignal, dedupeEvidence } from './normalizer.js';
import { scoreIdea } from './intelligenceScoringService.js';
import { withCache } from './sourceCache.js';
import { logSourceUsage, storeKnowledge, saveReport, recallKnowledge } from './intelligenceStore.js';
import { stripIdentifiers } from '../innovationMemory/privacyFilterService.js';
import { ingestSignals } from '../problemIntelligence/ingestionService.js';
import { sanitizeText, extractKeywords, clamp } from '../problemIntelligence/util.js';

import { fetchWikipedia } from '../problemIntelligence/connectors/wikipediaConnector.js';
import { fetchCrossref } from '../problemIntelligence/connectors/crossrefConnector.js';
import { fetchOpenAlex } from '../problemIntelligence/connectors/openAlexConnector.js';
import { fetchDataGov } from '../problemIntelligence/connectors/dataGovConnector.js';
import { fetchCensus } from '../problemIntelligence/connectors/censusConnector.js';
import { fetchFDA } from '../problemIntelligence/connectors/fdaConnector.js';
import { fetchNASA } from '../problemIntelligence/connectors/nasaConnector.js';
import { fetchONET } from '../problemIntelligence/connectors/onetConnector.js';
import { fetchESCO } from '../problemIntelligence/connectors/escoConnector.js';
import { fetchNVD } from '../problemIntelligence/connectors/nvdConnector.js';
import { fetchWorldBank } from '../problemIntelligence/connectors/worldBankConnector.js';
import { fetchOpenMeteo } from '../problemIntelligence/connectors/openMeteoConnector.js';
import { fetchOpenStreetMap } from '../problemIntelligence/connectors/openStreetMapConnector.js';
import { fetchYouTube } from '../problemIntelligence/connectors/youtubeConnector.js';
import { fetchGoogleMaps } from '../problemIntelligence/connectors/googleMapsConnector.js';

const NEW_FETCHERS = {
  wikipedia: fetchWikipedia, crossref: fetchCrossref, openalex: fetchOpenAlex,
  datagov: fetchDataGov, census: fetchCensus, fda: fetchFDA, nasa: fetchNASA,
  onet: fetchONET, esco: fetchESCO, nvd: fetchNVD, worldbank: fetchWorldBank,
  openmeteo: fetchOpenMeteo, openstreetmap: fetchOpenStreetMap,
  youtube: fetchYouTube, googlemaps: fetchGoogleMaps,
};

function connectorOpts(name, cfg) {
  const s = cfg.sources[name] || {};
  return {
    timeoutMs: cfg.fetchTimeoutMs, maxBytes: cfg.maxResponseBytes,
    apiKey: s.apiKey || '', mailto: s.mailto || '',
    username: s.username || '', password: s.password || '',
  };
}

/* ---- run the routed sources, partial-failure tolerant ---- */
async function gatherEvidence({ understanding, routing, cfg }) {
  const ctx = {
    query: understanding.query,
    queryKeywords: understanding.keywords,
    keywordsText: understanding.keywords.join(' '),
    roleQuery: understanding.targetRole || understanding.query,
    securityQuery: understanding.keywords.slice(0, 4).join(' '),
    placeQuery: understanding.query,
    location: understanding.country,
    country: understanding.country,
    domain: understanding.domain,
  };

  const checked = [];
  const usage = [];
  const tasks = [];

  const reused = routing.selected.filter((s) => REUSED_SOURCES.includes(s));
  const fresh = routing.selected.filter((s) => NEW_FETCHERS[s]);

  /* New connectors run through the 24h source cache. */
  for (const name of fresh) {
    const t0 = Date.now();
    tasks.push(
      withCache(name, understanding.query, { limit: 6 }, () => NEW_FETCHERS[name](ctx, connectorOpts(name, cfg)), cfg)
        .then((r) => ({ name, r, ms: Date.now() - t0 }))
        .catch((err) => ({ name, r: { ok: false, items: [], error: err?.message || 'connector failed' }, ms: Date.now() - t0 })),
    );
  }

  /* Reused Innovation OS connectors via the existing, tested ingestion
     pipeline (its own cache, dedupe + privacy filter included). */
  let reusedPromise = null;
  if (reused.length) {
    reusedPromise = ingestSignals({
      sources: reused,
      goal: understanding.query.slice(0, 120),
      domain: understanding.domain,
      targetUser: understanding.targetUser,
      keywords: understanding.keywords.join(' '),
      limit: 18,
    }).catch((err) => ({ signals: [], warnings: [err?.message || 'community ingestion failed'], sourceMix: {} }));
  }

  const settled = await Promise.allSettled(tasks);
  let evidence = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const { name, r, ms } = s.value;
    const ok = !!r?.ok;
    const items = Array.isArray(r?.items) ? r.items : [];
    evidence.push(...items);
    checked.push({ source: name, ok, cached: !!r?.cached, items: items.length, note: ok ? '' : sanitizeText(r?.error || 'failed', 140) });
    usage.push({ source: name, ok, cached: !!r?.cached, itemCount: items.length, error: r?.error || '', ms });
  }

  if (reusedPromise) {
    const t0 = Date.now();
    const ing = await reusedPromise;
    const signals = ing?.signals || [];
    evidence.push(...signals.map((sig) => fromCommunitySignal(sig, understanding.keywords)));
    const mix = ing?.bySource || {};
    for (const name of reused) {
      const n = mix[name] ?? signals.filter((x) => x.source === name).length;
      checked.push({ source: name, ok: true, cached: !!ing?.cached, items: n, note: n ? '' : 'no matching signals' });
      usage.push({ source: name, ok: true, cached: !!ing?.cached, itemCount: n, error: '', ms: Date.now() - t0 });
    }
    for (const w of ing?.warnings || []) checked.push({ source: 'community', ok: false, items: 0, note: sanitizeText(w, 140) });
  }

  for (const skip of routing.skipped) checked.push({ source: skip.source, ok: false, items: 0, skipped: true, note: skip.reason });

  logSourceUsage(usage); // fire-and-forget, best-effort
  return { evidence: dedupeEvidence(evidence), checked };
}

/* ---- deterministic idea synthesis ---- */
const TITLE_PREFIX = {
  security_project: 'CVE-aware', healthcare_project: 'Healthcare', ai_ml_project: 'AI-powered',
  local_business: 'Local-business', dataset_project: 'Open-data', startup_idea: 'SaaS',
};

function ideaCandidates(understanding, evidence) {
  const pains = evidence.filter((e) => e.sourceType === 'community_pain_point');
  const datasets = evidence.filter((e) => e.sourceType === 'public_dataset' || e.sourceType === 'government_data');
  const research = evidence.filter((e) => e.sourceType === 'research_paper');
  const security = evidence.filter((e) => e.sourceType === 'security_vulnerability');
  const domain = understanding.domain || 'your domain';
  const role = understanding.targetRole || 'software/data roles';
  const user = understanding.targetUser || 'end users';
  const prefix = TITLE_PREFIX[understanding.primaryIntent] || 'Evidence-backed';

  const ideas = [];

  /* Idea 1 — anchored on the strongest pain point. */
  const topPain = pains.slice().sort((a, b) => (b.relevanceScore + b.rawScore / 10) - (a.relevanceScore + a.rawScore / 10))[0];
  if (topPain) {
    ideas.push({
      title: sanitizeText(`${prefix} solution: ${topPain.title}`, 140),
      problemStatement: topPain.excerpt || topPain.summary || `A recurring ${domain} pain point reported across public communities.`,
      anchoredOn: 'community_pain_point',
      evidenceIds: [topPain.id, ...pains.slice(0, 3).map((e) => e.id)],
      dataSources: datasets.slice(0, 2).map((d) => d.title),
      noveltyAngle: research.length ? `Apply recent research directions (e.g. "${research[0].title}") to a practical ${domain} workflow that current tools don't cover.` : '',
      skills: understanding.keywords.slice(0, 5),
    });
  }

  /* Idea 2 — anchored on the best dataset. */
  const topData = datasets[0];
  if (topData) {
    ideas.push({
      title: sanitizeText(`${prefix} ${domain} platform powered by ${topData.title}`, 140),
      problemStatement: `${user} lack an accessible way to act on ${topData.title} — the raw data exists publicly but no workflow turns it into decisions.`,
      anchoredOn: 'public_dataset',
      evidenceIds: [topData.id, ...datasets.slice(0, 3).map((e) => e.id)],
      dataSources: datasets.slice(0, 3).map((d) => d.title),
      noveltyAngle: pains.length ? `Combine this open dataset with the documented pain "${pains[0].title}" — a pairing no current product addresses end-to-end.` : '',
      skills: understanding.keywords.slice(0, 5),
    });
  }

  /* Idea 3 — security special case (real CVE grounding). */
  if (security.length) {
    ideas.push({
      title: sanitizeText(`CVE intelligence dashboard for ${understanding.keywords.slice(0, 2).join(' ') || domain}`, 140),
      problemStatement: `Teams struggle to track and prioritize live vulnerabilities like ${security[0].title}; severity context is scattered across advisories.`,
      anchoredOn: 'security_vulnerability',
      evidenceIds: security.slice(0, 4).map((e) => e.id),
      dataSources: ['NVD CVE API (free)'],
      noveltyAngle: 'Deterministic risk scoring that joins CVE severity with the user\'s actual stack fingerprint.',
      skills: ['security', ...understanding.keywords.slice(0, 4)],
    });
  }

  /* Fallback — always produce at least one idea so the engine is useful even
     with zero live sources (limitations are reported alongside). */
  if (!ideas.length) {
    ideas.push({
      title: sanitizeText(`${prefix} ${domain} project for ${user}`, 140),
      problemStatement: `Based on your query, a focused ${domain} project targeting ${user} aligned to ${role}. No live evidence was available this run — validate the problem with the sources panel before building.`,
      anchoredOn: 'query_only',
      evidenceIds: [],
      dataSources: [],
      noveltyAngle: '',
      skills: understanding.keywords.slice(0, 5),
    });
  }
  return ideas.slice(0, 3);
}

function blueprintFor(idea, understanding, evidence) {
  const datasets = evidence.filter((e) => e.sourceType === 'public_dataset' || e.sourceType === 'government_data').slice(0, 4);
  const stack = stackFor(understanding);
  return {
    title: idea.title,
    problemStatement: idea.problemStatement,
    targetUsers: understanding.targetUser || 'primary users identified in your query',
    mvpScope: [
      'Ingest one real public data source end-to-end',
      'Core workflow screen that turns raw signals into a decision/action',
      'Deterministic scoring or ranking logic with explainable output',
      'Evidence page: data sources, methodology, limitations',
    ],
    architecture: `${stack.frontend} frontend → ${stack.backend} API → connector layer for public APIs → ${stack.db} for normalized records → deterministic scoring service.`,
    techStack: [stack.frontend, stack.backend, stack.db, ...stack.extras],
    apisAndDataSources: datasets.length ? datasets.map((d) => ({ title: d.title, url: d.url, source: d.source })) : [{ title: 'Add a public data source from the Dataset Options panel', url: '', source: '' }],
    githubStarterStructure: ['README.md', 'web/ (frontend)', 'server/ (API + connectors)', 'server/connectors/', 'server/scoring/', 'test/', '.env.example'],
    tasks: [
      'Set up repo + CI skeleton', 'Build the first data connector with timeout + caching',
      'Normalize records into one schema', 'Implement the deterministic scoring service',
      'Build the core UI workflow', 'Write connector + scoring tests', 'Deploy a demo and record evidence',
    ],
    proofChecklist: ['Public GitHub repo with meaningful commits', 'Working demo URL', 'Test suite passing', 'README explaining data sources + methodology'],
    resumeBullet: `Built ${idea.title} using real public data (${(idea.dataSources[0] || 'open APIs')}), with deterministic scoring and a verifiable demo.`,
  };
}

function stackFor(u) {
  if (u.domain === 'data engineering') return { frontend: 'React', backend: 'Python (FastAPI)', db: 'PostgreSQL', extras: ['Apache Spark or dbt', 'Airflow'] };
  if (u.primaryIntent === 'ai_ml_project' || u.domain === 'ai/ml') return { frontend: 'React', backend: 'Python (FastAPI)', db: 'PostgreSQL + vector store', extras: ['scikit-learn / PyTorch'] };
  if (u.primaryIntent === 'security_project') return { frontend: 'React', backend: 'Node.js (Express)', db: 'MongoDB', extras: ['NVD API client'] };
  return { frontend: 'React', backend: 'Node.js (Express)', db: 'MongoDB or PostgreSQL', extras: [] };
}

function patentAngleFor(idea, understanding, evidence) {
  const research = evidence.filter((e) => e.sourceType === 'research_paper').slice(0, 5);
  return {
    problem: idea.problemStatement,
    existingLimitations: research.length
      ? `Adjacent research exists (${research.length} signal(s) found) — current approaches do not combine ${understanding.domain || 'this domain'} data with the specific workflow in this idea.`
      : 'No directly adjacent research surfaced this run; run a dedicated prior-art search before claiming novelty.',
    noveltyAngle: idea.noveltyAngle || 'Define a specific technical mechanism (not an abstract idea) — e.g. the data-combination, scoring or verification step — before pursuing IP.',
    priorArtSignals: research.map((r) => ({ title: r.title, url: r.url, source: r.source, publishedDate: r.publishedDate })),
    possibleClaimsOutline: [
      'A method of collecting and normalizing multi-source public signals for [problem]',
      'A deterministic scoring step producing an explainable [decision/risk] output',
      'A system combining [dataset] with [user context] to generate [the novel output]',
    ],
    riskAndLimitations: [
      'Early-stage research assistance only — NOT legal advice.',
      'Software/algorithm claims face subject-matter restrictions in many jurisdictions (e.g. India Section 3(k)).',
      'A formal prior-art search by a professional is required before filing.',
    ],
  };
}

function resumeValueFor(idea, understanding) {
  const role = understanding.targetRole || 'engineering roles';
  const skills = idea.skills || [];
  return {
    draftResumeBullets: [
      `Built ${idea.title}, integrating ${idea.dataSources[0] || 'public data APIs'} with deterministic scoring and explainable output.`,
      `Designed a multi-source data pipeline (collection → normalization → scoring) targeting ${role}.`,
      'Planned automated tests, CI and a deployed demo to make every claim verifiable.',
    ],
    atsKeywords: [...new Set([...skills, understanding.domain, 'REST APIs', 'data pipeline', 'caching', 'testing'].filter(Boolean))].slice(0, 12),
    interviewTalkingPoints: [
      'Why this problem is real: which public signals proved demand',
      'How the connector layer degrades gracefully when an API fails',
      'Why scoring is deterministic and how it stays explainable',
    ],
    linkedinPost: `Exploring a new build: ${idea.title}. Grounded in real public data, not assumptions — sharing progress soon. #buildinpublic`,
    recruiterProofSummary: `${idea.title} — evidence-backed project with verifiable public data sources, planned demo and test suite.`,
    note: 'Draft assets only. Verified resume claims and XP are granted exclusively through the existing project verification flow.',
  };
}

function skillXpFor(idea, understanding) {
  const base = (idea.skills || []).slice(0, 5);
  return {
    suggestedSkills: base.map((s) => ({ skill: s, suggestedXp: 20, status: 'suggested' })),
    note: 'Suggestions only — XP becomes verified solely via the existing project verification flow (GitHub analysis, live demo, tests).',
  };
}

/* ---- main entry ---- */
export async function runCareerIntelligence(input = {}) {
  const cfg = ciConfig();
  const {
    query = '', mode = 'auto', userContext = {}, selectedSources = [],
    maxSources, createAssets = true,
  } = input;

  const understanding = detectIntent(query, { mode });
  if (userContext?.targetRole && !understanding.targetRole) understanding.targetRole = sanitizeText(userContext.targetRole, 60);

  const routing = routeSources(understanding, { cfg, selectedSources, maxSources });

  const { evidence: liveEvidence, checked } = await gatherEvidence({ understanding, routing, cfg });

  /* Knowledge-base recall: reuse previously stored, verified public data. */
  const recalled = await recallKnowledge({ keywords: understanding.keywords, domain: understanding.domain, limit: 5 });
  const evidence = dedupeEvidence([...liveEvidence, ...recalled]).slice(0, 60);

  const painPoints = evidence.filter((e) => e.sourceType === 'community_pain_point')
    .sort((a, b) => (b.relevanceScore + b.trustScore / 4) - (a.relevanceScore + a.trustScore / 4)).slice(0, 8);
  const research = evidence.filter((e) => e.sourceType === 'research_paper').slice(0, 8);
  const datasets = evidence.filter((e) => e.sourceType === 'public_dataset' || e.sourceType === 'government_data').slice(0, 8);
  const marketSignals = evidence.filter((e) => e.sourceType === 'market_signal' || e.sourceType === 'local_business_signal').slice(0, 8);
  const skillSignals = evidence.filter((e) => e.sourceType === 'career_taxonomy' || e.sourceType === 'skill_taxonomy' || e.sourceType === 'tutorial_or_learning').slice(0, 8);

  /* Opportunity clusters: group evidence by overlapping keywords (cheap, deterministic). */
  const opportunityClusters = clusterEvidence(evidence).slice(0, 4);

  /* Ideas + scoring. */
  const candidates = ideaCandidates(understanding, evidence);
  const recommendedIdeas = candidates.map((idea) => {
    const supporting = evidence.filter((e) => idea.evidenceIds.includes(e.id));
    const scored = scoreIdea({ idea, evidence: supporting.length ? supporting : evidence, understanding });
    return { ...idea, scores: scored.scores, scoreReasons: scored.reasons, overallScore: scored.overall };
  }).sort((a, b) => b.overallScore - a.overallScore);

  const bestIdea = recommendedIdeas[0] || null;

  const projectBlueprint = createAssets && bestIdea ? blueprintFor(bestIdea, understanding, evidence) : null;
  const patentAngle = createAssets && bestIdea ? patentAngleFor(bestIdea, understanding, evidence) : null;
  const resumeValue = createAssets && bestIdea ? resumeValueFor(bestIdea, understanding) : null;
  const skillXpMapping = createAssets && bestIdea ? skillXpFor(bestIdea, understanding) : null;

  const limitations = [];
  if (!cfg.networkAllowed) limitations.push('Running in offline/test mode — live sources were not contacted.');
  for (const c of checked) if (c.skipped) limitations.push(`${c.source}: ${c.note}.`);
  const failed = checked.filter((c) => !c.ok && !c.skipped && c.source !== 'community');
  if (failed.length) limitations.push(`${failed.length} source(s) failed this run (partial results returned): ${failed.map((f) => f.source).join(', ')}.`);
  if (!evidence.length) limitations.push('No live evidence was gathered — the recommended idea is derived from your query alone.');
  limitations.push(CI_DISCLAIMER);

  /* Continuously improve the knowledge base: store high-quality verified
     public evidence + this report (privacy-filtered, never raw queries with
     personal identifiers). */
  const sanitizedQuery = stripIdentifiers(understanding.query);
  storeKnowledge({ evidence, intent: understanding.primaryIntent, domain: understanding.domain }); // fire-and-forget
  if (userContext?.userId || userContext?.email) {
    saveReport({
      userId: userContext.userId, email: userContext.email,
      query: sanitizedQuery, sanitizedQuery, intent: understanding.primaryIntent, mode,
      report: { bestIdea: bestIdea?.title || '', overallScore: bestIdea?.overallScore || 0, evidenceCount: evidence.length },
      sourcesChecked: checked,
    });
  }

  return {
    ok: true,
    queryUnderstanding: understanding,
    sourcesChecked: checked,
    evidence: evidence.slice(0, 30),
    painPoints,
    research,
    datasets,
    marketSignals,
    skillSignals,
    opportunityClusters,
    recommendedIdeas,
    bestIdea,
    projectBlueprint,
    patentAngle,
    resumeValue,
    skillXpMapping,
    workspacePlan: projectBlueprint ? { suggested: true, note: 'Use "Create Project Workspace" to generate a full guided workspace from this blueprint.' } : null,
    starterPackSuggestion: projectBlueprint ? { available: true, note: 'A starter pack ZIP can be generated after the workspace is created.' } : null,
    actions: bestIdea ? ['create_project', 'send_to_patent', 'resume_output', 'save_memory', 'starter_pack'] : [],
    limitations,
  };
}

function clusterEvidence(evidence = []) {
  const clusters = [];
  for (const e of evidence) {
    const kw = new Set(e.keywords || []);
    let placed = false;
    for (const c of clusters) {
      let overlap = 0;
      for (const k of kw) if (c.keywordSet.has(k)) overlap++;
      if (overlap >= 2) {
        c.items.push(e.id);
        c.sources.add(e.source);
        for (const k of kw) c.keywordSet.add(k);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ title: e.title, keywordSet: kw, items: [e.id], sources: new Set([e.source]) });
  }
  return clusters
    .filter((c) => c.items.length >= 2)
    .sort((a, b) => b.items.length - a.items.length)
    .map((c) => ({
      title: sanitizeText(c.title, 140),
      evidenceIds: c.items.slice(0, 8),
      evidenceCount: c.items.length,
      sources: [...c.sources],
      strength: Math.round(clamp(c.items.length * 18 + c.sources.size * 10, 0, 100)),
    }));
}

export default { runCareerIntelligence };
