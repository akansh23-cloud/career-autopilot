import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft, CheckCircle2, Circle, Copy, Check, Download, FileJson, FileText,
  Terminal, ListChecks, FlaskConical, UploadCloud, GitBranch, ShieldCheck,
  Target, Gauge, Clock, ChevronRight, Layers, AlertTriangle, BookOpen, Rocket,
  FolderTree, Boxes, Wrench,
} from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, EmptyState, Skeleton } from '../components/ui/kit.jsx';
import { getProject, saveProject } from '../lib/projectStore.js';
import {
  generateBuildGuide, computeProgress, setTaskProgress, setPrerequisiteProgress,
  setStageProgress, buildGuideToMarkdown,
} from '../lib/buildGuide.js';

/* ---------------- small reusable bits ---------------- */
const safeArr = (v) => (Array.isArray(v) ? v : []);

function CopyBtn({ text, label = 'Copy', size = 'sm' }) {
  const [done, setDone] = useState(false);
  return (
    <Button size={size} variant="soft" onClick={() => { try { navigator.clipboard?.writeText(text || ''); } catch { /* clipboard unavailable */ } setDone(true); setTimeout(() => setDone(false), 1400); }}>
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Copied' : label}
    </Button>
  );
}

function CodeBlock({ lines, language = 'bash' }) {
  const list = safeArr(lines).map((l) => String(l));
  if (!list.length) return null;
  const text = list.join('\n');
  return (
    <div className="group relative overflow-hidden rounded-xl border border-subtle bg-base/70">
      <div className="flex items-center justify-between border-b border-subtle px-3 py-1.5">
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-fg-muted"><Terminal size={11} /> {language}</span>
        <CopyBtn text={text} />
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 text-[12px] leading-relaxed text-fg"><code>{text}</code></pre>
    </div>
  );
}

function List({ items, tone = 'slate' }) {
  const list = safeArr(items).map((x) => String(x)).filter(Boolean);
  if (!list.length) return <p className="text-xs text-fg-muted">—</p>;
  const dot = tone === 'rose' ? 'text-rose-400' : tone === 'mint' ? 'text-aurora-mint' : 'text-fg-muted';
  return (
    <ul className="space-y-1.5">
      {list.map((x, i) => <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-fg-secondary"><span className={`mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-current ${dot}`} />{x}</li>)}
    </ul>
  );
}

function NumberedSteps({ items }) {
  const list = safeArr(items).map((x) => String(x)).filter(Boolean);
  if (!list.length) return <p className="text-xs text-fg-muted">—</p>;
  return (
    <ol className="space-y-1.5">
      {list.map((x, i) => (
        <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-fg-secondary">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-aurora-violet/15 text-[11px] font-semibold text-aurora-violet">{i + 1}</span>
          <span>{x}</span>
        </li>
      ))}
    </ol>
  );
}

function Panel({ title, icon: Icon, action, children }) {
  return (
    <div className="rounded-xl border border-subtle bg-surface-1 p-3.5">
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between">
          <h4 className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-fg-secondary">{Icon && <Icon size={13} />} {title}</h4>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function Collapsible({ title, icon: Icon, defaultOpen = false, tone = 'violet', children }) {
  const [open, setOpen] = useState(defaultOpen);
  const ring = tone === 'cyan' ? 'text-aurora-cyan' : tone === 'mint' ? 'text-aurora-mint' : tone === 'amber' ? 'text-amber-glow' : 'text-aurora-violet';
  return (
    <div className="rounded-xl border border-subtle bg-surface-1">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-3.5 py-2.5 text-left">
        <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide ${ring}`}>{Icon && <Icon size={13} />} {title}</span>
        <ChevronRight size={15} className={`text-fg-muted transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="border-t border-subtle px-3.5 py-3">{children}</div>}
    </div>
  );
}

function KeyVal({ label, value }) {
  if (!value) return null;
  return <div className="text-[12.5px] leading-relaxed text-fg-secondary"><span className="text-fg-muted">{label}: </span>{value}</div>;
}

function downloadText(filename, text, type = 'text/plain') {
  try {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch { /* download unavailable */ }
}

/* ---------------- section: Overview ---------------- */
function OverviewSection({ guide }) {
  return (
    <div className="space-y-3">
      <Panel title="What you're building" icon={Rocket}>
        <p className="text-[13px] leading-relaxed text-fg-secondary">{guide.summary || '—'}</p>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel title="Why this proves your skills" icon={Target}>
          <p className="text-[13px] leading-relaxed text-fg-secondary">Finishing this build produces a public repo, a deployed URL, and a README — the recruiter-visible proof that you can ship a real {guide.type} project, not just list the skills.</p>
        </Panel>
        <Panel title="How Builder Mode works" icon={ListChecks}>
          <p className="text-[13px] leading-relaxed text-fg-secondary">Work top-to-bottom through the stages. Each task tells you exactly which files to create, the commands to run, what to expect, how to validate, and the commit to make. Tick tasks off to track build progress.</p>
        </Panel>
      </div>
      <div className="rounded-xl border border-aurora-cyan/25 bg-aurora-cyan/5 p-3.5 text-[12.5px] leading-relaxed text-fg-secondary">
        <ShieldCheck size={14} className="mr-1.5 inline text-aurora-cyan" />
        Build progress measures <span className="text-fg">execution</span>. It is tracked separately from <span className="text-fg">proof verification</span> — checking off tasks here never marks your project “verified”. To unlock verified resume bullets you still attach real GitHub/live evidence in the Project Workspace.
      </div>
      <ArchitectureInputs guide={guide} />
    </div>
  );
}

/* ---------------- section: Architecture Inputs Used ---------------- */
function ArchitectureInputs({ guide }) {
  const ai = guide.architectureInputs || {};
  const missing = safeArr(guide.missingInputs);
  const rows = [
    ['Components used', safeArr(ai.components), 'mint'],
    ['APIs used', safeArr(ai.apis), 'cyan'],
    ['Database entities used', safeArr(ai.entities), 'violet'],
    ['Deployment targets used', safeArr(ai.deployment), 'amber'],
  ].filter(([, v]) => v.length > 0);
  if (!rows.length && !missing.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.length > 0 && (
        <Panel title="Architecture inputs used" icon={Boxes}>
          <div className="space-y-2">
            {rows.map(([label, vals, tone]) => (
              <div key={label}>
                <div className="mb-1 text-[11px] uppercase tracking-wide text-fg-muted">{label}</div>
                <div className="flex flex-wrap gap-1.5">{vals.map((v, i) => <Badge key={i} tone={tone}>{v}</Badge>)}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}
      {missing.length > 0 && (
        <Panel title="Missing details" icon={AlertTriangle}>
          <p className="mb-1.5 text-[12px] text-fg-secondary">A guide was still generated. Add these in the Project Workspace for a sharper, architecture-backed build:</p>
          <ul className="space-y-1">
            {missing.map((m, i) => <li key={i} className="flex items-start gap-1.5 text-[12.5px] text-amber-100"><span className="mt-1 text-amber-glow">•</span> {m}</li>)}
          </ul>
        </Panel>
      )}
    </div>
  );
}

/* ---------------- section: Prerequisites ---------------- */
function PrerequisitesSection({ guide, onToggle }) {
  const items = safeArr(guide.prerequisites);
  if (!items.length) return <EmptyState icon={Wrench} title="No prerequisites listed" hint="This build can start right away." />;
  return (
    <div className="space-y-2.5">
      {items.map((q, i) => (
        <div key={i} className="rounded-xl border border-subtle bg-surface-1 p-3.5">
          <div className="flex items-start gap-3">
            <button onClick={() => onToggle(q.name, !q.completed)} className="mt-0.5 shrink-0 text-fg-secondary hover:text-aurora-mint" aria-label="toggle prerequisite">
              {q.completed ? <CheckCircle2 size={18} className="text-aurora-mint" /> : <Circle size={18} />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-sm font-medium ${q.completed ? 'text-fg-secondary line-through' : 'text-fg'}`}>{q.name}</span>
                <Badge tone={q.required ? 'amber' : 'cyan'}>{q.required ? 'Required' : 'Optional'}</Badge>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-fg-secondary">{q.description}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {q.checkCommand && <code className="rounded-md bg-base/70 px-2 py-1 text-[11px] text-fg-secondary">{q.checkCommand}</code>}
                {q.checkCommand && <CopyBtn text={q.checkCommand} label="Copy check" />}
                {q.installLink && <a href={q.installLink} target="_blank" rel="noreferrer" className="text-[11px] text-aurora-cyan underline">Install</a>}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- section: Setup ---------------- */
function SetupSection({ guide }) {
  const s = guide.setup || {};
  return (
    <div className="space-y-3">
      {s.overview && <Panel title="Overview" icon={BookOpen}><p className="text-[13px] leading-relaxed text-fg-secondary">{s.overview}</p></Panel>}
      {safeArr(s.commands).length > 0 && <Panel title="Setup commands" icon={Terminal}><CodeBlock lines={s.commands} /></Panel>}
      {safeArr(s.folderStructure).length > 0 && <Panel title="Folder structure" icon={FolderTree}><CodeBlock lines={s.folderStructure} language="text" /></Panel>}
      {safeArr(s.environmentVariables).length > 0 && <Panel title="Environment variables" icon={Boxes}><CodeBlock lines={s.environmentVariables} language="env" /></Panel>}
      {safeArr(s.expectedOutput).length > 0 && <Panel title="Expected output" icon={CheckCircle2}><List items={s.expectedOutput} tone="mint" /></Panel>}
    </div>
  );
}

/* ---------------- section: Roadmap ---------------- */
function RoadmapSection({ guide, onJump }) {
  const stages = safeArr(guide.stages);
  if (!stages.length) return <EmptyState icon={Layers} title="No stages yet" hint="The roadmap will appear once the guide is generated." />;
  return (
    <div className="space-y-2.5">
      {stages.map((s, i) => {
        const tasks = safeArr(s.tasks);
        const done = tasks.filter((t) => t.status === 'done').length;
        return (
          <button key={s.id} onClick={() => onJump(s.id)} className="block w-full rounded-xl border border-subtle bg-surface-1 p-3.5 text-left transition hover:border-aurora-violet/35">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-aurora-violet/15 text-[12px] font-semibold text-aurora-violet">{i + 1}</span>
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-fg">{s.title} {s.status === 'done' && <CheckCircle2 size={14} className="text-aurora-mint" />}</div>
                  <p className="text-[12px] text-fg-secondary">{s.goal}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-[11px] text-fg-muted">
                <Clock size={12} /> {s.estimatedTime || '—'} · {done}/{tasks.length} <ChevronRight size={14} />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- v3: code-level guidance ---------------- */
const TYPE_TONE = { backend_api: 'cyan', database: 'violet', frontend: 'mint', backend_service: 'violet', deployment: 'amber', devops: 'amber', setup: 'cyan', testing: 'mint', proof: 'mint', security: 'amber', integration: 'cyan', documentation: 'cyan' };

function CodeLevelSections({ guide }) {
  const g = guide && typeof guide === 'object' ? guide : null;
  if (!g) return null;
  const c = g.apiContract, db = g.databaseSchema, fe = g.frontendGuide, be = g.backendGuide, tg = g.testGuide, dv = g.devopsGuide;
  const hasFilePlans = safeArr(g.filePlans).length > 0;
  const hasTests = tg && (safeArr(tg.curlCommands).length || safeArr(tg.apiTests).length || safeArr(tg.unitTestIdeas).length || safeArr(tg.manualTests).length);
  if (!g.overview && !c && !db && !fe && !be && !hasFilePlans && !hasTests && !dv) return null;
  return (
    <div className="space-y-2.5">
      {g.overview && (
        <div className="rounded-xl border border-aurora-violet/25 bg-aurora-violet/5 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-fg-secondary">
          <BookOpen size={13} className="mr-1.5 inline text-aurora-violet" />{g.overview}
        </div>
      )}
      {hasFilePlans && (
        <Collapsible title="File plan" icon={FolderTree} tone="violet">
          <div className="space-y-2.5">
            {g.filePlans.map((fp, i) => (
              <div key={i} className="rounded-lg border border-subtle bg-surface-1 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <code className="text-[12px] text-aurora-cyan">{fp.path}</code>
                  <CopyBtn text={fp.path} label="Copy" />
                </div>
                {fp.purpose && <p className="mt-1 text-[12.5px] text-fg-secondary">{fp.purpose}</p>}
                {safeArr(fp.responsibilities).length > 0 && <List items={fp.responsibilities} />}
                {(safeArr(fp.exports).length > 0 || safeArr(fp.imports).length > 0) && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {safeArr(fp.exports).map((e, j) => <Badge key={`e${j}`} tone="mint">export: {e}</Badge>)}
                    {safeArr(fp.imports).map((e, j) => <Badge key={`i${j}`} tone="cyan">import: {e}</Badge>)}
                  </div>
                )}
                {fp.notes && <p className="mt-1.5 text-[11.5px] text-fg-muted">{fp.notes}</p>}
              </div>
            ))}
          </div>
        </Collapsible>
      )}
      {c && (
        <Collapsible title="API contract" icon={GitBranch} tone="cyan" defaultOpen>
          <div className="space-y-2">
            <CodeBlock language="http" lines={[`${c.method} ${c.path}`, '', `Request:  ${c.requestBody}`, `Response: ${c.responseBody}`]} />
            {safeArr(c.validationRules).length > 0 && <Panel title="Validation"><List items={c.validationRules} /></Panel>}
            {safeArr(c.errorCases).length > 0 && <Panel title="Error cases"><List items={c.errorCases} tone="rose" /></Panel>}
          </div>
        </Collapsible>
      )}
      {db && (
        <Collapsible title="Database schema" icon={Boxes} tone="violet">
          <div className="space-y-2">
            <KeyVal label="Entity" value={db.entity} />
            {safeArr(db.fields).length > 0 && <div className="flex flex-wrap gap-1.5">{db.fields.map((f, i) => <Badge key={i} tone="violet">{f}</Badge>)}</div>}
            {db.sampleDocument && Object.keys(db.sampleDocument).length > 0 && <CodeBlock language="json" lines={JSON.stringify(db.sampleDocument, null, 2).split('\n')} />}
            {safeArr(db.indexes).length > 0 && <KeyVal label="Indexes" value={db.indexes.join(', ')} />}
            {db.relationship && <KeyVal label="Relationships" value={db.relationship} />}
            {db.seedDataIdea && <KeyVal label="Seed data" value={db.seedDataIdea} />}
            {safeArr(db.validationRules).length > 0 && <Panel title="Validation"><List items={db.validationRules} /></Panel>}
          </div>
        </Collapsible>
      )}
      {fe && (
        <Collapsible title="Frontend guide" icon={Layers} tone="mint">
          <div className="space-y-2">
            <KeyVal label="Component" value={fe.componentName} />
            {safeArr(fe.props).length > 0 && <KeyVal label="Props" value={fe.props.join(', ')} />}
            {safeArr(fe.state).length > 0 && <KeyVal label="State" value={fe.state.join(', ')} />}
            {safeArr(fe.apiCalls).length > 0 && <Panel title="API calls"><List items={fe.apiCalls} /></Panel>}
            <div className="grid gap-1 sm:grid-cols-2">
              <KeyVal label="Loading" value={fe.loadingState} />
              <KeyVal label="Empty" value={fe.emptyState} />
              <KeyVal label="Error" value={fe.errorState} />
              <KeyVal label="Success" value={fe.successState} />
            </div>
            {safeArr(fe.manualUiTest).length > 0 && <Panel title="Manual UI test"><List items={fe.manualUiTest} /></Panel>}
          </div>
        </Collapsible>
      )}
      {be && (safeArr(be.businessLogicSteps).length > 0 || be.routeFile || safeArr(be.functions).length > 0) && (
        <Collapsible title="Backend guide" icon={Wrench} tone="violet">
          <div className="space-y-2">
            {(be.routeFile || be.controllerFile || be.serviceFile || be.modelFile) && (
              <div className="flex flex-wrap gap-1.5">
                {be.routeFile && <Badge tone="cyan">route: {be.routeFile}</Badge>}
                {be.controllerFile && <Badge tone="cyan">controller: {be.controllerFile}</Badge>}
                {be.serviceFile && <Badge tone="violet">service: {be.serviceFile}</Badge>}
                {be.modelFile && <Badge tone="violet">model: {be.modelFile}</Badge>}
              </div>
            )}
            {safeArr(be.functions).length > 0 && <KeyVal label="Functions" value={be.functions.join(', ')} />}
            {be.input && <KeyVal label="Input" value={be.input} />}
            {be.output && <KeyVal label="Output" value={be.output} />}
            {safeArr(be.middleware).length > 0 && <KeyVal label="Middleware" value={be.middleware.join(', ')} />}
            {safeArr(be.businessLogicSteps).length > 0 && <Panel title="Business logic"><NumberedSteps items={be.businessLogicSteps} /></Panel>}
            {safeArr(be.edgeCases).length > 0 && <Panel title="Edge cases"><List items={be.edgeCases} tone="rose" /></Panel>}
          </div>
        </Collapsible>
      )}
      {hasTests && (
        <Collapsible title="Testing" icon={FlaskConical} tone="mint">
          <div className="space-y-2">
            {safeArr(tg.curlCommands).length > 0 && <CodeBlock language="bash" lines={tg.curlCommands} />}
            {safeArr(tg.expectedResults).length > 0 && <Panel title="Expected result"><List items={tg.expectedResults} tone="mint" /></Panel>}
            {safeArr(tg.apiTests).length > 0 && <Panel title="API tests"><List items={tg.apiTests} /></Panel>}
            {safeArr(tg.unitTestIdeas).length > 0 && <Panel title="Unit test ideas"><List items={tg.unitTestIdeas} /></Panel>}
            {safeArr(tg.manualTests).length > 0 && <Panel title="Manual tests"><List items={tg.manualTests} /></Panel>}
          </div>
        </Collapsible>
      )}
      {dv && (
        <Collapsible title="DevOps / deployment" icon={Rocket} tone="amber">
          <div className="space-y-2">
            {safeArr(dv.envVars).length > 0 && (
              <Panel title="Environment variables" action={<CopyBtn text={dv.envVars.join('\n')} />}>
                <div className="flex flex-wrap gap-1.5">{dv.envVars.map((e, i) => <Badge key={i} tone="amber">{e}</Badge>)}</div>
              </Panel>
            )}
            {dv.dockerNotes && <KeyVal label="Docker" value={dv.dockerNotes} />}
            {safeArr(dv.ciSteps).length > 0 && <Panel title="CI steps"><List items={dv.ciSteps} /></Panel>}
            {safeArr(dv.deploymentSteps).length > 0 && <Panel title="Deployment steps"><NumberedSteps items={dv.deploymentSteps} /></Panel>}
            {dv.healthCheck && <KeyVal label="Health check" value={dv.healthCheck} />}
            {safeArr(dv.commonDeploymentErrors).length > 0 && <Panel title="Common deployment errors"><List items={dv.commonDeploymentErrors} tone="rose" /></Panel>}
            {dv.secretHandling && <KeyVal label="Secrets" value={dv.secretHandling} />}
          </div>
        </Collapsible>
      )}
    </div>
  );
}

/* ---------------- section: Tasks (3-pane build console) ---------------- */
function TaskDetail({ task, onToggle }) {
  if (!task) return <EmptyState icon={ListChecks} title="Select a task" hint="Pick a task from the list to see exact files, commands, validation and the commit to make." />;
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-fg">{task.title}</h3>
          {task.taskType && <Badge tone={TYPE_TONE[task.taskType] || 'default'}>{String(task.taskType).replace(/_/g, ' ')}</Badge>}
          {task.objective && <p className="mt-1 text-[13px] leading-relaxed text-fg-secondary">{task.objective}</p>}
        </div>
        <Button size="sm" variant={task.status === 'done' ? 'soft' : 'primary'} onClick={() => onToggle(task.id, task.status !== 'done')} className="shrink-0">
          {task.status === 'done' ? <><CheckCircle2 size={14} /> Done</> : <><Circle size={14} /> Mark done</>}
        </Button>
      </div>
      {safeArr(task.filesToCreate).length > 0 && <Panel title="Files to create" icon={FileText}><List items={task.filesToCreate} /></Panel>}
      {safeArr(task.filesToEdit).length > 0 && <Panel title="Files to edit" icon={FileText}><List items={task.filesToEdit} /></Panel>}
      {safeArr(task.commands).length > 0 && <Panel title="Commands" icon={Terminal}><CodeBlock lines={task.commands} /></Panel>}
      {safeArr(task.implementationSteps).length > 0 && <Panel title="Implementation" icon={ListChecks}><NumberedSteps items={task.implementationSteps} /></Panel>}
      {/* v3 code-level guidance */}
      <CodeLevelSections guide={task.codeLevelGuide} />
      {safeArr(task.expectedOutput).length > 0 && <Panel title="Expected output" icon={CheckCircle2}><List items={task.expectedOutput} tone="mint" /></Panel>}
      {safeArr(task.validationSteps).length > 0 && <Panel title="Validation" icon={ShieldCheck}><List items={task.validationSteps} /></Panel>}
      {safeArr(task.commonErrors).length > 0 && <Panel title="Common errors" icon={AlertTriangle}><List items={task.commonErrors} tone="rose" /></Panel>}
      {task.commitMessage && (
        <Panel title="Commit" icon={GitBranch} action={<CopyBtn text={`git commit -m "${task.commitMessage}"`} />}>
          <CodeBlock lines={[`git commit -m "${task.commitMessage}"`]} />
        </Panel>
      )}
      {safeArr(task.completionCriteria).length > 0 && <Panel title="Done when" icon={CheckCircle2}><List items={task.completionCriteria} tone="mint" /></Panel>}
    </div>
  );
}

function TasksSection({ guide, activeStageId, onPickStage, activeTaskId, onPickTask, onToggleTask, onToggleStage, onNextTask }) {
  const stages = safeArr(guide.stages);
  if (!stages.length) return <EmptyState icon={Layers} title="No build steps yet" hint="Generate the guide to see step-by-step tasks." />;
  const stage = stages.find((s) => s.id === activeStageId) || stages[0];
  const tasks = safeArr(stage.tasks);
  const task = tasks.find((t) => t.id === activeTaskId) || tasks[0] || null;
  const stageTasksDone = tasks.length > 0 && tasks.every((t) => t.status === 'done');

  return (
    <div className="grid gap-3 lg:grid-cols-[200px_minmax(0,1fr)_minmax(0,1.4fr)]">
      {/* left: stages */}
      <div className="space-y-1.5">
        <div className="px-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Stages</div>
        {stages.map((s, i) => {
          const t = safeArr(s.tasks);
          const d = t.filter((x) => x.status === 'done').length;
          const isActive = s.id === stage.id;
          return (
            <button key={s.id} onClick={() => onPickStage(s.id)} className={`block w-full rounded-lg px-2.5 py-2 text-left text-[12px] transition ${isActive ? 'bg-aurora-violet/15 text-fg ring-1 ring-aurora-violet/40' : 'text-fg-secondary hover:bg-surface-1'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 truncate">{s.status === 'done' ? <CheckCircle2 size={12} className="shrink-0 text-aurora-mint" /> : <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-surface-2 text-[9px]">{i + 1}</span>}<span className="truncate">{s.title}</span></span>
                <span className="shrink-0 text-[10px] text-fg-muted">{d}/{t.length}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* center: tasks of the active stage */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-fg">{stage.title}</div>
            <div className="truncate text-[11px] text-fg-muted">{stage.goal}</div>
          </div>
          <Button size="sm" variant="soft" onClick={() => onToggleStage(stage, !stageTasksDone)} className="shrink-0">
            {stageTasksDone ? <><CheckCircle2 size={13} className="text-aurora-mint" /> Stage done</> : 'Complete stage'}
          </Button>
        </div>
        {tasks.length ? tasks.map((t) => {
          const isActive = task && t.id === task.id;
          return (
            <div key={t.id} className={`flex items-start gap-2.5 rounded-xl border p-3 transition ${isActive ? 'border-aurora-violet/40 bg-aurora-violet/[0.06]' : 'border-subtle bg-surface-1 hover:border-strong'}`}>
              <button onClick={() => onToggleTask(t.id, t.status !== 'done')} className="mt-0.5 shrink-0 text-fg-secondary hover:text-aurora-mint" aria-label="toggle task">
                {t.status === 'done' ? <CheckCircle2 size={17} className="text-aurora-mint" /> : <Circle size={17} />}
              </button>
              <button onClick={() => onPickTask(t.id)} className="min-w-0 flex-1 text-left">
                <div className={`text-[13px] font-medium ${t.status === 'done' ? 'text-fg-secondary line-through' : 'text-fg'}`}>{t.title}</div>
                {t.objective && <div className="truncate text-[11px] text-fg-muted">{t.objective}</div>}
              </button>
            </div>
          );
        }) : <EmptyState icon={ListChecks} title="No tasks in this stage" hint="Other stages still have steps to complete." />}
        <Button size="sm" variant="outline" className="w-full" onClick={onNextTask}><ChevronRight size={14} /> Next task</Button>
      </div>

      {/* right: task detail */}
      <div className="rounded-2xl border border-subtle bg-surface-1 p-3.5">
        <TaskDetail task={task} onToggle={onToggleTask} />
      </div>
    </div>
  );
}

/* ---------------- section: Testing ---------------- */
function TestingSection({ guide }) {
  const t = guide.testingGuide || {};
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel title="Unit tests" icon={FlaskConical}><List items={t.unitTests} /></Panel>
        <Panel title="Integration / E2E" icon={FlaskConical}><List items={t.integrationTests} /></Panel>
      </div>
      <Panel title="Manual tests" icon={ListChecks}><List items={t.manualTests} /></Panel>
      {safeArr(t.commands).length > 0 && <Panel title="Commands" icon={Terminal}><CodeBlock lines={t.commands} /></Panel>}
      <Panel title="Expected results" icon={CheckCircle2}><List items={t.expectedResults} tone="mint" /></Panel>
    </div>
  );
}

/* ---------------- section: Deployment ---------------- */
function DeploymentSection({ guide }) {
  const d = guide.deploymentGuide || {};
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel title="Target" icon={UploadCloud}><p className="text-[13px] text-fg-secondary">{d.target || '—'}</p></Panel>
        <Panel title="Services" icon={Boxes}><List items={d.services} /></Panel>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel title="Build command" icon={Terminal}><CodeBlock lines={d.buildCommand ? [d.buildCommand] : []} /></Panel>
        <Panel title="Start command" icon={Terminal}><CodeBlock lines={d.startCommand ? [d.startCommand] : []} /></Panel>
      </div>
      {safeArr(d.environmentVariables).length > 0 && <Panel title="Environment variables" icon={Boxes}><div className="flex flex-wrap gap-1.5">{d.environmentVariables.map((e, i) => <Badge key={i} tone="cyan">{e}</Badge>)}</div></Panel>}
      {d.healthCheckUrl && <Panel title="Health check" icon={ShieldCheck}><code className="rounded-md bg-base/70 px-2 py-1 text-[12px] text-fg-secondary">{d.healthCheckUrl}</code></Panel>}
      <Panel title="Deployment steps" icon={ListChecks}><NumberedSteps items={d.deploymentSteps} /></Panel>
      {safeArr(d.commonDeploymentErrors).length > 0 && <Panel title="Common deployment errors" icon={AlertTriangle}><List items={d.commonDeploymentErrors} tone="rose" /></Panel>}
    </div>
  );
}

/* ---------------- section: GitHub commit plan ---------------- */
function GithubSection({ guide }) {
  const g = guide.githubPlan || {};
  const commits = safeArr(g.commits);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel title="Repository name" icon={GitBranch}>
          <div className="flex items-center gap-2"><code className="rounded-md bg-base/70 px-2 py-1 text-[12px] text-fg-secondary">{g.repoName || '—'}</code>{g.repoName && <CopyBtn text={g.repoName} />}</div>
        </Panel>
        <Panel title="Branch strategy" icon={GitBranch}><p className="text-[12.5px] leading-relaxed text-fg-secondary">{g.branchStrategy || '—'}</p></Panel>
      </div>
      <Panel title="Commit plan" icon={GitBranch}>
        {commits.length ? (
          <div className="space-y-2">
            {commits.map((c, i) => (
              <div key={i} className="rounded-lg border border-subtle bg-surface-1 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <code className="truncate text-[12px] text-aurora-cyan">git commit -m &quot;{c.message}&quot;</code>
                  <CopyBtn text={`git commit -m "${c.message}"`} />
                </div>
                <div className="mt-1 text-[11px] text-fg-muted">{c.stage}{safeArr(c.filesIncluded).length ? ` · ${c.filesIncluded.join(', ')}` : ''}</div>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-fg-muted">—</p>}
      </Panel>
      {safeArr(g.suggestedIssues).length > 0 && (
        <Panel title="Suggested GitHub issues" icon={ListChecks} action={<span className="text-[10px] text-fg-muted">optional — no GitHub integration required</span>}>
          <List items={g.suggestedIssues} />
        </Panel>
      )}
    </div>
  );
}

/* ---------------- section: Proof submission ---------------- */
function ProofSection({ guide, onOpenWorkspace }) {
  const p = guide.proofSubmission || {};
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-glow/25 bg-amber-glow/5 p-3.5 text-[12.5px] leading-relaxed text-amber-100">
        <AlertTriangle size={14} className="mr-1.5 inline" /> Completing build tasks is <span className="font-medium">not</span> the same as verified proof. To get a verified project + resume bullets, attach real evidence in the Project Workspace.
        {onOpenWorkspace && <Button size="sm" variant="soft" className="ml-2 mt-2" onClick={onOpenWorkspace}><ShieldCheck size={13} /> Open Workspace to submit proof</Button>}
      </div>
      <Panel title="Required evidence" icon={ShieldCheck}><List items={p.requiredEvidence} /></Panel>
      <Panel title="Optional evidence" icon={ListChecks}><List items={p.optionalEvidence} /></Panel>
      <Panel title="Verification checklist" icon={CheckCircle2}><List items={p.verificationChecklist} tone="mint" /></Panel>
      <Panel title="Resume bullet unlock conditions" icon={FileText}><List items={p.resumeUnlockConditions} /></Panel>
    </div>
  );
}

/* ---------------- section: Export ---------------- */
function ExportSection({ guide }) {
  const [copied, setCopied] = useState(false);
  const md = useMemo(() => buildGuideToMarkdown(guide), [guide]);
  const slug = (guide.githubPlan?.repoName || 'build-guide');
  const copyMd = () => { try { navigator.clipboard?.writeText(md); } catch { /* noop */ } setCopied(true); setTimeout(() => setCopied(false), 1600); };
  return (
    <div className="space-y-3">
      <Panel title="Export your build guide" icon={Download}>
        <p className="mb-3 text-[12.5px] leading-relaxed text-fg-secondary">Take the full guide anywhere — paste it into your repo, a doc, or your notes. JSON is handy for tooling.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => downloadText(`${slug}-build-guide.md`, md, 'text/markdown')}><FileText size={14} /> Download Markdown</Button>
          <Button size="sm" variant="soft" onClick={copyMd}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy Markdown'}</Button>
          <Button size="sm" variant="outline" onClick={() => downloadText(`${slug}-build-guide.json`, JSON.stringify(guide, null, 2), 'application/json')}><FileJson size={14} /> Download JSON</Button>
        </div>
      </Panel>
      <Panel title="Markdown preview" icon={FileText}>
        <pre className="max-h-80 overflow-auto rounded-lg border border-subtle bg-base/70 p-3 text-[11px] leading-relaxed text-fg-secondary whitespace-pre-wrap">{md.slice(0, 4000)}{md.length > 4000 ? '\n…' : ''}</pre>
      </Panel>
    </div>
  );
}

/* ---------------- main view ---------------- */
const SECTIONS = [
  ['overview', 'Overview', Rocket],
  ['prereqs', 'Prerequisites', Wrench],
  ['setup', 'Local Setup', FolderTree],
  ['roadmap', 'Roadmap', Layers],
  ['tasks', 'Step-by-Step', ListChecks],
  ['testing', 'Testing', FlaskConical],
  ['deploy', 'Deployment', UploadCloud],
  ['github', 'GitHub Plan', GitBranch],
  ['proof', 'Proof', ShieldCheck],
  ['export', 'Export', Download],
];

export default function ProjectBuilder({ go, projectId, project: projectProp }) {
  const [project, setProject] = useState(() => projectProp || (projectId ? getProject(projectId) : null));
  const [progress, setProgress] = useState(() => (projectProp?.buildProgress) || (project?.buildProgress) || null);
  const [section, setSection] = useState('tasks');
  const [activeStageId, setActiveStageId] = useState(null);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [loading, setLoading] = useState(false);

  // Re-resolve the project if the id changes (deep-link / navigation).
  useEffect(() => {
    if (projectProp) { setProject(projectProp); setProgress(projectProp.buildProgress || null); return; }
    if (projectId) {
      setLoading(true);
      const p = getProject(projectId);
      setProject(p);
      setProgress(p?.buildProgress || null);
      setLoading(false);
    }
  }, [projectId, projectProp]);

  // The guide is generated deterministically from the project + saved progress.
  const guide = useMemo(() => (project ? generateBuildGuide(project, { progress }) : null), [project, progress]);

  // Default the active stage to the current (first incomplete) stage.
  useEffect(() => {
    if (!guide) return;
    if (!activeStageId) setActiveStageId(guide.currentStageId || (guide.stages[0] && guide.stages[0].id));
  }, [guide, activeStageId]);

  const persist = (nextProgress) => {
    setProgress(nextProgress);
    if (project) {
      try { saveProject({ ...project, buildProgress: nextProgress }); } catch { /* persistence best-effort */ }
    }
  };

  const toggleTask = (taskId, done) => persist(setTaskProgress(progress, taskId, done));
  const togglePrereq = (name, done) => persist(setPrerequisiteProgress(progress, name, done));
  const toggleStage = (stage, done) => persist(setStageProgress(progress, stage.id, done, safeArr(stage.tasks).map((t) => t.id)));

  const nextTask = () => {
    if (!guide) return;
    const flat = [];
    for (const s of guide.stages) for (const t of safeArr(s.tasks)) flat.push({ s, t });
    const next = flat.find((x) => x.t.status !== 'done') || flat[0];
    if (next) { setActiveStageId(next.s.id); setActiveTaskId(next.t.id); setSection('tasks'); }
  };

  const openWorkspace = () => { try { go?.('projectstudio', { openProjectId: project?.id }); } catch { go?.('projectstudio'); } };

  if (loading) return <div className="space-y-3"><Skeleton className="h-28 w-full" /><Skeleton className="h-64 w-full" /></div>;

  if (!project) {
    return (
      <>
        <PageIntro title="Project Builder" sub="Build a project step by step, from setup to proof." />
        <SectionCard title="Project not found">
          <EmptyState
            icon={AlertTriangle}
            title="We couldn't load this project"
            hint="It may have been deleted, or you opened a stale link. Head back to the Studio to pick a project and start building."
            action={<Button onClick={() => go?.('projectstudio')}><ArrowLeft size={15} /> Back to Project Studio</Button>}
          />
        </SectionCard>
      </>
    );
  }

  const p = guide;

  return (
    <div className="space-y-4">
      {/* back + title */}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={openWorkspace}><ArrowLeft size={15} /> Workspace</Button>
        <span className="text-fg-muted">/</span>
        <span className="text-sm text-fg-secondary">Builder Mode</span>
      </div>

      {/* header card */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="gradient-border p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-aurora-violet"><Rocket size={13} /> Build Overview</div>
            <h1 className="mt-1 truncate text-xl font-semibold text-fg">{p.title}</h1>
            <p className="mt-1 line-clamp-2 max-w-2xl text-[13px] leading-relaxed text-fg-secondary">{p.summary}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Badge tone="violet"><Target size={11} /> {p.targetRole}</Badge>
              <Badge tone="amber"><Gauge size={11} /> {p.difficulty}</Badge>
              <Badge tone="cyan"><Clock size={11} /> {p.estimatedDuration}</Badge>
              <Badge tone="mint">{p.type}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {p.architectureBacked
                ? <Badge tone="mint"><Boxes size={11} /> Architecture-backed guide</Badge>
                : <Badge tone="default"><ListChecks size={11} /> Pattern / context guide</Badge>}
              {p.pattern && <Badge tone="violet">Pattern detected: {p.pattern.label}</Badge>}
              {p.confidence && <Badge tone={p.confidence === 'High' ? 'mint' : p.confidence === 'Medium' ? 'cyan' : 'amber'}>Confidence: {p.confidence}</Badge>}
            </div>
            {safeArr(p.generatedFrom).length > 0 && (
              <p className="mt-1.5 text-[11px] text-fg-muted">Generated from: {p.generatedFrom.join(' + ')} · Code-level guide confidence: {p.codeLevelConfidence || p.confidence || 'Medium'}</p>
            )}
          </div>
          <div className="shrink-0 lg:w-72">
            <div className="rounded-2xl border border-subtle bg-surface-1 p-4">
              <div className="flex items-end justify-between">
                <span className="text-[11px] uppercase tracking-wide text-fg-muted">Build progress</span>
                <span className="text-2xl font-semibold text-fg">{p.progressPercent}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-1"><div className="h-full rounded-full bg-aurora-cta transition-all" style={{ width: `${p.progressPercent}%` }} /></div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-fg-muted">
                <span>Stage: {p.currentStage}</span>
                <span>{p.progress?.completedTasks || 0}/{p.progress?.totalTasks || 0} tasks</span>
              </div>
              <div className="mt-3 rounded-lg border border-aurora-cta/30 bg-aurora-cta/5 px-2.5 py-2 text-[12px] leading-snug text-fg">{p.nextAction}</div>
              <Button size="sm" className="mt-3 w-full" onClick={nextTask}><ChevronRight size={14} /> Go to next task</Button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* section nav */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {SECTIONS.map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-medium transition ${section === id ? 'bg-aurora-violet/15 text-fg ring-1 ring-aurora-violet/40' : 'bg-surface-1 text-fg-secondary hover:bg-surface-1'}`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* section body */}
      <SectionCard title={(SECTIONS.find((s) => s[0] === section) || [])[1] || 'Builder'}>
        {section === 'overview' && <OverviewSection guide={p} />}
        {section === 'prereqs' && <PrerequisitesSection guide={p} onToggle={togglePrereq} />}
        {section === 'setup' && <SetupSection guide={p} />}
        {section === 'roadmap' && <RoadmapSection guide={p} onJump={(id) => { setActiveStageId(id); setActiveTaskId(null); setSection('tasks'); }} />}
        {section === 'tasks' && (
          <TasksSection
            guide={p}
            activeStageId={activeStageId}
            onPickStage={(id) => { setActiveStageId(id); setActiveTaskId(null); }}
            activeTaskId={activeTaskId}
            onPickTask={setActiveTaskId}
            onToggleTask={toggleTask}
            onToggleStage={toggleStage}
            onNextTask={nextTask}
          />
        )}
        {section === 'testing' && <TestingSection guide={p} />}
        {section === 'deploy' && <DeploymentSection guide={p} />}
        {section === 'github' && <GithubSection guide={p} />}
        {section === 'proof' && <ProofSection guide={p} onOpenWorkspace={openWorkspace} />}
        {section === 'export' && <ExportSection guide={p} />}
      </SectionCard>
    </div>
  );
}
