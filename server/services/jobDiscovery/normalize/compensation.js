/* ============================================================
   JOB DISCOVERY OS — COMPENSATION NORMALIZATION
   ------------------------------------------------------------
   §19: parse ONLY explicit compensation. Never estimate, never
   infer from seniority or location. Unknown is better than fake.
   The raw text is always retained.
   ============================================================ */

import { normalizeWhitespace } from './text.js';
import { makeCompensation } from '../schema.js';

export const PERIOD = Object.freeze({
  HOUR: 'HOUR', DAY: 'DAY', WEEK: 'WEEK', MONTH: 'MONTH', YEAR: 'YEAR',
});

const CURRENCY_SYMBOLS = [
  ['₹', 'INR'], ['$', 'USD'], ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['₩', 'KRW'],
];
const CURRENCY_CODES = /\b(INR|USD|EUR|GBP|CAD|AUD|SGD|AED|JPY|CHF|SEK|PLN|BRL|MXN|ZAR|NZD|RS|RUPEES?)\b/i;

const PERIOD_PATTERNS = [
  [/\b(per\s*hour|\/\s*hour|hourly|p\/?h|an hour)\b/i, PERIOD.HOUR],
  [/\b(per\s*day|\/\s*day|daily|a day)\b/i, PERIOD.DAY],
  [/\b(per\s*week|\/\s*week|weekly)\b/i, PERIOD.WEEK],
  [/\b(per\s*month|\/\s*month|monthly|p\.?m\.?|a month)\b/i, PERIOD.MONTH],
  [/\b(per\s*year|\/\s*year|per\s*annum|annually|annual|yearly|p\.?a\.?|a year)\b/i, PERIOD.YEAR],
];

const SCHEMA_UNIT = {
  HOUR: PERIOD.HOUR, DAY: PERIOD.DAY, WEEK: PERIOD.WEEK,
  MONTH: PERIOD.MONTH, YEAR: PERIOD.YEAR,
};

function detectCurrency(text) {
  const s = String(text || '');
  const code = s.match(CURRENCY_CODES);
  if (code) {
    const c = code[1].toUpperCase();
    if (c === 'RS' || c.startsWith('RUPEE')) return 'INR';
    return c;
  }
  for (const [sym, cur] of CURRENCY_SYMBOLS) if (s.includes(sym)) return cur;
  return null;
}

function detectPeriod(text) {
  const s = String(text || '');
  for (const [re, p] of PERIOD_PATTERNS) if (re.test(s)) return p;
  return null;
}

/** "12.5L" / "1.2 Cr" / "80k" / "1,20,000" -> number. Returns null when unusable. */
function parseAmount(numText, suffix) {
  const cleaned = String(numText).replace(/[,\s]/g, '');
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  let n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  const suf = String(suffix || '').toLowerCase();
  if (suf === 'k') n *= 1e3;
  else if (suf === 'l' || suf === 'lakh' || suf === 'lakhs' || suf === 'lpa') n *= 1e5;
  else if (suf === 'cr' || suf === 'crore' || suf === 'crores') n *= 1e7;
  else if (suf === 'm' || suf === 'mn') n *= 1e6;
  return n;
}

/* A currency marker may sit before EITHER bound: "₹18L – ₹28L", "$90k-$120k". */
const CUR = String.raw`(?:[₹$€£¥]\s*)?`;
const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)\s*(k|l|lpa|lakhs?|cr|crores?|m|mn)?`;
const RANGE_RE = new RegExp(`${CUR}${NUM}\\s*(?:-|–|—|to|until|up to)\\s*${CUR}${NUM}`, 'i');
const SINGLE_RE = new RegExp(`${CUR}${NUM}`, 'i');

/**
 * Parse a free-text compensation string.
 * Returns a compensation object; min/max/currency/period stay null when the
 * source did not state them.
 */
export function parseCompensationText(raw) {
  const text = normalizeWhitespace(raw || '');
  if (!text) return makeCompensation({});
  /* Guard against parsing years / counts as money: require either a currency
     marker, a period marker, an Indian magnitude suffix, or a "salary" word. */
  const currency = detectCurrency(text);
  const period = detectPeriod(text);
  const hasMagnitude = /\b\d[\d,.]*\s*(k|l|lpa|lakhs?|cr|crores?|m|mn)\b/i.test(text);
  const salaryWord = /\b(salary|compensation|package|ctc|pay|remuneration|stipend)\b/i.test(text);
  if (!currency && !period && !hasMagnitude && !salaryWord) {
    return makeCompensation({ raw: text });
  }

  const range = text.match(RANGE_RE);
  if (range) {
    const min = parseAmount(range[1], range[2]);
    const max = parseAmount(range[3], range[4] || range[2]);
    if (min != null && max != null) {
      return makeCompensation({
        min: Math.min(min, max), max: Math.max(min, max), currency, period, raw: text,
      });
    }
  }
  const single = text.match(SINGLE_RE);
  if (single) {
    const v = parseAmount(single[1], single[2]);
    if (v != null && v > 0) {
      return makeCompensation({ min: v, max: v, currency, period, raw: text });
    }
  }
  return makeCompensation({ raw: text });
}

/**
 * Normalize a structured baseSalary (schema.org MonetaryAmount) or an ATS
 * compensation object. Falls back to text parsing only when structured values
 * are absent.
 */
export function normalizeCompensation(input, { rawText = null } = {}) {
  if (input == null) return rawText ? parseCompensationText(rawText) : makeCompensation({});
  if (typeof input === 'string') return parseCompensationText(input);

  const value = input.value ?? input;
  const currency = input.currency || input.currencyCode || value?.currency || null;
  const unit = String(value?.unitText || input.unitText || input.interval || input.period || '').toUpperCase();
  const period = SCHEMA_UNIT[unit] || detectPeriod(String(input.unitText || input.interval || rawText || '')) || null;

  const rawMin = value?.minValue ?? input.minValue ?? input.min ?? input.minAmount ?? null;
  const rawMax = value?.maxValue ?? input.maxValue ?? input.max ?? input.maxAmount ?? null;
  const rawSingle = value?.value ?? input.amount ?? null;

  const toNum = (v) => {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  let min = toNum(rawMin);
  let max = toNum(rawMax);
  const single = toNum(rawSingle);
  if (min == null && max == null && single != null) { min = single; max = single; }
  if (min != null && max != null && min > max) { const t = min; min = max; max = t; }

  if (min == null && max == null) {
    return rawText ? parseCompensationText(rawText) : makeCompensation({ currency: currency || null, period, raw: rawText || null });
  }
  return makeCompensation({
    min, max,
    currency: (currency && String(currency).toUpperCase()) || detectCurrency(rawText || '') || null,
    period,
    raw: rawText || (input.raw ?? null),
  });
}

/** Annualize for comparison ONLY. Never written back to the canonical record. */
export function annualize(amount, period) {
  if (amount == null || !period) return null;
  switch (period) {
    case PERIOD.HOUR: return amount * 2080;
    case PERIOD.DAY: return amount * 260;
    case PERIOD.WEEK: return amount * 52;
    case PERIOD.MONTH: return amount * 12;
    case PERIOD.YEAR: return amount;
    default: return null;
  }
}

/**
 * Salary filter compatibility. Jobs with no stated salary are NOT excluded by
 * default — that would delete most of the index for a fact the source withheld.
 */
export function salaryCompatibility(job, { salaryMin = null, salaryMax = null, currency = null } = {}) {
  const c = job.compensation || {};
  if (salaryMin == null && salaryMax == null) return { compatible: true, score: 0.5, reason: 'no salary filter' };
  if (c.min == null && c.max == null) return { compatible: true, score: 0.25, reason: 'salary not stated by source', unknown: true };
  if (currency && c.currency && currency.toUpperCase() !== c.currency.toUpperCase()) {
    return { compatible: true, score: 0.25, reason: 'currency differs; not comparable', unknown: true };
  }
  const jobMax = annualize(c.max ?? c.min, c.period) ?? (c.max ?? c.min);
  const jobMin = annualize(c.min ?? c.max, c.period) ?? (c.min ?? c.max);
  if (salaryMin != null && jobMax != null && jobMax < salaryMin) {
    return { compatible: false, score: 0, reason: 'below requested minimum' };
  }
  if (salaryMax != null && jobMin != null && jobMin > salaryMax) {
    return { compatible: false, score: 0, reason: 'above requested maximum' };
  }
  return { compatible: true, score: 1, reason: 'within requested range' };
}

export default {
  PERIOD, parseCompensationText, normalizeCompensation, annualize, salaryCompatibility,
};
