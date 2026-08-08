/* ============================================================
   MyModuleChecklist — the student half of individual progress.
   ------------------------------------------------------------
   Render inside views/MyTeamProject.jsx:

     import MyModuleChecklist from '../components/college/MyModuleChecklist.jsx';
     <MyModuleChecklist projectId={project.id} />

   Two deliberate product decisions:

   1. An evidence link is REQUESTED, not required. Forcing it would
      push students to paste anything to clear the box. Instead the
      UI shows plainly that a module without evidence counts for
      less, and the coordinator sees "unverified" on their side.
      That is a nudge, not a gate.

   2. Teammate percentages are shown. Visible peer progress is one
      of the few reliable drivers of completion on group work — but
      the imbalance FLAGS are coordinator-only and are stripped by
      the server, so this never becomes a place to blame a teammate.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { MyTeamProgress } from '../../lib/teamProgress.js';

const NEXT_STATUS = { todo: 'in_progress', in_progress: 'done', done: 'todo' };
const STATUS_LABEL = { todo: 'Not started', in_progress: 'In progress', done: 'Done' };
const STATUS_STYLE = {
  todo: 'border-subtle text-fg-muted',
  in_progress: 'border-amber-400/40 text-amber-300',
  done: 'border-emerald-400/40 text-emerald-300',
};

function ModuleRow({ projectId, name, module: mod, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState(mod.evidenceUrl || '');
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState('');

  const patch = async (body) => {
    setBusy(true); setErr('');
    try {
      const d = await MyTeamProgress.setModule(projectId, name, body);
      onChanged(d);
    } catch (e) {
      setErr(e.message || 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-subtle bg-elevated p-3.5">
      <div className="flex items-start gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => patch({ status: NEXT_STATUS[mod.status] || 'in_progress' })}
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-40 ${STATUS_STYLE[mod.status]}`}
        >
          {STATUS_LABEL[mod.status]}
        </button>
        <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-fg">{name}</p>
      </div>

      <div className="mt-2.5 pl-1">
        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="https://github.com/… commit, PR, or deployed page"
              className="min-w-0 flex-1 rounded-lg border border-subtle bg-surface-1 px-2.5 py-1.5 text-[12px] text-fg outline-none focus:border-strong"
            />
            <button
              type="button"
              disabled={busy}
              onClick={async () => { await patch({ evidenceUrl: evidence }); setEditing(false); }}
              className="rounded-lg border border-subtle px-2.5 py-1.5 text-[12px] font-medium transition hover:bg-surface-hover disabled:opacity-40"
            >
              Save
            </button>
          </div>
        ) : mod.evidenceUrl ? (
          <div className="flex items-center gap-2 text-[11px]">
            <a href={mod.evidenceUrl} target="_blank" rel="noreferrer" className="truncate text-emerald-300 underline">
              Evidence attached
            </a>
            <button type="button" onClick={() => setEditing(true)} className="text-fg-muted underline">change</button>
          </div>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="text-[11px] text-fg-muted underline">
            Add an evidence link — modules with evidence count for more
          </button>
        )}
      </div>

      {err && <p className="mt-2 text-[11px] text-red-300">{err}</p>}
    </div>
  );
}

export default function MyModuleChecklist({ projectId }) {
  const [state, setState] = useState({ status: 'loading', me: null, team: null, err: '' });

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const d = await MyTeamProgress.get(projectId);
      setState({ status: 'done', me: d.me, team: d.team, err: '' });
    } catch (e) {
      setState({ status: 'error', me: null, team: null, err: e.message || 'Could not load your progress.' });
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const onChanged = (d) => setState((s) => ({ ...s, me: d.me, team: d.team }));

  if (state.status === 'loading') return <p className="py-6 text-center text-[13px] text-fg-muted">Loading your modules…</p>;
  if (state.status === 'error') {
    return (
      <div className="rounded-xl border border-red-400/25 bg-red-500/[0.07] p-4">
        <p className="text-[13px] text-fg">{state.err}</p>
        <button type="button" onClick={load} className="mt-2 text-[12px] underline">Retry</button>
      </div>
    );
  }

  const me = state.me;
  if (!me) return <p className="py-6 text-center text-[13px] text-fg-muted">You have no modules assigned on this project.</p>;

  const modules = Object.entries(me.moduleRows || {});

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-fg-muted">
          Your modules · {me.role}
        </p>
        <p className="mt-1 text-[13px] text-fg-secondary">
          <span className="font-semibold text-fg">{me.percent}%</span> — {me.modules.done}/{me.modules.total} done,
          {' '}{me.modules.withEvidence} with evidence
        </p>
      </div>

      <div className="space-y-2">
        {modules.length === 0 && (
          <p className="rounded-lg border border-subtle bg-surface-1 px-3 py-2 text-[12px] text-fg-muted">
            Your assigned modules appear here once the coordinator assigns the project.
          </p>
        )}
        {modules.map(([name, mod]) => (
          <ModuleRow key={name} projectId={projectId} name={name} module={mod} onChanged={onChanged} />
        ))}
      </div>

      {state.team?.members?.length > 1 && (
        <div className="rounded-xl border border-subtle bg-surface-1 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-fg-muted">Your team</p>
          <ul className="mt-2 space-y-1">
            {state.team.members.map((m) => (
              <li key={m.studentId} className="flex items-center justify-between text-[12px] text-fg-secondary">
                <span className="truncate">{m.name}{m.studentId === me.studentId ? ' (you)' : ''}</span>
                <span className="ml-3 shrink-0 font-medium text-fg">{m.percent}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
