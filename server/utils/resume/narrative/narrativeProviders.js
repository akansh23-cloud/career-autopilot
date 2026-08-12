/* ============================================================
   NARRATIVE AI PROVIDERS — task-routed, schema-validated
   ------------------------------------------------------------
   Design rules taken straight from the rest of Career Autopilot:

     • No AI in any verdict/scoring path. Scoring, validation and
       ranking are deterministic and backend-owned. AI only ever
       proposes CANDIDATE SENTENCES, which are then scored and can
       be rejected outright.
     • Task routing. Cheap deterministic logic does normalisation,
       extraction, similarity and repetition. A small model does
       classification. The expensive model is used only for final
       narrative synthesis and hard reranking.
     • Structured output only. Every AI response is parsed against a
       Zod schema, sanitised, then checked against the evidence graph
       before it can touch a ResumeDocument. Malformed → discarded.
     • Everything degrades. No key, no network, bad JSON, timeout,
       rate limit → deterministic composition still produces a full
       resume.

   TASK CAPABILITIES
     classify        cheap model  — intent / seniority tagging
     extract         cheap model  — structured facts from text
     generate        strong model — candidate sentence synthesis
     rerank          strong model — tie-break between close candidates
     summarize       strong model — professional summary synthesis
   ============================================================ */
import crypto from 'node:crypto';
import { z } from 'zod';

import { assertNoAiInsideBoundary } from '../../../services/resumeTailoring/aiBoundary.js';

export const NARRATIVE_PROVIDERS_VERSION = 'narrative-providers-v1';

/* ------------------------------------------------------------------ */
/* Schemas — the contract every AI response must satisfy               */
/* ------------------------------------------------------------------ */
export const BulletCandidatesSchema = z.object({
  candidates: z.array(z.object({
    text: z.string().min(8).max(400),
    strategy: z.string().max(40).optional().default('ai'),
  })).min(1).max(8),
});

export const SummaryCandidatesSchema = z.object({
  candidates: z.array(z.object({
    text: z.string().min(20).max(700),
  })).min(1).max(4),
});

export const ClassificationSchema = z.object({
  intent: z.string().max(40),
  confidence: z.number().min(0).max(1).optional().default(0.6),
});

export const RerankSchema = z.object({
  order: z.array(z.number().int().min(0).max(19)).min(1).max(20),
  reason: z.string().max(300).optional().default(''),
});

/* ------------------------------------------------------------------ */
/* Cost + usage accounting                                             */
/* ------------------------------------------------------------------ */
export class UsageLedger {
  constructor() { this.reset(); }

  reset() {
    this.calls = [];
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cacheHits = 0;
    this.errors = 0;
  }

  record({ task, provider, model, inputTokens = 0, outputTokens = 0, ms = 0, ok = true, cached = false, error = '' }) {
    this.calls.push({ task, provider, model, inputTokens, outputTokens, ms, ok, cached, error });
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    if (cached) this.cacheHits += 1;
    if (!ok) this.errors += 1;
  }

  snapshot() {
    const byTask = {};
    for (const c of this.calls) {
      const t = (byTask[c.task] = byTask[c.task] || { calls: 0, inputTokens: 0, outputTokens: 0, ms: 0, errors: 0, cacheHits: 0 });
      t.calls += 1; t.inputTokens += c.inputTokens; t.outputTokens += c.outputTokens;
      t.ms += c.ms; if (!c.ok) t.errors += 1; if (c.cached) t.cacheHits += 1;
    }
    return {
      totalCalls: this.calls.length,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheHits: this.cacheHits,
      errors: this.errors,
      byTask,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Response cache — identical prompts within a run cost nothing twice  */
/* ------------------------------------------------------------------ */
const _cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 400;

function cacheKey(parts) {
  return crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex');
}
function cacheGet(k) {
  const hit = _cache.get(k);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { _cache.delete(k); return null; }
  return hit.value;
}
function cacheSet(k, value) {
  if (_cache.size >= CACHE_MAX) {
    const oldest = [..._cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) _cache.delete(oldest[0]);
  }
  _cache.set(k, { at: Date.now(), value });
  return value;
}
export function clearNarrativeCache() { _cache.clear(); }

/* ------------------------------------------------------------------ */
/* Model routing                                                       */
/* ------------------------------------------------------------------ */
export const TASK_TIERS = Object.freeze({
  classify: 'small',
  extract: 'small',
  generate: 'strong',
  rerank: 'strong',
  summarize: 'strong',
});

export function resolveModels(env = process.env) {
  const strong = env.RESUME_NARRATIVE_MODEL || env.AI_MODEL || env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
  const small = env.RESUME_NARRATIVE_SMALL_MODEL || 'claude-haiku-4-5-20251001';
  return { strong, small };
}

/* ------------------------------------------------------------------ */
/* Anthropic client — thin; JSON shaping happens in the router          */
/* ------------------------------------------------------------------ */
export function makeAnthropicNarrativeClient({
  apiKey = '', models = null, fetchImpl = null, timeoutMs = 20000,
} = {}) {
  const m = models || resolveModels();
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  return {
    id: 'anthropic',
    available: () => !!apiKey,
    models: m,
    async complete({ tier = 'strong', system, user, maxTokens = 900, temperature = 0.5 }) {
      /* P1.1 — hard deny inside the canonical tailoring transaction. */
      assertNoAiInsideBoundary('anthropic', 'narrative.complete');
      if (!apiKey) return { ok: false, error: 'no_api_key' };
      const model = tier === 'small' ? m.small : m.strong;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const started = Date.now();
      try {
        const r = await doFetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: user }] }),
        });
        if (!r.ok) return { ok: false, error: `http_${r.status}`, model, ms: Date.now() - started };
        const data = await r.json().catch(() => null);
        if (!data) return { ok: false, error: 'bad_json', model, ms: Date.now() - started };
        const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        return {
          ok: true, text, model, ms: Date.now() - started,
          inputTokens: data.usage?.input_tokens || 0,
          outputTokens: data.usage?.output_tokens || 0,
        };
      } catch (err) {
        return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : 'unreachable', model, ms: Date.now() - started };
      } finally { clearTimeout(timer); }
    },
  };
}

/** Strip fences and parse. Never throws. */
export function parseStrictJSON(raw) {
  const text = String(raw || '').replace(/```json|```/g, '').trim();
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const candidate = text.slice(start);
  try { return JSON.parse(candidate); } catch { /* try trailing repair */ }
  /* One conservative repair: trim to the last balanced brace. */
  for (let i = candidate.length; i > 0; i -= 1) {
    const ch = candidate[i - 1];
    if (ch !== '}' && ch !== ']') continue;
    try { return JSON.parse(candidate.slice(0, i)); } catch { /* keep shrinking */ }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The router                                                          */
/* ------------------------------------------------------------------ */
export function makeNarrativeRouter({ client = null, ledger = null, enabled = true } = {}) {
  const usage = ledger || new UsageLedger();
  const available = () => !!(enabled && client && client.available());

  async function run(task, { system, user, schema, maxTokens = 900, temperature = 0.5 }) {
    if (!available()) return { ok: false, reason: 'ai_unavailable', data: null };
    const tier = TASK_TIERS[task] || 'strong';
    const key = cacheKey([task, tier, system, user, String(maxTokens)]);
    const cached = cacheGet(key);
    if (cached) {
      usage.record({ task, provider: client.id, model: tier, cached: true, ok: true });
      return { ...cached, cached: true };
    }
    const out = await client.complete({ tier, system, user, maxTokens, temperature });
    if (!out.ok) {
      usage.record({ task, provider: client.id, model: out.model || tier, ok: false, ms: out.ms || 0, error: out.error });
      return { ok: false, reason: out.error, data: null };
    }
    const parsed = parseStrictJSON(out.text);
    if (!parsed) {
      usage.record({ task, provider: client.id, model: out.model, ok: false, ms: out.ms, inputTokens: out.inputTokens, outputTokens: out.outputTokens, error: 'unparseable' });
      return { ok: false, reason: 'malformed_response', data: null };
    }
    const check = schema.safeParse(parsed);
    if (!check.success) {
      usage.record({ task, provider: client.id, model: out.model, ok: false, ms: out.ms, inputTokens: out.inputTokens, outputTokens: out.outputTokens, error: 'schema_violation' });
      return { ok: false, reason: 'schema_violation', data: null, issues: check.error.issues.slice(0, 3).map((i) => i.message) };
    }
    usage.record({ task, provider: client.id, model: out.model, ok: true, ms: out.ms, inputTokens: out.inputTokens, outputTokens: out.outputTokens });
    return cacheSet(key, { ok: true, data: check.data, model: out.model, ms: out.ms });
  }

  return {
    version: NARRATIVE_PROVIDERS_VERSION,
    available,
    usage,

    /**
     * Candidate sentences for ONE evidence unit.
     * The prompt is deliberately narrow: it receives the parsed evidence
     * fields, the permitted technology list, the permitted number list and
     * the target vocabulary — nothing else. It cannot see other bullets,
     * other users, or the JD's full text.
     */
    async generateBulletCandidates({
      evidence, vocabulary, intent, seniority, targetTerms = [], count = 4, voice = null,
    }) {
      const permittedNumbers = (evidence.numericEvidence || []).map((n) => n.raw);
      const system = [
        'You rewrite ONE resume bullet for a specific professional context.',
        'ABSOLUTE RULES:',
        '1. You may ONLY use facts present in the EVIDENCE block. Do not add technologies, metrics, team sizes, percentages, durations, scopes, titles, or outcomes.',
        `2. The ONLY numbers you may use are: ${permittedNumbers.length ? permittedNumbers.join(', ') : 'NONE — use no digits at all'}.`,
        `3. The ONLY technologies you may name are: ${(evidence.skillsDisplay || []).join(', ') || 'NONE'}.`,
        '4. Do not claim leadership, ownership or architecture authority beyond what the evidence verb already states.',
        '5. Write like a practitioner, not a marketer. No "leveraged", "spearheaded", "cutting-edge", "robust", "seamless", "results-driven".',
        '6. Vary sentence structure across candidates — do not produce the same shape N times.',
        'Return ONLY minified JSON: {"candidates":[{"text":"...","strategy":"..."}]}',
      ].join('\n');

      const user = [
        `EVIDENCE:`,
        `  original: ${evidence.rawText}`,
        `  action: ${evidence.action || '(none)'}`,
        `  object: ${evidence.object || '(none)'}`,
        `  method: ${evidence.method || '(none)'}`,
        `  scope: ${evidence.scope || '(none)'}`,
        `  outcome: ${evidence.outcome || '(none)'}`,
        `  technologies: ${(evidence.skillsDisplay || []).join(', ') || '(none)'}`,
        `  numbers: ${permittedNumbers.join(', ') || '(none)'}`,
        `  tense: ${evidence.tense || 'past'}`,
        ``,
        `CONTEXT:`,
        `  field: ${vocabulary.label}`,
        `  seniority: ${seniority}`,
        `  this bullet should communicate: ${intent}`,
        `  natural domain phrasing to prefer where it already fits the facts: ${(vocabulary.collocations || []).slice(0, 12).map((c) => c[1]).join('; ')}`,
        targetTerms.length ? `  target-role terminology to prefer when equivalent: ${targetTerms.slice(0, 8).join(', ')}` : '',
        voice ? `  match this writing style: ~${voice.avgWords} words, ${voice.clauseStyle}-clause, ${voice.registerBias} register` : '',
        ``,
        `Produce ${count} DIFFERENT candidate sentences. Each must be independently defensible against the evidence.`,
      ].filter(Boolean).join('\n');

      return run('generate', { system, user, schema: BulletCandidatesSchema, maxTokens: 700, temperature: 0.7 });
    },

    async generateSummaryCandidates({ facts, vocabulary, seniority, targetRole, targetTerms = [], maxChars = 420 }) {
      const system = [
        'You write ONE professional resume summary from confirmed facts.',
        'ABSOLUTE RULES:',
        '1. Use ONLY the facts given. No invented metrics, employers, titles, years, or technologies.',
        '2. No self-description clichés: never "results-driven", "proven track record", "highly motivated", "passionate", "dynamic professional".',
        '3. Be concrete: name what the person actually works on and with.',
        `4. Maximum ${maxChars} characters. 2-3 sentences. No first person.`,
        'Return ONLY minified JSON: {"candidates":[{"text":"..."}]}',
      ].join('\n');
      const user = [
        `CONFIRMED FACTS: ${JSON.stringify(facts).slice(0, 1400)}`,
        `FIELD: ${vocabulary.label}`,
        `SENIORITY: ${seniority}`,
        targetRole ? `TARGET ROLE: ${targetRole}` : '',
        targetTerms.length ? `PREFER THESE TERMS WHERE THEY ALREADY FIT THE FACTS: ${targetTerms.slice(0, 8).join(', ')}` : '',
        'Produce 2 different summaries.',
      ].filter(Boolean).join('\n');
      return run('summarize', { system, user, schema: SummaryCandidatesSchema, maxTokens: 500, temperature: 0.6 });
    },

    async classifyIntent({ text, options }) {
      const system = `Classify what a resume bullet primarily communicates. Choose exactly one of: ${options.join(', ')}. Return ONLY minified JSON: {"intent":"...","confidence":0.0}`;
      return run('classify', { system, user: String(text).slice(0, 400), schema: ClassificationSchema, maxTokens: 80, temperature: 0 });
    },

    async rerankCandidates({ candidates, intent, targetRole }) {
      const system = 'You order resume bullet candidates from best to worst for a target role. Judge specificity, credibility and natural professional tone. Return ONLY minified JSON: {"order":[indices],"reason":"..."}';
      const user = [
        targetRole ? `TARGET ROLE: ${targetRole}` : '',
        `THIS BULLET SHOULD COMMUNICATE: ${intent}`,
        ...candidates.slice(0, 8).map((c, i) => `[${i}] ${c.text}`),
      ].filter(Boolean).join('\n');
      return run('rerank', { system, user, schema: RerankSchema, maxTokens: 200, temperature: 0 });
    },
  };
}

/** Convenience factory used by routes. Returns a router that is *always* safe. */
export function createNarrativeRouter({ env = process.env, fetchImpl = null, ledger = null, forceDisable = false } = {}) {
  const apiKey = env.ANTHROPIC_API_KEY || '';
  const enabled = !forceDisable && env.RESUME_NARRATIVE_AI !== '0' && !!apiKey;
  const client = apiKey ? makeAnthropicNarrativeClient({ apiKey, models: resolveModels(env), fetchImpl }) : null;
  return makeNarrativeRouter({ client, ledger, enabled });
}

export default {
  NARRATIVE_PROVIDERS_VERSION, makeNarrativeRouter, createNarrativeRouter,
  makeAnthropicNarrativeClient, resolveModels, parseStrictJSON, UsageLedger,
  BulletCandidatesSchema, SummaryCandidatesSchema, ClassificationSchema, RerankSchema,
  clearNarrativeCache, TASK_TIERS,
};
