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
  for (const line of lines.slice(1)) {
    const parts = line.split(/-->|---|==>/).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const left = parseNode(parts[0]);
    if (left) nodes.set(left.id, { ...(nodes.get(left.id) || {}), ...left });
    for (let i = 1; i < parts.length; i += 1) {
      const right = parseNode(parts[i]);
      if (right) nodes.set(right.id, { ...(nodes.get(right.id) || {}), ...right });
      if (left && right) edges.push([parts[i - 1].match(/^([A-Za-z0-9_]+)/)?.[1] || left.id, right.id]);
    }
  }
  const list = Array.from(nodes.values());
  const width = direction === 'LR' ? Math.max(780, list.length * 170) : 780;
  const height = direction === 'LR' ? 250 : Math.max(260, list.length * 110);
  const positions = new Map();
  list.forEach((node, index) => {
    const x = direction === 'LR' ? 80 + index * 160 : width / 2;
    const y = direction === 'LR' ? height / 2 : 55 + index * 100;
    positions.set(node.id, { x, y });
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
        return <line key={i} x1={a.x + 62} y1={a.y} x2={b.x - 62} y2={b.y} stroke="#94a3b8" strokeWidth="2" markerEnd="url(#arrow)" opacity="0.8" />;
      })}
      {nodes.map((node) => {
        const p = positions.get(node.id);
        const lines = wrap(node.label);
        return (
          <g key={node.id} transform={`translate(${p.x - 65}, ${p.y - 30})`}>
            <rect width="130" height="60" rx="14" fill="rgba(30,41,59,0.95)" stroke="#f5c76b" strokeOpacity="0.55" />
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
        return <g key={id}><rect x={x - 58} y="22" width="116" height="42" rx="12" fill="rgba(30,41,59,0.95)" stroke="#f5c76b" strokeOpacity="0.55" /><text x={x} y="48" textAnchor="middle" fill="#e5e7eb" fontSize="11" fontWeight="600">{aliases.get(id) || id}</text><line x1={x} y1="64" x2={x} y2={height - 24} stroke="#64748b" strokeDasharray="4 5" opacity="0.7" /></g>;
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
    return <pre className="overflow-x-auto rounded-xl border border-white/8 bg-black/30 p-3 text-[11.5px] text-slate-300">{chart}</pre>;
  }
  return (
    <div className={className}>
      <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/25 p-3">
        {data.type === 'sequence' ? <SequenceSvg data={data} /> : <FlowSvg data={data} />}
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Rendered from Mermaid text. Use “Copy Mermaid” for external Mermaid editors or formal export.</p>
    </div>
  );
}
