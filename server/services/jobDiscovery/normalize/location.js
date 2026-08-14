/* ============================================================
   JOB DISCOVERY OS — LOCATION & REMOTE NORMALIZATION
   ------------------------------------------------------------
   HARD RULE (§18): remote eligibility is EVIDENCE-BASED.
   "Remote — US" NEVER becomes "Remote worldwide". When a posting
   scopes remote work to a country/region, the scope is preserved
   and a candidate outside that scope is not location-compatible.
   ============================================================ */

import { normalizeWhitespace } from './text.js';
import { WORKPLACE_TYPE, REMOTE_SCOPE, makeLocation } from '../schema.js';

/* Minimal, explicit country table. Deliberately not exhaustive: an unknown
   country string is kept raw with country=null rather than guessed. */
const COUNTRIES = [
  { code: 'IN', name: 'India', match: /\b(india|bharat|ind)\b/i },
  /* `strict` is tested against the ORIGINAL-CASE string. A bare uppercase "US"
     in a location or a restriction sentence is the country; a lowercase "us" is
     the pronoun, and matching it case-insensitively produced false "remote is
     US-only" classifications on ordinary prose. */
  { code: 'US', name: 'United States', match: /\b(usa|u\.s\.a\.|u\.s\.|united states|america|us only|us based|us-based)\b/i, strict: /\bUS\b/ },
  { code: 'GB', name: 'United Kingdom', match: /\b(uk|united kingdom|england|scotland|wales|britain)\b/i, strict: /\bUK\b/ },
  { code: 'CA', name: 'Canada', match: /\bcanada\b/i },
  { code: 'DE', name: 'Germany', match: /\b(germany|deutschland)\b/i },
  { code: 'FR', name: 'France', match: /\bfrance\b/i },
  { code: 'NL', name: 'Netherlands', match: /\b(netherlands|holland)\b/i },
  { code: 'ES', name: 'Spain', match: /\b(spain|españa)\b/i },
  { code: 'PL', name: 'Poland', match: /\bpoland\b/i },
  { code: 'IE', name: 'Ireland', match: /\bireland\b/i },
  { code: 'PT', name: 'Portugal', match: /\bportugal\b/i },
  { code: 'AU', name: 'Australia', match: /\baustralia\b/i },
  { code: 'NZ', name: 'New Zealand', match: /\bnew zealand\b/i },
  { code: 'SG', name: 'Singapore', match: /\bsingapore\b/i },
  { code: 'AE', name: 'United Arab Emirates', match: /\b(uae|united arab emirates|dubai|abu dhabi)\b/i },
  { code: 'JP', name: 'Japan', match: /\bjapan\b/i },
  { code: 'BR', name: 'Brazil', match: /\b(brazil|brasil)\b/i },
  { code: 'MX', name: 'Mexico', match: /\bmexico\b/i },
  { code: 'ZA', name: 'South Africa', match: /\bsouth africa\b/i },
  { code: 'PH', name: 'Philippines', match: /\bphilippines\b/i },
  { code: 'ID', name: 'Indonesia', match: /\bindonesia\b/i },
  { code: 'SE', name: 'Sweden', match: /\bsweden\b/i },
  { code: 'CH', name: 'Switzerland', match: /\bswitzerland\b/i },
  { code: 'IT', name: 'Italy', match: /\bitaly\b/i },
];

const INDIAN_CITIES = {
  pune: 'Maharashtra', mumbai: 'Maharashtra', nashik: 'Maharashtra', nagpur: 'Maharashtra',
  bengaluru: 'Karnataka', bangalore: 'Karnataka', mysore: 'Karnataka',
  hyderabad: 'Telangana', chennai: 'Tamil Nadu', coimbatore: 'Tamil Nadu',
  kolkata: 'West Bengal', ahmedabad: 'Gujarat', surat: 'Gujarat',
  jaipur: 'Rajasthan', indore: 'Madhya Pradesh', kochi: 'Kerala',
  trivandrum: 'Kerala', thiruvananthapuram: 'Kerala', chandigarh: 'Chandigarh',
  noida: 'Uttar Pradesh', 'greater noida': 'Uttar Pradesh', lucknow: 'Uttar Pradesh',
  gurgaon: 'Haryana', gurugram: 'Haryana', faridabad: 'Haryana',
  'new delhi': 'Delhi', delhi: 'Delhi', bhubaneswar: 'Odisha', dehradun: 'Uttarakhand',
};

const US_CITIES = {
  'new york': 'NY', 'san francisco': 'CA', 'los angeles': 'CA', 'san jose': 'CA',
  seattle: 'WA', austin: 'TX', dallas: 'TX', houston: 'TX', chicago: 'IL',
  boston: 'MA', denver: 'CO', atlanta: 'GA', miami: 'FL', 'washington': 'DC',
  portland: 'OR', phoenix: 'AZ', 'san diego': 'CA', philadelphia: 'PA',
};

const REGIONS = [
  { code: 'EMEA', name: 'EMEA', match: /\bemea\b/i, countries: null },
  { code: 'EU', name: 'European Union', match: /\b(eu|european union)\b/i, countries: ['DE', 'FR', 'NL', 'ES', 'PL', 'IE', 'PT', 'SE', 'IT'] },
  { code: 'EUROPE', name: 'Europe', match: /\beurope(an)?\b/i, countries: ['GB', 'DE', 'FR', 'NL', 'ES', 'PL', 'IE', 'PT', 'SE', 'CH', 'IT'] },
  { code: 'APAC', name: 'APAC', match: /\b(apac|asia[\s-]pacific)\b/i, countries: ['IN', 'SG', 'AU', 'NZ', 'JP', 'PH', 'ID'] },
  { code: 'LATAM', name: 'LATAM', match: /\b(latam|latin america)\b/i, countries: ['BR', 'MX'] },
  { code: 'NORTH_AMERICA', name: 'North America', match: /\bnorth america\b/i, countries: ['US', 'CA', 'MX'] },
  { code: 'AMERICAS', name: 'Americas', match: /\bamericas\b/i, countries: ['US', 'CA', 'MX', 'BR'] },
  { code: 'ANYWHERE', name: 'Worldwide', match: /\b(worldwide|anywhere|global|any location|globally)\b/i, countries: null },
];

const REMOTE_WORDS = /\b(remote|work from home|wfh|distributed|telecommut\w*|fully[\s-]remote|home[\s-]based)\b/i;
const HYBRID_WORDS = /\b(hybrid|part[\s-]remote|flexible[\s-]?(work|office)|\d\s*days?\s*(in|from)\s*(the\s*)?office)\b/i;
const ONSITE_WORDS = /\b(on[\s-]?site|onsite|in[\s-]?office|in[\s-]?person|office[\s-]based)\b/i;
const RESTRICTION_WORDS = /\b(only|based in|residents?|must (be|reside|live)|located in|eligible to work in|restricted to|within)\b/i;

export function detectCountry(text) {
  const s = String(text || '');
  for (const c of COUNTRIES) if (c.match.test(s)) return c;
  for (const c of COUNTRIES) if (c.strict && c.strict.test(s)) return c;
  return null;
}

export function detectRegion(text) {
  const s = String(text || '');
  for (const r of REGIONS) if (r.match.test(s)) return r;
  return null;
}

/** Parse one raw location string into a structured location. Never guesses. */
export function parseLocation(raw) {
  const value = normalizeWhitespace(raw || '');
  if (!value) return null;
  const loc = makeLocation({ raw: value });

  const country = detectCountry(value);
  if (country) { loc.country = country.name; loc.countryCode = country.code; }

  const lower = value.toLowerCase();
  for (const [city, region] of Object.entries(INDIAN_CITIES)) {
    if (new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) {
      loc.city = city.replace(/\b\w/g, (m) => m.toUpperCase());
      loc.region = region;
      if (!loc.countryCode) { loc.country = 'India'; loc.countryCode = 'IN'; }
      break;
    }
  }
  if (!loc.city) {
    for (const [city, state] of Object.entries(US_CITIES)) {
      if (new RegExp(`\\b${city}\\b`).test(lower)) {
        loc.city = city.replace(/\b\w/g, (m) => m.toUpperCase());
        loc.region = state;
        if (!loc.countryCode) { loc.country = 'United States'; loc.countryCode = 'US'; }
        break;
      }
    }
  }
  /* Comma form "City, ST" / "City, Country" — take the head as city when we
     have not already identified one and it is not a remote marker. */
  if (!loc.city) {
    const head = value.split(',')[0].trim();
    if (head && !REMOTE_WORDS.test(head) && !detectRegion(head) && head.length <= 40 && /[a-zA-Z]/.test(head)) {
      loc.city = head;
    }
  }
  return loc;
}

export function parseLocations(rawList) {
  const list = Array.isArray(rawList) ? rawList : [rawList];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const parsed = parseLocation(typeof item === 'string' ? item : (item?.raw ?? item?.name ?? ''));
    if (!parsed) continue;
    const key = `${parsed.city || ''}|${parsed.region || ''}|${parsed.countryCode || ''}|${parsed.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }
  return out;
}

/**
 * Classify workplace type + remote scope from EXPLICIT signals only.
 *
 * @param {object} input
 *   locationsRaw   array of raw location strings
 *   description    posting text (scanned for scope restrictions only)
 *   explicitRemote true/false/null from a structured field (schema.org
 *                  jobLocationType=TELECOMMUTE, ATS "remote" flag, ...)
 *   applicantRegions array of raw applicantLocationRequirements
 */
export function classifyWorkplace({
  locationsRaw = [], description = '', explicitRemote = null, applicantRegions = [], workplaceHint = null,
} = {}) {
  const locText = locationsRaw.filter(Boolean).join(' ; ');
  const hint = String(workplaceHint || '');
  const hay = `${locText} ; ${hint}`;
  const descHead = String(description || '').slice(0, 2500);

  const hasRemoteWord = REMOTE_WORDS.test(hay) || (explicitRemote === true);
  const hasHybridWord = HYBRID_WORDS.test(hay) || /hybrid/i.test(hint);
  const hasOnsiteWord = ONSITE_WORDS.test(hay);

  let type = WORKPLACE_TYPE.UNKNOWN;
  if (hasHybridWord) type = WORKPLACE_TYPE.HYBRID;
  else if (hasRemoteWord) type = WORKPLACE_TYPE.REMOTE;
  else if (hasOnsiteWord) type = WORKPLACE_TYPE.ONSITE;
  else if (explicitRemote === false && locationsRaw.length) type = WORKPLACE_TYPE.ONSITE;

  if (type !== WORKPLACE_TYPE.REMOTE) {
    const scope = type === WORKPLACE_TYPE.HYBRID ? REMOTE_SCOPE.HYBRID
      : type === WORKPLACE_TYPE.ONSITE ? REMOTE_SCOPE.ONSITE
        : REMOTE_SCOPE.UNKNOWN;
    return { type, remoteScope: scope, remoteRegions: [], evidence: hay ? hay.slice(0, 200) : null };
  }

  /* Remote — now determine the SCOPE. Scope evidence may come from the
     structured applicantLocationRequirements, the location string itself, or an
     explicit restriction sentence in the description. Absent evidence the scope
     is UNKNOWN, never WORLDWIDE. */
  const regionSources = [
    ...applicantRegions.filter(Boolean).map(String),
    locText,
  ];
  /* "This role is open to candidates located in the United States only." states
     the scope without repeating the word "remote" — requiring both terms in one
     sentence silently dropped the most common way scope is actually written. */
  const restrictionSentence = (descHead.split(/(?<=[.!?])\s+/) || [])
    .find((s) => RESTRICTION_WORDS.test(s) && (REMOTE_WORDS.test(s) || detectCountry(s) || detectRegion(s))) || '';
  if (restrictionSentence) regionSources.push(restrictionSentence);

  const codes = new Set();
  let worldwide = false;
  let regionCode = null;

  for (const src of regionSources) {
    const r = detectRegion(src);
    if (r) {
      if (r.code === 'ANYWHERE') worldwide = true;
      else { regionCode = regionCode || r.code; (r.countries || []).forEach((c) => codes.add(c)); }
    }
    const c = detectCountry(src);
    if (c) codes.add(c.code);
  }

  const explicitScopeText = [...applicantRegions.filter(Boolean).map(String), restrictionSentence].join(' ');
  const hasRestriction = codes.size > 0 && (
    applicantRegions.filter(Boolean).length > 0
    || RESTRICTION_WORDS.test(explicitScopeText)
    || /remote\s*[—–\-,(]/i.test(locText)
    || COUNTRY_IN_LOCATION.test(locText)
  );

  if (worldwide && !hasRestriction) {
    return {
      type: WORKPLACE_TYPE.REMOTE,
      remoteScope: REMOTE_SCOPE.REMOTE_WORLDWIDE,
      remoteRegions: ['ANYWHERE'],
      evidence: (regionSources.find((s) => detectRegion(s)?.code === 'ANYWHERE') || locText || '').slice(0, 200),
    };
  }
  if (codes.size === 1 && !regionCode) {
    const only = [...codes][0];
    return {
      type: WORKPLACE_TYPE.REMOTE,
      remoteScope: REMOTE_SCOPE.REMOTE_COUNTRY,
      remoteRegions: [only],
      evidence: (restrictionSentence || locText).slice(0, 200),
    };
  }
  if (codes.size > 1 || regionCode) {
    return {
      type: WORKPLACE_TYPE.REMOTE,
      remoteScope: REMOTE_SCOPE.REMOTE_REGION,
      remoteRegions: regionCode ? [regionCode, ...codes] : [...codes],
      evidence: (restrictionSentence || locText).slice(0, 200),
    };
  }
  /* Remote with no scope evidence at all. UNKNOWN scope — NOT worldwide. */
  return {
    type: WORKPLACE_TYPE.REMOTE,
    remoteScope: REMOTE_SCOPE.UNKNOWN,
    remoteRegions: [],
    evidence: (locText || hint || '').slice(0, 200) || null,
  };
}

const COUNTRY_IN_LOCATION = /remote[^a-z]{0,4}(india|usa|us|united states|uk|united kingdom|canada|germany|europe|emea|apac)/i;

/**
 * Is this job compatible with a candidate location query?
 * Returns { compatible, score 0..1, reason }.
 *
 * A REMOTE_COUNTRY:US job is NOT compatible with an India query — that is the
 * §57 acceptance case.
 */
export function locationCompatibility(job, query) {
  const q = normalizeWhitespace(query || '');
  if (!q) return { compatible: true, score: 0.5, reason: 'no location filter' };

  const qRemote = REMOTE_WORDS.test(q);
  const qCountry = detectCountry(q);
  const qRegion = detectRegion(q);
  const qLoc = parseLocation(q);
  const wp = job.workplace || {};
  const jobLocs = job.locations || [];

  const jobCountries = new Set(jobLocs.map((l) => l.countryCode).filter(Boolean));
  const jobCities = jobLocs.map((l) => String(l.city || '').toLowerCase()).filter(Boolean);
  const scoped = new Set((wp.remoteRegions || []).map(String));

  if (wp.type === 'REMOTE') {
    if (wp.remoteScope === REMOTE_SCOPE.REMOTE_WORLDWIDE) {
      return { compatible: true, score: 1, reason: 'remote worldwide' };
    }
    if (wp.remoteScope === REMOTE_SCOPE.UNKNOWN) {
      /* Remote with unstated scope. Not proven compatible, not proven
         incompatible — surfaced with a reduced score and an honest reason. */
      return { compatible: true, score: 0.45, reason: 'remote, scope not stated by source' };
    }
    if (qCountry && scoped.has(qCountry.code)) return { compatible: true, score: 1, reason: `remote open to ${qCountry.code}` };
    if (qRegion && scoped.has(qRegion.code)) return { compatible: true, score: 0.95, reason: `remote open to ${qRegion.code}` };
    if (qRegion && (qRegion.countries || []).some((c) => scoped.has(c))) {
      return { compatible: true, score: 0.8, reason: 'remote overlaps requested region' };
    }
    if (qCountry || qLoc?.countryCode) {
      const want = qCountry?.code || qLoc.countryCode;
      if (!scoped.has(want)) {
        return { compatible: false, score: 0, reason: `remote restricted to ${[...scoped].join(', ') || 'other regions'}` };
      }
    }
    if (qRemote && !qCountry && !qLoc?.city) return { compatible: true, score: 0.7, reason: 'remote role, generic remote query' };
    return { compatible: false, score: 0, reason: 'remote scope does not include requested location' };
  }

  /* Non-remote job. A "remote" query cannot match an onsite/hybrid posting. */
  if (qRemote && !qLoc?.city && !qCountry) {
    if (wp.type === 'HYBRID') return { compatible: false, score: 0, reason: 'hybrid role, remote requested' };
    return { compatible: false, score: 0, reason: 'onsite role, remote requested' };
  }

  if (qLoc?.city && jobCities.some((c) => c === String(qLoc.city).toLowerCase())) {
    return { compatible: true, score: 1, reason: `city match: ${qLoc.city}` };
  }
  if (qCountry && jobCountries.has(qCountry.code)) {
    return { compatible: true, score: qLoc?.city ? 0.6 : 0.9, reason: `country match: ${qCountry.code}` };
  }
  if (qLoc?.countryCode && jobCountries.has(qLoc.countryCode)) {
    return { compatible: true, score: 0.6, reason: `country match: ${qLoc.countryCode}` };
  }
  if (!jobLocs.length) return { compatible: true, score: 0.3, reason: 'job location unknown' };
  return { compatible: false, score: 0, reason: 'location mismatch' };
}

export default {
  parseLocation, parseLocations, classifyWorkplace, locationCompatibility,
  detectCountry, detectRegion,
};
