import { motion } from 'framer-motion';

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

export function StatCard({ icon: Icon, label, value, delta, tone = 'violet', i = 0 }) {
  const c = { violet: 'text-aurora-violet', cyan: 'text-aurora-cyan', mint: 'text-aurora-mint', amber: 'text-amber-glow' }[tone];
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.5 }}
      className="gradient-border lift p-5 hover:shadow-glow"
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-muted">{label}</span>
        {Icon && <span className={`grid h-9 w-9 place-items-center rounded-lg bg-white/[0.04] ring-1 ring-white/10 ${c}`}><Icon size={17} /></span>}
      </div>
      <div className="mt-3 flex items-end gap-2">
        <span className="font-display text-3xl font-semibold text-white">{value}</span>
        {delta && <span className="mb-1 text-xs font-medium text-aurora-mint">{delta}</span>}
      </div>
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
