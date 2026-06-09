import { useState } from 'react';
import { Sparkles, Loader2, ChevronDown, AlertTriangle, ArrowRight, Wand2, ShieldAlert } from 'lucide-react';
import { PageIntro, SectionCard } from '../common.jsx';
import { Button, Badge, Field, Input, EmptyState } from '../../components/ui/kit.jsx';
import { PatentOS } from '../../lib/api.js';
import { DOMAINS, TARGET_USERS, TECHNOLOGIES, GOALS, ScorePill, riskTone, Disclaimer } from './shared.jsx';

function Select({ label, value, onChange, options, placeholder }) {
  return (
    <Field label={label}>
      <div className="relative">
        <select value={value} onChange={onChange} className="h-11 w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-white/[0.03] px-3.5 pr-10 text-sm text-slate-100 outline-none focus:border-aurora-violet/50">
          <option value="">{placeholder || 'Select…'}</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
      </div>
    </Field>
  );
}

export default function PatentIdeaGenerator({ go }) {
  const [form, setForm] = useState({ domain: '', targetUser: '', problem: '', existingSolutions: '', technology: '', goal: '', count: 6, creativity: 'Balanced' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ideas, setIdeas] = useState([]);
  const [meta, setMeta] = useState({});
  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const generate = async () => {
    if (!form.domain && !form.problem) { setErr('Pick a domain or describe a problem.'); return; }
    setBusy(true); setErr(''); setIdeas([]);
    try {
      const d = await PatentOS.generate({ ...form, count: Number(form.count) || 6 });
      setIdeas(d.ideas || []); setMeta({ source: d.source, why: d.generationWhy, db: d.db });
    } catch (e) { setErr(e?.message || 'Generation failed.'); } finally { setBusy(false); }
  };

  return (
    <>
      <PageIntro title="Legacy idea generator" sub="The newer Innovation OS discovers real, source-backed problems and builds patent-aware projects with evidence and honest IP-readiness. This template-based generator is kept as a fallback." />

      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-aurora-violet/30 bg-aurora-violet/[0.07] p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-slate-200">Looking for the full experience? Start in the <span className="font-semibold text-white">Innovation OS</span> — source-backed discovery, build blueprints, prior-art plans, and IP review.</p>
        <Button size="sm" onClick={() => go?.('innovation')}><Sparkles size={14} /> Open Innovation OS</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <SectionCard title="Inputs">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Domain / industry" value={form.domain} onChange={f('domain')} options={DOMAINS} />
            <Select label="Target user" value={form.targetUser} onChange={f('targetUser')} options={TARGET_USERS} />
          </div>
          <div className="mt-3"><Field label="Problem statement">
            <textarea value={form.problem} onChange={f('problem')} placeholder="What real problem should the invention solve?" className="h-20 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200 outline-none focus:border-aurora-violet/50" />
          </Field></div>
          <div className="mt-3"><Field label="Existing solution (optional)"><Input value={form.existingSolutions} onChange={f('existingSolutions')} placeholder="What exists today?" /></Field></div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Select label="Technology" value={form.technology} onChange={f('technology')} options={TECHNOLOGIES} />
            <Select label="Goal" value={form.goal} onChange={f('goal')} options={GOALS} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Number of ideas"><Input value={form.count} onChange={f('count')} inputMode="numeric" /></Field>
            <Select label="Creativity" value={form.creativity} onChange={f('creativity')} options={['Conservative', 'Balanced', 'Bold']} placeholder="Balanced" />
          </div>
          {err && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-glow"><AlertTriangle size={13} /> {err}</p>}
          <Button className="mt-3" onClick={generate} disabled={busy}>{busy ? <><Loader2 size={16} className="animate-spin" /> Generating…</> : <><Sparkles size={16} /> Generate ideas</>}</Button>
          <div className="mt-3"><Disclaimer /></div>
        </SectionCard>

        <div className="space-y-3">
          {meta.why && <div className="rounded-lg border border-aurora-violet/25 bg-aurora-violet/5 px-3 py-2 text-[12px] text-slate-300"><span className="text-aurora-violet">Why these: </span>{meta.why}{meta.source === 'deterministic' && ' (template fallback — set ANTHROPIC_API_KEY for AI generation)'}</div>}
          {!ideas.length && !busy && (
            <SectionCard><div className="py-10 text-center text-sm text-slate-500"><Wand2 size={26} className="mx-auto mb-2 text-slate-600" /> Generated ideas appear here. Save the strong ones to your portfolio.</div></SectionCard>
          )}
          {busy && <SectionCard><div className="flex items-center gap-2 py-8 text-slate-400"><Loader2 size={16} className="animate-spin" /> Composing inventions…</div></SectionCard>}
          {ideas.map((idea, i) => (
            <div key={idea.id || i} className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">{idea.title}</h3>
                <div className="flex shrink-0 items-center gap-1.5">
                  {idea.weak && <Badge tone="rose"><ShieldAlert size={11} /> Weak</Badge>}
                  <ScorePill score={idea.score?.overall ?? idea.scoreSummary?.overall ?? 0} />
                </div>
              </div>
              <p className="mt-1.5 text-[13px] text-slate-400"><span className="text-slate-500">Problem: </span>{idea.problem}</p>
              <p className="mt-1 text-[13px] text-slate-300"><span className="text-slate-500">Mechanism: </span>{idea.technicalMechanism}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <Badge tone={riskTone(idea.score?.riskLevel || idea.scoreSummary?.riskLevel)}>{idea.score?.riskLevel || idea.scoreSummary?.riskLevel || 'Medium'} prior-art risk</Badge>
                {idea.targetUser && <span className="rounded-md bg-white/5 px-2 py-0.5 text-slate-400">{idea.targetUser}</span>}
                {(idea.tags || []).slice(0, 4).map((t) => <span key={t} className="rounded-md bg-white/5 px-2 py-0.5 text-slate-400">{t}</span>)}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-white/8 pt-3">
                {idea.id
                  ? <Button size="sm" onClick={() => go?.('patentworkspace', { ideaId: idea.id })}>Open workspace <ArrowRight size={13} /></Button>
                  : <Badge tone="amber">Saved when database is connected</Badge>}
              </div>
            </div>
          ))}
          {ideas.length > 0 && meta.db && (
            <Button variant="soft" onClick={() => go?.('patentportfolio')}>View all in portfolio <ArrowRight size={14} /></Button>
          )}
          {ideas.length > 0 && !meta.db && (
            <EmptyState icon={AlertTriangle} title="Preview only" hint="No database is connected, so these ideas weren't persisted. Connect MONGODB_URI to save and track them." />
          )}
        </div>
      </div>
    </>
  );
}
