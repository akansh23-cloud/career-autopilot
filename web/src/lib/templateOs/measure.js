/* ============================================================
   TEMPLATE OS — DOM MEASUREMENT
   ------------------------------------------------------------
   estimateGeometry() guesses from character counts; this measures.
   The compiled layout is mounted off-screen at true page width and
   the browser reports real heights per column and per section, so
   the Studio shows an actual page count and an actual overflow —
   not a projection. Browser-only by nature; callers fall back to
   estimateGeometry() under Node (tests, server render).
   ============================================================ */
import { buildLayoutHTML, layoutCSS, estimateGeometry } from './compiler.js';

export const MEASURE_VERSION = 'layout-measure-v1';

const PAGE_PX = { a4: { w: 794, h: 1123 }, letter: { w: 816, h: 1056 } };
const MM_PX = 3.7795;

export const canMeasure = () => typeof document !== 'undefined' && !!document.body;

/**
 * Mount the compiled layout off-screen and measure it.
 * @returns {{measured:boolean, pageCount:number, overflowPx:number, utilization:number, sections:object[]}}
 */
export function measureLayoutGeometry(compiled, structured, { sizeId = 'a4' } = {}) {
  if (!canMeasure()) return { ...estimateGeometry(compiled, structured, { sizeId }), measured: false };
  const page = PAGE_PX[sizeId] || PAGE_PX.a4;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-14000px;top:0;z-index:-1;opacity:0;pointer-events:none;background:#fff;';
  const style = document.createElement('style');
  style.textContent = layoutCSS(compiled, { sizeId });
  host.appendChild(style);
  const wrap = document.createElement('div');
  wrap.className = 't-page';
  wrap.style.width = `${page.w}px`;
  wrap.innerHTML = buildLayoutHTML(compiled, structured, { sizeId, bare: true });
  host.appendChild(wrap);
  document.body.appendChild(host);

  try {
    const marginPx = Math.max(10, compiled.tokens.spacing.marginMm) * MM_PX;
    const usableH = page.h - marginPx * 2;
    const wrapRect = wrap.getBoundingClientRect();
    const headerEl = wrap.querySelector('.t-header');
    const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0;

    const columns = [...wrap.querySelectorAll('[class*="t-col-"]')];
    const columnHeights = columns.length
      ? columns.map((c) => ({ id: (c.className.match(/t-col-([a-z]+)/) || [])[1] || 'main', height: c.getBoundingClientRect().height }))
      : [{ id: 'main', height: wrapRect.height - headerH }];
    const tallest = Math.max(...columnHeights.map((c) => c.height), 0);
    const contentH = (columns.length ? tallest + headerH : wrapRect.height) - (columns.length ? 0 : 0);

    const sections = [...wrap.querySelectorAll('[data-section]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { key: el.getAttribute('data-section'), top: Math.round(r.top - wrapRect.top), height: Math.round(r.height) };
    });

    /* page 1 loses the header; later pages get the full body box */
    const firstPageBody = usableH - headerH;
    const pageCount = contentH <= usableH ? 1 : 1 + Math.ceil((contentH - headerH - firstPageBody) / usableH);
    const overflowPx = Math.max(0, contentH - usableH);

    /* sections that would straddle a page boundary (orphan risk) */
    const straddling = sections.filter((s) => {
      const start = s.top - headerH;
      const end = start + s.height;
      const boundary = Math.floor(start / firstPageBody);
      return s.height < firstPageBody && boundary !== Math.floor(end / firstPageBody);
    }).map((s) => s.key);

    return {
      version: MEASURE_VERSION,
      measured: true,
      sizeId,
      pageCount: Math.max(1, pageCount),
      contentHeightPx: Math.round(contentH),
      usableHeightPx: Math.round(usableH),
      overflowPx: Math.round(overflowPx),
      overflowLines: Math.round(overflowPx / (compiled.tokens.typography.bodyFontPx * compiled.tokens.typography.lineHeight)),
      utilization: Number((contentH / usableH).toFixed(2)),
      columnHeights: columnHeights.map((c) => ({ ...c, height: Math.round(c.height) })),
      sections,
      straddling,
    };
  } finally {
    try { document.body.removeChild(host); } catch { /* noop */ }
  }
}

export default { MEASURE_VERSION, measureLayoutGeometry, canMeasure };
