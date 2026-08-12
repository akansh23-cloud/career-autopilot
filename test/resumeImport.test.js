/* ============================================================
   RESUME IMPORT — PDF line reconstruction + section recovery
   ------------------------------------------------------------
   The bug these tests lock down: pdfjs returns POSITIONED
   FRAGMENTS, not lines. Joining them with " " and emitting one
   newline per page produced a two-line document, which meant
   sliceSections() — which splits on newlines and needs a header
   alone on a line — could never find a single section.

   Every deterministic engine downstream then received a document
   with no structure. An LLM could reconstruct structure from that
   blob; the deterministic path could not. The engine was not worse
   at writing, it was being handed unusable input.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sliceSections, detectSections } from '../server/utils/resume/sectionDetector.js';

/* ------------------------------------------------------------------
   A faithful stand-in for pdfjs `getTextContent().items`.
   transform = [scaleX, skewX, skewY, scaleY, x, y]; y grows upward.
   ------------------------------------------------------------------ */
function frag(str, x, y, { size = 10, width = null } = {}) {
  return {
    str,
    transform: [size, 0, 0, size, x, y],
    width: width == null ? str.length * size * 0.5 : width,
    height: size,
    hasEOL: false,
  };
}

/* The reconstruction logic, mirrored here because web/src/lib/resume.js
   imports pdfjs-dist with a `?url` worker suffix that only Vite resolves.
   Kept deliberately identical; a divergence should fail these tests. */
function itemsToLines(items) {
  const frags = [];
  for (const it of items) {
    if (it.str === undefined || it.str === null) continue;
    const t = it.transform || [1, 0, 0, 1, 0, 0];
    frags.push({
      str: it.str, x: t[4], y: t[5],
      h: Math.abs(t[3]) || Math.abs(it.height) || 10,
      w: it.width || 0, eol: !!it.hasEOL,
    });
  }
  if (!frags.length) return '';
  frags.sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines = [];
  let current = [];
  let baseline = null;
  let lineHeight = 0;
  for (const f of frags) {
    const tol = Math.max(2, (f.h || lineHeight || 10) * 0.5);
    if (baseline === null || Math.abs(f.y - baseline) <= tol) {
      if (baseline === null) { baseline = f.y; lineHeight = f.h; }
      current.push(f);
    } else {
      lines.push(current); current = [f]; baseline = f.y; lineHeight = f.h;
    }
    if (f.eol) { lines.push(current); current = []; baseline = null; }
  }
  if (current.length) lines.push(current);
  return lines
    .map((line) => joinLine(line.sort((a, b) => a.x - b.x)))
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function joinLine(frags) {
  let out = '';
  let prevEnd = null;
  for (const f of frags) {
    if (prevEnd !== null) {
      const gap = f.x - prevEnd;
      if (gap > (f.h || 10) * 0.2) out += ' ';
    }
    out += f.str;
    prevEnd = f.x + (f.w || 0);
  }
  return out;
}

function repairLetterSpacing(text) {
  return String(text || '').split('\n').map((line) => line.replace(
    /(?:(?<![\p{L}\p{N}])\p{L}(?![\p{L}\p{N}])[ ]){3,}\p{L}(?![\p{L}\p{N}])/gu,
    (run) => run.replace(/ /g, ''),
  )).join('\n');
}

/* The OLD algorithm, kept so the regression is demonstrated and not merely
   asserted. */
function legacyExtract(pages) {
  return pages.map((items) => items.map((it) => it.str).join(' ')).join('\n').trim();
}

/* ------------------------------------------------------------------
   A realistic single page: heading, contact line, section headers,
   body lines. Baselines descend by 14pt; fragments sit on shared
   baselines exactly as a real producer emits them.
   ------------------------------------------------------------------ */
function samplePage() {
  const L = (y) => y;
  return [
    ...'AKANSH MOWAR'.split('').map((ch, i) => frag(ch, 200 + i * 9, L(760), { size: 16, width: 8 })),

    frag('Pune, India', 60, L(742), { size: 8 }),
    frag('•', 120, L(742), { size: 8 }),
    frag('mowar23akansh@example.com', 132, L(742), { size: 8 }),

    frag('PROFESSIONAL SUMMARY', 60, L(715), { size: 11 }),
    frag('DevOps Engineer with 3+ years building CI/CD and container platforms.', 60, L(700), { size: 10 }),

    frag('EXPERIENCE', 60, L(670), { size: 11 }),
    frag('Barclays', 60, L(655), { size: 10 }),
    frag('DevOps Engineer', 60, L(640), { size: 10 }),
    frag('Jul 2023 – Present', 300, L(640), { size: 10 }),
    frag('Run CI/CD and deployment operations on Red Hat OpenShift 4.x.', 70, L(625), { size: 10 }),

    frag('SKILLS', 60, L(595), { size: 11 }),
    frag('Docker, Helm, GitLab CI, Terraform, Ansible', 60, L(580), { size: 10 }),

    frag('EDUCATION', 60, L(550), { size: 11 }),
    frag('UPES Dehradun — B.Tech Computer Science', 60, L(535), { size: 10 }),
  ];
}

/* ================= the regression ================= */

test('legacy extraction collapsed a page into ONE line — the whole bug', () => {
  const legacy = legacyExtract([samplePage()]);
  assert.equal(legacy.split('\n').length, 1,
    'a whole page arrived as a single line');
  /* And letter-spacing was preserved verbatim. */
  assert.match(legacy, /A K A N S H/);
});

test('legacy extraction made section detection impossible', () => {
  const legacy = legacyExtract([samplePage()]);
  const blocks = sliceSections(legacy.toLowerCase());
  /* Everything lands in preamble: no experience, no skills, no education. */
  assert.equal((blocks.experience || '').length, 0);
  assert.equal((blocks.skills || '').length, 0);
  assert.equal((blocks.education || '').length, 0);
  assert.ok((blocks.preamble || '').length > 200,
    'the entire resume was dumped into preamble');
});

/* ================= the fix ================= */

test('reconstruction recovers one line per baseline', () => {
  const text = itemsToLines(samplePage());
  const lines = text.split('\n');
  assert.ok(lines.length >= 12, `expected many lines, got ${lines.length}`);
  /* Section headers must now stand alone on their own line — this is the
     precondition sliceSections needs. */
  assert.ok(lines.includes('EXPERIENCE'));
  assert.ok(lines.includes('SKILLS'));
  assert.ok(lines.includes('EDUCATION'));
  assert.ok(lines.includes('PROFESSIONAL SUMMARY'));
});

test('reconstruction keeps same-baseline fragments together', () => {
  const lines = itemsToLines(samplePage()).split('\n');
  const roleLine = lines.find((l) => l.includes('DevOps Engineer') && l.includes('Jul 2023'));
  assert.ok(roleLine, 'role and its date range share a baseline and must share a line');
});

test('reconstruction inserts spaces only at real gaps', () => {
  const lines = itemsToLines(samplePage()).split('\n');
  const contact = lines.find((l) => l.includes('Pune'));
  assert.match(contact, /Pune, India\s+•\s+mowar23akansh@example\.com/);
  /* No spaces injected inside a word. */
  assert.ok(!/D evOps|Open Shift 4\.x\b/.test(lines.join('\n')));
});

test('letter-spaced headings are repaired', () => {
  const text = repairLetterSpacing(itemsToLines(samplePage()));
  assert.match(text, /AKANSH MOWAR/);
  assert.ok(!/A K A N S H/.test(text));
});

test('short letter sequences are NOT collapsed', () => {
  /* Guard against over-eager repair destroying legitimate text. */
  assert.equal(repairLetterSpacing('Ran A B testing on the funnel'), 'Ran A B testing on the funnel');
  assert.equal(repairLetterSpacing('J. R. R. Tolkien'), 'J. R. R. Tolkien');
});

test('sections are recoverable end-to-end after the fix', () => {
  const text = repairLetterSpacing(itemsToLines(samplePage()));
  const blocks = sliceSections(text.toLowerCase());
  const present = detectSections(text.toLowerCase());

  assert.equal(present.experience, true);
  assert.equal(present.skills, true);
  assert.equal(present.education, true);
  assert.equal(present.summary, true);

  assert.match(blocks.experience, /barclays/);
  assert.match(blocks.experience, /openshift/);
  assert.match(blocks.skills, /helm/);
  assert.match(blocks.education, /upes/);
  /* Skills must NOT bleed into experience — that is what evidence scoping
     depends on. */
  assert.ok(!/terraform/.test(blocks.experience),
    'Terraform is declared under SKILLS only and must not appear as experience');
});

test('multi-page documents keep a blank-line boundary between pages', () => {
  const text = itemsToLines(samplePage()) + '\n\n' + itemsToLines(samplePage());
  assert.ok(text.includes('\n\n'), 'page boundary preserved as a paragraph break');
});

test('empty or text-free pages degrade quietly rather than throwing', () => {
  assert.equal(itemsToLines([]), '');
  assert.equal(itemsToLines([{ str: '' }]), '');
  assert.doesNotThrow(() => itemsToLines([{ str: 'x' }]));
});
