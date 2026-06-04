import { useState } from 'react';
import { Plus, GripVertical, Building2, ArrowRight, ArrowLeft } from 'lucide-react';
import { PageIntro } from './common.jsx';
import { Badge, Button, Modal, Input, Field } from '../components/ui/kit.jsx';

const COLUMNS = [
  { id: 'saved', label: 'Saved', tone: 'default' },
  { id: 'applied', label: 'Applied', tone: 'cyan' },
  { id: 'interview', label: 'Interview', tone: 'violet' },
  { id: 'offer', label: 'Offer', tone: 'mint' },
];

const seed = {
  saved: [{ id: 1, role: 'Platform Engineer', company: 'Grafana Labs' }, { id: 2, role: 'SRE', company: 'Cloudflare' }],
  applied: [{ id: 3, role: 'Senior DevOps', company: 'GitLab' }, { id: 4, role: 'Infra Engineer', company: 'HashiCorp' }],
  interview: [{ id: 5, role: 'DevOps Engineer', company: 'Datadog' }],
  offer: [],
};

export default function Tracker() {
  const [board, setBoard] = useState(seed);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ role: '', company: '' });

  const move = (colId, idx, dir) => {
    const order = COLUMNS.map((c) => c.id);
    const cur = order.indexOf(colId);
    const next = order[cur + dir];
    if (!next) return;
    setBoard((b) => {
      const item = b[colId][idx];
      return { ...b, [colId]: b[colId].filter((_, i) => i !== idx), [next]: [item, ...b[next]] };
    });
  };
  const add = () => {
    if (!draft.role.trim()) return;
    setBoard((b) => ({ ...b, saved: [{ id: Date.now(), ...draft }, ...b.saved] }));
    setDraft({ role: '', company: '' }); setOpen(false);
  };

  return (
    <>
      <PageIntro title="Application tracker" sub="Drag your pipeline forward — nothing slips through."
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Add application</Button>} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col, ci) => (
          <div key={col.id} className="gradient-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white">{col.label}</h3>
                <Badge tone={col.tone}>{board[col.id].length}</Badge>
              </div>
            </div>
            <div className="space-y-2.5">
              {board[col.id].length === 0 && (
                <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-xs text-slate-600">Empty</div>
              )}
              {board[col.id].map((card, idx) => (
                <div key={card.id} className="group rounded-xl border border-white/8 bg-white/[0.02] p-3 transition hover:border-white/20">
                  <div className="flex items-start gap-2">
                    <GripVertical size={15} className="mt-0.5 text-slate-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{card.role}</p>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500"><Building2 size={11} /> {card.company || '—'}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                    {ci > 0 && <button onClick={() => move(col.id, idx, -1)} className="rounded-md p-1 text-slate-500 hover:bg-white/8 hover:text-white"><ArrowLeft size={14} /></button>}
                    {ci < COLUMNS.length - 1 && <button onClick={() => move(col.id, idx, 1)} className="rounded-md p-1 text-slate-500 hover:bg-white/8 hover:text-white"><ArrowRight size={14} /></button>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add application">
        <div className="space-y-4">
          <Field label="Role"><Input value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} placeholder="Senior DevOps Engineer" /></Field>
          <Field label="Company"><Input value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} placeholder="GitLab" /></Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={add}>Add to board</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
