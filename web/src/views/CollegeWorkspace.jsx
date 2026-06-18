import { useEffect, useMemo, useState } from 'react';
import {
  Users, GraduationCap, BarChart3, Flame, FolderCheck, FileText,
  CalendarClock, Download, Search, Plus, Bell, ClipboardList,
} from 'lucide-react';
import { PageIntro, SectionCard, StatCard, BarChart } from './common.jsx';
import { Button, Badge, Spinner, EmptyState, Input, Field, Modal } from '../components/ui/kit.jsx';
import { College } from '../lib/api.js';
import { getEffectiveRole } from '../lib/roleCapabilities.js';

const TABS = [
  { id: 'overview', label: 'Overview', icon: GraduationCap },
  { id: 'directory', label: 'Student directory', icon: Users },
  { id: 'readiness', label: 'Placement readiness', icon: BarChart3 },
  { id: 'heatmap', label: 'Skill heatmap', icon: Flame },
  { id: 'analytics', label: 'Batch & branch analytics', icon: BarChart3 },
  { id: 'projects', label: 'Verified projects', icon: FolderCheck },
  { id: 'resume', label: 'Resume readiness', icon: FileText },
  { id: 'drives', label: 'Drive tracker', icon: CalendarClock },
  { id: 'reports', label: 'Reports / export', icon: Download },
];

// Small async-state wrapper: shows loading / error / empty consistently.
function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: null, data: null });
    Promise.resolve()
      .then(fn)
      .then((data) => { if (alive) setState({ loading: false, error: null, data }); })
      .catch((e) => { if (alive) setState({ loading: false, error: e?.message || 'Something went wrong', data: null }); });
    return () => { alive = false; };
  }, deps);
  return state;
}

function Loading({ label = 'Loading…' }) {
  return <div className="flex items-center gap-2 py-10 text-sm text-muted"><Spinner /> {label}</div>;
}
function ErrorState({ message, onRetry }) {
  return (
    <EmptyState icon={FileText} title="Couldn’t load this view" hint={message}
      action={onRetry ? <Button size="sm" variant="soft" onClick={onRetry}>Retry</Button> : null} />
  );
}

export default function CollegeWorkspace({ params = {}, go }) {
  // Defense-in-depth on top of nav filtering + the App.navigate guard: the
  // placement-cell workspace is for verified college staff / admins only. A
  // student who reaches this view by any means (stale state, a direct hash, a
  // race during access-context refresh) sees a small correction card instead of
  // the "Placement cell" / "College workspace" UI — never the college data.
  const effectiveRole = getEffectiveRole();
  const allowed = effectiveRole === 'college_admin' || effectiveRole === 'admin';

  const [tab, setTab] = useState(TABS.some((t) => t.id === params.tab) ? params.tab : 'overview');
  useEffect(() => { if (params.tab && TABS.some((t) => t.id === params.tab)) setTab(params.tab); }, [params.tab]);

  if (!allowed) {
    return (
      <div>
        <PageIntro
          eyebrow="Student workspace"
          title="This is a student account"
          sub="The College / Placement Cell workspace is only available to verified placement-cell staff and admins."
        />
        <SectionCard title="Let’s get you to the right place">
          <p className="mb-4 text-sm text-muted">
            Your account is set up as a student, so college analytics, the student directory and drive tracker don’t apply here. Head to your Project OS to build verified proof-of-work, or open your dashboard.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => go?.('projectstudio')}>Go to Project OS</Button>
            <Button variant="soft" onClick={() => go?.('dash')}>Open dashboard</Button>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div>
      <PageIntro
        eyebrow="Placement cell"
        title="College workspace"
        sub="Scoped to your college only. All student data is limited to your institution."
      />
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
              tab === t.id ? 'border-white/25 bg-white/[0.06] text-white' : 'border-white/8 bg-white/[0.02] text-slate-300 hover:border-white/20'
            }`}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab go={(t) => setTab(t)} />}
      {tab === 'directory' && <DirectoryTab go={go} />}
      {tab === 'readiness' && <ReadinessTab />}
      {tab === 'heatmap' && <HeatmapTab />}
      {tab === 'analytics' && <AnalyticsTab />}
      {tab === 'projects' && <ProjectsTab go={go} />}
      {tab === 'resume' && <ResumeReadinessTab />}
      {tab === 'drives' && <DrivesTab />}
      {tab === 'reports' && <ReportsTab />}
    </div>
  );
}

function OverviewTab({ go }) {
  const { loading, error, data } = useAsync(() => College.overview());
  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;
  const s = data?.summary || {};
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard i={0} icon={Users} tone="violet" label="Students" value={String(s.students ?? 0)} onClick={() => go('directory')} />
        <StatCard i={1} icon={BarChart3} tone="cyan" label="Avg readiness" value={`${s.avgReadiness ?? 0}`} onClick={() => go('readiness')} />
        <StatCard i={2} icon={GraduationCap} tone="mint" label="Placement-ready" value={String(s.placementReady ?? 0)} hint="readiness ≥ 70" />
        <StatCard i={3} icon={FolderCheck} tone="amber" label="With verified projects" value={String(s.withVerifiedProjects ?? 0)} onClick={() => go('projects')} />
      </div>
      {!s.students && (
        <div className="mt-4">
          <EmptyState icon={Users} title="No students linked to your college yet"
            hint="Students appear here once their profile college matches your placement cell. Data shown is always scoped to your institution." />
        </div>
      )}
    </>
  );
}

const FILTER_DEFAULTS = { branch: '', batch: '', year: '', skill: '', minReadiness: '', minResume: '', verifiedOnly: false };

function DirectoryTab({ go }) {
  const [filters, setFilters] = useState(FILTER_DEFAULTS);
  const [applied, setApplied] = useState(FILTER_DEFAULTS);
  const { loading, error, data } = useAsync(() => College.students(applied), [JSON.stringify(applied)]);
  const students = data?.students || [];
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <SectionCard
      title="Student directory"
      action={<Button size="sm" variant="soft" onClick={() => { setFilters(FILTER_DEFAULTS); setApplied(FILTER_DEFAULTS); }}>Reset</Button>}
    >
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Branch"><Input value={filters.branch} onChange={(e) => set('branch', e.target.value)} placeholder="e.g. CSE" /></Field>
        <Field label="Batch / grad year"><Input value={filters.batch} onChange={(e) => set('batch', e.target.value)} placeholder="e.g. 2026" /></Field>
        <Field label="Year"><Input value={filters.year} onChange={(e) => set('year', e.target.value)} placeholder="e.g. 3rd" /></Field>
        <Field label="Skill"><Input value={filters.skill} onChange={(e) => set('skill', e.target.value)} placeholder="e.g. React" /></Field>
        <Field label="Min readiness"><Input type="number" value={filters.minReadiness} onChange={(e) => set('minReadiness', e.target.value)} placeholder="0–100" /></Field>
        <Field label="Min resume score"><Input type="number" value={filters.minResume} onChange={(e) => set('minResume', e.target.value)} placeholder="0–100" /></Field>
        <label className="flex items-center gap-2 self-end text-sm text-slate-300">
          <input type="checkbox" checked={filters.verifiedOnly} onChange={(e) => set('verifiedOnly', e.target.checked)} /> Verified projects only
        </label>
        <Button size="sm" className="self-end" onClick={() => setApplied(filters)}><Search size={14} /> Apply filters</Button>
      </div>

      {loading ? <Loading /> : error ? <ErrorState message={error} /> : students.length === 0 ? (
        <EmptyState icon={Users} title="No students match" hint="Adjust filters, or no students are linked to your college yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2">Name</th><th className="px-2 py-2">Branch</th><th className="px-2 py-2">Batch</th>
                <th className="px-2 py-2">Readiness</th><th className="px-2 py-2">Resume</th><th className="px-2 py-2">Verified</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="border-t border-white/6 hover:bg-white/[0.02]">
                  <td className="px-2 py-2 text-slate-200">{s.name || s.email}</td>
                  <td className="px-2 py-2 text-slate-400">{s.branch || '—'}</td>
                  <td className="px-2 py-2 text-slate-400">{s.batch || '—'}</td>
                  <td className="px-2 py-2">{s.readinessScore ?? '—'}</td>
                  <td className="px-2 py-2">{s.resumeScore ?? '—'}</td>
                  <td className="px-2 py-2">{s.verifiedProjects > 0 ? <Badge tone="mint">{s.verifiedProjects}</Badge> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function ReadinessTab() {
  const { loading, error, data } = useAsync(() => College.students());
  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;
  const students = data?.students || [];
  if (!students.length) return <EmptyState icon={BarChart3} title="No readiness data yet" hint="Readiness appears once students in your college build verified proof." />;
  const buckets = [0, 0, 0, 0, 0];
  students.forEach((s) => { const v = Number(s.readinessScore || 0); buckets[Math.min(4, Math.floor(v / 20))]++; });
  return (
    <SectionCard title="Placement readiness distribution">
      <BarChart data={buckets} labels={['0–19', '20–39', '40–59', '60–79', '80–100']} />
    </SectionCard>
  );
}

function HeatmapTab() {
  const { loading, error, data } = useAsync(() => College.analytics());
  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;
  const heat = data?.skillHeatmap || [];
  if (!heat.length) return <EmptyState icon={Flame} title="No skill data yet" hint="The skill heatmap fills in as students add and verify skills." />;
  const max = Math.max(...heat.map((h) => h.count), 1);
  return (
    <SectionCard title="Skill heatmap" eyebrow="Most common verified/declared skills in your college">
      <div className="flex flex-wrap gap-2">
        {heat.map((h) => (
          <span key={h.skill} className="rounded-lg border border-white/10 px-2.5 py-1 text-sm"
            style={{ background: `rgba(124,92,255,${0.08 + 0.5 * (h.count / max)})` }}>
            {h.skill} <span className="text-slate-400">· {h.count}</span>
          </span>
        ))}
      </div>
    </SectionCard>
  );
}

function AnalyticsTab() {
  const { loading, error, data } = useAsync(() => College.analytics());
  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;
  const batch = data?.batch || [];
  const branch = data?.branch || [];
  const Section = ({ title, rows }) => (
    <SectionCard title={title}>
      {rows.length === 0 ? <EmptyState icon={BarChart3} title="No data yet" hint="Appears once students are linked to your college." /> : (
        <BarChart data={rows.map((r) => r.count)} labels={rows.map((r) => r.key)} />
      )}
    </SectionCard>
  );
  return <div className="grid gap-4 lg:grid-cols-2"><Section title="By batch" rows={batch} /><Section title="By branch" rows={branch} /></div>;
}

function ProjectsTab({ go }) {
  const { loading, error, data } = useAsync(() => College.students({ verifiedOnly: true }));
  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;
  const students = (data?.students || []).filter((s) => s.verifiedProjects > 0);
  return (
    <SectionCard title="Students with verified projects"
      action={<Button size="sm" variant="soft" onClick={() => go && go('sandbox')}>Open proof sandbox</Button>}>
      {students.length === 0 ? (
        <EmptyState icon={FolderCheck} title="No verified projects yet" hint="Verified, proof-backed projects from your college appear here." />
      ) : (
        <ul className="space-y-2">
          {students.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 text-sm">
              <span className="text-slate-200">{s.name || s.email}</span>
              <Badge tone="mint">{s.verifiedProjects} verified</Badge>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function ResumeReadinessTab() {
  const { loading, error, data } = useAsync(() => College.analytics());
  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;
  const r = data?.resumeReadiness || { withResume: 0, total: 0, avgResume: 0 };
  return (
    <SectionCard title="Resume readiness">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard i={0} icon={FileText} tone="violet" label="With a resume" value={`${r.withResume}/${r.total}`} />
        <StatCard i={1} icon={BarChart3} tone="cyan" label="Avg resume score" value={String(r.avgResume)} />
        <StatCard i={2} icon={GraduationCap} tone="mint" label="Coverage" value={`${r.total ? Math.round((r.withResume / r.total) * 100) : 0}%`} />
      </div>
    </SectionCard>
  );
}

function DrivesTab() {
  const [tick, setTick] = useState(0);
  const { loading, error, data } = useAsync(() => College.drives(), [tick]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', company: '' });
  const drives = data?.drives || [];
  const create = async () => {
    if (!form.title.trim()) return;
    await College.createDrive(form);
    setForm({ title: '', company: '' });
    setOpen(false);
    setTick((t) => t + 1);
  };
  return (
    <SectionCard title="Placement drive tracker" action={<Button size="sm" onClick={() => setOpen(true)}><Plus size={14} /> New drive</Button>}>
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={() => setTick((t) => t + 1)} /> : drives.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No drives yet" hint="Create a placement drive to track companies, eligibility and shortlists." />
      ) : (
        <ul className="space-y-2">
          {drives.map((d) => (
            <li key={d.id} className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 text-sm">
              <span className="text-slate-200">{d.title}{d.company ? ` · ${d.company}` : ''}</span>
              <Badge tone="cyan">{d.status || 'open'}</Badge>
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New placement drive">
        <div className="space-y-3">
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Summer Internship 2026" /></Field>
          <Field label="Company"><Input value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} placeholder="e.g. Acme Corp" /></Field>
          <div className="flex justify-end gap-2"><Button variant="soft" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={create}>Create drive</Button></div>
        </div>
      </Modal>
    </SectionCard>
  );
}

function ReportsTab() {
  const [status, setStatus] = useState('');
  const exportCsv = async () => {
    setStatus('Preparing…');
    try {
      const res = await College.exportCsv();
      if (!res?.ok) { setStatus('Export failed.'); return; }
      const blob = new Blob([res.csv || ''], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'college-students.csv'; a.click();
      URL.revokeObjectURL(url);
      setStatus(`Exported ${res.rows} rows.`);
    } catch (e) { setStatus(e?.message || 'Export failed.'); }
  };
  return (
    <SectionCard title="Reports & export">
      <p className="mb-3 text-sm text-muted">Export your college’s scoped student data as CSV for reporting. Only students linked to your institution are included.</p>
      <div className="flex items-center gap-3">
        <Button onClick={exportCsv}><Download size={15} /> Export student CSV</Button>
        {status && <span className="text-sm text-slate-400">{status}</span>}
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1 rounded-lg border border-white/8 px-2 py-1"><Bell size={12} /> Notify students (placeholder)</span>
        <span className="inline-flex items-center gap-1 rounded-lg border border-white/8 px-2 py-1"><ClipboardList size={12} /> Assign improvement task (placeholder)</span>
      </div>
    </SectionCard>
  );
}
