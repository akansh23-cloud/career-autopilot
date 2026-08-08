/* ============================================================
   Project Intelligence — UI panels for the Career-Gap Driven
   Project Engine. Rendered inside ProjectStudio's WorkspaceModal
   (new tabs) and on the main view (gap-driven recommendations).

   Every panel calls the deterministic /api/project-intelligence/*
   endpoints via web/src/lib/projectIntelligence.js and degrades
   gracefully offline. Nothing here fabricates proof or marks
   unverified work as verified. Reuses the Aurora design system.
   ============================================================ */
import { useEffect, useState } from 'react';
import {
  Target, Sparkles, ShieldCheck, Gauge,
  AlertTriangle, CheckCircle2, Circle, Copy, Check,
  Layers, Clock, TrendingUp, Star, Rocket, Wand2,
} from 'lucide-react';
import { Badge, Button, Skeleton } from '../components/ui/kit.jsx';
import { ArchitectureDiagram } from '../components/proof/ProofViews.jsx';
import { proofScoreBreakdown, getProjects } from '../lib/projectStore.js';
import {
  whyBuild, explain, blueprint, diagrams, feasibility,
  proofChecklist, taskBoard, resumeOutput, findSimilar, recommendProjects,
} from '../lib/projectIntelligence.js';

/* ---------------- small shared UI ---------------- */
function Panel({ title, children, action }) {
  return (
    <div className="rounded-xl border border-subtle bg-base/55 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-fg-muted">{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Chips({ items, tone = 'cyan', empty = '—' }) {
  if (!items?.length) return <span className="text-xs text-fg-muted">{empty}</span>;
  return <div className="flex flex-wrap gap-1.5">{items.map((s, i) => <Badge key={i} tone={tone}>{s}</Badge>)}</div>;
}

function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="soft" onClick={() => { navigator.clipboard?.writeText(text || ''); setDone(true); setTimeout(() => setDone(false), 1400); }}>
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Copied' : label}
    </Button>
  );
}

const CONF_TONE = { High: 'mint', Medium: 'cyan', Low: 'amber' };
function ConfBadge({ value }) {
  if (!value) return null;
  return <Badge tone={CONF_TONE[value] || 'cyan'}><Gauge size={11} /> {value} confidence</Badge>;
}

function ModeNote({ mode }) {
  if (!mode) return null;
  const ai = mode.includes('ai');
  return (
    <p className="text-[10px] text-fg-muted">
      {ai ? 'Deterministic engine with optional AI enrichment available.' : 'Deterministic engine (no AI key required). Output is rule-based, not fabricated.'}
    </p>
  );
}

function Loading({ lines = 3 }) {
  return <div className="space-y-2">{Array.from({ length: lines }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div>;
}

/* React state from an async loader, re-run when `dep` changes. The loader is
   intentionally excluded from deps (it is recreated each render); `dep` is the
   stable signal that should re-trigger the fetch. */
function useAsync(loader, dep) {
  const [state, setState] = useState({ loading: true, data: null });
  useEffect(() => {
    let alive = true;
    setState({ loading: true, data: null });
    Promise.resolve(loader()).then((data) => { if (alive) setState({ loading: false, data }); })
      .catch(() => { if (alive) setState({ loading: false, data: null }); });
    return () => { alive = false; };
  }, [dep]);
  return state;
}

/* ============================================================
   Map a saved Project Studio project onto the recommendation
   shape the intelligence services reason about. Lets every panel
   work for already-built projects, not just fresh recommendations.
   ============================================================ */
export function deriveRecommendation(p = {}) {
  const skills = p.skillsCovered || p.skills || [];
  return {
    id: p.id,
    title: p.title,
    targetRole: p.targetRole || 'Software Engineer',
    skills,
    techStack: p.techStack || [],
    problemStatement: p.problemStatement || p.summary || p.useCase || '',
    whyRecommended: p.creator?.whyRecommended || p.whyRecommended || '',
    skillGapsFixed: p.skillGapsFixed || skills,
    proofGapsFixed: p.proofGapsFixed || [],
    jobRequirementsMatched: p.jobRequirementsMatched || [],
    careerReadinessImpact: p.careerReadinessImpact || '',
    difficulty: (p.difficulty || 'intermediate').toLowerCase(),
    estimatedTime: p.duration || p.estimatedTime || '2–3 weeks',
    evidenceNeeded: p.evidenceNeeded || [],
    integrations: p.integrations || [],
    isInnovationGrade: !!p.innovationGrade || !!p.innovationClusterId,
    recommendationConfidence: p.recommendationConfidence || 'Medium',
  };
}

/* evidence the resume rule can trust, read off a real saved project */
function evidenceFromProject(p = {}) {
  return {
    githubVerified: !!(p.github && p.github.success),
    githubAnalyzed: !!(p.github && p.github.success),
    liveVerified: !!(p.liveVerification && p.liveVerification.reachable),
    testsVerified: !!(p.github && p.github.success && p.github.files && p.github.files.tests),
    provenSkills: (p.github && p.github.success && p.github.detectedSkills) || [],
  };
}

/* ============================================================
   TAB PANELS
   ============================================================ */

export function WhyBuildPanel({ project }) {
  const rec = deriveRecommendation(project);
  const { loading, data } = useAsync(() => whyBuild(rec, { targetRole: rec.targetRole }), project?.id);
  if (loading) return <Loading lines={4} />;
  const w = (data && data.whyBuild) || {};
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="violet"><Target size={11} /> {w.targetRoleSupported || rec.targetRole}</Badge>
        <ConfBadge value={w.recommendationConfidence} />
        {rec.isInnovationGrade && <Badge tone="amber"><Star size={11} /> Innovation-grade</Badge>}
      </div>
      <Panel title="Why build this">
        <p className="text-[13px] leading-relaxed text-fg-secondary">{w.whyThisProject || rec.whyRecommended || 'This project strengthens your portfolio for the target role.'}</p>
      </Panel>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Skill gaps fixed"><Chips items={w.skillGapsFixed} tone="mint" empty="No specific gaps detected" /></Panel>
        <Panel title="Proof gaps fixed"><Chips items={w.proofGapsFixed} tone="cyan" empty="Adds general portfolio proof" /></Panel>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Resume value"><p className="text-[12px] leading-relaxed text-fg-secondary">{w.resumeValue || '—'}</p></Panel>
        <Panel title="Recruiter value"><p className="text-[12px] leading-relaxed text-fg-secondary">{w.recruiterValue || '—'}</p></Panel>
      </div>
      <Panel title="Job readiness impact"><p className="text-[12px] leading-relaxed text-fg-secondary">{w.jobReadinessImpact || '—'}</p></Panel>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Expected proof artifacts"><Chips items={w.expectedProofArtifacts} tone="violet" /></Panel>
        <Panel title="XP impact">
          <div className="flex items-center gap-2 text-[13px] text-fg"><TrendingUp size={14} className="text-aurora-mint" /> {w.expectedXPImpact || '—'}</div>
        </Panel>
      </div>
      {w.innovationPotential && <Panel title="Innovation potential"><p className="text-[12px] leading-relaxed text-fg-secondary">{w.innovationPotential}</p></Panel>}
      <ModeNote mode={data && data.mode} />
    </div>
  );
}

export function ExplainPanel({ project }) {
  const rec = deriveRecommendation(project);
  const { loading, data } = useAsync(() => explain(rec, project), project?.id);
  if (loading) return <Loading lines={4} />;
  const e = (data && data.explanation) || {};
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><ConfBadge value={e.confidence} /></div>
      <Panel title="In one line"><p className="text-[14px] font-medium leading-relaxed text-fg">{e.oneLineSummary || rec.title}</p></Panel>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Problem solved"><p className="text-[12px] leading-relaxed text-fg-secondary">{e.problemSolved || '—'}</p></Panel>
        <Panel title="Who will use it"><p className="text-[12px] leading-relaxed text-fg-secondary">{e.whoWillUseIt || '—'}</p></Panel>
      </div>
      <Panel title="What to build"><p className="text-[12px] leading-relaxed text-fg-secondary">{e.whatToBuild || '—'}</p></Panel>
      {!!(e.mvpModules || []).length && (
        <Panel title="MVP modules">
          <ol className="list-decimal space-y-1 pl-4 text-[12px] text-fg-secondary marker:text-aurora-violet">{e.mvpModules.map((m, i) => <li key={i}>{m}</li>)}</ol>
        </Panel>
      )}
      <Panel title="How it works"><p className="text-[12px] leading-relaxed text-fg-secondary">{e.howItWorks || '—'}</p></Panel>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Don't build yet">
          {(e.whatNotToBuildYet || []).length
            ? <ul className="list-disc space-y-1 pl-4 text-[12px] text-amber-100/90">{e.whatNotToBuildYet.map((x, i) => <li key={i}>{x}</li>)}</ul>
            : <span className="text-xs text-fg-muted">—</span>}
        </Panel>
        <Panel title="First-week tasks">
          {(e.firstWeekTasks || []).length
            ? <ul className="list-disc space-y-1 pl-4 text-[12px] text-fg-secondary">{e.firstWeekTasks.map((x, i) => <li key={i}>{x}</li>)}</ul>
            : <span className="text-xs text-fg-muted">—</span>}
        </Panel>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Skills needed"><Chips items={e.skillsNeeded} tone="cyan" /></Panel>
        <Panel title="Demo moment"><p className="text-[12px] leading-relaxed text-fg-secondary">{e.demoMoment || '—'}</p></Panel>
      </div>
      <Panel title="Final outcome"><p className="text-[12px] leading-relaxed text-fg-secondary">{e.finalOutcome || '—'}</p></Panel>
      <ModeNote mode={data && data.mode} />
    </div>
  );
}

export function BlueprintPanel({ project }) {
  const rec = deriveRecommendation(project);
  const { loading, data } = useAsync(async () => {
    const ex = await explain(rec, project);
    return blueprint(rec, (ex && ex.explanation) || {}, project);
  }, project?.id);
  if (loading) return <Loading lines={5} />;
  const b = (data && data.blueprint) || null;
  if (!b) return <p className="text-[12px] text-fg-muted">Blueprint unavailable right now. Try again in a moment.</p>;

  const Section = ({ title, value }) => (
    <Panel title={title}>
      {Array.isArray(value)
        ? (value.length ? <ul className="list-disc space-y-1 pl-4 text-[12px] text-fg-secondary">{value.map((x, i) => <li key={i}>{typeof x === 'string' ? x : JSON.stringify(x)}</li>)}</ul> : <span className="text-xs text-fg-muted">—</span>)
        : <p className="text-[12px] leading-relaxed text-fg-secondary">{value || '—'}</p>}
    </Panel>
  );

  return (
    <div className="space-y-3">
      <Section title="Product definition" value={b.productDefinition} />
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="MVP scope" value={b.mvpScope} />
        <Section title="Out of scope" value={b.outOfScope} />
      </div>
      <Section title="Feature breakdown" value={b.featureBreakdown} />
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Frontend screens" value={b.frontendScreens} />
        <Section title="Backend APIs" value={b.backendApis} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Database schema" value={b.databaseSchema} />
        <Section title="External APIs" value={b.externalApis} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Environment variables" value={b.environmentVariables} />
        <Panel title="Folder structure"><pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-snug text-fg-secondary">{Array.isArray(b.folderStructure) ? b.folderStructure.join('\n') : (b.folderStructure || '—')}</pre></Panel>
      </div>
      <Section title="Core algorithm" value={b.coreAlgorithm} />
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Test plan" value={b.testPlan} />
        <Section title="Deployment plan" value={b.deploymentPlan} />
      </div>
      <Section title="Demo script" value={b.demoScript} />
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="README sections" value={b.readmeSections} />
        <Section title="GitHub checklist" value={b.githubChecklist} />
      </div>
      <ModeNote mode={data && data.mode} />
    </div>
  );
}

export function DiagramsPanel({ project }) {
  const rec = deriveRecommendation(project);
  const { loading, data } = useAsync(async () => {
    const ex = await explain(rec, project);
    return diagrams(rec, (ex && ex.explanation) || {}, project);
  }, project?.id);
  const [active, setActive] = useState(0);
  if (loading) return <Loading lines={6} />;
  const list = (data && data.diagrams) || [];
  if (!list.length) return <p className="text-[12px] text-fg-muted">Diagrams unavailable right now. Try again in a moment.</p>;
  const d = list[Math.min(active, list.length - 1)];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {list.map((x, i) => (
          <button key={x.id || i} onClick={() => setActive(i)}
            className={`rounded-lg px-3 py-1.5 text-[11px] transition ${active === i ? 'bg-aurora-violet/20 text-fg ring-1 ring-aurora-violet/40' : 'bg-surface-1 text-fg-secondary hover:bg-surface-2'}`}>
            {x.title}
          </button>
        ))}
      </div>
      <Panel title={`${d.title} · project-specific`}>
        <ArchitectureDiagram mermaid={d.mermaid} />
        <details className="mt-2"><summary className="cursor-pointer text-[11px] text-fg-muted">View Mermaid source</summary><pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-fg-secondary">{d.mermaid}</pre></details>
      </Panel>
      <p className="text-[10px] text-fg-muted">Diagrams are derived from this project's modules, stack, APIs and proof artifacts — not a generic template.</p>
      <ModeNote mode={data && data.mode} />
    </div>
  );
}

export function FeasibilityPanel({ project }) {
  const rec = deriveRecommendation(project);
  const { loading, data } = useAsync(() => feasibility(rec, project), project?.id);
  if (loading) return <Loading lines={4} />;
  const f = (data && data.feasibility) || null;
  if (!f) return <p className="text-[12px] text-fg-muted">Estimate unavailable right now. Try again in a moment.</p>;
  const cost = f.costEstimateIndia || {};
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="amber"><Gauge size={11} /> {f.difficulty}</Badge>
        <Badge tone="cyan"><Layers size={11} /> Team {f.teamSize}</Badge>
        <Badge tone="violet"><Clock size={11} /> {f.estimatedTimeline}</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Roles required"><Chips items={f.rolesRequired} tone="violet" /></Panel>
        <Panel title="Must-have skills"><Chips items={f.mustHaveSkills} tone="mint" /></Panel>
      </div>
      <Panel title="Good-to-have skills"><Chips items={f.goodToHaveSkills} tone="cyan" /></Panel>
      <Panel title="Cost estimate (India, INR)">
        <div className="grid gap-2 sm:grid-cols-3 text-[12px]">
          <div className="rounded-lg bg-surface-1 p-2"><div className="text-fg-muted">Student prototype</div><div className="font-medium text-aurora-mint">{cost.studentPrototype}</div></div>
          <div className="rounded-lg bg-surface-1 p-2"><div className="text-fg-muted">Polished demo</div><div className="font-medium text-aurora-cyan">{cost.polishedDemo}</div></div>
          <div className="rounded-lg bg-surface-1 p-2"><div className="text-fg-muted">Startup-grade</div><div className="font-medium text-aurora-violet">{cost.startupGrade}</div></div>
        </div>
      </Panel>
      <Panel title="Resources required"><Chips items={f.resourcesRequired} tone="cyan" /></Panel>
      {!!(f.executionRisks || []).length && (
        <Panel title="Execution risks">
          <ul className="list-disc space-y-1 pl-4 text-[12px] text-amber-100/90">{f.executionRisks.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </Panel>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Solo builder advice"><p className="text-[12px] leading-relaxed text-fg-secondary">{f.soloBuilderAdvice || '—'}</p></Panel>
        <Panel title="Verdict"><p className="text-[12px] leading-relaxed text-fg">{f.shouldBuildVerdict || '—'}</p></Panel>
      </div>
      <ModeNote mode={data && data.mode} />
    </div>
  );
}

const PRIORITY_TONE = { high: 'rose', medium: 'amber', low: 'cyan' };
export function TaskBoardPanel({ project }) {
  const rec = deriveRecommendation(project);
  const { loading, data } = useAsync(async () => {
    const ex = await explain(rec, project);
    return taskBoard(rec, (ex && ex.explanation) || {}, project);
  }, project?.id);
  if (loading) return <Loading lines={5} />;
  const tb = (data && data.taskBoard) || null;
  if (!tb || !(tb.tasks || []).length) return <p className="text-[12px] text-fg-muted">Task board unavailable right now. Try again in a moment.</p>;
  const allText = tb.tasks.map((t) => `### ${t.title}\n${t.description}\nAcceptance:\n${(t.acceptanceCriteria || []).map((a) => '- ' + a).join('\n')}`).join('\n\n');
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-fg-secondary">{tb.summary || `${tb.tasks.length} GitHub-ready issues, dependency-ordered.`}</p>
        <CopyBtn text={allText} label="Copy all as issues" />
      </div>
      <div className="space-y-2">
        {tb.tasks.map((t, i) => (
          <details key={t.id || i} className="rounded-xl border border-subtle bg-base/55 p-3 text-[12px]">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-fg">
              <span className="font-medium text-fg">{i + 1}. {t.title}</span>
              {t.priority && <Badge tone={PRIORITY_TONE[String(t.priority).toLowerCase()] || 'cyan'}>{t.priority}</Badge>}
              {t.estimatedTime && <Badge tone="cyan"><Clock size={10} /> {t.estimatedTime}</Badge>}
              {(t.labels || []).map((l, j) => <Badge key={j} tone="violet">{l}</Badge>)}
            </summary>
            <div className="mt-2 space-y-2 text-fg-secondary">
              <p>{t.description}</p>
              {!!(t.acceptanceCriteria || []).length && (
                <div><div className="text-fg-muted">Acceptance criteria</div><ul className="mt-0.5 list-disc space-y-0.5 pl-4">{t.acceptanceCriteria.map((a, j) => <li key={j}>{a}</li>)}</ul></div>
              )}
              {!!(t.filesToCreateOrModify || []).length && (
                <div><div className="text-fg-muted">Files</div><div className="mt-0.5 flex flex-wrap gap-1">{t.filesToCreateOrModify.map((fl, j) => <code key={j} className="rounded bg-surface-1 px-1.5 py-0.5 font-mono text-[10px] text-aurora-cyan">{fl}</code>)}</div></div>
              )}
              {!!(t.dependencies || []).length && <p className="text-[11px] text-fg-muted">Depends on: {t.dependencies.join(', ')}</p>}
            </div>
          </details>
        ))}
      </div>
      <ModeNote mode={data && data.mode} />
    </div>
  );
}

function ChecklistGroup({ title, items, tone }) {
  return (
    <Panel title={title}>
      <ul className="space-y-1.5">
        {(items || []).map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-[12px]">
            {it.satisfied ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-aurora-mint" /> : <Circle size={14} className="mt-0.5 shrink-0 text-fg-muted" />}
            <span className={it.satisfied ? 'text-fg' : 'text-fg-secondary'}>{it.label}{it.tracked && !it.satisfied ? <Badge tone={tone}>tracked</Badge> : null}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ProofChecklistPanel({ project }) {
  const rec = deriveRecommendation(project);
  const { loading, data } = useAsync(() => {
    let pb = null;
    try { pb = proofScoreBreakdown(project); } catch { pb = null; }
    return proofChecklist(rec, pb, project);
  }, project?.id);
  if (loading) return <Loading lines={4} />;
  const c = (data && data.proofChecklist) || null;
  if (!c) return <p className="text-[12px] text-fg-muted">Proof checklist unavailable right now. Try again in a moment.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="mint"><ShieldCheck size={11} /> Tier: {c.currentTier}</Badge>
        {typeof c.proofScore === 'number' && <Badge tone="cyan">Proof {c.proofScore}/100</Badge>}
        {c.trackedProgress && <Badge tone="violet">{c.trackedProgress}</Badge>}
      </div>
      <ChecklistGroup title="Minimum proof" items={c.minimum} tone="mint" />
      <ChecklistGroup title="Strong proof" items={c.strong} tone="cyan" />
      <ChecklistGroup title="Recruiter-ready proof" items={c.recruiterReady} tone="violet" />
      {c.note && <p className="text-[11px] text-fg-muted">{c.note}</p>}
      <ModeNote mode={data && data.mode} />
    </div>
  );
}

export function ResumeOutputPanel({ project }) {
  const rec = deriveRecommendation(project);
  const { loading, data } = useAsync(() => resumeOutput(rec, project, evidenceFromProject(project)), project?.id);
  if (loading) return <Loading lines={4} />;
  const r = (data && data.resume) || {};
  const draft = r.draftResumeBullets || [];
  const verified = r.verifiedResumeBullets || [];
  return (
    <div className="space-y-3">
      {!!(r.unsupportedClaimsWarning || []).length && (
        <div className="rounded-xl border border-amber-glow/30 bg-amber-glow/10 px-3 py-2 text-[12px] text-amber-100">
          <AlertTriangle size={13} className="mr-1.5 inline" />
          {r.unsupportedClaimsWarning.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}
      <Panel title="Verified bullets (evidence-backed)" action={verified.length ? <CopyBtn text={verified.map((b) => '• ' + b).join('\n')} /> : null}>
        {verified.length
          ? <ul className="list-disc space-y-1 pl-4 text-[13px] text-fg marker:text-aurora-mint">{verified.map((b, i) => <li key={i}>{b}</li>)}</ul>
          : <p className="text-[12px] text-fg-muted">No verified bullets yet — add real proof (GitHub analysis, live demo, or tests) to unlock these. Unverified claims are never shown as verified.</p>}
      </Panel>
      <Panel title="Draft bullets (use after proof exists)" action={draft.length ? <CopyBtn text={draft.map((b) => '• ' + b).join('\n')} /> : null}>
        <ul className="list-disc space-y-1 pl-4 text-[13px] text-fg-secondary marker:text-aurora-violet">{draft.map((b, i) => <li key={i}>{b}</li>)}</ul>
      </Panel>
      {!!(r.verificationRequired || []).length && (
        <Panel title="To verify these bullets">
          <ul className="list-disc space-y-1 pl-4 text-[12px] text-fg-secondary">{r.verificationRequired.map((v, i) => <li key={i}>{v}</li>)}</ul>
        </Panel>
      )}
      <p className="text-[10px] text-fg-muted">Hard rule: unverified project claims are never returned as verified achievements.</p>
      <ModeNote mode={data && data.mode} />
    </div>
  );
}

export function SimilarPanel({ project }) {
  const rec = deriveRecommendation(project);
  const { loading, data } = useAsync(() => {
    const existing = getProjects()
      .filter((p) => p.id !== project?.id)
      .map((p) => ({ id: p.id, title: p.title, problemStatement: p.problemStatement || p.summary || '', skillsCovered: p.skillsCovered || [], techStack: p.techStack || [] }));
    const candidate = { title: rec.title, problemStatement: rec.problemStatement, skillsCovered: rec.skills, techStack: rec.techStack };
    return findSimilar(candidate, existing);
  }, project?.id);
  if (loading) return <Loading lines={3} />;
  const s = data || {};
  return (
    <div className="space-y-3">
      {s.isDuplicate ? (
        <div className="rounded-xl border border-amber-glow/30 bg-amber-glow/10 px-3 py-2 text-[12px] text-amber-100">
          <AlertTriangle size={13} className="mr-1.5 inline" />
          A similar project already exists{typeof s.similarity === 'number' ? ` (${Math.round(s.similarity * 100)}% match)` : ''}. {s.suggestion}
        </div>
      ) : (
        <div className="rounded-xl border border-aurora-mint/25 bg-aurora-mint/10 px-3 py-2 text-[12px] text-fg">
          <CheckCircle2 size={13} className="mr-1.5 inline text-aurora-mint" />
          No close duplicate found among your projects — this covers distinct ground.
        </div>
      )}
      {!!(s.matches || []).length && (
        <Panel title="Closest matches">
          <ul className="space-y-1 text-[12px] text-fg-secondary">
            {s.matches.map((m, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span>{m.title}</span>
                {typeof m.similarity === 'number' && <Badge tone="cyan">{Math.round(m.similarity * 100)}%</Badge>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <ModeNote mode={data && data.mode} />
    </div>
  );
}

export function VerificationPanel({ project }) {
  const rec = deriveRecommendation(project);
  const { loading, data } = useAsync(async () => {
    let pb = null;
    try { pb = proofScoreBreakdown(project); } catch { pb = null; }
    const [pc, ro] = await Promise.all([
      proofChecklist(rec, pb, project),
      resumeOutput(rec, project, evidenceFromProject(project)),
    ]);
    return { pc: (pc && pc.proofChecklist) || null, ro: (ro && ro.resume) || {}, mode: (pc && pc.mode) };
  }, project?.id);
  if (loading) return <Loading lines={4} />;
  const { pc, ro } = data || {};
  const pending = [];
  if (pc) {
    for (const grp of [pc.minimum, pc.strong, pc.recruiterReady]) {
      for (const it of grp || []) if (!it.satisfied) pending.push(it.label);
    }
  }
  const verifySteps = (ro && ro.verificationRequired) || [];
  return (
    <div className="space-y-3">
      <Panel title="Current verification status">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="mint"><ShieldCheck size={11} /> {pc ? pc.currentTier : 'Unknown'}</Badge>
          {pc && typeof pc.proofScore === 'number' && <Badge tone="cyan">Proof {pc.proofScore}/100</Badge>}
          <Badge tone={(ro?.verifiedResumeBullets || []).length ? 'mint' : 'amber'}>{(ro?.verifiedResumeBullets || []).length} verified bullet{(ro?.verifiedResumeBullets || []).length === 1 ? '' : 's'}</Badge>
        </div>
      </Panel>
      <Panel title="Path to verified proof">
        {verifySteps.length || pending.length ? (
          <ol className="list-decimal space-y-1 pl-4 text-[12px] text-fg-secondary marker:text-aurora-cyan">
            {verifySteps.map((v, i) => <li key={`v${i}`}>{v}</li>)}
            {pending.slice(0, 6).map((p, i) => <li key={`p${i}`}>{p}</li>)}
          </ol>
        ) : <p className="text-[12px] text-aurora-mint">All proof tiers satisfied — this project is recruiter-ready.</p>}
      </Panel>
      <p className="text-[10px] text-fg-muted">Verification reflects real evidence on this project (GitHub analysis, live demo, tests). Nothing is auto-marked verified.</p>
      <ModeNote mode={data && data.mode} />
    </div>
  );
}

/* ============================================================
   Gap-driven recommendations — shown on the main Project Studio
   view and reusable inside Project Creator.
   ============================================================ */
function ReadinessCard({ rec, onBuild }) {
  return (
    <div className="flex flex-col rounded-2xl border border-subtle bg-surface-1 p-4 transition hover:border-strong">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-medium leading-tight text-fg">{rec.title}</h4>
        {rec.isInnovationGrade && <Badge tone="amber"><Star size={10} /> Innovation</Badge>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone="violet"><Target size={10} /> {rec.targetRole}</Badge>
        <Badge tone="amber">{rec.difficulty}</Badge>
        {rec.estimatedTime && <Badge tone="cyan"><Clock size={10} /> {rec.estimatedTime}</Badge>}
        <ConfBadge value={rec.recommendationConfidence} />
      </div>
      {rec.whyRecommended && <p className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-fg-secondary">{rec.whyRecommended}</p>}
      {!!(rec.skillGapsFixed || []).length && (
        <div className="mt-2"><div className="text-[10px] uppercase tracking-widest text-fg-muted">Skills proven</div><div className="mt-1"><Chips items={(rec.skillGapsFixed || []).slice(0, 5)} tone="mint" /></div></div>
      )}
      {!!(rec.proofGapsFixed || []).length && (
        <div className="mt-2"><div className="text-[10px] uppercase tracking-widest text-fg-muted">Proof gaps fixed</div><div className="mt-1"><Chips items={(rec.proofGapsFixed || []).slice(0, 4)} tone="cyan" /></div></div>
      )}
      {rec.careerReadinessImpact && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-fg-secondary"><TrendingUp size={12} className="mt-0.5 shrink-0 text-aurora-mint" /> {rec.careerReadinessImpact}</p>
      )}
      <Button size="sm" className="mt-3" onClick={() => onBuild(rec)}><Wand2 size={14} /> Build this</Button>
    </div>
  );
}

export function RecommendedProjects({ onBuild, title = 'Recommended next projects', max = 6 }) {
  const { loading, data } = useAsync(() => recommendProjects({ max }), 'recommend');
  const recs = (data && data.recommendedProjects) || [];
  const gap = (data && data.gapSummary) || {};
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Sparkles size={15} className="text-aurora-violet" />
        <h3 className="text-sm font-medium text-fg">{title}</h3>
        {gap.targetRole && <Badge tone="violet">{gap.targetRole}</Badge>}
      </div>
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44 w-full rounded-2xl" />)}</div>
      ) : recs.length ? (
        <>
          {(gap.roleSkillGaps?.length || gap.proofGaps?.length || gap.unverifiedClaims?.length) ? (
            <div className="mb-3 grid gap-2 sm:grid-cols-3 text-[12px]">
              {!!(gap.roleSkillGaps || []).length && <div className="rounded-lg border border-subtle bg-base/55 p-2"><div className="text-fg-muted">Role skill gaps</div><div className="mt-1"><Chips items={gap.roleSkillGaps.slice(0, 6)} tone="rose" /></div></div>}
              {!!(gap.unverifiedClaims || []).length && <div className="rounded-lg border border-subtle bg-base/55 p-2"><div className="text-fg-muted">Unverified claims</div><div className="mt-1"><Chips items={gap.unverifiedClaims.slice(0, 6)} tone="amber" /></div></div>}
              {!!(gap.proofGaps || []).length && <div className="rounded-lg border border-subtle bg-base/55 p-2"><div className="text-fg-muted">Proof gaps</div><div className="mt-1"><Chips items={gap.proofGaps.slice(0, 6)} tone="cyan" /></div></div>}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recs.map((rec, i) => <ReadinessCard key={rec.id || i} rec={rec} onBuild={onBuild} />)}
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-subtle bg-surface-1 p-5 text-center">
          <Rocket size={20} className="mx-auto text-fg-muted" />
          <p className="mt-2 text-[12px] text-fg-secondary">Add your target role, resume and a saved job to get gap-driven project recommendations. They explain which gap each project fixes and what proof it creates.</p>
        </div>
      )}
    </div>
  );
}
