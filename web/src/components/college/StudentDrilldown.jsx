import { useEffect, useState } from 'react';
import {
  BarChart3, FolderCheck, FileText, Activity as ActivityIcon, Github,
  ExternalLink, Clock, Target, Sparkles, ShieldCheck, AlertTriangle, Bell,
  Download, ClipboardList, CheckCircle2, CircleDashed, Eye,
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
  // Was fixed dark-theme pastels — unreadable as a ring on paper.
  const tone = v >= 70 ? 'var(--ok)' : v >= 45 ? 'var(--info)' : v >= 20 ? 'var(--warn)' : 'var(--danger)';
  return (
    <div className="flex items-center gap-3">
      <svg width="84" height="84" viewBox="0 0 84 84" className="shrink-0">
        <circle cx="42" cy="42" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="7" />
        <circle cx="42" cy="42" r={r} fill="none" stroke={tone} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 42 42)" />
        <text x="42" y="47" textAnchor="middle" fill="var(--text-primary)" fontSize="19" fontWeight="700">{v}</text>
      </svg>
      <div>
        <div className="font-display text-sm text-fg">{category || '—'}</div>
        <div className="text-[11px] uppercase tracking-wider text-fg-muted">Placement readiness</div>
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
          <div className="mb-0.5 flex justify-between text-[11px] text-fg-secondary"><span>{label}</span><span className="font-mono">{v}</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-1">
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
        <path d={path} fill="none" stroke="var(--info)" strokeWidth="2" strokeLinecap="round" />
        {pts.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.score)} r="3" fill="var(--brand-text)" />)}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-muted">
        {history.slice(0, 3).map((p, i) => (
          <span key={i} className="font-mono">{p.score}/100 · {p.targetRole || 'General'} · {fmtDate(p.at)}</span>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   RESUME — read + download for the placement cell
   ------------------------------------------------------------
   The resume snapshot was already stored on UserState.resume and
   already fetched by the detail query, then dropped. The cell
   could see a SCORE for every student and never the document.

   Provenance is stated on the card on purpose: the product
   extracts resume text client-side, so the original PDF/DOCX
   bytes never reach the server. Offering a "Download PDF" button
   here would be claiming to hand over a file the server does not
   have.
   ============================================================ */
function ResumeCard({ studentId, resume, latestScore }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState(null); // null = closed
  const available = !!resume?.available;

  const download = async () => {
    setBusy(true); setErr('');
    try { await College.downloadStudentResume(studentId, resume?.fileName || 'resume'); }
    catch (e) { setErr(e?.message || 'Download failed.'); }
    finally { setBusy(false); }
  };

  const showPreview = async () => {
    setBusy(true); setErr('');
    try {
      const r = await College.studentResume(studentId);
      setPreview(r?.resume?.text || '');
    } catch (e) { setErr(e?.message || 'Could not load the resume.'); }
    finally { setBusy(false); }
  };

  const score = resume?.score ?? latestScore ?? null;

  return (
    <div className="rounded-xl border border-subtle bg-surface-1 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <FileText size={14} className="text-aurora-violet" /> Resume on file
        </div>
        {score != null && <Badge tone={score >= 70 ? 'mint' : score >= 45 ? 'cyan' : 'amber'}>{score}/100</Badge>}
      </div>

      {!available && (
        <p className="text-sm text-muted">
          No resume uploaded yet. Assign the &ldquo;Upload your latest resume&rdquo; task to chase it.
        </p>
      )}

      {available && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-secondary">
            {resume.fileName && <span className="font-mono truncate max-w-full">{resume.fileName}</span>}
            {resume.targetRole && <span className="inline-flex items-center gap-1"><Target size={11} /> {resume.targetRole}</span>}
            {resume.characters > 0 && <span>{resume.characters.toLocaleString('en-IN')} characters</span>}
            {resume.updatedAt && <span>updated {rel(resume.updatedAt)}</span>}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="soft" onClick={download} disabled={busy}>
              <Download size={13} /> {busy ? 'Preparing…' : 'Download resume'}
            </Button>
            <Button size="sm" variant="ghost" onClick={preview === null ? showPreview : () => setPreview(null)} disabled={busy}>
              <Eye size={13} /> {preview === null ? 'Preview' : 'Hide preview'}
            </Button>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">
            Downloads as <span className="font-mono">.txt</span> — this is the resume text the student submitted for
            scoring. The original PDF is processed in the browser and never stored on the server.
          </p>

          {preview !== null && (
            <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-subtle bg-field p-3 font-mono text-[11px] leading-relaxed text-fg-secondary">
              {preview || 'Empty resume text.'}
            </pre>
          )}
        </>
      )}

      {err && <p className="mt-2 text-[12px] text-danger">{err}</p>}
    </div>
  );
}

/* ============================================================
   ASSIGNED WORK — per-student task progress
   ------------------------------------------------------------
   The cohort table shows "4 assigned, 0 done" per task. On an
   individual's profile the question is the other way round: what
   was THIS student asked to do, and did they do it.
   ============================================================ */
function AssignedTasks({ tasks = [], summary }) {
  if (!tasks.length) {
    return (
      <div className="rounded-xl border border-subtle bg-surface-1 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-fg">
          <ClipboardList size={14} className="text-aurora-cyan" /> Assigned work
        </div>
        <p className="text-sm text-muted">No tasks assigned to this student yet.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-subtle bg-surface-1 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <ClipboardList size={14} className="text-aurora-cyan" /> Assigned work ({tasks.length})
        </div>
        {summary && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-fg-secondary">{summary.done}/{summary.assigned} done</span>
            {summary.overdue > 0 && <Badge tone="rose">{summary.overdue} overdue</Badge>}
          </div>
        )}
      </div>

      {summary?.assigned > 0 && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-aurora-cta" style={{ width: `${Math.max(2, summary.completionRate)}%` }} />
        </div>
      )}

      <ul className="space-y-2">
        {tasks.slice(0, 10).map((t) => (
          <li key={t.id} className="flex items-start justify-between gap-3 rounded-lg border border-subtle bg-surface-1 px-3 py-2">
            <div className="flex min-w-0 items-start gap-2">
              {t.done
                ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />
                : <CircleDashed size={14} className={`mt-0.5 shrink-0 ${t.overdue ? 'text-danger' : 'text-fg-muted'}`} />}
              <div className="min-w-0">
                <div className="truncate text-sm text-fg">{t.title}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-fg-muted">
                  <span>assigned {rel(t.assignedAt)}</span>
                  {t.dueAt && <span>due {fmtDate(t.dueAt)}</span>}
                  {t.done && t.doneAt && <span className="text-ok">completed {rel(t.doneAt)}</span>}
                </div>
              </div>
            </div>
            <Badge tone={t.done ? 'mint' : t.overdue ? 'rose' : 'amber'}>
              {t.done ? 'Done' : t.overdue ? 'Overdue' : 'Open'}
            </Badge>
          </li>
        ))}
      </ul>
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
        <div className="flex items-center gap-2 py-6 text-sm text-danger">
          <AlertTriangle size={15} /> {state.error} {seed ? '— showing roster summary only.' : ''}
        </div>
      )}

      {!state.loading && !state.error && s && (
        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          {/* Identity + readiness header */}
          <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-subtle bg-surface-1 p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-lg text-fg">{s.name || s.email}</span>
                {s.readiness?.category && <Badge tone={s.readiness.score >= 65 ? 'mint' : s.readiness.score >= 45 ? 'cyan' : 'amber'}>{s.readiness.category}</Badge>}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-secondary">
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
            <div className="rounded-xl border border-subtle bg-surface-1 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg"><BarChart3 size={14} className="text-aurora-cyan" /> Readiness breakdown</div>
              <ComponentBars components={s.readiness?.components || {}} />
              {(s.readiness?.gaps || []).length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-subtle pt-3 text-[12px] text-fg-secondary">
                  {s.readiness.gaps.slice(0, 4).map((g, i) => <li key={i} className="flex gap-1.5"><span className="text-amber-glow">→</span> {g}</li>)}
                </ul>
              )}
            </div>

            {/* Skills: verified ledger vs declared */}
            <div className="rounded-xl border border-subtle bg-surface-1 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg"><ShieldCheck size={14} className="text-aurora-mint" /> Skill ledger</div>
              {s.skillLedger.length === 0 && <p className="text-sm text-muted">No skill XP yet.</p>}
              <div className="flex flex-wrap gap-1.5">
                {s.skillLedger.slice(0, 14).map((r) => (
                  <span key={r.skill} className={`rounded-lg border px-2 py-0.5 text-[11px] ${r.verifiedXp > 0 ? 'border-aurora-mint/30 bg-aurora-mint/10 text-ok' : 'border-subtle bg-surface-1 text-fg-secondary'}`}>
                    {r.skill} <span className="font-mono opacity-70">{r.verifiedXp > 0 ? `${r.verifiedXp}xp` : `${r.pendingXp}xp pending`}</span>
                  </span>
                ))}
              </div>
              {(s.skills || []).length > 0 && (
                <p className="mt-3 border-t border-subtle pt-2 text-[11px] text-fg-muted">
                  Declared on profile: {(s.skills || []).slice(0, 10).join(', ')}{(s.skills || []).length > 10 ? '…' : ''}
                </p>
              )}
            </div>
          </div>

          {/* Project verification pipeline */}
          <div className="rounded-xl border border-subtle bg-surface-1 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg"><FolderCheck size={14} className="text-aurora-violet" /> Projects ({s.projects.length})</div>
            {s.projects.length === 0 && <p className="text-sm text-muted">No project submissions yet.</p>}
            <ul className="space-y-2">
              {s.projects.slice(0, 8).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-subtle bg-surface-1 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-fg">{p.title}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-fg-muted">
                      {(p.status === 'verified' ? p.verifiedSkills : p.claimedSkills).slice(0, 4).map((sk) => <span key={sk} className="font-mono">{sk}</span>)}
                      <span>{rel(p.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.githubUrl && <a href={p.githubUrl} target="_blank" rel="noreferrer" className="text-fg-secondary hover:text-fg"><Github size={14} /></a>}
                    {p.liveDemoUrl && <a href={p.liveDemoUrl} target="_blank" rel="noreferrer" className="text-fg-secondary hover:text-fg"><ExternalLink size={14} /></a>}
                    <Badge tone={STATUS_TONE[p.status] || 'default'}>{p.status.replace('_', ' ')}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Resume: the actual document, downloadable by the placement cell */}
          <div className="grid gap-4 md:grid-cols-2">
            <ResumeCard studentId={studentId} resume={s.resume} latestScore={s.resumeHistory?.[0]?.score} />
            <AssignedTasks tasks={s.assignedTasks || []} summary={s.taskSummary} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Resume trend */}
            <div className="rounded-xl border border-subtle bg-surface-1 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg"><FileText size={14} className="text-aurora-cyan" /> Resume trend</div>
              <ResumeTrend history={s.resumeHistory} />
            </div>
            {/* Activity feed */}
            <div className="rounded-xl border border-subtle bg-surface-1 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg"><ActivityIcon size={14} className="text-aurora-mint" /> Recent activity</div>
              {s.activity.length === 0 && <p className="text-sm text-muted">No recorded activity.</p>}
              <ul className="space-y-1.5 text-[12px]">
                {s.activity.slice(0, 8).map((a, i) => (
                  <li key={i} className="flex justify-between gap-3 text-fg-secondary">
                    <span className="min-w-0 truncate">{a.text}</span>
                    <span className="shrink-0 font-mono text-fg-muted">{rel(a.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-3">
            <Button size="sm" variant="soft" onClick={nudge}><Bell size={13} /> Nudge student</Button>
            {notifyStatus && <span className="text-[12px] text-fg-muted">{notifyStatus}</span>}
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-fg-muted"><Sparkles size={11} /> Scores are deterministic — verified signals only</span>
          </div>
        </div>
      )}
    </Modal>
  );
}
