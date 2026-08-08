// Architecture Diagram OS — canvas renderer.
// Dependency-free SVG renderer styled after classic industry system-design
// diagrams (Netflix/AWS-style): left→right flow, cylinder shapes for data
// stores and queues, stacked cards for ×N workers/instances, labeled edges,
// light section boundaries, lucide icons. Clean and enterprise — no animation.
// Nested views (cloud deployment: region > VPC > subnets) render vertically.
import { useMemo, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { layoutView, NODE_TYPE_COLORS, NODE_TYPE_LABELS } from '../../lib/architectureSpec.js';
import { iconFor } from './architectureIconMap.jsx';

const GROUP_STYLE = {
  region: { stroke: 'rgba(167,139,250,0.45)', dash: '8 5' },
  vpc: { stroke: 'rgba(56,189,248,0.4)', dash: '6 4' },
  subnet: { stroke: 'rgba(148,163,184,0.35)', dash: '4 4' },
  boundary: { stroke: 'rgba(251,113,133,0.4)', dash: '6 4' },
  zone: { stroke: 'rgba(148,163,184,0.22)', dash: '' },
  layer: { stroke: 'rgba(148,163,184,0.22)', dash: '' },
};

/* Is this node rendered as a stack of cards (concurrent workers / ×N instances)? */
const isStacked = (n) => !!(n?.metadata?.stacked || /×N|x N|\(xN\)/i.test(String(n?.label || '')) || n?.capability === 'worker');
/* Cylinder for data stores and queues (classic system-design shape). */
const isCylinder = (n) => n?.type === 'datastore' || n?.type === 'queue';

function NodeShape({ n, p, color }) {
  const Icon = iconFor(n);
  const label = String(n.label || n.id);
  const tech = (n.technologies || []).slice(0, 3).join(' · ');
  const stacked = isStacked(n);

  if (isCylinder(n)) {
    const ry = 9;
    const body = `M0,${ry} A${p.w / 2},${ry} 0 0 1 ${p.w},${ry} L${p.w},${p.h - ry} A${p.w / 2},${ry} 0 0 1 0,${p.h - ry} Z`;
    return (
      <g transform={`translate(${p.x},${p.y})`}>
        <path d={body} fill="rgba(255,255,255,0.045)" stroke={color} strokeWidth="1.4" />
        <ellipse cx={p.w / 2} cy={ry} rx={p.w / 2} ry={ry} fill="rgba(255,255,255,0.06)" stroke={color} strokeWidth="1.4" />
        <g transform={`translate(12,${p.h / 2 - 6})`} color={color}><Icon size={16} strokeWidth={1.75} /></g>
        <text x={36} y={tech ? p.h / 2 + 2 : p.h / 2 + 7} fontSize="11.5" fontWeight="500" fill="#e2e8f0">
          {label.length > 21 ? label.slice(0, 20) + '…' : label}
        </text>
        {tech && <text x={36} y={p.h / 2 + 15} fontSize="8.5" fill="rgba(148,163,184,0.85)">{tech.length > 28 ? tech.slice(0, 27) + '…' : tech}</text>}
      </g>
    );
  }

  const rx = n.type === 'actor' || n.type === 'external' ? p.h / 2 : 8;
  return (
    <g transform={`translate(${p.x},${p.y})`}>
      {stacked && (
        <>
          <rect x={8} y={-8} width={p.w} height={p.h} rx={rx} fill="rgba(255,255,255,0.02)" stroke={color} strokeOpacity="0.35" strokeWidth="1.2" />
          <rect x={4} y={-4} width={p.w} height={p.h} rx={rx} fill="rgba(255,255,255,0.03)" stroke={color} strokeOpacity="0.55" strokeWidth="1.2" />
        </>
      )}
      <rect width={p.w} height={p.h} rx={rx} fill="rgba(255,255,255,0.05)" stroke={color} strokeWidth="1.4" />
      <g transform={`translate(12,${p.h / 2 - 9})`} color={color}><Icon size={18} strokeWidth={1.75} /></g>
      <text x={38} y={tech ? p.h / 2 - 2 : p.h / 2 + 4} fontSize="11.5" fontWeight="500" fill="#e2e8f0">
        {label.length > 21 ? label.slice(0, 20) + '…' : label}
      </text>
      {tech && <text x={38} y={p.h / 2 + 12} fontSize="8.5" fill="rgba(148,163,184,0.85)">{tech.length > 28 ? tech.slice(0, 27) + '…' : tech}</text>}
    </g>
  );
}

/* Edge path with orientation-aware anchors:
   horizontal → exit right edge / enter left edge (Netflix-style flow);
   backwards edges loop underneath; same-column edges connect vertically. */
function edgePath(a, b, orientation) {
  if (orientation === 'horizontal') {
    const aR = { x: a.x + a.w, y: a.y + a.h / 2 };
    const bL = { x: b.x, y: b.y + b.h / 2 };
    if (bL.x >= aR.x - 4) {
      const mx = (aR.x + bL.x) / 2;
      return { d: `M${aR.x},${aR.y} C${mx},${aR.y} ${mx},${bL.y} ${bL.x},${bL.y}`, lx: mx, ly: (aR.y + bL.y) / 2 - 7 };
    }
    const sameCol = Math.abs(a.x - b.x) < a.w;
    if (sameCol) {
      const down = b.y > a.y;
      const y1 = down ? a.y + a.h : a.y;
      const y2 = down ? b.y : b.y + b.h;
      const my = (y1 + y2) / 2;
      return { d: `M${a.x + a.w / 2},${y1} C${a.x + a.w / 2},${my} ${b.x + b.w / 2},${my} ${b.x + b.w / 2},${y2}`, lx: (a.x + b.x + a.w) / 2 + 8, ly: my };
    }
    // feedback (right → left): loop below both nodes
    const drop = Math.max(a.y + a.h, b.y + b.h) + 26;
    const aB = { x: a.x + a.w / 2, y: a.y + a.h };
    const bB = { x: b.x + b.w / 2, y: b.y + b.h };
    return { d: `M${aB.x},${aB.y} C${aB.x},${drop} ${bB.x},${drop} ${bB.x},${bB.y}`, lx: (aB.x + bB.x) / 2, ly: drop - 6 };
  }
  // vertical (nested deployment)
  const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2;
  const down = b.y >= y1;
  const sy = down ? y1 : a.y;
  const ey = down ? b.y : b.y + b.h;
  const my = (sy + ey) / 2;
  return { d: `M${x1},${sy} C${x1},${my} ${x2},${my} ${x2},${ey}`, lx: (x1 + x2) / 2, ly: my };
}

export default function ArchitectureCanvas({ view, height = 420 }) {
  const [zoom, setZoom] = useState(1);
  const layout = useMemo(() => {
    try { return layoutView(view); } catch { return null; }
  }, [view]);

  if (!view || !layout || !Array.isArray(view.nodes) || view.nodes.length === 0) {
    return <p className="text-[12px] text-fg-muted">This view has no diagram content.</p>;
  }

  const { placed, groupRects, width, height: H, orientation } = layout;
  const nodes = view.nodes.filter((n) => placed[n.id]);
  const edges = (view.edges || []).filter((e) => placed[e.from] && placed[e.to]);
  const legendTypes = [...new Set(nodes.map((n) => n.type))];
  const markerId = `arch-arrow-${view.id || view.type || 'v'}`;

  return (
    <div className="rounded-xl border border-subtle bg-base/60">
      <div className="flex items-center justify-between border-b border-subtle px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">{view.title || view.type}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} className="rounded p-1 text-fg-secondary hover:bg-surface-1 hover:text-fg" title="Zoom out" aria-label="Zoom out"><ZoomOut size={13} /></button>
          <span className="w-9 text-center font-mono text-[10px] text-fg-muted">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))} className="rounded p-1 text-fg-secondary hover:bg-surface-1 hover:text-fg" title="Zoom in" aria-label="Zoom in"><ZoomIn size={13} /></button>
          <button onClick={() => setZoom(1)} className="rounded p-1 text-fg-secondary hover:bg-surface-1 hover:text-fg" title="Fit" aria-label="Reset zoom"><Maximize2 size={13} /></button>
        </div>
      </div>

      <div className="overflow-auto p-2" style={{ maxHeight: height }}>
        <svg
          viewBox={`0 0 ${width} ${H}`}
          width={width * zoom}
          height={H * zoom}
          role="img"
          aria-label={`${view.title || view.type} architecture diagram`}
          style={{ minWidth: 360 }}
        >
          <defs>
            <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="rgba(148,163,184,0.75)" />
            </marker>
          </defs>

          {/* group boundaries (parents first so children draw on top) */}
          {groupRects.map((g) => {
            const s = GROUP_STYLE[g.type] || GROUP_STYLE.zone;
            return (
              <g key={g.id}>
                <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={12} fill="rgba(255,255,255,0.02)" stroke={s.stroke} strokeWidth="1.2" strokeDasharray={s.dash || undefined} />
                <text x={g.x + 12} y={g.y + 17} fontSize="9.5" letterSpacing="1.5" fill="rgba(148,163,184,0.85)">{String(g.label || '').toUpperCase()}</text>
              </g>
            );
          })}

          {/* edges */}
          {edges.map((e) => {
            const a = placed[e.from], b = placed[e.to];
            const { d, lx, ly } = edgePath(a, b, orientation);
            return (
              <g key={e.id || `${e.from}-${e.to}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={e.criticality === 'high' ? 'rgba(251,113,133,0.6)' : 'rgba(148,163,184,0.5)'}
                  strokeWidth="1.4"
                  strokeDasharray={e.async ? '5 4' : undefined}
                  markerEnd={`url(#${markerId})`}
                />
                {e.label && (
                  <g>
                    <rect x={lx - Math.min(String(e.label).length, 34) * 2.6 - 4} y={ly - 8} width={Math.min(String(e.label).length, 34) * 5.2 + 8} height={14} rx={4} fill="rgba(11,16,32,0.88)" />
                    <text x={lx} y={ly + 2.5} textAnchor="middle" fontSize="9" fill="rgba(186,197,214,0.95)">{String(e.label).slice(0, 34)}</text>
                  </g>
                )}
              </g>
            );
          })}

          {/* nodes */}
          {nodes.map((n) => (
            <NodeShape key={n.id} n={n} p={placed[n.id]} color={NODE_TYPE_COLORS[n.type] || NODE_TYPE_COLORS.service} />
          ))}
        </svg>
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-subtle px-3 py-2">
        {legendTypes.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 text-[10px] text-fg-secondary">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: NODE_TYPE_COLORS[t] || NODE_TYPE_COLORS.service }} />
            {NODE_TYPE_LABELS[t] || t}
          </span>
        ))}
        {(view.edges || []).some((e) => e.async) && (
          <span className="inline-flex items-center gap-1.5 text-[10px] text-fg-secondary">
            <span className="inline-block h-0 w-5 border-t border-dashed border-slate-400" /> async
          </span>
        )}
        {nodes.some(isStacked) && <span className="text-[10px] text-fg-secondary">▣ stacked = concurrent / ×N instances</span>}
      </div>

      {/* annotations */}
      {view.annotations?.length > 0 && (
        <div className="border-t border-subtle px-3 py-2">
          {view.annotations.map((a, i) => (
            <p key={i} className="text-[11px] text-fg-muted">• {a}</p>
          ))}
        </div>
      )}
    </div>
  );
}
