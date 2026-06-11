/* ============================================================
   Career Intelligence Engine (collectiveIntelligence) — config
   ------------------------------------------------------------
   Single source of truth for env-driven behaviour of the
   collective knowledge search. Everything degrades safely when
   keys are missing; nothing here throws. No key ever leaves
   the server — status endpoints expose only booleans.
   ============================================================ */

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

/* In test mode all outbound network connectors are disabled by default so the
   suite is deterministic and offline-safe. Set INTELLIGENCE_TEST_ALLOW_NETWORK=1
   to opt back in (never done in CI). */
const networkAllowed = (env) => env.NODE_ENV !== 'test' || env.INTELLIGENCE_TEST_ALLOW_NETWORK === '1';

export const ciConfig = (env = process.env) => ({
  enabled: env.CAREER_INTELLIGENCE_ENABLED !== '0',
  networkAllowed: networkAllowed(env),

  fetchTimeoutMs: num(env.INTELLIGENCE_FETCH_TIMEOUT_MS, 8000),
  maxSourcesPerQuery: num(env.INTELLIGENCE_MAX_SOURCES_PER_QUERY, 8),
  cacheTtlMinutes: num(env.INTELLIGENCE_CACHE_TTL_MINUTES, 1440),
  maxResponseBytes: num(env.INTELLIGENCE_MAX_RESPONSE_BYTES, 2_000_000),

  /* ---- new public/free knowledge sources ----
     keyRequired   → connector cannot run at all without a key
     keyOptional   → key only raises rate limits / politeness     */
  sources: {
    wikipedia: { enabled: env.WIKIPEDIA_DISCOVERY_ENABLED !== '0', keyRequired: false, hasKey: true, quotaRisk: 'low' },
    crossref: { enabled: env.CROSSREF_DISCOVERY_ENABLED !== '0', keyRequired: false, hasKey: !!env.CROSSREF_MAILTO, mailto: env.CROSSREF_MAILTO || '', quotaRisk: 'low' },
    openalex: { enabled: env.OPENALEX_DISCOVERY_ENABLED !== '0', keyRequired: false, hasKey: !!env.OPENALEX_MAILTO, mailto: env.OPENALEX_MAILTO || '', quotaRisk: 'low' },
    datagov: { enabled: env.DATAGOV_DISCOVERY_ENABLED !== '0', keyRequired: false, hasKey: !!env.DATAGOV_API_KEY, apiKey: env.DATAGOV_API_KEY || '', quotaRisk: 'low' },
    census: { enabled: env.CENSUS_DISCOVERY_ENABLED === '1', keyRequired: false, hasKey: !!env.CENSUS_API_KEY, apiKey: env.CENSUS_API_KEY || '', quotaRisk: 'medium' },
    fda: { enabled: env.FDA_DISCOVERY_ENABLED !== '0', keyRequired: false, hasKey: !!env.FDA_API_KEY, apiKey: env.FDA_API_KEY || '', quotaRisk: 'low' },
    nasa: { enabled: env.NASA_DISCOVERY_ENABLED !== '0', keyRequired: false, hasKey: !!env.NASA_API_KEY, apiKey: env.NASA_API_KEY || '', quotaRisk: 'low' },
    onet: { enabled: env.ONET_DISCOVERY_ENABLED === '1', keyRequired: true, hasKey: !!(env.ONET_USERNAME && env.ONET_PASSWORD), username: env.ONET_USERNAME || '', password: env.ONET_PASSWORD || '', quotaRisk: 'medium' },
    esco: { enabled: env.ESCO_DISCOVERY_ENABLED !== '0', keyRequired: false, hasKey: true, quotaRisk: 'low' },
    nvd: { enabled: env.NVD_DISCOVERY_ENABLED !== '0', keyRequired: false, hasKey: !!env.NVD_API_KEY, apiKey: env.NVD_API_KEY || '', quotaRisk: 'medium' },
    worldbank: { enabled: env.WORLD_BANK_DISCOVERY_ENABLED !== '0', keyRequired: false, hasKey: true, quotaRisk: 'low' },
    openmeteo: { enabled: env.OPEN_METEO_DISCOVERY_ENABLED !== '0', keyRequired: false, hasKey: true, quotaRisk: 'low' },
    openstreetmap: { enabled: env.OPENSTREETMAP_DISCOVERY_ENABLED !== '0', keyRequired: false, hasKey: true, quotaRisk: 'medium' },
    /* Paid-quota APIs are OFF by default; they only run when explicitly
       enabled AND a key exists. */
    youtube: { enabled: env.YOUTUBE_DISCOVERY_ENABLED === '1', keyRequired: true, hasKey: !!env.YOUTUBE_API_KEY, apiKey: env.YOUTUBE_API_KEY || '', quotaRisk: 'high' },
    googlemaps: { enabled: env.GOOGLE_MAPS_DISCOVERY_ENABLED === '1', keyRequired: true, hasKey: !!env.GOOGLE_MAPS_API_KEY, apiKey: env.GOOGLE_MAPS_API_KEY || '', quotaRisk: 'high' },
  },
});

/* All new sources the engine can route to. Existing Innovation OS sources
   (reddit / hackernews / github / stackexchange / arxiv / devto / …) are reused
   through ingestSignals and are referenced here by their existing ids. */
export const NEW_SOURCES = ['wikipedia', 'crossref', 'openalex', 'datagov', 'census', 'fda', 'nasa', 'onet', 'esco', 'nvd', 'worldbank', 'openmeteo', 'openstreetmap', 'youtube', 'googlemaps'];
export const REUSED_SOURCES = ['github', 'stackexchange', 'arxiv', 'hackernews', 'reddit', 'devto', 'hashnode', 'discourse', 'specialized_forum', 'manual'];
export const ALL_CI_SOURCES = [...NEW_SOURCES, ...REUSED_SOURCES];

/* Returns true when a source may actually run (enabled + key satisfied +
   network allowed). Used by the router, the engine and the status endpoint. */
export function sourceRunnable(name, cfg = ciConfig()) {
  if (!cfg.networkAllowed) return false;
  if (REUSED_SOURCES.includes(name)) return name === 'manual' ? true : cfg.networkAllowed;
  const s = cfg.sources[name];
  if (!s || !s.enabled) return false;
  if (s.keyRequired && !s.hasKey) return false;
  return true;
}

export const CI_DISCLAIMER = 'Career Intelligence combines public, free data sources. Research/patent output is early-stage research assistance only — not legal advice. Scores are deterministic estimates, not guarantees.';

export default { ciConfig, sourceRunnable, NEW_SOURCES, REUSED_SOURCES, ALL_CI_SOURCES, CI_DISCLAIMER };
