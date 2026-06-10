// Architecture Diagram OS — canvas renderer.
// Dependency-free SVG renderer for one architectureSpec view: grouped
// boundaries (region/VPC/subnet nesting), node-type colors, lucide icons,
// labeled/dashed edges and a legend. Deliberately clean and enterprise-style:
// no animation, dark theme matching the Aurora design system.
import { useMemo, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { layoutView, NODE_TYPE_COLORS, NODE_TYPE_LABELS } from '../../lib/architectureSpec.js';
import { iconFor } from './architectureIconMap.jsx';

const GROUP_STYLE = {
  region: { stroke: 'rgba(167,139,250,0.45)', dash: '8 5' },
  vpc: { stroke: 'rgba(56,189,248,0.4)', dash: '6 4' },
  subnet: { stroke: 'rgba(148,163,184,0.35)', dash: '4 4' },
  boundary: { stroke: 'rgba(251,113,133,0.4)', dash: '6 4' },
  zone: { stroke: 'rgba(148,163,184,0.3)', dash: '' },
  layer: { stroke: 'rgba(148,163,184,0.3)', dash: '' },
};

export default function ArchitectureCanvas({ view, height = 420 }) {
  const [zoom, setZoom] = useState(1);
  const layout = useMemo(() => {
    try { return layoutView(view); } catch { return null; }
  }, [view]);

  if (!view || !layout || !Array.isArray(view.nodes) || view.nodes.length === 0) {
    return <p className="text-[12px] text-slate-500">This view has no diagram content.</p>;
  }

  const { placed, groupRects, width, height: H, nodeH } = layout;
  const nodes = view.nodes.filter((n) => placed[n.id]);
  const edges = (view.edges || []).filter((e) => placed[e.from] && placed[e.to]);
  const legendTypes = [...new Set(nodes.map((n) => n.type))];
  const markerId = `arch-arrow-${view.id || view.type || 'v'}`;

  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/60">
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">{view.title || view.type}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white" title="Zoom out" aria-label="Zoom out"><ZoomOut size={13} /></button>
          <span className="w-9 text-center font-mono text-[10px] text-slate-500">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))} className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white" title="Zoom in" aria-label="Zoom in"><ZoomIn size={13} /></button>
          <button onClick={() => setZoom(1)} className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white" title="Fit" aria-label="Reset zoom"><Maximize2 size={13} /></button>
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
                <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={12} fill="rgba(255,255,255,0.025)" stroke={s.stroke} strokeWidth="1.2" strokeDasharray={s.dash || undefined} />
                <text x={g.x + 12} y={g.y + 17} fontSize="9.5" letterSpacing="1.5" fill="rgba(148,163,184,0.85)">{String(g.label || '').toUpperCase()}</text>
              </g>
            );
          })}

          {/* edges */}
          {edges.map((e) => {
            const a = placed[e.from], b = placed[e.to];
            const x1 = a.x + a.w / 2, y1 = a.y + a.h;
            const x2 = b.x + b.w / 2, y2 = b.y;
            const down = y2 >= y1;
            const sy = down ? y1 : a.y;
            const ey = down ? y2 : b.y + b.h;
            const my = (sy + ey) / 2;
            return (
              <g key={e.id || `${e.from}-${e.to}`}>
                <path
                  d={`M${x1},${sy} C${x1},${my} ${x2},${my} ${x2},${ey}`}
                  fill="none"
                  stroke={e.criticality === 'high' ? 'rgba(251,113,133,0.6)' : 'rgba(148,163,184,0.5)'}
                  strokeWidth="1.4"
                  strokeDasharray={e.async ? '5 4' : undefined}
                  markerEnd={`url(#${markerId})`}
                />
                {e.label && (
                  <g>
                    <rect x={(x1 + x2) / 2 - Math.min(String(e.label).length, 34) * 2.6 - 4} y={my - 8} width={Math.min(String(e.label).length, 34) * 5.2 + 8} height={14} rx={4} fill="rgba(11,16,32,0.85)" />
                    <text x={(x1 + x2) / 2} y={my + 2.5} textAnchor="middle" fontSize="9" fill="rgba(186,197,214,0.95)">{String(e.label).slice(0, 34)}</text>
                  </g>
                )}
              </g>
            );
          })}

          {/* nodes */}
          {nodes.map((n) => {
            const p = placed[n.id];
            const color = NODE_TYPE_COLORS[n.type] || NODE_TYPE_COLORS.service;
            const Icon = iconFor(n);
            const rx = n.type === 'actor' || n.type === 'external' ? nodeH / 2 : 10;
            const label = String(n.label || n.id);
            const tech = (n.technologies || []).slice(0, 3).join(' · ');
            return (
              <g key={n.id} transform={`translate(${p.x},${p.y})`}>
                <rect width={p.w} height={p.h} rx={rx} fill="rgba(255,255,255,0.045)" stroke={color} strokeWidth="1.4" />
                <g transform={`translate(12,${p.h / 2 - 9})`} color={color}>
                  <Icon size={18} strokeWidth={1.75} />
                </g>
                <text x={38} y={tech ? p.h / 2 - 2 : p.h / 2 + 4} fontSize="11.5" fontWeight="500" fill="#e2e8f0">
                  {label.length > 21 ? label.slice(0, 20) + '…' : label}
                </text>
                {tech && (
                  <text x={38} y={p.h / 2 + 12} fontSize="8.5" fill="rgba(148,163,184,0.8)">
                    {tech.length > 28 ? tech.slice(0, 27) + '…' : tech}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/8 px-3 py-2">
        {legendTypes.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 text-[10px] text-slate-400">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: NODE_TYPE_COLORS[t] || NODE_TYPE_COLORS.service }} />
            {NODE_TYPE_LABELS[t] || t}
          </span>
        ))}
        {(view.edges || []).some((e) => e.async) && (
          <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-400">
            <span className="inline-block h-0 w-5 border-t border-dashed border-slate-400" /> async
          </span>
        )}
      </div>

      {/* annotations */}
      {view.annotations?.length > 0 && (
        <div className="border-t border-white/8 px-3 py-2">
          {view.annotations.map((a, i) => (
            <p key={i} className="text-[11px] text-slate-500">• {a}</p>
          ))}
        </div>
      )}
    </div>
  );
}
