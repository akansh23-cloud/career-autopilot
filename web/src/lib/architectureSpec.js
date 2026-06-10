// Architecture Diagram OS — client-side spec helpers.
// Pure functions only (no React) so they are unit-testable in node and
// shareable between the canvas renderer, tabs, and export panel.
//
// Backward compatibility is a hard requirement: old project records carry
// plain Mermaid strings, and Patent OS / Project OS objects come in many
// shapes. Every helper here is defensive and never throws on bad input.

export const VIEW_LABELS = {
  systemContext: 'Context',
  container: 'Container',
  deployment: 'Deployment',
  dataFlow: 'Data Flow',
  security: 'Security',
  cicd: 'CI/CD',
  observability: 'Observability',
  scalingFailure: 'Scaling/Failure',
  patentFigure: 'Patent Figure',
};

export const VIEW_ORDER = ['systemContext', 'container', 'deployment', 'dataFlow', 'security', 'cicd', 'observability', 'scalingFailure', 'patentFigure'];

/* True only for the new structured spec shape. */
export function isArchitectureSpec(v) {
  return !!(v && typeof v === 'object' && Array.isArray(v.views) && v.views.length > 0
    && v.views.every((view) => view && Array.isArray(view.nodes)));
}

/* Order a spec's views consistently for tabs. */
export function orderedViews(spec) {
  if (!isArchitectureSpec(spec)) return [];
  return [...spec.views].sort((a, b) => {
    const ai = VIEW_ORDER.indexOf(a.type); const bi = VIEW_ORDER.indexOf(b.type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

/* ---- Mermaid mirror (same subset the backend adapter emits) ----
   Used for the "Copy Mermaid" action without a network round-trip. */
const esc = (s = '') => String(s).replace(/"/g, "'").replace(/[[\]()]/g, '').slice(0, 60);
const mid = (id) => String(id || '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);

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

/* ---- Deterministic layered layout (mirrors the server-side SVG export) ----
   Returns absolute positions for nodes + group rectangles so the React canvas
   only has to draw. Handles nested groups (region > vpc > subnet) and
   ungrouped nodes (sequence-style views). */
export function layoutView(view = {}, opts = {}) {
  const nodes = Array.isArray(view.nodes) ? view.nodes.slice(0, 60) : [];
  const groups = Array.isArray(view.groups) ? view.groups : [];
  const NODE_W = opts.nodeW || 172;
  const NODE_H = opts.nodeH || 56;
  const GAP_X = 26, GAP_Y = 34, PAD = 16, GROUP_PAD = 34;
  const MAX_PER_ROW = opts.maxPerRow || 4;

  const topGroups = groups.filter((g) => !g.parentId).sort((a, b) => (a.order || 0) - (b.order || 0));
  const childOf = (pid) => groups.filter((g) => g.parentId === pid).sort((a, b) => (a.order || 0) - (b.order || 0));
  const nodesIn = (gid) => nodes.filter((n) => n.group === gid);
  const groupIds = new Set(groups.map((g) => g.id));
  const ungrouped = nodes.filter((n) => !n.group || !groupIds.has(n.group));

  const placed = {};
  const groupRects = [];
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

  const hasDeepContent = (g) => nodesIn(g.id).length > 0 || childOf(g.id).some(hasDeepContent);

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
  return { placed, groupRects, width, height, nodeW: NODE_W, nodeH: NODE_H };
}

/* ---- presentation helpers ---- */
export const NODE_TYPE_COLORS = {
  actor: '#FFC85A',
  external: '#FFC85A',
  service: '#37D6C4',
  datastore: '#46E6A6',
  queue: '#A78BFA',
  pipeline: '#A78BFA',
  security: '#FB7185',
  monitor: '#22D3EE',
};

export const NODE_TYPE_LABELS = {
  actor: 'Actor / user',
  external: 'External system',
  service: 'Application service',
  datastore: 'Data store',
  queue: 'Queue / event channel',
  pipeline: 'Delivery pipeline',
  security: 'Security control',
  monitor: 'Observability',
};

export function checkTone(severity) {
  return severity === 'critical' ? 'amber' : severity === 'high' ? 'amber' : severity === 'medium' ? 'cyan' : 'default';
}

export function scoreTone(score) {
  return score >= 75 ? 'mint' : score >= 50 ? 'cyan' : 'amber';
}

export const SCORE_CATEGORIES = [
  ['security', 'Security'],
  ['scalability', 'Scalability'],
  ['reliability', 'Reliability'],
  ['observability', 'Observability'],
  ['maintainability', 'Maintainability'],
  ['deploymentReadiness', 'Deployment readiness'],
  ['dataDesign', 'Data design'],
  ['costAwareness', 'Cost awareness'],
];

export default {
  isArchitectureSpec, orderedViews, viewToMermaid, layoutView,
  VIEW_LABELS, VIEW_ORDER, NODE_TYPE_COLORS, NODE_TYPE_LABELS,
  checkTone, scoreTone, SCORE_CATEGORIES,
};
