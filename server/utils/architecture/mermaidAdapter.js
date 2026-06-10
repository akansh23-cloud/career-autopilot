/* ============================================================
   MERMAID + SVG ADAPTERS  (backward compatibility + export)
   ------------------------------------------------------------
   - viewToMermaid: converts an architectureSpec view to the simple
     `graph TD` Mermaid subset the in-app legacy renderer supports
     (Id["label"], Id[("db")], Id(("ext")), edges via -->).
   - specToLegacyMermaid: maps spec views onto the old
     {component, dataFlow, deployment, security} keys so every
     existing UI section keeps working unchanged.
   - viewToSvg: deterministic server-side SVG export (real layout,
     grouped boundaries, labels). No browser or external lib needed.
   ============================================================ */

const esc = (s = '') => String(s).replace(/"/g, "'").replace(/[[\]()]/g, '').slice(0, 60);
const mid = (id) => String(id || '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);

/* ---- Mermaid ---- */
export function viewToMermaid(view = {}) {
  const nodes = Array.isArray(view.nodes) ? view.nodes : [];
  const edges = Array.isArray(view.edges) ? view.edges : [];
  const L = ['graph TD'];
  for (const n of nodes.slice(0, 60)) {
    const label = esc(n.label || n.id);
    if (n.type === 'datastore' || n.type === 'queue') L.push(`  ${mid(n.id)}[("${label}")]`);
    else if (n.type === 'external' || n.type === 'actor') L.push(`  ${mid(n.id)}(("${label}"))`);
    else L.push(`  ${mid(n.id)}["${label}"]`);
  }
  for (const e of edges.slice(0, 120)) {
    if (!e?.from || !e?.to) continue;
    const lbl = esc(e.label || '');
    L.push(lbl ? `  ${mid(e.from)} -->|${lbl}| ${mid(e.to)}` : `  ${mid(e.from)} --> ${mid(e.to)}`);
  }
  return L.join('\n');
}

/* Legacy keys expected by old UI sections. */
const LEGACY_MAP = { component: 'container', dataFlow: 'dataFlow', deployment: 'deployment', security: 'security' };

export function specToLegacyMermaid(spec = {}) {
  const views = Array.isArray(spec.views) ? spec.views : [];
  const byType = Object.fromEntries(views.map((v) => [v.type, v]));
  const out = {};
  for (const [legacyKey, viewType] of Object.entries(LEGACY_MAP)) {
    const v = byType[viewType] || byType.container || views[0];
    if (v) out[legacyKey] = viewToMermaid(v);
  }
  return out;
}

/* All views as mermaid, keyed by view type (new UI + export). */
export function specToMermaidViews(spec = {}) {
  const out = {};
  for (const v of spec.views || []) out[v.type] = viewToMermaid(v);
  return { ...out, ...specToLegacyMermaid(spec) };
}

/* ---- SVG export (deterministic layered layout) ---- */
const SVG_THEME = {
  bg: '#0b1020', groupFill: 'rgba(255,255,255,0.03)', groupStroke: 'rgba(148,163,184,0.35)',
  nodeFill: 'rgba(255,255,255,0.05)', text: '#e2e8f0', subtext: '#94a3b8', edge: 'rgba(148,163,184,0.6)',
  typeColor: {
    actor: '#f59e0b', external: '#f59e0b', service: '#38bdf8', datastore: '#34d399',
    queue: '#a78bfa', pipeline: '#a78bfa', security: '#fb7185', monitor: '#22d3ee',
  },
};

const xmlEsc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Deterministic layout shared with the client renderer
   (web/src/lib/architectureSpec.js holds the same pure algorithm — the repo
   pattern is to keep server/client copies of pure generators in sync).
   horizontal = industry-style left→right flow; vertical = nested bands. */
export function layoutView(view = {}, opts = {}) {
  const nodes = Array.isArray(view.nodes) ? view.nodes.slice(0, 60) : [];
  const groups = Array.isArray(view.groups) ? view.groups : [];
  const NODE_W = opts.nodeW || 172;
  const NODE_H = opts.nodeH || 56;
  const GAP_X = 26, GAP_Y = 34, PAD = 16, GROUP_PAD = 34;
  const MAX_PER_ROW = opts.maxPerRow || 4;
  const orientation = opts.orientation || (view.layout === 'nested' ? 'vertical' : 'horizontal');

  const topGroups = groups.filter((g) => !g.parentId).sort((a, b) => (a.order || 0) - (b.order || 0));
  const childOf = (pid) => groups.filter((g) => g.parentId === pid).sort((a, b) => (a.order || 0) - (b.order || 0));
  const nodesIn = (gid) => nodes.filter((n) => n.group === gid);
  const groupIds = new Set(groups.map((g) => g.id));
  const ungrouped = nodes.filter((n) => !n.group || !groupIds.has(n.group));
  const hasDeepContent = (g) => nodesIn(g.id).length > 0 || childOf(g.id).some(hasDeepContent);

  const placed = {};
  const groupRects = [];

  if (orientation === 'horizontal') {
    const HGAP = 64, HEADER = 26, VPAD = 14;
    const columns = [];
    for (const n of ungrouped) columns.push({ group: null, nodes: [n] });
    for (const g of topGroups) {
      if (!hasDeepContent(g)) continue;
      const all = [...nodesIn(g.id)];
      const deep = (gg) => { for (const c of childOf(gg.id)) { all.push(...nodesIn(c.id)); deep(c); } };
      deep(g);
      if (all.length) columns.push({ group: g, nodes: all });
    }
    if (!columns.length) return { placed, groupRects, width: 360, height: 160, NODE_W, NODE_H, orientation };

    let x = PAD;
    let maxBottom = 0;
    const colMeta = [];
    for (const col of columns) {
      const stacks = col.nodes.length > 5 ? 2 : 1;
      const perStack = Math.ceil(col.nodes.length / stacks);
      const innerW = stacks * NODE_W + (stacks - 1) * GAP_X;
      const innerH = perStack * NODE_H + (perStack - 1) * GAP_Y;
      const pad = col.group ? GROUP_PAD / 2 : 0;
      const header = col.group ? HEADER : 0;
      colMeta.push({ col, x, stacks, perStack, innerW, innerH, pad, header, w: innerW + pad * 2, h: innerH + pad * 2 + header });
      maxBottom = Math.max(maxBottom, innerH + pad * 2 + header);
      x += innerW + pad * 2 + HGAP;
    }
    const width = x - HGAP + PAD;
    const height = Math.max(maxBottom + PAD * 2 + VPAD, 180);
    for (const m of colMeta) {
      const top = (height - m.h) / 2;
      if (m.col.group) groupRects.push({ id: m.col.group.id, label: m.col.group.label, type: m.col.group.type, x: m.x, y: top, w: m.w, h: m.h, depth: 0 });
      m.col.nodes.forEach((n, i) => {
        const st = Math.floor(i / m.perStack), r = i % m.perStack;
        const inStack = Math.min(m.perStack, m.col.nodes.length - st * m.perStack);
        const stackH = inStack * NODE_H + (inStack - 1) * GAP_Y;
        const yOffset = (m.innerH - stackH) / 2;
        placed[n.id] = { x: m.x + m.pad + st * (NODE_W + GAP_X), y: top + m.header + m.pad + yOffset + r * (NODE_H + GAP_Y), w: NODE_W, h: NODE_H };
      });
    }
    return { placed, groupRects, width, height, NODE_W, NODE_H, orientation };
  }

  let cursorY = PAD;
  const width = PAD * 2 + MAX_PER_ROW * NODE_W + (MAX_PER_ROW - 1) * GAP_X + GROUP_PAD * 2;
  const placeRow = (rowNodes, x0, y0, maxW) => {
    const perRow = Math.max(1, Math.min(MAX_PER_ROW, Math.floor((maxW + GAP_X) / (NODE_W + GAP_X))));
    let h = 0;
    rowNodes.forEach((n, i) => {
      const r = Math.floor(i / perRow), c = i % perRow;
      const rowCount = Math.min(perRow, rowNodes.length - r * perRow);
      const rowW = rowCount * NODE_W + (rowCount - 1) * GAP_X;
      const px = x0 + (maxW - rowW) / 2 + c * (NODE_W + GAP_X);
      const py = y0 + r * (NODE_H + GAP_Y);
      placed[n.id] = { x: px, y: py, w: NODE_W, h: NODE_H };
      h = Math.max(h, (r + 1) * (NODE_H + GAP_Y) - GAP_Y);
    });
    return h;
  };
  const layoutGroup = (g, x0, y0, maxW, depth) => {
    let y = y0 + GROUP_PAD;
    const own = nodesIn(g.id);
    if (own.length) y += placeRow(own, x0 + GROUP_PAD / 2, y, maxW - GROUP_PAD) + GAP_Y;
    for (const child of childOf(g.id)) {
      if (!hasDeepContent(child)) continue;
      y += layoutGroup(child, x0 + GROUP_PAD / 2, y, maxW - GROUP_PAD, depth + 1) + GAP_Y;
    }
    const h = Math.max(y - y0 - GAP_Y, GROUP_PAD * 2) + GROUP_PAD / 2;
    groupRects.push({ id: g.id, label: g.label, type: g.type, x: x0, y: y0, w: maxW, h, depth });
    return h;
  };
  if (ungrouped.length) cursorY += placeRow(ungrouped, PAD, cursorY, width - PAD * 2) + GAP_Y;
  for (const g of topGroups) {
    if (!hasDeepContent(g)) continue;
    cursorY += layoutGroup(g, PAD, cursorY, width - PAD * 2, 0) + GAP_Y;
  }
  const height = Math.max(cursorY + PAD, 160);
  groupRects.sort((a, b) => a.depth - b.depth);
  return { placed, groupRects, width, height, NODE_W, NODE_H, orientation };
}

export function viewToSvg(view = {}, { title = '' } = {}) {
  const { placed, groupRects, width, height, orientation } = layoutView(view);
  const nodes = (view.nodes || []).filter((n) => placed[n.id]);
  const edges = (view.edges || []).filter((e) => placed[e.from] && placed[e.to]);
  const isStacked = (n) => !!(n?.metadata?.stacked || /\u00d7N/i.test(String(n?.label || '')) || n?.capability === 'worker');
  const isCylinder = (n) => n?.type === 'datastore' || n?.type === 'queue';

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + 30}" font-family="Inter,Segoe UI,Arial,sans-serif">`);
  parts.push(`<rect width="100%" height="100%" fill="${SVG_THEME.bg}"/>`);
  parts.push('<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="rgba(148,163,184,0.8)"/></marker></defs>');
  if (title) parts.push(`<text x="${width / 2}" y="20" text-anchor="middle" font-size="13" fill="${SVG_THEME.text}" font-weight="600">${xmlEsc(title)}</text>`);
  const yOff = 30;

  for (const g of groupRects) {
    const dash = g.type === 'boundary' || g.type === 'vpc' || g.type === 'subnet' || g.type === 'region' ? ' stroke-dasharray="6 4"' : '';
    parts.push(`<rect x="${g.x}" y="${g.y + yOff}" width="${g.w}" height="${g.h}" rx="12" fill="${SVG_THEME.groupFill}" stroke="${SVG_THEME.groupStroke}"${dash}/>`);
    parts.push(`<text x="${g.x + 12}" y="${g.y + yOff + 17}" font-size="9.5" letter-spacing="1.5" fill="${SVG_THEME.subtext}">${xmlEsc(String(g.label || '').toUpperCase())}</text>`);
  }

  /* Edge path mirroring the client renderer (left→right anchors; loops for feedback). */
  const edgePath = (a, b) => {
    if (orientation === 'horizontal') {
      const aR = { x: a.x + a.w, y: a.y + a.h / 2 + yOff };
      const bL = { x: b.x, y: b.y + b.h / 2 + yOff };
      if (bL.x >= aR.x - 4) {
        const mx = (aR.x + bL.x) / 2;
        return { d: `M${aR.x},${aR.y} C${mx},${aR.y} ${mx},${bL.y} ${bL.x},${bL.y}`, lx: mx, ly: (aR.y + bL.y) / 2 - 7 };
      }
      const sameCol = Math.abs(a.x - b.x) < a.w;
      if (sameCol) {
        const down = b.y > a.y;
        const y1 = (down ? a.y + a.h : a.y) + yOff;
        const y2 = (down ? b.y : b.y + b.h) + yOff;
        const my = (y1 + y2) / 2;
        return { d: `M${a.x + a.w / 2},${y1} C${a.x + a.w / 2},${my} ${b.x + b.w / 2},${my} ${b.x + b.w / 2},${y2}`, lx: (a.x + b.x + a.w) / 2 + 8, ly: my };
      }
      const drop = Math.max(a.y + a.h, b.y + b.h) + yOff + 26;
      const aB = { x: a.x + a.w / 2, y: a.y + a.h + yOff };
      const bB = { x: b.x + b.w / 2, y: b.y + b.h + yOff };
      return { d: `M${aB.x},${aB.y} C${aB.x},${drop} ${bB.x},${drop} ${bB.x},${bB.y}`, lx: (aB.x + bB.x) / 2, ly: drop - 6 };
    }
    const x1 = a.x + a.w / 2, y1 = a.y + a.h + yOff, x2 = b.x + b.w / 2;
    const down = b.y + yOff >= y1;
    const sy = down ? y1 : a.y + yOff;
    const ey = (down ? b.y : b.y + b.h) + yOff;
    const my = (sy + ey) / 2;
    return { d: `M${x1},${sy} C${x1},${my} ${x2},${my} ${x2},${ey}`, lx: (x1 + x2) / 2, ly: my };
  };

  for (const e of edges) {
    const { d, lx, ly } = edgePath(placed[e.from], placed[e.to]);
    const dash = e.async ? ' stroke-dasharray="5 4"' : '';
    parts.push(`<path d="${d}" fill="none" stroke="${SVG_THEME.edge}" stroke-width="1.4"${dash} marker-end="url(#arr)"/>`);
    if (e.label) {
      const lbl = String(e.label).slice(0, 34);
      parts.push(`<rect x="${lx - lbl.length * 2.6 - 4}" y="${ly - 8}" width="${lbl.length * 5.2 + 8}" height="14" rx="4" fill="rgba(11,16,32,0.88)"/>`);
      parts.push(`<text x="${lx}" y="${ly + 3}" text-anchor="middle" font-size="9" fill="${SVG_THEME.subtext}">${xmlEsc(lbl)}</text>`);
    }
  }

  for (const n of nodes) {
    const p = placed[n.id];
    const c = SVG_THEME.typeColor[n.type] || SVG_THEME.typeColor.service;
    const label = String(n.label || n.id);
    const l1 = label.length > 21 ? label.slice(0, 20) + '\u2026' : label;
    const tech = (n.technologies || []).slice(0, 3).join(' \u00b7 ').slice(0, 28);
    if (isCylinder(n)) {
      const ry = 9;
      parts.push(`<g transform="translate(${p.x},${p.y + yOff})">`);
      parts.push(`<path d="M0,${ry} A${p.w / 2},${ry} 0 0 1 ${p.w},${ry} L${p.w},${p.h - ry} A${p.w / 2},${ry} 0 0 1 0,${p.h - ry} Z" fill="${SVG_THEME.nodeFill}" stroke="${c}" stroke-width="1.4"/>`);
      parts.push(`<ellipse cx="${p.w / 2}" cy="${ry}" rx="${p.w / 2}" ry="${ry}" fill="rgba(255,255,255,0.06)" stroke="${c}" stroke-width="1.4"/>`);
      parts.push(`<text x="${p.w / 2}" y="${tech ? p.h / 2 + 2 : p.h / 2 + 7}" text-anchor="middle" font-size="11.5" fill="${SVG_THEME.text}" font-weight="500">${xmlEsc(l1)}</text>`);
      if (tech) parts.push(`<text x="${p.w / 2}" y="${p.h / 2 + 15}" text-anchor="middle" font-size="8.5" fill="${SVG_THEME.subtext}">${xmlEsc(tech)}</text>`);
      parts.push('</g>');
      continue;
    }
    const rx = n.type === 'actor' || n.type === 'external' ? p.h / 2 : 8;
    parts.push(`<g transform="translate(${p.x},${p.y + yOff})">`);
    if (isStacked(n)) {
      parts.push(`<rect x="8" y="-8" width="${p.w}" height="${p.h}" rx="${rx}" fill="rgba(255,255,255,0.02)" stroke="${c}" stroke-opacity="0.35" stroke-width="1.2"/>`);
      parts.push(`<rect x="4" y="-4" width="${p.w}" height="${p.h}" rx="${rx}" fill="rgba(255,255,255,0.03)" stroke="${c}" stroke-opacity="0.55" stroke-width="1.2"/>`);
    }
    parts.push(`<rect width="${p.w}" height="${p.h}" rx="${rx}" fill="${SVG_THEME.nodeFill}" stroke="${c}" stroke-width="1.5"/>`);
    parts.push(`<text x="${p.w / 2}" y="${tech ? p.h / 2 - 1 : p.h / 2 + 4}" text-anchor="middle" font-size="11.5" fill="${SVG_THEME.text}" font-weight="500">${xmlEsc(l1)}</text>`);
    if (tech) parts.push(`<text x="${p.w / 2}" y="${p.h / 2 + 14}" text-anchor="middle" font-size="8.5" fill="${SVG_THEME.subtext}">${xmlEsc(tech)}</text>`);
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('\n');
}

export default { viewToMermaid, specToLegacyMermaid, specToMermaidViews, viewToSvg, layoutView };
