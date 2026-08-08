import { useEffect, useState } from 'react';
import { ArrowLeft, ScrollText, ShieldCheck, ReceiptIndianRupee, LifeBuoy } from 'lucide-react';
import Atmosphere from '../components/Atmosphere.jsx';
import { api } from '../lib/api.js';
import { TERMS_SECTIONS, REFUND_SECTIONS, PRIVACY_SUMMARY, LEGAL_EFFECTIVE } from '../lib/legalContent.js';

/* ============================================================
   LEGAL VIEW  (#/legal · #/legal/terms|privacy|refunds|contact)
   ------------------------------------------------------------
   A fully PUBLIC route: renders signed-out (payment-provider
   reviewers, college admin offices) and signed-in (consent-modal
   link) alike. Contact + grievance details come from GET /api/legal
   so the deployment operator is always the named entity.
   ============================================================ */

const TABS = [
  { id: 'terms', label: 'Terms of Service', icon: ScrollText },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck },
  { id: 'refunds', label: 'Refunds & Cancellation', icon: ReceiptIndianRupee },
  { id: 'contact', label: 'Contact & Grievance', icon: LifeBuoy },
];

function Sections({ sections }) {
  return (
    <div className="space-y-7">
      {sections.map((s) => (
        <section key={s.h}>
          <h2 className="font-display text-[15px] font-semibold text-fg">{s.h}</h2>
          {s.p.map((para, i) => (
            <p key={i} className="mt-2 text-[13.5px] leading-relaxed text-fg-secondary">{para}</p>
          ))}
        </section>
      ))}
    </div>
  );
}

function ContactTab({ meta }) {
  const rows = [
    ['Operator', meta?.entityName, meta?.entityLocation],
    ['Support', meta?.supportEmail, 'Product questions, billing, refunds — include your account email and any payment id.'],
    ['DPDP grievance officer', meta?.grievanceEmail, `Data-protection grievances (access, correction, erasure, consent). Response within ${meta?.grievanceResponseDays ?? 7} days.`],
  ];
  return (
    <div className="space-y-4">
      {rows.map(([label, value, note]) => (
        <div key={label} className="rounded-xl border border-subtle bg-surface-1 p-4">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-fg-muted">{label}</p>
          <p className="mt-1 text-[15px] font-medium text-fg">{value || '—'}</p>
          {note && <p className="mt-1 text-[12px] leading-relaxed text-fg-secondary">{note}</p>}
        </div>
      ))}
      <p className="text-[12px] leading-relaxed text-fg-muted">
        In-app support tickets (Help widget) reach the same team and are the fastest route for account-specific issues. Consent version currently in force: <span className="font-mono text-fg-secondary">{meta?.consentVersion || '—'}</span>.
      </p>
    </div>
  );
}

export default function LegalView({ section = 'terms', onBack }) {
  const [tab, setTab] = useState(TABS.some((t) => t.id === section) ? section : 'terms');
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    api.get('/api/legal').then(setMeta).catch(() => setMeta(null));
  }, []);
  useEffect(() => {
    if (TABS.some((t) => t.id === section)) setTab(section);
  }, [section]);

  const pick = (id) => {
    setTab(id);
    window.location.hash = `#/legal/${id}`;
  };

  return (
    <div className="relative min-h-screen">
      <Atmosphere variant="app" />
      <main className="relative mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <button onClick={onBack} className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-fg-secondary transition hover:text-fg">
          <ArrowLeft size={14} /> Back to Career Autopilot
        </button>

        <h1 className="font-display text-2xl font-semibold text-fg">Legal & policies</h1>
        <p className="mt-1 text-[12.5px] text-fg-muted">
          {meta?.entityName || 'Career Autopilot'} · effective {LEGAL_EFFECTIVE} · written to be read, not skimmed past.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => pick(t.id)}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] transition ${
                tab === t.id ? 'border-strong bg-surface-1 text-fg' : 'border-subtle bg-surface-1 text-fg-secondary hover:border-strong'
              }`}>
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>

        <div className="mt-7 rounded-2xl border border-subtle bg-surface-1 p-6 sm:p-8">
          {tab === 'terms' && <Sections sections={TERMS_SECTIONS} />}
          {tab === 'privacy' && <Sections sections={PRIVACY_SUMMARY} />}
          {tab === 'refunds' && <Sections sections={REFUND_SECTIONS} />}
          {tab === 'contact' && <ContactTab meta={meta} />}
        </div>
      </main>
    </div>
  );
}
