/* ============================================================
   Team Projects — placement-cell group assignments
   ------------------------------------------------------------
   The workflow, in the order a coordinator actually performs it:

     Form teams  → the engine splits a filtered cohort into balanced
                   teams and shows each team's real skill coverage.
     Review      → each proposed team arrives with a project already
                   matched to its skills, plus the rationale for why
                   THIS team got THIS project.
     Assign      → creates the assignment and notifies every member.
     Track       → one row per team: status, deadline, submission.
     Verify      → runs the real proof check against the live hosted
                   URL the team submitted, and shows every check.

   Nothing on this screen is computed locally. Team formation, skill
   analysis, project generation and verification all come from the
   server's deterministic engine, so what a coordinator sees here can
   never disagree with what the student sees in their workspace.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users2, Sparkles, Send, ShieldCheck, Globe, Github, ChevronLeft, Plus, Trash2,
  CalendarClock, AlertTriangle, CheckCircle2, Clock, RefreshCw, Layers, Target,
  ListChecks, UserCircle2, Link2, HelpCircle,
} from 'lucide-react';
import { SectionCard, StatCard } from '../../views/common.jsx';
import { Button, Badge, Spinner, EmptyState, Input, Field, Modal } from '../ui/kit.jsx';
import { College } from '../../lib/api.js';
import TeamMemberProgress from './TeamMemberProgress.jsx';

const STATUS_TONE = {
  assigned: 'cyan', in_progress: 'cyan', submitted: 'amber',
  verified: 'mint', needs_work: 'amber', overdue: 'amber', closed: 'default',
};
const STATUS_LABEL = {
  assigned: 'Assigned', in_progress: 'In progress', submitted: 'Submitted — awaiting check',
  verified: 'Verified', needs_work: 'Needs work', overdue: 'Overdue', closed: 'Closed',
};

const CHECK_TONE = { pass: 'mint', fail: 'amber', unavailable: 'default', not_submitted: 'default' };
const CHECK_ICON = { pass: CheckCircle2, fail: AlertTriangle, unavailable: Clock, not_submitted: HelpCircle };

const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/* ------------------------------------------------------------------ */
/* Skill coverage bar — the "customised to team skills" evidence        */
/* ------------------------------------------------------------------ */
function CoverageStrip({ analysis }) {
  if (!analysis) return null;
  const areas = (analysis.areas || []).filter((a) => a.depth > 0).slice(0, 6);
  const gaps = (analysis.areas || []).filter((a) => a.depth === 0).slice(0, 3);
  const max = Math.max(1, ...areas.map((a) => a.depth));
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-fg-secondary">
        <Layers size={13} />
        <span>Team skill coverage</span>
        <Badge tone={analysis.coverageScore >= 70 ? 'mint' : analysis.coverageScore >= 40 ? 'cyan' : 'amber'}>
          {analysis.coverageScore}/100
        </Badge>
      </div>
      {areas.length === 0 && <p className="text-xs text-fg-muted">No recognisable skills declared by this team yet.</p>}
      {areas.map((a) => (
        <div key={a.id} className="flex items-center gap-2">
          <span className="w-32 shrink-0 truncate text-[11px] text-fg-secondary">{a.label}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-1">
            <div className="h-full rounded-full bg-aurora-cta" style={{ width: `${Math.round((a.depth / max) * 100)}%` }} />
          </div>
          <span className="w-16 shrink-0 text-right text-[10px] text-fg-muted">{a.memberCount} member{a.memberCount === 1 ? '' : 's'}</span>
        </div>
      ))}
      {gaps.length > 0 && (
        <p className="text-[11px] text-fg-muted">
          Not covered: {gaps.map((g) => g.label).join(', ')} — treated as the deliberate stretch in the brief.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Brief renderer — shared by the preview modal and the detail view    */
/* ------------------------------------------------------------------ */
function BriefBody({ brief, members = [] }) {
  if (!brief) return null;
  const nameOf = (id) => members.find((m) => m.studentId === id)?.name || id;
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-subtle bg-surface-1 p-4">
        <p className="text-sm text-fg">{brief.oneLine}</p>
        <p className="mt-2 flex items-start gap-2 text-xs text-fg-secondary">
          <Target size={13} className="mt-0.5 shrink-0" /> {brief.whyThisTeam}
        </p>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">The problem</p>
        <p className="text-sm text-fg-secondary">{brief.problem}</p>
        <p className="mt-1 text-xs text-fg-muted">For: {brief.targetUsers}</p>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Must build</p>
        <ul className="space-y-1.5">
          {(brief.mustBuild || []).map((x, i) => (
            <li key={i} className="flex gap-2 text-sm text-fg-secondary"><span className="text-fg-muted">{i + 1}.</span>{x}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-fg-secondary"><span className="text-fg-muted">What makes it stand out: </span>{brief.differentiator}</p>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Who owns what</p>
        <div className="space-y-2">
          {(brief.assignments || []).map((a) => (
            <div key={a.studentId} className="rounded-xl border border-subtle bg-surface-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <UserCircle2 size={14} className="text-fg-muted" />
                <span className="text-sm font-medium text-fg">{a.name || nameOf(a.studentId)}</span>
                <Badge tone="violet">{a.role}</Badge>
                {a.stretch && <Badge tone="amber">Stretch assignment</Badge>}
              </div>
              <p className="mt-1.5 text-xs text-fg-secondary">{a.modules.join(' · ')}</p>
              {a.matchedSkills?.length > 0 && (
                <p className="mt-1 text-[11px] text-fg-muted">Matched on: {a.matchedSkills.join(', ')}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Stack (drawn from the team's own skills)</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(brief.stack || {}).map(([area, list]) => (
            <span key={area} className="rounded-lg border border-subtle bg-surface-1 px-2 py-1 text-[11px] text-fg-secondary">
              <span className="text-fg-muted">{area}:</span> {list.join(', ')}
            </span>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Milestones</p>
        <div className="space-y-1.5">
          {(brief.milestones || []).map((m) => (
            <div key={m.key} className="flex gap-3 rounded-xl border border-subtle bg-surface-1 p-2.5">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-1 text-[10px] text-fg-secondary">{m.index}</span>
              <div>
                <p className="text-sm text-fg">{m.title}</p>
                <p className="text-xs text-fg-muted">{m.detail}</p>
                <p className="mt-0.5 text-[10px] text-fg-muted">Day {m.dayOffset} · {fmtDate(m.dueAt)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Proof required</p>
          <ul className="space-y-1">
            {(brief.proofRequirements || []).map((p) => (
              <li key={p.key} className="text-xs text-fg-secondary">
                <span className={p.required ? 'text-fg' : 'text-fg-secondary'}>{p.label}</span>
                {p.required ? <span className="text-fg-muted"> · required</span> : <span className="text-fg-muted"> · bonus</span>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Accepted when</p>
          <ul className="space-y-1">
            {(brief.acceptanceCriteria || []).map((c, i) => (
              <li key={i} className="text-xs text-fg-secondary">{c}</li>
            ))}
          </ul>
        </div>
      </div>

      {(brief.gapPlan || []).length > 0 && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-200"><AlertTriangle size={13} /> Skill gaps to plan for</p>
          {brief.gapPlan.map((g) => <p key={g.area} className="text-xs text-fg-secondary">{g.note}</p>)}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Team formation                                                      */
/* ------------------------------------------------------------------ */
function FormTeams({ onAssigned }) {
  const [teamSize, setTeamSize] = useState(4);
  const [strategy, setStrategy] = useState('balanced');
  const [filters, setFilters] = useState({ branch: '', batch: '', minReadiness: '' });
  const [limit, setLimit] = useState(20);
  const [state, setState] = useState({ loading: false, error: '', teams: [] });
  const [detail, setDetail] = useState(null);   // team being reviewed / assigned

  /* Hand-picking. The API has always accepted studentIds, but the panel only
     ever sent filters — so a coordinator who wanted a specific team (the four
     final-years presenting on Friday) had no way to say so. */
  const [picking, setPicking] = useState(false);
  const [roster, setRoster] = useState({ loading: false, rows: [], error: '' });
  const [chosen, setChosen] = useState([]);     // student ids, in click order
  const [search, setSearch] = useState('');

  const loadRoster = async () => {
    setRoster((p) => ({ ...p, loading: true, error: '' }));
    try {
      const r = await College.students({
        deep: '1', limit: 500, sort: 'readinessScore', order: 'desc',
        branch: filters.branch, batch: filters.batch,
      });
      setRoster({ loading: false, rows: r?.students || [], error: r?.ok ? '' : 'Could not load the cohort.' });
    } catch (e) {
      setRoster({ loading: false, rows: [], error: e?.message || 'Could not load the cohort.' });
    }
  };

  const openPicker = () => { setPicking(true); if (!roster.rows.length) loadRoster(); };
  const toggle = (id) => setChosen((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const visibleRoster = roster.rows.filter((s) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return `${s.name || ''} ${s.email || ''} ${s.branch || ''}`.toLowerCase().includes(q);
  });

  const run = async (useChosen = false) => {
    setState({ loading: true, error: '', teams: [] });
    try {
      const r = await College.suggestTeams({
        teamSize: Number(teamSize), strategy, limit: Number(limit),
        // When students are hand-picked the filters are irrelevant — the
        // selection IS the pool, and the server splits exactly those people.
        studentIds: useChosen ? chosen : [],
        filters: useChosen ? {} : {
          branch: filters.branch, batch: filters.batch,
          minReadiness: filters.minReadiness === '' ? null : Number(filters.minReadiness),
        },
      });
      if (!r.ok) { setState({ loading: false, error: r.message || 'Could not form teams.', teams: [] }); return; }
      setState({ loading: false, error: '', teams: r.teams || [] });
      setPicking(false);
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Could not form teams.', teams: [] });
    }
  };

  return (
    <>
      <SectionCard
        title="Form teams from your cohort"
        eyebrow="Step 1"
        action={(
          <div className="flex gap-2">
            <Button size="sm" variant="soft" onClick={openPicker}>
              <ListChecks size={14} /> Pick students{chosen.length ? ` (${chosen.length})` : ''}
            </Button>
            <Button size="sm" onClick={() => run(false)} disabled={state.loading}>
              {state.loading ? <Spinner /> : <Sparkles size={14} />} Form teams
            </Button>
          </div>
        )}
      >
        <p className="mb-4 text-sm text-fg-secondary">
          Students are split into teams and each team gets a project matched to the skills it actually has —
          declared and verified. Balanced formation mixes readiness levels so no team is all-strong or all-struggling.
          Auto-selection takes the most placement-ready students who have declared skills; use <em>Pick students</em>
          to choose a specific team by hand.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Team size">
            <Input type="number" min="2" max="8" value={teamSize} onChange={(e) => setTeamSize(e.target.value)} />
          </Field>
          <Field label="Formation">
            <select
              value={strategy} onChange={(e) => setStrategy(e.target.value)}
              className="w-full rounded-xl border border-subtle bg-surface-1 px-3 py-2 text-sm text-fg"
            >
              <option value="balanced" className="bg-slate-900">Balanced (mixed readiness)</option>
              <option value="similar" className="bg-slate-900">Streamed (similar readiness)</option>
            </select>
          </Field>
          <Field label="Branch" hint="Blank = all">
            <Input value={filters.branch} onChange={(e) => setFilters((p) => ({ ...p, branch: e.target.value }))} placeholder="CSE" />
          </Field>
          <Field label="Batch" hint="Blank = all">
            <Input value={filters.batch} onChange={(e) => setFilters((p) => ({ ...p, batch: e.target.value }))} placeholder="2026" />
          </Field>
          <Field label="Pool size" hint="Students considered">
            <Input type="number" min="2" max="120" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
        </div>
        {state.error && <p className="mt-3 text-sm text-amber-300">{state.error}</p>}
      </SectionCard>

      {state.teams.length > 0 && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {state.teams.map((t) => (
            <div key={t.index} className="rounded-2xl border border-subtle bg-surface-1 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-base font-semibold text-fg">{t.name}</p>
                  <p className="text-xs text-fg-muted">{t.members.length} students · avg readiness {t.analysis.avgReadiness}</p>
                </div>
                <Badge tone="violet">{t.preview.archetypeId.replace(/_/g, ' ')}</Badge>
              </div>

              <p className="mb-3 rounded-xl border border-subtle bg-surface-1 p-3 text-sm text-fg">{t.preview.title}</p>

              <div className="mb-3 flex flex-wrap gap-1.5">
                {t.members.map((m) => (
                  <span key={m.studentId} className="rounded-lg border border-subtle bg-surface-1 px-2 py-1 text-[11px] text-fg-secondary">
                    {m.name} <span className="text-fg-muted">· {m.branch || '—'} · {m.readinessScore}</span>
                  </span>
                ))}
              </div>

              <CoverageStrip analysis={t.analysis} />

              <div className="mt-4 flex gap-2">
                <Button size="sm" onClick={() => setDetail(t)}><ListChecks size={14} /> Review & assign</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={picking} onClose={() => setPicking(false)} width="max-w-3xl" title="Pick students for this team">
        <div className="space-y-4">
          <Input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or branch…"
          />
          {roster.loading && <p className="text-sm text-fg-secondary"><Spinner /> Loading the cohort…</p>}
          {roster.error && <p className="text-sm text-amber-300">{roster.error}</p>}
          <div className="max-h-[45vh] space-y-1 overflow-y-auto">
            {visibleRoster.map((s) => {
              const on = chosen.includes(s.id);
              const noSkills = !(s.skills || []).length;
              return (
                <button
                  key={s.id} type="button" onClick={() => toggle(s.id)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${
                    on ? 'border-violet-400/40 bg-violet-400/[0.08] text-fg' : 'border-subtle bg-surface-1 text-fg-secondary hover:border-strong'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.name || s.email}</span>
                    <span className="block truncate text-[11px] text-fg-muted">
                      {s.branch || '—'} · {s.batch || '—'} · {(s.skills || []).length} skills
                      {/* Flagged rather than hidden: pairing a junior with a strong
                          team is a legitimate choice, but it should be deliberate. */}
                      {noSkills && <span className="text-amber-300/80"> · no declared skills</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-fg-secondary">readiness {s.readinessScore ?? '—'}</span>
                </button>
              );
            })}
            {!roster.loading && !visibleRoster.length && (
              <p className="text-sm text-fg-muted">No students match that search.</p>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-fg-muted">
              {chosen.length} selected · they will be split into teams of {teamSize}
            </p>
            <div className="flex gap-2">
              <Button variant="soft" size="sm" onClick={() => setChosen([])}>Clear</Button>
              <Button size="sm" onClick={() => run(true)} disabled={chosen.length < 2 || state.loading}>
                {state.loading ? <Spinner /> : <Sparkles size={14} />} Form teams from selection
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <AssignModal
        team={detail}
        onClose={() => setDetail(null)}
        onAssigned={(p) => { setDetail(null); onAssigned?.(p); }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Review + assign                                                     */
/* ------------------------------------------------------------------ */
function AssignModal({ team, onClose, onAssigned }) {
  const [teamName, setTeamName] = useState('');
  const [domain, setDomain] = useState('');
  const [archetypeId, setArchetypeId] = useState('');
  const [difficulty, setDifficulty] = useState('standard');
  const [dueAt, setDueAt] = useState('');
  const [notes, setNotes] = useState('');
  const [catalog, setCatalog] = useState([]);
  const [brief, setBrief] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!team) return;
    setTeamName(team.name);
    setDomain(''); setArchetypeId(''); setDifficulty('standard'); setNotes(''); setError('');
    // Default deadline: three weeks out, which is what the milestone plan is sized for.
    setDueAt(new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10));
    setBrief(team.preview);
    College.teamCatalog().then((r) => setCatalog(r?.archetypes || [])).catch(() => {});
  }, [team]);

  const regenerate = async () => {
    if (!team) return;
    setBusy(true); setError('');
    try {
      const r = await College.previewTeamProject({
        studentIds: team.memberIds, domain, archetypeId, difficulty, dueAt, notes,
      });
      if (r.ok) setBrief(r.brief); else setError(r.message || 'Could not regenerate the brief.');
    } catch (e) { setError(e?.message || 'Could not regenerate the brief.'); }
    setBusy(false);
  };

  const assign = async () => {
    if (!team) return;
    setBusy(true); setError('');
    try {
      const r = await College.assignTeamProject({
        studentIds: team.memberIds, teamName, domain, archetypeId, difficulty, dueAt, notes,
      });
      if (r.ok) onAssigned?.(r); else setError(r.message || 'Could not assign this project.');
    } catch (e) { setError(e?.message || 'Could not assign this project.'); }
    setBusy(false);
  };

  return (
    <Modal open={!!team} onClose={onClose} width="max-w-4xl" title={`Assign a project to ${team?.name || 'this team'}`}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Team name"><Input value={teamName} onChange={(e) => setTeamName(e.target.value)} /></Field>
          <Field label="Domain" hint="Optional — scopes the problem">
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="e.g. campus placements" />
          </Field>
          <Field label="Deadline"><Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></Field>
          <Field label="Project type" hint="Blank = best skill match">
            <select
              value={archetypeId} onChange={(e) => setArchetypeId(e.target.value)}
              className="w-full rounded-xl border border-subtle bg-surface-1 px-3 py-2 text-sm text-fg"
            >
              <option value="" className="bg-slate-900">Auto — match to team skills</option>
              {catalog.map((a) => <option key={a.id} value={a.id} className="bg-slate-900">{a.title}</option>)}
            </select>
          </Field>
          <Field label="Scope">
            <select
              value={difficulty} onChange={(e) => setDifficulty(e.target.value)}
              className="w-full rounded-xl border border-subtle bg-surface-1 px-3 py-2 text-sm text-fg"
            >
              <option value="starter" className="bg-slate-900">Starter</option>
              <option value="standard" className="bg-slate-900">Standard</option>
              <option value="stretch" className="bg-slate-900">Stretch</option>
            </select>
          </Field>
          <div className="flex items-end">
            <Button variant="soft" size="sm" onClick={regenerate} disabled={busy}>
              {busy ? <Spinner /> : <RefreshCw size={14} />} Regenerate brief
            </Button>
          </div>
        </div>

        <Field label="Note to the team" hint="Optional — appears in their workspace">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Present at the Friday review." />
        </Field>

        <div className="max-h-[45vh] overflow-y-auto rounded-xl border border-subtle p-4">
          <BriefBody brief={brief} members={team?.members || []} />
        </div>

        {error && <p className="text-sm text-amber-300">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="soft" onClick={onClose}>Cancel</Button>
          <Button onClick={assign} disabled={busy}>
            {busy ? <Spinner /> : <Send size={14} />} Assign & notify {team?.members.length || 0} students
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Verification result                                                 */
/* ------------------------------------------------------------------ */
function VerificationBlock({ verification }) {
  if (!verification) {
    return (
      <p className="text-xs text-fg-muted">
        Not checked yet. Run the check once the team has submitted a live URL — it fetches the deployment for real.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={verification.passed ? 'mint' : verification.pending ? 'cyan' : 'amber'}>
          {verification.passed ? 'Verified' : verification.pending ? 'Pending — could not complete' : 'Not verified'}
        </Badge>
        <span className="text-xs text-fg-muted">checked {fmtDate(verification.checkedAt)}</span>
      </div>
      <p className="text-xs text-fg-secondary">{verification.summary}</p>
      <div className="space-y-1">
        {(verification.checks || []).map((c) => {
          const Icon = CHECK_ICON[c.state] || HelpCircle;
          return (
            <div key={c.key} className="flex items-start gap-2 rounded-lg border border-subtle bg-surface-1 p-2">
              <Icon size={13} className="mt-0.5 shrink-0 text-fg-muted" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-fg">{c.label}</span>
                  <Badge tone={CHECK_TONE[c.state] || 'default'}>{c.state.replace(/_/g, ' ')}</Badge>
                  {!c.required && <span className="text-[10px] text-fg-muted">bonus</span>}
                </div>
                {c.note && <p className="mt-0.5 text-[11px] text-fg-muted">{c.note}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Assignment detail                                                   */
/* ------------------------------------------------------------------ */
function ProjectDetail({ id, onBack, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await College.teamProject(id);
      if (r.ok) setData(r); else setError(r.error || 'Could not load this project.');
    } catch (e) { setError(e?.message || 'Could not load this project.'); }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const requestLink = async () => {
    setBusy('request');
    try { await College.requestTeamLink(id, 'Please submit your live hosted URL for verification.'); await load(); onChanged?.(); }
    catch (e) { setError(e?.message || 'Could not send the request.'); }
    setBusy('');
  };

  const verify = async () => {
    setBusy('verify');
    try { const r = await College.verifyTeamProject(id); if (r.ok) { await load(); onChanged?.(); } }
    catch (e) { setError(e?.message || 'Verification could not run.'); }
    setBusy('');
  };

  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-muted"><Spinner /> Loading project…</div>;
  if (error || !data) return <EmptyState icon={AlertTriangle} title="Couldn’t load this project" hint={error} action={<Button size="sm" variant="soft" onClick={onBack}>Back</Button>} />;

  const p = data.project;
  const sub = p.submission || {};

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-fg-secondary transition hover:text-fg">
        <ChevronLeft size={15} /> All team projects
      </button>

      <SectionCard
        title={p.title}
        eyebrow={p.teamName}
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="soft" onClick={requestLink} disabled={busy === 'request'}>
              {busy === 'request' ? <Spinner /> : <Link2 size={14} />} Ask for live link
            </Button>
            <Button size="sm" onClick={verify} disabled={busy === 'verify'}>
              {busy === 'verify' ? <Spinner /> : <ShieldCheck size={14} />} Verify submission
            </Button>
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[p.summary.status] || 'default'}>{STATUS_LABEL[p.summary.status] || p.summary.status}</Badge>
          {p.dueAt && <span className="flex items-center gap-1 text-xs text-fg-muted"><CalendarClock size={12} /> Due {fmtDate(p.dueAt)}</span>}
          {p.summary.overdue && <Badge tone="amber">Overdue</Badge>}
          {p.summary.daysLeft != null && p.summary.daysLeft >= 0 && (
            <span className="text-xs text-fg-muted">{p.summary.daysLeft} day{p.summary.daysLeft === 1 ? '' : 's'} left</span>
          )}
        </div>

        {/* ---- Submission: the live hosted link the coordinator asked for ---- */}
        <div className="mb-5 rounded-xl border border-subtle bg-surface-1 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Submitted proof</p>
          {!sub.liveUrl && !sub.repoUrl && (
            <p className="text-sm text-fg-secondary">
              Nothing submitted yet. Use “Ask for live link” to notify the team — every member gets the request in their workspace.
            </p>
          )}
          {(sub.liveUrl || sub.repoUrl) && (
            <div className="space-y-2">
              {sub.liveUrl && (
                <a href={sub.liveUrl} target="_blank" rel="noreferrer noopener"
                  className="flex items-center gap-2 text-sm text-cyan-300 underline-offset-2 hover:underline">
                  <Globe size={14} /> {sub.liveUrl}
                </a>
              )}
              {sub.repoUrl && (
                <a href={sub.repoUrl} target="_blank" rel="noreferrer noopener"
                  className="flex items-center gap-2 text-sm text-cyan-300 underline-offset-2 hover:underline">
                  <Github size={14} /> {sub.repoUrl}
                </a>
              )}
              <p className="text-[11px] text-fg-muted">
                Submitted by {sub.submittedBy || 'a team member'} on {fmtDate(sub.submittedAt)}
              </p>
              {sub.notes && <p className="text-xs text-fg-secondary">{sub.notes}</p>}
            </div>
          )}
          <div className="mt-4 border-t border-subtle pt-3">
            <VerificationBlock verification={p.verification} />
          </div>
        </div>

        {/* ---- Assigned students, with their live profile numbers ---- */}
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Assigned students</p>
        <div className="mb-5 grid gap-2 sm:grid-cols-2">
          {(data.profiles || []).map((m) => {
            const role = (p.brief?.assignments || []).find((a) => a.studentId === m.studentId);
            return (
              <div key={m.studentId} className="rounded-xl border border-subtle bg-surface-1 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{m.name}</p>
                    <p className="truncate text-[11px] text-fg-muted">{m.email}</p>
                    <p className="text-[11px] text-fg-muted">{[m.branch, m.batch, m.year].filter(Boolean).join(' · ') || '—'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-fg">{m.live?.readinessScore ?? m.readinessScore}</p>
                    <p className="text-[10px] text-fg-muted">readiness</p>
                  </div>
                </div>
                {role && <Badge tone="violet" className="mt-2">{role.role}</Badge>}
                <p className="mt-1.5 text-[11px] text-fg-muted">
                  {m.live?.verifiedProjects ?? m.verifiedProjects} verified project(s)
                  {m.live?.resumeScore != null && ` · resume ${m.live.resumeScore}`}
                </p>
                {!m.stillInCohort && <p className="mt-1 text-[11px] text-amber-300">No longer in your cohort.</p>}
              </div>
            );
          })}
        </div>

        {/* ---- Individual progress ----
             The "Assigned students" grid above shows who is ON the team; this
             shows what each of them has actually DONE. A team-level status of
             "submitted" tells a placement cell nothing about whether one student
             carried the build, which is the decision they are trying to make. */}
        <div className="mb-5 border-t border-subtle pt-5">
          <TeamMemberProgress projectId={p.id} />
        </div>

        <BriefBody brief={p.brief} members={p.members} />

        {(p.linkRequests || []).length > 0 && (
          <div className="mt-5 rounded-xl border border-subtle bg-surface-1 p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">Link requests sent</p>
            {p.linkRequests.map((r, i) => (
              <p key={i} className="text-[11px] text-fg-muted">{fmtDate(r.at)} — {r.message || 'Live link requested.'}</p>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel root                                                          */
/* ------------------------------------------------------------------ */
export default function TeamProjectsPanel() {
  const [view, setView] = useState('list');   // list | form | detail
  const [openId, setOpenId] = useState('');
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((p) => ({ ...p, loading: true }));
    College.teamProjects()
      .then((r) => { if (alive) setState({ loading: false, error: r.ok ? '' : 'Could not load team projects.', data: r }); })
      .catch((e) => { if (alive) setState({ loading: false, error: e?.message || 'Could not load team projects.', data: null }); });
    return () => { alive = false; };
  }, [tick]);

  const refresh = () => setTick((t) => t + 1);
  const projects = state.data?.projects || [];
  const summary = state.data?.summary || {};

  if (view === 'detail' && openId) {
    return <ProjectDetail id={openId} onBack={() => { setView('list'); setOpenId(''); refresh(); }} onChanged={refresh} />;
  }

  if (view === 'form') {
    return (
      <div className="space-y-4">
        <button onClick={() => setView('list')} className="flex items-center gap-1 text-sm text-fg-secondary transition hover:text-fg">
          <ChevronLeft size={15} /> All team projects
        </button>
        <FormTeams onAssigned={(r) => { refresh(); setOpenId(r.project.id); setView('detail'); }} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard i={0} icon={Users2} tone="violet" label="Team projects" value={String(summary.total ?? 0)} />
        <StatCard i={1} icon={Clock} tone="cyan" label="Awaiting submission" value={String(summary.assigned ?? 0)} />
        <StatCard i={2} icon={Globe} tone="amber" label="Submitted, unverified" value={String(summary.submitted ?? 0)} />
        <StatCard i={3} icon={ShieldCheck} tone="mint" label="Verified" value={String(summary.verified ?? 0)} hint="live URL checked" />
      </div>

      <SectionCard
        title="Team projects"
        eyebrow="Group assignments"
        action={<Button size="sm" onClick={() => setView('form')}><Plus size={14} /> Form a team</Button>}
      >
        <p className="mb-4 text-sm text-fg-secondary">
          Assign a project to a group of students, customised to the skills that group actually has.
          Every member is notified, each one owns named modules, and the team submits a live hosted URL
          that is verified by fetching it — not by taking their word for it.
        </p>

        {state.loading && <div className="flex items-center gap-2 py-8 text-sm text-muted"><Spinner /> Loading…</div>}
        {!state.loading && state.error && <p className="text-sm text-amber-300">{state.error}</p>}

        {!state.loading && !state.error && projects.length === 0 && (
          <EmptyState
            icon={Users2}
            title="No team projects yet"
            hint="Form a team from your cohort and the engine will generate a project matched to their combined skills."
            action={<Button size="sm" onClick={() => setView('form')}><Sparkles size={14} /> Form a team</Button>}
          />
        )}

        {projects.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-fg-muted">
                <tr className="border-b border-subtle">
                  <th className="px-2 py-2">Team / project</th>
                  <th className="px-2 py-2">Members</th>
                  <th className="px-2 py-2">Due</th>
                  <th className="px-2 py-2">Live URL</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-b border-subtle transition hover:bg-surface-1">
                    <td className="px-2 py-2.5">
                      <p className="text-fg">{p.title}</p>
                      <p className="text-[11px] text-fg-muted">{p.teamName}</p>
                    </td>
                    <td className="px-2 py-2.5 text-fg-secondary">{p.summary.memberCount}</td>
                    <td className="px-2 py-2.5 text-fg-secondary">{fmtDate(p.dueAt)}</td>
                    <td className="px-2 py-2.5">
                      {p.submission?.liveUrl
                        ? <span className="flex items-center gap-1 text-xs text-cyan-300"><Globe size={12} /> submitted</span>
                        : <span className="text-xs text-fg-muted">not yet</span>}
                    </td>
                    <td className="px-2 py-2.5">
                      <Badge tone={STATUS_TONE[p.summary.status] || 'default'}>{STATUS_LABEL[p.summary.status] || p.summary.status}</Badge>
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <Button size="sm" variant="soft" onClick={() => { setOpenId(p.id); setView('detail'); }}>Open</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
