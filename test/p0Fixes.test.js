/* ============================================================
   P0 REGRESSION TESTS
   1. progressiveGate must return the BEST NON-EMPTY set, never []
      while real candidates exist at some relaxation level.
   2. The whole product must start in LIGHT and stay there.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { progressiveGate, FALLBACK_STEPS } from '../server/utils/jobSearchEngine.js';
import { describeRelaxations } from '../server/routes/jobSearchRoute.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/* Strip comments before asserting on source. Several of these checks assert that
   a construct is ABSENT, and the replacement code documents what it replaced —
   so a naive grep matches the explanation and fails on correct code. */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/* ---------------- shared fixtures ---------------- */
const helpers = {
  passesFreshness: (days, fresh) => {
    const max = { '24h': 1, '1d': 1, '3d': 3, '7d': 7, '30d': 30, latest: Infinity }[fresh] ?? Infinity;
    if (days == null) return { ok: false, reason: 'no date' };
    return days <= max ? { ok: true } : { ok: false, reason: 'too old' };
  },
  matchRole: (j, role) => !role || String(j.title).toLowerCase().includes(String(role).toLowerCase()),
  matchLocation: (j, loc) => !loc || String(j.location).toLowerCase().includes(String(loc).toLowerCase()),
  matchesWorkMode: (j, m) => !m || m === 'any' || String(j.mode).toLowerCase() === m,
  matchesExperienceLevel: () => true,
  matchesJobType: () => true,
  jobKey: (j) => j.url,
  maxDaysOf: (f) => ({ '24h': 1, '1d': 1, '3d': 3, '7d': 7, '30d': 30, latest: Infinity }[f] ?? Infinity),
};
const job = (o = {}) => ({
  title: 'DevOps Engineer', company: 'Acme', location: 'Pune, India',
  mode: 'remote', url: `https://example.com/${Math.random()}`, postedDays: 2, summary: '', requiredSkills: [], ...o,
});

/* ============ P0-2: the engine bug ============ */

test('progressiveGate returns real jobs when no step reaches minResults (was returning [])', () => {
  // 3 real, in-window postings; caller asks for 5.
  const jobs = [job(), job(), job()];
  const out = progressiveGate(
    jobs,
    { role: 'devops engineer', location: 'pune', mode: 'any', experience: 'any', jobType: 'any', freshness: '7d', filterMode: 'inclusive' },
    helpers,
    { minResults: 5, maxLevel: 4 },
  );
  // The old implementation returned candidates: [] here — the exact
  // "no jobs found" symptom while 3 valid postings were in hand.
  assert.equal(out.candidates.length, 3, 'must return the 3 real postings, not an empty list');
  assert.equal(out.satisfiedMinResults, false);
  assert.equal(out.thinResults, true, 'thin-but-real must be distinguishable from empty');
  assert.equal(out.step.level, 0, 'should report the least-relaxed step that produced them');
});

test('progressiveGate still returns empty when nothing survives at any level', () => {
  const out = progressiveGate(
    [job({ title: 'Chef', company: 'Kitchen', summary: 'cooking', requiredSkills: [] })],
    { role: 'devops engineer', location: 'pune', mode: 'any', experience: 'any', jobType: 'any', freshness: '7d', filterMode: 'inclusive' },
    helpers,
    { minResults: 5, maxLevel: 4 },
  );
  assert.equal(out.candidates.length, 0, 'a genuine zero must stay zero — never fabricate');
  assert.equal(out.exhausted, true);
});

test('progressiveGate prefers the least-relaxed non-empty step', () => {
  // Nothing inside 24h; one posting 20 days old. Level 0 fails, level 1 (30d) wins.
  const out = progressiveGate(
    [job({ postedDays: 20 })],
    { role: 'devops engineer', location: 'pune', mode: 'any', experience: 'any', jobType: 'any', freshness: '24h', filterMode: 'strict' },
    helpers,
    { minResults: 5, maxLevel: 4 },
  );
  assert.equal(out.candidates.length, 1);
  assert.equal(out.step.level, 1, 'must not skip to the most relaxed step when an earlier one worked');
});

test('progressiveGate still short-circuits when a step DOES clear minResults', () => {
  const out = progressiveGate(
    [job(), job(), job(), job(), job()],
    { role: 'devops engineer', location: 'pune', mode: 'any', experience: 'any', jobType: 'any', freshness: '7d', filterMode: 'inclusive' },
    helpers,
    { minResults: 5, maxLevel: 4 },
  );
  assert.equal(out.satisfiedMinResults, true);
  assert.equal(out.step.level, 0);
  assert.equal(out.thinResults, undefined);
});

test('the route no longer carries the engine bug workaround', () => {
  const src = code('server/routes/jobSearchRoute.js');
  assert.ok(!/ENGINE BUG WORKAROUND/.test(src), 'workaround comment must be gone');
  assert.ok(!/minResults: 1, maxLevel: 4/.test(src), 'the second minResults=1 call must be gone');
});

test('describeRelaxations names each dropped filter, not just "broader matches"', () => {
  const base = { role: 'DevOps Engineer', location: 'Pune', mode: 'remote', freshness: '24h' };
  const level4 = FALLBACK_STEPS.find((s) => s.level === 4);
  const rel = describeRelaxations(level4, base);
  const filters = rel.map((r) => r.filter);
  assert.ok(filters.includes('location'), 'must name the dropped location filter');
  assert.ok(filters.includes('role'), 'must name the loosened role match');
  assert.ok(filters.includes('workMode'), 'must name the dropped work mode');
  assert.ok(rel.every((r) => typeof r.label === 'string' && r.label.length > 0));
});

test('describeRelaxations reports nothing for the exact step', () => {
  const level0 = FALLBACK_STEPS.find((s) => s.level === 0);
  assert.deepEqual(describeRelaxations(level0, { role: 'DevOps', location: 'Pune' }), []);
});

test('empty searches are never cached', () => {
  const src = read('server/routes/jobSearchRoute.js');
  assert.match(src, /if \(kept\.length\) jobCacheSet/, 'cache write must be guarded by a non-empty result');
});

test('provider diagnostics collected by the source are returned, not discarded', () => {
  const src = read('server/routes/jobSearchRoute.js');
  assert.match(src, /ctx\.diag/, 'route must read the diag object back');
  for (const code of ['INVALID_KEY', 'NOT_SUBSCRIBED', 'RATE_LIMITED', 'NO_RESULTS', 'NETWORK', 'UPSTREAM']) {
    assert.ok(src.includes(code), `route must classify ${code}`);
  }
  assert.match(src, /NO_REGIONAL_SOURCE/, 'missing India-capable provider must be an explicit error, not silence');
});

test('provider role-alias broadening exists, is labelled, and is capped', () => {
  const src = read('server.js');
  assert.match(src, /roleAliasQueries/, 'alias broadening helper must exist');
  assert.match(src, /provider_role_alias/, 'broadening must be labelled distinctly from filter broadening');
  assert.match(src, /roleAliasQueries\(roleQ\)\.slice\(0, 2\)/, 'must cap extra provider calls to avoid 429');
});

test('devops aliases cover platform / SRE / cloud', async () => {
  const src = read('server.js');
  const m = src.match(/const ROLE_ALIAS_GROUPS = \[([\s\S]*?)\n\];/);
  assert.ok(m, 'alias groups must be declared');
  const devopsLine = m[1].split('\n').find((l) => l.includes('devops engineer'));
  for (const alias of ['site reliability engineer', 'platform engineer', 'cloud engineer']) {
    assert.ok(devopsLine.includes(alias), `DevOps must broaden to ${alias}`);
  }
});

/* ============ P0-1: light theme ============ */

test('theme defaults to light and ignores the OS', async () => {
  const theme = await import('../web/src/lib/theme.js');
  assert.equal(theme.DEFAULT_THEME, 'light');
  assert.equal(theme.THEME_PREFERENCE_ENABLED, false);
  assert.equal(theme.getTheme(), 'light');
  assert.equal(theme.resolveTheme(), 'light');
  // A stale stored preference must not resurrect dark.
  assert.equal(theme.resolveTheme('system'), 'light', 'system must not resolve to dark');
});

test('theme.js no longer defaults to system', () => {
  const src = read('web/src/lib/theme.js');
  assert.ok(!/return THEMES\.includes\(v\) \? v : 'system'/.test(src), "must not fall back to 'system'");
  assert.match(src, /THEME_PREFERENCE_ENABLED = false/);
});

test('the hard-coded dark native-select styling is gone', () => {
  const css = code('web/src/index.css');
  assert.ok(!/select,\s*select option,\s*select optgroup\s*\{\s*background-color:\s*#0B0E0C/.test(css),
    'the #0B0E0C select rule must be removed');
  assert.ok(!css.includes('background-color: #0B0E0C'), 'no hard-coded dark select background anywhere');
});

test('option/optgroup surfaces are opaque and token-driven', () => {
  const css = read('web/src/index.css');
  const rule = css.match(/select option,\s*\n?select optgroup,[\s\S]*?\}/);
  assert.ok(rule, 'option/optgroup rule must exist');
  assert.match(rule[0], /var\(--menu-bg\)/, 'must read the opaque menu token');
  // The menu/field tokens must be solid hex in light — never rgba.
  const light = css.match(/:root,\s*\nhtml\.light \{([\s\S]*?)\n\}/);
  assert.ok(light, 'light token block must exist on :root');
  for (const tok of ['--field-bg:', '--menu-bg:']) {
    const line = light[1].split('\n').find((l) => l.trim().startsWith(tok));
    assert.ok(line, `${tok} must be defined in the light block`);
    assert.ok(/#[0-9A-Fa-f]{6}/.test(line) && !/rgba/.test(line), `${tok} must be an opaque hex, got: ${line.trim()}`);
  }
});

test('light is the base token set; dark is opt-in only', () => {
  const css = read('web/src/index.css');
  const rootIdx = css.indexOf(':root,\nhtml.light {');
  const darkIdx = css.indexOf('html.dark {');
  assert.ok(rootIdx > -1, ':root must carry the light tokens');
  assert.ok(darkIdx > rootIdx, 'dark must be a scoped override, not the base');
  const lightBlock = css.slice(rootIdx, darkIdx);
  assert.match(lightBlock, /--bg-base:\s*#F7F8F6/, 'base background must be light paper');
});

test('the HTML shell ships light, not class="dark"', () => {
  const html = read('web/index.html');
  assert.ok(!/<html[^>]*class="[^"]*\bdark\b/.test(html), 'the document must not ship class="dark"');
  assert.match(html, /<html[^>]*class="light"/);
  assert.match(html, /theme-color" content="#F7F8F6"/);
});

test('the app-wide backdrop is theme-token driven, not near-black', () => {
  const src = code('web/src/components/Atmosphere.jsx');
  assert.ok(!/bg-ink-950/.test(src), 'the full-bleed backdrop must not be pinned to ink-950');
  assert.match(src, /atmosphere-layer/, 'must carry the class index.css already styles');
  assert.match(src, /className="absolute inset-0 bg-base"/);
});

test('no dark-coupled utility classes survive in app UI', () => {
  const SKIP = ['resumeRenderer', 'resumeTemplates', 'resumeTemplateRegistry', 'ResumeTemplates', 'resumeFixtures'];
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.jsx?$/.test(e.name)) continue;
      if (SKIP.some((s) => p.includes(s))) continue;
      const src = fs.readFileSync(p, 'utf8');
      // bg-white / border-white as a TAILWIND OPACITY utility (bg-white/8),
      // which only reads correctly on a dark plate. Bare `bg-white` is allowed
      // (Google sign-in button, resume paper) and is checked separately.
      const m = src.replace(/\/\*[\s\S]*?\*\//g, '').match(/\b(?:hover:|focus:)?(?:bg|border|ring|divide|via)-white\/[\d[]/g);
      if (m) offenders.push(`${p.replace(ROOT + '/', '')}: ${[...new Set(m)].join(', ')}`);
    }
  };
  walk(path.join(ROOT, 'web/src'));
  assert.deepEqual(offenders, [], `dark-coupled classes remain:\n${offenders.join('\n')}`);
});

test('no <option> carries a dark or page-background class', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.jsx$/.test(e.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const tag of src.match(/<option[^>]{0,240}?className="[^"]*"/g) || []) {
        if (/bg-slate|bg-ink|bg-black|bg-base\b|bg-elevated\b|bg-surface/.test(tag)) {
          offenders.push(`${p.replace(ROOT + '/', '')}: ${tag.slice(0, 90)}`);
        }
      }
    }
  };
  walk(path.join(ROOT, 'web/src'));
  assert.deepEqual(offenders, [], `option elements must use bg-menu:\n${offenders.join('\n')}`);
});
