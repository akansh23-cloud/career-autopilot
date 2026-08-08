import { useEffect, useState } from 'react';
import { Loader2, Search, ChevronDown, Layers, Archive, Trash2, ArrowRight, AlertTriangle } from 'lucide-react';
import { PageIntro, SectionCard } from '../common.jsx';
import { Button, Badge, Input, EmptyState, Modal } from '../../components/ui/kit.jsx';
import { PatentOS } from '../../lib/api.js';
import { STATUS_LABELS, STATUS_ORDER, LOCKED_STATUSES, DOMAINS, ScorePill, riskTone } from './shared.jsx';

export default function PatentPortfolio({ go }) {
  const [ideas, setIdeas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('board');
  const [search, setSearch] = useState('');
  const [domain, setDomain] = useState('');
  const [status, setStatus] = useState('');
  const [minScore, setMinScore] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState('');
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2200); };

  const load = async () => {
    setLoading(true);
    try { const d = await PatentOS.ideas({ search, domain, status, minScore }); setIdeas(d.ideas || []); }
    catch { setIdeas([]); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [domain, status, minScore]);

  const changeStatus = async (id, s) => { try { const r = await PatentOS.patch(id, { status: s }); setIdeas((p) => p.map((i) => (i.id === id ? (r.idea || { ...i, status: s }) : i))); } catch { flash('Failed'); } };
  const doDelete = async (idea) => {
    try { const r = await PatentOS.remove(idea.id); if (r.archived) { setIdeas((p) => p.map((i) => (i.id === idea.id ? { ...i, archived: true } : i))); flash('Archived (locked status)'); } else { setIdeas((p) => p.filter((i) => i.id !== idea.id)); flash('Deleted'); } }
    catch { flash('Failed'); } finally { setConfirm(null); }
  };

  const grouped = STATUS_ORDER.map((s) => ({ status: s, items: ideas.filter((i) => i.status === s && !i.archived) }));

  return (
    <>
      <PageIntro title="My inventions" sub="Track every invention through the patent pipeline. Filed, published and granted items can be archived but not deleted." action={
        <div className="flex gap-2">
          <Button size="sm" variant={view === 'board' ? undefined : 'soft'} onClick={() => setView('board')}><Layers size={14} /> Board</Button>
          <Button size="sm" variant={view === 'table' ? undefined : 'soft'} onClick={() => setView('table')}>Table</Button>
        </div>
      } />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} placeholder="Search title / problem / tag…" className="h-9 w-full rounded-lg border border-field-border bg-field pl-9 pr-3 text-xs text-fg outline-none" />
        </div>
        {[['Domain', domain, setDomain, DOMAINS], ['Status', status, setStatus, STATUS_ORDER]].map(([label, val, set, opts]) => (
          <div key={label} className="relative">
            <select value={val} onChange={(e) => set(e.target.value)} className="h-9 cursor-pointer appearance-none rounded-lg border border-field-border bg-field pl-3 pr-8 text-xs text-fg outline-none">
              <option value="">{label}: any</option>
              {opts.map((o) => <option key={o} value={o}>{label === 'Status' ? STATUS_LABELS[o] : o}</option>)}
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          </div>
        ))}
        <div className="relative"><select value={minScore} onChange={(e) => setMinScore(e.target.value)} className="h-9 cursor-pointer appearance-none rounded-lg border border-field-border bg-field pl-3 pr-8 text-xs text-fg outline-none"><option value="">Score: any</option><option value="70">70+</option><option value="55">55+</option><option value="35">35+</option></select><ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-muted" /></div>
      </div>

      {toast && <div className="mb-3 rounded-lg border border-aurora-mint/30 bg-aurora-mint/10 px-3 py-2 text-xs text-aurora-mint">{toast}</div>}

      {loading ? (
        <SectionCard><div className="flex items-center gap-2 py-8 text-fg-secondary"><Loader2 size={16} className="animate-spin" /> Loading…</div></SectionCard>
      ) : ideas.filter((i) => !i.archived).length === 0 ? (
        <EmptyState icon={Layers} title="No inventions yet" hint="Generate invention ideas to start your portfolio." action={<Button size="sm" onClick={() => go?.('patentgenerate')}>Generate ideas</Button>} />
      ) : view === 'board' ? (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {grouped.filter((g) => g.items.length || ['raw_idea', 'shortlisted', 'refining'].includes(g.status)).map((g) => (
            <div key={g.status} className="w-64 shrink-0">
              <div className="mb-2 flex items-center justify-between px-1"><span className="text-[12px] font-medium text-fg-secondary">{STATUS_LABELS[g.status]}</span><Badge tone="default">{g.items.length}</Badge></div>
              <div className="space-y-2">
                {g.items.map((idea) => (
                  <button key={idea.id} onClick={() => go?.('patentworkspace', { ideaId: idea.id })} className="block w-full rounded-xl border border-subtle bg-surface-1 p-3 text-left transition hover:border-strong">
                    <div className="text-[13px] font-medium text-fg line-clamp-2">{idea.title}</div>
                    <div className="mt-1.5 flex items-center gap-1.5"><ScorePill score={idea.score?.overall || 0} /><Badge tone={riskTone(idea.score?.riskLevel)}>{idea.score?.riskLevel || 'Med'}</Badge></div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <SectionCard>
          <div className="space-y-2">
            {ideas.filter((i) => !i.archived).map((idea) => (
              <div key={idea.id} className="flex items-center justify-between gap-3 rounded-xl border border-subtle bg-surface-1 px-3 py-2.5">
                <button onClick={() => go?.('patentworkspace', { ideaId: idea.id })} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm text-fg">{idea.title}</div>
                  <div className="mt-0.5 flex items-center gap-1.5"><ScorePill score={idea.score?.overall || 0} />{idea.domain && <span className="text-[11px] text-fg-muted">{idea.domain}</span>}</div>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="relative"><select value={idea.status} onChange={(e) => changeStatus(idea.id, e.target.value)} className="h-8 cursor-pointer appearance-none rounded-lg border border-field-border bg-field pl-2.5 pr-7 text-[11px] text-fg outline-none">{STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select><ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted" /></div>
                  <button onClick={() => setConfirm(idea)} className="rounded-md p-1.5 text-fg-muted hover:text-danger" title={LOCKED_STATUSES.includes(idea.status) ? 'Archive' : 'Delete'}>{LOCKED_STATUSES.includes(idea.status) ? <Archive size={15} /> : <Trash2 size={15} />}</button>
                  <button onClick={() => go?.('patentworkspace', { ideaId: idea.id })} className="rounded-md p-1.5 text-fg-muted hover:text-fg"><ArrowRight size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {confirm && (
        <Modal open onClose={() => setConfirm(null)} title={LOCKED_STATUSES.includes(confirm.status) ? 'Archive invention?' : 'Delete invention?'}>
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-sm text-fg-secondary"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-glow" /> {LOCKED_STATUSES.includes(confirm.status) ? `"${confirm.title}" is ${STATUS_LABELS[confirm.status]} and cannot be permanently deleted — it will be archived.` : `Permanently delete "${confirm.title}"? This cannot be undone.`}</p>
            <div className="flex gap-2"><Button onClick={() => doDelete(confirm)}>{LOCKED_STATUSES.includes(confirm.status) ? 'Archive' : 'Delete'}</Button><Button variant="soft" onClick={() => setConfirm(null)}>Cancel</Button></div>
          </div>
        </Modal>
      )}
    </>
  );
}
