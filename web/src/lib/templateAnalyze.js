// Analyse an uploaded resume-template image. Tries the backend vision endpoint
// first; if that's unavailable, runs a deterministic in-browser analysis
// (dominant accent colour + column/banner detection) so the feature still works.

import { api } from './api.js';

const DEFAULT_ORDER = ['summary', 'experience', 'skills', 'education', 'projects', 'certifications'];

export async function analyzeTemplateImage(dataUrl, mime, fileName) {
  // 1) server vision
  try {
    const r = await api.post('/api/templates/analyze-custom-template', { imageBase64: dataUrl, mime });
    if (r && r.ok && r.analysis) {
      return { source: 'ai', analysis: normalize(r.analysis, fileName) };
    }
  } catch { /* fall through */ }
  // 2) deterministic fallback
  const fb = await analyzeInBrowser(dataUrl).catch(() => null);
  return { source: 'fallback', analysis: normalize(fb || {}, fileName, true) };
}

function normalize(a, fileName, fallback) {
  const name = a.templateName || (fileName ? `From: ${fileName}`.slice(0, 40) : 'My Uploaded Template');
  return {
    templateName: name,
    layoutType: a.layoutType || 'single-column',
    pageSize: a.pageSize || 'A4',
    margins: a.margins || { top: 40, right: 44, bottom: 40, left: 44 },
    colorPalette: a.colorPalette || { accent: a.accent || '#334155', headerBg: a.headerBg || '#111827', text: '#1f2937' },
    fontStyle: a.fontStyle || a.fontKind || 'sans',
    headerLayout: a.headerLayout || 'left',
    contactLayout: a.contactLayout || 'inline',
    sectionOrder: Array.isArray(a.sectionOrder) && a.sectionOrder.length ? a.sectionOrder : DEFAULT_ORDER,
    sectionStyles: a.sectionStyles || { titleCase: 'upper', divider: 'bar', accentTitles: true },
    columnLayout: Number(a.columnLayout) === 2 ? 2 : 1,
    bulletStyle: a.bulletStyle || 'disc',
    dividerStyle: a.dividerStyle || 'bar',
    spacingRules: a.spacingRules || 'normal',
    atsScoreEstimate: Number(a.atsScoreEstimate) || (Number(a.columnLayout) === 2 ? 62 : 88),
    recommendations: a.recommendations || (fallback ? ['Matched using fallback mode — re-analyse for finer detail.'] : []),
    note: fallback ? 'Template matched using fallback mode.' : (a.recommendations?.[0] || 'Template analysed.'),
  };
}

/* deterministic pixel analysis */
function analyzeInBrowser(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try { resolve(scan(img)); } catch (e) { reject(e); }
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function scan(img) {
  const W = 160; // downscale for speed
  const H = Math.max(40, Math.round((img.height / img.width) * W));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);

  const colorCount = new Map();
  let leftInk = 0, rightInk = 0, topColored = 0, leftColored = 0;
  const topBand = Math.round(H * 0.16);
  const leftBand = Math.round(W * 0.34);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max - min;
      const lum = (r + g + b) / 3;
      const isInk = lum < 150;
      if (x < leftBand) { if (isInk) leftInk++; if (lum < 235 && lum > 18) leftColored++; }
      else if (isInk) rightInk++;
      if (y < topBand && lum < 235 && sat > 18) topColored++;
      // accent candidate: saturated, mid luminance
      if (sat > 60 && lum > 40 && lum < 220) {
        const key = `${Math.round(r / 24)},${Math.round(g / 24)},${Math.round(b / 24)}`;
        const e = colorCount.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        e.n++; e.r += r; e.g += g; e.b += b; colorCount.set(key, e);
      }
    }
  }

  // dominant accent
  let best = null;
  for (const e of colorCount.values()) if (!best || e.n > best.n) best = e;
  const accent = best ? rgbToHex(best.r / best.n, best.g / best.n, best.b / best.n) : '#334155';

  // column detection: a distinct, heavily-filled left band suggests a sidebar
  const leftArea = leftBand * H;
  const leftFillRatio = leftColored / leftArea;
  const twoCol = leftFillRatio > 0.45 && (leftInk / Math.max(1, rightInk)) > 0.4;
  // banner: heavily coloured top strip
  const banner = topColored / (W * topBand) > 0.4;

  return {
    layoutType: twoCol ? 'sidebar-left' : banner ? 'banner-header' : 'single-column',
    columnLayout: twoCol ? 2 : 1,
    headerLayout: banner ? 'banner' : 'left',
    colorPalette: { accent, headerBg: banner ? accent : '#111827', text: '#1f2937' },
    fontStyle: 'sans',
    atsScoreEstimate: twoCol ? 60 : banner ? 80 : 88,
  };
}

function rgbToHex(r, g, b) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
