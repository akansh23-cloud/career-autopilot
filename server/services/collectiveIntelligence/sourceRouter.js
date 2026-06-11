/* ============================================================
   Career Intelligence — source router
   ------------------------------------------------------------
   Decides WHICH sources to query for a detected intent. Pure
   and deterministic. The router proposes a ranked plan; the
   engine then filters out sources that are disabled / missing
   keys / over the per-query cap. Users never pick APIs by hand
   unless they open "Advanced sources".
   ============================================================ */
import { ciConfig, sourceRunnable, ALL_CI_SOURCES } from './config.js';

/* Ranked source plans per intent. Order matters: when the per-query cap
   trims the list, the most valuable sources for that intent survive. */
const PLANS = {
  patent_research: ['crossref', 'openalex', 'arxiv', 'wikipedia', 'reddit', 'hackernews', 'github', 'datagov'],
  project_idea: ['hackernews', 'github', 'reddit', 'stackexchange', 'devto', 'wikipedia', 'datagov', 'arxiv'],
  dataset_project: ['datagov', 'fda', 'nasa', 'worldbank', 'openmeteo', 'wikipedia', 'github', 'hackernews'],
  career_roadmap: ['onet', 'esco', 'github', 'stackexchange', 'devto', 'wikipedia', 'hackernews'],
  learning_plan: ['esco', 'onet', 'devto', 'stackexchange', 'wikipedia', 'github', 'youtube'],
  security_project: ['nvd', 'github', 'stackexchange', 'hackernews', 'arxiv', 'wikipedia'],
  local_business: ['openstreetmap', 'worldbank', 'census', 'reddit', 'datagov', 'wikipedia', 'googlemaps'],
  healthcare_project: ['fda', 'crossref', 'openalex', 'wikipedia', 'datagov', 'reddit', 'arxiv'],
  ai_ml_project: ['arxiv', 'openalex', 'github', 'hackernews', 'crossref', 'wikipedia', 'datagov'],
  startup_idea: ['reddit', 'hackernews', 'worldbank', 'wikipedia', 'github', 'datagov', 'openstreetmap'],
  market_validation: ['reddit', 'hackernews', 'worldbank', 'wikipedia', 'datagov', 'census', 'openstreetmap'],
  resume_value: ['onet', 'esco', 'github', 'stackexchange', 'wikipedia', 'devto'],
};

/* Secondary intents append their top sources so combined queries
   ("healthcare AI project with patent potential") cover all angles. */
export function routeSources(understanding = {}, { cfg = ciConfig(), selectedSources = [], maxSources } = {}) {
  const cap = Math.max(1, Math.min(maxSources || cfg.maxSourcesPerQuery, 16));

  /* Advanced mode: user picked explicit sources — respect them, but still
     drop anything not runnable (disabled / key missing / test mode). */
  if (Array.isArray(selectedSources) && selectedSources.length) {
    const picked = selectedSources.filter((s) => ALL_CI_SOURCES.includes(s));
    return finalize(picked, cap, cfg, 'manual');
  }

  const plan = [...(PLANS[understanding.primaryIntent] || PLANS.project_idea)];
  for (const sec of understanding.secondaryIntents || []) {
    for (const s of (PLANS[sec] || []).slice(0, 3)) if (!plan.includes(s)) plan.push(s);
  }

  /* Domain nudges. */
  const domain = understanding.domain || '';
  if (domain === 'healthcare' && !plan.includes('fda')) plan.unshift('fda');
  if (domain === 'cybersecurity' && !plan.includes('nvd')) plan.unshift('nvd');
  if (domain === 'climate' && !plan.includes('openmeteo')) plan.splice(2, 0, 'openmeteo');
  if (domain === 'space' && !plan.includes('nasa')) plan.unshift('nasa');
  if (understanding.needs?.patent) for (const s of ['crossref', 'openalex', 'arxiv']) if (!plan.includes(s)) plan.splice(1, 0, s);

  return finalize(plan, cap, cfg, 'auto');
}

function finalize(plan, cap, cfg, mode) {
  const seen = new Set();
  const selected = [];
  const skipped = [];
  for (const s of plan) {
    if (seen.has(s)) continue;
    seen.add(s);
    if (!sourceRunnable(s, cfg)) { skipped.push({ source: s, reason: skipReason(s, cfg) }); continue; }
    if (selected.length < cap) selected.push(s);
    else skipped.push({ source: s, reason: 'over per-query source cap' });
  }
  return { mode, selected, skipped, cap };
}

function skipReason(name, cfg) {
  if (!cfg.networkAllowed) return 'network disabled (test mode)';
  const s = cfg.sources[name];
  if (s && !s.enabled) return 'disabled by configuration';
  if (s && s.keyRequired && !s.hasKey) return 'API key/credentials not configured';
  return 'unavailable';
}

export default { routeSources };
