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

/* Simple layered layout shared with the export: order groups, place nodes in rows. */
export function layoutView(view = {}) {
  const nodes = Array.isArray(view.nodes) ? view.nodes.slice(0, 60) : [];
  const groups = Array.isArray(view.groups) ? view.groups : [];
  const NODE_W = 168, NODE_H = 52, GAP_X = 28, GAP_Y = 30, PAD = 18, GROUP_PAD = 34;
  const MAX_PER_ROW = 4;

  // Order: top-level groups by order; ungrouped nodes form an implicit first band.
  const topGroups = groups.filter((g) => !g.parentId).sort((a, b) => (a.order || 0) - (b.order || 0));
  const childOf = (pid) => groups.filter((g) => g.parentId === pid).sort((a, b) => (a.order || 0) - (b.order || 0));
  const nodesIn = (gid) => nodes.filter((n) => n.group === gid);
  const groupIds = new Set(groups.map((g) => g.id));
  const ungrouped = nodes.filter((n) => !n.group || !groupIds.has(n.group));

  const placed = {}; // nodeId -> {x,y,w,h}
  const groupRects = []; // {id,label,type,x,y,w,h,depth}
  let cursorY = PAD;
  const width = PAD * 2 + MAX_PER_ROW * NODE_W + (MAX_PER_ROW - 1) * GAP_X + GROUP_PAD * 2;

  const placeRow = (rowNodes, x0, y0, maxW) => {
    const perRow = Math.max(1, Math.min(MAX_PER_ROW, Math.floor((maxW + GAP_X) / (NODE_W + GAP_X))));
    let h = 0;
    rowNodes.forEach((n, i) => {
      const r = Math.floor(i / perRow), c = i % perRow;
      const rowCount = Math.min(perRow, rowNodes.length - r * perRow);
      const rowW = rowCount * NODE_W + (rowCount - 1) * GAP_X;
      const x = x0 + (maxW - rowW) / 2 + c * (NODE_W + GAP_X);
      const y = y0 + r * (NODE_H + GAP_Y);
      placed[n.id] = { x, y, w: NODE_W, h: NODE_H };
      h = Math.max(h, (r + 1) * (NODE_H + GAP_Y) - GAP_Y);
    });
    return h;
  };

  const layoutGroup = (g, x0, y0, maxW, depth) => {
    let y = y0 + GROUP_PAD;
    const own = nodesIn(g.id);
    if (own.length) y += placeRow(own, x0 + GROUP_PAD / 2, y, maxW - GROUP_PAD) + GAP_Y;
    for (const child of childOf(g.id)) y += layoutGroup(child, x0 + GROUP_PAD / 2, y, maxW - GROUP_PAD, depth + 1) + GAP_Y;
    const h = Math.max(y - y0 - GAP_Y, GROUP_PAD * 2) + GROUP_PAD / 2;
    groupRects.push({ id: g.id, label: g.label, type: g.type, x: x0, y: y0, w: maxW, h, depth });
    return h;
  };

  if (ungrouped.length) {
    cursorY += placeRow(ungrouped, PAD, cursorY, width - PAD * 2) + GAP_Y;
  }
  for (const g of topGroups) {
    const hasContent = nodesIn(g.id).length || childOf(g.id).some(function deep(c) { return nodesIn(c.id).length || childOf(c.id).some(deep); });
    if (!hasContent) continue;
    cursorY += layoutGroup(g, PAD, cursorY, width - PAD * 2, 0) + GAP_Y;
  }
  const height = cursorY + PAD;
  groupRects.sort((a, b) => a.depth - b.depth); // parents first
  return { placed, groupRects, width, height, NODE_W, NODE_H };
}

export function viewToSvg(view = {}, { title = '' } = {}) {
  const { placed, groupRects, width, height, NODE_H } = layoutView(view);
  const nodes = (view.nodes || []).filter((n) => placed[n.id]);
  const edges = (view.edges || []).filter((e) => placed[e.from] && placed[e.to]);
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + 30}" font-family="Inter,Segoe UI,Arial,sans-serif">`);
  parts.push(`<rect width="100%" height="100%" fill="${SVG_THEME.bg}"/>`);
  parts.push('<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="rgba(148,163,184,0.8)"/></marker></defs>');
  if (title) parts.push(`<text x="${width / 2}" y="20" text-anchor="middle" font-size="13" fill="${SVG_THEME.text}" font-weight="600">${xmlEsc(title)}</text>`);
  const yOff = 30;
  for (const g of groupRects) {
    const dash = g.type === 'boundary' || g.type === 'vpc' || g.type === 'subnet' ? ' stroke-dasharray="6 4"' : '';
    parts.push(`<rect x="${g.x}" y="${g.y + yOff}" width="${g.w}" height="${g.h}" rx="12" fill="${SVG_THEME.groupFill}" stroke="${SVG_THEME.groupStroke}"${dash}/>`);
    parts.push(`<text x="${g.x + 12}" y="${g.y + yOff + 18}" font-size="10" letter-spacing="1.5" fill="${SVG_THEME.subtext}" text-transform="uppercase">${xmlEsc(String(g.label || '').toUpperCase())}</text>`);
  }
  for (const e of edges) {
    const a = placed[e.from], b = placed[e.to];
    const x1 = a.x + a.w / 2, y1 = a.y + a.h + yOff, x2 = b.x + b.w / 2, y2 = b.y + yOff;
    const my = (y1 + y2) / 2;
    const dash = e.async ? ' stroke-dasharray="5 4"' : '';
    parts.push(`<path d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}" fill="none" stroke="${SVG_THEME.edge}" stroke-width="1.4"${dash} marker-end="url(#arr)"/>`);
    if (e.label) {
      const lx = (x1 + x2) / 2, ly = my + yOff - (y1 + y2) / 2 + (y1 + y2) / 2; // midpoint already includes offset via y1/y2
      parts.push(`<text x="${lx}" y="${my + 3}" text-anchor="middle" font-size="9.5" fill="${SVG_THEME.subtext}">${xmlEsc(String(e.label).slice(0, 36))}</text>`);
    }
  }
  for (const n of nodes) {
    const p = placed[n.id];
    const c = SVG_THEME.typeColor[n.type] || SVG_THEME.typeColor.service;
    const rx = n.type === 'actor' || n.type === 'external' ? NODE_H / 2 : 10;
    parts.push(`<g><rect x="${p.x}" y="${p.y + yOff}" width="${p.w}" height="${p.h}" rx="${rx}" fill="${SVG_THEME.nodeFill}" stroke="${c}" stroke-width="1.5"/>`);
    const label = String(n.label || n.id);
    const l1 = label.length > 24 ? label.slice(0, 23) + '…' : label;
    parts.push(`<text x="${p.x + p.w / 2}" y="${p.y + yOff + (n.technologies?.length ? 22 : 30)}" text-anchor="middle" font-size="11.5" fill="${SVG_THEME.text}" font-weight="500">${xmlEsc(l1)}</text>`);
    if (n.technologies?.length) parts.push(`<text x="${p.x + p.w / 2}" y="${p.y + yOff + 38}" text-anchor="middle" font-size="9" fill="${SVG_THEME.subtext}">${xmlEsc(n.technologies.slice(0, 3).join(' · ').slice(0, 30))}</text>`);
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('\n');
}

export default { viewToMermaid, specToLegacyMermaid, specToMermaidViews, viewToSvg, layoutView };
