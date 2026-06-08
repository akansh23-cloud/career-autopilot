import { useState } from 'react';
import { Search, Loader2, Plus, X } from 'lucide-react';
import { Button, Field, Input, Badge } from '../../components/ui/kit.jsx';
import { SectionCard } from '../common.jsx';
import { DOMAINS, TARGET_USERS, TECHNOLOGIES, GOALS } from '../patent/shared.jsx';
import { PURPOSES, SOURCES, DIFFICULTIES } from './shared.jsx';

const selCls = 'h-11 w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm text-slate-100 outline-none focus:border-aurora-violet/50';

function Select({ label, value, onChange, options, placeholder }) {
  return (
    <Field label={label}>
      <select value={value} onChange={onChange} className={selCls}>
        <option value="">{placeholder || 'Any'}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </Field>
  );
}

export default function ProblemDiscovery({ onDiscover, busy }) {
  const [form, setForm] = useState({ domain: '', targetUser: '', technology: '', goal: '', difficulty: '', purpose: 'portfolio' });
  const [skills, setSkills] = useState([]);
  const [skillInput, setSkillInput] = useState('');
  const [sources, setSources] = useState(['github', 'stackexchange', 'arxiv']);
  const [manual, setManual] = useState([]);
  const [manualInput, setManualInput] = useState('');
  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const toggleSource = (id) => setSources((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const addSkill = () => { const v = skillInput.trim(); if (v && !skills.includes(v)) setSkills([...skills, v]); setSkillInput(''); };
  const addManual = () => { const v = manualInput.trim(); if (v) setManual([...manual, { title: v }]); setManualInput(''); };

  const run = () => onDiscover({
    ...form, skills, sources,
    manualProblems: sources.includes('manual') ? manual : [],
    limit: 24,
  });

  return (
    <SectionCard title="Discover real problems" eyebrow="Source-backed discovery">
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        <Select label="Domain / industry" value={form.domain} onChange={f('domain')} options={DOMAINS} />
        <Select label="Target user" value={form.targetUser} onChange={f('targetUser')} options={TARGET_USERS} />
        <Select label="Technology" value={form.technology} onChange={f('technology')} options={TECHNOLOGIES} />
        <Select label="Goal" value={form.goal} onChange={f('goal')} options={GOALS} />
        <Select label="Difficulty" value={form.difficulty} onChange={f('difficulty')} options={DIFFICULTIES} />
        <Field label="Purpose">
          <select value={form.purpose} onChange={f('purpose')} className={selCls}>
            {PURPOSES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Your skills (optional — shapes feasibility & generated project)">
          <div className="flex gap-2">
            <Input value={skillInput} onChange={(e) => setSkillInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSkill())} placeholder="e.g. React, Python…" />
            <Button variant="soft" size="sm" onClick={addSkill}><Plus size={14} /></Button>
          </div>
        </Field>
        {skills.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {skills.map((s) => <button key={s} onClick={() => setSkills(skills.filter((x) => x !== s))} className="group"><Badge tone="cyan">{s} <X size={11} className="opacity-60 group-hover:opacity-100" /></Badge></button>)}
          </div>
        )}
      </div>

      <div className="mt-4">
        <span className="mb-1.5 block text-[13px] font-medium text-slate-300">Sources</span>
        <div className="flex flex-wrap gap-2">
          {SOURCES.map((s) => (
            <button key={s.id} onClick={() => toggleSource(s.id)}>
              <Badge tone={sources.includes(s.id) ? 'violet' : 'default'}>{s.label}</Badge>
            </button>
          ))}
        </div>
      </div>

      {sources.includes('manual') && (
        <div className="mt-4">
          <Field label="Manual problem statements (fallback)">
            <div className="flex gap-2">
              <Input value={manualInput} onChange={(e) => setManualInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addManual())} placeholder="Describe a real problem you've seen…" />
              <Button variant="soft" size="sm" onClick={addManual}><Plus size={14} /></Button>
            </div>
          </Field>
          {manual.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{manual.map((m, i) => <button key={i} onClick={() => setManual(manual.filter((_, j) => j !== i))}><Badge tone="mint">{m.title} <X size={11} /></Badge></button>)}</div>}
        </div>
      )}

      <div className="mt-5">
        <Button onClick={run} disabled={busy || sources.length === 0}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          Discover problems
        </Button>
      </div>
    </SectionCard>
  );
}
