/* ============================================================
   TeamMemberProgress — the coordinator view the review asked for.
   ------------------------------------------------------------
   Drop into components/college/ and render inside the existing
   team project drilldown in TeamProjectsPanel.jsx:

     import TeamMemberProgress from './TeamMemberProgress.jsx';
     ...
     <TeamMemberProgress projectId={selectedProject.id} />

   Design notes worth keeping:
     • A self-reported percentage is rendered differently from an
       evidenced one. A placement cell that cannot tell the
       difference is being given a number it should not trust.
     • "Could not check" is its own state, never zero. A GitHub
       rate limit must never look like a student did nothing.
     • Unmatched GitHub logins are surfaced with a link action,
       because an unmatched contributor is the most common reason
       a real contributor shows as inactive.

   Classes use the theme tokens from the light-mode work
   (bg-elevated / text-fg / border-subtle). If you have not applied
   that yet, they degrade to unstyled — swap for the existing
   bg-base/text-fg equivalents.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { CollegeTeamProgress, EVIDENCE_LABEL, progressTone } from '../../lib/teamProgress.js';

const TONE_BAR = {
  good: 'bg-emerald-400',
  caution: 'bg-amber-400',
  low: 'bg-red-400',
  muted: 'bg-surface-2',
};

function Bar({ percent, tone }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${TONE_BAR[tone] || TONE_BAR.muted}`}
        style={{ width: `${Math.max(2, percent)}%` }}
      />
    </div>
  );
}

function MemberRow({ m, commitDataAvailable }) {
  const [open, setOpen] = useState(false);
  const tone = progressTone(m);

  return (
    <div className="rounded-xl border border-subtle bg-elevated p-3.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="truncate text-[14px] font-semibold text-fg">{m.name}</p>
            <span className="shrink-0 text-[11px] text-fg-muted">{m.role}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-fg-muted">
            {m.modules.done}/{m.modules.total} modules
            {m.modules.withEvidence > 0 && ` · ${m.modules.withEvidence} with evidence`}
            {commitDataAvailable && !m.commits.unavailable && ` · ${m.commits.count} commits`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[18px] font-semibold leading-none text-fg">{m.percent}%</p>
          {m.evidenceQuality === 'self_reported' && (
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-amber-400">
              unverified
            </p>
          )}
        </div>
      </button>

      <div className="mt-3"><Bar percent={m.percent} tone={tone} /></div>

      {/* The basis line is the honesty guarantee: the coordinator always knows
          what the number rests on before acting on it. */}
      <p className="mt-2 text-[11px] text-fg-muted">{m.basis}</p>

      {open && (
        <div className="mt-3 space-y-1.5 border-t border-subtle pt-3">
          <p className="text-[11px] font-medium text-fg-secondary">
            {EVIDENCE_LABEL[m.evidenceQuality]}
          </p>
          {m.lastActiveAt && (
            <p className="text-[11px] text-fg-muted">
              Last activity {String(m.lastActiveAt).slice(0, 10)}
            </p>
          )}
          {m.commits.unavailable && (
            <p className="text-[11px] text-fg-muted">
              Commit history could not be read for this member — this is not a sign of inactivity.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function TeamMemberProgress({ projectId }) {
  const [state, setState] = useState({ status: 'loading', data: null, err: '' });
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');

  const load = useCallback(async () => {
    if (!projectId) return;
    setState({ status: 'loading', data: null, err: '' });
    try {
      const d = await CollegeTeamProgress.get(projectId);
      setState({ status: 'done', data: d, err: '' });
    } catch (e) {
      setState({ status: 'error', data: null, err: e.message || 'Could not load progress.' });
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true); setSyncNote('');
    try {
      const d = await CollegeTeamProgress.syncCommits(projectId);
      setState((s) => ({ ...s, status: 'done', data: { ...(s.data || {}), progress: d.progress } }));
      setSyncNote(
        d.unavailable
          ? d.note || 'Commit history could not be read. Nothing was marked as inactive.'
          : `${d.matched} member${d.matched === 1 ? '' : 's'} matched.${
            d.unmatchedLogins?.length ? ` Unmatched GitHub logins: ${d.unmatchedLogins.join(', ')}.` : ''
          }`,
      );
    } catch (e) {
      setSyncNote(e.message || 'Sync failed. The project was not changed.');
    } finally {
      setSyncing(false);
    }
  };

  if (state.status === 'loading') {
    return <p className="py-6 text-center text-[13px] text-fg-muted">Loading individual progress…</p>;
  }
  if (state.status === 'error') {
    return (
      <div className="rounded-xl border border-red-400/25 bg-red-500/[0.07] p-4">
        <p className="text-[13px] text-fg">{state.err}</p>
        <button type="button" onClick={load} className="mt-2 text-[12px] underline">Retry</button>
      </div>
    );
  }

  const p = state.data?.progress;
  if (!p?.members?.length) {
    return <p className="py-6 text-center text-[13px] text-fg-muted">No members on this project yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-fg-muted">
            Individual progress
          </p>
          <p className="mt-1 text-[13px] text-fg-secondary">
            Team average <span className="font-semibold text-fg">{p.teamPercent}%</span>
            {p.spread > 0 && ` · ${p.spread} point spread`}
            {' · '}{p.modulesDone}/{p.modulesTotal} modules done
          </p>
        </div>
        <button
          type="button"
          onClick={sync}
          disabled={syncing || !state.data?.repoUrl}
          className="rounded-lg border border-subtle px-3 py-1.5 text-[12px] font-medium transition hover:bg-surface-hover disabled:opacity-40"
          title={state.data?.repoUrl ? 'Read commit attribution from the team repository' : 'No repository submitted yet'}
        >
          {syncing ? 'Reading…' : 'Sync commits'}
        </button>
      </div>

      {syncNote && <p className="text-[12px] text-fg-muted">{syncNote}</p>}

      {!p.commitDataAvailable && (
        <p className="rounded-lg border border-subtle bg-surface-1 px-3 py-2 text-[12px] text-fg-muted">
          Percentages are based on module completion only — no commit history has been read yet.
        </p>
      )}

      <div className="space-y-2">
        {p.members.map((m) => (
          <MemberRow key={m.studentId} m={m} commitDataAvailable={p.commitDataAvailable} />
        ))}
      </div>

      {/* The flags are the reason this feature exists. Surface them last so a
          coordinator reads the data before the interpretation. */}
      {p.flags.length > 0 && (
        <div className="rounded-xl border border-subtle bg-surface-1 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-fg-muted">
            Worth a conversation
          </p>
          <ul className="mt-2 space-y-1.5">
            {p.flags.map((f, i) => (
              <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-fg-secondary">
                <span className={f.level === 'warn' ? 'text-amber-400' : 'text-fg-muted'}>•</span>
                <span>{f.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
