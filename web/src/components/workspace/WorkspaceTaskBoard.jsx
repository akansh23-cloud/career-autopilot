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

/* Column list height cap. The board is a fixed-height surface: columns scroll
   inside themselves rather than stretching the page. Tuned so a column shows
   about four cards before scrolling on a laptop screen. */
const COLUMN_SCROLL = 'max-h-[min(60vh,520px)]';

/* Column accent so the eye can find a column without reading the label. */
const COLUMN_ACCENT = {
  backlog: 'text-fg-secondary',
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
      className={`rounded-xl border px-3.5 py-3 transition ${
        selected
          ? 'border-aurora-violet/45 bg-aurora-violet/10 shadow-[0_0_0_1px_rgba(167,139,250,0.15)]'
          : 'border-subtle bg-surface-1 hover:border-white/16'
      }`}
    >
      <button onClick={() => onSelect({ type: 'task', id: task.id })} className="w-full text-left">
        <div className="text-[13.5px] font-semibold leading-snug text-fg">{task.title}</div>
        {/* Detail lives in the inspector, not on every card — a description on
            each one is what made the columns scroll for pages. */}
        {selected && task.description && (
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-fg-secondary">{task.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge>{task.phase}</Badge>
          {task.proofRequired && <Badge tone="amber">Proof</Badge>}
          {task.starterCodeAvailable && <Badge tone="cyan"><Code2 size={10} /> Starter</Badge>}
        </div>
        {task.status === 'blocked' && task.blockerReason && (
          <div className="mt-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-rose-200">
            Blocked: {task.blockerReason}
          </div>
        )}
      </button>

      {isBlocking ? (
        <div className="mt-2.5 space-y-2">
          <input
            autoFocus
            value={blockDraft.reason}
            onChange={(e) => setBlockDraft({ id: task.id, reason: e.target.value })}
            placeholder="Why is it blocked?"
            className="h-9 w-full rounded-lg border border-subtle bg-sunken px-3 text-[12.5px] text-fg outline-none focus:border-aurora-violet/40"
          />
          <div className="flex gap-2">
            <button
              className="rounded-lg bg-rose-500/20 px-3 py-1.5 text-[12px] font-medium text-rose-200 hover:bg-rose-500/30"
              onClick={() => {
                onTaskPatch(task.id, { status: 'blocked', blockerReason: blockDraft.reason || 'Blocked' });
                setBlockDraft({ id: null, reason: '' });
              }}
            >
              Block
            </button>
            <button
              className="rounded-lg bg-white/8 px-3 py-1.5 text-[12px] text-fg-secondary hover:bg-white/12"
              onClick={() => setBlockDraft({ id: null, reason: '' })}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 flex items-center gap-2">
          <div className="relative flex-1">
            <select
              value={task.status}
              onChange={(e) => move(task, e.target.value)}
              disabled={task.status === 'verified'}
              className="h-9 w-full cursor-pointer appearance-none rounded-lg border border-subtle bg-sunken px-2.5 pr-7 text-[12px] text-fg outline-none focus:border-aurora-violet/40 disabled:cursor-not-allowed disabled:text-fg-muted"
            >
              {USER_STATUSES.map((s) => (
                <option key={s} value={s}>{TASK_COLUMNS.find((c) => c.id === s)?.label || s}</option>
              ))}
              {task.status === 'verified' && <option value="verified">Verified</option>}
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          </div>
          {onPreviewCode && task.starterCodeAvailable && (
            <button
              onClick={() => onPreviewCode({ taskId: task.id })}
              className="h-9 shrink-0 rounded-lg border border-subtle px-2.5 text-[12px] text-fg-secondary transition hover:border-strong hover:bg-surface-1"
            >
              Code
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
        <p className="max-w-2xl text-[12.5px] leading-relaxed text-fg-muted">
          Use the status menu on each card to move it. <span className="text-fg-secondary">Verified</span> is set by system
          verification only — marking a task Done does not verify it.
        </p>
        {emptyCount > 0 && (
          <button
            onClick={() => setShowEmpty((v) => !v)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-subtle px-3 py-2 text-[12px] text-fg-secondary transition hover:border-strong hover:text-fg"
          >
            {showEmpty ? <EyeOff size={13} /> : <Eye size={13} />}
            {showEmpty ? 'Hide empty columns' : `Show ${emptyCount} empty column${emptyCount === 1 ? '' : 's'}`}
          </button>
        )}
      </div>

      {/* Horizontal scroll: columns keep a readable width instead of being
          squeezed to fit. -mx-1 px-1 keeps focus rings from being clipped. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-3">
        <div className="flex min-w-full items-start gap-3.5">
          {shown.map((col) => (
            <section
              key={col.id}
              className="flex w-[300px] shrink-0 flex-col rounded-2xl border border-subtle bg-surface-1 p-3"
            >
              {/* Header stays put while the column's own list scrolls. */}
              <header className="mb-2.5 flex shrink-0 items-center justify-between px-1">
                <span className={`font-mono text-[10.5px] uppercase tracking-[0.18em] ${COLUMN_ACCENT[col.id] || 'text-fg-secondary'}`}>
                  {col.label}
                </span>
                <span className="rounded-full bg-white/8 px-2 py-0.5 font-mono text-[10.5px] text-fg-secondary">
                  {cols[col.id].length}
                </span>
              </header>

              {/* Each column scrolls internally, so the BOARD never grows
                  taller than the viewport no matter how many tasks a column
                  holds. Without this a 19-task plan meant scrolling the whole
                  page several times to reach the end. */}
              <div className={`space-y-2.5 overflow-y-auto pr-1 ${COLUMN_SCROLL}`}>
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
                  <div className="rounded-xl border border-dashed border-subtle px-3 py-6 text-center text-[12px] text-fg-muted">
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
