import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';

/* Compact, dependency-free progress ring for the dashboard hero.
   Avoids importing ScoreRing from proof/ to keep common.jsx cycle-free. */
function MiniRing({ value = 0, label }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const r = 34;
  const c = 2 * Math.PI * r;
  const off = c - (v / 100) * c;
  return (
    <div className="relative grid place-items-center">
      <svg width="92" height="92" viewBox="0 0 92 92" className="-rotate-90">
        <circle cx="46" cy="46" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
        <motion.circle
          cx="46" cy="46" r={r} fill="none" stroke="url(#nbaGrad)" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: off }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
        <defs>
          <linearGradient id="nbaGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7C6CFF" /><stop offset="60%" stopColor="#3DD6F5" /><stop offset="100%" stopColor="#52E6C2" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-display text-xl font-semibold text-white">{v}</span>
        {label && <span className="text-[9px] uppercase tracking-wide text-slate-500">{label}</span>}
      </div>
    </div>
  );
}

/* The single focal point of the dashboard: one outcome headline, one primary
   CTA, a few quiet secondary jumps, and an optional readiness ring. Purely
   presentational — every dashboard computes these from its existing data. */
export function NextBestAction({ eyebrow = 'Next best action', title, description, primary, secondary = [], score = null, scoreLabel = 'Ready' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
      className="gradient-border relative overflow-hidden p-6 sm:p-7"
    >
      <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-aurora-violet/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-aurora-cyan/10 blur-3xl" />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-aurora-violet/30 bg-aurora-violet/10 px-2.5 py-1 text-[11px] font-medium text-[#C2BBFF]">
            <Sparkles size={12} /> {eyebrow}
          </span>
          <h2 className="mt-3 font-display text-2xl font-semibold leading-tight text-white sm:text-[26px]">{title}</h2>
          {description && <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">{description}</p>}
          {primary && (
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <button
                onClick={primary.onClick}
                className="btn-primary inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
              >
                {primary.icon ? <primary.icon size={16} /> : <Sparkles size={16} />}
                {primary.label}
                <ArrowRight size={15} />
              </button>
              {secondary.map((s) => (
                <button
                  key={s.label}
                  onClick={s.onClick}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[13px] text-slate-300 transition hover:border-white/25 hover:text-white"
                >
                  {s.icon && <s.icon size={14} />}{s.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {score != null && (
          <div className="shrink-0 self-start sm:self-center">
            <MiniRing value={score} label={scoreLabel} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function PageIntro({ title, sub, action }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-2xl font-semibold text-white sm:text-[28px]">{title}</h2>
        {sub && <p className="mt-1.5 text-sm text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({ icon: Icon, label, value, delta, hint, onClick, tone = 'violet', i = 0 }) {
  const c = { violet: 'text-aurora-violet', cyan: 'text-aurora-cyan', mint: 'text-aurora-mint', amber: 'text-amber-glow' }[tone];
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.5 }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      className={`gradient-border lift p-5 hover:shadow-glow ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-muted">{label}</span>
        {Icon && <span className={`grid h-9 w-9 place-items-center rounded-lg bg-white/[0.04] ring-1 ring-white/10 ${c}`}><Icon size={17} /></span>}
      </div>
      <div className="mt-3 flex items-end gap-2">
        <span className="font-display text-3xl font-semibold text-white">{value}</span>
        {delta && <span className="mb-1 text-xs font-medium text-aurora-mint">{delta}</span>}
      </div>
      {hint && <p className="mt-1.5 text-[11px] leading-snug text-slate-500">{hint}</p>}
    </motion.div>
  );
}

export function SectionCard({ title, action, className, children }) {
  return (
    <div className={`gradient-border p-5 ${className || ''}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between">
          {title && <h3 className="font-display text-[15px] font-semibold text-white">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function BarChart({ data, labels }) {
  const max = Math.max(...data, 1);
  return (
    <div>
      <div className="flex h-40 items-end gap-2">
        {data.map((v, i) => (
          <div key={i} className="group flex flex-1 flex-col items-center gap-2">
            <motion.div
              initial={{ height: 0 }} animate={{ height: `${(v / max) * 100}%` }} transition={{ delay: i * 0.05, duration: 0.6, ease: 'easeOut' }}
              className="w-full rounded-t-lg bg-gradient-to-t from-aurora-violet/40 to-aurora-cyan group-hover:from-aurora-violet/60"
            />
          </div>
        ))}
      </div>
      {labels && (
        <div className="mt-2 flex gap-2">
          {labels.map((l) => <span key={l} className="flex-1 text-center text-[11px] text-slate-500">{l}</span>)}
        </div>
      )}
    </div>
  );
}
