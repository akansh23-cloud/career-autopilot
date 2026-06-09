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

  // ---- Community discussion intelligence (all OFF unless explicitly enabled) ----
  community: {
    enabled: env.COMMUNITY_DISCOVERY_ENABLED === '1',
    maxSignals: num(env.COMMUNITY_DISCOVERY_MAX_SIGNALS, 25),
    timeoutMs: num(env.COMMUNITY_DISCOVERY_TIMEOUT_MS, 12000),
    cacheTtlMs: num(env.COMMUNITY_DISCOVERY_CACHE_TTL_MS, 3600000),
    storeRawComments: env.COMMUNITY_STORE_RAW_COMMENTS === '1', // default false
    reddit: {
      enabled: env.REDDIT_DISCOVERY_ENABLED === '1',
      clientId: env.REDDIT_CLIENT_ID || '',
      clientSecret: env.REDDIT_CLIENT_SECRET || '',
      userAgent: env.REDDIT_USER_AGENT || 'CareerAutopilotInnovationOS/1.0',
    },
    // Hacker News uses a public API; may default ON but is still rate-limited + cached.
    hackernews: { enabled: env.HACKERNEWS_DISCOVERY_ENABLED !== '0' },
    discourse: {
      enabled: env.DISCOURSE_DISCOVERY_ENABLED === '1',
      allowedBaseUrls: csv(env.DISCOURSE_ALLOWED_BASE_URLS),
      apiKey: env.DISCOURSE_API_KEY || '',
      apiUsername: env.DISCOURSE_API_USERNAME || '',
    },
    devto: { enabled: env.DEVTO_DISCOVERY_ENABLED === '1', apiKey: env.DEVTO_API_KEY || '' },
    hashnode: { enabled: env.HASHNODE_DISCOVERY_ENABLED === '1', apiKey: env.HASHNODE_API_KEY || '' },
    specializedForum: {
      enabled: env.SPECIALIZED_FORUM_DISCOVERY_ENABLED === '1',
      allowedSources: csv(env.SPECIALIZED_FORUM_ALLOWED_SOURCES),
    },
  },

  // ---- Innovation memory / RAG ----
  memory: {
    enabled: env.INNOVATION_MEMORY_ENABLED !== '0', // default ON (keyword fallback works without keys)
    embeddingProvider: (env.EMBEDDING_PROVIDER || 'fallback').toLowerCase(),
    openaiEmbeddingModel: env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    vectorSearchEnabled: env.VECTOR_SEARCH_ENABLED === '1',
  },
});

const csv = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

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

// Community sources are treated as EARLY SIGNALS, never verified facts.
export const COMMUNITY_SOURCES = ['reddit', 'hackernews', 'discourse', 'devto', 'hashnode', 'specialized_forum'];

// The full set the discovery API accepts (core + github_discussions + community).
export const ALL_SOURCES = ['github', 'github_discussions', 'stackexchange', 'arxiv', 'manual', ...COMMUNITY_SOURCES];

// Sources that, on their OWN, must not push IP-readiness above a hard ceiling.
export const COMMUNITY_ONLY_IP_CAP = 55;

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
