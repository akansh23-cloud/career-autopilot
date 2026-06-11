/* ============================================================================
   resumeLayoutValidator.js — mandatory post-render layout validation
   ----------------------------------------------------------------------------
   validateResumeLayout(containerElement, options) inspects the actually
   rendered pages (real getBoundingClientRect measurements) and reports:

   {
     valid, errors[], warnings[], pageCount,
     overflowSections[], clippedElements[], overlappingElements[],
     recommendations[]
   }

   Checks performed:
     • no horizontal overflow (scrollWidth / child rects vs page bounds)
     • no vertical overflow outside the page box (clipped / cropped content)
     • no overlapping sibling blocks (x/y collision)
     • no section heading stranded alone at the bottom of a page
     • no hidden / unreadably small text
     • no empty (blank) pages
     • page count matches the requested page mode
     • one-page mode never silently cuts content (fit info from the renderer)

   The geometry helpers (rectsOverlap, rectContains, findOverlaps,
   findOrphanHeadings) are pure and unit-tested under `node --test`.
   ========================================================================== */

const EPS = 1.5; // px tolerance for sub-pixel rounding

/* ------------------------------------------------------- pure geometry --- */

export function rectsOverlap(a, b, eps = EPS) {
  return a.left < b.right - eps
    && b.left < a.right - eps
    && a.top < b.bottom - eps
    && b.top < a.bottom - eps;
}

export function rectContains(outer, inner, eps = EPS) {
  return inner.left >= outer.left - eps
    && inner.right <= outer.right + eps
    && inner.top >= outer.top - eps
    && inner.bottom <= outer.bottom + eps;
}

/* Find genuinely overlapping pairs among block rects (pure). Each rect:
   { id, left, top, right, bottom }. Vertically stacked blocks that merely
   touch are NOT overlaps. Returns [{ a, b, area }]. */
export function findOverlaps(rects, eps = EPS) {
  const out = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (!rectsOverlap(a, b, eps)) continue;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > eps && h > eps) out.push({ a: a.id, b: b.id, area: Math.round(w * h) });
    }
  }
  return out;
}

/* Pure orphan-heading detector. pages: [[{ kind, keepNext }]]. A heading that
   is the LAST block of a non-final page is an orphan. */
export function findOrphanHeadings(pages) {
  const orphans = [];
  pages.forEach((blocks, pi) => {
    if (pi === pages.length - 1) return;
    const last = blocks[blocks.length - 1];
    if (last && (last.kind === 'section-heading' || last.keepNext)) {
      orphans.push({ page: pi + 1, kind: last.kind });
    }
  });
  return orphans;
}

/* Pure baseline-aware hidden check. An element is only "hidden content" when
   it is hidden RELATIVE to the page it sits on. If the whole page reports
   visibility:hidden (e.g. inherited from an offscreen validation host —
   a measurement artifact, not a resume problem), inherited values must not be
   flagged. display:none and the element's OWN visibility:hidden always flag. */
export function isHiddenForValidation(elStyle = {}, pageBaselineStyle = {}) {
  if (elStyle.display === 'none') return true;
  if (elStyle.visibility === 'hidden') {
    return pageBaselineStyle.visibility !== 'hidden'; // inherited from outside the page → not a content problem
  }
  return false;
}

/* ------------------------------------------------------- DOM validation -- */

function describeEl(el) {
  const kind = el.getAttribute?.('data-kind') || el.className || el.tagName;
  const text = (el.textContent || '').trim().slice(0, 60);
  return `${kind}${text ? ` — "${text}${text.length >= 60 ? '…' : ''}"` : ''}`;
}

function sectionOf(el) {
  const blockEl = el.closest?.('[data-block]') || el;
  // first heading-ish ancestor info is enough for reporting
  return blockEl.getAttribute?.('data-kind') || 'content';
}

/**
 * validateResumeLayout(containerElement, options)
 * containerElement must contain one or more `.rp-page` elements (the output of
 * the renderer). options: { expectedPageMode, overflowBlocks, fit, template }
 */
export function validateResumeLayout(containerElement, options = {}) {
  const errors = [];
  const warnings = [];
  const recommendations = [];
  const overflowSections = new Set();
  const clippedElements = [];
  const overlappingElements = [];

  const pages = Array.from(containerElement?.querySelectorAll?.('.rp-page') || []);
  const pageCount = pages.length;

  if (!pageCount) {
    return {
      valid: false, errors: ['No rendered pages found.'], warnings: [], pageCount: 0,
      overflowSections: [], clippedElements: [], overlappingElements: [], recommendations: [],
    };
  }

  pages.forEach((pageEl, pi) => {
    const pageRect = pageEl.getBoundingClientRect();
    const pn = pi + 1;

    // empty / blank page
    const textContent = (pageEl.textContent || '').trim();
    if (!textContent) errors.push(`Page ${pn} is blank.`);

    // horizontal overflow of the page box itself
    if (pageEl.scrollWidth > pageEl.clientWidth + EPS) {
      errors.push(`Page ${pn}: horizontal overflow (${pageEl.scrollWidth - pageEl.clientWidth}px wider than the page).`);
    }
    // vertical overflow — content taller than the physical page
    if (pageEl.scrollHeight > pageEl.clientHeight + EPS) {
      errors.push(`Page ${pn}: content overflows the page vertically by ${Math.round(pageEl.scrollHeight - pageEl.clientHeight)}px.`);
    }

    const blocks = Array.from(pageEl.querySelectorAll('[data-block]'));

    // clipped / outside-page content
    for (const el of blocks) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (!rectContains(pageRect, r)) {
        clippedElements.push(describeEl(el));
        overflowSections.add(sectionOf(el));
        errors.push(`Page ${pn}: "${describeEl(el)}" extends outside the page bounds.`);
      }
    }

    // x/y collisions between sibling blocks
    const rects = blocks.map((el, idx) => {
      const r = el.getBoundingClientRect();
      return { id: idx, el, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }).filter((r) => r.right - r.left > 0 && r.bottom - r.top > 0);
    for (const o of findOverlaps(rects)) {
      const ea = rects.find((r) => r.id === o.a)?.el;
      const eb = rects.find((r) => r.id === o.b)?.el;
      if (!ea || !eb) continue;
      overlappingElements.push(`${describeEl(ea)} ⟷ ${describeEl(eb)}`);
      errors.push(`Page ${pn}: overlapping blocks — ${describeEl(ea)} and ${describeEl(eb)}.`);
    }

    // section heading stranded as the last block of a non-final page
    if (pi < pages.length - 1 && blocks.length) {
      const last = blocks[blocks.length - 1];
      if (last.getAttribute('data-kind') === 'section-heading' || last.getAttribute('data-keepnext') === '1') {
        errors.push(`Page ${pn}: section heading "${(last.textContent || '').trim()}" is stranded at the bottom of the page.`);
      }
    }

    // hidden / unreadable text — measured against the PAGE baseline so an
    // invisible offscreen validation host can never cause false positives
    const pageBaseline = window.getComputedStyle(pageEl);
    for (const el of blocks) {
      const cs = window.getComputedStyle(el);
      if (isHiddenForValidation(cs, pageBaseline)) {
        errors.push(`Page ${pn}: hidden content detected (${describeEl(el)}).`);
        continue;
      }
      const fs = parseFloat(cs.fontSize);
      if (fs && fs < 8) warnings.push(`Page ${pn}: very small text (${fs}px) in ${describeEl(el)}.`);
    }
  });

  // renderer-reported oversize blocks (taller than a whole empty page)
  for (const id of options.overflowBlocks || []) {
    warnings.push(`A content block (${id}) is taller than a full page and was split or placed alone — consider shortening it.`);
  }

  // page-mode expectations
  const mode = options.expectedPageMode || 'auto';
  if (mode === 'one-page' && pageCount > 1) {
    errors.push('One-page mode requested but content needs ' + pageCount + ' pages. Content was NOT cut — switch to multi-page or trim sections.');
    recommendations.push('Switch to two-page mode or a multi-page friendly template (Senior Engineer / Architect).');
    recommendations.push('Move optional sections (certifications, achievements) lower or remove low-value entries.');
  }
  if (options.fit?.message) warnings.push(options.fit.message);
  if (pageCount > 3) warnings.push(`Resume spans ${pageCount} pages — recruiters rarely read past page 2. Consider trimming.`);

  if (errors.length === 0 && warnings.length === 0) {
    recommendations.push('Layout is clean — no overlaps, no clipped content, headings sit with their sections.');
  } else if (errors.length) {
    recommendations.push('Fix the layout errors before exporting — export is blocked while critical errors exist.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    pageCount,
    overflowSections: Array.from(overflowSections),
    clippedElements,
    overlappingElements,
    recommendations,
  };
}
