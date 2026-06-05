import { Award, Github, Globe, X, CheckCircle2, Circle, Lock } from 'lucide-react';
import { Badge, Button, Modal } from '../ui/kit.jsx';
import { badgeTone } from '../../lib/badges.js';
import { levelFor, nextStepFor } from '../../lib/xp.js';

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
        <Badge tone="violet">{info.level}</Badge>
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
