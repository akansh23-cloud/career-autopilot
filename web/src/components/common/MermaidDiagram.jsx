import { useMemo } from 'react';

const clean = (value = '') => String(value || '').replace(/[<>]/g, '').trim();

function parseNode(token = '') {
  const trimmed = token.trim().replace(/;$/, '');
  const match = trimmed.match(/^([A-Za-z0-9_]+)\s*(?:\[([^\]]+)\]|\(\(([^)]+)\)\)|\(([^)]+)\))?/);
  if (!match) return null;
  return { id: match[1], label: clean(match[2] || match[3] || match[4] || match[1]) };
}

function parseFlowchart(chart = '') {
  const lines = chart.split('\n').map((x) => x.trim()).filter(Boolean);
  const direction = /\bTD\b|\bTB\b/i.test(lines[0] || '') ? 'TD' : 'LR';
  const nodes = new Map();
  const edges = [];
  const upsert = (node) => {
    if (!node) return;
    const existing = nodes.get(node.id) || {};
    // Prefer real labels over bare ids that came from edge references.
    const label = node.label && node.label !== node.id ? node.label : existing.label || node.label;
    nodes.set(node.id, { ...existing, ...node, label });
  };

  for (const rawLine of lines.slice(1)) {
    const line = rawLine.replace(/;$/, '');
    if (!line || line.startsWith('%%')) continue;

    const parts = line.split(/-->|---|==>/).map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2) {
      let previous = parseNode(parts[0]);
      upsert(previous);
      for (let i = 1; i < parts.length; i += 1) {
        const right = parseNode(parts[i]);
        upsert(right);
        if (previous && right) edges.push([previous.id, right.id]);
        previous = right;
      }
      continue;
    }

    // Standalone node declaration, e.g. B[Feature / Signal Extraction].
    // Without this, edge lines like A --> B followed by B[Label] render as “B”.
    const standalone = parseNode(line);
    upsert(standalone);
  }

  const list = Array.from(nodes.values());
  const indegree = new Map(list.map((n) => [n.id, 0]));
  const adjacency = new Map(list.map((n) => [n.id, []]));
  edges.forEach(([from, to]) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(to);
    indegree.set(to, (indegree.get(to) || 0) + 1);
  });

  const roots = list.filter((n) => (indegree.get(n.id) || 0) === 0).map((n) => n.id);
  const depth = new Map();
  const queue = roots.length ? roots.map((id) => { depth.set(id, 0); return id; }) : list.slice(0, 1).map((n) => { depth.set(n.id, 0); return n.id; });
  // Cycle-safe layout: assign a node's first discovered depth only. Earlier logic
  // kept increasing depth on feedback loops (A -> B -> A), which could freeze/crash
  // the Patent OS diagram tab when rendering improvement-loop diagrams.
  let guard = 0;
  const guardLimit = Math.max(64, list.length * Math.max(1, edges.length) * 2);
  while (queue.length && guard < guardLimit) {
    guard += 1;
    const current = queue.shift();
    const nextDepth = (depth.get(current) || 0) + 1;
    (adjacency.get(current) || []).forEach((next) => {
      if (!depth.has(next)) {
        depth.set(next, nextDepth);
        queue.push(next);
      }
    });
  }
  list.forEach((n, i) => { if (!depth.has(n.id)) depth.set(n.id, i); });

  const layers = new Map();
  list.forEach((node) => {
    const d = depth.get(node.id) || 0;
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d).push(node);
  });
  const maxDepth = Math.max(0, ...Array.from(layers.keys()));
  const maxLayerSize = Math.max(1, ...Array.from(layers.values()).map((v) => v.length));
  const width = direction === 'LR' ? Math.max(820, (maxDepth + 1) * 190) : Math.max(820, maxLayerSize * 200);
  const height = direction === 'LR' ? Math.max(280, maxLayerSize * 115) : Math.max(300, (maxDepth + 1) * 125);
  const positions = new Map();
  Array.from(layers.entries()).forEach(([d, layer]) => {
    layer.forEach((node, index) => {
      const x = direction === 'LR'
        ? 90 + d * 185
        : width / 2 + (index - (layer.length - 1) / 2) * 190;
      const y = direction === 'LR'
        ? height / 2 + (index - (layer.length - 1) / 2) * 105
        : 60 + d * 115;
      positions.set(node.id, { x, y });
    });
  });
  return { type: 'flowchart', direction, nodes: list, edges, positions, width, height };
}
function parseSequence(chart = '') {
  const lines = chart.split('\n').map((x) => x.trim()).filter(Boolean);
  const participants = [];
  const aliases = new Map();
  const messages = [];
  for (const line of lines.slice(1)) {
    const p = line.match(/^participant\s+(\w+)\s+as\s+(.+)$/i);
    if (p) {
      aliases.set(p[1], clean(p[2]));
      participants.push(p[1]);
      continue;
    }
    const m = line.match(/^(\w+)\s*[-=]+>>\s*(\w+)\s*:\s*(.+)$/);
    if (m) {
      if (!participants.includes(m[1])) participants.push(m[1]);
      if (!participants.includes(m[2])) participants.push(m[2]);
      messages.push({ from: m[1], to: m[2], label: clean(m[3]) });
    }
  }
  return { type: 'sequence', participants, aliases, messages, width: Math.max(760, participants.length * 180), height: Math.max(260, 100 + messages.length * 55) };
}

function parse(chart = '') {
  const trimmed = String(chart || '').trim();
  if (/^sequenceDiagram/i.test(trimmed)) return parseSequence(trimmed);
  if (/^flowchart/i.test(trimmed) || /^graph/i.test(trimmed)) return parseFlowchart(trimmed);
  return null;
}

const wrap = (text = '', max = 18) => {
  const words = clean(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > max && current) { lines.push(current); current = word; }
    else current = (current + ' ' + word).trim();
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
};

function FlowSvg({ data }) {
  const { nodes, edges, positions, width, height } = data;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[720px] max-w-full" role="img" aria-label="Rendered Mermaid flowchart">
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#94a3b8" /></marker>
      </defs>
      <rect width={width} height={height} rx="18" fill="rgba(15,23,42,0.35)" />
      {edges.map(([from, to], i) => {
        const a = positions.get(from); const b = positions.get(to);
        if (!a || !b) return null;
        const lr = data.direction === 'LR';
        const x1 = lr ? a.x + 66 : a.x;
        const y1 = lr ? a.y : a.y + 32;
        const x2 = lr ? b.x - 66 : b.x;
        const y2 = lr ? b.y : b.y - 32;
        const mid = lr ? (x1 + x2) / 2 : (y1 + y2) / 2;
        const d = lr ? `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}` : `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
        return <path key={i} d={d} fill="none" stroke="#94a3b8" strokeWidth="2" markerEnd="url(#arrow)" opacity="0.8" />;
      })}
      {nodes.map((node) => {
        const p = positions.get(node.id);
        if (!p) return null;
        const lines = wrap(node.label);
        return (
          <g key={node.id} transform={`translate(${p.x - 65}, ${p.y - 30})`}>
            <rect width="130" height="60" rx="14" fill="rgba(30,41,59,0.95)" stroke="#c9b8ff" strokeOpacity="0.55" />
            {lines.map((line, i) => <text key={i} x="65" y={22 + i * 14} textAnchor="middle" fill="#e5e7eb" fontSize="11" fontWeight="600">{line}</text>)}
          </g>
        );
      })}
    </svg>
  );
}

function SequenceSvg({ data }) {
  const { participants, aliases, messages, width, height } = data;
  const xFor = (id) => 90 + participants.indexOf(id) * 170;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[720px] max-w-full" role="img" aria-label="Rendered Mermaid sequence diagram">
      <defs><marker id="seqArrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#94a3b8" /></marker></defs>
      <rect width={width} height={height} rx="18" fill="rgba(15,23,42,0.35)" />
      {participants.map((id) => {
        const x = xFor(id);
        return <g key={id}><rect x={x - 58} y="22" width="116" height="42" rx="12" fill="rgba(30,41,59,0.95)" stroke="#c9b8ff" strokeOpacity="0.55" /><text x={x} y="48" textAnchor="middle" fill="#e5e7eb" fontSize="11" fontWeight="600">{aliases.get(id) || id}</text><line x1={x} y1="64" x2={x} y2={height - 24} stroke="#64748b" strokeDasharray="4 5" opacity="0.7" /></g>;
      })}
      {messages.map((m, i) => {
        const y = 100 + i * 52; const x1 = xFor(m.from); const x2 = xFor(m.to); const mid = (x1 + x2) / 2;
        return <g key={i}><line x1={x1} y1={y} x2={x2} y2={y} stroke="#94a3b8" strokeWidth="2" markerEnd="url(#seqArrow)" /><text x={mid} y={y - 8} textAnchor="middle" fill="#cbd5e1" fontSize="11">{m.label}</text></g>;
      })}
    </svg>
  );
}

export default function MermaidDiagram({ chart, className = '' }) {
  const data = useMemo(() => parse(chart), [chart]);
  if (!data) {
    return <pre className="overflow-x-auto rounded-xl border border-subtle bg-sunken p-3 text-[11.5px] text-fg-secondary">{chart}</pre>;
  }
  return (
    <div className={className}>
      <div className="overflow-x-auto rounded-xl border border-subtle bg-sunken p-3">
        {data.type === 'sequence' ? <SequenceSvg data={data} /> : <FlowSvg data={data} />}
      </div>
      <p className="mt-2 text-[11px] text-fg-muted">Rendered from Mermaid text. Use “Copy Mermaid” for external Mermaid editors or formal export.</p>
    </div>
  );
}
