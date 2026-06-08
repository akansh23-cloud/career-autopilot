/* ============================================================
   Innovation & Patent Intelligence OS — configuration
   ------------------------------------------------------------
   Single source of truth for env-driven behaviour. Everything
   degrades safely when keys are missing; nothing here throws.
   ============================================================ */

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const piConfig = (env = process.env) => ({
  // Master switch. Default ON; set PROBLEM_INTELLIGENCE_ENABLED=0 to hide it.
  enabled: env.PROBLEM_INTELLIGENCE_ENABLED !== '0',

  // Source credentials (all optional — connectors fall back to public mode).
  githubToken: env.GITHUB_TOKEN || '',
  stackExchangeKey: env.STACKEXCHANGE_KEY || '',

  // AI provider selection.
  aiProvider: (env.AI_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : 'fallback')).toLowerCase(),
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  openaiKey: env.OPENAI_API_KEY || '',
  openaiBaseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  geminiKey: env.GEMINI_API_KEY || '',
  aiModel: env.AI_MODEL || '',

  // Discovery limits / safety rails.
  maxSignals: num(env.PROBLEM_DISCOVERY_MAX_SIGNALS, 30),
  timeoutMs: num(env.PROBLEM_DISCOVERY_TIMEOUT_MS, 12000),
  cacheTtlMs: num(env.PROBLEM_DISCOVERY_CACHE_TTL_MS, 3600000),
  maxResponseBytes: num(env.PROBLEM_DISCOVERY_MAX_RESPONSE_BYTES, 2_000_000),
});

/* Which AI provider can actually run given the configured keys. Returns
   'fallback' whenever the selected provider has no usable key, so the system
   never claims high confidence it cannot back up. */
export function resolveActiveProvider(cfg = piConfig()) {
  switch (cfg.aiProvider) {
    case 'anthropic': return cfg.anthropicKey ? 'anthropic' : 'fallback';
    case 'openai':    return cfg.openaiKey ? 'openai' : 'fallback';
    case 'gemini':    return cfg.geminiKey ? 'gemini' : 'fallback';
    case 'fallback':  return 'fallback';
    default:          return cfg.anthropicKey ? 'anthropic' : 'fallback';
  }
}

export const ALLOWED_SOURCES = ['github', 'stackexchange', 'arxiv', 'manual'];

export const INNOVATION_STATUSES = [
  'raw_idea', 'source_backed_problem', 'project_blueprint_ready', 'poc_planned',
  'poc_in_progress', 'prototype_ready', 'prior_art_review', 'disclosure_drafted',
  'faculty_review', 'ip_cell_review', 'patent_agent_review', 'filed', 'published',
  'granted', 'abandoned',
];

// Statuses a student must NOT be able to self-assign without verified proof.
export const PROOF_GATED_STATUSES = ['filed', 'published', 'granted'];

export const INNOVATION_DISCLAIMER =
  'This is not legal advice and not a final patent application. It is an invention ' +
  'disclosure draft for faculty / IP-cell / patent-agent review.';
