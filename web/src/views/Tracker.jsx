import { useState } from 'react';
import { Plus, GripVertical, Building2, ArrowRight, ArrowLeft, ExternalLink, Trash2 } from 'lucide-react';
import { PageIntro } from './common.jsx';
import { Badge, Button, Modal, Input, Field } from '../components/ui/kit.jsx';
import { useTracker } from '../hooks/useTracker.js';
import { COLUMN_ORDER, REMOVABLE_COLUMNS } from '../lib/trackerStore.js';

const COLUMN_META = {
  saved: { label: 'Saved', tone: 'default' },
  applied: { label: 'Applied', tone: 'cyan' },
  interview: { label: 'Interview', tone: 'violet' },
  offer: { label: 'Offer', tone: 'mint' },
};
const COLUMNS = COLUMN_ORDER.map((id) => ({ id, ...COLUMN_META[id] }));

export default function Tracker() {
  const { board, total, addManual, move, remove } = useTracker();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ role: '', company: '', url: '' });
  const [confirm, setConfirm] = useState(null); // { colId, id, role }

  const add = () => {
    if (!draft.role.trim()) return;
    addManual(draft);
    setDraft({ role: '', company: '', url: '' });
    setOpen(false);
  };

  const askRemove = (colId, card) => setConfirm({ colId, id: card.id, role: card.role });
  const doRemove = () => { if (confirm) remove(confirm.colId, confirm.id); setConfirm(null); };

  return (
    <>
      <PageIntro title="Application tracker" sub="Track real jobs you save or add. No demo applications are preloaded."
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Add application</Button>} />

      {total === 0 && <div className="mb-4 rounded-2xl border border-subtle bg-surface-1 p-4 text-sm text-fg-secondary">No applications yet. Save a job from Jobs or add one manually.</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col, ci) => {
          const canRemove = REMOVABLE_COLUMNS.includes(col.id);
          return (
            <div key={col.id} className="gradient-border p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-fg">{col.label}</h3>
                  <Badge tone={col.tone}>{board[col.id].length}</Badge>
                </div>
              </div>
              <div className="space-y-2.5">
                {board[col.id].length === 0 && (
                  <div className="rounded-xl border border-dashed border-subtle py-8 text-center text-xs text-fg-muted">Empty</div>
                )}
                {board[col.id].map((card) => (
                  <div key={card.id} className="group rounded-xl border border-subtle bg-surface-1 p-3 transition hover:border-strong">
                    <div className="flex items-start gap-2">
                      <GripVertical size={15} className="mt-0.5 text-fg-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg">{card.role}</p>
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-fg-muted"><Building2 size={11} /> {card.company || '—'}</p>
                      </div>
                      {card.url && <a href={card.url} target="_blank" rel="noreferrer" className="rounded-md p-1 text-fg-muted hover:bg-white/8 hover:text-fg"><ExternalLink size={14} /></a>}
                    </div>
                    <div className="mt-2 flex items-center justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                      {ci > 0 && <button onClick={() => move(col.id, card.id, -1)} title="Move back" className="rounded-md p-1 text-fg-muted hover:bg-white/8 hover:text-fg"><ArrowLeft size={14} /></button>}
                      {ci < COLUMNS.length - 1 && <button onClick={() => move(col.id, card.id, 1)} title="Move forward" className="rounded-md p-1 text-fg-muted hover:bg-white/8 hover:text-fg"><ArrowRight size={14} /></button>}
                      {canRemove && <button onClick={() => askRemove(col.id, card)} title="Remove from tracker" className="rounded-md p-1 text-fg-muted hover:bg-rose-500/15 hover:text-rose-300"><Trash2 size={14} /></button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add application">
        <div className="space-y-4">
          <Field label="Role"><Input value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} placeholder="Senior DevOps Engineer" /></Field>
          <Field label="Company"><Input value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} placeholder="GitLab" /></Field>
          <Field label="Posting URL"><Input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://..." /></Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={add}>Add to board</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Remove this job from tracker?">
        <div className="space-y-4">
          <p className="text-sm text-fg-secondary">Remove <span className="font-medium text-fg">{confirm?.role}</span> from your tracker? This can’t be undone, but you can always save the job again from Jobs.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="soft" onClick={doRemove}><Trash2 size={15} /> Remove</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
