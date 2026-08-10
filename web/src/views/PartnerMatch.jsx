import { useEffect, useMemo, useState } from 'react';
import { Users, Plus, Trash2, UserPlus, Eye, Handshake, X } from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Modal, EmptyState, Input, Field } from '../components/ui/kit.jsx';
import { getPartnerRequests, savePartnerRequest, deletePartnerRequest, uid } from '../lib/projectStore.js';

const splitSkills = (s = '') => s.split(',').map((x) => x.trim()).filter(Boolean);

/* match score between two requests: overlap of (what I need) vs (what they have) */
function matchScore(mine, other) {
  const need = new Set(splitSkills(mine.skillsNeed).map((s) => s.toLowerCase()));
  const have = new Set(splitSkills(other.skillsHave).map((s) => s.toLowerCase()));
  if (!need.size || !have.size) return 0;
  let hit = 0; need.forEach((n) => { if (have.has(n)) hit++; });
  const roleBonus = mine.targetRole && other.targetRole && mine.targetRole === other.targetRole ? 0.2 : 0;
  return Math.min(100, Math.round((hit / need.size) * 80 + roleBonus * 100));
}

const empty = { title: '', skillsHave: '', skillsNeed: '', targetRole: '', availability: '', mode: 'Remote', message: '' };

export default function PartnerMatch() {
  const [list, setList] = useState(getPartnerRequests());
  const [form, setForm] = useState(empty);
  const [openForm, setOpenForm] = useState(false);
  const [view, setView] = useState(null);

  useEffect(() => {
    const sync = () => setList(getPartnerRequests());
    window.addEventListener('career-partners-updated', sync);
    return () => window.removeEventListener('career-partners-updated', sync);
  }, []);

  const mine = list[0]; // newest request is treated as "mine" for match scoring
  const matches = useMemo(() => {
    if (!mine || list.length < 2) return [];
    return list.slice(1).map((r) => ({ ...r, score: matchScore(mine, r) })).sort((a, b) => b.score - a.score);
  }, [list, mine]);

  const submit = () => {
    if (!form.title.trim()) return;
    savePartnerRequest({ id: uid('req'), ...form });
    setList(getPartnerRequests()); setForm(empty); setOpenForm(false);
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <PageIntro title="Find Project Partner" sub="Create a collaboration request and match with partners by complementary skills." action={<Button onClick={() => setOpenForm(true)}><Plus size={15} /> Request collaboration</Button>} />

      {!list.length ? (
        <SectionCard title="Partner requests">
          <EmptyState icon={Users} title="No partner requests yet. Create one to start matching." hint="Describe what you’re building, the skills you have and the skills you need. Matches appear as other requests are created." action={<Button onClick={() => setOpenForm(true)}><Plus size={15} /> Create a request</Button>} />
        </SectionCard>
      ) : (
        <div className="space-y-4">
          <SectionCard title="Your latest request">
            <RequestCard r={mine} onView={setView} onDelete={(id) => { deletePartnerRequest(id); setList(getPartnerRequests()); }} primary />
          </SectionCard>

          <SectionCard title="Matching partners" action={<Badge tone="violet">{matches.length}</Badge>}>
            {matches.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {matches.map((r) => <RequestCard key={r.id} r={r} score={r.score} onView={setView} onDelete={(id) => { deletePartnerRequest(id); setList(getPartnerRequests()); }} />)}
              </div>
            ) : (
              <EmptyState icon={Handshake} title="No matches yet" hint="When more collaboration requests exist, the closest skill matches show up here ranked by skill-match score." />
            )}
          </SectionCard>
        </div>
      )}

      {/* create modal */}
      <Modal open={openForm} onClose={() => setOpenForm(false)} title="Request collaboration" width="max-w-xl">
        <div className="space-y-3">
          <Field label="Project title"><Input value={form.title} onChange={set('title')} placeholder="e.g. Realtime collab whiteboard" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Skills I have" hint="comma separated"><Input value={form.skillsHave} onChange={set('skillsHave')} placeholder="React, Node.js" /></Field>
            <Field label="Skills I need" hint="comma separated"><Input value={form.skillsNeed} onChange={set('skillsNeed')} placeholder="AWS, Terraform" /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Target role"><Input value={form.targetRole} onChange={set('targetRole')} placeholder="Full Stack Developer" /></Field>
            <Field label="Availability"><Input value={form.availability} onChange={set('availability')} placeholder="~8 hrs/week, evenings" /></Field>
          </div>
          <Field label="Preferred mode">
            <div className="flex gap-1.5">{['Remote', 'In-person', 'Hybrid'].map((m) => <button key={m} onClick={() => setForm((f) => ({ ...f, mode: m }))} className={`rounded-lg px-3 py-1.5 text-xs transition ${form.mode === m ? 'bg-aurora-violet/20 text-fg ring-1 ring-aurora-violet/40' : 'bg-surface-1 text-fg-secondary hover:bg-surface-2'}`}>{m}</button>)}</div>
          </Field>
          <Field label="Message"><textarea value={form.message} onChange={set('message')} placeholder="What you’re building and what you’re looking for in a partner…" className="h-24 w-full resize-y rounded-xl border border-field-border bg-field p-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-aurora-violet/50" /></Field>
          <div className="flex justify-end gap-2 border-t border-subtle pt-4"><Button variant="soft" onClick={() => setOpenForm(false)}>Cancel</Button><Button onClick={submit} disabled={!form.title.trim()}><UserPlus size={15} /> Create request</Button></div>
        </div>
      </Modal>

      {/* view profile modal */}
      <Modal open={!!view} onClose={() => setView(null)} title={view?.title} width="max-w-lg">
        {view && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">{view.targetRole && <Badge tone="violet">{view.targetRole}</Badge>}<Badge>{view.mode}</Badge>{view.availability && <Badge tone="cyan">{view.availability}</Badge>}</div>
            <div><div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted">Skills they have</div><div className="flex flex-wrap gap-1.5">{splitSkills(view.skillsHave).map((s, i) => <Badge key={i} tone="mint">{s}</Badge>) || '—'}</div></div>
            <div><div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted">Skills they need</div><div className="flex flex-wrap gap-1.5">{splitSkills(view.skillsNeed).map((s, i) => <Badge key={i} tone="rose">{s}</Badge>) || '—'}</div></div>
            {view.message && <p className="rounded-xl border border-subtle bg-base/55 p-3 text-[13px] text-fg-secondary">{view.message}</p>}
            <div className="flex justify-end border-t border-subtle pt-4"><Button onClick={() => alert('Collaboration requests will be sendable once partner messaging is live.')}><Handshake size={15} /> Request collaboration</Button></div>
          </div>
        )}
      </Modal>
    </>
  );
}

function RequestCard({ r, score, onView, onDelete, primary }) {
  return (
    <div className={`flex flex-col rounded-2xl border p-4 ${primary ? 'border-aurora-violet/30 bg-aurora-violet/[0.06]' : 'border-subtle bg-surface-1 hover:border-strong'} transition`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-medium leading-tight text-fg">{r.title}</h4>
        {typeof score === 'number' ? <Badge tone={score >= 60 ? 'mint' : score >= 30 ? 'cyan' : 'amber'}>{score}% match</Badge>
          : <button onClick={() => onDelete(r.id)} className="text-fg-muted hover:text-danger"><Trash2 size={14} /></button>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {r.targetRole && <Badge tone="violet">{r.targetRole}</Badge>}
        <Badge>{r.mode}</Badge>
      </div>
      {r.skillsHave && <p className="mt-2 text-[11px] text-fg-secondary"><span className="text-fg-muted">Has:</span> {r.skillsHave}</p>}
      {r.skillsNeed && <p className="text-[11px] text-fg-secondary"><span className="text-fg-muted">Needs:</span> {r.skillsNeed}</p>}
      <div className="mt-auto flex gap-2 pt-3">
        <Button size="sm" variant="soft" onClick={() => onView(r)}><Eye size={13} /> View profile</Button>
        {!primary && <Button size="sm" onClick={() => alert('Collaboration requests will be sendable once partner messaging is live.')}><Handshake size={13} /> Request</Button>}
      </div>
    </div>
  );
}
