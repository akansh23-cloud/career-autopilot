import { useState } from 'react';
import {
  Boxes, Sparkles, Loader2, AlertTriangle, ChevronDown, Gauge, ShieldCheck, Network,
  Server, Workflow,
} from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Field, Input } from '../components/ui/kit.jsx';
import { ArchitectureDiagram } from '../components/proof/ProofViews.jsx';
import { Architecture } from '../lib/api.js';

const LEVELS = [
  ['mvp', 'MVP'],
  ['production', 'Production-ready'],
  ['enterprise', 'Enterprise-ready'],
  ['college_saas', 'College / B2B SaaS'],
];
const MATURITY_LABELS = {
  scalability: ['Scalability', 15], security: ['Security', 15], maintainability: ['Maintainability', 15],
  dataDesign: ['Data design', 15], observability: ['Observability', 10], deploymentReadiness: ['Deployment readiness', 10],
  costEfficiency: ['Cost efficiency', 10], failureHandling: ['Failure handling', 10],
};

function Bar({ label, value, max }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  const tone = pct >= 80 ? '#46E6A6' : pct >= 50 ? '#37D6C4' : '#FFC85A';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]"><span className="text-slate-300">{label}</span><span className="tabular-nums text-slate-400">{value}/{max}</span></div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone, transition: 'width .8s ease' }} /></div>
    </div>
  );
}

function ListBlock({ title, items }) {
  if (!items?.length) return null;
  return (
    <SectionCard title={title}>
      <ul className="space-y-1.5">{items.map((s, i) => <li key={i} className="text-[13px] text-slate-300">• {typeof s === 'string' ? s : JSON.stringify(s)}</li>)}</ul>
    </SectionCard>
  );
}

export default function ArchitectureView() {
  const [form, setForm] = useState({ title: '', description: '', techStack: '', targetRole: '', level: 'production', teamSize: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const [narrative, setNarrative] = useState('');
  const [diagram, setDiagram] = useState('component');
  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const generate = async () => {
    if (form.title.trim().length < 2 && form.techStack.trim().length < 2) { setErr('Add a project title or tech stack.'); return; }
    setBusy(true); setErr(''); setResult(null); setNarrative('');
    try {
      const data = await Architecture.generate({
        ...form,
        techStack: form.techStack.split(',').map((s) => s.trim()).filter(Boolean),
        teamSize: form.teamSize ? Number(form.teamSize) : undefined,
        enrich: true,
      });
      setResult(data.architecture); setNarrative(data.narrative || '');
    } catch (e) { setErr(e?.message || 'Generation failed.'); } finally { setBusy(false); }
  };

  const DIAGRAMS = result ? [
    ['component', 'Component', Network], ['dataFlow', 'Data flow', Workflow],
    ['deployment', 'Deployment', Server], ['security', 'Security', ShieldCheck],
  ] : [];

  return (
    <>
      <PageIntro title="Architecture generator" sub="Generate an industry-grade architecture with diagrams, security, scalability, observability, CI/CD, explicit gaps and a maturity score. Defaults to a production-ready modular monolith — not microservices." />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <SectionCard title="Describe your project">
          <Field label="Project title"><Input value={form.title} onChange={f('title')} placeholder="e.g. Real-time CI/CD cost dashboard" /></Field>
          <div className="mt-3"><Field label="Tech stack (comma-separated)"><Input value={form.techStack} onChange={f('techStack')} placeholder="React, Node.js, PostgreSQL, Redis, Docker, AWS" /></Field></div>
          <div className="mt-3"><Field label="Description">
            <textarea value={form.description} onChange={f('description')} placeholder="What does it do? Any scale, auth, async or AI needs?" className="h-24 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200 outline-none focus:border-aurora-violet/50" />
          </Field></div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Maturity level">
              <div className="relative">
                <select value={form.level} onChange={f('level')} className="h-11 w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-white/[0.03] px-3.5 pr-10 text-sm text-slate-100 outline-none focus:border-aurora-violet/50">
                  {LEVELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
                <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              </div>
            </Field>
            <Field label="Team size (optional)"><Input value={form.teamSize} onChange={f('teamSize')} placeholder="e.g. 4" inputMode="numeric" /></Field>
          </div>
          {err && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-glow"><AlertTriangle size={13} /> {err}</p>}
          <Button className="mt-3" onClick={generate} disabled={busy}>{busy ? <><Loader2 size={16} className="animate-spin" /> Generating…</> : <><Sparkles size={16} /> Generate architecture</>}</Button>
        </SectionCard>

        <div className="space-y-4">
          {!result ? (
            <SectionCard><div className="py-10 text-center text-sm text-slate-500"><Boxes size={28} className="mx-auto mb-2 text-slate-600" /> Your architecture, diagrams and maturity score appear here.</div></SectionCard>
          ) : (
            <>
              <SectionCard title="Executive summary">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone="violet">{result.recommendedStyle.style}</Badge>
                  <Badge tone={result.maturityScore.total >= 75 ? 'mint' : result.maturityScore.total >= 50 ? 'cyan' : 'amber'}><Gauge size={11} /> Maturity {result.maturityScore.total}/100</Badge>
                  <Badge tone="default">{LEVELS.find((l) => l[0] === result.level)?.[1] || result.level}</Badge>
                </div>
                <p className="text-sm text-slate-300">{result.executiveSummary}</p>
                <p className="mt-2 text-[13px] text-slate-400">{result.recommendedStyle.rationale}</p>
                {narrative && <p className="mt-3 whitespace-pre-wrap border-t border-white/8 pt-3 text-[13px] text-slate-300">{narrative}</p>}
              </SectionCard>

              <SectionCard title="Diagrams">
                <div className="mb-3 flex flex-wrap gap-2">
                  {DIAGRAMS.map(([id, label, Icon]) => (
                    <button key={id} onClick={() => setDiagram(id)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${diagram === id ? 'border-aurora-violet/60 bg-aurora-violet/10 text-white' : 'border-white/10 bg-white/[0.02] text-slate-300 hover:border-white/25'}`}>
                      <Icon size={13} /> {label}
                    </button>
                  ))}
                </div>
                <ArchitectureDiagram mermaid={result.diagrams[diagram]} height={340} />
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-slate-500">Copy Mermaid source</summary>
                  <pre className="mt-2 overflow-x-auto rounded-lg border border-white/8 bg-ink-950/60 p-3 text-[11px] text-slate-400">{result.diagrams[diagram]}</pre>
                </details>
              </SectionCard>

              <SectionCard title="Maturity score">
                <div className="space-y-3">
                  {Object.entries(MATURITY_LABELS).map(([k, [label, max]]) => (
                    <Bar key={k} label={label} value={result.maturityScore.breakdown[k] ?? 0} max={max} />
                  ))}
                </div>
              </SectionCard>

              {result.gaps?.length > 0 && (
                <SectionCard title="Architecture gaps">
                  <ul className="space-y-2">{result.gaps.map((g, i) => <li key={i} className="flex gap-2 text-sm text-slate-300"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-glow" /> {g}</li>)}</ul>
                </SectionCard>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <ListBlock title="Database design" items={[result.databaseDesign.primary, ...result.databaseDesign.notes]} />
                <ListBlock title="API design" items={[result.apiDesign.style, ...result.apiDesign.notes]} />
                <ListBlock title="Security design" items={result.securityDesign} />
                <ListBlock title="Scalability plan" items={result.scalabilityPlan} />
                <ListBlock title="Failure handling" items={result.failureHandling} />
                <ListBlock title="Observability" items={result.observability} />
                <ListBlock title="CI/CD plan" items={result.cicdPlan} />
                <ListBlock title="Cost & trade-offs" items={result.costTradeoffs} />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
