import { useEffect, useState } from 'react';
import { Plus, GripVertical, Building2, ArrowRight, ArrowLeft, ExternalLink } from 'lucide-react';
import { PageIntro } from './common.jsx';
import { Badge, Button, Modal, Input, Field } from '../components/ui/kit.jsx';

const TRACKER_KEY = 'careerAutopilot.trackerBoard.v1';
const COLUMNS = [
  { id: 'saved', label: 'Saved', tone: 'default' },
  { id: 'applied', label: 'Applied', tone: 'cyan' },
  { id: 'interview', label: 'Interview', tone: 'violet' },
  { id: 'offer', label: 'Offer', tone: 'mint' },
];
const emptyBoard = { saved: [], applied: [], interview: [], offer: [] };
function readBoard() { try { return { ...emptyBoard, ...(JSON.parse(localStorage.getItem(TRACKER_KEY) || '{}') || {}) }; } catch { return emptyBoard; } }
function writeBoard(b) { try { localStorage.setItem(TRACKER_KEY, JSON.stringify(b)); window.dispatchEvent(new Event('career-tracker-updated')); } catch {} }

export default function Tracker() {
  const [board, setBoard] = useState(readBoard);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ role: '', company: '', url: '' });

  useEffect(() => { const h = () => setBoard(readBoard()); window.addEventListener('career-tracker-updated', h); return () => window.removeEventListener('career-tracker-updated', h); }, []);

  const update = (next) => { setBoard(next); writeBoard(next); };
  const move = (colId, idx, dir) => {
    const order = COLUMNS.map((c) => c.id);
    const cur = order.indexOf(colId);
    const nextCol = order[cur + dir];
    if (!nextCol) return;
    const item = board[colId][idx];
    update({ ...board, [colId]: board[colId].filter((_, i) => i !== idx), [nextCol]: [{ ...item, movedAt: new Date().toISOString() }, ...board[nextCol]] });
  };
  const add = () => {
    if (!draft.role.trim()) return;
    const item = { id: String(Date.now()), role: draft.role.trim(), company: draft.company.trim(), url: draft.url.trim(), addedAt: new Date().toISOString() };
    update({ ...board, saved: [item, ...board.saved] });
    setDraft({ role: '', company: '', url: '' }); setOpen(false);
  };
  const total = Object.values(board).reduce((n, a) => n + a.length, 0);

  return (
    <>
      <PageIntro title="Application tracker" sub="Track real jobs you save or add. No demo applications are preloaded."
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Add application</Button>} />

      {total === 0 && <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">No applications yet. Save a job from Jobs or add one manually.</div>}

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
                    {card.url && <a href={card.url} target="_blank" rel="noreferrer" className="rounded-md p-1 text-slate-500 hover:bg-white/8 hover:text-white"><ExternalLink size={14} /></a>}
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
          <Field label="Posting URL"><Input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://..." /></Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={add}>Add to board</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
