import { useState, useEffect } from 'react';
import {
  Loader2, Boxes, IndianRupee, ScrollText, FileStack, ExternalLink,
  Plus, AlertTriangle, CheckCircle2, Rocket,
} from 'lucide-react';
import { Button, Badge, Field, Input, EmptyState } from '../../components/ui/kit.jsx';
import { SectionCard } from '../common.jsx';
import { Innovation } from '../../lib/innovation.js';
import { saveProject as saveClientProject, uid as projUid } from '../../lib/projectStore.js';
import { ScoreBar, scoreTone, NotLegalAdvice } from './shared.jsx';

// When the project is not persisted server-side (DB off), we round-trip the
// project object through the request body so every action still works.
const bodyFor = (project, persisted, extra = {}) => (persisted ? extra : { project, ...extra });

const Chips = ({ items, tone = 'default' }) => (
  <div className="flex flex-wrap gap-1.5">
    {(items || []).map((x, i) => <Badge key={i} tone={tone}>{x}</Badge>)}
  </div>
);
const List = ({ items }) => (
  <ul className="space-y-1 text-[13px] text-slate-300">
    {(items || []).map((x, i) => <li key={i} className="flex gap-2"><span className="text-slate-600">•</span><span>{x}</span></li>)}
  </ul>
);

/* ---------------- Source evidence ---------------- */
export function SourceEvidencePanel({ cluster }) {
  const sources = cluster?.topSources || [];
  return (
    <SectionCard title="Source evidence" eyebrow={`${cluster?.signalCount || 0} signal(s) · ${(cluster?.sources || []).join(', ') || '—'}`}>
      {sources.length === 0
        ? <p className="text-[13px] text-slate-500">No linkable sources captured for this cluster.</p>
        : (
          <ul className="space-y-2">
            {sources.map((s, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
                <Badge tone="cyan">{s.source}</Badge>
                <span className="flex-1 text-[13px] text-slate-300">{s.title}</span>
                {s.url && <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-aurora-cyan hover:text-white"><ExternalLink size={14} /></a>}
              </li>
            ))}
          </ul>
        )}
      <p className="mt-2 text-[11px] text-slate-500">Links open the original source. The system stores summaries only — it never re-fetches arbitrary URLs.</p>
    </SectionCard>
  );
}

/* ---------------- Build blueprint ---------------- */
export function BuildBlueprintPanel({ project, projectId, persisted }) {
  const [bp, setBp] = useState(project?.buildBlueprint || null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try { const d = await Innovation.buildBlueprint(projectId, bodyFor(project, persisted)); setBp(d.blueprint); }
    catch (e) { setErr(e?.message || 'Failed to build blueprint.'); } finally { setBusy(false); }
  };
  return (
    <SectionCard title="Build blueprint" action={<Button size="sm" variant={bp ? 'soft' : 'primary'} onClick={run} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Boxes size={14} />}{bp ? 'Regenerate' : 'Generate'}</Button>}>
      {err && <p className="mb-2 text-[12px] text-rose-300">{err}</p>}
      {!bp ? <EmptyState icon={Boxes} title="No blueprint yet" hint="Generate a practical, start-tomorrow build plan." />
        : (
          <div className="space-y-4 text-[13px]">
            {bp.confidence === 'low' && <Badge tone="amber"><AlertTriangle size={12} /> Low-confidence draft</Badge>}
            {bp.productDefinition && <p className="text-slate-300">{bp.productDefinition}</p>}
            <Grid>
              <Block title="MVP scope"><List items={bp.mvpScope} /></Block>
              <Block title="Out of scope"><List items={bp.outOfScope} /></Block>
              <Block title="Frontend screens"><List items={bp.frontendScreens} /></Block>
              <Block title="Backend APIs"><List items={bp.backendApis} /></Block>
              <Block title="Database schema"><List items={bp.databaseSchema} /></Block>
              <Block title="GitHub repo structure"><List items={bp.githubRepoStructure} /></Block>
            </Grid>
            {bp.systemArchitecture && <Block title="System architecture"><p className="text-slate-300">{bp.systemArchitecture}</p></Block>}
            {bp.dataFlow && <Block title="Data flow"><p className="text-slate-300">{bp.dataFlow}</p></Block>}
            {bp.coreAlgorithm && <Block title="Core algorithm"><p className="text-slate-300">{bp.coreAlgorithm}</p></Block>}
            {bp.weeklyRoadmap?.length > 0 && <Block title="Weekly roadmap"><List items={bp.weeklyRoadmap} /></Block>}
            {bp.testPlan?.length > 0 && <Block title="Test plan"><List items={bp.testPlan} /></Block>}
            {bp.demoScript && <Block title="Demo script"><p className="text-slate-300">{bp.demoScript}</p></Block>}
            {bp.deploymentPlan && <Block title="Deployment plan"><p className="text-slate-300">{bp.deploymentPlan}</p></Block>}
            {bp.evidenceChecklist?.length > 0 && <Block title="Evidence checklist"><List items={bp.evidenceChecklist} /></Block>}
          </div>
        )}
    </SectionCard>
  );
}

/* ---------------- Feasibility & cost ---------------- */
export function FeasibilityCostPanel({ project, projectId, persisted }) {
  const [c, setC] = useState(project?.costEstimate || null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try { const d = await Innovation.costEstimate(projectId, bodyFor(project, persisted)); setC(d.costEstimate); }
    catch (e) { setErr(e?.message || 'Failed to estimate.'); } finally { setBusy(false); }
  };
  return (
    <SectionCard title="MVP feasibility & cost" action={<Button size="sm" variant={c ? 'soft' : 'primary'} onClick={run} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <IndianRupee size={14} />}{c ? 'Re-estimate' : 'Estimate'}</Button>}>
      {err && <p className="mb-2 text-[12px] text-rose-300">{err}</p>}
      {!c ? <EmptyState icon={IndianRupee} title="No estimate yet" hint="Realistic India cost bands, team & skills." />
        : (
          <div className="space-y-4 text-[13px]">
            <div className="flex flex-wrap gap-2">
              <Badge tone="violet">Difficulty: {c.difficulty}</Badge>
              <Badge tone="cyan">Team: {c.teamSize}</Badge>
              <Badge tone="default">Timeline: {c.timeline}</Badge>
              {c.confidence === 'low' && <Badge tone="amber">Low-confidence</Badge>}
            </div>
            <Block title="Estimated MVP cost in India">
              <div className="grid gap-2 sm:grid-cols-2">
                <Money label="Student prototype" value={c.indiaCostBands?.studentPrototype} />
                <Money label="Polished demo" value={c.indiaCostBands?.polishedDemo} />
                <Money label="Hardware/cloud-heavy" value={c.indiaCostBands?.hardwareCloudHeavy} />
                <Money label="Startup-grade" value={c.indiaCostBands?.startupGrade} />
              </div>
            </Block>
            <Grid>
              <Block title="Roles required"><Chips items={c.rolesRequired} /></Block>
              <Block title="Must-have skills"><Chips items={c.mustHaveSkills} tone="cyan" /></Block>
              <Block title="Good-to-have"><Chips items={c.goodToHaveSkills} /></Block>
              <Block title="Resources"><List items={c.resourcesRequired} /></Block>
            </Grid>
            {c.cloudApiHardwareNotes && <Block title="Cloud / API / hardware"><p className="text-slate-300">{c.cloudApiHardwareNotes}</p></Block>}
            {c.executionRisks?.length > 0 && <Block title="Execution risks"><List items={c.executionRisks} /></Block>}
            {c.mvpVsAdvanced && <Block title="MVP vs advanced"><p className="text-slate-300">{c.mvpVsAdvanced}</p></Block>}
            {c.shouldYouBuildVerdict && <div className="rounded-xl border border-aurora-mint/25 bg-aurora-mint/[0.05] p-3 text-[#A7F2CE]"><span className="font-semibold">Should you build this? </span>{c.shouldYouBuildVerdict}</div>}
          </div>
        )}
    </SectionCard>
  );
}

/* ---------------- IP readiness ---------------- */
export function IPReadinessPanel({ project, projectId, persisted, refreshKey }) {
  const [ip, setIp] = useState(project?.ipReadiness || null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try { const d = await Innovation.ipReadiness(projectId, bodyFor(project, persisted)); setIp(d.ipReadiness); }
    catch (e) { setErr(e?.message || 'Failed to assess.'); } finally { setBusy(false); }
  };
  useEffect(() => { if (refreshKey && persisted) run(); /* recalc after prior-art change */ // eslint-disable-next-line
  }, [refreshKey]);

  const FACTOR_LABELS = {
    ideaClarity: 'Idea clarity', painClarity: 'Pain clarity', buildClarity: 'Build clarity',
    technicalContribution: 'Technical contribution', noveltyPotential: 'Novelty potential',
    inventiveStepPotential: 'Inventive step', priorArtConfidence: 'Prior-art confidence',
    section3kRisk: 'Section 3(k) risk', prototypeEvidence: 'Prototype evidence',
    disclosureReadiness: 'Disclosure readiness', commercialUtility: 'Commercial utility', enforceability: 'Enforceability',
  };
  return (
    <SectionCard title="Patent / IP readiness" action={<Button size="sm" variant={ip ? 'soft' : 'primary'} onClick={run} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <ScrollText size={14} />}{ip ? 'Re-assess' : 'Assess'}</Button>}>
      {err && <p className="mb-2 text-[12px] text-rose-300">{err}</p>}
      {!ip ? <EmptyState icon={ScrollText} title="Not assessed yet" hint="Backend-owned scoring with hard caps — no inflated scores." />
        : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={scoreTone(ip.overall)} className="text-[13px]">{ip.overall}/100</Badge>
              <span className="text-sm font-semibold text-slate-200">{ip.label}</span>
              <Badge tone="violet">Route: {ip.recommendedIPRoute}</Badge>
            </div>
            {ip.capApplied != null && (
              <div className="rounded-lg border border-amber-glow/30 bg-amber-glow/[0.06] p-2.5 text-[12px] text-[#FFE0A0]">
                Score capped at {ip.capApplied}. {ip.appliedCaps.map((c) => c.reason).join('; ')}.
              </div>
            )}
            <p className="text-[12px] text-slate-400">{ip.priorArtStatus}</p>
            {ip.section3kWarning && (
              <div className="rounded-lg border border-rose-400/25 bg-rose-500/[0.06] p-2.5 text-[12px] text-rose-200">
                <AlertTriangle size={13} className="mr-1 inline" />{ip.section3kWarning}
              </div>
            )}
            <div className="grid gap-2.5 sm:grid-cols-2">
              {Object.entries(ip.factors || {}).map(([k, v]) => (
                <ScoreBar key={k} label={FACTOR_LABELS[k] || k} value={v} tone={k === 'section3kRisk' ? (v >= 60 ? 'rose' : v >= 40 ? 'amber' : 'mint') : undefined} />
              ))}
            </div>
            {ip.requiredEvidenceToImprove?.length > 0 && (
              <Block title="Required evidence to improve"><List items={ip.requiredEvidenceToImprove} /></Block>
            )}
            {ip.narrative && <Block title="Technical-contribution note"><p className="text-[13px] text-slate-300">{ip.narrative}</p></Block>}
            <NotLegalAdvice text={ip.disclaimer} />
          </div>
        )}
    </SectionCard>
  );
}

/* ---------------- Prior-art workspace ---------------- */
export function PriorArtWorkspace({ project, projectId, persisted, onChange }) {
  const [records, setRecords] = useState([]);
  const [form, setForm] = useState({ sourceType: 'patent', title: '', sourceUrl: '', summary: '', similarityRisk: 'Unknown', technicalOverlap: '', differentiator: '', blockingRisk: 'Unknown' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const load = async () => { try { const d = await Innovation.priorArt(projectId); setRecords(d.records || []); } catch { /* ignore */ } };
  useEffect(() => { if (persisted) load(); /* eslint-disable-next-line */ }, [projectId]);

  const add = async () => {
    if (!form.title.trim()) { setErr('A title is required.'); return; }
    setBusy(true); setErr('');
    try {
      const d = await Innovation.addPriorArt(projectId, form);
      setRecords((r) => [d.record, ...r]);
      setForm({ ...form, title: '', sourceUrl: '', summary: '', technicalOverlap: '', differentiator: '' });
      onChange?.(d.recalculatedReadiness);
    } catch (e) { setErr(e?.message || 'Failed to add record.'); } finally { setBusy(false); }
  };

  const sel = 'h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-slate-100 outline-none focus:border-aurora-violet/50';
  return (
    <SectionCard title="Prior-art workspace" eyebrow={persisted ? `${records.length} record(s)` : 'Saving requires DB'}>
      {!persisted && <p className="mb-3 text-[12px] text-amber-glow/80">Prior-art records persist only when the database is enabled. Until at least one record is added, prior-art risk is reported as unknown.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Source type"><select className={sel} value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value })}>{['patent', 'paper', 'product', 'github', 'article', 'manual'].map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
        <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Reference title" /></Field>
        <Field label="Source URL"><Input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder="https://…" /></Field>
        <Field label="Similarity risk"><select className={sel} value={form.similarityRisk} onChange={(e) => setForm({ ...form, similarityRisk: e.target.value })}>{['Unknown', 'Low', 'Medium', 'High'].map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Technical overlap"><Input value={form.technicalOverlap} onChange={(e) => setForm({ ...form, technicalOverlap: e.target.value })} placeholder="What overlaps technically" /></Field>
        <Field label="Differentiator"><Input value={form.differentiator} onChange={(e) => setForm({ ...form, differentiator: e.target.value })} placeholder="How yours differs" /></Field>
        <Field label="Blocking risk"><select className={sel} value={form.blockingRisk} onChange={(e) => setForm({ ...form, blockingRisk: e.target.value })}>{['Unknown', 'Low', 'Medium', 'High'].map((s) => <option key={s}>{s}</option>)}</select></Field>
      </div>
      {err && <p className="mt-2 text-[12px] text-rose-300">{err}</p>}
      <div className="mt-3"><Button size="sm" onClick={add} disabled={busy || !persisted}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}Add prior-art record</Button></div>
      {records.length > 0 && (
        <ul className="mt-4 space-y-2">
          {records.map((r) => (
            <li key={r.id} className="rounded-lg border border-white/8 bg-white/[0.02] p-3 text-[13px]">
              <div className="flex items-center gap-2"><Badge tone="cyan">{r.sourceType}</Badge><span className="font-medium text-slate-200">{r.title}</span>{r.sourceUrl && <a href={r.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-aurora-cyan"><ExternalLink size={13} /></a>}</div>
              {r.differentiator && <p className="mt-1 text-slate-400">Differentiator: {r.differentiator}</p>}
              <div className="mt-1 flex gap-2"><Badge tone="default">Similarity: {r.similarityRisk}</Badge><Badge tone="default">Blocking: {r.blockingRisk}</Badge></div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ---------------- Disclosure package ---------------- */
export function DisclosurePackagePanel({ project, projectId, persisted }) {
  const [d, setD] = useState(project?.disclosureDraft || null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try { const r = await Innovation.disclosure(projectId, bodyFor(project, persisted)); setD(r.disclosure); }
    catch (e) { setErr(e?.message || 'Failed to generate disclosure.'); } finally { setBusy(false); }
  };
  const F = ({ label, value }) => value ? <Block title={label}><p className="whitespace-pre-line text-[13px] text-slate-300">{value}</p></Block> : null;
  return (
    <SectionCard title="Invention disclosure draft" action={<Button size="sm" variant={d ? 'soft' : 'primary'} onClick={run} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <FileStack size={14} />}{d ? 'Regenerate' : 'Generate'}</Button>}>
      {err && <p className="mb-2 text-[12px] text-rose-300">{err}</p>}
      {!d ? <EmptyState icon={FileStack} title="No disclosure yet" hint="A disclosure draft for IP-cell review — not a filing." />
        : (
          <div className="space-y-3">
            {d.confidence === 'low' && <Badge tone="amber"><AlertTriangle size={12} /> Low-confidence draft</Badge>}
            <F label="Title" value={d.title} />
            <F label="Technical field" value={d.technicalField} />
            <F label="Background" value={d.background} />
            <F label="Problem" value={d.problem} />
            <F label="Existing limitations" value={d.existingLimitations} />
            <F label="Proposed invention" value={d.proposedInvention} />
            {d.systemComponents?.length > 0 && <Block title="System components"><List items={d.systemComponents} /></Block>}
            <F label="Technical workflow" value={d.technicalWorkflow} />
            <F label="Novel technical contribution" value={d.novelTechnicalContribution} />
            {d.advantages?.length > 0 && <Block title="Advantages"><List items={d.advantages} /></Block>}
            {d.alternativeEmbodiments?.length > 0 && <Block title="Alternative embodiments"><List items={d.alternativeEmbodiments} /></Block>}
            <F label="Prototype evidence" value={d.prototypeEvidence} />
            <F label="Prior-art comparison" value={d.priorArtComparison} />
            {d.possibleClaimDirections?.length > 0 && <Block title="Possible claim directions"><List items={d.possibleClaimDirections} /></Block>}
            {d.drawingsChecklist?.length > 0 && <Block title="Drawings / diagram checklist"><List items={d.drawingsChecklist} /></Block>}
            <div className="rounded-lg border border-rose-400/25 bg-rose-500/[0.06] p-2.5 text-[12px] text-rose-200"><AlertTriangle size={13} className="mr-1 inline" />{d.publicDisclosureWarning}</div>
            <F label="Attorney / IP-cell review notes" value={d.attorneyReviewNotes} />
            <NotLegalAdvice text={d.disclaimer} />
          </div>
        )}
    </SectionCard>
  );
}

/* ---------------- Convert buttons ---------------- */
export function ConvertButtons({ project, projectId, persisted, go }) {
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState('');
  const toProject = async () => {
    setBusy('project'); setMsg('');
    try {
      const clientId = projUid('proj');
      const d = await Innovation.convertToProject(projectId, bodyFor(project, persisted, { clientProjectId: clientId }));
      // Persist through the EXISTING project store (localStorage + /api/user/state).
      const p = d.projectPayload || {};
      saveClientProject({ id: clientId, name: p.title, ...p, createdAt: Date.now() });
      setMsg('Saved to your Projects. Opening Project Studio…');
      setTimeout(() => go?.('projectstudio'), 900);
    } catch (e) { setMsg(e?.message || 'Convert failed.'); } finally { setBusy(''); }
  };
  const toPatent = async () => {
    setBusy('patent'); setMsg('');
    try {
      const d = await Innovation.convertToPatent(projectId, bodyFor(project, persisted));
      setMsg(d.patentIdeaId ? 'Created in Patent OS. Opening…' : (d.note || 'Patent payload ready.'));
      if (d.patentIdeaId) setTimeout(() => go?.('patentportfolio'), 900);
    } catch (e) { setMsg(e?.message || 'Convert failed.'); } finally { setBusy(''); }
  };
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={toProject} disabled={!!busy}>{busy === 'project' ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />}Convert to Project</Button>
        <Button variant="outline" onClick={toPatent} disabled={!!busy}>{busy === 'patent' ? <Loader2 size={15} className="animate-spin" /> : <ScrollText size={15} />}Convert to Patent Workspace</Button>
        {msg && <span className="inline-flex items-center gap-1.5 text-[13px] text-aurora-mint"><CheckCircle2 size={14} />{msg}</span>}
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Convert to Project saves a real project record (title, problem, solution, roadmap, checklists). Convert to Patent Workspace creates a Patent OS idea carrying the source-backed problem, novelty angle and readiness.</p>
    </div>
  );
}

/* ---------------- tiny layout helpers ---------------- */
function Grid({ children }) { return <div className="grid gap-4 sm:grid-cols-2">{children}</div>; }
function Block({ title, children }) {
  return (
    <div>
      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h4>
      {children}
    </div>
  );
}
function Money({ label, value }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-0.5 inline-flex items-center gap-1 text-sm font-semibold text-slate-100"><IndianRupee size={13} className="text-aurora-mint" />{String(value || '—').replace(/^₹/, '')}</div>
    </div>
  );
}
