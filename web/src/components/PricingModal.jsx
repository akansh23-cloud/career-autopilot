import { useEffect, useState } from 'react';
import { Check, X, Sparkles, Crown, Zap, Rocket, Loader2, ShieldCheck, AlertTriangle, BadgeCheck } from 'lucide-react';
import { Modal, Button, Badge } from './ui/kit.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { getPlan, PLAN_LABELS, PLAN_EVENT, getAllUsage, LIMITS, isUnlimited, METER_LABELS } from '../lib/plan.js';
import { startCheckout, createUpiPaymentLink, checkUpiPaymentLink, PaymentError } from '../lib/payments.js';

/* Open the pricing modal from anywhere: openPricing(plan, reason) or window event. */
export function openPricing(plan, reason) {
  window.dispatchEvent(new CustomEvent('career-open-pricing', { detail: { plan, reason } }));
}

const PLANS = [
  {
    id: 'free', name: 'Free', icon: Zap, tone: 'default', price: '₹0', cadence: 'forever',
    tagline: 'Get started and explore the workspace.',
    features: [
      { label: 'Resume tailoring', value: '3 / month' },
      { label: 'Contact search', value: '5 / month' },
      { label: 'Job tracking', value: 'Up to 20 jobs' },
      { label: 'Resume templates', value: '4 templates' },
      { label: 'Upload custom template', value: false },
      { label: 'PDF / DOCX export', value: 'PDF only' },
      { label: 'AI outreach drafts', value: '5 / month' },
    ],
  },
  {
    id: 'pro', name: 'Pro', icon: Rocket, tone: 'violet', price: '₹399', cadence: '/ month', highlight: true,
    tagline: 'For an active job search across many roles.',
    features: [
      { label: 'Resume tailoring', value: '50 / month' },
      { label: 'Contact search', value: '100 / month' },
      { label: 'Job tracking', value: 'Unlimited' },
      { label: 'Resume templates', value: 'All 8 templates' },
      { label: 'Upload custom template', value: true },
      { label: 'PDF / DOCX export', value: 'PDF + DOCX' },
      { label: 'AI outreach drafts', value: '100 / month' },
    ],
  },
  {
    id: 'premium', name: 'Premium', icon: Crown, tone: 'amber', price: '₹799', cadence: '/ month',
    tagline: 'Maximum firepower with unlimited everything.',
    features: [
      { label: 'Resume tailoring', value: 'Unlimited' },
      { label: 'Contact search', value: 'Unlimited' },
      { label: 'Job tracking', value: 'Unlimited' },
      { label: 'Resume templates', value: 'All + custom uploads' },
      { label: 'Upload custom template', value: true },
      { label: 'PDF / DOCX export', value: 'PDF + DOCX' },
      { label: 'AI outreach drafts', value: 'Unlimited + follow-ups' },
      { label: 'Recruiter & project features', value: true },
    ],
  },
];

function Cell({ value }) {
  if (value === true) return <Check size={15} className="text-aurora-mint" />;
  if (value === false) return <X size={15} className="text-slate-600" />;
  return <span className="text-[12px] text-slate-200">{value}</span>;
}

function ManagePlan({ plan }) {
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
          <Badge tone={plan.planId === 'free' ? 'default' : plan.planId === 'premium' ? 'amber' : 'violet'}>{PLAN_LABELS[plan.planId]}</Badge>
          <Badge tone={plan.status === 'active' ? 'mint' : 'amber'}>{plan.status === 'active' ? 'Active' : plan.status}</Badge>
          {plan.source === 'razorpay' && <Badge tone="cyan">Razorpay</Badge>}
        </div>
      </div>
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
      {plan.expiresAt && plan.planId !== 'free' && (
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
  const [upiLink, setUpiLink] = useState(null);
  const [upiBusyPlan, setUpiBusyPlan] = useState('');
  const [upiChecking, setUpiChecking] = useState(false);

  useEffect(() => {
    const onOpen = (e) => { setReason(e.detail?.reason || ''); setToast(null); setUpiLink(null); setPlanState(getPlan()); setOpen(true); };
    const onPlan = () => setPlanState(getPlan());
    window.addEventListener('career-open-pricing', onOpen);
    window.addEventListener(PLAN_EVENT, onPlan);
    return () => { window.removeEventListener('career-open-pricing', onOpen); window.removeEventListener(PLAN_EVENT, onPlan); };
  }, []);

  const phaseLabel = phase === 'creating' ? 'Creating order…' : phase === 'verifying' ? 'Verifying payment…' : 'Processing payment…';

  const createUpiLink = async (p) => {
    if (p.id === 'free' || p.id === plan.planId) return;
    setUpiBusyPlan(p.id); setToast(null); setUpiLink(null);
    try {
      const link = await createUpiPaymentLink(p.id);
      setUpiLink(link);
      setToast({ type: 'success', msg: 'UPI payment link generated. Open it, complete payment, then click Check status.' });
    } catch (e) {
      setToast({ type: 'error', msg: (e && e.message) || 'Could not generate UPI payment link.' });
    } finally { setUpiBusyPlan(''); }
  };

  const copyUpiLink = async () => {
    if (!upiLink?.shortUrl) return;
    try {
      await navigator.clipboard.writeText(upiLink.shortUrl);
      setToast({ type: 'success', msg: 'UPI payment link copied.' });
    } catch {
      setToast({ type: 'error', msg: 'Could not copy link. Open it directly instead.' });
    }
  };

  const checkUpiStatus = async () => {
    if (!upiLink?.paymentLinkId) return;
    setUpiChecking(true); setToast(null);
    try {
      const next = await checkUpiPaymentLink(upiLink.paymentLinkId);
      if (next) {
        setPlanState(next);
        setUpiLink(null);
        setToast({ type: 'success', msg: `Payment successful — you’re now on ${PLAN_LABELS[next.planId]}. Features unlocked.` });
      } else {
        setToast({ type: 'error', msg: 'Payment is not marked paid yet. Complete the UPI payment, then check again.' });
      }
    } catch (e) {
      setToast({ type: 'error', msg: (e && e.message) || 'Could not check payment status.' });
    } finally { setUpiChecking(false); }
  };

  const choose = async (p) => {
    if (p.id === 'free' || p.id === plan.planId) return;
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
      {reason && (
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
          const isCurrent = plan.planId === p.id;
          const isBusy = busyPlan === p.id;
          return (
            <div key={p.id} className={`relative flex flex-col rounded-2xl border p-5 ${p.highlight && !isCurrent ? 'border-aurora-violet/50 bg-aurora-violet/[0.07] ring-1 ring-aurora-violet/25' : isCurrent ? 'border-aurora-mint/40 bg-aurora-mint/[0.05]' : 'border-white/10 bg-white/[0.02]'}`}>
              {p.highlight && !isCurrent && (
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
                variant={isCurrent ? 'soft' : p.id === 'free' ? 'soft' : 'primary'}
                disabled={isCurrent || p.id === 'free' || isBusy || !!busyPlan || !!upiBusyPlan}
                onClick={() => choose(p)}
              >
                {isBusy ? <><Loader2 size={15} className="animate-spin" /> {phaseLabel}</>
                  : isCurrent ? <><Check size={15} /> Current plan</>
                  : p.id === 'free' ? 'Free plan'
                  : <><Sparkles size={15} /> {p.id === 'pro' ? 'Upgrade to Pro' : 'Go Premium'}</>}
              </Button>
              {p.id !== 'free' && !isCurrent && (
                <Button
                  className="mt-2 w-full"
                  variant="soft"
                  disabled={!!busyPlan || !!upiBusyPlan}
                  onClick={() => createUpiLink(p)}
                >
                  {upiBusyPlan === p.id ? <><Loader2 size={15} className="animate-spin" /> Generating UPI link…</> : 'Pay via UPI link'}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {upiLink && (
        <div className="mt-5 rounded-2xl border border-aurora-cyan/25 bg-aurora-cyan/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">UPI payment link ready</div>
              <p className="mt-1 text-xs text-slate-400">Open this Razorpay link, complete payment, then return here and check status. Your plan is upgraded only after Razorpay marks it paid.</p>
            </div>
            <Badge tone="cyan">{upiLink.planId === 'premium' ? 'Premium' : 'Pro'} · ₹{Math.round((upiLink.amount || 0) / 100)}</Badge>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => window.open(upiLink.shortUrl, '_blank', 'noopener,noreferrer')}>Open UPI link</Button>
            <Button variant="soft" onClick={copyUpiLink}>Copy link</Button>
            <Button variant="soft" disabled={upiChecking} onClick={checkUpiStatus}>
              {upiChecking ? <><Loader2 size={15} className="animate-spin" /> Checking…</> : 'Check payment status'}
            </Button>
          </div>
        </div>
      )}

      {toast && (
        <div className={`mt-5 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${toast.type === 'success' ? 'border-aurora-mint/30 bg-aurora-mint/10 text-slate-100' : 'border-rose-400/30 bg-rose-500/10 text-rose-200'}`}>
          {toast.type === 'success' ? <ShieldCheck size={16} className="text-aurora-mint" /> : <AlertTriangle size={16} />} {toast.msg}
        </div>
      )}

      <ManagePlan plan={plan} />

      <p className="mt-4 text-center text-[11px] text-slate-600">
        Prices in INR. Secured by Razorpay. You can use Checkout or UPI payment link. Your card details are never stored by Career Autopilot.
      </p>
    </Modal>
  );
}
