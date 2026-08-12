/* ============================================================
   WRITING PROVIDERS — Resume OS V4 optional AI layer
   ------------------------------------------------------------
   Interface: a provider takes { kind, text, facts, context } and
   returns candidate rewrites. Two implementations:

     DeterministicWritingProvider — MANDATORY default. Pure
       rule-based transforms (verb alternatives, filler removal,
       clause splitting, pattern re-orderings). Always available.

     AnthropicWritingProvider — OPTIONAL. Only constructed when
       ANTHROPIC_API_KEY exists. Improves WORDING ONLY.

   THE GATE: every AI candidate passes validateRewrite() before it
   is ever shown as usable. A rewrite is REJECTED (not warned) if it
     • introduces any number absent from the source text/facts
     • introduces any known skill/technology absent from the source
     • introduces employer-, title-, or certification-looking claims
     • drifts too far from the source vocabulary (new-content ratio)
   The deterministic engine remains authoritative: AI never writes
   into the document — it proposes; the user applies.
   ============================================================ */
import { verbAlternatives, eligiblePatterns } from './grammarLibrary.js';
import { compileBullet } from './bulletCompiler.js';
import { allKnownSkills, canonicalSkill } from './skillOntology.js';
import { skillPresent } from './skillMatcher.js';

import { assertNoAiInsideBoundary } from '../../services/resumeTailoring/aiBoundary.js';

export const WRITING_PROVIDERS_VERSION = 'writing-providers-v2-vocabulary';

/* ------------------------------------------------------------------ */
/* Truth gate                                                          */
/* ------------------------------------------------------------------ */
const NUM_RE = /\d[\d,.]*(?:\s*(?:%|percent|x|k|m|b|tb|gb|ms|s|hrs?|hours?|days?|weeks?|months?|years?))?/gi;
const norm = (s) => String(s || '').toLowerCase();
const numbersIn = (s) => new Set([...norm(s).matchAll(NUM_RE)].map((m) => m[0].replace(/[\s,]/g, '')));

export function validateRewrite(candidate, { sourceText = '', facts = null, allowedSkills = [] } = {}) {
  const reasons = [];
  const src = [sourceText, facts ? JSON.stringify(facts) : ''].join('\n');
  const cand = String(candidate || '');

  /* 1. no new numbers */
  const srcNums = numbersIn(src);
  for (const n of numbersIn(cand)) {
    if (!srcNums.has(n)) reasons.push(`introduces the number "${n}" which is not in the source facts`);
  }

  /* 2. no new known skills/technologies */
  const allowed = new Set([...allowedSkills.map(canonicalSkill)]);
  for (const skill of allKnownSkills()) {
    if (allowed.has(skill)) continue;
    if (skillPresent(cand, skill) && !skillPresent(src, skill)) {
      reasons.push(`introduces the technology "${skill}" which the source never mentions`);
    }
  }

  /* 3. no claim-shaped additions (certs / titles / employers heuristics) */
  const CLAIMY = /\b(certified|certification|promoted|awarded|patent(?:ed)?|led a team of|managed a team of)\b/i;
  if (CLAIMY.test(cand) && !CLAIMY.test(src)) {
    reasons.push('introduces an achievement/credential-shaped claim absent from the source');
  }

  /* 4. vocabulary drift — a rewrite should reuse the source's content words */
  const words = (s) => new Set(norm(s).match(/[a-z][a-z+#.-]{3,}/g) || []);
  const sw = words(src); const cw = words(cand);
  const STOP = new Set(['with', 'that', 'this', 'from', 'into', 'across', 'while', 'using', 'their', 'over', 'under', 'more', 'than', 'through', 'which', 'delivering', 'driving', 'enabling', 'improving', 'reducing', 'increasing', 'streamlining', 'leveraging', 'ensuring', 'within', 'where', 'when', 'about', 'against']);
  let novel = 0;
  for (const w of cw) if (!sw.has(w) && !STOP.has(w)) novel++;
  const ratio = cw.size ? novel / cw.size : 0;
  if (ratio > 0.5) reasons.push(`rewrite replaces too much of the source content (${Math.round(ratio * 100)}% new terms) to be verifiable as wording-only`);

  return { accepted: reasons.length === 0, reasons };
}

/* ------------------------------------------------------------------ */
/* Deterministic provider — always available                           */
/* ------------------------------------------------------------------ */
const FILLERS = [
  [/\bresponsible for (\w+ing)\b/gi, (m, v) => v[0].toUpperCase() + v.slice(1)],
  [/\bsuccessfully\s+/gi, ''],
  [/\bin order to\b/gi, 'to'],
  [/\bwas able to\s+/gi, ''],
  [/\bworked on\b/gi, 'built'],
  [/\bhelped to\s+/gi, ''],
  [/\bvarious\s+/gi, ''],
  [/\ba variety of\s+/gi, ''],
  [/\butilized\b/gi, 'used'],
  [/\bleveraged\b/gi, 'used'],
  [/\bmade use of\b/gi, 'used'],
  [/\bworked closely with\b/gi, 'collaborated with'],
  [/\bparticipated in the development of\b/gi, 'contributed to'],
  [/\btasked with\s+/gi, ''],
];

function concise(text) {
  let t = String(text || '').trim();
  for (const [re, rep] of FILLERS) t = t.replace(re, rep);
  return t.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

function leadVerbSwap(text) {
  const m = String(text).match(/^(\w+)(\b.*)$/s);
  if (!m) return [];
  const alts = verbAlternatives(m[1]);
  return alts.slice(0, 2).map((v) => `${v[0].toUpperCase()}${v.slice(1)}${m[2]}`);
}

/* Outcome-first inversion: "Did X, reducing Y by Z" → "Reduced Y by Z by doing X". */
function outcomeFirst(text) {
  const m = String(text).match(/^(.*?),\s*(reducing|cutting|improving|increasing|saving|boosting|lowering)\s+(.+?)\.?$/i);
  if (!m) return null;
  const verbMap = { reducing: 'Reduced', cutting: 'Cut', improving: 'Improved', increasing: 'Increased', saving: 'Saved', boosting: 'Boosted', lowering: 'Lowered' };
  const lead = verbMap[m[2].toLowerCase()];
  if (!lead) return null;
  const rest = m[1].replace(/^[A-Z]/, (c) => c.toLowerCase());
  return `${lead} ${m[3].replace(/\.$/, '')} by ${rest}.`;
}

export const DeterministicWritingProvider = {
  id: 'deterministic',
  label: 'Career Autopilot Resume Engine',
  available: () => true,
  async rewrite({ kind = 'bullet', text = '', facts = null }) {
    const out = [];
    const seen = new Set([String(text).trim()]);
    const push = (t, why) => {
      const v = String(t || '').trim();
      if (v && !seen.has(v)) { seen.add(v); out.push({ text: v, source: 'deterministic', rationale: why }); }
    };
    if (kind === 'concise' || kind === 'bullet' || kind === 'summary') push(concise(text), 'filler removed, active voice');
    if (kind === 'bullet' || kind === 'alternatives') {
      for (const t of leadVerbSwap(concise(text))) push(t, 'alternative lead verb from the same verb family');
      const of1 = outcomeFirst(concise(text));
      if (of1) push(of1, 'outcome-first inversion of the same facts');
      if (facts && eligiblePatterns(facts).length) {
        const c = compileBullet(facts);
        if (c.ok) push(c.text, 'recompiled from the confirmed source facts');
      }
    }
    return { provider: 'deterministic', candidates: out };
  },
};

/* ------------------------------------------------------------------ */
/* Anthropic provider — optional, wording only, gated                  */
/* ------------------------------------------------------------------ */
export function makeAnthropicWritingProvider({ apiKey, model, fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  return {
    id: 'anthropic',
    label: 'AI Assist (optional)',
    available: () => !!apiKey,
    async rewrite({ kind = 'bullet', text = '', facts = null, jdSkills = [] }) {
      /* P1.1 — hard deny inside the canonical tailoring transaction. */
      assertNoAiInsideBoundary('anthropic', 'writing.rewrite');
      if (!apiKey) return { provider: 'anthropic', candidates: [], unavailable: true };
      /* Token/cost control: ONLY the source text, approved facts, and target
         intent are sent — never the whole profile or conversation. */
      const sys = 'You improve the WORDING of one resume ' + (kind === 'summary' ? 'summary' : 'bullet') + '. ' +
        'You must NOT add, change, or invent any number, metric, technology, employer, title, certification, date, or achievement. ' +
        'Only rephrase what is given. Return ONLY a JSON array of 1-3 alternative wordings (plain strings), no prose.';
      const user = `SOURCE:\n"""${String(text).slice(0, 900)}"""\n` +
        (facts ? `CONFIRMED FACTS (the only permitted content): ${JSON.stringify(facts).slice(0, 900)}\n` : '') +
        (jdSkills.length ? `TARGET EMPHASIS (reorder emphasis only, add nothing new): ${jdSkills.slice(0, 8).join(', ')}\n` : '') +
        'Rewrite for concision and professional tone.';
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: 500, temperature: 0.4, system: sys, messages: [{ role: 'user', content: user }] }),
        });
        if (!r.ok) return { provider: 'anthropic', candidates: [], error: `provider_http_${r.status}` };
        const data = await r.json().catch(() => null);
        const raw = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        let arr = [];
        try { arr = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch { arr = []; }
        if (!Array.isArray(arr)) arr = [];
        return {
          provider: 'anthropic',
          candidates: arr.filter((t) => typeof t === 'string').slice(0, 3)
            .map((t) => ({ text: t.trim().slice(0, 600), source: 'ai', rationale: 'AI wording suggestion (truth-gated)' })),
        };
      } catch {
        /* AI failure NEVER blocks the workflow */
        return { provider: 'anthropic', candidates: [], error: 'provider_unreachable' };
      } finally { clearTimeout(timer); }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Orchestrator: deterministic always; AI only when opted in; every    */
/* AI candidate is truth-gated — rejected ones are NEVER usable.       */
/* ------------------------------------------------------------------ */
export async function assistRewrite({ kind, text, facts = null, jdSkills = [], allowedSkills = [], useAi = false, aiProvider = null }) {
  const det = await DeterministicWritingProvider.rewrite({ kind, text, facts });
  const result = {
    version: WRITING_PROVIDERS_VERSION,
    original: String(text || ''),
    deterministic: det.candidates,
    ai: [], aiRejected: 0, aiAvailable: !!(aiProvider && aiProvider.available()),
    aiError: null,
  };
  if (useAi && aiProvider && aiProvider.available()) {
    const out = await aiProvider.rewrite({ kind, text, facts, jdSkills });
    result.aiError = out.error || null;
    for (const c of out.candidates || []) {
      const gate = validateRewrite(c.text, { sourceText: text, facts, allowedSkills });
      if (gate.accepted) result.ai.push({ ...c, truth: gate });
      else result.aiRejected += 1;   // rejected candidates never reach the user as applyable
    }
  }
  return result;
}

export default { WRITING_PROVIDERS_VERSION, DeterministicWritingProvider, makeAnthropicWritingProvider, assistRewrite, validateRewrite };
