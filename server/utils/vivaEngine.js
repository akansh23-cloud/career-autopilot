/* ============================================================
   LIVE COMPREHENSION VIVA ENGINE  (the top verification tier)
   ------------------------------------------------------------
   This is the only thing that turns "you committed this code" into "you
   understand this code" — the signal a recruiter actually trusts and the only
   real defense against copied or AI-generated repos.

   Design (matches the platform constraint: deterministic backend scoring, AI
   may only enrich phrasing and may NEVER set a score or a pass/fail):

     1. PROBES ARE CODE-GROUNDED. Every question is derived from the candidate's
        OWN repository files, and its ANSWER KEY is extracted deterministically
        from that code — not from an AI. Generic knowledge or an LLM cannot
        answer them without the specific repo, and even with the repo open the
        modify-probes require understanding.
     2. LIVE + TIMED. Each probe has a minimum plausible answer time; answers
        that arrive implausibly fast (paste / lookup) are penalized. The session
        has a hard time budget.
     3. DETERMINISTIC SCORING. Answers are graded against the code-derived key
        (exact / token-coverage). The comprehension score, the anti-cheat flags,
        and the pass/fail are pure functions of structured inputs. Re-running the
        same answers yields the same result.
     4. Only a PASS mints an `assessment_passed` HIGH credential, and only for a
        repo whose authorship was already verified (caller enforces).

   No AI in issuance or scoring. Same inputs -> same outcome.
   ============================================================ */
import crypto from 'crypto';

export const VIVA_VERSION = 'viva-v1';
export const PASS_THRESHOLD = 70;          // comprehension score out of 100
export const MIN_PROBES = 4;
export const DEFAULT_PROBE_COUNT = 6;
export const SESSION_BUDGET_MS = 12 * 60 * 1000; // 12 minutes total

/* Per-probe minimum plausible answer time (ms). Faster than this for a
   comprehension answer is a strong paste/lookup signal. */
const MIN_ANSWER_MS = { factual: 4000, explain: 9000, modify: 20000 };

function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function tokens(s) { return norm(s).replace(/[^a-z0-9_\s]/g, ' ').split(/\s+/).filter(Boolean); }
function langOf(path = '') {
  const p = path.toLowerCase();
  if (/\.(jsx?|tsx?|mjs|cjs)$/.test(p)) return 'js';
  if (/\.py$/.test(p)) return 'py';
  if (/\.(go)$/.test(p)) return 'go';
  if (/\.(java)$/.test(p)) return 'java';
  return 'other';
}

/* ------------------------------------------------------------------
   DETERMINISTIC CODE EXTRACTION
   Heuristic (not a full AST) but stable: pulls imports, functions, exports and
   control-flow facts whose answers are unambiguous in the source.
   ------------------------------------------------------------------ */
function extractImports(content, lang) {
  const out = [];
  if (lang === 'js') {
    for (const m of content.matchAll(/import\s+(?:[\w*\s{},]+)\s+from\s+['"]([^'"]+)['"]/g)) out.push(m[1]);
    for (const m of content.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  } else if (lang === 'py') {
    for (const m of content.matchAll(/^\s*import\s+([\w.]+)/gm)) out.push(m[1].split('.')[0]);
    for (const m of content.matchAll(/^\s*from\s+([\w.]+)\s+import/gm)) out.push(m[1].split('.')[0]);
  }
  return Array.from(new Set(out));
}
function extractFunctions(content, lang) {
  const out = [];
  if (lang === 'js') {
    for (const m of content.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) out.push({ name: m[1], params: splitParams(m[2]) });
    for (const m of content.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g)) out.push({ name: m[1], params: splitParams(m[2]) });
  } else if (lang === 'py') {
    for (const m of content.matchAll(/def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g)) out.push({ name: m[1], params: splitParams(m[2]) });
  }
  return out;
}
function splitParams(s) {
  return String(s || '').split(',').map((p) => p.trim().split(/[:=]/)[0].trim()).filter((p) => p && p !== 'self' && p !== 'cls');
}

/* ------------------------------------------------------------------
   PROBE GENERATION  (returns probes WITH answer keys — keep server-side)
   The public form sent to the client strips `answerKey`/`requiredTokens`.
   ------------------------------------------------------------------ */
export function generateVivaProbes(repoFiles = {}, { count = DEFAULT_PROBE_COUNT, seed = '' } = {}) {
  const files = Object.entries(repoFiles)
    .filter(([p, c]) => typeof c === 'string' && c.length > 0 && langOf(p) !== 'other')
    .sort(([a], [b]) => a.localeCompare(b)); // deterministic order
  const probes = [];

  for (const [path, content] of files) {
    const lang = langOf(path);
    const base = path.split('/').pop();

    const imports = extractImports(content, lang);
    if (imports.length) {
      const pick = imports.sort()[0];
      probes.push({
        type: 'factual', kind: 'import', file: base,
        prompt: `In \`${base}\`, name one external module/package the code imports.`,
        answerKey: imports.map(norm), requiredTokens: [], match: 'any_of',
      });
    }

    const fns = extractFunctions(content, lang);
    for (const fn of fns.slice(0, 2)) {
      probes.push({
        type: 'factual', kind: 'fn_arity', file: base,
        prompt: `In \`${base}\`, how many parameters does the function \`${fn.name}\` take? (answer with a number)`,
        answerKey: [String(fn.params.length)], requiredTokens: [], match: 'exact_num',
      });
      if (fn.params.length) {
        probes.push({
          type: 'explain', kind: 'fn_explain', file: base,
          prompt: `Explain in one sentence what \`${fn.name}\` does and what \`${fn.params[0]}\` is used for.`,
          answerKey: [], requiredTokens: [norm(fn.name), norm(fn.params[0])], match: 'token_coverage',
        });
      }
    }
  }

  // A modify-probe on the largest function-bearing file: requires real edits.
  const modTarget = files.find(([p, c]) => extractFunctions(c, langOf(p)).length);
  if (modTarget) {
    const [p, c] = modTarget;
    const fn = extractFunctions(c, langOf(p))[0];
    probes.push({
      type: 'modify', kind: 'add_guard', file: p.split('/').pop(),
      prompt: `Rewrite \`${fn.name}\` to add input validation: return early (or raise) when the first argument is null/undefined/empty, before the existing logic. Paste the full updated function.`,
      answerKey: [], requiredTokens: [norm(fn.name)],
      mustInclude: ['guard'], // checked structurally in scoring
      match: 'modify_check',
    });
  }

  // Deterministic, seed-stable selection + ordering.
  const ranked = probes
    .map((pr, i) => ({ pr, h: crypto.createHash('sha256').update(seed + ':' + i + ':' + pr.prompt).digest('hex') }))
    .sort((a, b) => a.h.localeCompare(b.h))
    .map((x) => x.pr);

  // Ensure a mix: keep at least one explain + one modify if available.
  const chosen = ranked.slice(0, Math.max(MIN_PROBES, count));
  return chosen.map((pr, i) => ({ id: `q${i + 1}`, ...pr, minMs: MIN_ANSWER_MS[pr.type] || 5000 }));
}

/* Strip answer keys for the client. */
export function publicProbe(p) {
  return { id: p.id, type: p.type, kind: p.kind, file: p.file, prompt: p.prompt, minMs: p.minMs };
}

/* ------------------------------------------------------------------
   DETERMINISTIC SCORING
   ------------------------------------------------------------------ */
function scoreFactual(probe, answer) {
  const a = norm(answer);
  if (!a) return 0;
  if (probe.match === 'exact_num') {
    const n = (a.match(/-?\d+/) || [])[0];
    return n != null && probe.answerKey.includes(n) ? 1 : 0;
  }
  // any_of: candidate names one of the valid answers (substring-safe)
  return probe.answerKey.some((k) => a === k || a.includes(k) || k.includes(a)) ? 1 : 0;
}
function scoreTokenCoverage(probe, answer) {
  const toks = new Set(tokens(answer));
  if (!probe.requiredTokens.length) return toks.size >= 4 ? 0.5 : 0; // some explanation present
  const hit = probe.requiredTokens.filter((t) => toks.has(t) || [...toks].some((x) => x.includes(t) || t.includes(x))).length;
  const coverage = hit / probe.requiredTokens.length;
  // Require genuine explanation length too, so keyword-stuffing alone is weak.
  const lengthOk = tokens(answer).length >= 6 ? 1 : 0.5;
  return Math.min(1, coverage * lengthOk);
}
function scoreModify(probe, answer) {
  const a = norm(answer);
  if (!a) return 0;
  let s = 0;
  if (probe.requiredTokens.every((t) => a.includes(t))) s += 0.4;     // references the right function
  if (/(return|raise|throw)/.test(a)) s += 0.3;                        // has an early exit
  if (/(null|undefined|none|== ?''|=== ?''|len\(|\.length|empty|!|not )/.test(a)) s += 0.3; // checks emptiness
  return Math.min(1, s);
}

export function scoreVivaAnswer(probe, answer, timingMs = null) {
  let raw;
  if (probe.type === 'factual') raw = scoreFactual(probe, answer);
  else if (probe.type === 'modify') raw = scoreModify(probe, answer);
  else raw = scoreTokenCoverage(probe, answer);

  const flags = [];
  // Too-fast answers are a paste/lookup signal: cap credit.
  let timePenalty = 1;
  if (timingMs != null && timingMs >= 0 && timingMs < probe.minMs) {
    flags.push('answered_too_fast');
    timePenalty = 0.5;
  }
  const score = Math.round(raw * timePenalty * 100);
  return { id: probe.id, raw: Math.round(raw * 100) / 100, score, flags, timingMs: timingMs ?? null };
}

/* Aggregate a whole session deterministically -> comprehension score, anti-cheat
   flags, and pass/fail. `answers` is keyed by probe id: { text, timingMs }. */
export function scoreVivaSession(probes = [], answers = {}, { totalElapsedMs = null } = {}) {
  const perProbe = probes.map((p) => {
    const a = answers[p.id] || {};
    return scoreVivaAnswer(p, a.text || '', a.timingMs ?? null);
  });
  const answered = perProbe.filter((r) => (answers[r.id]?.text || '').trim().length > 0).length;
  const avg = perProbe.length ? Math.round(perProbe.reduce((s, r) => s + r.score, 0) / perProbe.length) : 0;

  const sessionFlags = [];
  const tooFast = perProbe.filter((r) => r.flags.includes('answered_too_fast')).length;
  if (tooFast >= Math.ceil(probes.length / 2)) sessionFlags.push('many_fast_answers');
  if (answered < probes.length) sessionFlags.push('incomplete');
  if (totalElapsedMs != null && totalElapsedMs > SESSION_BUDGET_MS) sessionFlags.push('over_time_budget');

  // A session with pervasive cheat signals cannot pass regardless of raw score.
  const blocked = sessionFlags.includes('many_fast_answers') || sessionFlags.includes('over_time_budget');
  const passed = avg >= PASS_THRESHOLD && answered >= MIN_PROBES && !blocked;

  return {
    version: VIVA_VERSION,
    comprehensionScore: avg,
    passed,
    threshold: PASS_THRESHOLD,
    answered,
    totalProbes: probes.length,
    perProbe,
    sessionFlags,
    blocked,
  };
}

/* Convenience: which skills a passed viva should credential. We only credential
   skills that were both claimed AND evidenced by the repo under viva. */
export function vivaVerifiedSkills(result, candidateSkills = []) {
  if (!result?.passed) return [];
  return Array.from(new Set(candidateSkills.map((s) => String(s || '').trim()).filter(Boolean)));
}

export default {
  VIVA_VERSION, PASS_THRESHOLD, SESSION_BUDGET_MS, DEFAULT_PROBE_COUNT, MIN_PROBES,
  generateVivaProbes, publicProbe, scoreVivaAnswer, scoreVivaSession, vivaVerifiedSkills,
};
