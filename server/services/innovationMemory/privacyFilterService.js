/* ============================================================
   Service — privacy filter
   ------------------------------------------------------------
   Community discussions must be neutralized BEFORE storage or
   embedding: strip usernames, @handles, emails, urls-in-text,
   and convert to a generalized problem statement. We never store
   raw personal stories or expose who said what.
   ============================================================ */

const REDDIT_USER = /\b\/?u\/[A-Za-z0-9_-]{2,}/g;
const AT_HANDLE = /(^|[^A-Za-z0-9_@/])@[A-Za-z0-9_]{2,}/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE = /\b(\+?\d[\d\s-]{7,}\d)\b/g;

export function stripIdentifiers(text = '') {
  return String(text)
    .replace(EMAIL, '[email]')
    .replace(PHONE, '[number]')
    .replace(REDDIT_USER, '[user]')
    .replace(AT_HANDLE, '$1[user]')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* Turn a first-person complaint into a neutral, generalized problem statement. */
export function neutralize(text = '') {
  let t = stripIdentifiers(text);
  // Soften first-person framing into a generalized "users" framing.
  t = t.replace(/\bI'm\b/gi, 'users are').replace(/\bI am\b/gi, 'users are')
    .replace(/\bI've\b/gi, 'users have').replace(/\bI\b/g, 'users')
    .replace(/\bmy\b/gi, 'their').replace(/\bme\b/gi, 'them').replace(/\bwe\b/gi, 'teams');
  return t.replace(/\s{2,}/g, ' ').trim();
}

/* Apply privacy filtering to a community signal in place-safe manner.
   Returns a NEW signal object containing only safe-to-store fields. */
export function filterCommunitySignal(signal = {}, { storeRaw = false } = {}) {
  const safeSummary = neutralize(signal.contentSummary || signal.discussionSummary || signal.title || '').slice(0, 600);
  return {
    source: signal.source,
    sourceUrl: signal.sourceUrl || '',           // reference link only
    sourceId: signal.sourceId || '',
    sourceCommunity: sanitizeCommunityName(signal.sourceCommunity),
    title: stripIdentifiers(signal.title || '').slice(0, 240),
    contentSummary: safeSummary,
    discussionSummary: neutralize(signal.discussionSummary || '').slice(0, 600),
    tags: (signal.tags || []).slice(0, 12),
    engagement: signal.engagement || {},
    sourceCreatedAt: signal.sourceCreatedAt || null,
    lastActivityAt: signal.lastActivityAt || null,
    extractedPainPoints: (signal.extractedPainPoints || []).map((p) => neutralize(p).slice(0, 200)).slice(0, 6),
    extractedConstraints: (signal.extractedConstraints || []).map((p) => neutralize(p).slice(0, 200)).slice(0, 6),
    currentWorkarounds: (signal.currentWorkarounds || []).map((p) => neutralize(p).slice(0, 200)).slice(0, 6),
    requestedFeatures: (signal.requestedFeatures || []).map((p) => neutralize(p).slice(0, 200)).slice(0, 6),
    sentiment: signal.sentiment || 'neutral',
    signalType: signal.signalType || 'discussion',
    rawTextHash: signal.rawTextHash || '',
    // raw text is dropped unless explicitly approved by config (default: dropped)
    rawText: storeRaw ? String(signal.rawText || '').slice(0, 2000) : undefined,
  };
}

function sanitizeCommunityName(name = '') {
  // Drop community/subreddit names that look sensitive.
  const n = String(name).trim();
  if (/health|medical|mental|suicide|addiction|legal|relationship|divorce/i.test(n)) return '[redacted-community]';
  return n.slice(0, 80);
}

export default { stripIdentifiers, neutralize, filterCommunitySignal };
