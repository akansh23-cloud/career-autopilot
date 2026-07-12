/* ============================================================
   CSV SAFETY  (formula-injection neutralization + correct quoting)
   ------------------------------------------------------------
   Every CSV this platform emits is opened in Excel/Sheets by
   placement-cell staff. A student-controlled value beginning with
   = + - @ (or a tab/CR smuggled variant) executes as a FORMULA on
   open — the classic CSV-injection attack (OWASP). `csvCell`
   neutralizes it by prefixing a single quote (the spreadsheet-
   standard "treat as text" marker), then applies RFC 4180 quoting.
   Deterministic, dependency-free, and the ONLY sanctioned way to
   build CSV cells in this codebase.
   ============================================================ */

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** One CSV cell: injection-neutralized, RFC 4180-quoted when needed. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Strip control chars (including tab/CR, which can smuggle a trigger past
  // naive filters); \n is kept — multi-line cells are legitimate and quoted.
  s = s.replace(/[\u0000-\u0009\u000b-\u001f]/g, '');
  if (s.length && FORMULA_TRIGGERS.has(s[0])) s = `'${s}`;
  // Quote when the cell contains a delimiter, quote, or newline.
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** One CSV line from an array of raw values. */
export function csvLine(values) {
  return values.map(csvCell).join(',');
}

/** Full CSV document: header array + array of row-arrays (or objects + cols). */
export function buildCsv(header, rows) {
  const lines = [csvLine(header)];
  for (const row of rows) {
    lines.push(csvLine(Array.isArray(row) ? row : header.map((h) => row[h])));
  }
  return lines.join('\n');
}

export default { csvCell, csvLine, buildCsv };
