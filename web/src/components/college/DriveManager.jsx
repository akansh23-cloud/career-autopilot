/* ============================================================
   Placement drive manager
   ------------------------------------------------------------
   Drives are what a placement cell actually does all day. This
   replaces the old two-field stub with the real object: eligibility
   rules that are evaluated rather than stored and ignored, a cohort
   split that explains every exclusion, per-student stage tracking,
   and a live funnel.

   Every number on screen comes from the server's deterministic
   placement engine. Nothing here recomputes a statistic locally, so
   the drive list, the funnel and the placement report can never
   disagree with one another.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock, Plus, Search, ChevronLeft, Trash2, Pencil, Users, CheckCircle2,
  AlertTriangle, IndianRupee, Filter, Save, X,
} from 'lucide-react';
import { SectionCard, StatCard } from '../../views/common.jsx';
import { Button, Badge, Spinner, EmptyState, Input, Field, Modal } from '../ui/kit.jsx';
import { College } from '../../lib/api.js';

const STAGE_TONES = {
  applied: 'default', shortlisted: 'cyan', interviewed: 'violet',
  offered: 'amber', accepted: 'mint', rejected: 'default', withdrawn: 'default',
};

const STATUS_TONES = { open: 'mint', in_progress: 'cyan', closed: 'default', cancelled: 'default' };
const STATUS_LABELS = { open: 'Open', in_progress: 'In progress', closed: 'Closed', cancelled: 'Cancelled' };

const lpa = (n) => (Number(n) > 0 ? `₹${Number(n).toFixed(2)}L` : '—');

function csvToList(v) {
  return String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
}
function listToCsv(v) {
  return Array.isArray(v) ? v.join(', ') : String(v || '');
}

/* ------------------------------------------------------------------ */
/* Create / edit drive                                                 */
/* ------------------------------------------------------------------ */
const BLANK = {
  title: '', company: '', role: '', location: '', ctcLpa: '', driveDate: '', status: 'open', notes: '',
  branches: '', batches: '', years: '', skills: '',
  minReadiness: '', minResume: '', minVerifiedProjects: '', requireVerifiedSkills: false,
};

function driveToForm(d) {
  if (!d) return { ...BLANK };
  const e = d.eligibility || {};
  return {
    title: d.title || '', company: d.company || '', role: d.role || '', location: d.location || '',
    ctcLpa: d.ctcLpa ?? '', driveDate: d.driveDate || '', status: d.status || 'open', notes: d.notes || '',
    branches: listToCsv(e.branches), batches: listToCsv(e.batches), years: listToCsv(e.years),
    skills: listToCsv(e.skills),
    minReadiness: e.minReadiness ?? '', minResume: e.minResume ?? '',
    minVerifiedProjects: e.minVerifiedProjects ?? '',
    requireVerifiedSkills: Boolean(e.requireVerifiedSkills),
  };
}

function formToPayload(f) {
  const numOrNull = (v) => (v === '' || v == null ? null : Number(v));
  return {
    title: f.title.trim(), company: f.company.trim(), role: f.role.trim(), location: f.location.trim(),
    ctcLpa: numOrNull(f.ctcLpa), driveDate: f.driveDate, status: f.status, notes: f.notes,
    eligibility: {
      branches: csvToList(f.branches), batches: csvToList(f.batches),
      years: csvToList(f.years), skills: csvToList(f.skills),
      requireVerifiedSkills: Boolean(f.requireVerifiedSkills),
      minReadiness: numOrNull(f.minReadiness), minResume: numOrNull(f.minResume),
      minVerifiedProjects: numOrNull(f.minVerifiedProjects),
    },
  };
}

function DriveForm({ open, initial, onClose, onSave, saving }) {
  const [f, setF] = useState(() => driveToForm(initial));
  useEffect(() => { if (open) setF(driveToForm(initial)); }, [open, initial]);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} width="max-w-3xl" title={initial ? 'Edit drive' : 'New placement drive'}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Drive title *"><Input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Backend Engineer — Campus Hire 2026" /></Field>
          <Field label="Company"><Input value={f.company} onChange={(e) => set('company', e.target.value)} placeholder="e.g. Northwind Systems" /></Field>
          <Field label="Role"><Input value={f.role} onChange={(e) => set('role', e.target.value)} placeholder="e.g. SDE-1" /></Field>
          <Field label="Location"><Input value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Pune / Remote" /></Field>
          <Field label="Package (LPA)" hint="Used as the default CTC when you mark offers">
            <Input type="number" step="0.1" value={f.ctcLpa} onChange={(e) => set('ctcLpa', e.target.value)} placeholder="e.g. 12" />
          </Field>
          <Field label="Drive date"><Input type="date" value={f.driveDate} onChange={(e) => set('driveDate', e.target.value)} /></Field>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-fg"><Filter size={14} /> Eligibility criteria</p>
          <p className="mb-3 text-xs text-fg-muted">
            Students are matched against these rules automatically. Leave a field blank to place no restriction on it.
            Every exclusion is shown with its reason, so you can tell a student exactly why they didn’t qualify.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Branches" hint="Comma separated — e.g. CSE, IT"><Input value={f.branches} onChange={(e) => set('branches', e.target.value)} placeholder="CSE, IT" /></Field>
            <Field label="Batches" hint="Comma separated — e.g. 2026, 2027"><Input value={f.batches} onChange={(e) => set('batches', e.target.value)} placeholder="2026" /></Field>
            <Field label="Years"><Input value={f.years} onChange={(e) => set('years', e.target.value)} placeholder="3rd, 4th" /></Field>
            <Field label="Required skills"><Input value={f.skills} onChange={(e) => set('skills', e.target.value)} placeholder="Java, SQL" /></Field>
            <Field label="Min readiness"><Input type="number" value={f.minReadiness} onChange={(e) => set('minReadiness', e.target.value)} placeholder="0–100" /></Field>
            <Field label="Min resume score"><Input type="number" value={f.minResume} onChange={(e) => set('minResume', e.target.value)} placeholder="0–100" /></Field>
            <Field label="Min verified projects"><Input type="number" value={f.minVerifiedProjects} onChange={(e) => set('minVerifiedProjects', e.target.value)} placeholder="e.g. 1" /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-fg-secondary">
              <input type="checkbox" checked={f.requireVerifiedSkills} onChange={(e) => set('requireVerifiedSkills', e.target.checked)} />
              Skills must be verified
            </label>
          </div>
        </div>

        {initial && (
          <Field label="Status">
            <select
              value={f.status} onChange={(e) => set('status', e.target.value)}
              className="w-full rounded-xl border border-subtle bg-surface-1 px-3 py-2 text-sm text-fg"
            >
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k} className="bg-slate-900">{v}</option>)}
            </select>
          </Field>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="soft" onClick={onClose}>Cancel</Button>
          <Button disabled={!f.title.trim() || saving} onClick={() => onSave(formToPayload(f))}>
            {saving ? <Spinner /> : <Save size={14} />} {initial ? 'Save changes' : 'Create drive'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Funnel bars                                                         */
/* ------------------------------------------------------------------ */
function Funnel({ funnel }) {
  const stages = funnel?.stages || [];
  const top = stages[0]?.count || 0;
  if (!top) {
    return <p className="py-6 text-center text-sm text-fg-muted">No students recorded against this drive yet.</p>;
  }
  return (
    <div className="space-y-2">
      {stages.map((s) => (
        <div key={s.id} className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-xs text-fg-secondary">{s.label}</span>
          <div className="h-6 flex-1 overflow-hidden rounded-lg bg-surface-1">
            <div
              className="h-full rounded-lg bg-gradient-to-r from-aurora-indigo/60 to-aurora-violet transition-all"
              style={{ width: `${Math.max(2, (s.count / top) * 100)}%` }}
            />
          </div>
          <span className="w-14 shrink-0 text-right text-sm font-semibold text-fg">{s.count}</span>
          <span className="w-12 shrink-0 text-right text-[11px] text-fg-muted">{s.conversionFromTop}%</span>
        </div>
      ))}
      {(funnel.rejected > 0 || funnel.withdrawn > 0) && (
        <p className="pt-1 text-xs text-fg-muted">
          {funnel.rejected} not selected · {funnel.withdrawn} withdrawn. Students who cleared rounds before being
          rejected still count in those rounds above.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drive detail — cohort + outcome marking                             */
/* ------------------------------------------------------------------ */
function DriveDetail({ driveId, onBack, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [showIneligible, setShowIneligible] = useState(false);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [markOpen, setMarkOpen] = useState(false);
  const [markStage, setMarkStage] = useState('applied');
  const [markCtc, setMarkCtc] = useState('');
  const [editing, setEditing] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try { setData(await College.driveCohort(driveId)); }
    catch (e) { setError(e?.message || 'Could not load this drive.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); setSelected(new Set()); /* eslint-disable-next-line */ }, [driveId]);

  const drive = data?.drive;
  const stages = data?.stages || [];

  const list = useMemo(() => {
    const rows = showIneligible ? (data?.ineligible || []) : (data?.eligible || []);
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => `${r.name || ''} ${r.email || ''}`.toLowerCase().includes(needle));
  }, [data, showIneligible, q]);

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((prev) => {
    const ids = list.map((r) => r.id);
    const all = ids.every((id) => prev.has(id));
    const next = new Set(prev);
    ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
    return next;
  });

  const applyStage = async () => {
    if (!selected.size) return;
    setSaving(true); setStatus('');
    try {
      const entries = [...selected].map((studentId) => ({
        studentId, stage: markStage,
        ctcLpa: markCtc === '' ? null : Number(markCtc),
      }));
      const r = await College.saveOutcomes(driveId, entries);
      setStatus(r?.ok
        ? `Updated ${r.saved} student(s)${r.skipped ? ` · ${r.skipped} skipped (out of scope)` : ''}.`
        : 'Could not save.');
      setSelected(new Set());
      setMarkOpen(false);
      setMarkCtc('');
      await load();
      onChanged?.();
    } catch (e) { setStatus(e?.message || 'Could not save.'); }
    finally { setSaving(false); }
  };

  const clearOutcome = async (studentId) => {
    setSaving(true);
    try { await College.removeOutcome(driveId, studentId); await load(); onChanged?.(); }
    catch (e) { setStatus(e?.message || 'Could not remove.'); }
    finally { setSaving(false); }
  };

  const saveDrive = async (payload) => {
    setSaving(true);
    try { await College.updateDrive(driveId, payload); setEditing(false); await load(); onChanged?.(); }
    catch (e) { setStatus(e?.message || 'Could not save the drive.'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-muted"><Spinner /> Loading drive…</div>;
  if (error) return <EmptyState icon={AlertTriangle} title="Couldn’t load this drive" hint={error} action={<Button size="sm" variant="soft" onClick={load}>Retry</Button>} />;

  const c = data?.counts || {};
  const offered = (data?.funnel?.stages || []).find((s) => s.id === 'offered')?.count || 0;
  const accepted = (data?.funnel?.stages || []).find((s) => s.id === 'accepted')?.count || 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="soft" onClick={onBack}><ChevronLeft size={14} /> All drives</Button>
        <div className="flex gap-2">
          <Button size="sm" variant="soft" onClick={() => setEditing(true)}><Pencil size={13} /> Edit drive</Button>
        </div>
      </div>

      <SectionCard
        title={drive?.title || 'Drive'}
        eyebrow={[drive?.company, drive?.role, drive?.location].filter(Boolean).join(' · ') || 'No company set'}
        action={<Badge tone={STATUS_TONES[drive?.status] || 'default'}>{STATUS_LABELS[drive?.status] || drive?.status}</Badge>}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard i={0} icon={Users} tone="violet" label="Eligible" value={String(c.eligible ?? 0)} hint={`${c.ineligible ?? 0} excluded of ${c.total ?? 0}`} />
          <StatCard i={1} icon={CheckCircle2} tone="cyan" label="Participating" value={String(data?.funnel?.participants ?? 0)} hint={`${data?.funnel?.offerRate ?? 0}% offer rate`} />
          <StatCard i={2} icon={CalendarClock} tone="amber" label="Offers" value={String(offered)} />
          <StatCard i={3} icon={IndianRupee} tone="mint" label="Accepted" value={String(accepted)} hint={drive?.ctcLpa ? `advertised ${lpa(drive.ctcLpa)}` : 'no package set'} />
        </div>
      </SectionCard>

      <SectionCard title="Drive funnel" eyebrow="Counted at each student’s furthest reached round">
        <Funnel funnel={data?.funnel} />
      </SectionCard>

      <SectionCard
        title={showIneligible ? 'Not eligible' : 'Eligible students'}
        eyebrow={showIneligible ? 'Each row shows the exact rule that excluded the student' : 'Select students, then record what happened to them'}
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="soft" onClick={() => { setShowIneligible((v) => !v); setSelected(new Set()); }}>
              {showIneligible ? `Eligible (${c.eligible ?? 0})` : `Not eligible (${c.ineligible ?? 0})`}
            </Button>
            {!showIneligible && (
              <Button size="sm" disabled={!selected.size} onClick={() => setMarkOpen(true)}>
                Record outcome{selected.size ? ` (${selected.size})` : ''}
              </Button>
            )}
          </div>
        }
      >
        <div className="mb-3 flex items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" className="max-w-xs" />
          {status && <span className="text-xs text-fg-secondary">{status}</span>}
        </div>

        {list.length === 0 ? (
          <EmptyState
            icon={Users}
            title={showIneligible ? 'Nobody was excluded' : 'No eligible students'}
            hint={showIneligible
              ? 'Every student in your cohort meets this drive’s criteria.'
              : 'Loosen the eligibility criteria on this drive, or check that student profiles have branch and batch filled in.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  {!showIneligible && (
                    <th className="px-2 py-2 w-8">
                      <input
                        type="checkbox" aria-label="Select all"
                        checked={list.length > 0 && list.every((r) => selected.has(r.id))}
                        onChange={toggleAll}
                      />
                    </th>
                  )}
                  <th className="px-2 py-2">Student</th>
                  <th className="px-2 py-2">Branch</th>
                  <th className="px-2 py-2">Readiness</th>
                  <th className="px-2 py-2">Resume</th>
                  <th className="px-2 py-2">{showIneligible ? 'Why excluded' : 'Stage'}</th>
                  {!showIneligible && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="border-t border-white/6 hover:bg-surface-1">
                    {!showIneligible && (
                      <td className="px-2 py-2">
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name || r.email}`} />
                      </td>
                    )}
                    <td className="px-2 py-2 text-fg">{r.name || r.email}</td>
                    <td className="px-2 py-2 text-fg-secondary">{r.branch || '—'} · {r.batch || '—'}</td>
                    <td className="px-2 py-2">{r.readinessScore ?? '—'}</td>
                    <td className="px-2 py-2">{r.resumeScore ?? '—'}</td>
                    <td className="px-2 py-2">
                      {showIneligible ? (
                        <span className="text-xs text-amber-glow">{(r.reasons || []).join(' · ')}</span>
                      ) : r.outcome ? (
                        <span className="flex items-center gap-1.5">
                          <Badge tone={STAGE_TONES[r.outcome.stage] || 'default'}>
                            {(stages.find((s) => s.id === r.outcome.stage) || {}).label || r.outcome.stage}
                          </Badge>
                          {r.outcome.ctcLpa != null && <span className="text-xs text-fg-secondary">{lpa(r.outcome.ctcLpa)}</span>}
                        </span>
                      ) : <span className="text-xs text-fg-muted">not recorded</span>}
                    </td>
                    {!showIneligible && (
                      <td className="px-2 py-2 text-right">
                        {r.outcome && (
                          <button
                            onClick={() => clearOutcome(r.id)} disabled={saving}
                            className="text-xs text-fg-muted hover:text-amber-glow" title="Clear recorded outcome"
                          ><X size={13} /></button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Record-outcome modal */}
      <Modal open={markOpen} onClose={() => setMarkOpen(false)} title={`Record outcome for ${selected.size} student(s)`}>
        <div className="space-y-3">
          <Field label="Stage">
            <select
              value={markStage} onChange={(e) => setMarkStage(e.target.value)}
              className="w-full rounded-xl border border-subtle bg-surface-1 px-3 py-2 text-sm text-fg"
            >
              {stages.map((s) => <option key={s.id} value={s.id} className="bg-slate-900">{s.label}</option>)}
            </select>
          </Field>
          {(markStage === 'offered' || markStage === 'accepted') && (
            <Field label="Package (LPA)" hint={drive?.ctcLpa ? `Leave blank to use the drive’s ${lpa(drive.ctcLpa)}` : 'Optional, but placement reports need it'}>
              <Input type="number" step="0.1" value={markCtc} onChange={(e) => setMarkCtc(e.target.value)} placeholder="e.g. 12" />
            </Field>
          )}
          <p className="text-xs text-fg-muted">
            Only <span className="text-fg-secondary">Accepted</span> counts as a placement in reports. An outstanding
            offer is tracked but never inflates the placement percentage.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="soft" onClick={() => setMarkOpen(false)}>Cancel</Button>
            <Button onClick={applyStage} disabled={saving}>{saving ? <Spinner /> : null} Apply</Button>
          </div>
        </div>
      </Modal>

      <DriveForm open={editing} initial={drive} onClose={() => setEditing(false)} onSave={saveDrive} saving={saving} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drive list                                                          */
/* ------------------------------------------------------------------ */
export default function DriveManager() {
  const [drives, setDrives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openDrive, setOpenDrive] = useState(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = async () => {
    setLoading(true); setError('');
    try { const r = await College.drives(); setDrives(r?.drives || []); }
    catch (e) { setError(e?.message || 'Could not load drives.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const create = async (payload) => {
    setSaving(true);
    try { await College.createDrive(payload); setCreating(false); await load(); }
    catch (e) { setError(e?.message || 'Could not create the drive.'); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    setSaving(true);
    try { await College.deleteDrive(confirmDelete.id); setConfirmDelete(null); await load(); }
    catch (e) { setError(e?.message || 'Could not delete the drive.'); }
    finally { setSaving(false); }
  };

  if (openDrive) {
    return <DriveDetail driveId={openDrive} onBack={() => { setOpenDrive(null); load(); }} onChanged={load} />;
  }

  const totals = drives.reduce((a, d) => ({
    eligible: a.eligible + (d.eligibleCount || 0),
    participants: a.participants + (d.participants || 0),
    offered: a.offered + (d.offered || 0),
    placed: a.placed + (d.placed || 0),
  }), { eligible: 0, participants: 0, offered: 0, placed: 0 });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard i={0} icon={CalendarClock} tone="violet" label="Drives" value={String(drives.length)} hint={`${drives.filter((d) => d.status === 'open').length} open`} />
        <StatCard i={1} icon={Users} tone="cyan" label="Applications" value={String(totals.participants)} />
        <StatCard i={2} icon={CheckCircle2} tone="amber" label="Offers" value={String(totals.offered)} />
        <StatCard i={3} icon={IndianRupee} tone="mint" label="Accepted" value={String(totals.placed)} hint="counts as placed" />
      </div>

      <SectionCard
        title="Placement drives"
        eyebrow="Eligibility is evaluated against your live cohort on every load"
        action={<Button size="sm" onClick={() => setCreating(true)}><Plus size={14} /> New drive</Button>}
      >
        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted"><Spinner /> Loading drives…</div>
        ) : error ? (
          <EmptyState icon={AlertTriangle} title="Couldn’t load drives" hint={error} action={<Button size="sm" variant="soft" onClick={load}>Retry</Button>} />
        ) : drives.length === 0 ? (
          <EmptyState
            icon={CalendarClock} title="No drives yet"
            hint="Create a drive with eligibility criteria — the system will work out who qualifies and let you track every round."
            action={<Button size="sm" onClick={() => setCreating(true)}><Plus size={14} /> Create the first drive</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-2 py-2">Drive</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2 text-right">Eligible</th>
                  <th className="px-2 py-2 text-right">Applied</th>
                  <th className="px-2 py-2 text-right">Offers</th>
                  <th className="px-2 py-2 text-right">Placed</th>
                  <th className="px-2 py-2 text-right">Median</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {drives.map((d) => (
                  <tr key={d.id} className="border-t border-white/6 hover:bg-surface-1">
                    <td className="px-2 py-2">
                      <button onClick={() => setOpenDrive(d.id)} className="text-left text-fg hover:text-fg">
                        {d.title}
                        <span className="block text-xs text-fg-muted">{[d.company, d.role].filter(Boolean).join(' · ') || '—'}</span>
                      </button>
                    </td>
                    <td className="px-2 py-2"><Badge tone={STATUS_TONES[d.status] || 'default'}>{STATUS_LABELS[d.status] || d.status}</Badge></td>
                    <td className="px-2 py-2 text-right text-fg-secondary">{d.eligibleCount ?? 0}</td>
                    <td className="px-2 py-2 text-right text-fg-secondary">{d.participants ?? 0}</td>
                    <td className="px-2 py-2 text-right text-fg-secondary">{d.offered ?? 0}</td>
                    <td className="px-2 py-2 text-right">{d.placed > 0 ? <Badge tone="mint">{d.placed}</Badge> : <span className="text-fg-muted">0</span>}</td>
                    <td className="px-2 py-2 text-right text-fg-secondary">{lpa(d.medianCtc)}</td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="soft" onClick={() => setOpenDrive(d.id)}><Search size={12} /> Open</Button>
                        <button onClick={() => setConfirmDelete(d)} className="rounded-lg px-2 text-fg-muted hover:text-amber-glow" title="Delete drive"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <DriveForm open={creating} initial={null} onClose={() => setCreating(false)} onSave={create} saving={saving} />

      <Modal open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} title="Delete this drive?">
        <p className="mb-4 text-sm text-fg-secondary">
          <span className="text-fg">{confirmDelete?.title}</span> and all {confirmDelete?.participants ?? 0} recorded
          student outcome(s) will be removed. Placement figures that included this drive will change. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="soft" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button onClick={remove} disabled={saving}>{saving ? <Spinner /> : <Trash2 size={14} />} Delete drive</Button>
        </div>
      </Modal>
    </div>
  );
}
