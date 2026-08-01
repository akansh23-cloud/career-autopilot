/* ============================================================
   PLAN USAGE STRIP
   ------------------------------------------------------------
   Answers the question a capped student cannot otherwise answer:
   "what am I actually allowed to do right now, and when does it
   reset?"

   Shows BOTH numbers that govern them, because the app has two:
     - the monthly entitlement from their plan (plan.js)
     - the daily compute allowance the server enforces (quota.js),
       live from the last metered response

   Previously neither was visible anywhere, so hitting a limit looked
   identical to the feature being broken.
   ============================================================ */
import { useEffect, useState } from 'react';
import { Gauge, Infinity as InfinityIcon } from 'lucide-react';
import { Badge, Button } from './ui/kit.jsx';
import {
  getPlan, PLAN_EVENT, PLAN_LABELS_FULL, METER_LABELS, effectivePlan,
  remaining, limitsFor, isUnlimited, dailyBucketLimit, promptUpgrade, getUsage,
} from '../lib/plan.js';
import { QUOTA_EVENT, getQuotaState, formatResetAt, BUCKET_SHORT } from '../lib/quota.js';

/* The meters worth surfacing on a dashboard — the ones students actually
   run out of. Deliberately short; this is a strip, not a billing page. */
const SHOWN = ['tailoring', 'aiGen', 'contacts', 'workspaces'];

function Meter({ meter, planId }) {
  const limit = limitsFor(planId)[meter];
  const left = remaining(meter, planId);
  const used = getUsage(meter);
  const unlimited = isUnlimited(limit);
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const tone = unlimited ? 'mint' : left === 0 ? 'rose' : left <= Math.max(1, limit * 0.25) ? 'amber' : 'cyan';
  const daily = dailyBucketLimit(meter, planId);

  return (
    <div className="min-w-0 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] capitalize leading-snug text-slate-300">{METER_LABELS[meter] || meter}</span>
        <Badge tone={tone}>
          {unlimited ? <><InfinityIcon size={11} /> Unlimited</> : `${left} left`}
        </Badge>
      </div>
      {!unlimited && (
        <>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/8">
            <div
              className={`h-full rounded-full transition-all ${left === 0 ? 'bg-rose-400/70' : 'bg-gradient-to-r from-aurora-mint to-aurora-violet'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            {used} of {limit} this month
            {!isUnlimited(daily) && <> · {daily}/day account cap</>}
          </div>
        </>
      )}
      {unlimited && !isUnlimited(daily) && (
        <div className="mt-3 text-[11px] text-slate-500">{daily} per day account cap</div>
      )}
    </div>
  );
}

export default function PlanUsageStrip() {
  const [, setTick] = useState(0);
  const [quota, setQuota] = useState(getQuotaState());

  useEffect(() => {
    const onPlan = () => setTick((t) => t + 1);
    const onQuota = () => setQuota(getQuotaState());
    window.addEventListener(PLAN_EVENT, onPlan);
    window.addEventListener(QUOTA_EVENT, onQuota);
    return () => {
      window.removeEventListener(PLAN_EVENT, onPlan);
      window.removeEventListener(QUOTA_EVENT, onQuota);
    };
  }, []);

  const plan = getPlan();
  const eff = effectivePlan();
  const planId = plan.planId || 'free';
  const isAdmin = eff === 'admin';

  /* Any bucket the server has told us is running low today. */
  const lowBuckets = Object.entries(quota)
    .filter(([, v]) => v && Number.isFinite(v.remaining) && v.remaining <= 3)
    .map(([bucket, v]) => ({ bucket, ...v }));

  return (
    <section className="mb-6 rounded-3xl border border-white/8 bg-white/[0.02] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Gauge size={16} className="text-aurora-cyan" />
          <span className="text-[13.5px] font-semibold text-white">Your plan</span>
          <Badge tone={isAdmin ? 'violet' : planId === 'free' ? 'default' : 'mint'}>
            {PLAN_LABELS_FULL[eff] || 'Free'}
          </Badge>
        </div>
        {!isAdmin && planId !== 'premium' && (
          <Button size="sm" variant="soft" onClick={() => promptUpgrade('Raise your monthly and daily limits.', planId === 'pro' ? 'premium' : 'pro')}>
            Compare plans
          </Button>
        )}
      </div>

      {isAdmin ? (
        <p className="text-[13px] text-slate-400">Full access — no monthly or daily limits apply to this account.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {SHOWN.map((m) => <Meter key={m} meter={m} planId={planId} />)}
        </div>
      )}

      {lowBuckets.length > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-400/8 p-3.5 text-[12.5px] leading-relaxed text-amber-100">
          {lowBuckets.map((b) => (
            <div key={b.bucket}>
              {BUCKET_SHORT[b.bucket] || b.bucket}: {b.remaining} left today
              {b.resetAt ? ` — resets ${formatResetAt(b.resetAt)}.` : ' — resets at midnight UTC.'}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
