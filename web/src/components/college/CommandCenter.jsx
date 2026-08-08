import { useMemo, useState } from 'react';
import {
  Users, BarChart3, GraduationCap, ShieldCheck, Flame,
  AlertTriangle, Activity as ActivityIcon, Filter, Download, CalendarClock, Bell, Eye, ClipboardList,
  Trophy, IndianRupee, Target,
} from 'lucide-react';
import { Badge, Button, EmptyState, Spinner, Modal, Field, Input } from '../ui/kit.jsx';
import { SectionCard, StatCard } from '../../views/common.jsx';
import { College } from '../../lib/api.js';
import TrendStrip from './TrendStrip.jsx';
import StudentDrilldown from './StudentDrilldown.jsx';

/* ============================================================
   PLACEMENT-CELL COMMAND CENTER  (advanced observability)
   ------------------------------------------------------------
   One live control room over /api/college/observability:
   KPI strip → verification funnel → readiness & engagement →
   branch/batch performance matrix → skill coverage (declared vs
   verified) → weekly momentum → at-risk register → ranked roster
   with per-student drill-down. All figures are server-computed,
   deterministic and scoped to the caller's own college.
   ============================================================ */

const FUNNEL_LABELS = {
  registered: 'Registered', profile_complete: 'Profile complete', building: 'Building',
  submitted: 'In review', verified: 'Verified', recruiter_ready: 'Recruiter-ready',
};
const ENGAGE_META = [
  ['active7', 'Active · 7d', '#57E6A8'], ['active30', 'Active · 30d', '#6EE0F2'],
  ['dormant', 'Dormant', '#EAC97C'], ['never', 'Never active', '#FB7185'],
];
const STAGE_TONES = ['#8A958D', '#8FE3F7', '#6EE0F2', '#EAC97C', '#57E6A8', '#BCA8FF'];
const heatBg = (v) => (v == null ? 'transparent' : `rgba(188,168,255,${0.06 + 0.5 * Math.min(1, v / 100)})`);

/* ---- Verification funnel — proportional stage bars with conversion. */
function Funnel({ funnel = [] }) {
  const total = funnel.reduce((s, f) => s + f.count, 0) || 1;
  return (
    <div className="space-y-1.5">
      {funnel.map((f, i) => {
        const reached = funnel.slice(i).reduce((s, x) => s + x.count, 0); // at-or-beyond stage
        const pct = Math.round((reached / total) * 100);
        const width = Math.max(3, pct);
        return (
          <div key={f.stage} className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-[11px] uppercase tracking-wider text-fg-muted">{FUNNEL_LABELS[f.stage] || f.stage}</span>
            <div className="h-6 flex-1 overflow-hidden rounded-md bg-surface-1">
              <div className="flex h-full items-center rounded-md pl-2 text-[11px] font-medium text-ink-950"
                style={{ width: `${width}%`, background: STAGE_TONES[i] }}>
                {reached}
              </div>
            </div>
            <span className="w-10 shrink-0 text-right font-mono text-[11px] text-fg-muted">{pct}%</span>
          </div>
        );
      })}
      <p className="pt-1 text-[11px] text-fg-muted">Each bar counts students at that stage or beyond — the drop between bars is your conversion loss.</p>
    </div>
  );
}

function Distribution({ buckets = [], labels = [] }) {
  const max = Math.max(...buckets, 1);
  return (
    <div className="flex h-28 items-end gap-2">
      {buckets.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <span className="font-mono text-[10px] text-fg-muted">{v}</span>
          <div className="w-full rounded-t-md bg-aurora-cta" style={{ height: `${Math.max(4, (v / max) * 84)}px`, opacity: 0.55 + 0.45 * (i / 4) }} />
          <span className="text-[10px] text-fg-muted">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

function Engagement({ engagement = {} }) {
  const total = ENGAGE_META.reduce((s, [k]) => s + (engagement[k] || 0), 0) || 1;
  return (
    <div>
      <div className="mb-3 flex h-3 w-full overflow-hidden rounded-full bg-surface-1">
        {ENGAGE_META.map(([k, , color]) => (
          <div key={k} style={{ width: `${((engagement[k] || 0) / total) * 100}%`, background: color }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {ENGAGE_META.map(([k, label, color]) => (
          <div key={k} className="flex items-center gap-2 text-[12px] text-fg-secondary">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            {label} <span className="ml-auto font-mono text-fg-secondary">{engagement[k] || 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Matrix({ rows = [], keyLabel = 'Branch' }) {
  if (!rows.length) return <EmptyState icon={BarChart3} title="No data yet" hint="Fills in as students link to your college." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[10px] uppercase tracking-wider text-fg-muted">
          <tr>
            <th className="px-2 py-1.5">{keyLabel}</th><th className="px-2 py-1.5">Students</th>
            <th className="px-2 py-1.5">Avg readiness</th><th className="px-2 py-1.5">Avg resume</th>
            <th className="px-2 py-1.5">Verified %</th><th className="px-2 py-1.5">Recruiter-ready %</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((r) => (
            <tr key={r.key} className="border-t border-subtle">
              <td className="px-2 py-1.5 text-fg">{r.key}</td>
              <td className="px-2 py-1.5 font-mono text-fg-secondary">{r.count}</td>
              <td className="px-2 py-1.5 font-mono" style={{ background: heatBg(r.avgReadiness) }}>{r.avgReadiness ?? '—'}</td>
              <td className="px-2 py-1.5 font-mono" style={{ background: heatBg(r.avgResume) }}>{r.avgResume ?? '—'}</td>
              <td className="px-2 py-1.5 font-mono" style={{ background: heatBg(r.verifiedPct) }}>{r.verifiedPct}%</td>
              <td className="px-2 py-1.5 font-mono" style={{ background: heatBg(r.recruiterReadyPct) }}>{r.recruiterReadyPct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---- Declared vs verified per skill — the credibility gap chart. */
function SkillCoverage({ skillMatrix = [] }) {
  if (!skillMatrix.length) return <EmptyState icon={Flame} title="No skill data yet" hint="Appears as students declare and verify skills." />;
  const max = Math.max(...skillMatrix.map((s) => s.declared), 1);
  return (
    <div className="space-y-1.5">
      {skillMatrix.slice(0, 12).map((s) => (
        <div key={s.skill} className="flex items-center gap-2 text-[12px]">
          <span className="w-28 shrink-0 truncate text-fg-secondary">{s.skill}</span>
          <div className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-surface-1">
            <div className="absolute inset-y-0 left-0 rounded-full bg-surface-2" style={{ width: `${(s.declared / max) * 100}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-aurora-mint/70" style={{ width: `${(s.verified / max) * 100}%` }} />
          </div>
          <span className="w-20 shrink-0 text-right font-mono text-fg-muted">{s.verified}/{s.declared}</span>
        </div>
      ))}
      <div className="flex gap-4 pt-1 text-[11px] text-fg-muted">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-aurora-mint/70" /> verified</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-surface-2" /> declared</span>
      </div>
    </div>
  );
}

function Momentum({ momentum = [] }) {
  const max = Math.max(...momentum.map((m) => (m.counts.verification || 0) + (m.counts.resume || 0)), 1);
  return (
    <div>
      <div className="flex h-24 items-end gap-1.5">
        {momentum.map((m) => (
          <div key={m.week} className="flex flex-1 flex-col justify-end gap-px" title={`${m.week}: ${m.counts.verification} verifications, ${m.counts.resume} resume analyses`}>
            <div className="w-full rounded-t-sm bg-aurora-mint/80" style={{ height: `${((m.counts.verification || 0) / max) * 72}px` }} />
            <div className="w-full bg-aurora-cyan/60" style={{ height: `${((m.counts.resume || 0) / max) * 72}px` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-fg-muted">
        <span>{momentum[0]?.week}</span><span>{momentum[momentum.length - 1]?.week}</span>
      </div>
      <div className="mt-1 flex gap-4 text-[11px] text-fg-muted">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-aurora-mint/80" /> project verifications</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-aurora-cyan/60" /> resume analyses</span>
      </div>
    </div>
  );
}

function RiskRegister({ risks = [], onOpen, onNudge, nudgeStatus }) {
  if (!risks.length) return <EmptyState icon={ShieldCheck} title="No students at risk" hint="Rule-based flags appear here (no verified proof, stalled review, inactivity…)." />;
  return (
    <div className="space-y-2">
      {risks.slice(0, 10).map((r) => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-subtle bg-surface-1 px-3 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm text-fg">
              <span className="truncate">{r.name}</span>
              <span className="text-[11px] text-fg-muted">{[r.branch, r.batch].filter(Boolean).join(' · ')}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {r.flags.map((f) => <Badge key={f.code} tone={f.weight >= 3 ? 'rose' : f.weight === 2 ? 'amber' : 'default'}>{f.label}</Badge>)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="mr-1 font-mono text-[11px] text-fg-muted">sev {r.severity}</span>
            <Button size="sm" variant="soft" onClick={() => onNudge(r.id)}><Bell size={12} /></Button>
            <Button size="sm" variant="soft" onClick={() => onOpen(r.id)}><Eye size={12} /> View</Button>
          </div>
        </div>
      ))}
      {nudgeStatus && <p className="text-[12px] text-fg-muted">{nudgeStatus}</p>}
    </div>
  );
}

const ROSTER_SORTS = [
  ['readinessScore', 'Readiness'], ['resumeScore', 'Resume'], ['projectsVerified', 'Verified'],
  ['totalVerifiedXp', 'XP'], ['riskSeverity', 'Risk'],
];

function Roster({ roster = [], onOpen, selected = new Set(), onToggle, onToggleAll }) {
  const [sortKey, setSortKey] = useState('readinessScore');
  const [stage, setStage] = useState('');
  const rows = useMemo(() => {
    let out = roster;
    if (stage) out = out.filter((r) => r.funnelStage === stage);
    return [...out].sort((a, b) => (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0));
  }, [roster, sortKey, stage]);
  const allVisibleSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
        <Filter size={13} className="text-fg-muted" />
        <select value={stage} onChange={(e) => setStage(e.target.value)} className="rounded-lg border border-field-border bg-field px-2 py-1 text-fg-secondary">
          <option value="">All stages</option>
          {Object.entries(FUNNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="ml-2 text-fg-muted">Sort:</span>
        {ROSTER_SORTS.map(([k, label]) => (
          <button key={k} onClick={() => setSortKey(k)}
            className={`rounded-lg border px-2 py-1 transition ${sortKey === k ? 'border-aurora-violet/40 bg-aurora-violet/10 text-brand' : 'border-subtle text-fg-secondary hover:border-strong'}`}>
            {label}
          </button>
        ))}
        <span className="ml-auto font-mono text-fg-muted">{rows.length} students</span>
      </div>
      <div className="max-h-[420px] overflow-auto rounded-xl border border-subtle">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-base text-left text-[10px] uppercase tracking-wider text-fg-muted">
            <tr>
              <th className="px-3 py-2">
                <input type="checkbox" className="h-3.5 w-3.5 accent-violet-400" checked={allVisibleSelected}
                  onChange={() => onToggleAll?.(rows.map((r) => r.id), !allVisibleSelected)} aria-label="Select all visible" />
              </th>
              <th className="px-3 py-2">Student</th><th className="px-2 py-2">Stage</th>
              <th className="px-2 py-2">Readiness</th><th className="px-2 py-2">Resume</th>
              <th className="px-2 py-2">Verified</th><th className="px-2 py-2">Pending</th>
              <th className="px-2 py-2">XP</th><th className="px-2 py-2">Active</th><th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-subtle hover:bg-surface-1 ${selected.has(r.id) ? 'bg-aurora-violet/[0.05]' : ''}`}>
                <td className="px-3 py-2">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-violet-400" checked={selected.has(r.id)}
                    onChange={() => onToggle?.(r.id)} aria-label={`Select ${r.name || r.email}`} />
                </td>
                <td className="px-3 py-2">
                  <div className="text-fg">{r.name || r.email}</div>
                  <div className="text-[11px] text-fg-muted">{[r.branch, r.batch].filter(Boolean).join(' · ') || '—'}</div>
                </td>
                <td className="px-2 py-2 text-[11px] text-fg-secondary">{FUNNEL_LABELS[r.funnelStage]}</td>
                <td className="px-2 py-2 font-mono" style={{ background: heatBg(r.readinessScore) }}>{r.readinessScore ?? '—'}</td>
                <td className="px-2 py-2 font-mono text-fg-secondary">{r.resumeScore ?? '—'}</td>
                <td className="px-2 py-2">{r.projectsVerified > 0 ? <Badge tone="mint">{r.projectsVerified}</Badge> : '—'}</td>
                <td className="px-2 py-2">{r.projectsPending > 0 ? <Badge tone="amber">{r.projectsPending}</Badge> : '—'}</td>
                <td className="px-2 py-2 font-mono text-fg-secondary">{r.totalVerifiedXp || 0}</td>
                <td className="px-2 py-2 text-[11px] text-fg-muted">{{ active7: '≤7d', active30: '≤30d', dormant: '30d+', never: 'never' }[r.engagement]}</td>
                <td className="px-2 py-2"><Button size="sm" variant="soft" onClick={() => onOpen(r.id)}><Eye size={12} /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---- Bulk actions over the selected roster rows: nudge + assign task.
        Both are REAL — in-app delivery is guaranteed, email is attempted
        when configured, and the outcome line reports exactly what happened. */
function BulkActionModal({ mode, count, onClose, onSend }) {
  const isTask = mode === 'task';
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const send = async () => {
    setBusy(true); setResult('');
    try {
      const r = await onSend({ title: title.trim(), body: body.trim(), dueAt: dueAt || null });
      setResult(r?.message || (r?.ok ? 'Done.' : r?.reason === 'db_off' ? 'A database connection is required.' : 'Failed.'));
      if (r?.ok) { setTitle(''); setBody(''); }
    } catch (e) { setResult(e?.message || 'Failed.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={isTask ? `Assign a task · ${count} student${count === 1 ? '' : 's'}` : `Send a nudge · ${count} student${count === 1 ? '' : 's'}`}>
      <div className="space-y-3">
        <Field label={isTask ? 'Task title' : 'Title (optional)'}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={isTask ? 'e.g. Submit one project for verification this week' : 'e.g. Placement season prep — update your readiness'} />
        </Field>
        <Field label={isTask ? 'Details (optional)' : 'Message (optional)'}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
            placeholder={isTask ? 'What exactly should they do, and by when?' : 'Leave blank for the standard nudge text.'}
            className="w-full rounded-xl border border-field-border bg-field p-3 text-[13px] text-fg placeholder:text-fg-muted focus:border-aurora-violet/50 focus:outline-none" />
        </Field>
        {isTask && (
          <Field label="Due date (optional)">
            <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="max-w-[190px]" />
          </Field>
        )}
        {result && <p className="text-[12.5px] text-fg-secondary">{result}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="soft" onClick={onClose}>Close</Button>
          <Button onClick={send} disabled={busy || (isTask && title.trim().length < 3)}>
            {busy ? 'Sending…' : isTask ? <><ClipboardList size={13} /> Assign task</> : <><Bell size={13} /> Send nudge</>}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function CommandCenter({ data, loading, error, onRetry, go }) {
  const [drill, setDrill] = useState(null); // student id
  const [nudgeStatus, setNudgeStatus] = useState('');
  const [exporting, setExporting] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [bulkMode, setBulkMode] = useState(''); // '' | 'nudge' | 'task'

  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-muted"><Spinner /> Assembling command center…</div>;
  if (error) {
    return <EmptyState icon={AlertTriangle} title="Couldn’t load observability" hint={error}
      action={onRetry ? <Button size="sm" variant="soft" onClick={onRetry}>Retry</Button> : null} />;
  }
  const d = data || {};
  const k = d.kpis || {};

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = (ids, on) => setSelected((prev) => {
    const next = new Set(prev);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    return next;
  });

  const nudge = async (id) => {
    setNudgeStatus('Sending nudge…');
    try { const r = await College.notify([id]); setNudgeStatus(r?.ok ? (r.message || 'Nudge delivered in-app.') : (r?.message || 'Nudge failed.')); }
    catch { setNudgeStatus('Nudge failed.'); }
  };

  const bulkSend = async ({ title, body, dueAt }) => {
    const ids = [...selected];
    if (bulkMode === 'task') {
      return College.assignTask({ studentIds: ids, title, description: body, dueAt: dueAt || null });
    }
    return College.notify(ids, { title, message: body });
  };

  const exportFull = async () => {
    setExporting('Preparing full export…');
    try {
      const res = await College.exportCsv(true);
      if (!res?.ok) { setExporting('Export failed.'); return; }
      const blob = new Blob([res.csv || ''], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'college-observability.csv'; a.click();
      URL.revokeObjectURL(url);
      setExporting(`Exported ${res.rows} rows × ${String(res.csv || '').split('\n')[0].split(',').length} columns.`);
    } catch (e) { setExporting(e?.message || 'Export failed.'); }
  };

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard i={0} icon={Users} tone="violet" label="Students" value={String(k.students ?? 0)} hint={`${k.active7 ?? 0} active this week`} />
        <StatCard i={1} icon={BarChart3} tone="cyan" label="Avg readiness" value={String(k.avgReadiness ?? 0)} hint={`resume avg ${k.avgResume ?? 0}`} />
        <StatCard i={2} icon={ShieldCheck} tone="mint" label="Recruiter-ready" value={String(k.recruiterReady ?? 0)} hint={`${k.verifiedStudents ?? 0} with verified proof`} />
        <StatCard i={3} icon={AlertTriangle} tone="amber" label="At risk" value={String(k.atRisk ?? 0)} hint={`${k.pendingReviews ?? 0} reviews pending`} />
      </div>

      {/* Outcomes sit beside readiness deliberately: a cohort can look ready
          and still not be getting placed, and that gap is the whole point. */}
      {d.placement && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard i={0} icon={Trophy} tone="mint" label="Placement rate" value={`${d.placement.placementRate ?? 0}%`} hint={`${d.placement.placed ?? 0} placed · ${d.placement.offers ?? 0} offer(s)`} onClick={() => go?.('placement')} />
          <StatCard i={1} icon={IndianRupee} tone="violet" label="Median package" value={d.placement.medianCtc > 0 ? `₹${Number(d.placement.medianCtc).toFixed(2)}L` : '—'} hint={d.placement.highestCtc > 0 ? `highest ₹${Number(d.placement.highestCtc).toFixed(2)}L` : 'no packages recorded'} onClick={() => go?.('placement')} />
          <StatCard i={2} icon={CalendarClock} tone="cyan" label="Open drives" value={String(d.placement.activeDrives ?? 0)} hint={`${d.placement.drives ?? 0} total`} onClick={() => go?.('drives')} />
          <StatCard i={3} icon={Target} tone="amber" label="Ready, not placed" value={String(Math.max(0, (k.recruiterReady ?? 0) - (d.placement.placed ?? 0)))} hint="prepared and still available" onClick={() => go?.('placement')} />
        </div>
      )}

      {/* Movement, not just level. */}
      <SectionCard title="Movement" eyebrow="How the cohort has shifted, not just where it stands">
        <TrendStrip trends={d.trends} />
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Verification funnel" eyebrow="Registered → recruiter-ready">
          <Funnel funnel={d.funnel || []} />
        </SectionCard>
        <SectionCard title="Cohort health" eyebrow="Readiness distribution · engagement">
          <Distribution buckets={d.readiness?.buckets || []} labels={d.readiness?.labels || []} />
          <div className="mt-4 border-t border-subtle pt-4"><Engagement engagement={d.engagement || {}} /></div>
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Branch performance" eyebrow="Heat = higher value">
          <Matrix rows={d.branchMatrix || []} keyLabel="Branch" />
        </SectionCard>
        <SectionCard title="Batch performance">
          <Matrix rows={d.batchMatrix || []} keyLabel="Batch" />
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Skill coverage" eyebrow="Verified vs declared — the credibility gap">
          <SkillCoverage skillMatrix={d.skillMatrix || []} />
        </SectionCard>
        <SectionCard title="Momentum" eyebrow="Last 8 weeks"
          action={<span className="inline-flex items-center gap-1 text-[11px] text-fg-muted"><CalendarClock size={11} /> {d.driveCoverage?.openDrives ?? 0} open drives</span>}>
          <Momentum momentum={d.momentum || []} />
        </SectionCard>
      </div>

      <SectionCard title="At-risk register" eyebrow="Deterministic rule-based flags — no AI in any verdict"
        action={<Button size="sm" variant="soft" onClick={() => go?.('directory')}>Open directory</Button>}>
        <RiskRegister risks={d.riskRegister || []} onOpen={setDrill} onNudge={nudge} nudgeStatus={nudgeStatus} />
      </SectionCard>

      <SectionCard title="Ranked roster" eyebrow="Every student · sortable · select for bulk actions"
        action={<div className="flex items-center gap-2">
          {exporting && <span className="text-[12px] text-fg-muted">{exporting}</span>}
          <Button size="sm" variant="soft" onClick={exportFull}><Download size={13} /> Full CSV</Button>
        </div>}>
        {selected.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-aurora-violet/30 bg-aurora-violet/[0.07] px-3 py-2">
            <span className="text-[12.5px] font-medium text-fg">{selected.size} selected</span>
            <Button size="sm" onClick={() => setBulkMode('nudge')}><Bell size={12} /> Nudge</Button>
            <Button size="sm" variant="soft" onClick={() => setBulkMode('task')}><ClipboardList size={12} /> Assign task</Button>
            <button onClick={() => setSelected(new Set())} className="ml-auto text-[11px] text-fg-secondary underline-offset-2 hover:underline">Clear</button>
          </div>
        )}
        {(d.roster || []).length === 0
          ? <EmptyState icon={GraduationCap} title="No students yet" hint="The ranked roster appears once students link to your college." />
          : <Roster roster={d.roster} onOpen={setDrill} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />}
      </SectionCard>

      <p className="flex items-center gap-1.5 text-[11px] text-fg-muted">
        <ActivityIcon size={11} /> Computed {d.computedAt ? new Date(d.computedAt).toLocaleString() : '—'} · {d.version} · scoped to your institution only
      </p>

      {bulkMode && <BulkActionModal mode={bulkMode} count={selected.size} onClose={() => setBulkMode('')} onSend={bulkSend} />}
      <StudentDrilldown studentId={drill} open={Boolean(drill)} onClose={() => setDrill(null)} />
    </div>
  );
}
