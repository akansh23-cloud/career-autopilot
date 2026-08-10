/* ============================================================
   DATE ENGINE — deterministic resume date handling
   ------------------------------------------------------------
   parse -> {year, month|null, present} · format styles ·
   range validation · chronology + overlap detection.
   ============================================================ */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON3 = MONTHS.map((m) => m.slice(0, 3));

export const DATE_STYLES = Object.freeze(['MMM YYYY', 'MMMM YYYY', 'YYYY']);

export function parseResumeDate(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return { ok: false, empty: true, raw };
  if (/^(present|current|now|ongoing|till date|to date)$/i.test(raw)) return { ok: true, present: true, raw };
  let m = raw.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[1].toLowerCase());
    const m3 = MON3.indexOf(m[1].toLowerCase().slice(0, 3));
    const month = mi >= 0 ? mi : m3;
    if (month >= 0) return { ok: true, year: +m[2], month, style: m[1].length <= 3 ? 'MMM YYYY' : 'MMMM YYYY', raw };
  }
  m = raw.match(/^(\d{1,2})[\/.-](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return { ok: true, year: +m[2], month: +m[1] - 1, style: 'MM/YYYY', raw };
  m = raw.match(/^(\d{4})[\/.-](\d{1,2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return { ok: true, year: +m[1], month: +m[2] - 1, style: 'YYYY-MM', raw };
  m = raw.match(/^(\d{4})$/);
  if (m) return { ok: true, year: +m[1], month: null, style: 'YYYY', raw };
  return { ok: false, raw };
}

export function formatResumeDate(parsed, style = 'MMM YYYY') {
  if (!parsed || !parsed.ok) return parsed?.raw || '';
  if (parsed.present) return 'Present';
  const { year, month } = parsed;
  if (style === 'YYYY' || month == null) return String(year);
  const name = MONTHS[month] || '';
  if (style === 'MMMM YYYY') return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
  return `${name.charAt(0).toUpperCase()}${name.slice(1, 3)} ${year}`;
}

export function dateOrdinal(parsed) {
  if (!parsed?.ok) return null;
  if (parsed.present) return 9999 * 12 + 11;
  return parsed.year * 12 + (parsed.month == null ? 6 : parsed.month); // year-only sits mid-year
}

/* Validate one {startDate, endDate} range. */
export function validateDateRange({ startDate = '', endDate = '', current = false } = {}) {
  const issues = [];
  const s = parseResumeDate(startDate);
  const e = current && !endDate ? { ok: true, present: true, raw: 'Present' } : parseResumeDate(endDate);
  if (startDate && !s.ok) issues.push({ code: 'malformed_start', message: `Start date "${startDate}" is not a recognised date.` });
  if (endDate && !e.ok && !e.empty) issues.push({ code: 'malformed_end', message: `End date "${endDate}" is not a recognised date.` });
  if (s.ok && e.ok && !e.present && !s.present) {
    if (dateOrdinal(e) < dateOrdinal(s)) issues.push({ code: 'end_before_start', message: 'End date is before the start date.' });
  }
  const thisYear = new Date().getFullYear();
  for (const [which, p] of [['start', s], ['end', e]]) {
    if (p.ok && !p.present && (p.year < 1950 || p.year > thisYear + 1)) {
      issues.push({ code: `implausible_${which}_year`, message: `${which === 'start' ? 'Start' : 'End'} year ${p.year} looks implausible.` });
    }
  }
  return { ok: issues.length === 0, issues, start: s, end: e };
}

/* Chronology + style consistency across dated items (experience/education). */
export function analyzeChronology(items = []) {
  const parsed = items.map((it, i) => ({
    i, id: it.id, label: it.label || '',
    range: validateDateRange(it),
  }));
  const issues = [];
  for (const p of parsed) for (const iss of p.range.issues) issues.push({ ...iss, itemId: p.id, itemLabel: p.label });

  // Reverse-chronology: expect newest first (by start).
  const ord = parsed.filter((p) => p.range.start.ok && !p.range.start.present);
  for (let i = 1; i < ord.length; i++) {
    if (dateOrdinal(ord[i].range.start) > dateOrdinal(ord[i - 1].range.start)) {
      issues.push({ code: 'chronology_order', itemId: ord[i].id, itemLabel: ord[i].label, message: `"${ord[i].label}" starts after the entry above it — resumes list newest first.` });
      break; // one flag is enough
    }
  }
  // Suspicious full overlaps (two roles fully concurrent for >12 months, neither marked current).
  for (let a = 0; a < parsed.length; a++) {
    for (let b = a + 1; b < parsed.length; b++) {
      const A = parsed[a].range, B = parsed[b].range;
      if (!(A.start.ok && A.end.ok && B.start.ok && B.end.ok)) continue;
      if (A.end.present || B.end.present) continue;
      const s = Math.max(dateOrdinal(A.start), dateOrdinal(B.start));
      const e = Math.min(dateOrdinal(A.end), dateOrdinal(B.end));
      if (e - s > 12) {
        issues.push({ code: 'overlapping_roles', itemId: parsed[b].id, itemLabel: parsed[b].label, message: `"${parsed[a].label}" and "${parsed[b].label}" overlap by more than a year — confirm both are correct.` });
      }
    }
  }
  // Format consistency.
  const styles = new Set();
  for (const p of parsed) for (const d of [p.range.start, p.range.end]) if (d.ok && !d.present && d.style) styles.add(d.style === 'MMMM YYYY' ? 'MMM YYYY' : d.style);
  if (styles.size > 1) issues.push({ code: 'inconsistent_date_format', message: `Dates mix formats (${[...styles].join(', ')}). Pick one style for the whole resume.` });
  return { issues, styles: [...styles] };
}

export default { DATE_STYLES, parseResumeDate, formatResumeDate, dateOrdinal, validateDateRange, analyzeChronology };
