/* ============================================================
   TEST OUTPUT PARSER
   ------------------------------------------------------------
   Pasted console output is FORGEABLE. Nothing in this file can
   change that, and nothing here pretends otherwise — the best
   status a paste can ever earn is `self_reported`.

   What parsing DOES buy us:
     - it rejects junk ("it works", a screenshot description, an
       empty box) by requiring a recognised runner signature
     - it extracts pass/fail counts so a run with failures cannot
       be submitted as proof
     - it gives the student specific feedback instead of a shrug

   A green GitHub Actions run is the only path to `verified`.
   ============================================================ */

/* Each matcher returns { passed, failed, total } or null. */
const RUNNERS = [
  {
    name: 'Jest',
    // Tests:       2 failed, 10 passed, 12 total
    test: (s) => /^\s*Tests:\s+/m.test(s),
    parse: (s) => {
      const line = s.match(/^\s*Tests:\s+(.+)$/m);
      if (!line) return null;
      const seg = line[1];
      const passed = Number((seg.match(/(\d+)\s+passed/) || [])[1] || 0);
      const failed = Number((seg.match(/(\d+)\s+failed/) || [])[1] || 0);
      const total = Number((seg.match(/(\d+)\s+total/) || [])[1] || passed + failed);
      return { passed, failed, total };
    },
  },
  {
    name: 'Vitest',
    test: (s) => /Test Files\s+/.test(s) || /^\s*Tests\s+\d+\s+passed/m.test(s),
    parse: (s) => {
      const line = s.match(/^\s*Tests\s+(.+)$/m);
      if (!line) return null;
      const seg = line[1];
      const passed = Number((seg.match(/(\d+)\s+passed/) || [])[1] || 0);
      const failed = Number((seg.match(/(\d+)\s+failed/) || [])[1] || 0);
      return { passed, failed, total: passed + failed };
    },
  },
  {
    name: 'Mocha',
    test: (s) => /^\s*\d+\s+passing/m.test(s),
    parse: (s) => {
      const passed = Number((s.match(/^\s*(\d+)\s+passing/m) || [])[1] || 0);
      const failed = Number((s.match(/^\s*(\d+)\s+failing/m) || [])[1] || 0);
      return { passed, failed, total: passed + failed };
    },
  },
  {
    name: 'node:test',
    test: (s) => /^#\s*pass\s+\d+/m.test(s),
    parse: (s) => {
      const passed = Number((s.match(/^#\s*pass\s+(\d+)/m) || [])[1] || 0);
      const failed = Number((s.match(/^#\s*fail\s+(\d+)/m) || [])[1] || 0);
      return { passed, failed, total: passed + failed };
    },
  },
  {
    name: 'pytest',
    test: (s) => /=+\s*\d+\s+(passed|failed)/.test(s),
    parse: (s) => {
      const passed = Number((s.match(/(\d+)\s+passed/) || [])[1] || 0);
      const failed = Number((s.match(/(\d+)\s+failed/) || [])[1] || 0);
      return { passed, failed, total: passed + failed };
    },
  },
  {
    name: 'Go test',
    test: (s) => /^(ok|FAIL)\s+\S+/m.test(s),
    parse: (s) => {
      const okCount = (s.match(/^ok\s+\S+/gm) || []).length;
      const failCount = (s.match(/^FAIL\s+\S+/gm) || []).length;
      return { passed: okCount, failed: failCount, total: okCount + failCount };
    },
  },
];

/**
 * parseTestOutput(text)
 * Returns:
 *   { ok:false, reason, message }                       — unusable paste
 *   { ok:true, runner, passed, failed, total, message } — recognised run
 */
export function parseTestOutput(raw = '') {
  const s = String(raw || '');
  const trimmed = s.trim();

  if (!trimmed) {
    return { ok: false, reason: 'empty', message: 'Paste the full console output from your test run.' };
  }
  if (trimmed.length < 40) {
    return { ok: false, reason: 'too_short', message: 'That looks too short to be a real test run. Paste the whole output, including the summary line.' };
  }

  const runner = RUNNERS.find((r) => r.test(s));
  if (!runner) {
    return {
      ok: false,
      reason: 'unrecognised',
      message: 'No test-runner summary found. Paste the complete output from `npm test` — we look for the summary line from Jest, Vitest, Mocha, node:test, pytest or go test.',
    };
  }

  const counts = runner.parse(s);
  if (!counts) {
    return { ok: false, reason: 'unparseable', message: `${runner.name} output detected but the summary line could not be read. Paste the full output.` };
  }

  if (counts.total === 0) {
    return { ok: false, reason: 'no_tests', message: `${runner.name} ran but reported zero tests. Write at least one real test first.` };
  }
  if (counts.failed > 0) {
    return {
      ok: false, reason: 'failing', runner: runner.name, ...counts,
      message: `${runner.name} reports ${counts.failed} failing test${counts.failed === 1 ? '' : 's'}. Fix them, then paste the passing run.`,
    };
  }

  return {
    ok: true,
    runner: runner.name,
    ...counts,
    message: `${runner.name}: ${counts.passed} test${counts.passed === 1 ? '' : 's'} passing. Self-reported — add a CI workflow to have this verified from your repo automatically.`,
  };
}

export default { parseTestOutput };
