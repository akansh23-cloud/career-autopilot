/* ============================================================
   TEMPLATE OS — THUMBNAILS
   ------------------------------------------------------------
   A gallery must not render 34 live resumes. These are deterministic
   SVG wireframes derived from the compiled layout tree: real column
   geometry, real section order, real header treatment, real accent —
   generated in microseconds, cacheable, and never stale relative to
   the definition because they come FROM the definition.
   ============================================================ */
import { compileTemplate } from './compiler.js';

export const THUMBNAIL_VERSION = 'template-thumbnail-v1';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* how many "text lines" a section is worth in the wireframe */
const SECTION_WEIGHT = { summary: 2, skills: 3, experience: 7, projects: 4, education: 2, certifications: 2, achievements: 2 };

const cache = new Map();

export function buildTemplateThumbnail(def, { width = 168, height = 238, cacheKey = null } = {}) {
  const key = cacheKey || `${def?.id}:${def?.version}:${width}x${height}`;
  if (cache.has(key)) return cache.get(key);

  const compiled = compileTemplate(def);
  if (!compiled.ok) return '';
  const { tree, tokens } = compiled;
  const accent = tokens.colors.accent;
  const rule = tokens.colors.rule;
  const side = tokens.colors.sidebarBg;
  const ink = '#9aa4b2';

  const pad = Math.round(width * (tokens.spacing.marginMm / 100));
  const innerW = width - pad * 2;
  const lineGap = tokens.spacing.preset === 'compact' ? 4.6 : tokens.spacing.preset === 'spacious' ? 6.4 : 5.5;
  const parts = [];
  const rect = (x, y, w, h, fill, r = 1) => parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${h.toFixed(1)}" rx="${r}" fill="${fill}"/>`);

  /* page */
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" rx="3" fill="#ffffff" stroke="${rule}" stroke-width="0.8"/>`);

  /* header */
  const h = tokens.header;
  let y = pad;
  if (h.band) { rect(0, 0, width, 26, side, 0); y = 7; }
  const nameW = innerW * (h.align === 'center' ? 0.46 : 0.4);
  const nameX = h.align === 'center' ? (width - nameW) / 2 : pad;
  rect(nameX, y, nameW, 5.4, accent, 1.2);
  y += 8;
  const subW = innerW * (h.align === 'center' ? 0.34 : 0.28);
  rect(h.align === 'center' ? (width - subW) / 2 : pad, y, subW, 2.6, ink, 1);
  y += 5;
  if (h.contactLayout === 'grid') {
    for (let i = 0; i < 3; i += 1) rect(pad + i * (innerW / 3), y, innerW / 3 - 4, 2, ink, 0.8);
    y += 4.5;
  } else if (h.contactLayout === 'stacked') {
    for (let i = 0; i < 2; i += 1) { rect(pad, y, innerW * 0.3, 2, ink, 0.8); y += 3.4; }
  } else {
    const cw = innerW * 0.62;
    rect(h.align === 'center' ? (width - cw) / 2 : pad, y, cw, 2, ink, 0.8);
    y += 4.5;
  }
  if (h.rule || tokens.divider.id === 'accent-rule') { rect(pad, y, innerW, 0.9, accent, 0); y += 4; }
  y += 3;

  /* columns */
  const isMulti = tree.layoutType !== 'single-column';
  const gutter = 6;
  const cols = isMulti ? tree.columns : [{ id: 'main', width: 1 }];
  let cx = pad;
  const geom = new Map();
  for (const c of cols) {
    const w = (innerW - (isMulti ? gutter : 0)) * c.width;
    geom.set(c.id, { x: cx, w });
    cx += w + gutter;
  }
  if (isMulti && geom.has('sidebar')) {
    const g = geom.get('sidebar');
    rect(g.x - 2, y - 2, g.w + 4, height - y - pad + 4, side, 2);
  }

  const cursors = new Map(cols.map((c) => [c.id, y]));
  for (const s of tree.sections) {
    const g = geom.get(s.region) || geom.get(cols[0].id);
    let cy = cursors.get(s.region) ?? y;
    if (cy > height - pad - 8) continue;
    /* section heading */
    rect(g.x, cy, Math.min(g.w * 0.55, 34), 2.8, accent, 0.8);
    cy += 4.4;
    if (tokens.divider.id !== 'none') { rect(g.x, cy - 1.2, tokens.divider.id === 'short-rule' ? 12 : g.w, 0.6, tokens.divider.id === 'hairline' ? rule : accent, 0); }
    const weight = SECTION_WEIGHT[s.key] || 2;
    const stack = s.region === 'sidebar' || tokens.skills.mode === 'stack';
    for (let i = 0; i < weight; i += 1) {
      if (cy > height - pad - 3) break;
      const isItemHead = s.key === 'experience' && i % 3 === 0;
      const w = isItemHead ? g.w * 0.7 : g.w * (stack ? 0.72 : [0.98, 0.94, 0.88, 0.99][i % 4]);
      rect(g.x + (isItemHead ? 0 : (s.key === 'experience' || s.key === 'projects' ? 3 : 0)), cy, w, isItemHead ? 2.6 : 2, isItemHead ? '#5b6472' : ink, 0.8);
      cy += lineGap;
    }
    cy += lineGap * 0.6;
    cursors.set(s.region, cy);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(def.name)} layout preview">${parts.join('')}</svg>`;
  cache.set(key, svg);
  return svg;
}

/** data: URI for use in <img src> without inline-SVG sanitization concerns. */
export function thumbnailDataUri(def, opts) {
  const svg = buildTemplateThumbnail(def, opts);
  if (!svg) return '';
  const encoded = typeof btoa === 'function'
    ? btoa(unescape(encodeURIComponent(svg)))
    : Buffer.from(svg, 'utf8').toString('base64');
  return `data:image/svg+xml;base64,${encoded}`;
}

export default { THUMBNAIL_VERSION, buildTemplateThumbnail, thumbnailDataUri };
