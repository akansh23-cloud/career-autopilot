import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';

/* ============================================================
   Shared page-composition system (v4, enterprise light).
   Compact operational rhythm: a quiet page header, purposeful
   section cards, dense metric tiles and one clearly-primary
   action per page. Export names/props unchanged for drop-in
   compatibility across every view.
   ============================================================ */

/* Compact readiness ring used by dashboard heroes. */
function MiniRing({ value = 0, label }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const r = 34;
  const c = 2 * Math.PI * r;
  const off = c - (v / 100) * c;
  return (
    <div className="relative grid place-items-center">
      <svg width="88" height="88" viewBox="0 0 88 88" className="-rotate-90">
        <circle cx="44" cy="44" r={r} fill="none" stroke="var(--border-subtle)" strokeWidth="7" />
        <motion.circle
          cx="44" cy="44" r={r} fill="none" stroke="var(--brand-solid)" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: off }}
          transition={{ duration: 0.9, ease: [0.2, 0.7, 0.2, 1] }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="tabular text-xl font-semibold text-fg">{v}</span>
        {label && <span className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">{label}</span>}
      </div>
    </div>
  );
}

/* A page's single focal point: one outcome headline + one primary CTA. */
export function NextBestAction({ eyebrow = 'Next best action', title, description, primary, secondary = [], score = null, scoreLabel = 'Ready' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: 'easeOut' }}
      className="panel relative overflow-hidden p-5 sm:p-6"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-aurora-violet" />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand">
            <Sparkles size={12} /> {eyebrow}
          </span>
          <h2 className="mt-1.5 text-lg font-semibold leading-snug text-fg sm:text-xl">{title}</h2>
          {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-fg-secondary">{description}</p>}
          {primary && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={primary.onClick}
                className="btn-primary inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold"
              >
                {primary.icon && <primary.icon size={15} />}
                <span>{primary.label}</span>
                <ArrowRight size={14} />
              </button>
              {secondary.map((s) => (
                <button
                  key={s.label}
                  onClick={s.onClick}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-subtle bg-elevated px-3.5 text-[13px] font-medium text-fg-secondary transition-colors hover:border-strong hover:text-fg"
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

/* The page header — compact, professional: title, subtitle, page actions. */
export function PageIntro({ title, sub, action, eyebrow }) {
  return (
    <header className="mb-6 border-b border-subtle pb-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 max-w-3xl">
          {eyebrow && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{eyebrow}</p>}
          <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{title}</h1>
          {sub && <p className="mt-1 text-sm leading-relaxed text-fg-secondary">{sub}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
    </header>
  );
}

/* Compact metric tile. */
export function StatCard({ icon: Icon, label, value, delta, hint, onClick, tone = 'violet', i = 0 }) {
  const iconTone = {
    violet: 'text-aurora-violet',
    cyan: 'text-info',
    mint: 'text-ok',
    amber: 'text-warn',
  }[tone] || 'text-fg-muted';
  const Cmp = onClick ? 'button' : 'div';
  return (
    <Cmp
      onClick={onClick}
      className={`panel p-4 text-left ${onClick ? 'lift cursor-pointer' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-fg-muted">{label}</span>
        {Icon && <Icon size={16} className={`shrink-0 ${iconTone}`} />}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="tabular text-2xl font-semibold leading-none tracking-tight text-fg">{value}</span>
        {delta && <span className="text-xs font-medium text-ok">{delta}</span>}
      </div>
      {hint && <p className="mt-1.5 text-[11px] leading-snug text-fg-muted">{hint}</p>}
    </Cmp>
  );
}

/* Content section card with optional header. */
export function SectionCard({ title, action, className, children, eyebrow }) {
  return (
    <section className={`panel p-5 ${className || ''}`}>
      {(title || action || eyebrow) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow && <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{eyebrow}</p>}
            {title && <h3 className="text-sm font-semibold text-fg">{title}</h3>}
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
      <div className="flex h-40 items-end gap-2 border-b border-subtle pb-px">
        {data.map((v, i) => (
          <div key={i} className="group flex flex-1 flex-col items-center justify-end">
            <motion.div
              initial={{ height: 0 }} animate={{ height: `${(v / max) * 100}%` }} transition={{ delay: i * 0.03, duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }}
              className="w-full max-w-[36px] rounded-t-sm bg-aurora-violet/75 transition-colors group-hover:bg-aurora-violet"
              title={String(v)}
            />
          </div>
        ))}
      </div>
      {labels && (
        <div className="mt-2 flex gap-2">
          {labels.map((l) => <span key={l} className="flex-1 truncate text-center text-[11px] text-fg-muted">{l}</span>)}
        </div>
      )}
    </div>
  );
}
