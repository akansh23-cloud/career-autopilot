// Guided Project Workspace — task board (Backlog / Ready / In Progress /
// Blocked / Done / Verified). Done and Verified stay separate: users can
// mark Done; Verified is only set by system verification.
import { useState } from 'react';
import { Code2 } from 'lucide-react';
import { Badge } from '../ui/kit.jsx';
import { TASK_COLUMNS, tasksByColumn } from '../../lib/workspaceSelectors.js';

const USER_STATUSES = ['backlog', 'ready', 'in_progress', 'blocked', 'done'];

export default function WorkspaceTaskBoard({ plan, selected, onSelect, onTaskPatch, onPreviewCode }) {
  const cols = tasksByColumn(plan);
  const [blockDraft, setBlockDraft] = useState({ id: null, reason: '' });

  const move = (task, status) => {
    if (status === 'blocked') { setBlockDraft({ id: task.id, reason: task.blockerReason || '' }); return; }
    onTaskPatch(task.id, { status });
  };

  return (
    <div>
      <p className="mb-4 text-[12px] text-slate-500">Drag-free board: use the status menu on each card. “Verified” is set by system verification only — marking Done does not verify a task.</p>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {TASK_COLUMNS.map((col) => (
          <div key={col.id} className="rounded-2xl border border-white/8 bg-white/[0.02] p-2.5">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">{col.label}</span>
              <span className="font-mono text-[10px] text-slate-600">{cols[col.id].length}</span>
            </div>
            <div className="space-y-2">
              {cols[col.id].map((t) => (
                <div
                  key={t.id}
                  className={`rounded-xl border p-3 transition ${selected?.id === t.id ? 'border-aurora-violet/40 bg-aurora-violet/10' : 'border-white/8 bg-white/[0.04]'}`}
                >
                  <button onClick={() => onSelect({ type: 'task', id: t.id })} className="w-full text-left">
                    <div className="text-[12.5px] font-semibold leading-snug text-white">{t.title}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge>{t.phase}</Badge>
                      {t.proofRequired && <Badge tone="amber">Proof</Badge>}
                      {t.starterCodeAvailable && <Badge tone="cyan"><Code2 size={10} /> Starter</Badge>}
                    </div>
                    {t.status === 'blocked' && t.blockerReason && (
                      <div className="mt-1.5 text-[11px] text-rose-300">Blocked: {t.blockerReason}</div>
                    )}
                  </button>
                  {blockDraft.id === t.id ? (
                    <div className="mt-2 space-y-1.5">
                      <input
                        autoFocus value={blockDraft.reason}
                        onChange={(e) => setBlockDraft({ id: t.id, reason: e.target.value })}
                        placeholder="Why is it blocked?"
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-white outline-none focus:border-aurora-violet/40"
                      />
                      <div className="flex gap-1.5">
                        <button
                          className="rounded-lg bg-rose-500/20 px-2 py-1 text-[11px] text-rose-200"
                          onClick={() => { onTaskPatch(t.id, { status: 'blocked', blockerReason: blockDraft.reason || 'Blocked' }); setBlockDraft({ id: null, reason: '' }); }}
                        >Block</button>
                        <button className="rounded-lg bg-white/8 px-2 py-1 text-[11px] text-slate-300" onClick={() => setBlockDraft({ id: null, reason: '' })}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <select
                      value={t.status}
                      onChange={(e) => move(t, e.target.value)}
                      disabled={t.status === 'verified'}
                      className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-slate-300 outline-none"
                    >
                      {USER_STATUSES.map((s) => <option key={s} value={s}>{TASK_COLUMNS.find((c) => c.id === s)?.label || s}</option>)}
                      {t.status === 'verified' && <option value="verified">Verified</option>}
                    </select>
                  )}
                  {onPreviewCode && t.starterCodeAvailable && (
                    <button onClick={() => onPreviewCode({ taskId: t.id })} className="mt-1.5 w-full rounded-lg border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/5">
                      Preview starter code
                    </button>
                  )}
                </div>
              ))}
              {!cols[col.id].length && <div className="rounded-xl border border-dashed border-white/8 p-3 text-center text-[11px] text-slate-600">Empty</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
