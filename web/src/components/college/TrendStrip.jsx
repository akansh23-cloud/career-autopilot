/* ============================================================
   Trend strip
   ------------------------------------------------------------
   Turns the command center's point-in-time KPIs into movement.

   The honesty rule this component exists to enforce: stock metrics
   (avg readiness, recruiter-ready count) cannot be reconstructed
   retroactively, so until the server has stored enough daily
   snapshots there IS no delta. In that case this renders an explicit
   "collecting baseline" state rather than a reassuring +0. Flow
   metrics come from the event log and are trustworthy on day one, so
   they are shown separately and always.
   ============================================================ */
import { ArrowUpRight, ArrowDownRight, Minus, History, Activity } from 'lucide-react';

function DeltaPill({ delta, pctChange, higherIsBetter = true, suffix = '' }) {
  if (delta == null) return null;
  if (delta === 0) {
    return <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-500"><Minus size={11} /> no change</span>;
  }
  const up = delta > 0;
  // "Good" is not the same as "up" — a falling at-risk count is an improvement.
  const good = higherIsBetter ? up : !up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${good ? 'text-aurora-mint' : 'text-amber-glow'}`}>
      <Icon size={11} />
      {up ? '+' : ''}{delta}{suffix}
      {pctChange != null && <span className="ml-0.5 font-normal text-slate-500">({up ? '+' : ''}{pctChange}%)</span>}
    </span>
  );
}

export default function TrendStrip({ trends }) {
  const stock = trends?.stock;
  const flow = trends?.flow;
  if (!stock && !flow) return null;

  const flowItems = [flow?.verifications, flow?.resumes].filter(Boolean);

  return (
    <div className="space-y-3">
      {/* Stock metrics — need stored history */}
      {stock?.hasBaseline ? (
        <>
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <History size={12} />
            Compared with {stock.baselineDays} day{stock.baselineDays === 1 ? '' : 's'} ago
            {stock.baselineDays < stock.windowDays && ' — the oldest snapshot on record'}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stock.metrics.map((m) => (
              <div key={m.key} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-400">{m.label}</span>
                  <DeltaPill delta={m.delta} pctChange={m.pctChange} higherIsBetter={m.higherIsBetter} />
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-display text-xl font-bold text-white">{m.value}</span>
                  {m.previous != null && <span className="text-[11px] text-slate-600">was {m.previous}</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-sm text-slate-400">
          <span className="flex items-center gap-1.5">
            <History size={13} className="shrink-0" />
            Collecting the baseline. Cohort averages can’t be reconstructed backwards, so month-on-month movement
            appears once this workspace has a day or more of stored history — no invented trendline in the meantime.
          </span>
        </div>
      )}

      {/* Flow metrics — always available from the event log */}
      {flowItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-xs text-slate-500"><Activity size={12} /> Last {flow.windowDays} days vs the {flow.windowDays} before</span>
          {flowItems.map((f) => (
            <span key={f.key} className="flex items-center gap-1.5 text-sm">
              <span className="text-slate-400">{f.label}</span>
              <span className="font-semibold text-white">{f.current}</span>
              <DeltaPill delta={f.delta} pctChange={f.pctChange} higherIsBetter />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
