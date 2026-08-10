/* ============================================================
   LIGHT THEME — WCAG AA CONTRAST
   ------------------------------------------------------------
   Computes real contrast ratios from the shipped light tokens in
   index.css. Translucent tokens (rgba text/border) are composited
   over their actual backdrop first, because a raw rgba value tells
   you nothing about what the user sees.

   Thresholds: 4.5:1 for body text (WCAG 1.4.3 AA), 3:1 for UI
   component boundaries (WCAG 1.4.11) and large/meta text.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const css = fs.readFileSync(path.join(ROOT, 'web/src/index.css'), 'utf8');
const lightBlock = css.slice(css.indexOf(':root,\nhtml.light {'), css.indexOf('html.dark {'));
const TOK = {};
for (const m of lightBlock.matchAll(/(--[\w-]+):\s*([^;]+);/g)) TOK[m[1]] = m[2].trim();

function toRgb(colour, backdrop = [255, 255, 255]) {
  const c = String(colour).trim();
  if (c.startsWith('#')) {
    const h = c.slice(1);
    const n = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`unparseable colour: ${c}`);
  const p = m[1].split(',').map(Number);
  const a = p[3] ?? 1;
  return [0, 1, 2].map((i) => Math.round(p[i] * a + backdrop[i] * (1 - a)));
}
const luminance = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (fg, bg) => {
  const l1 = luminance(fg); const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const BASE = toRgb(TOK['--bg-base']);
const ELEVATED = toRgb(TOK['--bg-elevated']);
const FIELD = toRgb(TOK['--field-bg']);

const CASES = [
  ['body text on the page',            '--text-primary',   BASE,     4.5],
  ['body text on a card',              '--text-primary',   ELEVATED, 4.5],
  ['text typed into a field',          '--field-text',     FIELD,    4.5],
  ['secondary text on the page',       '--text-secondary', BASE,     4.5],
  ['secondary text on a card',         '--text-secondary', ELEVATED, 4.5],
  ['muted/meta text on the page',      '--text-muted',     BASE,     3.0],
  ['brand text on a card',             '--brand-text',     ELEVATED, 4.5],
  ['brand text on the page',           '--brand-text',     BASE,     4.5],
  ['success text on a card',           '--ok',             ELEVATED, 4.5],
  ['warning text on a card',           '--warn',           ELEVATED, 4.5],
  ['danger text on a card',            '--danger',         ELEVATED, 4.5],
  // The requirement was an explicitly "visible neutral border" on selects.
  ['field border against the field',   '--field-border',   FIELD,    3.0],
  ['field border against the page',    '--field-border',   BASE,     3.0],
];

for (const [label, token, bg, min] of CASES) {
  test(`AA contrast: ${label}`, () => {
    assert.ok(TOK[token], `${token} must be defined in the light block`);
    const ratio = contrast(toRgb(TOK[token], bg), bg);
    assert.ok(ratio >= min,
      `${label}: ${ratio.toFixed(2)}:1 — below the required ${min}:1 (token ${token} = ${TOK[token]})`);
  });
}

test('AA contrast: selected dropdown option', () => {
  const bg = toRgb(TOK['--field-selected-bg']);
  const ratio = contrast(toRgb(TOK['--field-selected-text'], bg), bg);
  assert.ok(ratio >= 4.5, `selected option text is ${ratio.toFixed(2)}:1`);
});

test('opaque surfaces are genuinely opaque, never rgba', () => {
  for (const token of ['--field-bg', '--field-bg-subtle', '--field-bg-hover', '--menu-bg', '--bg-base', '--bg-elevated']) {
    assert.ok(TOK[token], `${token} must exist`);
    assert.ok(!/rgba?\(/.test(TOK[token]),
      `${token} must be an opaque colour (a translucent dropdown shows the page through it), got ${TOK[token]}`);
  }
});

/* ---- Badge readability -------------------------------------------------
   Semantic ink is drawn on TINTED washes (e.g. bg-aurora-mint/12) over the
   card, not on the card directly. These composite the v4 accent palette at
   the wash opacities actually used in views and assert the ink still clears
   4.5:1 there — not just on plain white. */
const AURORA = { violet: '#4F46E5', cyan: '#0284C7', mint: '#059669', amber: '#D97706', rose: '#F43F5E' };
const overCard = (hex, alpha) => {
  const t = toRgb(hex);
  return [0, 1, 2].map((i) => Math.round(t[i] * alpha + ELEVATED[i] * (1 - alpha)));
};

const BADGES = [
  ['violet badge', '--brand-text', overCard(AURORA.violet, 0.14)],
  ['cyan badge',   '--info',       overCard(AURORA.cyan, 0.12)],
  ['mint badge',   '--ok',         overCard(AURORA.mint, 0.12)],
  ['amber badge',  '--warn',       overCard(AURORA.amber, 0.14)],
  ['rose badge',   '--danger',     overCard(AURORA.rose, 0.12)],
];
for (const [label, token, bg] of BADGES) {
  test(`AA contrast: ${label} text on its own tint`, () => {
    const ratio = contrast(toRgb(TOK[token], bg), bg);
    assert.ok(ratio >= 4.5, `${label}: ${ratio.toFixed(2)}:1 (token ${token} = ${TOK[token]})`);
  });
}

test('no pale dark-mode ink literals survive in app UI', () => {
  const SKIP = ['resumeRenderer', 'resumeTemplates', 'resumeTemplateRegistry', 'ResumeTemplates', 'resumeFixtures'];
  const PALE = /\btext-\[#(?:BDF5DC|F3E3B2|E4DCFF|C9B8FF|C3F0FA|B9EFFA|C6ECF7|EAC97C)\]|\btext-(?:rose|amber|emerald|cyan|violet)-[23]00\b/i;
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.jsx?$/.test(e.name) || SKIP.some((s) => p.includes(s))) continue;
      const m = fs.readFileSync(p, 'utf8').match(new RegExp(PALE, 'gi'));
      if (m) offenders.push(`${p.replace(ROOT + '/', '')}: ${[...new Set(m)].join(', ')}`);
    }
  };
  walk(path.join(ROOT, 'web/src'));
  assert.deepEqual(offenders, [], `pale dark-mode inks remain:\n${offenders.join('\n')}`);
});
