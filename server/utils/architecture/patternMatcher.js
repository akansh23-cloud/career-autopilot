/* ============================================================
   PATTERN MATCHER  (deterministic)
   ------------------------------------------------------------
   Scores the project input against every pattern in the knowledge
   base using keyword/use-case/type signals and returns the best
   match plus ranked alternatives. Never throws on bad input;
   always falls back to 'three-tier-saas'.
   ============================================================ */
import { ARCHITECTURE_PATTERNS } from './knowledgeBase.js';

const lc = (s) => String(s || '').toLowerCase();

/* Flatten the project input into one searchable text blob + tech list. */
export function projectSignals(input = {}) {
  const techStack = Array.isArray(input.techStack)
    ? input.techStack.map(String)
    : String(input.techStack || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  const text = lc([
    input.title, input.description, input.problemStatement, input.projectType,
    input.targetRole, input.useCase, techStack.join(' '),
  ].filter(Boolean).join(' '));
  return {
    text,
    techStack,
    hasAI: /\bai\b|llm|rag|gpt|anthropic|openai|embedding|vector|ml\b|machine learning/.test(text),
    hasStream: /kafka|stream|kinesis|event-driven|cdc|spark|flink/.test(text),
    hasK8s: /kubernetes|k8s|helm|eks|gke|aks/.test(text),
    hasServerless: /serverless|lambda|faas|cloud functions/.test(text),
    hasPayments: /payment|stripe|razorpay|billing|checkout/.test(text),
    hasUploads: /upload|file|document|image|media|pdf|resume/.test(text),
    hasRealtime: /websocket|realtime|real-time|live/.test(text),
    hasAdmin: /admin|recruiter|college|moderat|dashboard/.test(text),
    cloud: /\baws\b/.test(text) ? 'aws' : /azure/.test(text) ? 'azure' : /\bgcp\b|google cloud/.test(text) ? 'gcp' : '',
  };
}

/* Score one pattern against the signals. Pure keyword/use-case scoring. */
function scorePattern(pattern, sig) {
  let score = 0;
  const why = [];
  for (const kw of pattern.keywords || []) {
    if (sig.text.includes(lc(kw))) { score += 3; why.push(`keyword "${kw}"`); }
  }
  for (const uc of pattern.useCases || []) {
    const tokens = lc(uc).split(/\s+/).filter((t) => t.length > 3);
    const hits = tokens.filter((t) => sig.text.includes(t)).length;
    if (tokens.length && hits / tokens.length >= 0.5) { score += 2; why.push(`use case "${uc}"`); }
  }
  // Category nudges from strong signals.
  if (pattern.category === 'ai' && sig.hasAI) score += 2;
  if (pattern.id === 'event-driven-pipeline' && sig.hasStream) score += 3;
  if (pattern.id === 'k8s-cloud-native' && sig.hasK8s) score += 3;
  if (pattern.id === 'serverless-api-platform' && sig.hasServerless) score += 3;
  if (pattern.id === 'marketplace-platform' && sig.hasPayments) score += 2;
  return { score, why: why.slice(0, 6) };
}

/* Match the best pattern. Returns { pattern, confidence, reasons, alternatives }. */
export function matchPattern(input = {}) {
  const sig = projectSignals(input);
  const ranked = ARCHITECTURE_PATTERNS
    .map((p) => ({ pattern: p, ...scorePattern(p, sig) }))
    .sort((a, b) => b.score - a.score);

  let best = ranked[0];
  if (!best || best.score <= 0) {
    const fallback = ARCHITECTURE_PATTERNS.find((p) => p.id === 'three-tier-saas') || ARCHITECTURE_PATTERNS[0];
    best = { pattern: fallback, score: 0, why: ['no strong signals — defaulted to the safest general-purpose pattern'] };
  }
  const second = ranked.find((r) => r.pattern.id !== best.pattern.id);
  const confidence = best.score >= 9 ? 'high' : best.score >= 4 ? 'medium' : 'low';

  return {
    pattern: best.pattern,
    patternId: best.pattern.id,
    confidence,
    score: best.score,
    reasons: best.why,
    alternatives: ranked.slice(0, 4).filter((r) => r.pattern.id !== best.pattern.id && r.score > 0)
      .map((r) => ({ id: r.pattern.id, name: r.pattern.name, score: r.score })),
    signals: sig,
    secondBest: second && second.score > 0 ? { id: second.pattern.id, name: second.pattern.name } : null,
  };
}

export default { matchPattern, projectSignals };
