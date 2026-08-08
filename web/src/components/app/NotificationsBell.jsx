import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCircle2, ClipboardList, Loader2 } from 'lucide-react';
import { Dropdown, Badge, Button } from '../ui/kit.jsx';
import { My } from '../../lib/api.js';

/* ============================================================
   NOTIFICATIONS BELL  (in-app nudges + assigned tasks)
   ------------------------------------------------------------
   The guaranteed delivery channel for placement-cell nudges and task
   assignments. Polls lightly (60s) while mounted; opening the panel
   marks nudges read. Tasks stay until the student marks them done —
   completion is reported back to the college task record.
   ============================================================ */
const POLL_MS = 60 * 1000;

export default function NotificationsBell({ onPick }) {
  const [items, setItems] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [unread, setUnread] = useState(0);
  const [busyTask, setBusyTask] = useState('');
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const [n, t] = await Promise.all([My.notifications().catch(() => null), My.tasks().catch(() => null)]);
      if (n?.ok) {
        setItems(n.notifications || []);
        setUnread((n.notifications || []).filter((x) => !x.readAt).length);
      }
      if (t?.ok) setTasks((t.tasks || []).filter((x) => x.status !== 'done'));
    } catch { /* silent: the bell must never break the shell */ }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => clearInterval(timer.current);
  }, [load]);

  const openPanel = async () => {
    if (unread > 0) {
      setUnread(0);
      My.markNotificationsRead().catch(() => {});
      setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() })));
    }
  };

  const doneTask = async (taskId) => {
    setBusyTask(taskId);
    try {
      const r = await My.completeTask(taskId);
      if (r?.ok) setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } finally { setBusyTask(''); }
  };

  const total = unread + tasks.length;

  return (
    <Dropdown
      align="right"
      trigger={
        <button onClick={openPanel} aria-label="Notifications"
          className="relative grid h-9 w-9 place-items-center rounded-xl border border-subtle bg-surface-1 text-fg-secondary transition hover:bg-surface-1">
          <Bell size={17} />
          {total > 0 && (
            <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-aurora-cta px-1 text-[9px] font-bold text-ink-950">
              {total > 9 ? '9+' : total}
            </span>
          )}
        </button>
      }
    >
      <div className="max-h-[420px] w-[330px] overflow-y-auto">
        {tasks.length > 0 && (
          <div className="border-b border-subtle p-2">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Assigned by your placement cell</p>
            {tasks.map((t) => (
              <div key={t.id} className="rounded-lg px-2 py-2 hover:bg-surface-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg">
                      <ClipboardList size={12} className="shrink-0 text-aurora-cyan" /> {t.title}
                    </p>
                    {t.description && <p className="mt-0.5 text-[11px] leading-snug text-fg-secondary">{t.description}</p>}
                    {t.dueAt && <p className="mt-0.5 text-[10px] text-fg-muted">Due {new Date(t.dueAt).toLocaleDateString()}</p>}
                  </div>
                  <Button size="xs" variant="soft" disabled={busyTask === t.id} onClick={() => doneTask(t.id)}>
                    {busyTask === t.id ? <Loader2 size={12} className="animate-spin" /> : 'Done'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="p-2">
          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Notifications</p>
          {items.length === 0
            ? <p className="px-2 py-4 text-[12px] text-fg-muted">Nothing yet. Placement-cell nudges and updates land here.</p>
            : items.map((n) => (
              <button key={n.id}
                onClick={() => { if (n.actionView && onPick) onPick(n.actionView); }}
                className={`block w-full rounded-lg px-2 py-2 text-left transition hover:bg-surface-1 ${n.readAt ? 'opacity-70' : ''}`}>
                <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg">
                  {!n.readAt && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-aurora-cta" />}
                  {n.title}
                </p>
                {n.body && <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-fg-secondary">{n.body}</p>}
                <p className="mt-0.5 text-[10px] text-fg-muted">{n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}</p>
              </button>
            ))}
          {items.length > 0 && items.every((n) => n.readAt) && (
            <p className="flex items-center gap-1 px-2 pt-1 text-[10px] text-fg-muted"><CheckCircle2 size={11} /> All caught up</p>
          )}
        </div>
      </div>
    </Dropdown>
  );
}
