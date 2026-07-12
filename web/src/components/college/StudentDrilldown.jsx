import { useEffect, useState } from 'react';
import {
  BarChart3, FolderCheck, FileText, Activity as ActivityIcon, Github,
  ExternalLink, Clock, Target, Sparkles, ShieldCheck, AlertTriangle, Bell,
} from 'lucide-react';
import { Badge, Button, Modal, Spinner } from '../ui/kit.jsx';
import { College } from '../../lib/api.js';

/* ============================================================
   STUDENT DRILL-DOWN  (placement-cell observability)
   ------------------------------------------------------------
   Full per-student detail behind /api/college/students/:id/detail —
   server-scoped to the caller's own college. Shows the readiness
   breakdown from the deterministic engine, verified vs declared
   skills, the project verification pipeline, the skill-XP ledger,
   resume score history and the recent activity feed.
   ============================================================ */

const STATUS_TONE = { verified: 'mint', pending: 'amber', needs_review: 'cyan', rejected: 'rose' };
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const rel = (iso) => {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

function ScoreRing({ value = 0, category = '' }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const r = 34; const c = 2 * Math.PI * r;
  const tone = v >= 70 ? '#57E6A8' : v >= 45 ? '#6EE0F2' : v >= 20 ? '#EAC97C' : '#FB7185';
  return (
    <div className="flex items-center gap-3">
      <svg width="84" height="84" viewBox="0 0 84 84" className="shrink-0">
        <circle cx="42" cy="42" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
        <circle cx="42" cy="42" r={r} fill="none" stroke={tone} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 42 42)" />
        <text x="42" y="47" textAnchor="middle" fill="#EDF2EE" fontSize="19" fontWeight="700">{v}</text>
      </svg>
      <div>
        <div className="font-display text-sm text-white">{category || '—'}</div>
        <div className="text-[11px] uppercase tracking-wider text-slate-500">Placement readiness</div>
      </div>
    </div>
  );
}

function ComponentBars({ components = {} }) {
  const rows = [
    ['Verified skills', components.skillsScore], ['Verified XP', components.xpScore],
    ['Verified projects', components.projectScore], ['Recruiter-ready', components.recruiterScore],
    ['Resume', components.resumeScore],
  ].filter(([, v]) => v != null);
  return (
    <div className="space-y-2">
      {rows.map(([label, v]) => (
        <div key={label}>
          <div className="mb-0.5 flex justify-between text-[11px] text-slate-400"><span>{label}</span><span className="font-mono">{v}</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/6">
            <div className="h-full rounded-full bg-aurora-cta" style={{ width: `${Math.max(2, v)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ResumeTrend({ history = [] }) {
  if (!history.length) return <p className="text-sm text-muted">No resume analyses yet.</p>;
  const pts = [...history].reverse(); // oldest → newest
  const max = 100; const w = 220; const h = 56;
  const x = (i) => (pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * (w - 8) + 4);
  const y = (v) => h - 6 - ((Number(v) || 0) / max) * (h - 12);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.score)}`).join(' ');
  return (
    <div>
      <svg width={w} height={h} className="mb-1">
        <path d={path} fill="none" stroke="#8FE3F7" strokeWidth="2" strokeLinecap="round" />
        {pts.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.score)} r="3" fill="#BCA8FF" />)}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        {history.slice(0, 3).map((p, i) => (
          <span key={i} className="font-mono">{p.score}/100 · {p.targetRole || 'General'} · {fmtDate(p.at)}</span>
        ))}
      </div>
    </div>
  );
}

export default function StudentDrilldown({ studentId, seed = null, open, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, student: null });
  const [notifyStatus, setNotifyStatus] = useState('');

  useEffect(() => {
    if (!open || !studentId) return undefined;
    let alive = true;
    setState({ loading: true, error: null, student: null });
    setNotifyStatus('');
    College.studentDetail(studentId)
      .then((r) => { if (alive) setState({ loading: false, error: null, student: r?.student || null }); })
      .catch((e) => { if (alive) setState({ loading: false, error: e?.message || 'Failed to load student', student: null }); });
    return () => { alive = false; };
  }, [open, studentId]);

  const s = state.student;
  const nudge = async () => {
    setNotifyStatus('Sending…');
    try { const r = await College.notify([studentId]); setNotifyStatus(r?.ok ? 'Nudge recorded.' : 'Failed.'); }
    catch { setNotifyStatus('Failed.'); }
  };

  return (
    <Modal open={open} onClose={onClose} title={s ? (s.name || s.email) : 'Student detail'} width="max-w-3xl">
      {state.loading && <div className="flex items-center gap-2 py-8 text-sm text-muted"><Spinner /> Loading detailed profile…</div>}
      {state.error && (
        <div className="flex items-center gap-2 py-6 text-sm text-rose-300">
          <AlertTriangle size={15} /> {state.error} {seed ? '— showing roster summary only.' : ''}
        </div>
      )}

      {!state.loading && !state.error && s && (
        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          {/* Identity + readiness header */}
          <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-lg text-white">{s.name || s.email}</span>
                {s.readiness?.category && <Badge tone={s.readiness.score >= 65 ? 'mint' : s.readiness.score >= 45 ? 'cyan' : 'amber'}>{s.readiness.category}</Badge>}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-400">
                <span>{s.email}</span>
                {s.branch && <span>{s.branch}{s.batch ? ` · ${s.batch}` : ''}</span>}
                {s.targetRole && <span className="inline-flex items-center gap-1"><Target size={11} /> {s.targetRole}</span>}
                <span className="inline-flex items-center gap-1"><Clock size={11} /> joined {fmtDate(s.memberSince)} · last login {rel(s.lastLoginAt)}</span>
              </div>
            </div>
            <ScoreRing value={s.readiness?.score} category={s.readiness?.category} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Readiness components + gaps */}
            <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-200"><BarChart3 size={14} className="text-aurora-cyan" /> Readiness breakdown</div>
              <ComponentBars components={s.readiness?.components || {}} />
              {(s.readiness?.gaps || []).length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-white/6 pt-3 text-[12px] text-slate-400">
                  {s.readiness.gaps.slice(0, 4).map((g, i) => <li key={i} className="flex gap-1.5"><span className="text-amber-glow">→</span> {g}</li>)}
                </ul>
              )}
            </div>

            {/* Skills: verified ledger vs declared */}
            <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-200"><ShieldCheck size={14} className="text-aurora-mint" /> Skill ledger</div>
              {s.skillLedger.length === 0 && <p className="text-sm text-muted">No skill XP yet.</p>}
              <div className="flex flex-wrap gap-1.5">
                {s.skillLedger.slice(0, 14).map((r) => (
                  <span key={r.skill} className={`rounded-lg border px-2 py-0.5 text-[11px] ${r.verifiedXp > 0 ? 'border-aurora-mint/30 bg-aurora-mint/10 text-[#BDF5DC]' : 'border-white/10 bg-white/[0.03] text-slate-400'}`}>
                    {r.skill} <span className="font-mono opacity-70">{r.verifiedXp > 0 ? `${r.verifiedXp}xp` : `${r.pendingXp}xp pending`}</span>
                  </span>
                ))}
              </div>
              {(s.skills || []).length > 0 && (
                <p className="mt-3 border-t border-white/6 pt-2 text-[11px] text-slate-500">
                  Declared on profile: {(s.skills || []).slice(0, 10).join(', ')}{(s.skills || []).length > 10 ? '…' : ''}
                </p>
              )}
            </div>
          </div>

          {/* Project verification pipeline */}
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-200"><FolderCheck size={14} className="text-aurora-violet" /> Projects ({s.projects.length})</div>
            {s.projects.length === 0 && <p className="text-sm text-muted">No project submissions yet.</p>}
            <ul className="space-y-2">
              {s.projects.slice(0, 8).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/6 bg-white/[0.015] px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-200">{p.title}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                      {(p.status === 'verified' ? p.verifiedSkills : p.claimedSkills).slice(0, 4).map((sk) => <span key={sk} className="font-mono">{sk}</span>)}
                      <span>{rel(p.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.githubUrl && <a href={p.githubUrl} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-white"><Github size={14} /></a>}
                    {p.liveDemoUrl && <a href={p.liveDemoUrl} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-white"><ExternalLink size={14} /></a>}
                    <Badge tone={STATUS_TONE[p.status] || 'default'}>{p.status.replace('_', ' ')}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Resume trend */}
            <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-200"><FileText size={14} className="text-aurora-cyan" /> Resume trend</div>
              <ResumeTrend history={s.resumeHistory} />
            </div>
            {/* Activity feed */}
            <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-200"><ActivityIcon size={14} className="text-aurora-mint" /> Recent activity</div>
              {s.activity.length === 0 && <p className="text-sm text-muted">No recorded activity.</p>}
              <ul className="space-y-1.5 text-[12px]">
                {s.activity.slice(0, 8).map((a, i) => (
                  <li key={i} className="flex justify-between gap-3 text-slate-400">
                    <span className="min-w-0 truncate">{a.text}</span>
                    <span className="shrink-0 font-mono text-slate-600">{rel(a.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-white/6 pt-3">
            <Button size="sm" variant="soft" onClick={nudge}><Bell size={13} /> Nudge student</Button>
            {notifyStatus && <span className="text-[12px] text-slate-500">{notifyStatus}</span>}
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-600"><Sparkles size={11} /> Scores are deterministic — verified signals only</span>
          </div>
        </div>
      )}
    </Modal>
  );
}
