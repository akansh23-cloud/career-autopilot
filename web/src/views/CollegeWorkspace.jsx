import { useEffect, useMemo, useState } from 'react';
import {
  Users, GraduationCap, BarChart3, Flame, FolderCheck, FileText,
  CalendarClock, Download, Search, Bell, ClipboardList, Gauge, Eye, Users2,
  IndianRupee, FileDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { PageIntro, SectionCard, StatCard, BarChart } from './common.jsx';
import { Button, Badge, Spinner, EmptyState, Input, Field } from '../components/ui/kit.jsx';
import { College } from '../lib/api.js';
import { getEffectiveRole } from '../lib/roleCapabilities.js';
import CommandCenter from '../components/college/CommandCenter.jsx';
import OnboardingPanel from '../components/college/OnboardingPanel.jsx';
import StudentDrilldown from '../components/college/StudentDrilldown.jsx';
import DriveManager from '../components/college/DriveManager.jsx';
import PlacementReport from '../components/college/PlacementReport.jsx';
import InterventionsPanel from '../components/college/InterventionsPanel.jsx';
import TeamProjectsPanel from '../components/college/TeamProjectsPanel.jsx';
import { exportCollegeReportPDF } from '../lib/collegeReport.js';

/* Tabs are grouped rather than listed flat. Fourteen equal-weight buttons in
   one row is a wall; three labelled groups is a workspace. "Operate" is the
   daily job, "Cohort" is the analysis, "Manage" is the setup. */
const GROUPS = [
  {
    label: 'Operate',
    tabs: [
      { id: 'command', label: 'Command center', icon: Gauge },
      { id: 'drives', label: 'Drives', icon: CalendarClock },
      { id: 'placement', label: 'Placement report', icon: IndianRupee },
      { id: 'interventions', label: 'Interventions', icon: ClipboardList },
      { id: 'teams', label: 'Team projects', icon: Users2 },
    ],
  },
  {
    label: 'Cohort',
    tabs: [
      { id: 'directory', label: 'Student directory', icon: Users },
      { id: 'overview', label: 'Overview', icon: GraduationCap },
      { id: 'readiness', label: 'Readiness', icon: BarChart3 },
      { id: 'heatmap', label: 'Skill heatmap', icon: Flame },
      { id: 'analytics', label: 'Batch & branch', icon: BarChart3 },
      { id: 'projects', label: 'Verified projects', icon: FolderCheck },
      { id: 'resume', label: 'Resume readiness', icon: FileText },
    ],
  },
  {
    label: 'Manage',
    tabs: [
      { id: 'onboarding', label: 'Onboarding & roster', icon: ClipboardList },
      { id: 'reports', label: 'Reports & export', icon: Download },
    ],
  },
];

const ALL_TABS = GROUPS.flatMap((g) => g.tabs);

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

  const [tab, setTab] = useState(ALL_TABS.some((t) => t.id === params.tab) ? params.tab : 'command');
  useEffect(() => { if (params.tab && ALL_TABS.some((t) => t.id === params.tab)) setTab(params.tab); }, [params.tab]);

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
      <div className="mb-5 space-y-2">
        {GROUPS.map((g) => (
          <div key={g.label} className="flex flex-wrap items-center gap-2">
            <span className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{g.label}</span>
            {g.tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                  tab === t.id ? 'border-strong bg-surface-1 text-fg' : 'border-subtle bg-surface-1 text-fg-secondary hover:border-strong'
                }`}
              >
                <t.icon size={15} /> {t.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {tab === 'command' && <CommandCenterTab go={(t) => setTab(t)} />}
      {tab === 'drives' && <DriveManager />}
      {tab === 'placement' && <PlacementReport go={(t) => setTab(t)} />}
      {tab === 'interventions' && <InterventionsPanel />}
      {tab === 'teams' && <TeamProjectsPanel />}
      {tab === 'onboarding' && <OnboardingPanel />}
      {tab === 'overview' && <OverviewTab go={(t) => setTab(t)} />}
      {tab === 'directory' && <DirectoryTab />}
      {tab === 'readiness' && <ReadinessTab />}
      {tab === 'heatmap' && <HeatmapTab />}
      {tab === 'analytics' && <AnalyticsTab />}
      {tab === 'projects' && <ProjectsTab go={go} />}
      {tab === 'resume' && <ResumeReadinessTab />}
      {tab === 'reports' && <ReportsTab go={(t) => setTab(t)} />}
    </div>
  );
}

function CommandCenterTab({ go }) {
  const [tick, setTick] = useState(0);
  const { loading, error, data } = useAsync(() => College.observability(), [tick]);
  return <CommandCenter data={data} loading={loading} error={error} onRetry={() => setTick((t) => t + 1)} go={go} />;
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
const PAGE_SIZE = 25;

const ENGAGEMENT_TONE = { active7: 'mint', active30: 'cyan', dormant: 'amber', never: 'default' };
const ENGAGEMENT_LABEL = { active7: 'This week', active30: 'This month', dormant: 'Dormant', never: 'Never active' };
const RISK_TONE = { high: 'amber', medium: 'cyan', low: 'default', none: 'default' };

function SortHeader({ label, field, sort, order, onSort, align = 'left' }) {
  const active = sort === field;
  const Icon = order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={`px-2 py-2 ${align === 'right' ? 'text-right' : ''}`}>
      <button
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 transition hover:text-fg-secondary ${active ? 'text-fg' : ''}`}
      >
        {label}{active && <Icon size={11} />}
      </button>
    </th>
  );
}

function DirectoryTab() {
  const [drill, setDrill] = useState(null);
  const [filters, setFilters] = useState(FILTER_DEFAULTS);
  const [applied, setApplied] = useState(FILTER_DEFAULTS);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [sort, setSort] = useState('readinessScore');
  const [order, setOrder] = useState('desc');
  const [offset, setOffset] = useState(0);

  // Debounced so typing a name doesn't fire one request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => { setDebouncedQ(q); setOffset(0); }, 300);
    return () => clearTimeout(id);
  }, [q]);

  // deep=1 asks the server for engagement, funnel stage and risk severity —
  // signals the observability engine already computes but the directory
  // previously threw away.
  const query = useMemo(() => ({
    ...applied, q: debouncedQ, sort, order, offset, limit: PAGE_SIZE, deep: 1,
  }), [applied, debouncedQ, sort, order, offset]);

  const { loading, error, data } = useAsync(() => College.students(query), [JSON.stringify(query)]);
  const students = data?.students || [];
  const total = data?.total ?? 0;
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  const onSort = (field) => {
    if (sort === field) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else { setSort(field); setOrder(['name', 'branch', 'batch'].includes(field) ? 'asc' : 'desc'); }
    setOffset(0);
  };

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + students.length, total);

  return (
    <SectionCard
      title="Student directory"
      eyebrow={total > 0 ? `${total} student(s) match — showing ${from}\u2013${to}` : undefined}
      action={
        <Button size="sm" variant="soft" onClick={() => {
          setFilters(FILTER_DEFAULTS); setApplied(FILTER_DEFAULTS); setQ(''); setOffset(0);
        }}>Reset</Button>
      }
    >
      <div className="mb-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email\u2026" className="max-w-sm" />
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Branch"><Input value={filters.branch} onChange={(e) => set('branch', e.target.value)} placeholder="e.g. CSE" /></Field>
        <Field label="Batch / grad year"><Input value={filters.batch} onChange={(e) => set('batch', e.target.value)} placeholder="e.g. 2026" /></Field>
        <Field label="Year"><Input value={filters.year} onChange={(e) => set('year', e.target.value)} placeholder="e.g. 3rd" /></Field>
        <Field label="Skill"><Input value={filters.skill} onChange={(e) => set('skill', e.target.value)} placeholder="e.g. React" /></Field>
        <Field label="Min readiness"><Input type="number" value={filters.minReadiness} onChange={(e) => set('minReadiness', e.target.value)} placeholder="0\u2013100" /></Field>
        <Field label="Min resume score"><Input type="number" value={filters.minResume} onChange={(e) => set('minResume', e.target.value)} placeholder="0\u2013100" /></Field>
        <label className="flex items-center gap-2 self-end text-sm text-fg-secondary">
          <input type="checkbox" checked={filters.verifiedOnly} onChange={(e) => set('verifiedOnly', e.target.checked)} /> Verified projects only
        </label>
        <Button size="sm" className="self-end" onClick={() => { setApplied(filters); setOffset(0); }}>
          <Search size={14} /> Apply filters
        </Button>
      </div>

      {loading ? <Loading /> : error ? <ErrorState message={error} /> : students.length === 0 ? (
        <EmptyState icon={Users} title="No students match" hint="Adjust filters, or no students are linked to your college yet." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <SortHeader label="Name" field="name" sort={sort} order={order} onSort={onSort} />
                  <SortHeader label="Branch" field="branch" sort={sort} order={order} onSort={onSort} />
                  <SortHeader label="Batch" field="batch" sort={sort} order={order} onSort={onSort} />
                  <SortHeader label="Readiness" field="readinessScore" sort={sort} order={order} onSort={onSort} align="right" />
                  <SortHeader label="Resume" field="resumeScore" sort={sort} order={order} onSort={onSort} align="right" />
                  <SortHeader label="Verified" field="verifiedProjects" sort={sort} order={order} onSort={onSort} align="right" />
                  <th className="px-2 py-2">Stage</th>
                  <SortHeader label="Activity" field="lastActiveAt" sort={sort} order={order} onSort={onSort} />
                  <th className="px-2 py-2">Risk</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className="border-t border-white/6 hover:bg-surface-1">
                    <td className="px-2 py-2 text-fg">{s.name || s.email}</td>
                    <td className="px-2 py-2 text-fg-secondary">{s.branch || '\u2014'}</td>
                    <td className="px-2 py-2 text-fg-secondary">{s.batch || '\u2014'}</td>
                    <td className="px-2 py-2 text-right">{s.readinessScore ?? '\u2014'}</td>
                    <td className="px-2 py-2 text-right">{s.resumeScore ?? '\u2014'}</td>
                    <td className="px-2 py-2 text-right">{s.verifiedProjects > 0 ? <Badge tone="mint">{s.verifiedProjects}</Badge> : '\u2014'}</td>
                    <td className="px-2 py-2 text-xs text-fg-secondary">{String(s.funnelStage || '').replace(/_/g, ' ') || '\u2014'}</td>
                    <td className="px-2 py-2">
                      {s.engagement
                        ? <Badge tone={ENGAGEMENT_TONE[s.engagement] || 'default'}>{ENGAGEMENT_LABEL[s.engagement] || s.engagement}</Badge>
                        : <span className="text-fg-muted">\u2014</span>}
                    </td>
                    <td className="px-2 py-2">
                      {s.riskBand && s.riskBand !== 'none'
                        ? <Badge tone={RISK_TONE[s.riskBand] || 'default'}>{s.riskBand}</Badge>
                        : <span className="text-fg-muted">\u2014</span>}
                    </td>
                    <td className="px-2 py-2"><Button size="sm" variant="soft" onClick={() => setDrill(s.id)}><Eye size={12} /> View</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > PAGE_SIZE && (
            <div className="mt-4 flex items-center justify-between border-t border-white/6 pt-3">
              <span className="text-xs text-fg-muted">Showing {from}\u2013{to} of {total}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="soft" disabled={offset === 0}
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}><ChevronLeft size={13} /> Previous</Button>
                <Button size="sm" variant="soft" disabled={!data?.hasMore}
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}>Next <ChevronRight size={13} /></Button>
              </div>
            </div>
          )}
        </>
      )}
      <StudentDrilldown studentId={drill} open={Boolean(drill)} onClose={() => setDrill(null)} />
    </SectionCard>
  );
}

function ReadinessTab() {
  const { loading, error, data } = useAsync(() => College.students({ limit: 500 }));
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
          <span key={h.skill} className="rounded-lg border border-subtle px-2.5 py-1 text-sm"
            style={{ background: `rgba(124,92,255,${0.08 + 0.5 * (h.count / max)})` }}>
            {h.skill} <span className="text-fg-secondary">· {h.count}</span>
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
  const { loading, error, data } = useAsync(() => College.students({ verifiedOnly: true, limit: 500 }));
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
            <li key={s.id} className="flex items-center justify-between rounded-xl border border-subtle bg-surface-1 px-3 py-2 text-sm">
              <span className="text-fg">{s.name || s.email}</span>
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

/* ------------------------------------------------------------------ */
/* Reports — CSV plus the PDF a TPO actually forwards                  */
/* ------------------------------------------------------------------ */
function ReportsTab({ go }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');

  const download = (csv, name) => {
    const blob = new Blob([csv || ''], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = async (full) => {
    setBusy(full ? 'full' : 'basic'); setStatus('Preparing\u2026');
    try {
      const res = await College.exportCsv(full);
      if (!res?.ok) { setStatus('Export failed.'); return; }
      download(res.csv, full ? 'college-observability.csv' : 'college-students.csv');
      setStatus(`Exported ${res.rows} rows${full ? ' with extended columns' : ''}.`);
    } catch (e) { setStatus(e?.message || 'Export failed.'); }
    finally { setBusy(''); }
  };

  const exportPdf = async () => {
    setBusy('pdf'); setStatus('Building the report\u2026');
    try {
      // Both engines are pulled fresh so the PDF can never disagree with the
      // dashboard it was printed from.
      const [placementData, observability] = await Promise.all([
        College.placement(),
        College.observability(),
      ]);
      const r = await exportCollegeReportPDF({
        collegeName: observability?.collegeName || placementData?.collegeId || 'Your institution',
        placement: placementData,
        observability,
      });
      setStatus(`Report ready \u2014 ${r.pages} page(s) downloaded.`);
    } catch (e) { setStatus(e?.message || 'Could not build the report.'); }
    finally { setBusy(''); }
  };

  return (
    <div className="space-y-4">
      <SectionCard title="Placement readiness report" eyebrow="The document you forward, not a spreadsheet you clean up">
        <p className="mb-4 text-sm text-muted">
          A print-ready PDF covering placement rate, package statistics, branch-wise and batch-wise splits, the
          recruiter list, and the students who are ready but not yet placed \u2014 plus a methodology note explaining
          exactly how each figure was derived. The text is vector, so every number can be copied straight into an
          accreditation return.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={exportPdf} disabled={Boolean(busy)}>
            {busy === 'pdf' ? <Spinner /> : <FileDown size={15} />} Download PDF report
          </Button>
          <Button variant="soft" onClick={() => go?.('placement')}><IndianRupee size={14} /> View the numbers first</Button>
        </div>
      </SectionCard>

      <SectionCard title="Raw data export" eyebrow="Scoped to your institution \u2014 no other college\u2019s students are ever included">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="soft" onClick={() => exportCsv(false)} disabled={Boolean(busy)}>
            {busy === 'basic' ? <Spinner /> : <Download size={15} />} Student CSV
          </Button>
          <Button variant="soft" onClick={() => exportCsv(true)} disabled={Boolean(busy)}>
            {busy === 'full' ? <Spinner /> : <Download size={15} />} Full observability CSV
          </Button>
        </div>
        {status && <p className="mt-3 text-sm text-fg-secondary">{status}</p>}
      </SectionCard>

      {/* These two used to be dead grey "placeholder" chips sitting on top of
          fully working endpoints. They now link to the real thing. */}
      <SectionCard title="Act on what you found" eyebrow="All live \u2014 in-app delivery always, email when SMTP is configured">
        <div className="flex flex-wrap gap-2">
          <Button variant="soft" onClick={() => go?.('interventions')}><Bell size={14} /> Notify students</Button>
          <Button variant="soft" onClick={() => go?.('interventions')}><ClipboardList size={14} /> Assign an improvement task</Button>
          <Button variant="soft" onClick={() => go?.('drives')}><CalendarClock size={14} /> Record drive outcomes</Button>
        </div>
      </SectionCard>
    </div>
  );
}
