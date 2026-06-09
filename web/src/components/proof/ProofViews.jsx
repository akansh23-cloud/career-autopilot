import { useState } from 'react';
import { Award, Github, Globe, X, CheckCircle2, Circle, Lock, ChevronDown, ChevronRight, Sprout } from 'lucide-react';
import { Badge, Button, Modal, EmptyState } from '../ui/kit.jsx';
import { badgeTone } from '../../lib/badges.js';
import { classifyBadges } from '../../lib/skillBadges.js';
import { levelFor, nextStepFor, SKILL_STATE_LABELS, SKILL_STATE_TONES } from '../../lib/xp.js';
import { statusTone } from '../../lib/projectStatus.js';
import { layoutGraph } from '../../lib/architecture.js';

export function StatusBadge({ status, size = 'sm' }) {
  if (!status) return null;
  return <Badge tone={statusTone(status)}>{status}</Badge>;
}

/* Dependency-free architecture renderer: parses the project's Mermaid string
   and draws a clean dark-themed top-down SVG. No mermaid package required, so
   the build never breaks. */
export function ArchitectureDiagram({ mermaid, height = 320 }) {
  if (!mermaid || !String(mermaid).trim()) {
    return <p className="text-[12px] text-slate-500">No architecture diagram yet — generate one on the Architecture tab.</p>;
  }

  let graph;
  try {
    graph = layoutGraph(String(mermaid));
  } catch (err) {
    return (
      <div className="rounded-xl border border-amber-glow/25 bg-amber-glow/10 p-3">
        <p className="text-[12px] text-amber-100">Unable to render this architecture diagram. The Mermaid text is still available below.</p>
        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-slate-300">{String(mermaid)}</pre>
      </div>
    );
  }

  const { nodes, edges, layers, maxDepth } = graph;
  if (!nodes.length) return <p className="text-[12px] text-slate-500">Diagram is empty.</p>;

  const W = 640;
  const layerKeys = Object.keys(layers).map(Number).sort((a, b) => a - b);
  const rowH = Math.max(72, Math.min(110, (height - 24) / (maxDepth + 1)));
  const pos = {};
  layerKeys.forEach((d) => {
    const row = layers[d];
    const gap = W / (row.length + 1);
    row.forEach((n, i) => { pos[n.id] = { x: gap * (i + 1), y: 36 + d * rowH }; });
  });
  const H = 48 + maxDepth * rowH + 36;
  const boxW = 132, boxH = 40;
  const shapeColor = (shape) => shape === 'cyl' ? 'var(--mint, #34d399)' : shape === 'circle' ? 'var(--amber, #f59e0b)' : 'var(--cyan, #38bdf8)';

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-ink-950/60 p-2">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 420 }} role="img" aria-label="Architecture diagram">
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="rgba(148,163,184,0.7)" />
          </marker>
        </defs>
        {edges.map(([a, b], i) => {
          const pa = pos[a], pb = pos[b];
          if (!pa || !pb) return null;
          const y1 = pa.y + boxH / 2, y2 = pb.y - boxH / 2;
          return <path key={i} d={`M${pa.x},${y1} C${pa.x},${(y1 + y2) / 2} ${pb.x},${(y1 + y2) / 2} ${pb.x},${y2}`} fill="none" stroke="rgba(148,163,184,0.45)" strokeWidth="1.5" markerEnd="url(#arrow)" />;
        })}
        {nodes.map((n) => {
          const p = pos[n.id];
          if (!p) return null;
          const c = shapeColor(n.shape);
          const rx = n.shape === 'circle' ? boxH / 2 : 10;
          return (
            <g key={n.id} transform={`translate(${p.x - boxW / 2},${p.y - boxH / 2})`}>
              <rect width={boxW} height={boxH} rx={rx} fill="rgba(255,255,255,0.04)" stroke={c} strokeWidth="1.4" />
              <text x={boxW / 2} y={boxH / 2 + 4} textAnchor="middle" fontSize="12" fill="#e2e8f0" style={{ fontFamily: 'inherit' }}>
                {n.label.length > 18 ? n.label.slice(0, 17) + '…' : n.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}


export function ScoreRing({ score = 0, label = 'Proof', size = 48 }) {
  const tone = score >= 70 ? 'text-aurora-mint' : score >= 40 ? 'text-aurora-cyan' : 'text-amber-glow';
  const ring = score >= 70 ? 'border-aurora-mint/50' : score >= 40 ? 'border-aurora-cyan/50' : 'border-amber-glow/40';
  return (
    <div className="flex flex-col items-center">
      <div className={`grid place-items-center rounded-full border-2 ${ring}`} style={{ height: size, width: size }}>
        <span className={`font-display text-base font-bold ${tone}`}>{score}</span>
      </div>
      <span className="mt-1 font-mono text-[8px] uppercase tracking-widest text-slate-500">{label}</span>
    </div>
  );
}

export function XpBar({ skill }) {
  const info = skill.level ? skill : { ...skill, ...levelFor(skill.xp) };
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-white">{skill.skillName}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {skill.state && <Badge tone={SKILL_STATE_TONES[skill.state] || 'default'}>{SKILL_STATE_LABELS[skill.state] || skill.state}</Badge>}
          <Badge tone="violet">{info.level}</Badge>
        </div>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/8">
        <div className="h-full rounded-full bg-aurora-cta transition-all" style={{ width: `${info.pct}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
        <span>{skill.xp} XP · {skill.evidenceCount} project{skill.evidenceCount === 1 ? '' : 's'}</span>
        {info.next && <span>→ {info.next}</span>}
      </div>
    </div>
  );
}

export function BadgePill({ badge, onClick }) {
  return (
    <button
      onClick={() => onClick?.(badge)}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-200 transition hover:border-white/25"
      title={`${badge.confidence}% confidence`}
    >
      {badge.gated ? <Lock size={11} className="text-slate-500" /> : <Award size={11} className="text-aurora-mint" />}
      <span className="font-medium">{badge.skillName}</span>
      <span className="text-slate-400">· {badge.level}</span>
      <span className="font-mono text-[10px] text-aurora-cyan">{badge.confidence}%</span>
    </button>
  );
}

/* Shared "Verified skill badges" presentation used by the dashboard and the
   Career Profile. Shows only STRONG badges (proof >= 80 or a verified status),
   capped to a tidy count, with low-confidence "practiced" skills tucked into a
   collapsed-by-default "Developing skills" disclosure and a "View all skills"
   link to the full Skills & XP breakdown. This is what keeps the dashboard from
   ever rendering 70–100 noisy chips. */
export function VerifiedBadgePanel({ badges = [], onOpen, onViewAll, limit = 16 }) {
  const [showDeveloping, setShowDeveloping] = useState(false);
  const { verified, developing } = classifyBadges(badges);
  const shown = verified.slice(0, limit);

  if (!verified.length && !developing.length) {
    return (
      <EmptyState
        icon={Award}
        title="No verified skills yet"
        hint="Submit a project with GitHub/live demo proof to earn verified badges."
        action={onViewAll ? <Button size="sm" variant="soft" onClick={onViewAll}>View all skills</Button> : undefined}
      />
    );
  }

  return (
    <div className="space-y-3">
      {shown.length ? (
        <div className="flex flex-wrap gap-2">{shown.map((b) => <BadgePill key={b.skillName + b.level} badge={b} onClick={onOpen} />)}</div>
      ) : (
        <p className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-[13px] text-slate-400">
          No verified badges yet — your developing skills are below. Add GitHub/live-demo proof to a project to verify them.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {onViewAll && (
          <button onClick={onViewAll} className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-aurora-cyan transition hover:border-white/25">
            View all skills{verified.length ? ` (${verified.length})` : ''}
          </button>
        )}
        {developing.length > 0 && (
          <button onClick={() => setShowDeveloping((v) => !v)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-slate-300 transition hover:border-white/25">
            {showDeveloping ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <Sprout size={12} className="text-slate-400" /> Developing skills ({developing.length})
          </button>
        )}
      </div>

      {showDeveloping && developing.length > 0 && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate-500">Developing skills · lower-confidence, not yet verified</p>
          <div className="flex flex-wrap gap-2">{developing.map((b) => <BadgePill key={b.skillName + b.level} badge={b} onClick={onOpen} />)}</div>
        </div>
      )}
    </div>
  );
}

export function BadgeModal({ badge, open, onClose }) {
  if (!badge) return null;
  return (
    <Modal open={open} onClose={onClose} width="max-w-lg" title={`${badge.skillName} — ${badge.level}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={badgeTone(badge.level)}><Award size={11} /> {badge.level}</Badge>
          <Badge tone="cyan">{badge.confidence}% confidence</Badge>
          {badge.gated && <Badge tone="amber"><Lock size={11} /> Upgrade to unlock full level</Badge>}
        </div>
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Earned by</div>
          <p className="text-sm text-slate-200">{badge.projectTitle}</p>
        </div>
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Evidence</div>
          <ul className="space-y-1">
            {(badge.evidence || []).map((e, i) => (
              <li key={i} className="flex items-center gap-2 text-[13px] text-slate-300"><CheckCircle2 size={14} className="text-aurora-mint" /> {e}</li>
            ))}
          </ul>
        </div>
        {(badge.checklist || []).length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Project checklist</div>
            <ul className="space-y-1">
              {badge.checklist.map((c, i) => (
                <li key={i} className="flex items-center gap-2 text-[13px] text-slate-400">
                  {c.done ? <CheckCircle2 size={14} className="text-aurora-mint" /> : <Circle size={14} className="text-slate-600" />}
                  <span className={c.done ? '' : 'text-slate-500'}>{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
          {badge.githubUrl && <a href={badge.githubUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Github size={14} /> Code</Button></a>}
          {badge.liveDemoUrl && <a href={badge.liveDemoUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Globe size={14} /> Live demo</Button></a>}
        </div>
        <p className="text-[11px] text-slate-500">Confidence reflects how much real evidence backs this badge. Badges are awarded from project proof, never from a self-selected skill.</p>
      </div>
    </Modal>
  );
}

export { nextStepFor };
