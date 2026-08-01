// Guided Project Workspace — task board (Backlog / Ready / In Progress /
// Blocked / Done / Verified). Done and Verified stay separate: users can
// mark Done; Verified is only set by system verification.
//
// LAYOUT NOTE: this board used to be `xl:grid-cols-6` inside a three-column
// page (nav + main + inspector). Six equal columns in the leftover space gave
// each card ~120px, so titles wrapped one word per line and the whole board
// read as a wall of vertical text. It now scrolls horizontally with fixed,
// comfortable column widths — the board is allowed to be wider than the
// viewport, because a kanban board naturally is.
import { useMemo, useState } from 'react';
import { Code2, ChevronDown, EyeOff, Eye } from 'lucide-react';
import { Badge } from '../ui/kit.jsx';
import { TASK_COLUMNS, tasksByColumn } from '../../lib/workspaceSelectors.js';

const USER_STATUSES = ['backlog', 'ready', 'in_progress', 'blocked', 'done'];

/* Column accent so the eye can find a column without reading the label. */
const COLUMN_ACCENT = {
  backlog: 'text-slate-400',
  ready: 'text-aurora-cyan',
  in_progress: 'text-amber-glow',
  blocked: 'text-rose-300',
  done: 'text-aurora-mint',
  verified: 'text-aurora-violet',
};

function TaskCard({ task, selected, onSelect, onTaskPatch, onPreviewCode, blockDraft, setBlockDraft, move }) {
  const isBlocking = blockDraft.id === task.id;
  return (
    <div
      className={`rounded-2xl border p-4 transition ${
        selected
          ? 'border-aurora-violet/45 bg-aurora-violet/10 shadow-[0_0_0_1px_rgba(167,139,250,0.15)]'
          : 'border-white/8 bg-white/[0.035] hover:border-white/16'
      }`}
    >
      <button onClick={() => onSelect({ type: 'task', id: task.id })} className="w-full text-left">
        <div className="text-[14px] font-semibold leading-[1.45] text-white">{task.title}</div>
        {task.description && (
          <p className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-slate-400">{task.description}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge>{task.phase}</Badge>
          {task.proofRequired && <Badge tone="amber">Proof</Badge>}
          {task.starterCodeAvailable && <Badge tone="cyan"><Code2 size={10} /> Starter</Badge>}
        </div>
        {task.status === 'blocked' && task.blockerReason && (
          <div className="mt-3 rounded-lg border border-rose-400/25 bg-rose-500/10 px-2.5 py-2 text-[12px] leading-relaxed text-rose-200">
            Blocked: {task.blockerReason}
          </div>
        )}
      </button>

      {isBlocking ? (
        <div className="mt-3.5 space-y-2">
          <input
            autoFocus
            value={blockDraft.reason}
            onChange={(e) => setBlockDraft({ id: task.id, reason: e.target.value })}
            placeholder="Why is it blocked?"
            className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-[13px] text-white outline-none focus:border-aurora-violet/40"
          />
          <div className="flex gap-2">
            <button
              className="rounded-xl bg-rose-500/20 px-3 py-2 text-[12px] font-medium text-rose-200 hover:bg-rose-500/30"
              onClick={() => {
                onTaskPatch(task.id, { status: 'blocked', blockerReason: blockDraft.reason || 'Blocked' });
                setBlockDraft({ id: null, reason: '' });
              }}
            >
              Block
            </button>
            <button
              className="rounded-xl bg-white/8 px-3 py-2 text-[12px] text-slate-300 hover:bg-white/12"
              onClick={() => setBlockDraft({ id: null, reason: '' })}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3.5 flex items-center gap-2">
          <div className="relative flex-1">
            <select
              value={task.status}
              onChange={(e) => move(task, e.target.value)}
              disabled={task.status === 'verified'}
              className="h-10 w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-black/30 px-3 pr-8 text-[12.5px] text-slate-200 outline-none focus:border-aurora-violet/40 disabled:cursor-not-allowed disabled:text-slate-500"
            >
              {USER_STATUSES.map((s) => (
                <option key={s} value={s}>{TASK_COLUMNS.find((c) => c.id === s)?.label || s}</option>
              ))}
              {task.status === 'verified' && <option value="verified">Verified</option>}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
          </div>
          {onPreviewCode && task.starterCodeAvailable && (
            <button
              onClick={() => onPreviewCode({ taskId: task.id })}
              className="h-10 shrink-0 rounded-xl border border-white/10 px-3 text-[12.5px] text-slate-300 transition hover:border-white/25 hover:bg-white/5"
            >
              Preview code
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function WorkspaceTaskBoard({ plan, selected, onSelect, onTaskPatch, onPreviewCode }) {
  const cols = tasksByColumn(plan);
  const [blockDraft, setBlockDraft] = useState({ id: null, reason: '' });
  const [showEmpty, setShowEmpty] = useState(false);

  const move = (task, status) => {
    if (status === 'blocked') { setBlockDraft({ id: task.id, reason: task.blockerReason || '' }); return; }
    onTaskPatch(task.id, { status });
  };

  const emptyCount = TASK_COLUMNS.filter((c) => !cols[c.id].length).length;
  // Hiding empty columns by default is the single biggest win for width:
  // a typical fresh workspace has four of six columns empty.
  const visible = useMemo(
    () => (showEmpty ? TASK_COLUMNS : TASK_COLUMNS.filter((c) => cols[c.id].length > 0)),
    [showEmpty, cols],
  );
  const shown = visible.length ? visible : TASK_COLUMNS;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-[12.5px] leading-relaxed text-slate-500">
          Use the status menu on each card to move it. <span className="text-slate-300">Verified</span> is set by system
          verification only — marking a task Done does not verify it.
        </p>
        {emptyCount > 0 && (
          <button
            onClick={() => setShowEmpty((v) => !v)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-[12px] text-slate-400 transition hover:border-white/25 hover:text-slate-200"
          >
            {showEmpty ? <EyeOff size={13} /> : <Eye size={13} />}
            {showEmpty ? 'Hide empty columns' : `Show ${emptyCount} empty column${emptyCount === 1 ? '' : 's'}`}
          </button>
        )}
      </div>

      {/* Horizontal scroll: columns keep a readable width instead of being
          squeezed to fit. -mx-1 px-1 keeps focus rings from being clipped. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-3">
        <div className="flex min-w-full gap-4">
          {shown.map((col) => (
            <section
              key={col.id}
              className="flex w-[310px] shrink-0 flex-col rounded-2xl border border-white/8 bg-white/[0.02] p-3.5"
            >
              <header className="mb-3.5 flex items-center justify-between px-1">
                <span className={`font-mono text-[10.5px] uppercase tracking-[0.18em] ${COLUMN_ACCENT[col.id] || 'text-slate-400'}`}>
                  {col.label}
                </span>
                <span className="rounded-full bg-white/8 px-2 py-0.5 font-mono text-[10.5px] text-slate-400">
                  {cols[col.id].length}
                </span>
              </header>

              <div className="space-y-3">
                {cols[col.id].map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    selected={selected?.id === t.id}
                    onSelect={onSelect}
                    onTaskPatch={onTaskPatch}
                    onPreviewCode={onPreviewCode}
                    blockDraft={blockDraft}
                    setBlockDraft={setBlockDraft}
                    move={move}
                  />
                ))}
                {!cols[col.id].length && (
                  <div className="rounded-2xl border border-dashed border-white/8 px-3 py-8 text-center text-[12px] text-slate-600">
                    Nothing here yet
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
