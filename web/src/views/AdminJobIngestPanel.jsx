/* ============================================================
   ADMIN — JOB INGESTION PANEL
   ------------------------------------------------------------
   The operator surface for the manual fetch path: paste targets,
   fetch, and see exactly what landed in the store.

   Two deliberate choices about honesty:

   1. The per-target result is shown in full, including the boring
      failures. A fetch that resolved nothing because the source is
      still under access REVIEW is not an error to hide — it is the
      single most useful thing the operator can be told, because it
      names the next action.

   2. "Stored" is verified against the STORE, not against the run
      receipt. The receipt says what we think happened; the browse
      list below says what is actually there. If those ever
      disagree, the operator should see it.

   Nothing here is an access boundary. Every call behind it is
   requireAuth + requireAdmin server-side.
   ============================================================ */

import { useState, useCallback, useEffect } from 'react';
import {
  Play, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Database, Clock, Eye,
} from 'lucide-react';
import { SectionCard } from './common.jsx';
import { Button, Badge, EmptyState, Input, Field, Spinner } from '../components/ui/kit.jsx';
import { AdminJobDiscovery } from '../lib/api.js';

const STAGE_TONE = {
  CRAWLED: 'mint',
  QUEUED: 'cyan',
  DRY_RUN: 'cyan',
  ACCESS: 'amber',
  NOT_CONFIGURED: 'amber',
  BUDGET: 'amber',
  CLASSIFY: 'rose',
  REGISTER: 'rose',
  DISCOVER: 'rose',
  RESOLVE: 'rose',
  CRAWL_FAILED: 'rose',
};

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-subtle bg-sunken px-3 py-2">
      <div className="text-lg font-semibold tabular-nums text-fg">{value}</div>
      <div className="text-xs text-fg-muted">{label}</div>
      {hint ? <div className="mt-0.5 text-[10px] text-fg-muted">{hint}</div> : null}
    </div>
  );
}

export default function AdminJobIngestPanel() {
  const [targets, setTargets] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState('INLINE');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [runs, setRuns] = useState([]);
  const [stored, setStored] = useState(null);

  const targetList = targets.split(/[\n,]/).map((t) => t.trim()).filter(Boolean);

  const loadRuns = useCallback(async () => {
    try {
      const r = await AdminJobDiscovery.runs({ limit: 10 });
      setRuns(r.runs || []);
    } catch { /* the panel still works without history */ }
  }, []);

  const loadStored = useCallback(async () => {
    try {
      setStored(await AdminJobDiscovery.jobs({ limit: 20 }));
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadRuns(); loadStored(); }, [loadRuns, loadStored]);

  const submit = useCallback(async (dryRun) => {
    if (!targetList.length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await AdminJobDiscovery.fetch(targetList, { mode, dryRun, reason: reason || undefined });
      setResult(r);
      if (!dryRun) {
        /* Verify against the store rather than trusting the receipt. */
        await Promise.all([loadRuns(), loadStored()]);
      }
    } catch (e) {
      setError(e?.message || 'fetch failed');
    } finally {
      setBusy(false);
    }
  }, [targetList, mode, reason, loadRuns, loadStored]);

  const totals = result?.run?.totals;

  return (
    <div className="space-y-4">
      <SectionCard eyebrow="Job Discovery OS" title="Fetch jobs now">
        <p className="mb-3 text-xs text-fg-muted">
          Paste board URLs, careers pages, company domains or source ids — one per line. Fetched jobs go into
          the same canonical store the workers write to, and are searchable immediately.
        </p>
        <div className="space-y-3">
          <Field label={`Targets${targetList.length ? ` (${targetList.length})` : ''}`}>
            <textarea
              value={targets}
              onChange={(e) => setTargets(e.target.value)}
              rows={6}
              spellCheck={false}
              placeholder={'https://boards.greenhouse.io/acme\nhttps://jobs.lever.co/harborstack\nacme.com'}
              className="w-full rounded-lg border border-subtle bg-sunken px-3 py-2 font-mono text-xs text-fg"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Note (kept on the receipt)">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="seeding for placement season" />
            </Field>
            <Field label="Mode">
              <div className="flex gap-2">
                <Button size="sm" variant={mode === 'INLINE' ? 'primary' : 'soft'} onClick={() => setMode('INLINE')}>
                  Fetch now
                </Button>
                <Button size="sm" variant={mode === 'QUEUE' ? 'primary' : 'soft'} onClick={() => setMode('QUEUE')}>
                  Queue for workers
                </Button>
              </div>
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => submit(false)} disabled={busy || !targetList.length}>
              <Play size={14} />
              {busy ? 'Working…' : `Fetch ${targetList.length || ''}`.trim()}
            </Button>
            <Button variant="soft" onClick={() => submit(true)} disabled={busy || !targetList.length}>
              <Eye size={14} />
              Dry run
            </Button>
            {busy ? <Spinner /> : null}
          </div>

          <p className="text-[11px] text-fg-muted">
            An admin trigger changes when work happens, not what is permitted. Robots policy, source access
            policy, provider credentials and the source-health guard all still apply — a fetch of a broken
            board can never close jobs it failed to see.
          </p>
        </div>
      </SectionCard>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">
          <AlertTriangle size={16} /> {error}
        </div>
      ) : null}

      {result ? (
        <SectionCard title={result.run.dryRun ? 'Dry run result' : 'Fetch result'}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <Stat label="targets ok" value={`${totals.succeeded}/${totals.targets}`} />
            <Stat label="jobs created" value={totals.jobsCreated} />
            <Stat label="jobs merged" value={totals.jobsMerged} hint="updated, not duplicated" />
            <Stat label="sources registered" value={totals.sourcesRegistered} />
          </div>

          {totals.incredibleRuns ? (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-warn">
              <AlertTriangle size={14} className="mr-1 inline" />
              {totals.incredibleRuns} source{totals.incredibleRuns === 1 ? '' : 's'} returned output that failed
              credibility checks. Existing jobs were retained and the source was marked DEGRADED — nothing was closed.
            </div>
          ) : null}

          {result.truncated ? (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-warn">
              {result.truncatedReason}
            </div>
          ) : null}

          <div className="space-y-1">
            {result.results.map((r) => (
              <div key={r.input} className="flex items-start gap-2 border-b border-subtle py-1.5 text-xs">
                {r.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />
                  : <XCircle size={14} className="mt-0.5 shrink-0 text-danger" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-fg">{r.input}</div>
                  <div className="text-fg-muted">{r.reason}</div>
                </div>
                <Badge tone={STAGE_TONE[r.stage]}>{r.stage}</Badge>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        title="In the store"
        action={<Button variant="ghost" size="sm" onClick={loadStored}><RefreshCw size={13} />Refresh</Button>}
      >
        <p className="mb-3 text-xs text-fg-muted">
          Read straight from the canonical store — this is what is actually there, not what the receipt claims.
        </p>
        {!stored ? <Spinner /> : stored.total === 0 ? (
          <EmptyState icon={Database} title="No jobs stored yet" hint="Fetch a board above to populate the index." />
        ) : (
          <>
            <div className="mb-2 text-xs text-fg-muted">{stored.total.toLocaleString()} canonical jobs</div>
            <div className="space-y-1">
              {stored.jobs.map((j) => (
                <div key={j.id} className="flex items-center gap-2 border-b border-subtle py-1.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-fg">{j.title}</div>
                    <div className="truncate text-fg-muted">
                      {j.company || 'unknown company'}
                      {j.locations?.length ? ` · ${j.locations.join(', ')}` : ''}
                    </div>
                  </div>
                  {j.directApply ? <Badge tone="mint">direct</Badge> : null}
                  <Badge>{j.status}</Badge>
                </div>
              ))}
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard
        title="Recent fetches"
        action={<Button variant="ghost" size="sm" onClick={loadRuns}><RefreshCw size={13} />Refresh</Button>}
      >
        <p className="mb-3 text-xs text-fg-muted">
          Receipts persist, so what a fetch did is answerable long after the tab is closed.
        </p>
        {!runs.length ? (
          <EmptyState icon={Clock} title="No manual fetches recorded" hint="Dry runs are deliberately not recorded." />
        ) : (
          <div className="space-y-1">
            {runs.map((r) => (
              <div key={r.id} className="flex items-center gap-2 border-b border-subtle py-1.5 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-fg">
                    {new Date(r.startedAt).toLocaleString()} · {r.triggeredBy || 'unknown'}
                  </div>
                  <div className="truncate text-fg-muted">
                    {r.totals.targets} targets · {r.totals.jobsCreated} new · {r.totals.jobsMerged} merged
                    {r.reason ? ` · ${r.reason}` : ''}
                  </div>
                </div>
                <Badge tone={r.mode === 'QUEUE' ? 'cyan' : 'default'}>{r.mode}</Badge>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
