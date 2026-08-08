import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Check, Circle, Play, Terminal, FileCode,
  Lightbulb, Compass, Wrench, Bot, GraduationCap, Copy, CheckCheck,
  ListChecks, PartyPopper, Lock, FolderGit2, Rocket,
} from 'lucide-react';
import { Card, Button, Badge, Spinner, EmptyState } from '../ui/kit.jsx';
import WorkspaceApi from '../../lib/workspaceApi.js';
import { STATUS_TONE } from '../../lib/workspaceSelectors.js';

/* ============================================================
   GUIDED PATH — the default, beginner-first build experience.
   ------------------------------------------------------------
   Renders ONE task at a time as a full journey (why → open files →
   do the numbered TODOs → run → check yourself → hints ladder →
   AI pair prompt → what you learned), over the SAME guide the
   starter pack embeds (server: planGuide). The 12-section board
   still exists as "Blueprint"; this is what a first-year sees first.
   ============================================================ */

const PHASE_ICON = { setup: Rocket, backend: Terminal, frontend: FileCode, features: Wrench, quality: ListChecks, launch: Rocket };

function CopyButton({ text, label = 'Copy', copiedLabel = 'Copied' }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="soft" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); } catch { /* noop */ }
    }}>
      {done ? <><CheckCheck size={13} /> {copiedLabel}</> : <><Copy size={13} /> {label}</>}
    </Button>
  );
}

function Hint({ icon: Icon, title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-subtle bg-surface-1">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] font-medium text-fg">
        <Icon size={15} className="text-aurora-cyan" /> {title}
        <ChevronRight size={14} className={`ml-auto text-fg-muted transition ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="border-t border-subtle px-3.5 py-3 text-[13px] leading-relaxed text-fg-secondary [&_code]:rounded [&_code]:bg-surface-1 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px]">{children}</div>}
    </div>
  );
}

/* Minimal, safe markdown-ish renderer for hint bodies (bold, inline code,
   fenced code). No HTML injection — plain text nodes only. */
function RichText({ text = '' }) {
  const blocks = String(text).split(/```/);
  return (
    <>
      {blocks.map((block, i) => {
        if (i % 2 === 1) {
          const body = block.replace(/^\w*\n/, '');
          return <pre key={i} className="my-2 overflow-x-auto rounded-lg bg-base/70 p-3 text-[12px] leading-relaxed text-fg"><code>{body}</code></pre>;
        }
        return <span key={i}>{block.split('\n').map((line, j) => <span key={j}>{renderInline(line)}<br /></span>)}</span>;
      })}
    </>
  );
}
function renderInline(line) {
  const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (/^`[^`]+`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>;
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} className="text-fg">{p.slice(2, -2)}</strong>;
    return p;
  });
}

function StepRail({ entries, statusById, activeIdx, onPick }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-2">
      {entries.map((e, i) => {
        const st = statusById[e.taskId] || 'backlog';
        const done = st === 'done' || st === 'verified';
        return (
          <button key={e.taskId} onClick={() => onPick(i)} title={`${e.no}. ${e.title}`}
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-[11px] font-semibold transition ${
              i === activeIdx ? 'border-aurora-violet bg-aurora-violet/20 text-fg'
                : done ? 'border-aurora-mint/40 bg-aurora-mint/10 text-aurora-mint'
                : 'border-subtle text-fg-secondary hover:border-strong'}`}>
            {done ? <Check size={13} /> : e.no}
          </button>
        );
      })}
    </div>
  );
}

export default function GuidedPath({ plan, project, onTaskPatch, onPreviewCode, onOpenBlueprint }) {
  const [guide, setGuide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [idx, setIdx] = useState(0);

  const statusById = useMemo(() => {
    const m = {};
    for (const t of plan?.tasks || []) m[t.id] = t.status;
    return m;
  }, [plan]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    WorkspaceApi.guide(plan)
      .then((r) => { if (alive) { setGuide(r.guide); } })
      .catch((e) => { if (alive) setError(e?.message || 'Could not load the guided path.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [plan]); // refetch when the plan changes (e.g. regeneration)

  // Land the student on their first unfinished step.
  useEffect(() => {
    if (!guide?.entries?.length) return;
    const firstOpen = guide.entries.findIndex((e) => {
      const st = statusById[e.taskId];
      return st !== 'done' && st !== 'verified';
    });
    setIdx(firstOpen === -1 ? guide.entries.length - 1 : firstOpen);
  }, [guide, statusById]);

  if (loading) return <div className="flex items-center gap-2 py-16 text-sm text-fg-secondary"><Spinner /> Building your step-by-step path…</div>;
  if (error) return <EmptyState icon={Compass} title="Couldn’t load the guided path" hint={error} />;
  if (!guide?.entries?.length) return <EmptyState icon={Compass} title="No steps yet" hint="Generate the workspace plan first, then your guided path appears here." />;

  const entries = guide.entries;
  const e = entries[idx];
  const status = statusById[e.taskId] || 'backlog';
  const isDone = status === 'done' || status === 'verified';
  const doneCount = entries.filter((x) => ['done', 'verified'].includes(statusById[x.taskId])).length;
  const pct = Math.round((doneCount / entries.length) * 100);
  const PhaseIcon = PHASE_ICON[e.phase] || Circle;

  const markDone = () => onTaskPatch?.(e.taskId, { status: isDone ? 'ready' : 'done' });
  const go = (d) => setIdx((i) => Math.max(0, Math.min(entries.length - 1, i + d)));

  return (
    <div className="space-y-4">
      {/* progress header */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Your build · step by step</p>
            <p className="mt-0.5 text-[15px] font-semibold text-fg">{doneCount} of {entries.length} tasks done · {pct}%</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onOpenBlueprint}>
            <FileCode size={13} /> Open Blueprint (advanced)
          </Button>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-1">
          <div className="h-full rounded-full bg-gradient-to-r from-aurora-violet to-aurora-cyan transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-3"><StepRail entries={entries} statusById={statusById} activeIdx={idx} onPick={setIdx} /></div>
      </Card>

      {/* the step */}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-secondary">
          <PhaseIcon size={14} className="text-aurora-cyan" />
          <span className="uppercase tracking-wider">{e.phaseTitle}</span>
          {e.estimatedHours ? <><span>·</span><span>~{e.estimatedHours}h</span></> : null}
          <Badge tone={STATUS_TONE[status] || 'default'} className="ml-1">{status.replace('_', ' ')}</Badge>
          {e.proofRequired && <Badge tone="violet">proof required</Badge>}
          <span className="ml-auto font-mono text-fg-muted">Task {e.no} / {String(entries.length).padStart(2, '0')}</span>
        </div>

        <h2 className="mt-2 font-display text-xl font-semibold text-fg">{e.title}</h2>

        {/* why */}
        <div className="mt-3 rounded-xl border border-aurora-cyan/20 bg-aurora-cyan/[0.05] p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-aurora-cyan">Why this matters</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-fg">{e.why}</p>
        </div>

        {/* files */}
        {e.files.length > 0 && (
          <section className="mt-4">
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-fg"><FolderGit2 size={15} className="text-fg-secondary" /> Open these files</p>
            <div className="space-y-1.5">
              {e.files.map((f) => (
                <div key={f.path} className="flex items-center gap-2 rounded-lg border border-subtle bg-surface-1 px-3 py-2">
                  <FileCode size={14} className="shrink-0 text-fg-muted" />
                  <code className="min-w-0 flex-1 truncate text-[12px] text-fg-secondary">{f.path}</code>
                  <Badge tone={f.action === 'edit' ? 'cyan' : 'amber'}>{f.action === 'edit' ? 'edit' : 'create'}</Badge>
                  {f.templateKey && onPreviewCode && (
                    <Button size="sm" variant="ghost" onClick={() => onPreviewCode({ filePath: f.path, templateKey: f.templateKey })}>View starter</Button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* do this */}
        <section className="mt-4">
          <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-fg"><ListChecks size={15} className="text-fg-secondary" /> Do this</p>
          <ol className="space-y-2">
            {e.steps.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed text-fg-secondary">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-1 text-[11px] font-semibold text-fg-secondary">{i + 1}</span>
                <span>{renderInline(s)}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* run */}
        {e.run?.length > 0 && (
          <section className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-fg"><Terminal size={15} className="text-fg-secondary" /> Run this</p>
              <CopyButton text={e.run.join('\n')} label="Copy commands" />
            </div>
            <pre className="overflow-x-auto rounded-xl bg-base/70 p-3.5 text-[12.5px] leading-relaxed text-aurora-mint"><code>{e.run.map((c) => `$ ${c}`).join('\n')}</code></pre>
          </section>
        )}

        {/* check yourself */}
        <section className="mt-4">
          <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-fg"><Check size={15} className="text-fg-secondary" /> Check yourself</p>
          <div className="flex items-center justify-between rounded-lg border border-subtle bg-surface-1 px-3 py-2">
            <code className="text-[12px] text-fg-secondary">{e.check.command}</code>
            <CopyButton text={e.check.command} label="Copy" />
          </div>
          <ul className="mt-2 space-y-1.5">
            {e.check.criteria.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] text-fg-secondary">
                <Circle size={13} className="mt-0.5 shrink-0 text-fg-muted" /> {c}
              </li>
            ))}
          </ul>
        </section>

        {/* hints ladder */}
        <section className="mt-4 space-y-2">
          <p className="text-[13px] font-semibold text-fg">Stuck? Open hints one at a time</p>
          <Hint icon={Lightbulb} title="Hint 1 — the concept"><RichText text={e.hints.concept} /></Hint>
          <Hint icon={Compass} title="Hint 2 — a nudge"><RichText text={e.hints.nudge} /></Hint>
          <Hint icon={Wrench} title="Hint 3 — a worked example"><RichText text={e.hints.example} /></Hint>
        </section>

        {/* AI pair */}
        <section className="mt-4 rounded-xl border border-aurora-violet/25 bg-aurora-violet/[0.06] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-fg"><Bot size={16} className="text-aurora-violet" /> Your AI pair for this task</p>
            <CopyButton text={e.aiPrompt} label="Copy AI prompt" copiedLabel="Copied — paste into ChatGPT" />
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg-secondary">
            Paste this into ChatGPT, Claude, or Gemini. It turns any chatbot into a tutor that knows your exact task, files and goal — and it’s told to teach you, not hand you the answer.
          </p>
        </section>

        {/* learned */}
        <section className="mt-4 rounded-xl border border-subtle bg-surface-1 p-4">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-fg"><GraduationCap size={15} className="text-aurora-mint" /> What you’ll have learned</p>
          <ul className="mt-2 space-y-1">
            {e.learn.map((l, i) => <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-fg-secondary"><Check size={13} className="mt-0.5 shrink-0 text-aurora-mint" /> {l}</li>)}
          </ul>
        </section>

        {/* mark done + nav */}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-subtle pt-4">
          <Button variant={isDone ? 'soft' : 'primary'} onClick={markDone}>
            {isDone ? <><Check size={14} /> Done — tap to reopen</> : <><Check size={14} /> Mark this task done</>}
          </Button>
          <span className="text-[11.5px] text-fg-muted">Done ≠ Verified — the platform verifies from your repo, tests & deploy.</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" disabled={idx === 0} onClick={() => go(-1)}><ChevronLeft size={14} /> Prev</Button>
            <Button size="sm" variant="ghost" disabled={idx === entries.length - 1} onClick={() => go(1)}>Next <ChevronRight size={14} /></Button>
          </div>
        </div>
      </Card>

      {/* finish state */}
      {doneCount === entries.length && (
        <Card className="flex items-center gap-3 border-aurora-mint/30 bg-aurora-mint/[0.06] p-4">
          <PartyPopper size={20} className="text-aurora-mint" />
          <p className="text-[13.5px] text-fg">Every task is done. Now push your repo, deploy it, and submit proof — the platform verifies from that evidence, and a short viva confirms you can explain what you built.</p>
        </Card>
      )}
    </div>
  );
}
