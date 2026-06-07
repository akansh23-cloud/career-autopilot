import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, ShieldCheck, Search, SlidersHorizontal, Star, X, ChevronLeft, ChevronRight,
  MapPin, Target, Sparkles, BadgeCheck, Rocket, Briefcase, Activity as ActivityIcon,
  Lock, Eye, Lock as LockIcon, RefreshCw, AlertTriangle, UserSearch,
} from 'lucide-react';
import { PageIntro, StatCard, SectionCard } from './common.jsx';
import { Button, Badge, EmptyState, Input, Field, Spinner, Skeleton, Avatar } from '../components/ui/kit.jsx';
import { Admin } from '../lib/api.js';
import { getPlan, PLAN_EVENT } from '../lib/plan.js';

/* Resolve admin status from the synced plan (server is the source of truth via
   requireAdmin; this only governs what the UI even renders). */
function useIsAdmin() {
  const [admin, setAdmin] = useState(!!getPlan().isAdmin);
  useEffect(() => {
    const f = () => setAdmin(!!getPlan().isAdmin);
    window.addEventListener(PLAN_EVENT, f);
    return () => window.removeEventListener(PLAN_EVENT, f);
  }, []);
  return admin;
}

const SORTS = [
  { id: 'xp', label: 'XP (high → low)' },
  { id: 'active', label: 'Recently active' },
  { id: 'completion', label: 'Profile completion' },
  { id: 'projects', label: 'Completed projects' },
  { id: 'created', label: 'Newest accounts' },
  { id: 'name', label: 'Name (A → Z)' },
];

const EXPERIENCE_LEVELS = ['Beginner', 'Builder', 'Job Ready', 'Advanced', 'Expert Proof'];
const USER_TYPES = [
  { id: '', label: 'All types' },
  { id: 'student', label: 'Student' },
  { id: 'professional', label: 'Professional' },
  { id: 'recruiter', label: 'Recruiter' },
  { id: 'college_admin', label: 'College' },
  { id: 'admin', label: 'Admin' },
];
const PROJECT_STATUS = [
  { id: '', label: 'Any projects' },
  { id: 'completed', label: 'Has completed' },
  { id: 'none', label: 'No completed' },
];
const ACTIVITY = [
  { id: '', label: 'Any activity' },
  { id: 'active', label: 'Active (30d)' },
  { id: 'inactive', label: 'Inactive' },
];

const EMPTY_FILTERS = {
  q: '', skill: '', speciality: '', targetRole: '', experienceLevel: '',
  location: '', userType: '', minCompletion: 0, projectStatus: '',
  recruiterVisible: false, activity: '',
};

function relDate(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '—';
  const d = Math.floor(diff / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return '—'; }
}

function VisibilityBadge({ status }) {
  if (status === 'recruiter-visible') return <Badge tone="mint"><Eye size={11} className="mr-1 inline" />Recruiter-visible</Badge>;
  if (status === 'public') return <Badge tone="cyan"><Eye size={11} className="mr-1 inline" />Public</Badge>;
  return <Badge tone="default"><Lock size={11} className="mr-1 inline" />Private</Badge>;
}

function TypeBadge({ type }) {
  const tone = type === 'admin' ? 'violet' : type === 'recruiter' ? 'amber' : type === 'professional' ? 'cyan' : 'default';
  const label = type === 'college_admin' ? 'College' : type.charAt(0).toUpperCase() + type.slice(1);
  return <Badge tone={tone}>{label}</Badge>;
}

function UserCard({ u, onOpen, i }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03, duration: 0.4 }}
      onClick={() => onOpen(u.id)}
      className="gradient-border lift group block w-full p-4 text-left hover:shadow-glow"
    >
      <div className="flex items-start gap-3">
        <Avatar src={u.avatar} name={u.name} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate font-medium text-white">{u.name}</p>
            {u.featuredTalent && <Star size={13} className="shrink-0 fill-amber-glow text-amber-glow" />}
          </div>
          <p className="truncate text-xs text-slate-500">{u.email || '—'}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-lg font-semibold text-white">{u.xp.toLocaleString()}</p>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">XP</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <TypeBadge type={u.userType} />
        <VisibilityBadge status={u.visibilityStatus} />
        {u.experienceLevel && <Badge tone="default">{u.experienceLevel}</Badge>}
      </div>

      {(u.targetRole || u.speciality) && (
        <p className="mt-2.5 flex items-center gap-1.5 truncate text-xs text-slate-400">
          <Target size={12} className="shrink-0 text-aurora-cyan" />
          {u.targetRole || '—'}{u.speciality ? ` · ${u.speciality}` : ''}
        </p>
      )}

      {u.skills.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {u.skills.slice(0, 5).map((s) => (
            <span key={s} className="rounded-md border border-white/8 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-slate-300">{s}</span>
          ))}
          {u.skills.length > 5 && <span className="px-1 text-[10px] text-slate-500">+{u.skills.length - 5}</span>}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-white/6 pt-2.5 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><Rocket size={11} /> {u.completedProjectsCount} done</span>
        <span className="flex items-center gap-1"><BadgeCheck size={11} /> {u.profileCompletion}%</span>
        <span className="flex items-center gap-1"><ActivityIcon size={11} /> {relDate(u.lastActiveAt)}</span>
      </div>
    </motion.button>
  );
}

function SkillGroup({ title, items, tone }) {
  if (!items || !items.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((s) => (
          <Badge key={s.name} tone={tone}>{s.name}{s.xp ? ` · ${s.xp}xp` : ''}</Badge>
        ))}
      </div>
    </div>
  );
}

function DetailDrawer({ id, onClose, onMutated }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await Admin.getUser(id);
      if (!r.ok) throw new Error(r.reason || 'failed');
      setData(r);
      setNotes(r.user.adminNotes || '');
    } catch (e) {
      const reason = e?.data?.reason || e?.message;
      setError(reason === 'db_disabled' ? 'A database connection is required to load full user details.' : (e.message || 'Could not load this user.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const u = data?.user;

  const saveNotes = async () => {
    setSavingNotes(true);
    try { await Admin.setNotes(id, notes); } catch { /* surfaced via reload */ }
    finally { setSavingNotes(false); }
  };

  const toggleVisibility = async () => {
    if (!u) return;
    setBusy(true);
    try { await Admin.setVisibility(id, !u.recruiterVisible); await load(); onMutated?.(); }
    catch { /* no-op */ } finally { setBusy(false); }
  };
  const toggleFeatured = async () => {
    if (!u) return;
    setBusy(true);
    try { await Admin.setFeatured(id, !u.featuredTalent); await load(); onMutated?.(); }
    catch { /* no-op */ } finally { setBusy(false); }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose}
      />
      <motion.aside
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-white/10 bg-ink-900 shadow-lift"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-5 py-4">
          <p className="font-display text-[15px] font-semibold text-white">User detail</p>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-white/6"><X size={18} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 [scrollbar-width:thin]">
          {loading && (
            <div className="space-y-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}
          {!loading && error && (
            <EmptyState icon={AlertTriangle} title="Couldn't load user" hint={error} action={<Button onClick={load}><RefreshCw size={14} /> Retry</Button>} />
          )}
          {!loading && !error && u && (
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <Avatar src={u.avatar} name={u.name} size={52} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate font-display text-lg font-semibold text-white">{u.name}</p>
                    {u.featuredTalent && <Star size={15} className="shrink-0 fill-amber-glow text-amber-glow" />}
                  </div>
                  <p className="truncate text-sm text-slate-400">{u.email || '—'}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <TypeBadge type={u.userType} />
                    <VisibilityBadge status={u.visibilityStatus} />
                    <Badge tone={u.isActive ? 'mint' : 'default'}>{u.isActive ? 'Active account' : 'Disabled'}</Badge>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Stat label="XP" value={u.xp.toLocaleString()} hint={u.experienceLevel} />
                <Stat label="Profile complete" value={`${u.profileCompletion}%`} />
                <Stat label="Completed projects" value={u.completedProjectsCount} hint={`${u.totalProjectsCount} total`} />
                <Stat label="Verified skills" value={u.verifiedSkillsCount} hint={`${u.badgeCount} badges`} />
                <Stat label="Saved jobs" value={u.savedJobsCount} />
                <Stat label="Applied jobs" value={u.appliedJobsCount} />
              </div>

              <div className="space-y-1.5 rounded-xl border border-white/8 bg-white/[0.02] p-3.5 text-sm">
                <Row label="Current role" value={u.currentRole || '—'} icon={Briefcase} />
                <Row label="Target role" value={u.targetRole || '—'} icon={Target} />
                <Row label="Speciality" value={u.speciality || '—'} icon={Sparkles} />
                <Row label="Location" value={u.location || '—'} icon={MapPin} />
                <Row label="Joined" value={fmtDate(u.createdAt)} icon={BadgeCheck} />
                <Row label="Last active" value={relDate(u.lastActiveAt)} icon={ActivityIcon} />
              </div>

              {(data.skillGroups && (data.skillGroups.verified.length || data.skillGroups.completed.length || data.skillGroups.in_progress.length)) ? (
                <div className="space-y-3">
                  <SkillGroup title="Verified" items={data.skillGroups.verified} tone="mint" />
                  <SkillGroup title="Completed" items={data.skillGroups.completed} tone="violet" />
                  <SkillGroup title="In progress" items={data.skillGroups.in_progress} tone="cyan" />
                </div>
              ) : u.skills.length ? (
                <SkillGroup title="Skills" items={u.skills.map((name) => ({ name }))} tone="default" />
              ) : null}

              {data.projects?.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Projects ({data.projects.length})</p>
                  <div className="space-y-1.5">
                    {data.projects.map((p) => (
                      <div key={p.id || p.title} className="flex items-center justify-between rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2 text-sm">
                        <span className="truncate text-slate-200">{p.title}</span>
                        <span className="ml-2 flex shrink-0 items-center gap-1.5 text-[11px] text-slate-500">
                          {p.published && <Badge tone="mint">Published</Badge>}
                          {p.github && <span title="GitHub linked">GH</span>}
                          {p.live && <span title="Live demo">Live</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.activity?.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Recent activity</p>
                  <ul className="space-y-1.5">
                    {data.activity.map((a, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-slate-400">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-aurora-cyan" />
                        <span className="flex-1">{a.text}</span>
                        <span className="shrink-0 text-slate-600">{relDate(a.at)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <Field label="Admin notes" hint="Internal only — never shown to the user or recruiters.">
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    maxLength={4000}
                    placeholder="Add a private note about this user…"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-aurora-violet/50 focus:ring-2 focus:ring-aurora-violet/20"
                  />
                </Field>
                <div className="mt-2 flex justify-end">
                  <Button onClick={saveNotes} disabled={savingNotes || notes === (u.adminNotes || '')}>
                    {savingNotes ? <Spinner className="h-4 w-4" /> : null} Save notes
                  </Button>
                </div>
              </div>

              <div className="space-y-2 border-t border-white/8 pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Safe actions</p>
                <button
                  onClick={toggleFeatured} disabled={busy}
                  className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-sm text-slate-200 transition hover:border-amber-glow/40 hover:bg-amber-glow/5 disabled:opacity-50"
                >
                  <span className="flex items-center gap-2"><Star size={15} className={u.featuredTalent ? 'fill-amber-glow text-amber-glow' : 'text-slate-400'} /> Featured talent</span>
                  <Badge tone={u.featuredTalent ? 'amber' : 'default'}>{u.featuredTalent ? 'On' : 'Off'}</Badge>
                </button>
                <button
                  onClick={toggleVisibility} disabled={busy}
                  className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-sm text-slate-200 transition hover:border-aurora-mint/40 hover:bg-aurora-mint/5 disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    {u.recruiterVisible ? <Eye size={15} className="text-aurora-mint" /> : <LockIcon size={15} className="text-slate-400" />}
                    Recruiter visibility
                  </span>
                  <Badge tone={u.recruiterVisible ? 'mint' : 'default'}>{u.recruiterVisible ? 'Visible' : 'Private'}</Badge>
                </button>
                <p className="flex items-start gap-1.5 text-[11px] leading-snug text-slate-500">
                  <ShieldCheck size={12} className="mt-0.5 shrink-0 text-aurora-mint" />
                  Recruiter visibility controls the opt-in flag recruiters rely on. Default for every user is private.
                </p>
              </div>
            </div>
          )}
        </div>
      </motion.aside>
    </>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-0.5 font-display text-xl font-semibold text-white">{value}</p>
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}
function Row({ label, value, icon: Icon }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-slate-500">{Icon && <Icon size={13} />}{label}</span>
      <span className="truncate text-right text-slate-200">{value}</span>
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="mx-auto max-w-lg py-16">
      <EmptyState
        icon={Lock}
        title="Access denied"
        hint="The User Directory is restricted to platform administrators. If you believe you should have access, contact your workspace owner."
      />
    </div>
  );
}

export default function AdminUsers() {
  const isAdmin = useIsAdmin();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState('xp');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const debounceRef = useRef(null);

  const fetchData = useCallback(async (opts = {}) => {
    setLoading(true); setError('');
    try {
      const r = await Admin.listUsers({ ...filters, sort, page, pageSize: 24, ...opts });
      if (!r.ok) throw new Error('failed');
      setData(r);
    } catch (e) {
      setError(e?.status === 403 ? 'Admin access required.' : (e.message || 'Could not load the user directory.'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters, sort, page]);

  // Debounced refetch on filter/sort/page change.
  useEffect(() => {
    if (!isAdmin) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchData(), 250);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [fetchData, isAdmin]);

  const setFilter = (k, v) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };
  const reset = () => { setPage(1); setFilters(EMPTY_FILTERS); setSort('xp'); };

  const stats = data?.stats || {};
  const users = data?.users || [];
  const totalPages = data?.totalPages || 1;
  const activeFilterCount = useMemo(
    () => Object.entries(filters).filter(([k, v]) => k !== 'q' && v !== '' && v !== false && v !== 0).length,
    [filters]
  );

  if (!isAdmin) return <AccessDenied />;

  return (
    <div>
      <PageIntro
        title="User Directory"
        sub="Talent intelligence across every account — admin only."
        action={
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-aurora-violet/30 bg-aurora-violet/10 px-3 py-2 text-xs font-semibold text-[#FFD49A]">
            <ShieldCheck size={14} /> Admin
          </span>
        }
      />

      {/* Stat summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard i={0} icon={Users} tone="violet" label="Total users" value={loading && !data ? '—' : stats.totalUsers ?? 0} />
        <StatCard i={1} icon={ActivityIcon} tone="cyan" label="Active (30d)" value={loading && !data ? '—' : stats.activeUsers ?? 0} />
        <StatCard i={2} icon={Eye} tone="mint" label="Recruiter-visible" value={loading && !data ? '—' : stats.recruiterVisibleUsers ?? 0} />
        <StatCard i={3} icon={Rocket} tone="amber" label="With projects" value={loading && !data ? '—' : stats.completedProjectUsers ?? 0} />
        <StatCard i={4} icon={Sparkles} tone="violet" label={stats.topSkill ? `Top: ${stats.topSkill}` : 'Top skill'} value={loading && !data ? '—' : (stats.topSkillCount ?? 0)} />
      </div>

      {/* Search + controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            value={filters.q}
            onChange={(e) => setFilter('q', e.target.value)}
            placeholder="Search name, email, skill, role…"
            className="pl-10"
          />
        </div>
        <select
          value={sort} onChange={(e) => { setPage(1); setSort(e.target.value); }}
          className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-slate-200 outline-none focus:border-aurora-violet/50"
        >
          {SORTS.map((s) => <option key={s.id} value={s.id} className="bg-ink-900">{s.label}</option>)}
        </select>
        <button
          onClick={() => setShowFilters((s) => !s)}
          className={`inline-flex h-11 items-center gap-2 rounded-xl border px-3.5 text-sm transition ${
            showFilters || activeFilterCount ? 'border-aurora-violet/40 bg-aurora-violet/10 text-[#FFD49A]' : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
          }`}
        >
          <SlidersHorizontal size={15} /> Filters{activeFilterCount ? ` · ${activeFilterCount}` : ''}
        </button>
        <button onClick={() => fetchData()} className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-slate-300 transition hover:border-white/25" aria-label="Refresh">
          <RefreshCw size={15} className={loading ? 'animate-spin-slow' : ''} />
        </button>
      </div>

      {/* Filters panel */}
      <AnimatePresence initial={false}>
        {showFilters && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
            <SectionCard className="mb-5">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Skill"><Input value={filters.skill} onChange={(e) => setFilter('skill', e.target.value)} placeholder="React, Kubernetes, AI/ML…" /></Field>
                <Field label="Speciality / domain"><Input value={filters.speciality} onChange={(e) => setFilter('speciality', e.target.value)} placeholder="Backend, Data, DevOps…" /></Field>
                <Field label="Target role"><Input value={filters.targetRole} onChange={(e) => setFilter('targetRole', e.target.value)} placeholder="e.g. Cloud Engineer" /></Field>
                <Field label="Location"><Input value={filters.location} onChange={(e) => setFilter('location', e.target.value)} placeholder="e.g. Pune" /></Field>
                <Field label="Experience level">
                  <select value={filters.experienceLevel} onChange={(e) => setFilter('experienceLevel', e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-slate-200 outline-none focus:border-aurora-violet/50">
                    <option value="" className="bg-ink-900">Any level</option>
                    {EXPERIENCE_LEVELS.map((l) => <option key={l} value={l} className="bg-ink-900">{l}</option>)}
                  </select>
                </Field>
                <Field label="User type">
                  <select value={filters.userType} onChange={(e) => setFilter('userType', e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-slate-200 outline-none focus:border-aurora-violet/50">
                    {USER_TYPES.map((t) => <option key={t.id} value={t.id} className="bg-ink-900">{t.label}</option>)}
                  </select>
                </Field>
                <Field label="Project completion">
                  <select value={filters.projectStatus} onChange={(e) => setFilter('projectStatus', e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-slate-200 outline-none focus:border-aurora-violet/50">
                    {PROJECT_STATUS.map((t) => <option key={t.id} value={t.id} className="bg-ink-900">{t.label}</option>)}
                  </select>
                </Field>
                <Field label="Activity">
                  <select value={filters.activity} onChange={(e) => setFilter('activity', e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-slate-200 outline-none focus:border-aurora-violet/50">
                    {ACTIVITY.map((t) => <option key={t.id} value={t.id} className="bg-ink-900">{t.label}</option>)}
                  </select>
                </Field>
                <Field label={`Min. profile completion · ${filters.minCompletion}%`}>
                  <input type="range" min={0} max={100} step={5} value={filters.minCompletion} onChange={(e) => setFilter('minCompletion', Number(e.target.value))} className="mt-3 w-full accent-aurora-violet" />
                </Field>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={filters.recruiterVisible} onChange={(e) => setFilter('recruiterVisible', e.target.checked)} className="h-4 w-4 accent-aurora-mint" />
                  Recruiter-visible only
                </label>
                <Button variant="ghost" onClick={reset}>Reset all</Button>
              </div>
            </SectionCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      {loading && !data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 w-full rounded-2xl" />)}
        </div>
      ) : error ? (
        <EmptyState icon={AlertTriangle} title="Couldn't load the directory" hint={error} action={<Button onClick={() => fetchData()}><RefreshCw size={14} /> Retry</Button>} />
      ) : users.length === 0 ? (
        <EmptyState
          icon={UserSearch}
          title={activeFilterCount || filters.q ? 'No users match these filters' : 'No users yet'}
          hint={activeFilterCount || filters.q ? 'Try clearing some filters to widen the search.' : 'As people sign up and build their profiles, they will appear here.'}
          action={(activeFilterCount || filters.q) ? <Button variant="ghost" onClick={reset}>Clear filters</Button> : null}
        />
      ) : (
        <>
          {data?.db === false && (
            <p className="mb-3 flex items-center gap-2 rounded-lg border border-amber-glow/20 bg-amber-glow/5 px-3 py-2 text-xs text-amber-glow">
              <AlertTriangle size={13} /> No database is connected, so the directory is empty. Configure MONGODB_URI to see real users.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {users.map((u, i) => <UserCard key={u.id} u={u} i={i} onOpen={setSelectedId} />)}
          </div>

          {/* Pagination */}
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm text-slate-300 transition hover:border-white/25 disabled:opacity-40"
            >
              <ChevronLeft size={15} /> Prev
            </button>
            <span className="text-sm text-slate-400">Page {data?.page || page} of {totalPages} · {data?.total ?? 0} users</span>
            <button
              disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm text-slate-300 transition hover:border-white/25 disabled:opacity-40"
            >
              Next <ChevronRight size={15} />
            </button>
          </div>
        </>
      )}

      <AnimatePresence>
        {selectedId && (
          <DetailDrawer key={selectedId} id={selectedId} onClose={() => setSelectedId(null)} onMutated={() => fetchData()} />
        )}
      </AnimatePresence>
    </div>
  );
}
