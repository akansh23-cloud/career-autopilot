import { useEffect, useState } from 'react';
import { Check, X, Sparkles, Crown, Zap, Rocket, Loader2, ShieldCheck, AlertTriangle, BadgeCheck } from 'lucide-react';
import { Modal, Button, Badge } from './ui/kit.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { getPlan, PLAN_LABELS, PLAN_EVENT, getAllUsage, LIMITS, isUnlimited, METER_LABELS } from '../lib/plan.js';
import { startCheckout, PaymentError } from '../lib/payments.js';

/* Open the pricing modal from anywhere: openPricing(plan, reason) or window event. */
export function openPricing(plan, reason) {
  window.dispatchEvent(new CustomEvent('career-open-pricing', { detail: { plan, reason } }));
}

const PLANS = [
  {
    id: 'free', name: 'Free', icon: Zap, tone: 'default', price: '₹0', cadence: 'forever',
    tagline: 'Get started and explore the workspace.',
    features: [
      { label: 'Active project workspaces', value: '1' },
      { label: 'AI project roadmaps', value: '2 / month' },
      { label: 'Resume tailoring', value: '3 / month' },
      { label: 'Contact search', value: '5 / month' },
      { label: 'Job tracking', value: 'Up to 20 jobs' },
      { label: 'Sandbox publishing', value: '1 project' },
      { label: 'Project proof score', value: 'Basic' },
      { label: 'Skill XP & badges', value: 'Basic (non-verified)' },
      { label: 'Resume templates', value: '4 templates' },
      { label: 'PDF / DOCX export', value: 'PDF only' },
      { label: 'Upload custom template', value: false },
    ],
  },
  {
    id: 'pro', name: 'Pro', icon: Rocket, tone: 'violet', price: '₹399', cadence: '/ month', highlight: true,
    tagline: 'Build proof, earn verified badges, get noticed.',
    features: [
      { label: 'Active project workspaces', value: 'Up to 10' },
      { label: 'AI generations', value: '100 / month' },
      { label: 'Resume tailoring', value: '50 / month' },
      { label: 'Contact search', value: '100 / month' },
      { label: 'Job tracking', value: 'Unlimited' },
      { label: 'Sandbox publishing', value: 'Up to 5 projects' },
      { label: 'Detailed project guides + Enhancer', value: true },
      { label: 'Skill Gap → Project generator', value: true },
      { label: 'Skill XP & Project Verified badges', value: true },
      { label: 'README / bullets / LinkedIn / interview prep', value: true },
      { label: 'Partner matching + placement readiness', value: true },
      { label: 'Role fit score', value: 'Basic' },
      { label: 'PDF / DOCX export + custom templates', value: true },
    ],
  },
  {
    id: 'premium', name: 'Premium', icon: Crown, tone: 'amber', price: '₹799', cadence: '/ month',
    tagline: 'Recruiter-ready proof with unlimited firepower.',
    features: [
      { label: 'Workspaces / AI / tailoring / contacts', value: 'Unlimited*' },
      { label: 'Advanced project & deployment verification', value: true },
      { label: 'Recruiter-Ready badges', value: true },
      { label: 'Boosted sandbox visibility', value: true },
      { label: 'Advanced GitHub analyzer', value: true },
      { label: 'Advanced role fit score', value: true },
      { label: 'Recruiter discovery', value: true },
      { label: 'AI outreach sequences + follow-ups', value: true },
      { label: 'Advanced referral finder', value: true },
      { label: 'Full interview prep + mock defense', value: true },
      { label: 'Full analytics dashboard', value: true },
      { label: 'All templates + custom uploads', value: true },
    ],
  },
];

function Cell({ value }) {
  if (value === true) return <Check size={15} className="text-aurora-mint" />;
  if (value === false) return <X size={15} className="text-slate-600" />;
  return <span className="text-[12px] text-slate-200">{value}</span>;
}

function ManagePlan({ plan }) {
  const isAdmin = !!plan.isAdmin;
  const usage = getAllUsage();
  const lim = LIMITS[plan.planId] || LIMITS.free;
  const meters = ['tailoring', 'contacts', 'outreach'];
  return (
    <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BadgeCheck size={16} className="text-aurora-mint" />
          <span className="text-sm font-semibold text-white">Manage plan</span>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin
            ? <Badge tone="mint">Admin · Full Access</Badge>
            : <Badge tone={plan.planId === 'free' ? 'default' : plan.planId === 'premium' ? 'amber' : 'violet'}>{PLAN_LABELS[plan.planId]}</Badge>}
          <Badge tone="mint">Active</Badge>
          {!isAdmin && plan.source === 'razorpay' && <Badge tone="cyan">Razorpay</Badge>}
        </div>
      </div>
      {isAdmin ? (
        <p className="mt-3 text-[12px] text-slate-400">All features are unlocked on this account — unlimited tailoring, contacts, outreach, tracking, every template and custom uploads. No usage limits apply.</p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {meters.map((m) => {
            const max = lim[m];
            const used = Number(usage[m] || 0);
            const pct = isUnlimited(max) ? 0 : Math.min(100, Math.round((used / max) * 100));
            return (
              <div key={m} className="rounded-xl border border-white/8 bg-ink-950/55 p-2.5">
                <div className="flex justify-between text-[10px] text-slate-400"><span className="capitalize">{METER_LABELS[m]}</span><span>{used}{isUnlimited(max) ? '' : ` / ${max}`}</span></div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-aurora-cta" style={{ width: `${isUnlimited(max) ? 8 : pct}%` }} /></div>
                {isUnlimited(max) && <span className="mt-1 block text-[9px] text-aurora-mint">Unlimited</span>}
              </div>
            );
          })}
        </div>
      )}
      {!isAdmin && plan.expiresAt && plan.planId !== 'free' && (
        <p className="mt-2 text-[11px] text-slate-500">Renews/expires on {new Date(plan.expiresAt).toLocaleDateString()}.</p>
      )}
    </div>
  );
}

export default function PricingModal() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [plan, setPlanState] = useState(getPlan());
  const [reason, setReason] = useState('');
  const [busyPlan, setBusyPlan] = useState('');
  const [phase, setPhase] = useState('');
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const onOpen = (e) => { setReason(e.detail?.reason || ''); setToast(null); setPlanState(getPlan()); setOpen(true); };
    const onPlan = () => setPlanState(getPlan());
    window.addEventListener('career-open-pricing', onOpen);
    window.addEventListener(PLAN_EVENT, onPlan);
    return () => { window.removeEventListener('career-open-pricing', onOpen); window.removeEventListener(PLAN_EVENT, onPlan); };
  }, []);

  const phaseLabel = phase === 'creating' ? 'Creating order…' : phase === 'verifying' ? 'Verifying payment…' : 'Processing payment…';
  const isAdmin = !!plan.isAdmin;

  const choose = async (p) => {
    if (isAdmin || p.id === 'free' || p.id === plan.planId) return;
    setBusyPlan(p.id); setPhase('creating'); setToast(null);
    try {
      const next = await startCheckout(p.id, { user, onState: setPhase });
      setPlanState(next);
      setToast({ type: 'success', msg: `Payment successful — you’re now on ${PLAN_LABELS[next.planId]}. Features unlocked.` });
    } catch (e) {
      if (e instanceof PaymentError && e.code === 'dismissed') { setToast(null); }
      else setToast({ type: 'error', msg: (e && e.message) || 'Payment could not be completed.' });
    } finally { setBusyPlan(''); setPhase(''); }
  };

  return (
    <Modal open={open} onClose={() => setOpen(false)} width="max-w-5xl" title="Plans & pricing">
      {isAdmin && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-aurora-mint/30 bg-aurora-mint/10 px-4 py-3 text-sm text-slate-100">
          <ShieldCheck size={16} className="text-aurora-mint" /> You have admin full access. Payment is not required for this account.
        </div>
      )}
      {reason && !isAdmin && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-glow/30 bg-amber-glow/10 px-4 py-2.5 text-sm text-amber-glow">
          <AlertTriangle size={15} /> {reason}
        </div>
      )}
      <p className="mb-5 max-w-2xl text-sm text-muted">
        Pick the plan that matches your search. Upgrade anytime — your resumes, templates and tracker data always stay with you.
        Payments are processed securely by Razorpay in INR.
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => {
          const Icon = p.icon;
          const isCurrent = !isAdmin && plan.planId === p.id;
          const isBusy = busyPlan === p.id;
          return (
            <div key={p.id} className={`relative flex flex-col rounded-2xl border p-5 ${p.highlight && !isCurrent && !isAdmin ? 'border-aurora-violet/50 bg-aurora-violet/[0.07] ring-1 ring-aurora-violet/25' : isCurrent ? 'border-aurora-mint/40 bg-aurora-mint/[0.05]' : 'border-white/10 bg-white/[0.02]'}`}>
              {p.highlight && !isCurrent && !isAdmin && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-aurora-cta px-3 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-glow">Most popular</span>
              )}
              {isCurrent && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-aurora-mint px-3 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-950">Current plan</span>
              )}
              <div className="flex items-center gap-2">
                <span className={`grid h-9 w-9 place-items-center rounded-xl bg-white/[0.05] ring-1 ring-white/10 ${p.tone === 'violet' ? 'text-aurora-violet' : p.tone === 'amber' ? 'text-amber-glow' : 'text-aurora-cyan'}`}><Icon size={18} /></span>
                <span className="font-display text-lg font-semibold text-white">{p.name}</span>
              </div>
              <div className="mt-3 flex items-end gap-1">
                <span className="font-display text-3xl font-bold text-white">{p.price}</span>
                <span className="mb-1 text-xs text-slate-500">{p.cadence}</span>
              </div>
              <p className="mt-1.5 text-xs leading-snug text-slate-400">{p.tagline}</p>

              <ul className="mt-4 flex-1 space-y-2.5 border-t border-white/8 pt-4">
                {p.features.map((f) => (
                  <li key={f.label} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="text-slate-400">{f.label}</span>
                    <Cell value={f.value} />
                  </li>
                ))}
              </ul>

              <Button
                className="mt-5 w-full"
                variant={isAdmin ? 'soft' : isCurrent ? 'soft' : p.id === 'free' ? 'soft' : 'primary'}
                disabled={isAdmin || isCurrent || p.id === 'free' || isBusy || !!busyPlan}
                onClick={() => choose(p)}
              >
                {isAdmin ? <><Check size={15} /> Included</>
                  : isBusy ? <><Loader2 size={15} className="animate-spin" /> {phaseLabel}</>
                  : isCurrent ? <><Check size={15} /> Current plan</>
                  : p.id === 'free' ? 'Free plan'
                  : <><Sparkles size={15} /> {p.id === 'pro' ? 'Upgrade to Pro' : 'Go Premium'}</>}
              </Button>
            </div>
          );
        })}
      </div>

      {toast && (
        <div className={`mt-5 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${toast.type === 'success' ? 'border-aurora-mint/30 bg-aurora-mint/10 text-slate-100' : 'border-rose-400/30 bg-rose-500/10 text-rose-200'}`}>
          {toast.type === 'success' ? <ShieldCheck size={16} className="text-aurora-mint" /> : <AlertTriangle size={16} />} {toast.msg}
        </div>
      )}

      <ManagePlan plan={plan} />

      <p className="mt-4 text-center text-[11px] text-slate-600">
        *Unlimited subject to fair usage. Prices in INR. Secured by Razorpay (cards, UPI & netbanking). Your payment details are never stored by Career Autopilot.
      </p>
    </Modal>
  );
}
