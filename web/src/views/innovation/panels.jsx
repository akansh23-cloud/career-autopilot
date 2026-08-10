import { useState, useEffect } from 'react';
import {
  Loader2, Boxes, IndianRupee, ScrollText, FileStack, ExternalLink,
  Plus, AlertTriangle, CheckCircle2, Rocket, Search, Copy,
} from 'lucide-react';
import { Button, Badge, Field, Input, EmptyState } from '../../components/ui/kit.jsx';
import { SectionCard } from '../common.jsx';
import { Innovation } from '../../lib/innovation.js';
import { saveProject as saveClientProject, uid as projUid } from '../../lib/projectStore.js';
import { ScoreBar, scoreTone, NotLegalAdvice } from './shared.jsx';
import MermaidDiagram from '../../components/common/MermaidDiagram.jsx';

// When the project is not persisted server-side (DB off), we round-trip the
// project object through the request body so every action still works.
const bodyFor = (project, persisted, extra = {}) => (persisted ? extra : { project, ...extra });

const Chips = ({ items, tone = 'default' }) => (
  <div className="flex flex-wrap gap-1.5">
    {(items || []).map((x, i) => <Badge key={i} tone={tone}>{x}</Badge>)}
  </div>
);
const List = ({ items }) => (
  <ul className="space-y-1 text-[13px] text-fg-secondary">
    {(items || []).map((x, i) => <li key={i} className="flex gap-2"><span className="text-fg-muted">•</span><span>{x}</span></li>)}
  </ul>
);

/* ---------------- Source evidence ---------------- */
export function SourceEvidencePanel({ cluster }) {
  const sources = cluster?.topSources || [];
  return (
    <SectionCard title="Source evidence" eyebrow={`${cluster?.signalCount || 0} signal(s) · ${(cluster?.sources || []).join(', ') || '—'}`}>
      {sources.length === 0
        ? <p className="text-[13px] text-fg-muted">No linkable sources captured for this cluster.</p>
        : (
          <ul className="space-y-2">
            {sources.map((s, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border border-subtle bg-surface-1 p-2.5">
                <Badge tone="cyan">{s.source}</Badge>
                <span className="flex-1 text-[13px] text-fg-secondary">{s.title}</span>
                {s.url && <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-aurora-cyan hover:text-fg"><ExternalLink size={14} /></a>}
              </li>
            ))}
          </ul>
        )}
      <p className="mt-2 text-[11px] text-fg-muted">Links open the original source. The system stores summaries only — it never re-fetches arbitrary URLs.</p>
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
      {err && <p className="mb-2 text-[12px] text-danger">{err}</p>}
      {!bp ? <EmptyState icon={Boxes} title="No blueprint yet" hint="Generate a practical, start-tomorrow build plan." />
        : (
          <div className="space-y-4 text-[13px]">
            {bp.confidence === 'low' && <Badge tone="amber"><AlertTriangle size={12} /> Low-confidence draft</Badge>}
            {bp.productDefinition && <p className="text-fg-secondary">{bp.productDefinition}</p>}
            <Grid>
              <Block title="MVP scope"><List items={bp.mvpScope} /></Block>
              <Block title="Out of scope"><List items={bp.outOfScope} /></Block>
              <Block title="Frontend screens"><List items={bp.frontendScreens} /></Block>
              <Block title="Backend APIs"><List items={bp.backendApis} /></Block>
              <Block title="Database schema"><List items={bp.databaseSchema} /></Block>
              <Block title="GitHub repo structure"><List items={bp.githubRepoStructure} /></Block>
            </Grid>
            {bp.systemArchitecture && <Block title="System architecture"><p className="text-fg-secondary">{bp.systemArchitecture}</p></Block>}
            {bp.dataFlow && <Block title="Data flow"><p className="text-fg-secondary">{bp.dataFlow}</p></Block>}
            {bp.coreAlgorithm && <Block title="Core algorithm"><p className="text-fg-secondary">{bp.coreAlgorithm}</p></Block>}
            {bp.weeklyRoadmap?.length > 0 && <Block title="Weekly roadmap"><List items={bp.weeklyRoadmap} /></Block>}
            {bp.testPlan?.length > 0 && <Block title="Test plan"><List items={bp.testPlan} /></Block>}
            {bp.demoScript && <Block title="Demo script"><p className="text-fg-secondary">{bp.demoScript}</p></Block>}
            {bp.deploymentPlan && <Block title="Deployment plan"><p className="text-fg-secondary">{bp.deploymentPlan}</p></Block>}
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
      {err && <p className="mb-2 text-[12px] text-danger">{err}</p>}
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
            {c.cloudApiHardwareNotes && <Block title="Cloud / API / hardware"><p className="text-fg-secondary">{c.cloudApiHardwareNotes}</p></Block>}
            {c.executionRisks?.length > 0 && <Block title="Execution risks"><List items={c.executionRisks} /></Block>}
            {c.mvpVsAdvanced && <Block title="MVP vs advanced"><p className="text-fg-secondary">{c.mvpVsAdvanced}</p></Block>}
            {c.shouldYouBuildVerdict && <div className="rounded-xl border border-aurora-mint/25 bg-aurora-mint/[0.05] p-3 text-ok"><span className="font-semibold">Should you build this? </span>{c.shouldYouBuildVerdict}</div>}
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
      {err && <p className="mb-2 text-[12px] text-danger">{err}</p>}
      {!ip ? <EmptyState icon={ScrollText} title="Not assessed yet" hint="Backend-owned scoring with hard caps — no inflated scores." />
        : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={scoreTone(ip.overall)} className="text-[13px]">{ip.overall}/100</Badge>
              <span className="text-sm font-semibold text-fg">{ip.label}</span>
              <Badge tone="violet">Route: {ip.recommendedIPRoute}</Badge>
            </div>
            {ip.capApplied != null && (
              <div className="rounded-lg border border-amber-glow/30 bg-amber-glow/[0.06] p-2.5 text-[12px] text-warn">
                Score capped at {ip.capApplied}. {ip.appliedCaps.map((c) => c.reason).join('; ')}.
              </div>
            )}
            <p className="text-[12px] text-fg-secondary">{ip.priorArtStatus}</p>
            {ip.section3kWarning && (
              <div className="rounded-lg border border-rose-400/25 bg-rose-500/[0.06] p-2.5 text-[12px] text-danger">
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
            {ip.narrative && <Block title="Technical-contribution note"><p className="text-[13px] text-fg-secondary">{ip.narrative}</p></Block>}
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

  const sel = 'h-11 w-full rounded-xl border border-subtle bg-surface-1 px-3 text-sm text-fg outline-none focus:border-aurora-violet/50';
  return (
    <SectionCard title="Prior-art workspace" eyebrow={persisted ? `${records.length} record(s)` : 'Saving requires DB'}>
      {!persisted && <p className="mb-3 text-[12px] text-warn/90">Prior-art records persist only when the database is enabled. Until at least one record is added, prior-art risk is reported as unknown.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Source type"><select className={sel} value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value })}>{['patent', 'paper', 'product', 'github', 'article', 'manual'].map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
        <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Reference title" /></Field>
        <Field label="Source URL"><Input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder="https://…" /></Field>
        <Field label="Similarity risk"><select className={sel} value={form.similarityRisk} onChange={(e) => setForm({ ...form, similarityRisk: e.target.value })}>{['Unknown', 'Low', 'Medium', 'High'].map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Technical overlap"><Input value={form.technicalOverlap} onChange={(e) => setForm({ ...form, technicalOverlap: e.target.value })} placeholder="What overlaps technically" /></Field>
        <Field label="Differentiator"><Input value={form.differentiator} onChange={(e) => setForm({ ...form, differentiator: e.target.value })} placeholder="How yours differs" /></Field>
        <Field label="Blocking risk"><select className={sel} value={form.blockingRisk} onChange={(e) => setForm({ ...form, blockingRisk: e.target.value })}>{['Unknown', 'Low', 'Medium', 'High'].map((s) => <option key={s}>{s}</option>)}</select></Field>
      </div>
      {err && <p className="mt-2 text-[12px] text-danger">{err}</p>}
      <div className="mt-3"><Button size="sm" onClick={add} disabled={busy || !persisted}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}Add prior-art record</Button></div>
      {records.length > 0 && (
        <ul className="mt-4 space-y-2">
          {records.map((r) => (
            <li key={r.id} className="rounded-lg border border-subtle bg-surface-1 p-3 text-[13px]">
              <div className="flex items-center gap-2"><Badge tone="cyan">{r.sourceType}</Badge><span className="font-medium text-fg">{r.title}</span>{r.sourceUrl && <a href={r.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-aurora-cyan"><ExternalLink size={13} /></a>}</div>
              {r.differentiator && <p className="mt-1 text-fg-secondary">Differentiator: {r.differentiator}</p>}
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
  const F = ({ label, value }) => value ? <Block title={label}><p className="whitespace-pre-line text-[13px] text-fg-secondary">{value}</p></Block> : null;
  return (
    <SectionCard title="Invention disclosure draft" action={<Button size="sm" variant={d ? 'soft' : 'primary'} onClick={run} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <FileStack size={14} />}{d ? 'Regenerate' : 'Generate'}</Button>}>
      {err && <p className="mb-2 text-[12px] text-danger">{err}</p>}
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
            <div className="rounded-lg border border-rose-400/25 bg-rose-500/[0.06] p-2.5 text-[12px] text-danger"><AlertTriangle size={13} className="mr-1 inline" />{d.publicDisclosureWarning}</div>
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
    <div className="rounded-2xl border border-subtle bg-surface-1 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={toProject} disabled={!!busy}>{busy === 'project' ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />}Convert to Project</Button>
        <Button variant="outline" onClick={toPatent} disabled={!!busy}>{busy === 'patent' ? <Loader2 size={15} className="animate-spin" /> : <ScrollText size={15} />}Convert to Patent Workspace</Button>
        {msg && <span className="inline-flex items-center gap-1.5 text-[13px] text-aurora-mint"><CheckCircle2 size={14} />{msg}</span>}
      </div>
      <p className="mt-2 text-[11px] text-fg-muted">Convert to Project saves a real project record (title, problem, solution, roadmap, checklists). Convert to Patent Workspace creates a Patent OS idea carrying the source-backed problem, novelty angle and readiness.</p>
    </div>
  );
}

/* ---------------- tiny layout helpers ---------------- */
function Grid({ children }) { return <div className="grid gap-4 sm:grid-cols-2">{children}</div>; }
function Block({ title, children }) {
  return (
    <div>
      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{title}</h4>
      {children}
    </div>
  );
}
function Money({ label, value }) {
  return (
    <div className="rounded-lg border border-subtle bg-surface-1 p-2.5">
      <div className="text-[11px] text-fg-muted">{label}</div>
      <div className="mt-0.5 inline-flex items-center gap-1 text-sm font-semibold text-fg"><IndianRupee size={13} className="text-aurora-mint" />{String(value || '—').replace(/^₹/, '')}</div>
    </div>
  );
}

/* ============================================================
   Patent OS world-class upgrade — new panels
   ============================================================ */
const SEL = 'rounded-lg border border-subtle bg-surface-1 px-2.5 py-1.5 text-[12.5px] text-fg focus:border-aurora-violet/50 focus:outline-none';
const riskTone = (r) => (r === 'high' ? 'rose' : r === 'medium' ? 'amber' : 'mint');

/* ---------------- Simple Explanation ("Explain What To Build") ---------------- */
export function SimpleExplanationPanel({ project, projectId, persisted }) {
  const [data, setData] = useState(project?.simplified || null);
  const [audience, setAudience] = useState('beginner');
  const [detail, setDetail] = useState('normal');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try { const d = await Innovation.simplify(projectId, bodyFor(project, persisted, { audience, detailLevel: detail })); setData(d.simplified); }
    catch (e) { setErr(e?.message || 'Failed to generate explanation.'); } finally { setBusy(false); }
  };
  const cs = data?.clarityScores || {};
  return (
    <SectionCard title="Explain what to build" eyebrow="Student-friendly" action={
      <div className="flex flex-wrap items-center gap-2">
        <select className={SEL} value={audience} onChange={(e) => setAudience(e.target.value)}>
          <option value="beginner">Beginner student</option><option value="intermediate">Intermediate builder</option>
          <option value="faculty">Faculty / IP cell</option><option value="patent_agent">Patent agent</option><option value="recruiter">Recruiter-safe</option>
        </select>
        <select className={SEL} value={detail} onChange={(e) => setDetail(e.target.value)}>
          <option value="simple">Simple</option><option value="normal">Normal</option><option value="detailed">Detailed</option>
        </select>
        <Button size="sm" variant={data ? 'soft' : 'primary'} onClick={run} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Boxes size={14} />}{data ? 'Regenerate' : 'Explain'}</Button>
      </div>
    }>
      {err && <p className="mb-2 text-[12px] text-danger">{err}</p>}
      {!data ? <EmptyState icon={Boxes} title="No explanation yet" hint="Turn this project into plain language for your chosen audience." />
        : (
          <div className="space-y-4 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="cyan">{data.audience}</Badge>
              <Badge tone={data.confidence === 'low' ? 'amber' : 'mint'}>{data.confidence}-confidence</Badge>
            </div>
            {data.oneLineSummary && <p className="text-[14px] font-medium text-fg">{data.oneLineSummary}</p>}
            <Grid>
              <Block title="The pain"><p className="text-fg-secondary">{data.painPoint}</p></Block>
              <Block title="Who faces it"><p className="text-fg-secondary">{data.whoFacesIt}</p></Block>
              <Block title="Real-world scenario"><p className="text-fg-secondary">{data.realWorldScenario}</p></Block>
              <Block title="Today's workaround"><p className="text-fg-secondary">{data.currentWorkaround}</p></Block>
              <Block title="Why existing solutions fail"><p className="text-fg-secondary">{data.whyExistingSolutionsFail}</p></Block>
              <Block title="How it solves the problem"><p className="text-fg-secondary">{data.howItSolvesProblem}</p></Block>
            </Grid>
            <Block title="What to build"><p className="text-fg-secondary">{data.whatToBuild}</p></Block>
            {data.mvpModules?.length > 0 && <Block title="MVP modules"><List items={data.mvpModules} /></Block>}
            {data.demoMoment && <Block title="The demo moment"><p className="text-fg-secondary">{data.demoMoment}</p></Block>}
            {data.skillsNeeded?.length > 0 && <Block title="Skills needed"><Chips items={data.skillsNeeded} tone="violet" /></Block>}
            {data.firstWeekTasks?.length > 0 && <Block title="First-week tasks"><List items={data.firstWeekTasks} /></Block>}
            {data.whatNotToBuildYet?.length > 0 && <Block title="What NOT to build yet"><List items={data.whatNotToBuildYet} /></Block>}
            {data.patentAngleSimple && <Block title="Patent angle (simple)"><p className="text-fg-secondary">{data.patentAngleSimple}</p></Block>}
            <div className="rounded-xl border border-subtle bg-surface-1 p-3">
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Clarity</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <ScoreBar label="Pain clarity" value={cs.painClarity} />
                <ScoreBar label="Build clarity" value={cs.buildClarity} />
                <ScoreBar label="Demo clarity" value={cs.demoClarity} />
                <ScoreBar label="IP-angle clarity" value={cs.ipAngleClarity} />
              </div>
            </div>
            {data.missingInfo?.length > 0 && <Block title="Missing info to clarify"><List items={data.missingInfo} /></Block>}
          </div>
        )}
    </SectionCard>
  );
}

/* ---------------- India CRI / Section 3(k) ---------------- */
export function IndiaCriPanel({ project, projectId, persisted }) {
  const [d, setD] = useState(project?.indiaCri || null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try { const r = await Innovation.indiaCri(projectId, bodyFor(project, persisted)); setD(r.indiaCri); }
    catch (e) { setErr(e?.message || 'Failed.'); } finally { setBusy(false); }
  };
  return (
    <SectionCard title="India CRI / Section 3(k)" eyebrow="Software patentability risk" action={<Button size="sm" variant={d ? 'soft' : 'primary'} onClick={run} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <ScrollText size={14} />}{d ? 'Re-check' : 'Validate'}</Button>}>
      {err && <p className="mb-2 text-[12px] text-danger">{err}</p>}
      {!d ? <EmptyState icon={ScrollText} title="Not validated yet" hint="Check Section 3(k) risk (computer-program / algorithm / business-method per se)." />
        : (
          <div className="space-y-3 text-[13px]">
            <Badge tone={riskTone(d.section3kRisk)}>Section 3(k) risk: {d.section3kRisk}</Badge>
            {d.riskReasons?.length > 0 && <Block title="Why"><List items={d.riskReasons} /></Block>}
            <Grid>
              <Block title="Technical effect"><p className="text-fg-secondary">{d.technicalEffect}</p></Block>
              <Block title="Technical problem"><p className="text-fg-secondary">{d.technicalProblem}</p></Block>
              <Block title="Technical means"><p className="text-fg-secondary">{d.technicalMeans}</p></Block>
              <Block title="Verdict"><p className="text-fg-secondary">{d.patentRouteVerdict}</p></Block>
            </Grid>
            {d.improvementSuggestions?.length > 0 && <Block title="How to strengthen"><List items={d.improvementSuggestions} /></Block>}
            <NotLegalAdvice />
          </div>
        )}
    </SectionCard>
  );
}

/* ---------------- Prior-art search plan ---------------- */
export function PriorArtSearchPlanPanel({ project, projectId, persisted }) {
  const [d, setD] = useState(project?.priorArtSearchPlan || null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try { const r = await Innovation.priorArtSearchPlan(projectId, bodyFor(project, persisted)); setD(r.searchPlan); }
    catch (e) { setErr(e?.message || 'Failed.'); } finally { setBusy(false); }
  };
  return (
    <SectionCard title="Prior-art search plan" eyebrow="Queries + what to look for" action={<Button size="sm" variant={d ? 'soft' : 'primary'} onClick={run} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}{d ? 'Regenerate' : 'Generate'}</Button>}>
      {err && <p className="mb-2 text-[12px] text-danger">{err}</p>}
      {!d ? <EmptyState icon={Search} title="No search plan yet" hint="Generate patent / paper / product / GitHub search queries and a differentiation checklist." />
        : (
          <div className="space-y-4 text-[13px]">
            <div className="rounded-xl border border-amber-glow/30 bg-amber-glow/[0.06] p-2.5 text-[12px] text-warn">{d.disclaimer}</div>
            <Grid>
              <Block title="Patent search queries"><List items={d.patentSearchQueries} /></Block>
              <Block title="Paper / arXiv queries"><List items={d.paperSearchQueries} /></Block>
              <Block title="Product queries"><List items={d.productSearchQueries} /></Block>
              <Block title="GitHub queries"><List items={d.githubSearchQueries} /></Block>
            </Grid>
            {d.classificationHints?.length > 0 && <Block title="Classification hints (CPC/IPC guesses)"><List items={d.classificationHints} /></Block>}
            {d.noveltyQuestions?.length > 0 && <Block title="Novelty questions"><List items={d.noveltyQuestions} /></Block>}
            {d.redFlags?.length > 0 && <Block title="Red flags"><List items={d.redFlags} /></Block>}
            {d.differentiationChecklist?.length > 0 && <Block title="Differentiation checklist"><List items={d.differentiationChecklist} /></Block>}
          </div>
        )}
    </SectionCard>
  );
}

/* ---------------- Claim directions ---------------- */
export function ClaimDirectionsPanel({ project, projectId, persisted }) {
  const [d, setD] = useState(project?.claimDirections || null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try { const r = await Innovation.claimDirections(projectId, bodyFor(project, persisted)); setD(r.claimDirections); }
    catch (e) { setErr(e?.message || 'Failed.'); } finally { setBusy(false); }
  };
  return (
    <SectionCard title="Claim directions" eyebrow="Plain-language aid — not legal claims" action={<Button size="sm" variant={d ? 'soft' : 'primary'} onClick={run} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <ScrollText size={14} />}{d ? 'Regenerate' : 'Generate'}</Button>}>
      {err && <p className="mb-2 text-[12px] text-danger">{err}</p>}
      {!d ? <EmptyState icon={ScrollText} title="No claim directions yet" hint="Get safe, plain-language claim DIRECTIONS for IP-cell / patent-agent review." />
        : (
          <div className="space-y-3 text-[13px]">
            {d.plainLanguageClaimIdea && <Block title="Plain-language claim idea"><p className="text-fg-secondary">{d.plainLanguageClaimIdea}</p></Block>}
            <Grid>
              <Block title="Possible claim elements"><List items={d.possibleClaimElements} /></Block>
              <Block title="Dependent directions"><List items={d.dependentDirections} /></Block>
              <Block title="Likely NOT claimable"><List items={d.likelyNotClaimable} /></Block>
              <Block title="Attorney review notes"><List items={d.attorneyReviewNotes} /></Block>
            </Grid>
            <div className="grid gap-2 sm:grid-cols-3">
              <RiskBox label="Claim breadth" value={d.claimBreadthRisk} />
              <RiskBox label="Design-around" value={d.designAroundRisk} />
              <RiskBox label="Enforceability" value={d.enforceabilityRisk} />
            </div>
            <NotLegalAdvice text={d.disclaimer} />
          </div>
        )}
    </SectionCard>
  );
}
function RiskBox({ label, value }) {
  return <div className="rounded-lg border border-subtle bg-surface-1 p-2.5"><div className="text-[11px] text-fg-muted">{label} risk</div><div className="mt-0.5 text-[12.5px] text-fg">{value}</div></div>;
}

/* ---------------- Prototype evidence ---------------- */
export function PrototypeEvidencePanel({ project, projectId, persisted, onChange }) {
  const [checklist, setChecklist] = useState(project?.evidenceChecklist || null);
  const [evidence, setEvidence] = useState(project?.evidence || []);
  const [score, setScore] = useState(project?.prototypeEvidenceScore || 0);
  const [ip, setIp] = useState(project?.ipReadiness?.overall ?? null);
  const [form, setForm] = useState({ type: 'repo', title: '', url: '', source: 'github', verified: false });
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  const gen = async () => {
    setBusy('checklist'); setErr('');
    try { const r = await Innovation.evidenceChecklist(projectId, bodyFor(project, persisted)); setChecklist(r.evidenceChecklist); }
    catch (e) { setErr(e?.message || 'Failed.'); } finally { setBusy(''); }
  };
  const add = async () => {
    if (!form.title) { setErr('Give the evidence a title.'); return; }
    setBusy('add'); setErr('');
    try {
      const r = await Innovation.addEvidence(projectId, bodyFor(project, persisted, form));
      setEvidence(r.evidence || []); setScore(r.prototypeEvidenceScore || 0);
      if (r.ipReadiness) setIp(r.ipReadiness.overall);
      setForm({ type: 'repo', title: '', url: '', source: 'github', verified: false });
      onChange && onChange();
    } catch (e) { setErr(e?.message || 'Failed to add evidence.'); } finally { setBusy(''); }
  };
  return (
    <SectionCard title="Prototype evidence" eyebrow={`Evidence score: ${score}${ip != null ? ` · IP readiness: ${ip}` : ''}`} action={<Button size="sm" variant={checklist ? 'soft' : 'primary'} onClick={gen} disabled={!!busy}>{busy === 'checklist' ? <Loader2 size={14} className="animate-spin" /> : <FileStack size={14} />}{checklist ? 'Regenerate checklist' : 'Generate checklist'}</Button>}>
      {err && <p className="mb-2 text-[12px] text-danger">{err}</p>}
      <div className="mb-4 rounded-xl border border-subtle bg-surface-1 p-3">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Attach evidence</h4>
        <div className="flex flex-wrap items-end gap-2">
          <select className={SEL} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
            <option value="github">GitHub</option><option value="live_demo">Live demo</option><option value="benchmark">Benchmark</option><option value="screenshot">Screenshot</option><option value="video">Video</option><option value="upload">Upload</option><option value="manual">Manual</option>
          </select>
          <Input className="min-w-[160px] flex-1" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Input className="min-w-[160px] flex-1" placeholder="URL (optional)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <label className="inline-flex items-center gap-1.5 text-[12px] text-fg-secondary"><input type="checkbox" checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} /> verified</label>
          <Button size="sm" onClick={add} disabled={!!busy}>{busy === 'add' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}Add</Button>
        </div>
        <p className="mt-2 text-[11px] text-fg-muted">Adding a verified repo/demo lifts the prototype cap and recomputes IP-readiness honestly. Private repo details are never exposed publicly.</p>
      </div>
      {evidence.length > 0 && (
        <ul className="mb-4 space-y-1.5">
          {evidence.map((e, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg border border-subtle bg-surface-1 p-2 text-[12.5px]">
              <Badge tone="cyan">{e.source}</Badge><span className="flex-1 text-fg-secondary">{e.title}</span>
              {e.verified && <Badge tone="mint"><CheckCircle2 size={11} /> verified</Badge>}
              {e.url && <a href={e.url} target="_blank" rel="noreferrer noopener" className="text-aurora-cyan hover:text-fg"><ExternalLink size={13} /></a>}
            </li>
          ))}
        </ul>
      )}
      {!checklist ? <EmptyState icon={FileStack} title="No checklist yet" hint="Generate the required / recommended / benchmark / IP evidence list." />
        : (
          <div className="space-y-3 text-[13px]">
            <Grid>
              <Block title="Required"><List items={checklist.requiredEvidence} /></Block>
              <Block title="Recommended"><List items={checklist.recommendedEvidence} /></Block>
              <Block title="Benchmark"><List items={checklist.benchmarkEvidence} /></Block>
              <Block title="Demo"><List items={checklist.demoEvidence} /></Block>
              <Block title="IP evidence"><List items={checklist.ipEvidence} /></Block>
              <Block title="Recruiter-safe"><List items={checklist.recruiterEvidence} /></Block>
            </Grid>
            {checklist.missingCriticalEvidence?.length > 0 && <Block title="Missing critical evidence"><List items={checklist.missingCriticalEvidence} /></Block>}
          </div>
        )}
    </SectionCard>
  );
}

/* ---------------- Confidentiality + disclosure risk ---------------- */
export function ConfidentialityPanel({ project, projectId, persisted }) {
  const [conf, setConf] = useState({
    confidentialityStatus: project?.confidentialityStatus || 'private',
    publicDisclosureStatus: project?.publicDisclosureStatus || 'unknown',
    disclosureChannel: project?.disclosureChannel || '', disclosureDate: project?.disclosureDate || '',
  });
  const [action, setAction] = useState('make_public');
  const [risk, setRisk] = useState(null);
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const save = async () => {
    setBusy('save'); setErr(''); setMsg('');
    try { await Innovation.setConfidentiality(projectId, bodyFor(project, persisted, conf)); setMsg('Saved.'); }
    catch (e) { setErr(e?.message || 'Failed to save.'); } finally { setBusy(''); }
  };
  const check = async () => {
    setBusy('check'); setErr('');
    try { const r = await Innovation.disclosureRiskCheck(projectId, bodyFor(project, persisted, { action })); setRisk(r); }
    catch (e) { setErr(e?.message || 'Failed.'); } finally { setBusy(''); }
  };
  return (
    <SectionCard title="Confidentiality & disclosure" eyebrow="Protect novelty before going public">
      {err && <p className="mb-2 text-[12px] text-danger">{err}</p>}
      <div className="space-y-3 text-[13px]">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Confidentiality status"><select className={`${SEL} w-full`} value={conf.confidentialityStatus} onChange={(e) => setConf({ ...conf, confidentialityStatus: e.target.value })}><option value="private">Private</option><option value="shared_with_faculty">Shared with faculty</option><option value="shared_with_ip_cell">Shared with IP cell</option><option value="public_safe">Public-safe</option></select></Field>
          <Field label="Public disclosure status"><select className={`${SEL} w-full`} value={conf.publicDisclosureStatus} onChange={(e) => setConf({ ...conf, publicDisclosureStatus: e.target.value })}><option value="unknown">Unknown</option><option value="none">None</option><option value="planned">Planned</option><option value="already_disclosed">Already disclosed</option></select></Field>
          <Field label="Disclosure channel"><Input value={conf.disclosureChannel} onChange={(e) => setConf({ ...conf, disclosureChannel: e.target.value })} placeholder="e.g. conference, GitHub, demo day" /></Field>
          <Field label="Disclosure date"><Input value={conf.disclosureDate} onChange={(e) => setConf({ ...conf, disclosureDate: e.target.value })} placeholder="YYYY-MM-DD" /></Field>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={!!busy}>{busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}Save</Button>
          {msg && <span className="text-[12px] text-aurora-mint">{msg}</span>}
        </div>
        <div className="rounded-xl border border-subtle bg-surface-1 p-3">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Check disclosure risk before an action</h4>
          <div className="flex flex-wrap items-center gap-2">
            <select className={SEL} value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="make_public">Make public</option><option value="export_recruiter">Export recruiter-safe</option><option value="post_linkedin">Post on LinkedIn</option><option value="publish_github">Publish GitHub repo</option><option value="share_disclosure">Share full disclosure</option><option value="move_to_patent_review">Move to patent review</option>
            </select>
            <Button size="sm" variant="soft" onClick={check} disabled={!!busy}>{busy === 'check' ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}Check risk</Button>
          </div>
          {risk && (
            <div className="mt-3 space-y-2">
              <Badge tone={riskTone(risk.riskLevel)}>Risk: {risk.riskLevel}</Badge>
              {risk.warnings?.length > 0 && <List items={risk.warnings} />}
              {risk.safeToShareSummary && <Block title="Safe-to-share summary"><p className="text-fg-secondary">{risk.safeToShareSummary}</p></Block>}
              {risk.doNotShare?.length > 0 && <Block title="Do NOT share"><List items={risk.doNotShare} /></Block>}
              {risk.recommendedNextSteps?.length > 0 && <Block title="Recommended next steps"><List items={risk.recommendedNextSteps} /></Block>}
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

const mermaidCode = (item) => (typeof item === 'string' ? item : (item?.code || item?.mermaid || ''));
const mermaidTitle = (item, index) => (typeof item === 'string' ? `Diagram ${index + 1}` : (item?.title || item?.figureNumber || `Diagram ${index + 1}`));

/* ---------------- Diagram plan ---------------- */
export function DiagramPlanPanel({ project, projectId, persisted }) {
  const [d, setD] = useState(project?.diagramPlan || null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try { const r = await Innovation.diagramPlan(projectId, bodyFor(project, persisted)); setD(r.diagramPlan); }
    catch (e) { setErr(e?.message || 'Failed.'); } finally { setBusy(false); }
  };
  const copy = async (code, label) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1600);
    } catch {
      setErr('Copy failed. Select the Mermaid text manually.');
    }
  };
  return (
    <SectionCard title="Patent diagram plan" eyebrow="Visual Mermaid diagrams + patent figure plan" action={<Button size="sm" variant={d ? 'soft' : 'primary'} onClick={run} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Boxes size={14} />}{d ? 'Regenerate' : 'Generate'}</Button>}>
      {err && <p className="mb-2 text-[12px] text-danger">{err}</p>}
      {copied && <p className="mb-2 text-[12px] text-aurora-mint">Copied {copied} Mermaid text.</p>}
      {!d ? <EmptyState icon={Boxes} title="No diagram plan yet" hint="Generate patent figure plans with rendered Mermaid architecture/process diagrams." />
        : (
          <div className="space-y-4 text-[13px]">
            {(d.figures || []).map((f, i) => (
              <div key={i} className="rounded-xl border border-subtle bg-surface-1 p-3">
                <div className="flex items-center gap-2"><Badge tone="violet">{f.figureNumber}</Badge><span className="font-medium text-fg">{f.title}</span></div>
                <p className="mt-1.5 text-fg-secondary">{f.purpose}</p>
                {f.components?.length > 0 && <div className="mt-2"><Chips items={f.components} /></div>}
                {f.flow?.length > 0 && <p className="mt-2 text-[12px] text-fg-muted">Flow: {f.flow.join(' → ')}</p>}
                {f.notesForDrawing && <p className="mt-2 text-[12px] text-fg-muted">{f.notesForDrawing}</p>}
              </div>
            ))}
            {d.mermaidDiagrams?.length > 0 && (
              <Block title="Rendered Mermaid diagrams">
                <div className="space-y-4">
                  {d.mermaidDiagrams.map((m, i) => {
                    const code = mermaidCode(m);
                    const title = mermaidTitle(m, i);
                    return (
                      <div key={i} className="rounded-xl border border-subtle bg-surface-1 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="font-medium text-fg">{title}</span>
                          <Button size="sm" variant="ghost" onClick={() => copy(code, title)}><Copy size={13} />Copy Mermaid</Button>
                        </div>
                        <MermaidDiagram chart={code} />
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[12px] text-fg-secondary hover:text-fg">Show Mermaid text</summary>
                          <pre className="mt-2 overflow-x-auto rounded-lg border border-subtle bg-sunken p-2.5 text-[11.5px] text-fg-secondary">{code}</pre>
                        </details>
                      </div>
                    );
                  })}
                </div>
              </Block>
            )}
            {d.diagramChecklist?.length > 0 && <Block title="Checklist"><List items={d.diagramChecklist} /></Block>}
          </div>
        )}
    </SectionCard>
  );
}

/* ---------------- Experiment plan ---------------- */
export function ExperimentPlanPanel({ project, projectId, persisted }) {
  const [d, setD] = useState(project?.experimentPlan || null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try { const r = await Innovation.experimentPlan(projectId, bodyFor(project, persisted)); setD(r.experimentPlan); }
    catch (e) { setErr(e?.message || 'Failed.'); } finally { setBusy(false); }
  };
  return (
    <SectionCard title="Benchmark / experiment plan" eyebrow="Prove the technical effect" action={<Button size="sm" variant={d ? 'soft' : 'primary'} onClick={run} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <FileStack size={14} />}{d ? 'Regenerate' : 'Generate'}</Button>}>
      {err && <p className="mb-2 text-[12px] text-danger">{err}</p>}
      {!d ? <EmptyState icon={FileStack} title="No experiment plan yet" hint="Plan a baseline vs. proposed benchmark with metrics and a result table." />
        : (
          <div className="space-y-3 text-[13px]">
            <Grid>
              <Block title="Baseline"><p className="text-fg-secondary">{d.baseline}</p></Block>
              <Block title="Proposed method"><p className="text-fg-secondary">{d.proposedMethod}</p></Block>
            </Grid>
            {d.metrics?.length > 0 && <Block title="Metrics"><Chips items={d.metrics} tone="cyan" /></Block>}
            {d.testSetup?.length > 0 && <Block title="Test setup"><List items={d.testSetup} /></Block>}
            {d.sampleScenarios?.length > 0 && <Block title="Sample scenarios"><List items={d.sampleScenarios} /></Block>}
            {d.resultTableTemplate?.length > 0 && (
              <Block title="Result table (template)">
                <div className="overflow-x-auto"><table className="w-full text-[12px]"><thead><tr className="text-fg-muted">{Object.keys(d.resultTableTemplate[0]).map((k) => <th key={k} className="border-b border-subtle px-2 py-1 text-left font-medium">{k}</th>)}</tr></thead>
                  <tbody>{d.resultTableTemplate.map((row, i) => <tr key={i}>{Object.keys(d.resultTableTemplate[0]).map((k) => <td key={k} className="border-b border-subtle px-2 py-1 text-fg-secondary">{row[k] || '—'}</td>)}</tr>)}</tbody></table></div>
              </Block>
            )}
            {d.successCriteria?.length > 0 && <Block title="Success criteria"><List items={d.successCriteria} /></Block>}
            <Grid>
              <Block title="IP evidence value"><p className="text-fg-secondary">{d.ipEvidenceValue}</p></Block>
              <Block title="Recruiter demo value"><p className="text-fg-secondary">{d.recruiterDemoValue}</p></Block>
            </Grid>
          </div>
        )}
    </SectionCard>
  );
}

/* ---------------- Similar memory (RAG) ---------------- */
export function SimilarMemoryPanel({ projectId }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try { const r = await Innovation.similar(projectId); setD(r); }
    catch (e) { setErr(e?.message || 'Failed.'); } finally { setBusy(false); }
  };
  return (
    <SectionCard title="Similar ideas (memory)" eyebrow="Avoid duplicates · learn from the past" action={<Button size="sm" variant={d ? 'soft' : 'primary'} onClick={run} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}{d ? 'Refresh' : 'Find similar'}</Button>}>
      {err && <p className="mb-2 text-[12px] text-danger">{err}</p>}
      {!d ? <EmptyState icon={Search} title="Not searched yet" hint="Find similar past projects/ideas from your innovation memory." />
        : (d.results?.length ? (
          <div className="space-y-2 text-[13px]">
            {d.similarityWarnings?.length > 0 && <div className="rounded-xl border border-amber-glow/30 bg-amber-glow/[0.06] p-2.5 text-[12px] text-warn">{d.similarityWarnings.join(' ')}</div>}
            {d.results.map((r, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-subtle bg-surface-1 p-2.5">
                <Badge tone={r.similarity >= 78 ? 'rose' : r.similarity >= 50 ? 'amber' : 'cyan'}>{r.similarity}%</Badge>
                <span className="flex-1 text-fg-secondary">{r.title}</span>
                <Badge tone="default">{r.sourceType}</Badge>
              </div>
            ))}
          </div>
        ) : <EmptyState icon={Search} title="No similar items" hint={d.mode === 'empty' ? 'Your memory is empty — generate more projects to build it up.' : 'No close matches found — this looks distinct.'} />)}
    </SectionCard>
  );
}
