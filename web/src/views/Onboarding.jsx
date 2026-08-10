import { useState } from 'react';
import { motion } from 'framer-motion';
import { GraduationCap, Briefcase, UserSearch, Building2, ArrowRight, Check, Zap } from 'lucide-react';
import Atmosphere from '../components/Atmosphere.jsx';
import { Button, Input, Field } from '../components/ui/kit.jsx';
import { ROLE_FIELDS, ONBOARDING_CHOICES, saveOnboarding } from '../lib/userProfile.js';
import { ROLE_GROUPS, ALL_ROLES } from '../lib/roles.js';

const ICONS = { student: GraduationCap, professional: Briefcase, recruiter: UserSearch, college_admin: Building2 };

function RoleField({ def, value, onChange }) {
  if (def.type === 'select') {
    return (
      <Field label={def.label}>
        <select value={value || ''} onChange={(e) => onChange(e.target.value)} className="h-11 w-full rounded-xl border border-field-border bg-field px-3 text-sm text-fg">
          <option value="">Select…</option>
          {def.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
    );
  }
  if (def.type === 'role') {
    return (
      <Field label={def.label}>
        <select value={value || ''} onChange={(e) => onChange(e.target.value)} className="h-11 w-full rounded-xl border border-field-border bg-field px-3 text-sm text-fg">
          <option value="">Select a role…</option>
          {Object.entries(ROLE_GROUPS).map(([g, roles]) => (
            <optgroup key={g} label={g}>{roles.map((r) => <option key={r} value={r}>{r}</option>)}</optgroup>
          ))}
        </select>
      </Field>
    );
  }
  return (
    <Field label={def.label}>
      <Input type={def.type === 'email' ? 'email' : 'text'} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={def.optional ? 'Optional' : ''} />
    </Field>
  );
}

export default function Onboarding({ onDone }) {
  const [role, setRole] = useState('');
  const [values, setValues] = useState({});
  const fields = role ? (ROLE_FIELDS[role] || []) : [];

  const setVal = (id, v) => setValues((prev) => ({ ...prev, [id]: v }));

  const required = fields.filter((f) => !f.optional);
  const ready = role && required.every((f) => String(values[f.id] || '').trim());

  const finish = () => {
    const skills = String(values.skills || values.skillsHiring || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    saveOnboarding({ role, ...values, skillsList: skills });
    onDone?.();
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <Atmosphere variant="app" />
      <motion.div
        initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="relative w-full max-w-2xl gradient-border p-6 sm:p-8"
      >
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl btn-primary text-ink-950 shadow-glow"><Zap size={18} strokeWidth={2.5} /></span>
          <span className="font-display text-[16px] font-semibold tracking-tight text-fg">Career Autopilot</span>
        </div>

        <h2 className="font-display text-2xl font-semibold text-fg">What best describes you?</h2>
        <p className="mt-1.5 text-sm text-muted">We’ll tailor your dashboard and tools to your goals.</p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {ONBOARDING_CHOICES.map((c) => {
            const Icon = ICONS[c.role];
            const on = role === c.role;
            return (
              <button
                key={c.role}
                onClick={() => { setRole(c.role); setValues({}); }}
                className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${on ? 'border-aurora-violet/50 bg-aurora-violet/[0.08] ring-1 ring-aurora-violet/25' : 'border-subtle bg-surface-1 hover:border-strong'}`}
              >
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${on ? 'bg-indigo-100 text-aurora-violet' : 'bg-surface-1 text-fg-secondary'}`}><Icon size={20} /></span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-fg">{c.label}{on && <Check size={14} className="text-aurora-mint" />}</span>
                  <span className="mt-0.5 block text-xs text-fg-secondary">{c.hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        {role && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-6 overflow-hidden">
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.id} className={f.type === 'role' || f.id === 'skills' || f.id === 'skillsHiring' ? 'sm:col-span-2' : ''}>
                  <RoleField def={f} value={values[f.id]} onChange={(v) => setVal(f.id, v)} />
                </div>
              ))}
            </div>
            {role === 'professional' && (
              <p className="mt-3 rounded-xl border border-subtle bg-surface-1 px-3 py-2 text-xs text-fg-secondary">
                Tip: upload your resume in the Resume tab after this to unlock tailored analysis.
              </p>
            )}
          </motion.div>
        )}

        <div className="mt-7 flex items-center justify-between gap-3">
          <p className="text-xs text-fg-muted">You can change these later in Settings.</p>
          <Button onClick={finish} disabled={!ready}>Continue <ArrowRight size={16} /></Button>
        </div>
      </motion.div>
    </div>
  );
}
