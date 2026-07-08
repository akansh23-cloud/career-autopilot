import { useState } from 'react';
import {
  Boxes, Sparkles, Loader2, AlertTriangle, ChevronDown, Gauge, ShieldCheck, Network,
  Server, Workflow, Wand2,
} from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Field, Input } from '../components/ui/kit.jsx';
import { ArchitectureDiagram as LegacyMermaidDiagram } from '../components/proof/ProofViews.jsx';
import ArchitectureCanvas from '../components/architecture/ArchitectureCanvas.jsx';
import ArchitectureTabs from '../components/architecture/ArchitectureTabs.jsx';
import ArchitectureValidationPanel from '../components/architecture/ArchitectureValidationPanel.jsx';
import ArchitectureExportPanel from '../components/architecture/ArchitectureExportPanel.jsx';
import { isArchitectureSpec, orderedViews } from '../lib/architectureSpec.js';
import { Architecture } from '../lib/api.js';

const LEVELS = [
  ['mvp', 'MVP'],
  ['production', 'Production-ready'],
  ['enterprise', 'Enterprise-ready'],
  ['college_saas', 'College / B2B SaaS'],
];
const PROVIDERS = [
  ['generic', 'Cloud-agnostic'],
  ['aws', 'AWS'],
  ['azure', 'Azure'],
  ['gcp', 'GCP'],
];
const MATURITY_LABELS = {
  scalability: ['Scalability', 15], security: ['Security', 15], maintainability: ['Maintainability', 15],
  dataDesign: ['Data design', 15], observability: ['Observability', 10], deploymentReadiness: ['Deployment readiness', 10],
  costEfficiency: ['Cost efficiency', 10], failureHandling: ['Failure handling', 10],
};

function Bar({ label, value, max }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  const tone = pct >= 80 ? '#57E6A8' : pct >= 50 ? '#6EE0F2' : '#EAC97C';
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

function Select({ value, onChange, options }) {
  return (
    <div className="relative">
      <select value={value} onChange={onChange} className="h-11 w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-white/[0.03] px-3.5 pr-10 text-sm text-slate-100 outline-none focus:border-aurora-violet/50">
        {options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
    </div>
  );
}

export default function ArchitectureView() {
  const [form, setForm] = useState({ title: '', description: '', techStack: '', targetRole: '', level: 'production', teamSize: '', cloudProvider: 'generic' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);          // legacy architecture (prose + maturity)
  const [narrative, setNarrative] = useState('');
  const [spec, setSpec] = useState(null);              // Architecture Diagram OS spec
  const [validation, setValidation] = useState(null);
  const [activeView, setActiveView] = useState(null);
  const [diagram, setDiagram] = useState('component'); // legacy fallback tabs
  const [refineText, setRefineText] = useState('');
  const [refining, setRefining] = useState(false);
  const [refineMsg, setRefineMsg] = useState('');
  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const adoptSpec = (nextSpec, nextValidation) => {
    if (isArchitectureSpec(nextSpec)) {
      setSpec(nextSpec);
      setValidation(nextValidation || null);
      const views = orderedViews(nextSpec);
      setActiveView((prev) => views.find((v) => v.type === prev?.type) || views[0] || null);
    }
  };

  const generate = async () => {
    if (form.title.trim().length < 2 && form.techStack.trim().length < 2) { setErr('Add a project title or tech stack.'); return; }
    setBusy(true); setErr(''); setResult(null); setNarrative(''); setSpec(null); setValidation(null); setActiveView(null); setRefineMsg('');
    try {
      // One request: the legacy endpoint now also returns the structured spec.
      const data = await Architecture.generate({
        ...form,
        techStack: form.techStack.split(',').map((s) => s.trim()).filter(Boolean),
        teamSize: form.teamSize ? Number(form.teamSize) : undefined,
        cloudProvider: form.cloudProvider,
        enrich: true,
      });
      setResult(data.architecture); setNarrative(data.narrative || '');
      adoptSpec(data.architectureSpec, data.validation);
    } catch (e) { setErr(e?.message || 'Generation failed.'); } finally { setBusy(false); }
  };

  const refine = async () => {
    if (!spec || refineText.trim().length < 3) return;
    setRefining(true); setRefineMsg('');
    try {
      const data = await Architecture.refine(spec, refineText.trim());
      adoptSpec(data.architectureSpec, data.validation);
      const d = data.diffSummary || {};
      setRefineMsg(d.recognized
        ? `Applied — added: ${d.added?.join(', ') || 'none'}${d.removed?.length ? ` · removed: ${d.removed.join(', ')}` : ''}.`
        : (d.notes || 'No known components recognized.'));
      setRefineText('');
    } catch (e) { setRefineMsg(e?.message || 'Refine failed.'); } finally { setRefining(false); }
  };

  const specViews = spec ? orderedViews(spec) : [];
  const LEGACY_DIAGRAMS = result ? [
    ['component', 'Component', Network], ['dataFlow', 'Data flow', Workflow],
    ['deployment', 'Deployment', Server], ['security', 'Security', ShieldCheck],
  ] : [];

  return (
    <>
      <PageIntro title="Architecture Diagram OS" sub="Industry-grade system design: pattern-matched multi-view diagrams (context, container, deployment, data flow, security, CI/CD, observability, scaling), best-practice validation with a quality score, instruction-based refinement, and JSON/Mermaid/SVG export. Deterministic — defaults to a production-ready modular monolith, not microservices." />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <SectionCard title="Describe your project">
          <Field label="Project title"><Input value={form.title} onChange={f('title')} placeholder="e.g. Real-time CI/CD cost dashboard" /></Field>
          <div className="mt-3"><Field label="Tech stack (comma-separated)"><Input value={form.techStack} onChange={f('techStack')} placeholder="React, Node.js, PostgreSQL, Redis, Docker, AWS" /></Field></div>
          <div className="mt-3"><Field label="Description">
            <textarea value={form.description} onChange={f('description')} placeholder="What does it do? Any scale, auth, async or AI needs?" className="h-24 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200 outline-none focus:border-aurora-violet/50" />
          </Field></div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Maturity level"><Select value={form.level} onChange={f('level')} options={LEVELS} /></Field>
            <Field label="Cloud provider"><Select value={form.cloudProvider} onChange={f('cloudProvider')} options={PROVIDERS} /></Field>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Target role (optional)"><Input value={form.targetRole} onChange={f('targetRole')} placeholder="e.g. Data Engineer" /></Field>
            <Field label="Team size (optional)"><Input value={form.teamSize} onChange={f('teamSize')} placeholder="e.g. 4" inputMode="numeric" /></Field>
          </div>
          {err && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-glow"><AlertTriangle size={13} /> {err}</p>}
          <Button className="mt-3" onClick={generate} disabled={busy}>{busy ? <><Loader2 size={16} className="animate-spin" /> Generating…</> : <><Sparkles size={16} /> Generate architecture</>}</Button>
        </SectionCard>

        <div className="space-y-4">
          {!result && !spec ? (
            <SectionCard><div className="py-10 text-center text-sm text-slate-500"><Boxes size={28} className="mx-auto mb-2 text-slate-600" /> Your architecture, diagrams and quality score appear here.</div></SectionCard>
          ) : (
            <>
              {result && (
                <SectionCard title="Executive summary">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge tone="violet">{result.recommendedStyle.style}</Badge>
                    <Badge tone={result.maturityScore.total >= 75 ? 'mint' : result.maturityScore.total >= 50 ? 'cyan' : 'amber'}><Gauge size={11} /> Maturity {result.maturityScore.total}/100</Badge>
                    <Badge tone="default">{LEVELS.find((l) => l[0] === result.level)?.[1] || result.level}</Badge>
                    {spec?.pattern && <Badge tone="cyan">{spec.pattern.name} · {spec.pattern.confidence} confidence</Badge>}
                  </div>
                  <p className="text-sm text-slate-300">{result.executiveSummary}</p>
                  <p className="mt-2 text-[13px] text-slate-400">{result.recommendedStyle.rationale}</p>
                  {narrative && <p className="mt-3 whitespace-pre-wrap border-t border-white/8 pt-3 text-[13px] text-slate-300">{narrative}</p>}
                </SectionCard>
              )}

              {/* ---- Architecture Diagram OS: professional multi-view diagrams ---- */}
              {spec && specViews.length > 0 ? (
                <SectionCard title="Architecture diagrams">
                  <div className="mb-3">
                    <ArchitectureTabs views={specViews} activeId={activeView?.id || activeView?.type} onSelect={setActiveView} />
                  </div>
                  {activeView && (
                    <>
                      {activeView.description && <p className="mb-2 text-[12px] text-slate-500">{activeView.description}</p>}
                      <ArchitectureCanvas view={activeView} height={460} />
                      <div className="mt-3">
                        <ArchitectureExportPanel spec={spec} view={activeView} />
                      </div>
                    </>
                  )}
                  {/* Refine with instructions */}
                  <div className="mt-4 border-t border-white/8 pt-3">
                    <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate-500">Refine this architecture</p>
                    <div className="flex gap-2">
                      <Input value={refineText} onChange={(e) => setRefineText(e.target.value)} placeholder='e.g. "Add Redis cache, SQS queue, worker service, monitoring, backup flow, and CI/CD"' onKeyDown={(e) => { if (e.key === 'Enter') refine(); }} />
                      <Button variant="soft" onClick={refine} disabled={refining || refineText.trim().length < 3}>
                        {refining ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} Refine
                      </Button>
                    </div>
                    {refineMsg && <p className="mt-2 text-[12px] text-slate-400">{refineMsg}</p>}
                  </div>
                </SectionCard>
              ) : result && (
                /* Legacy fallback: old four Mermaid diagrams keep working if the spec is unavailable. */
                <SectionCard title="Diagrams">
                  <div className="mb-3 flex flex-wrap gap-2">
                    {LEGACY_DIAGRAMS.map(([id, label, Icon]) => (
                      <button key={id} onClick={() => setDiagram(id)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${diagram === id ? 'border-aurora-violet/60 bg-aurora-violet/10 text-white' : 'border-white/10 bg-white/[0.02] text-slate-300 hover:border-white/25'}`}>
                        <Icon size={13} /> {label}
                      </button>
                    ))}
                  </div>
                  <LegacyMermaidDiagram mermaid={result.diagrams[diagram]} height={340} />
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-slate-500">Copy Mermaid source</summary>
                    <pre className="mt-2 overflow-x-auto rounded-lg border border-white/8 bg-ink-950/60 p-3 text-[11px] text-slate-400">{result.diagrams[diagram]}</pre>
                  </details>
                </SectionCard>
              )}

              {/* ---- Validation: quality score, checks, missing items ---- */}
              {validation && (
                <SectionCard title="Validation & quality score">
                  <ArchitectureValidationPanel validation={validation} />
                </SectionCard>
              )}

              {result && (
                <SectionCard title="Maturity score (legacy engine)">
                  <div className="space-y-3">
                    {Object.entries(MATURITY_LABELS).map(([k, [label, max]]) => (
                      <Bar key={k} label={label} value={result.maturityScore.breakdown[k] ?? 0} max={max} />
                    ))}
                  </div>
                </SectionCard>
              )}

              {result?.gaps?.length > 0 && (
                <SectionCard title="Architecture gaps">
                  <ul className="space-y-2">{result.gaps.map((g, i) => <li key={i} className="flex gap-2 text-sm text-slate-300"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-glow" /> {g}</li>)}</ul>
                </SectionCard>
              )}

              {result && (
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
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
