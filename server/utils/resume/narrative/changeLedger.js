/* ============================================================
   CHANGE LEDGER (stage 20) + TELEMETRY (stage 29)
   ------------------------------------------------------------
   CHANGE LEDGER records, for every significant modification:
     original · enhanced · source evidence · reason ·
     job signal addressed · confidence · scores before/after
   This is what lets the UI later answer "why did Career Autopilot
   change this?" without re-running anything, and it is also the
   audit trail that proves no claim appeared without evidence.

   TELEMETRY makes cost and quality measurable: duration per stage,
   provider/model, tokens, cache hits, bullets evaluated, rejected
   hallucinations, generic-language penalties, final average score,
   fallback usage, errors. It deliberately records COUNTS AND
   IDENTIFIERS, never resume content.
   ============================================================ */

export const CHANGE_LEDGER_VERSION = 'change-ledger-v1';
export const NARRATIVE_TELEMETRY_VERSION = 'narrative-telemetry-v1';

/* ------------------------------------------------------------------ */
/* Change ledger                                                       */
/* ------------------------------------------------------------------ */
const REASON_TEMPLATES = {
  weak_opener_removed: 'Converted vague responsibility language into an evidence-backed statement of what you actually did, without adding any new claim.',
  vagueness_replaced: 'Replaced a general description with the specific system and technology already named in your evidence.',
  structure_varied: 'Restructured so this role does not read as several versions of the same sentence.',
  domain_vocabulary: 'Used the phrasing practitioners in this field actually use for what you described.',
  outcome_fronted: 'Led with the outcome you recorded, because it is the strongest part of this evidence.',
  terminology_aligned: 'Adopted the target role\'s canonical term for something your evidence already demonstrates.',
  seniority_register: 'Adjusted the framing to match the seniority your evidence supports — neither inflated nor understated.',
  cliche_removed: 'Removed default resume phrasing that carried no verifiable information.',
  metric_preserved: 'Kept your recorded metric exactly as you provided it.',
  compressed: 'Compressed to keep space for the experience most relevant to this target.',
  repetition_repaired: 'Swapped to a different validated phrasing because too many bullets shared this opening or shape.',
  unchanged_best: 'Your original wording scored highest against the evidence — left as written.',
};

export class ChangeLedger {
  constructor() {
    this.entries = [];
  }

  /**
   * @param {object} e
   *   section, itemId, bulletId, evidenceId, original, enhanced,
   *   reasonCodes[], jobSignal, confidence, scoreBefore, scoreAfter,
   *   strategy, structure
   */
  record(e) {
    const original = String(e.original || '');
    const enhanced = String(e.enhanced || '');
    if (!enhanced) return null;
    const changed = original.trim() !== enhanced.trim();
    const codes = (e.reasonCodes || []).filter(Boolean);
    const entry = {
      id: `chg_${this.entries.length + 1}`,
      section: e.section || '',
      itemId: e.itemId || '',
      bulletId: e.bulletId || '',
      evidenceId: e.evidenceId || '',
      original,
      enhanced,
      changed,
      strategy: e.strategy || '',
      structure: e.structure || '',
      reasonCodes: codes,
      reason: codes.length
        ? codes.map((c) => REASON_TEMPLATES[c]).filter(Boolean).join(' ')
        : (changed ? REASON_TEMPLATES.vagueness_replaced : REASON_TEMPLATES.unchanged_best),
      jobSignal: e.jobSignal || '',
      sourceEvidence: e.sourceEvidence || null,
      confidence: Number.isFinite(e.confidence) ? Number(e.confidence.toFixed(2)) : null,
      scoreBefore: Number.isFinite(e.scoreBefore) ? Number(e.scoreBefore.toFixed(2)) : null,
      scoreAfter: Number.isFinite(e.scoreAfter) ? Number(e.scoreAfter.toFixed(2)) : null,
      scoreDelta: Number.isFinite(e.scoreBefore) && Number.isFinite(e.scoreAfter)
        ? Number((e.scoreAfter - e.scoreBefore).toFixed(2)) : null,
    };
    this.entries.push(entry);
    return entry;
  }

  /** Only the changes worth showing a user, ordered by impact. */
  significant({ minDelta = 4, limit = 25 } = {}) {
    return this.entries
      .filter((e) => e.changed && (e.scoreDelta == null || e.scoreDelta >= minDelta || e.reasonCodes.includes('weak_opener_removed') || e.reasonCodes.includes('cliche_removed')))
      .sort((a, b) => (b.scoreDelta ?? 0) - (a.scoreDelta ?? 0))
      .slice(0, limit);
  }

  summary() {
    const changed = this.entries.filter((e) => e.changed);
    const byReason = {};
    for (const e of changed) {
      for (const c of e.reasonCodes) byReason[c] = (byReason[c] || 0) + 1;
    }
    const deltas = changed.map((e) => e.scoreDelta).filter((d) => Number.isFinite(d));
    return {
      version: CHANGE_LEDGER_VERSION,
      total: this.entries.length,
      changed: changed.length,
      unchanged: this.entries.length - changed.length,
      byReason,
      averageScoreDelta: deltas.length ? Number((deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(2)) : 0,
    };
  }

  toJSON() {
    return { version: CHANGE_LEDGER_VERSION, entries: this.entries, summary: this.summary() };
  }
}

export function reasonCodesFor({ evidence, candidate, original, jobIntel }) {
  const codes = [];
  const text = String(candidate.text || '');
  if (evidence?.weakOpener) codes.push('weak_opener_removed');
  if (candidate.strategy === 'impact_led' && evidence?.outcome) codes.push('outcome_fronted');
  if (candidate.strategy === 'domain_natural') codes.push('domain_vocabulary');
  if (candidate.strategy === 'seniority_adjusted') codes.push('seniority_register');
  if (candidate.repaired) codes.push('repetition_repaired');
  if ((evidence?.numericEvidence || []).length && /\d/.test(text)) codes.push('metric_preserved');
  if (/\b(various|responsible for|worked on|helped with|leveraged|cutting-edge|robust|seamless)\b/i.test(String(original))
    && !/\b(various|responsible for|worked on|helped with|leveraged|cutting-edge|robust|seamless)\b/i.test(text)) {
    codes.push('cliche_removed');
  }
  if (jobIntel && (jobIntel.prioritySkills || []).some((p) => new RegExp(`(?<![a-z0-9])${p.skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i').test(text)
    && !new RegExp(`(?<![a-z0-9])${p.skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i').test(String(original)))) {
    codes.push('terminology_aligned');
  }
  if (!codes.length && String(original).trim() !== text.trim()) codes.push('vagueness_replaced');
  return [...new Set(codes)];
}

export function jobSignalFor(candidate, jobIntel) {
  if (!jobIntel) return '';
  const text = String(candidate.text || '');
  const hit = (jobIntel.prioritySkills || [])
    .filter((p) => p.tier === 'mandatory' || p.tier === 'core_responsibility')
    .find((p) => new RegExp(`(?<![a-z0-9])${p.skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i').test(text));
  return hit ? `Addresses the ${hit.tier === 'mandatory' ? 'mandatory' : 'core'} requirement "${hit.skill}".` : '';
}

/* ------------------------------------------------------------------ */
/* Telemetry                                                           */
/* ------------------------------------------------------------------ */
export class NarrativeTelemetry {
  constructor({ mode = 'enhance' } = {}) {
    this.mode = mode;
    this.startedAt = Date.now();
    this.stages = [];
    this.counters = {
      evidenceRecords: 0,
      bulletsEvaluated: 0,
      candidatesGenerated: 0,
      candidatesRejected: 0,
      rejectedHallucinations: 0,
      repetitionRepairs: 0,
      terminologyNormalisations: 0,
      compressionOps: 0,
      researchCalls: 0,
      researchCacheHits: 0,
      aiCalls: 0,
      aiFailures: 0,
      fallbacksUsed: 0,
      errors: 0,
    };
    this.quality = {
      averageFinalScore: 0,
      averageGenericPenalty: 0,
      naturalnessScore: 0,
      unsupportedClaimCount: 0,
    };
    this.errors = [];
    this._openStages = new Map();
  }

  begin(stage) {
    this._openStages.set(stage, Date.now());
    return stage;
  }

  end(stage, extra = {}) {
    const start = this._openStages.get(stage) ?? Date.now();
    this._openStages.delete(stage);
    this.stages.push({ stage, ms: Date.now() - start, ...extra });
  }

  async time(stage, fn) {
    this.begin(stage);
    try {
      const out = await fn();
      this.end(stage, { ok: true });
      return out;
    } catch (err) {
      this.end(stage, { ok: false, error: err?.message || 'error' });
      this.counters.errors += 1;
      this.errors.push({ stage, message: String(err?.message || err).slice(0, 200) });
      throw err;
    }
  }

  count(key, n = 1) {
    if (key in this.counters) this.counters[key] += n;
    return this.counters[key];
  }

  setQuality(patch) { Object.assign(this.quality, patch); }

  snapshot({ usage = null, researchStats = null } = {}) {
    return {
      version: NARRATIVE_TELEMETRY_VERSION,
      mode: this.mode,
      durationMs: Date.now() - this.startedAt,
      stages: this.stages,
      counters: { ...this.counters },
      quality: { ...this.quality },
      ai: usage ? usage.snapshot() : { totalCalls: 0, inputTokens: 0, outputTokens: 0, cacheHits: 0, errors: 0, byTask: {} },
      research: researchStats || { size: 0, hits: 0, misses: 0 },
      errors: this.errors,
      /* Cost is measurable without pricing being hard-coded: tokens by task. */
      costBasis: 'tokens_by_task',
    };
  }
}

export default {
  CHANGE_LEDGER_VERSION, NARRATIVE_TELEMETRY_VERSION,
  ChangeLedger, NarrativeTelemetry, reasonCodesFor, jobSignalFor, REASON_TEMPLATES,
};
