import { useEffect, useState } from 'react';
import { Check, X, Sparkles, Crown, Zap, Rocket } from 'lucide-react';
import { Modal, Button, Badge } from './ui/kit.jsx';

/* Open the pricing modal from anywhere: openPricing() or window event. */
export function openPricing(plan) {
  window.dispatchEvent(new CustomEvent('career-open-pricing', { detail: { plan } }));
}

const PLANS = [
  {
    id: 'free', name: 'Free', icon: Zap, tone: 'default', price: '₹0', cadence: 'forever',
    tagline: 'Get started and explore the workspace.',
    cta: 'Current plan', ctaVariant: 'soft',
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
    cta: 'Upgrade to Pro', ctaVariant: 'primary',
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
    cta: 'Go Premium', ctaVariant: 'primary',
    features: [
      { label: 'Resume tailoring', value: 'Unlimited' },
      { label: 'Contact search', value: 'Unlimited' },
      { label: 'Job tracking', value: 'Unlimited' },
      { label: 'Resume templates', value: 'All + custom uploads' },
      { label: 'Upload custom template', value: true },
      { label: 'PDF / DOCX export', value: 'PDF + DOCX' },
      { label: 'AI outreach drafts', value: 'Unlimited + follow-ups' },
    ],
  },
];

function Cell({ value }) {
  if (value === true) return <Check size={15} className="text-aurora-mint" />;
  if (value === false) return <X size={15} className="text-slate-600" />;
  return <span className="text-[12px] text-slate-200">{value}</span>;
}

export default function PricingModal() {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const onOpen = () => { setNotice(''); setOpen(true); };
    window.addEventListener('career-open-pricing', onOpen);
    return () => window.removeEventListener('career-open-pricing', onOpen);
  }, []);

  const choose = (plan) => {
    if (plan.id === 'free') { setNotice('You are on the Free plan.'); return; }
    setNotice(`Payment integration coming soon — ${plan.name} (${plan.price}${plan.cadence}) will be available shortly. We saved your interest.`);
  };

  return (
    <Modal open={open} onClose={() => setOpen(false)} width="max-w-5xl" title="Plans & pricing">
      <p className="mb-5 max-w-2xl text-sm text-muted">
        Pick the plan that matches your search. Upgrade, downgrade or cancel anytime — your resumes,
        templates and tracker data always stay with you.
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => {
          const Icon = plan.icon;
          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border p-5 ${
                plan.highlight ? 'border-aurora-violet/50 bg-aurora-violet/[0.07] ring-1 ring-aurora-violet/25'
                               : 'border-white/10 bg-white/[0.02]'
              }`}
            >
              {plan.highlight && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-aurora-cta px-3 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-glow">
                  Most popular
                </span>
              )}
              <div className="flex items-center gap-2">
                <span className={`grid h-9 w-9 place-items-center rounded-xl bg-white/[0.05] ring-1 ring-white/10 ${
                  plan.tone === 'violet' ? 'text-aurora-violet' : plan.tone === 'amber' ? 'text-amber-glow' : 'text-aurora-cyan'
                }`}>
                  <Icon size={18} />
                </span>
                <span className="font-display text-lg font-semibold text-white">{plan.name}</span>
              </div>
              <div className="mt-3 flex items-end gap-1">
                <span className="font-display text-3xl font-bold text-white">{plan.price}</span>
                <span className="mb-1 text-xs text-slate-500">{plan.cadence}</span>
              </div>
              <p className="mt-1.5 text-xs leading-snug text-slate-400">{plan.tagline}</p>

              <ul className="mt-4 flex-1 space-y-2.5 border-t border-white/8 pt-4">
                {plan.features.map((f) => (
                  <li key={f.label} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="text-slate-400">{f.label}</span>
                    <Cell value={f.value} />
                  </li>
                ))}
              </ul>

              <Button
                className="mt-5 w-full"
                variant={plan.ctaVariant === 'soft' ? 'soft' : 'primary'}
                onClick={() => choose(plan)}
              >
                {plan.id !== 'free' && <Sparkles size={15} />} {plan.cta}
              </Button>
            </div>
          );
        })}
      </div>

      {notice && (
        <div className="mt-5 rounded-xl border border-aurora-cyan/30 bg-aurora-cyan/10 px-4 py-3 text-sm text-slate-200">
          {notice}
        </div>
      )}
      <p className="mt-4 text-center text-[11px] text-slate-600">
        Prices shown in INR. Payment processing is being finalised — no card is charged yet.
      </p>
    </Modal>
  );
}
