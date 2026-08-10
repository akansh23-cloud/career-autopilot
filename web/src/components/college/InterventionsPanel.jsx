/* ============================================================
   Interventions
   ------------------------------------------------------------
   Assigning work was already implemented end to end — /api/college/tasks
   creates real assignments and fires real notifications. What was missing
   was the other half: nothing in the UI ever called GET /api/college/tasks,
   so a placement cell could send work out and had no way to learn whether
   any of it came back.

   This panel closes that loop. Completion rate per task, overdue
   detection, and a cohort roll-up — plus the targeted nudge that used to
   be a grey "placeholder" chip on the Reports tab despite being fully
   built on the server.
   ============================================================ */
import { Fragment, useEffect, useState } from 'react';
import {
  ClipboardList, Bell, AlertTriangle, CheckCircle2, Clock, Plus, Send, RefreshCw, Users,
  ChevronRight, ChevronDown, CircleDashed,
} from 'lucide-react';
import { SectionCard, StatCard } from '../../views/common.jsx';
import { Button, Badge, Spinner, EmptyState, Input, Field, Modal } from '../ui/kit.jsx';
import { College } from '../../lib/api.js';

/* Audience presets. Each one maps to a filter the directory already supports,
   so "everyone without a resume" is a real query, not an approximation. */
const AUDIENCES = [
  { id: 'all', label: 'Everyone', hint: 'the whole cohort', filter: {} },
  { id: 'no_resume', label: 'No resume on file', hint: 'nothing to score yet', filter: {}, post: (s) => s.resumeScore == null },
  { id: 'no_verified', label: 'No verified project', hint: 'nothing recruiters can trust', filter: {}, post: (s) => !(s.verifiedProjects > 0) },
  { id: 'low_readiness', label: 'Readiness under 50', hint: 'furthest from ready', filter: {}, post: (s) => Number(s.readinessScore || 0) < 50 },
  { id: 'nearly_ready', label: 'Readiness 50–69', hint: 'closest to the line', filter: {}, post: (s) => Number(s.readinessScore || 0) >= 50 && Number(s.readinessScore || 0) < 70 },
];

function ProgressBar({ pct, overdue }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-1">
        <div
          className={`h-full rounded-full ${overdue ? 'bg-amber-glow' : 'bg-aurora-mint'}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <span className="w-9 text-right text-sm text-fg-secondary">{pct}%</span>
    </div>
  );
}

/* ============================================================
   TASK ASSIGNEES — who this task went to, and who actually did it
   ------------------------------------------------------------
   The table above reports "4 assigned, 0 done" and stops there. A
   placement officer's next question is always WHICH four, so they
   can chase the three who have not started. The per-student rows
   were already on the task document; nothing ever read them back.

   Loaded lazily on expand — a cohort task can carry 500
   assignments and there is no reason to ship them all up front.
   ============================================================ */
function AssigneeRoster({ taskId }) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [showDone, setShowDone] = useState(true);

  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: '', data: null });
    College.taskAssignees(taskId)
      .then((r) => { if (alive) setState({ loading: false, error: '', data: r }); })
      .catch((e) => { if (alive) setState({ loading: false, error: e?.message || 'Could not load assignees.', data: null }); });
    return () => { alive = false; };
  }, [taskId]);

  if (state.loading) return <div className="flex items-center gap-2 px-2 py-3 text-xs text-fg-muted"><Spinner /> Loading assignees…</div>;
  if (state.error) return <div className="px-2 py-3 text-xs text-danger">{state.error}</div>;

  const all = state.data?.assignees || [];
  const rows = showDone ? all : all.filter((a) => !a.done);
  if (!all.length) return <div className="px-2 py-3 text-xs text-fg-muted">No assignees on this task.</div>;

  return (
    <div className="rounded-lg border border-subtle bg-surface-1 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-fg-muted">
          {state.data.done} of {state.data.assigned} completed
          {state.data.overdue > 0 && <span className="ml-2 text-danger">{state.data.overdue} overdue</span>}
        </span>
        <Button size="sm" variant="ghost" onClick={() => setShowDone((v) => !v)}>
          {showDone ? 'Show only pending' : 'Show everyone'}
        </Button>
      </div>
      <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {rows.map((a) => (
          <li key={a.studentId} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-surface-hover">
            <span className="flex min-w-0 items-center gap-2">
              {a.done
                ? <CheckCircle2 size={13} className="shrink-0 text-ok" />
                : <CircleDashed size={13} className={`shrink-0 ${a.overdue ? 'text-danger' : 'text-fg-muted'}`} />}
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-fg">{a.name || a.email}</span>
                <span className="block truncate text-[11px] text-fg-muted">
                  {[a.branch, a.batch].filter(Boolean).join(' · ') || a.email}
                </span>
              </span>
            </span>
            <span className="shrink-0 text-[11px]">
              {a.done
                ? <span className="text-ok">Done{a.doneAt ? ` · ${new Date(a.doneAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}</span>
                : <span className={a.overdue ? 'text-danger' : 'text-fg-muted'}>{a.overdue ? 'Overdue' : 'Pending'}</span>}
            </span>
          </li>
        ))}
      </ul>
      {!rows.length && <p className="px-2 py-2 text-xs text-ok">Everyone has completed this task.</p>}
    </div>
  );
}

export default function InterventionsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const [taskOpen, setTaskOpen] = useState(false);
  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [audience, setAudience] = useState('all');
  const [form, setForm] = useState({ title: '', description: '', dueAt: '' });
  const [nudge, setNudge] = useState({ title: '', message: '' });
  const [resolved, setResolved] = useState({ count: 0, loading: false });
  const [expanded, setExpanded] = useState(null); // task id whose assignee roster is open

  const load = async () => {
    setLoading(true); setError('');
    try { setData(await College.tasks()); }
    catch (e) { setError(e?.message || 'Could not load interventions.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  /* Resolve the chosen audience to concrete student ids. Done here rather
     than server-side so the count is shown BEFORE anything is sent — nobody
     should fire a message to an unknown number of students. */
  const resolveAudience = async (audienceId) => {
    setResolved({ count: 0, loading: true });
    try {
      const preset = AUDIENCES.find((a) => a.id === audienceId) || AUDIENCES[0];
      const r = await College.students({ ...preset.filter, limit: 500 });
      const rows = (r?.students || []).filter(preset.post || (() => true));
      setResolved({ count: rows.length, loading: false, ids: rows.map((s) => s.id) });
      return rows.map((s) => s.id);
    } catch {
      setResolved({ count: 0, loading: false, ids: [] });
      return [];
    }
  };

  useEffect(() => {
    if (taskOpen || nudgeOpen) resolveAudience(audience);
    /* The deps are intentionally narrower than the hook body: resolveAudience is
       re-created every render and adding it would refetch the audience on every
       keystroke. The eslint-disable comment that used to sit here referenced
       react-hooks/exhaustive-deps, which this project's flat config never
       registers — so ESLint 9 reported it as a hard error on every lint run. */
  }, [audience, taskOpen, nudgeOpen]);

  const assign = async () => {
    if (!form.title.trim()) return;
    setBusy(true); setStatus('');
    try {
      const ids = resolved.ids?.length ? resolved.ids : await resolveAudience(audience);
      if (!ids.length) { setStatus('That audience matched nobody — nothing was sent.'); setBusy(false); return; }
      const r = await College.assignTask({
        studentIds: ids, title: form.title.trim(),
        description: form.description.trim(), dueAt: form.dueAt || null,
      });
      setStatus(r?.ok
        ? `Assigned to ${r.assigned} student(s). They’ve been notified in-app.`
        : (r?.message || 'Task assignment needs the database.'));
      setForm({ title: '', description: '', dueAt: '' });
      setTaskOpen(false);
      await load();
    } catch (e) { setStatus(e?.message || 'Could not assign the task.'); }
    finally { setBusy(false); }
  };

  const send = async () => {
    setBusy(true); setStatus('');
    try {
      const ids = resolved.ids?.length ? resolved.ids : await resolveAudience(audience);
      if (!ids.length) { setStatus('That audience matched nobody — nothing was sent.'); setBusy(false); return; }
      const r = await College.notify(ids, nudge);
      // The server reports email delivery honestly; surface its message verbatim
      // rather than claiming success the mail transport may not have achieved.
      setStatus(r?.message || (r?.ok ? 'Sent.' : 'Notifications need the database.'));
      setNudge({ title: '', message: '' });
      setNudgeOpen(false);
    } catch (e) { setStatus(e?.message || 'Could not send.'); }
    finally { setBusy(false); }
  };

  const s = data?.summary || {};
  const tasks = data?.tasks || [];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard i={0} icon={ClipboardList} tone="violet" label="Tasks assigned" value={String(s.assigned ?? 0)} hint={`across ${s.tasks ?? 0} task(s)`} />
        <StatCard i={1} icon={CheckCircle2} tone="mint" label="Completed" value={String(s.done ?? 0)} hint={`${s.completionRate ?? 0}% completion rate`} />
        <StatCard i={2} icon={Clock} tone="cyan" label="Still open" value={String(s.pending ?? 0)} />
        <StatCard i={3} icon={AlertTriangle} tone="amber" label="Overdue tasks" value={String(s.overdue ?? 0)} hint={`${s.complete ?? 0} fully complete`} />
      </div>

      <SectionCard
        title="Assigned work"
        eyebrow="Every task, and whether students actually did it"
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="soft" onClick={() => { setNudgeOpen(true); }}><Bell size={13} /> Send nudge</Button>
            <Button size="sm" onClick={() => { setTaskOpen(true); }}><Plus size={13} /> Assign task</Button>
          </div>
        }
      >
        {status && <p className="mb-3 rounded-lg border border-subtle bg-surface-1 px-3 py-2 text-sm text-fg-secondary">{status}</p>}

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted"><Spinner /> Loading interventions…</div>
        ) : error ? (
          <EmptyState icon={AlertTriangle} title="Couldn’t load interventions" hint={error}
            action={<Button size="sm" variant="soft" onClick={load}>Retry</Button>} />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={ClipboardList} title="No tasks assigned yet"
            hint="Assign a task to a targeted group — students get it in their workspace and you get a completion rate back here."
            action={<Button size="sm" onClick={() => setTaskOpen(true)}><Plus size={13} /> Assign the first task</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-2 py-2">Task <span className="normal-case text-fg-muted">— click to see who</span></th>
                  <th className="px-2 py-2 text-right">Assigned</th>
                  <th className="px-2 py-2 text-right">Done</th>
                  <th className="px-2 py-2">Completion</th>
                  <th className="px-2 py-2">Due</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <Fragment key={t.id}>
                  <tr
                    className="cursor-pointer border-t border-subtle hover:bg-surface-1"
                    onClick={() => setExpanded((id) => (id === t.id ? null : t.id))}
                  >
                    <td className="px-2 py-2">
                      <span className="flex items-start gap-1.5">
                        {expanded === t.id
                          ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-fg-muted" />
                          : <ChevronRight size={14} className="mt-0.5 shrink-0 text-fg-muted" />}
                        <span className="min-w-0">
                          <span className="text-fg">{t.title}</span>
                          {t.description && <span className="block max-w-md truncate text-xs text-fg-muted">{t.description}</span>}
                        </span>
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right text-fg-secondary">{t.assigned}</td>
                    <td className="px-2 py-2 text-right text-fg-secondary">{t.done}</td>
                    <td className="px-2 py-2"><ProgressBar pct={t.completionRate} overdue={t.overdue} /></td>
                    <td className="px-2 py-2 text-fg-secondary">
                      {t.dueAt ? new Date(t.dueAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                    </td>
                    <td className="px-2 py-2">
                      {t.status === 'complete' ? <Badge tone="mint">Complete</Badge>
                        : t.overdue ? <Badge tone="amber">{t.daysOverdue}d overdue</Badge>
                          : <Badge tone="cyan">Active</Badge>}
                    </td>
                  </tr>
                  {expanded === t.id && (
                    <tr className="border-t border-subtle bg-surface-1/60">
                      <td colSpan={6} className="px-2 pb-3 pt-1">
                        <AssigneeRoster taskId={t.id} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Assign task */}
      <Modal open={taskOpen} onClose={() => setTaskOpen(false)} title="Assign a task">
        <div className="space-y-3">
          <AudiencePicker value={audience} onChange={setAudience} resolved={resolved} />
          <Field label="Task title *"><Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Upload your latest resume" /></Field>
          <Field label="Details"><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Why it matters and what counts as done" /></Field>
          <Field label="Due date"><Input type="date" value={form.dueAt} onChange={(e) => setForm((f) => ({ ...f, dueAt: e.target.value }))} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="soft" onClick={() => setTaskOpen(false)}>Cancel</Button>
            <Button onClick={assign} disabled={busy || !form.title.trim() || resolved.loading || !resolved.count}>
              {busy ? <Spinner /> : <Send size={14} />} Assign to {resolved.count}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Nudge */}
      <Modal open={nudgeOpen} onClose={() => setNudgeOpen(false)} title="Send a nudge">
        <div className="space-y-3">
          <AudiencePicker value={audience} onChange={setAudience} resolved={resolved} />
          <Field label="Title"><Input value={nudge.title} onChange={(e) => setNudge((n) => ({ ...n, title: e.target.value }))} placeholder="Leave blank for a sensible default" /></Field>
          <Field label="Message"><Input value={nudge.message} onChange={(e) => setNudge((n) => ({ ...n, message: e.target.value }))} placeholder="What you want them to do" /></Field>
          <p className="text-xs text-fg-muted">
            Delivered in the student’s workspace immediately. Email goes out too when SMTP is configured — the
            confirmation will tell you exactly how many of each actually sent.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="soft" onClick={() => setNudgeOpen(false)}>Cancel</Button>
            <Button onClick={send} disabled={busy || resolved.loading || !resolved.count}>
              {busy ? <Spinner /> : <Bell size={14} />} Send to {resolved.count}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function AudiencePicker({ value, onChange, resolved }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-fg"><Users size={14} /> Who gets this?</p>
      <div className="flex flex-wrap gap-2">
        {AUDIENCES.map((a) => (
          <button
            key={a.id} onClick={() => onChange(a.id)}
            className={`rounded-xl border px-3 py-1.5 text-left text-xs transition ${
              value === a.id ? 'border-strong bg-surface-1 text-fg' : 'border-subtle bg-surface-1 text-fg-secondary hover:border-strong'
            }`}
          >
            {a.label}
            <span className="block text-[10px] text-fg-muted">{a.hint}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-fg-secondary">
        {resolved.loading
          ? <><Spinner /> counting…</>
          : <><RefreshCw size={11} /> {resolved.count} student(s) match this audience right now.</>}
      </p>
    </div>
  );
}
