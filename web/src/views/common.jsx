import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';

/* ============================================================
   Shared page-composition system (website-grade).
   These primitives give every internal view a spacious, editorial
   rhythm — a real page hero, breathing sections, generous stats —
   so the app reads like a designed product site, not a dense tool.
   Export names/props are unchanged for drop-in compatibility.
   ============================================================ */

/* Compact readiness ring used by dashboard heroes. */
function MiniRing({ value = 0, label }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const r = 38;
  const c = 2 * Math.PI * r;
  const off = c - (v / 100) * c;
  return (
    <div className="relative grid place-items-center">
      <svg width="104" height="104" viewBox="0 0 104 104" className="-rotate-90">
        <circle cx="52" cy="52" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="9" />
        <motion.circle
          cx="52" cy="52" r={r} fill="none" stroke="url(#nbaGrad)" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: off }}
          transition={{ duration: 1.1, ease: [0.2, 0.7, 0.2, 1] }}
        />
        <defs>
          <linearGradient id="nbaGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#EAC97C" /><stop offset="55%" stopColor="#BCA8FF" /><stop offset="100%" stopColor="#7C6BF2" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-display text-2xl font-extrabold text-white">{v}</span>
        {label && <span className="font-mono text-[9px] uppercase tracking-widest text-slate-500">{label}</span>}
      </div>
    </div>
  );
}

/* A page's single focal point: one outcome headline + one primary CTA. */
export function NextBestAction({ eyebrow = 'Next best action', title, description, primary, secondary = [], score = null, scoreLabel = 'Ready' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: [0.2, 0.7, 0.2, 1] }}
      className="gradient-border spotlight relative overflow-hidden p-7 sm:p-9"
    >
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-aurora-violet/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 left-1/3 h-52 w-52 rounded-full bg-aurora-indigo/12 blur-3xl" />
      <div className="relative flex flex-col gap-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-aurora-violet/30 bg-aurora-violet/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[#E4DCFF]">
            <Sparkles size={12} /> {eyebrow}
          </span>
          <h2 className="mt-4 font-display text-[26px] font-extrabold leading-[1.05] text-white sm:text-[32px]">{title}</h2>
          {description && <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-slate-400">{description}</p>}
          {primary && (
            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <button
                onClick={primary.onClick}
                className="btn-primary inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold"
              >
                {primary.icon ? <primary.icon size={16} className="relative z-[2]" /> : <Sparkles size={16} className="relative z-[2]" />}
                <span className="relative z-[2]">{primary.label}</span>
                <ArrowRight size={15} className="relative z-[2]" />
              </button>
              {secondary.map((s) => (
                <button
                  key={s.label}
                  onClick={s.onClick}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.03] px-4 py-3 text-[13px] text-slate-300 transition hover:border-aurora-violet/40 hover:text-white"
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

/* The page hero — eyebrow, large display title, subtitle, action, divider. */
export function PageIntro({ title, sub, action, eyebrow }) {
  return (
    <motion.header
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
      className="mb-9 sm:mb-11"
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          {eyebrow && <span className="block font-mono text-[11px] uppercase tracking-[0.3em] text-aurora-violet/75">{eyebrow}</span>}
          <h1 className="mt-2 font-display text-[clamp(28px,4vw,44px)] font-extrabold leading-[1.03] tracking-tight text-white">{title}</h1>
          {sub && <p className="mt-3 text-[15px] leading-relaxed text-slate-400 sm:text-[16px]">{sub}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="mt-7 h-px w-full bg-gradient-to-r from-aurora-violet/35 via-white/[0.07] to-transparent" />
    </motion.header>
  );
}

/* Editorial stat block. */
export function StatCard({ icon: Icon, label, value, delta, hint, onClick, tone = 'violet', i = 0 }) {
  const c = { violet: 'text-aurora-violet', cyan: 'text-aurora-cyan', mint: 'text-aurora-mint', amber: 'text-amber-glow' }[tone];
  const ring = { violet: 'ring-aurora-violet/20 bg-aurora-violet/10', cyan: 'ring-aurora-cyan/20 bg-aurora-cyan/10', mint: 'ring-aurora-mint/20 bg-aurora-mint/10', amber: 'ring-amber-glow/20 bg-amber-glow/10' }[tone];
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.5 }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      className={`gradient-border lift p-6 hover:border-aurora-violet/35 hover:shadow-glow ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        {Icon && <span className={`grid h-10 w-10 place-items-center rounded-xl ring-1 ${ring} ${c}`}><Icon size={18} /></span>}
      </div>
      <div className="mt-4 flex items-end gap-2">
        <span className="font-display text-[34px] font-extrabold leading-none text-white">{value}</span>
        {delta && <span className="mb-1 text-xs font-semibold text-aurora-mint">{delta}</span>}
      </div>
      {hint && <p className="mt-2 text-[11px] leading-snug text-slate-500">{hint}</p>}
    </motion.div>
  );
}

/* Breathing content section with optional eyebrow + heading. */
export function SectionCard({ title, action, className, children, eyebrow }) {
  return (
    <section className={`gradient-border p-6 sm:p-7 ${className || ''}`}>
      {(title || action || eyebrow) && (
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow && <span className="block font-mono text-[10px] uppercase tracking-[0.24em] text-aurora-violet/70">{eyebrow}</span>}
            {title && <h3 className="font-display text-[18px] font-bold text-white">{title}</h3>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function BarChart({ data, labels }) {
  const max = Math.max(...data, 1);
  return (
    <div>
      <div className="flex h-44 items-end gap-2.5">
        {data.map((v, i) => (
          <div key={i} className="group flex flex-1 flex-col items-center gap-2">
            <motion.div
              initial={{ height: 0 }} animate={{ height: `${(v / max) * 100}%` }} transition={{ delay: i * 0.05, duration: 0.7, ease: [0.2, 0.7, 0.2, 1] }}
              className="w-full rounded-t-lg bg-gradient-to-t from-aurora-indigo/50 to-aurora-violet group-hover:from-aurora-indigo/70"
            />
          </div>
        ))}
      </div>
      {labels && (
        <div className="mt-2.5 flex gap-2.5">
          {labels.map((l) => <span key={l} className="flex-1 text-center text-[11px] text-slate-500">{l}</span>)}
        </div>
      )}
    </div>
  );
}
