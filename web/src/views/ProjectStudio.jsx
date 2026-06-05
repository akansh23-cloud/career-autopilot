import { useEffect, useMemo, useState } from 'react';
import {
  Rocket, Wand2, Sparkles, FileText, PenLine, UploadCloud, Github, Globe,
  CheckCircle2, Circle, Plus, Trash2, Copy, Check, ListChecks, Layers,
  Target, Gauge, Clock, Boxes, AlertTriangle, X, Image as ImageIcon, BookOpen,
  GitBranch, ShieldCheck, Network, RefreshCw, ServerCog, Database, Workflow,
} from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Modal, EmptyState, Input, Field, Spinner } from '../components/ui/kit.jsx';
import { ROLE_GROUPS, ALL_ROLES } from '../lib/roles.js';
import { getStoredResume, saveStoredResume, getResumeSearchRole } from '../lib/resumeStore.js';
import {
  getProjects, saveProject, deleteProject, consumeStudioSeed, peekStudioSeed,
  computeProofScore, taskProgress, proofScoreBreakdown, getPublishedProjects,
} from '../lib/projectStore.js';
import {
  LEVELS, DURATIONS, TYPES, generateRoadmap, generateResumeBullets,
  generateLinkedinPost, generateInterviewPrep, generateReadme,
} from '../lib/projectGen.js';
import { projectXP } from '../lib/xp.js';
import { deriveBadges } from '../lib/badges.js';
import { roleConsistency } from '../lib/roleFit.js';
import { getAccessForUser } from '../lib/access.js';
import { isUnlimited, promptUpgrade } from '../lib/plan.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { BadgePill, StatusBadge, ArchitectureDiagram } from '../components/proof/ProofViews.jsx';
import {
  analyzeGithub, verifyLiveLink, applyGithubAnalysis, applyLiveVerification,
  buildRecruiterSummary, normalizeRepoUrl,
} from '../lib/githubSync.js';
import { calculateProjectStatus, whyNotVerified } from '../lib/projectStatus.js';
import { generateMermaid } from '../lib/architecture.js';

/* publish-readiness gate (Part 8) */
function publishReadiness(p) {
  const missing = [];
  if (!p.title) missing.push('a title');
  if (!(p.useCase || p.problemStatement)) missing.push('a description');
  if (!(p.techStack || []).length) missing.push('a tech stack');
  if (taskProgress(p) < 60) missing.push('roadmap progress above 60%');
  if (!(p.githubUrl && p.githubUrl.trim()) && !(p.liveDemoUrl && p.liveDemoUrl.trim()) && !(p.screenshots || []).length)
    missing.push('a GitHub repo, live demo, or uploaded proof');
  if (!(p.readme && p.readme.trim().length > 40)) missing.push('a generated README');
  if (!(p.recruiterSummary && p.recruiterSummary.trim())) missing.push('a recruiter summary');
  return { ready: missing.length === 0, missing };
}

function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="soft" onClick={() => { navigator.clipboard?.writeText(text || ''); setDone(true); setTimeout(() => setDone(false), 1400); }}>
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Copied' : label}
    </Button>
  );
}

function Chips({ items, tone = 'cyan' }) {
  if (!items?.length) return <span className="text-xs text-slate-500">—</span>;
  return <div className="flex flex-wrap gap-1.5">{items.map((s, i) => <Badge key={i} tone={tone}>{s}</Badge>)}</div>;
}

/* ---------------- Generated project result ---------------- */
function ProjectResult({ project, seed, onSave, onAddBullets, onOpenEditor }) {
  const p = project;
  return (
    <SectionCard
      title="Generated project"
      action={<div className="flex items-center gap-2"><Badge tone={p.generatedBy === 'ai' ? 'violet' : 'cyan'}>{p.generatedBy === 'ai' ? 'AI-tailored' : 'Template'}</Badge><Badge tone="mint">{p.type}</Badge></div>}
    >
      <div className="space-y-4">
        <div>
          <h3 className="font-display text-xl font-semibold text-white">{p.title}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone="violet"><Target size={11} /> {p.targetRole}</Badge>
            <Badge tone="amber"><Gauge size={11} /> {p.difficulty}</Badge>
            <Badge tone="cyan"><Clock size={11} /> {p.duration}</Badge>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Problem</div>
            <p className="text-[13px] leading-relaxed text-slate-300">{p.problemStatement}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Real-world use case</div>
            <p className="text-[13px] leading-relaxed text-slate-300">{p.useCase}</p>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Skills covered</div>
          <Chips items={p.skillsCovered} />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Recommended tech stack</div>
            <Chips items={p.techStack} tone="violet" />
          </div>
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Architecture</div>
            <p className="text-[13px] leading-relaxed text-slate-300">{p.architecture}</p>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Step-by-step roadmap</div>
          <ol className="space-y-2">
            {p.steps.map((ph, i) => (
              <li key={i} className="text-[13px] text-slate-300">
                <span className="font-medium text-white">{i + 1}. {ph.phase}</span>
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-slate-400 marker:text-aurora-cyan">
                  {ph.tasks.map((t, j) => <li key={j}>{t}</li>)}
                </ul>
              </li>
            ))}
          </ol>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Repo structure</div>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-snug text-slate-400">{p.repoStructure}</pre>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Deployment plan</div>
              <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-slate-400 marker:text-aurora-mint">{p.deploymentPlan.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
            <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Testing plan</div>
              <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-slate-400 marker:text-amber-glow">{p.testingPlan.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          </div>
        </div>

        {p.databaseSchema && (
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Database schema</div>
            <ul className="list-disc space-y-0.5 pl-4 font-mono text-[11px] text-slate-400">{p.databaseSchema.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
          <div className="mb-2 flex items-center justify-between"><div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Resume bullet points</div><CopyBtn text={p.resumeBullets.map((b) => '• ' + b).join('\n')} /></div>
          <ul className="list-disc space-y-1 pl-4 text-[13px] text-slate-300 marker:text-aurora-violet">{p.resumeBullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-2 flex items-center justify-between"><div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">LinkedIn post</div><CopyBtn text={p.linkedinPost} /></div>
            <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-300">{p.linkedinPost}</pre>
          </div>
          <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Interview Q&A</div>
            <div className="space-y-2">
              {p.interviewQuestions.slice(0, 5).map((qa, i) => (
                <details key={i} className="rounded-lg bg-white/[0.03] p-2 text-[12px]">
                  <summary className="cursor-pointer font-medium text-slate-200">{qa.q}</summary>
                  <p className="mt-1 text-slate-400">{qa.a}</p>
                </details>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
          <div className="mb-2 flex items-center justify-between"><div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">GitHub README</div><CopyBtn text={p.readme} label="Copy README" /></div>
          <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-snug text-slate-400">{p.readme}</pre>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
          <Button onClick={onSave}><UploadCloud size={15} /> Save as workspace</Button>
          <Button variant="soft" onClick={onAddBullets}><FileText size={15} /> Add bullets to resume</Button>
          <Button variant="soft" onClick={onOpenEditor}><PenLine size={15} /> Open Resume Editor</Button>
        </div>
      </div>
    </SectionCard>
  );
}

/* ---------------- Workspace card + modal ---------------- */
function TabBar({ tabs, active, onPick }) {
  return (
    <div className="sticky top-0 z-10 -mx-5 mb-4 flex gap-1 overflow-x-auto border-b border-white/10 bg-ink-900/95 px-5 pb-2 pt-1 backdrop-blur-xl sm:-mx-6 sm:px-6">
      {tabs.map(([id, label, Icon]) => (
        <button key={id} onClick={() => onPick(id)}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${active === id ? 'bg-aurora-violet/20 text-white ring-1 ring-aurora-violet/40' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}>
          <Icon size={13} /> {label}
        </button>
      ))}
    </div>
  );
}

function Panel({ title, children, action }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function WorkspaceModal({ project, open, onClose, onChange, onPublish, onOpenEditor, userName }) {
  const [p, setP] = useState(project);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState('');
  const [res, setRes] = useState('');
  const [repoInput, setRepoInput] = useState('');
  const [liveInput, setLiveInput] = useState('');
  const [ghMsg, setGhMsg] = useState('');
  const [liveMsg, setLiveMsg] = useState('');
  useEffect(() => {
    setP(project);
    setRepoInput(project?.githubUrl || '');
    setLiveInput(project?.liveDemoUrl || '');
    setGhMsg(''); setLiveMsg(''); setTab('overview');
  }, [project]);
  if (!p) return null;

  const patch = (changes) => { const next = { ...p, ...changes }; next.proofScore = computeProofScore(next); setP(next); onChange(next); };
  const toggleCheck = (i) => { const checklist = p.checklist.map((c, idx) => idx === i ? { ...c, done: !c.done } : c); patch({ checklist }); };
  const moveTask = (id, status) => patch({ tasks: p.tasks.map((t) => t.id === id ? { ...t, status } : t) });
  const toggleGuide = (id) => patch({ guideTasks: (p.guideTasks || []).map((t) => t.id === id ? { ...t, status: t.status === 'done' ? 'todo' : 'done' } : t) });
  const addResource = () => { if (!res.trim()) return; patch({ resources: [...(p.resources || []), res.trim()] }); setRes(''); };
  const addScreenshot = () => patch({ screenshots: [...(p.screenshots || []), { label: `Screenshot ${(p.screenshots || []).length + 1}`, addedAt: Date.now() }] });

  const regen = async (kind) => {
    setBusy(kind);
    try {
      if (kind === 'bullets') patch({ resumeBullets: await generateResumeBullets(p) });
      if (kind === 'linkedin') patch({ linkedinPost: await generateLinkedinPost(p) });
      if (kind === 'interview') patch({ interviewQuestions: await generateInterviewPrep(p) });
      if (kind === 'readme') patch({ readme: await generateReadme(p) });
    } finally { setBusy(''); }
  };
  const genArchitecture = () => patch({ architectureDiagram: generateMermaid(p) });
  const genRecruiterSummary = () => patch({ recruiterSummary: buildRecruiterSummary({ ...p, proofScore: computeProofScore(p) }, userName) });

  const runGithub = async () => {
    const url = normalizeRepoUrl(repoInput);
    if (!url) { setGhMsg('Enter a GitHub repo URL first.'); return; }
    setBusy('github'); setGhMsg('Analyzing repository…');
    const result = await analyzeGithub({ repoUrl: url, projectId: p.id, expectedSkills: p.skillsCovered, expectedTechStack: p.techStack, targetRole: p.targetRole });
    if (result && result.success) {
      const next = applyGithubAnalysis({ ...p, githubUrl: url }, result);
      next.proofScore = computeProofScore(next);
      setP(next); onChange(next);
      setGhMsg(`Synced ${result.repo.fullName} — GitHub score ${result.githubScore}/100.`);
    } else {
      patch({ githubUrl: url });
      setGhMsg(result?.message || 'GitHub analysis is temporarily unavailable. Add proof manually or try again later.');
    }
    setBusy('');
  };
  const runVerify = async () => {
    const url = (liveInput || '').trim();
    if (!url) { setLiveMsg('Enter a live demo URL first.'); return; }
    setBusy('live'); setLiveMsg('Checking the live URL…');
    const result = await verifyLiveLink({ liveUrl: url, projectId: p.id });
    const next = applyLiveVerification({ ...p, liveDemoUrl: url }, result);
    next.proofScore = computeProofScore(next);
    setP(next); onChange(next);
    setLiveMsg(result?.reachable ? `Verified — HTTP ${result.statusCode}${result.title ? ` · "${result.title}"` : ''} · ${result.responseTimeMs}ms.` : (result?.warnings?.[0] || 'Not reachable — needs manual review.'));
    setBusy('');
  };

  const cols = [['todo', 'To Do', Circle], ['inprogress', 'In Progress', Clock], ['done', 'Done', CheckCircle2]];
  const progress = taskProgress(p);
  const statusInfo = calculateProjectStatus(p);
  const ind = p.industry || {};
  const cons = roleConsistency(p);

  const tabs = [
    ['overview', 'Overview', Target],
    ['architecture', 'Architecture', Network],
    ['roadmap', 'Roadmap', BookOpen],
    ['tasks', 'Tasks', ListChecks],
    ['github', 'GitHub Sync', GitBranch],
    ['verify', 'Verification', ShieldCheck],
    ['resume', 'Resume/Interview', FileText],
  ];

  return (
    <Modal open={open} onClose={onClose} width="max-w-4xl" title={p.title}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={statusInfo.status} />
        <Badge tone="violet"><Target size={11} /> {p.targetRole}</Badge>
        <Badge tone="amber">{p.difficulty}</Badge>
        <Badge tone="cyan">{p.duration}</Badge>
        <Badge tone="mint">Proof {p.proofScore}/100</Badge>
        {p.github?.success && <Badge tone="violet"><Github size={11} /> {p.github.githubScore}/100</Badge>}
        {p.liveVerification?.reachable && <Badge tone="mint"><Globe size={11} /> Live verified</Badge>}
        {p.published && <Badge tone="mint">Published</Badge>}
      </div>

      <div className="mt-3" />
      <TabBar tabs={tabs} active={tab} onPick={setTab} />

      {tab === 'overview' && (
        <div className="space-y-3">
          {!cons.ok && <div className="rounded-xl border border-amber-glow/30 bg-amber-glow/10 px-3 py-2 text-[12px] text-amber-100"><AlertTriangle size={13} className="mr-1.5 inline" /> {cons.warning}</div>}
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-slate-400"><span>Task completion</span><span>{progress}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-aurora-cta transition-all" style={{ width: `${progress}%` }} /></div>
          </div>
          {ind.overview && (
            <div className="grid gap-3 md:grid-cols-2">
              <Panel title="Who should build it"><p className="text-[13px] leading-relaxed text-slate-300">{ind.overview.whoShouldBuild}</p></Panel>
              <Panel title="Expected outcome"><p className="text-[13px] leading-relaxed text-slate-300">{ind.overview.expectedOutcome}</p></Panel>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Panel title="Problem"><p className="text-[13px] leading-relaxed text-slate-300">{p.problemStatement}</p></Panel>
            <Panel title="Real-world use case"><p className="text-[13px] leading-relaxed text-slate-300">{p.useCase}</p></Panel>
          </div>
          {ind.businessContext && (
            <Panel title="Business / use-case context">
              <div className="space-y-2 text-[12px] text-slate-300">
                <p><span className="text-slate-500">Personas:</span> {ind.businessContext.personas.join(', ')}</p>
                <p><span className="text-slate-500">Core workflows:</span> {ind.businessContext.coreWorkflows.join(' → ')}</p>
                <p><span className="text-slate-500">Industry scenario:</span> {ind.businessContext.industryScenario}</p>
              </div>
            </Panel>
          )}
          {ind.features && (
            <Panel title="Feature requirements">
              <div className="grid gap-3 sm:grid-cols-3">
                {[['Must-have', ind.features.mustHave, 'mint'], ['Good-to-have', ind.features.goodToHave, 'cyan'], ['Advanced', ind.features.advanced, 'violet']].map(([t, items, tone]) => (
                  <div key={t}>
                    <Badge tone={tone}>{t}</Badge>
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[12px] text-slate-400">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Non-functional: {ind.features.nonFunctional.join(' · ')}</p>
            </Panel>
          )}
          <Panel title="Skills covered"><Chips items={p.skillsCovered} /></Panel>
          <Panel title="Recommended tech stack"><Chips items={p.techStack} tone="violet" /></Panel>
        </div>
      )}

      {tab === 'architecture' && (
        <div className="space-y-3">
          <Panel title="Architecture diagram" action={<Button size="sm" variant="soft" onClick={genArchitecture}><RefreshCw size={13} /> Regenerate</Button>}>
            <ArchitectureDiagram mermaid={p.architectureDiagram || generateMermaid(p)} />
            <details className="mt-2"><summary className="cursor-pointer text-[11px] text-slate-500">View Mermaid source</summary><pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-slate-400">{p.architectureDiagram || generateMermaid(p)}</pre></details>
          </Panel>
          <Panel title="Architecture notes"><p className="text-[13px] leading-relaxed text-slate-300">{p.architecture}</p></Panel>
          {ind.technicalArchitecture && (
            <Panel title="Technical architecture">
              <div className="grid gap-1.5 text-[12px] sm:grid-cols-2">
                {Object.entries(ind.technicalArchitecture).map(([k, v]) => (
                  <div key={k} className="flex gap-2"><span className="w-28 shrink-0 capitalize text-slate-500">{k}</span><span className="text-slate-300">{v}</span></div>
                ))}
              </div>
            </Panel>
          )}
          {ind.dataModel && (
            <Panel title="Data model / schema">
              <div className="space-y-2">
                {ind.dataModel.map((m, i) => (
                  <div key={i} className="rounded-lg bg-white/[0.03] p-2">
                    <div className="flex items-center gap-1.5 text-[12px] font-medium text-white"><Database size={12} className="text-aurora-cyan" /> {m.name}</div>
                    <ul className="mt-1 list-disc pl-4 font-mono text-[11px] text-slate-400">{m.fields.map((f, j) => <li key={j}>{f}</li>)}</ul>
                    <pre className="mt-1 overflow-x-auto rounded bg-ink-950/70 p-1.5 font-mono text-[10px] text-slate-400">{JSON.stringify(m.sample, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          {ind.apiDesign && (
            <Panel title="API design">
              <div className="space-y-1.5">
                {ind.apiDesign.map((a, i) => (
                  <details key={i} className="rounded-lg bg-white/[0.03] p-2 text-[12px]">
                    <summary className="cursor-pointer text-slate-200"><span className="font-mono font-semibold text-aurora-cyan">{a.method}</span> <span className="font-mono">{a.endpoint}</span> — {a.purpose} {a.auth && <Badge tone="amber">auth</Badge>}</summary>
                    <div className="mt-1 space-y-0.5 text-slate-400">
                      <p><span className="text-slate-500">Request:</span> <code>{a.request}</code></p>
                      <p><span className="text-slate-500">Response:</span> <code>{a.response}</code></p>
                      <p><span className="text-slate-500">Validation:</span> {a.validation}</p>
                    </div>
                  </details>
                ))}
              </div>
            </Panel>
          )}
          <Panel title="Folder structure">
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-snug text-slate-400">{p.repoStructure}</pre>
          </Panel>
        </div>
      )}

      {tab === 'roadmap' && (
        <div className="space-y-3">
          <p className="text-[12px] text-slate-400">A beginner-friendly, milestone-based build guide. Tick mentor tasks as you finish them.</p>
          {(ind.milestones || []).map((m) => (
            <details key={m.n} className="rounded-xl border border-white/10 bg-ink-950/55 p-3" open={m.n <= 2}>
              <summary className="cursor-pointer text-[13px] font-semibold text-white">Milestone {m.n}: {m.title}</summary>
              <div className="mt-2 space-y-1.5 text-[12px] text-slate-300">
                <p><span className="text-slate-500">Goal:</span> {m.goal}</p>
                <div><span className="text-slate-500">Tasks:</span><ul className="ml-1 mt-0.5 list-disc pl-4 text-slate-400">{m.tasks.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
                <p><span className="text-slate-500">Expected output:</span> {m.expectedOutput}</p>
                <p className="text-amber-100/80"><AlertTriangle size={11} className="mr-1 inline" />Common mistake: {m.commonMistakes}</p>
                <div><span className="text-slate-500">Verify:</span><ul className="ml-1 mt-0.5 list-disc pl-4 text-aurora-mint/90">{m.verification.map((v, i) => <li key={i}>{v}</li>)}</ul></div>
              </div>
            </details>
          ))}
          {(p.guideTasks || []).length > 0 && (
            <Panel title="Mentor tasks (detailed)">
              <div className="space-y-2">
                {p.guideTasks.map((t) => (
                  <div key={t.id} className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
                    <button onClick={() => toggleGuide(t.id)} className="flex w-full items-start gap-2 text-left">
                      {t.status === 'done' ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-aurora-mint" /> : <Circle size={15} className="mt-0.5 shrink-0 text-slate-600" />}
                      <span className={`text-[13px] font-medium ${t.status === 'done' ? 'text-slate-500 line-through' : 'text-white'}`}>{t.title}</span>
                    </button>
                    <div className="mt-1.5 space-y-1 pl-7 text-[11px] text-slate-400">
                      <p><span className="text-slate-500">Why:</span> {t.why}</p>
                      <p><span className="text-slate-500">Files:</span> <code>{t.filesToCreate.join(', ')}</code></p>
                      <div><span className="text-slate-500">Steps:</span><ol className="ml-1 list-decimal pl-4">{t.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></div>
                      <p><span className="text-slate-500">Expected:</span> {t.expectedOutput}</p>
                      <p><span className="text-slate-500">Test:</span> {t.howToTest}</p>
                      <p className="text-amber-100/80">Avoid: {t.commonMistakes}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          {ind.testingPlan && (
            <Panel title="Testing plan">
              <div className="grid gap-2 text-[12px] sm:grid-cols-2">
                {Object.entries(ind.testingPlan).map(([k, items]) => (
                  <div key={k}><span className="capitalize text-slate-500">{k}:</span><ul className="ml-1 list-disc pl-4 text-slate-400">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                ))}
              </div>
            </Panel>
          )}
          {ind.deploymentPlan && (
            <Panel title="Deployment plan">
              <div className="space-y-1 text-[12px] text-slate-300">
                <p><span className="text-slate-500">Frontend:</span> {ind.deploymentPlan.frontend.join(' · ')}</p>
                <p><span className="text-slate-500">Backend:</span> {(ind.deploymentPlan.backend || []).join(' · ')}</p>
                <p><span className="text-slate-500">Database:</span> {ind.deploymentPlan.database.join(' · ')}</p>
                <p><span className="text-slate-500">Env vars:</span> <code>{ind.deploymentPlan.envVars.join(', ')}</code></p>
                <p><span className="text-slate-500">Verify:</span> {ind.deploymentPlan.verification.join(' · ')}</p>
              </div>
            </Panel>
          )}
        </div>
      )}

      {tab === 'tasks' && (
        <div className="space-y-3">
          <Panel title="Roadmap checklist">
            <div className="space-y-1.5">
              {p.checklist.map((c, i) => (
                <button key={i} onClick={() => toggleCheck(i)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] text-slate-300 hover:bg-white/5">
                  {c.done ? <CheckCircle2 size={15} className="text-aurora-mint" /> : <Circle size={15} className="text-slate-600" />}
                  <span className={c.done ? 'text-slate-500 line-through' : ''}>{c.label}</span>
                </button>
              ))}
            </div>
          </Panel>
          <Panel title="Task board">
            <div className="grid gap-3 md:grid-cols-3">
              {cols.map(([key, label, Icon]) => (
                <div key={key} className="rounded-lg border border-white/8 bg-white/[0.02] p-2">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-300"><Icon size={12} /> {label} <span className="text-slate-600">({p.tasks.filter((t) => t.status === key).length})</span></div>
                  <div className="space-y-1.5">
                    {p.tasks.filter((t) => t.status === key).map((t) => (
                      <div key={t.id} className="rounded-md bg-ink-950/70 p-2 text-[11px] text-slate-300">
                        <p className="leading-snug">{t.title}</p>
                        <div className="mt-1.5 flex gap-1">
                          {key !== 'todo' && <button onClick={() => moveTask(t.id, key === 'done' ? 'inprogress' : 'todo')} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10">←</button>}
                          {key !== 'done' && <button onClick={() => moveTask(t.id, key === 'todo' ? 'inprogress' : 'done')} className="rounded bg-aurora-violet/20 px-1.5 py-0.5 text-[10px] text-white hover:bg-aurora-violet/30">→</button>}
                        </div>
                      </div>
                    ))}
                    {!p.tasks.filter((t) => t.status === key).length && <p className="px-1 py-2 text-[11px] text-slate-600">Empty</p>}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <div className="grid gap-3 md:grid-cols-2">
            <Panel title="Resources">
              <div className="mb-2 flex gap-2">
                <Input value={res} onChange={(e) => setRes(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addResource()} placeholder="Add a link or note…" className="h-9" />
                <Button size="sm" variant="soft" onClick={addResource}><Plus size={14} /></Button>
              </div>
              <ul className="space-y-1">
                {(p.resources || []).map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 rounded-md bg-white/[0.03] px-2 py-1 text-[12px] text-slate-300">
                    <span className="truncate">{r}</span>
                    <button onClick={() => patch({ resources: p.resources.filter((_, idx) => idx !== i) })} className="text-slate-500 hover:text-rose-400"><Trash2 size={12} /></button>
                  </li>
                ))}
                {!(p.resources || []).length && <li className="text-[11px] text-slate-600">No resources yet.</li>}
              </ul>
            </Panel>
            <Panel title="Screenshots" action={<Button size="sm" variant="soft" onClick={addScreenshot}><ImageIcon size={13} /> Add</Button>}>
              <div className="flex flex-wrap gap-2">
                {(p.screenshots || []).map((s, i) => (
                  <div key={i} className="relative grid h-16 w-20 place-items-center rounded-lg border border-dashed border-white/15 bg-white/[0.02] text-[9px] text-slate-500">
                    {s.label}
                    <button onClick={() => patch({ screenshots: p.screenshots.filter((_, idx) => idx !== i) })} className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-ink-900 text-slate-400 ring-1 ring-white/15 hover:text-rose-400"><X size={10} /></button>
                  </div>
                ))}
                {!(p.screenshots || []).length && <p className="text-[11px] text-slate-600">Add slots to boost the proof score.</p>}
              </div>
            </Panel>
          </div>
          <Field label="Notes">
            <textarea value={p.notes || ''} onChange={(e) => patch({ notes: e.target.value })} placeholder="Working notes, decisions, blockers…" className="h-24 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-aurora-violet/50" />
          </Field>
        </div>
      )}

      {tab === 'github' && (
        <div className="space-y-3">
          <Panel title="Connect GitHub repo">
            <p className="mb-2 text-[12px] text-slate-400">Paste a public repo URL (github.com/user/repo or user/repo). OAuth account connect can be added later — public URL analysis needs no token.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input value={repoInput} onChange={(e) => setRepoInput(e.target.value)} placeholder="https://github.com/you/project" />
              <Button onClick={runGithub} disabled={busy === 'github'}><GitBranch size={15} /> {busy === 'github' ? 'Analyzing…' : 'Connect / Analyze'}</Button>
            </div>
            {ghMsg && <p className="mt-2 text-[12px] text-aurora-cyan">{ghMsg}</p>}
            {p.github?.lastSyncedAt && <p className="mt-1 text-[11px] text-slate-500">Last synced {new Date(p.github.lastSyncedAt).toLocaleString()}.</p>}
          </Panel>
          {p.github?.success && (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <Panel title="Repository" action={<Badge tone={p.github.githubScore >= 60 ? 'mint' : 'amber'}>{p.github.githubScore}/100</Badge>}>
                  <div className="space-y-0.5 text-[12px] text-slate-300">
                    <p className="font-medium text-white">{p.github.repo.fullName}</p>
                    {p.github.repo.description && <p className="text-slate-400">{p.github.repo.description}</p>}
                    <p className="text-slate-500">★ {p.github.repo.stars} · forks {p.github.repo.forks} · branch {p.github.repo.defaultBranch}</p>
                    <p className="text-slate-500">Updated {p.github.repo.pushedAt ? new Date(p.github.repo.pushedAt).toLocaleDateString() : '—'} · {p.github.repo.license || 'no license'}</p>
                  </div>
                </Panel>
                <Panel title="Detected tech stack"><div className="flex flex-wrap gap-1.5">{(p.github.detectedTechStack || []).map((s, i) => <Badge key={i} tone="violet">{s}</Badge>)}{Object.keys(p.github.languages || {}).length > 0 && <span className="text-[11px] text-slate-500">Langs: {Object.keys(p.github.languages).join(', ')}</span>}</div></Panel>
              </div>
              <Panel title="Detected files & evidence">
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(p.github.files || {}).filter(([, v]) => v).map(([k]) => <Badge key={k} tone="mint">{k}</Badge>)}
                </div>
                {(p.github.structure || []).length > 0 && <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-slate-400">{p.github.structure.join('\n')}</pre>}
              </Panel>
              {(p.github.warnings?.length > 0 || p.github.recommendations?.length > 0) && (
                <Panel title="Missing items & recommendations">
                  <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-amber-100/90">{(p.github.warnings || []).map((w, i) => <li key={i}>{w}</li>)}</ul>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-slate-400">{(p.github.recommendations || []).map((r, i) => <li key={i}>{r}</li>)}</ul>
                </Panel>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'verify' && (
        <div className="space-y-3">
          <Panel title="Project status" action={<StatusBadge status={statusInfo.status} />}>
            <div className="mb-2 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-white/[0.03] p-2"><div className="font-display text-lg text-white">{p.proofScore}</div><div className="text-[9px] uppercase tracking-widest text-slate-500">Proof</div></div>
              <div className="rounded-lg bg-white/[0.03] p-2"><div className="font-display text-lg text-white">{statusInfo.githubScore}</div><div className="text-[9px] uppercase tracking-widest text-slate-500">GitHub</div></div>
              <div className="rounded-lg bg-white/[0.03] p-2"><div className="font-display text-lg text-white">{statusInfo.checklistPct}%</div><div className="text-[9px] uppercase tracking-widest text-slate-500">Checklist</div></div>
            </div>
            {statusInfo.status === 'Recruiter Ready'
              ? <p className="text-[12px] text-aurora-mint">This project is Recruiter Ready — fully proven.</p>
              : <p className="text-[12px] text-amber-100/90"><AlertTriangle size={12} className="mr-1 inline" />To reach <b>{statusInfo.next}</b>: {statusInfo.reasons.join('; ')}.</p>}
          </Panel>

          <Panel title="Verify live demo">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input value={liveInput} onChange={(e) => setLiveInput(e.target.value)} placeholder="https://your-demo.app" />
              <Button onClick={runVerify} disabled={busy === 'live'}><Globe size={15} /> {busy === 'live' ? 'Checking…' : 'Verify live demo'}</Button>
            </div>
            {liveMsg && <p className="mt-2 text-[12px] text-aurora-cyan">{liveMsg}</p>}
            {p.liveVerification && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={p.liveVerification.reachable ? 'mint' : 'rose'}>{p.liveVerification.reachable ? 'Verified reachable' : p.liveVerification.statusCode ? 'Not reachable' : 'Needs manual review'}</Badge>
                {p.liveVerification.statusCode > 0 && <Badge>HTTP {p.liveVerification.statusCode}</Badge>}
                {p.liveVerification.responseTimeMs > 0 && <Badge>{p.liveVerification.responseTimeMs}ms</Badge>}
                <span className="text-[11px] text-slate-500">checked {new Date(p.liveVerification.checkedAt).toLocaleTimeString()}</span>
              </div>
            )}
          </Panel>

          <Panel title="Proof score breakdown" action={<Badge tone={p.proofScore >= 70 ? 'mint' : p.proofScore >= 40 ? 'cyan' : 'amber'}>{p.proofScore}/100 · +{projectXP(p).xp} XP</Badge>}>
            <div className="space-y-1">
              {proofScoreBreakdown(p).rows.map((r) => (
                <div key={r.key} className="flex items-center gap-2 text-[11px]">
                  <span className="w-40 shrink-0 text-slate-400">{r.label}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-aurora-cta" style={{ width: `${(r.score / r.max) * 100}%` }} /></div>
                  <span className="w-10 text-right font-mono text-slate-300">{r.score}/{r.max}</span>
                </div>
              ))}
            </div>
            {proofScoreBreakdown(p).recommendation && <p className="mt-2 text-[12px] text-aurora-cyan">{proofScoreBreakdown(p).recommendation}</p>}
          </Panel>

          {(() => { const badges = deriveBadges([p]); return badges.length > 0 ? (
            <Panel title="Verified skill badges (from proof)"><div className="flex flex-wrap gap-1.5">{badges.map((b) => <BadgePill key={b.skillName + b.level} badge={b} />)}</div></Panel>
          ) : null; })()}

          <Panel title="Recruiter summary" action={<Button size="sm" variant="soft" onClick={genRecruiterSummary}><Sparkles size={13} /> Generate</Button>}>
            {p.recruiterSummary ? <p className="text-[13px] text-slate-300">{p.recruiterSummary}</p> : <p className="text-[12px] text-slate-500">No recruiter summary yet — generate one (required to publish).</p>}
          </Panel>
        </div>
      )}

      {tab === 'resume' && (
        <div className="space-y-3">
          <Panel title="Resume bullet points" action={<div className="flex gap-2"><CopyBtn text={(p.resumeBullets || []).map((b) => '• ' + b).join('\n')} /><Button size="sm" variant="soft" onClick={() => regen('bullets')} disabled={busy === 'bullets'}><RefreshCw size={13} /> {busy === 'bullets' ? '…' : 'Regenerate'}</Button></div>}>
            <ul className="list-disc space-y-1 pl-4 text-[13px] text-slate-300 marker:text-aurora-violet">{(p.resumeBullets || []).map((b, i) => <li key={i}>{b}</li>)}</ul>
          </Panel>
          <div className="grid gap-3 md:grid-cols-2">
            <Panel title="LinkedIn post" action={<div className="flex gap-2"><CopyBtn text={p.linkedinPost} /><Button size="sm" variant="soft" onClick={() => regen('linkedin')} disabled={busy === 'linkedin'}><RefreshCw size={13} /></Button></div>}>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-slate-300">{p.linkedinPost}</pre>
            </Panel>
            <Panel title="Interview Q&A" action={<Button size="sm" variant="soft" onClick={() => regen('interview')} disabled={busy === 'interview'}><RefreshCw size={13} /> {busy === 'interview' ? '…' : 'Regenerate'}</Button>}>
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {(p.interviewQuestions || []).slice(0, 8).map((qa, i) => (
                  <details key={i} className="rounded-lg bg-white/[0.03] p-2 text-[12px]">
                    <summary className="cursor-pointer font-medium text-slate-200">{qa.q}</summary>
                    <p className="mt-1 text-slate-400">{qa.a}</p>
                  </details>
                ))}
              </div>
            </Panel>
          </div>
          <Panel title="GitHub README" action={<div className="flex gap-2"><CopyBtn text={p.readme} label="Copy README" /><Button size="sm" variant="soft" onClick={() => regen('readme')} disabled={busy === 'readme'}><RefreshCw size={13} /> {busy === 'readme' ? '…' : 'Regenerate'}</Button></div>}>
            <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-snug text-slate-400">{p.readme}</pre>
          </Panel>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="soft" onClick={onOpenEditor}><PenLine size={14} /> Open in Resume Editor</Button>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
        <Button onClick={() => onPublish(p)} variant={p.published ? 'soft' : 'primary'}>
          <Rocket size={15} /> {p.published ? 'Published — update sandbox' : 'Publish to Sandbox'}
        </Button>
        <CopyBtn text={(p.resumeBullets || []).map((b) => '• ' + b).join('\n')} label="Copy bullets" />
        {(() => {
          const { ready, missing } = publishReadiness(p);
          if (ready || p.published) return null;
          return <span className="text-[11px] text-amber-100/80"><AlertTriangle size={12} className="mr-1 inline" />To publish, add {missing.join(', ')}.</span>;
        })()}
      </div>
    </Modal>
  );
}

function WorkspaceCard({ p, onOpen, onDelete }) {
  const progress = taskProgress(p);
  const st = calculateProjectStatus(p);
  return (
    <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/25">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-medium leading-tight text-white">{p.title}</h4>
        <button onClick={() => onDelete(p.id)} className="text-slate-600 hover:text-rose-400"><Trash2 size={14} /></button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <StatusBadge status={st.status} />
        <Badge tone="violet">{p.targetRole}</Badge>
        <Badge tone="mint">Proof {p.proofScore}/100</Badge>
        {p.github?.success && <Badge tone="violet"><Github size={10} /> {p.github.githubScore}</Badge>}
        {p.liveVerification?.reachable && <Badge tone="cyan"><Globe size={10} /> Live</Badge>}
        {p.published && <Badge tone="cyan">Published</Badge>}
      </div>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[10px] text-slate-500"><span>Progress</span><span>{progress}%</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-aurora-cta" style={{ width: `${progress}%` }} /></div>
      </div>
      <p className="mt-2 line-clamp-2 text-[11px] text-slate-500">{whyNotVerified(p)}</p>
      <Button size="sm" className="mt-3" onClick={() => onOpen(p)}><Layers size={14} /> Open workspace</Button>
    </div>
  );
}

/* ---------------- Main view ---------------- */
export default function ProjectStudio({ go }) {
  const { user } = useAuth();
  const access = useMemo(() => getAccessForUser(user), [user]);
  const userName = user?.name || user?.displayName || 'You';
  const resume = getStoredResume();
  const seed = useMemo(() => consumeStudioSeed(), []);
  const [role, setRole] = useState(seed?.job?.title || getResumeSearchRole() || 'Software Engineer');
  const [level, setLevel] = useState('Intermediate');
  const [duration, setDuration] = useState('1 week');
  const [type, setType] = useState(seed?.type || 'Full Stack');
  const [jd, setJd] = useState('');
  const [useGaps, setUseGaps] = useState(Boolean(seed?.missingSkills?.length));
  const gaps = seed?.missingSkills || [];

  const [status, setStatus] = useState('idle');
  const [project, setProject] = useState(null);
  const [projects, setProjects] = useState(getProjects());
  const [openWs, setOpenWs] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const sync = () => setProjects(getProjects());
    window.addEventListener('career-projects-updated', sync);
    return () => window.removeEventListener('career-projects-updated', sync);
  }, []);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const generate = async () => {
    setStatus('loading'); setProject(null);
    const input = {
      targetRole: role, difficulty: level, duration, type,
      sourceMissingSkills: useGaps && gaps.length ? gaps : extractSkillsFromJD(jd),
      jd: jd.trim(), resumeText: resume.text || '',
      sourceJob: seed?.job ? { title: seed.job.title, company: seed.job.company } : null,
    };
    try { const p = await generateRoadmap(input); setProject(p); setStatus('done'); }
    catch { setStatus('error'); }
  };

  const saveWorkspace = () => { const saved = saveProject(project); setProjects(getProjects()); flash('Saved to workspaces.'); setOpenWs(saved); };
  const addBullets = () => {
    const bullets = (project.resumeBullets || []).map((b) => '• ' + b).join('\n');
    const text = (resume.text || '').trimEnd();
    const block = `\n\nKEY PROJECTS\n${bullets}`;
    saveStoredResume({ text: text ? text + block : `KEY PROJECTS\n${bullets}` });
    flash('Project bullets added to your resume.');
  };
  const onWsChange = (next) => { saveProject(next); setProjects(getProjects()); };
  const publish = (p) => {
    // ensure a recruiter summary exists (Part 8 publish requirement)
    let proj = p;
    if (!(proj.recruiterSummary && proj.recruiterSummary.trim())) {
      proj = { ...proj, recruiterSummary: buildRecruiterSummary({ ...proj, proofScore: computeProofScore(proj) }, userName) };
    }
    const { ready, missing } = publishReadiness(proj);
    if (!ready) { saveProject(proj); setProjects(getProjects()); flash('Not ready to publish — add ' + missing.join(', ') + '.'); return; }
    if (!proj.published) {
      const cap = access.limits.sandboxPublish;
      const publishedCount = getPublishedProjects().filter((x) => x.id !== proj.id).length;
      if (!isUnlimited(cap) && publishedCount >= cap) {
        promptUpgrade('sandboxPublish', `Your ${access.effectivePlan} plan allows ${cap} published sandbox project${cap === 1 ? '' : 's'}. Upgrade to publish more.`);
        return;
      }
    }
    const next = saveProject({ ...proj, published: true });
    setProjects(getProjects());
    setOpenWs(next);
    flash('Published to Sandbox.');
  };

  return (
    <>
      <PageIntro title="Career Project Studio" sub="Turn missing skills into portfolio projects that prove your skills to recruiters." />

      {toast && <div className="mb-4 rounded-xl border border-aurora-mint/30 bg-aurora-mint/10 px-4 py-2.5 text-sm text-slate-100">{toast}</div>}

      {seed?.job && (
        <div className="mb-4 rounded-2xl border border-aurora-violet/25 bg-aurora-violet/10 px-4 py-3 text-sm text-slate-200">
          <Sparkles size={15} className="mr-1.5 inline text-aurora-violet" />
          Project generated from gaps in <span className="font-medium text-white">{seed.job.title}</span>{seed.job.company ? <> at <span className="font-medium text-white">{seed.job.company}</span></> : null}.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.25fr]">
        {/* form */}
        <div className="space-y-4">
          <SectionCard title="Project setup">
            <div className="space-y-3">
              <Field label="Target role">
                <select value={role} onChange={(e) => setRole(e.target.value)} className="h-10 w-full rounded-xl border border-white/10 bg-ink-950 px-3 text-sm text-slate-100">
                  {!ALL_ROLES.includes(role) && <option>{role}</option>}
                  {Object.entries(ROLE_GROUPS).map(([g, roles]) => <optgroup key={g} label={g}>{roles.map((r) => <option key={r}>{r}</option>)}</optgroup>)}
                </select>
              </Field>
              <Field label="Experience level">
                <div className="flex flex-wrap gap-1.5">{LEVELS.map((l) => <button key={l} onClick={() => setLevel(l)} className={`rounded-lg px-3 py-1.5 text-xs transition ${level === l ? 'bg-aurora-violet/20 text-white ring-1 ring-aurora-violet/40' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>{l}</button>)}</div>
              </Field>
              <Field label="Project duration">
                <div className="flex flex-wrap gap-1.5">{DURATIONS.map((d) => <button key={d} onClick={() => setDuration(d)} className={`rounded-lg px-3 py-1.5 text-xs transition ${duration === d ? 'bg-aurora-cyan/15 text-white ring-1 ring-aurora-cyan/30' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>{d}</button>)}</div>
              </Field>
              <Field label="Project type">
                <div className="flex flex-wrap gap-1.5">{TYPES.map((t) => <button key={t} onClick={() => setType(t)} className={`rounded-lg px-3 py-1.5 text-xs transition ${type === t ? 'bg-aurora-mint/15 text-white ring-1 ring-aurora-mint/30' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>{t}</button>)}</div>
              </Field>
              <Field label="Paste a job description (optional)">
                <textarea value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste a JD to extract target skills…" className="h-24 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-aurora-violet/50" />
              </Field>
              <Button className="w-full" onClick={generate} disabled={status === 'loading'}>
                <Wand2 size={16} /> {status === 'loading' ? 'Generating roadmap…' : 'Generate Project Roadmap'}
              </Button>
            </div>
          </SectionCard>

          {/* Missing skill → project converter */}
          <SectionCard title="Missing skills → project" action={<Boxes size={16} className="text-aurora-cyan" />}>
            {gaps.length ? (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <Chips items={gaps} tone="rose" />
                  <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-400"><input type="checkbox" checked={useGaps} onChange={(e) => setUseGaps(e.target.checked)} /> use these</label>
                </div>
                <p className="text-[12px] leading-relaxed text-slate-400">These gaps were detected from the selected job. The generated project will cover them, explain how it strengthens your resume, and what recruiter-visible proof it creates (a deployed app + README + demo).</p>
              </>
            ) : (
              <p className="text-[12px] text-slate-500">No gaps passed in. Open a job in <button onClick={() => go?.('jobs')} className="text-aurora-cyan underline">Jobs</button> and click “Build project for gaps”, or paste a JD above.</p>
            )}
          </SectionCard>
        </div>

        {/* result / placeholder */}
        <div className="space-y-4">
          {status === 'loading' && <SectionCard title="Generating"><div className="flex flex-col items-center gap-3 py-16"><Spinner /><p className="text-sm text-muted">Designing a project around your skills…</p></div></SectionCard>}
          {status === 'idle' && !project && (
            <SectionCard title="Your project">
              <EmptyState icon={Rocket} title="No project yet" hint="Set your role, level, duration and type, then generate a tailored project roadmap with resume bullets, a README, a LinkedIn post and interview prep." />
            </SectionCard>
          )}
          {project && status === 'done' && (
            <ProjectResult project={project} seed={seed} onSave={saveWorkspace} onAddBullets={addBullets} onOpenEditor={() => go?.('editor')} />
          )}
        </div>
      </div>

      {/* saved workspaces */}
      <div className="mt-6">
        <SectionCard title="Your project workspaces" action={<Badge tone="violet">{projects.length}</Badge>}>
          {projects.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => <WorkspaceCard key={p.id} p={p} onOpen={setOpenWs} onDelete={(id) => { deleteProject(id); setProjects(getProjects()); }} />)}
            </div>
          ) : (
            <EmptyState icon={Layers} title="No saved workspaces" hint="Generate a project and click “Save as workspace” to track tasks, links and proof-of-work here." />
          )}
        </SectionCard>
      </div>

      <WorkspaceModal
        project={openWs}
        open={!!openWs}
        onClose={() => setOpenWs(null)}
        onChange={onWsChange}
        onPublish={publish}
        onOpenEditor={() => { setOpenWs(null); go?.('editor'); }}
        userName={userName}
      />
    </>
  );
}

/* naive skill extraction from a pasted JD (deterministic, no backend) */
function extractSkillsFromJD(jd = '') {
  if (!jd.trim()) return [];
  const known = ['React', 'Node.js', 'Express', 'TypeScript', 'JavaScript', 'Python', 'Java', 'Go', 'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'CI/CD', 'Jenkins', 'PostgreSQL', 'MongoDB', 'Redis', 'GraphQL', 'REST', 'Spark', 'Hadoop', 'Airflow', 'Snowflake', 'Kafka', 'TensorFlow', 'PyTorch', 'Tailwind', 'Next.js', 'FastAPI', 'Spring Boot', 'Prometheus', 'Grafana', 'Helm'];
  const hay = jd.toLowerCase();
  return known.filter((k) => hay.includes(k.toLowerCase())).slice(0, 10);
}
