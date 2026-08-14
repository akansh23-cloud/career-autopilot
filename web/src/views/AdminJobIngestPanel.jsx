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
  Search, ChevronLeft, ChevronRight, Building2, ExternalLink, DownloadCloud,
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
  const [storedPage, setStoredPage] = useState(1);
  const [storedQuery, setStoredQuery] = useState('');
  const [companies, setCompanies] = useState(null);
  const [companyPage, setCompanyPage] = useState(1);
  const [companyQuery, setCompanyQuery] = useState('');
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedResult, setSeedResult] = useState(null);
  const [queueBusy, setQueueBusy] = useState(null);
  const [queueResult, setQueueResult] = useState(null);
  const [companyFetchBusy, setCompanyFetchBusy] = useState(null);

  const targetList = targets.split(/[\n,]/).map((t) => t.trim()).filter(Boolean);

  const loadRuns = useCallback(async () => {
    try {
      const r = await AdminJobDiscovery.runs({ limit: 10 });
      setRuns(r.runs || []);
    } catch { /* the panel still works without history */ }
  }, []);

  const loadStored = useCallback(async (page = storedPage, q = storedQuery) => {
    try {
      const data = await AdminJobDiscovery.jobs({ page, q });
      setStored(data);
      setStoredPage(data.page || page);
    } catch { /* non-fatal */ }
  }, [storedPage, storedQuery]);

  const loadCompanies = useCallback(async (page = companyPage, q = companyQuery) => {
    try {
      const data = await AdminJobDiscovery.companies({ page, q });
      setCompanies(data);
      setCompanyPage(data.page || page);
    } catch { /* non-fatal */ }
  }, [companyPage, companyQuery]);

  useEffect(() => { loadRuns(); loadStored(1, ''); loadCompanies(1, ''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useCallback(async (dryRun) => {
    if (!targetList.length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await AdminJobDiscovery.fetch(targetList, { mode, dryRun, reason: reason || undefined });
      setResult(r);
      if (!dryRun) {
        /* Verify against the store rather than trusting the receipt. */
        setStoredPage(1);
        await Promise.all([loadRuns(), loadStored(1, storedQuery), loadCompanies(companyPage, companyQuery)]);
      }
    } catch (e) {
      setError(e?.message || 'fetch failed');
    } finally {
      setBusy(false);
    }
  }, [targetList, mode, reason, loadRuns, loadStored, loadCompanies, storedQuery, companyPage, companyQuery]);

  const seedCompanies = useCallback(async () => {
    setSeedBusy(true);
    setError(null);
    try {
      const r = await AdminJobDiscovery.seedCompanies({ minimum: 1000, includeRemote: true });
      setSeedResult(r);
      setCompanyPage(1);
      await loadCompanies(1, companyQuery);
    } catch (e) {
      setError(e?.message || 'company seed import failed');
    } finally {
      setSeedBusy(false);
    }
  }, [companyQuery, loadCompanies]);

  const fetchCompany = useCallback(async (company) => {
    if (!company?.careersUrl) return;
    setCompanyFetchBusy(company.id);
    setError(null);
    try {
      const r = await AdminJobDiscovery.fetch([company.careersUrl], {
        mode: 'INLINE',
        reason: `Admin company-registry fetch: ${company.name || company.domain || company.id}`,
      });
      setResult(r);
      await Promise.all([loadRuns(), loadStored(1, storedQuery), loadCompanies(companyPage, companyQuery)]);
    } catch (e) {
      setError(e?.message || 'company fetch failed');
    } finally {
      setCompanyFetchBusy(null);
    }
  }, [loadRuns, loadStored, loadCompanies, storedQuery, companyPage, companyQuery]);

  const processQueue = useCallback(async (phase) => {
    setQueueBusy(phase);
    setError(null);
    try {
      const r = await AdminJobDiscovery.processQueue({ phase });
      setQueueResult({ phase, ...r });
      await Promise.all([loadRuns(), loadStored(1, storedQuery), loadCompanies(companyPage, companyQuery)]);
    } catch (e) {
      setError(e?.message || `${phase} queue processing failed`);
    } finally {
      setQueueBusy(null);
    }
  }, [loadRuns, loadStored, loadCompanies, storedQuery, companyPage, companyQuery]);

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

      <SectionCard title="Durable ingestion queues">
        <p className="mb-3 text-xs text-fg-muted">
          Stress tests are not capped by an artificial source/job count. A serverless request processes until its execution deadline, checkpoints progress, and leaves the remainder durable for the next run.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="soft" size="sm" disabled={!!queueBusy} onClick={() => processQueue('crawl')}>
            <Play size={13} /> {queueBusy === 'crawl' ? 'Processing crawl…' : 'Process crawl queue'}
          </Button>
          <Button variant="soft" size="sm" disabled={!!queueBusy} onClick={() => processQueue('discover')}>
            <Search size={13} /> {queueBusy === 'discover' ? 'Processing discovery…' : 'Process discovery queue'}
          </Button>
          <Button variant="soft" size="sm" disabled={!!queueBusy} onClick={() => processQueue('verify')}>
            <CheckCircle2 size={13} /> {queueBusy === 'verify' ? 'Verifying…' : 'Process verification queue'}
          </Button>
        </div>
        {queueResult ? (
          <div className="mt-3 rounded-lg border border-subtle bg-sunken px-3 py-2 text-xs text-fg-secondary">
            Last manual queue run: {queueResult.phase} · {queueResult.deadlineReached ? 'checkpointed at execution deadline; continuation remains queued' : 'completed available work'}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Canonical jobs"
        action={<Button variant="ghost" size="sm" onClick={() => loadStored(storedPage, storedQuery)}><RefreshCw size={13} />Refresh</Button>}
      >
        <p className="mb-3 text-xs text-fg-muted">
          Server-side search and fixed 20-job pages. The browser never loads the whole job collection just to scroll it.
        </p>
        <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); setStoredPage(1); loadStored(1, storedQuery); }}>
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
            <Input value={storedQuery} onChange={(e) => setStoredQuery(e.target.value)} placeholder="Search stored jobs by title, company or text" className="pl-9" />
          </div>
          <Button size="sm" type="submit">Search</Button>
        </form>
        {!stored ? <Spinner /> : stored.total === 0 ? (
          <EmptyState icon={Database} title="No jobs stored yet" hint="Fetch a board above to populate the index." />
        ) : (
          <>
            <div className="mb-2 text-xs text-fg-muted">
              {stored.total.toLocaleString()} canonical jobs · page {stored.page} of {stored.totalPages || 1} · 20 per page
            </div>
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
            <div className="mt-3 flex items-center justify-between border-t border-subtle pt-3">
              <Button variant="soft" size="sm" disabled={!stored.hasPrev} onClick={() => { const p = Math.max(1, stored.page - 1); setStoredPage(p); loadStored(p, storedQuery); }}>
                <ChevronLeft size={14} /> Previous
              </Button>
              <span className="text-xs text-fg-muted">Page {stored.page} / {stored.totalPages || 1}</span>
              <Button variant="soft" size="sm" disabled={!stored.hasNext} onClick={() => { const p = stored.page + 1; setStoredPage(p); loadStored(p, storedQuery); }}>
                Next <ChevronRight size={14} />
              </Button>
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard
        title="Company career-site registry"
        action={<Button variant="soft" size="sm" onClick={seedCompanies} disabled={seedBusy}><DownloadCloud size={13} />{seedBusy ? 'Seeding…' : 'Seed / refresh 1,000'}</Button>}
      >
        <p className="mb-3 text-xs text-fg-muted">
          Persistent direct-employer career knowledge. Search by company instead of scrolling a static list; results are paged 20 at a time.
        </p>
        {seedResult ? (
          <div className="mb-3 rounded-lg border border-subtle bg-sunken px-3 py-2 text-xs text-fg-secondary">
            Seed target: {seedResult.target?.toLocaleString?.() || 1000} · stored: {seedResult.summary?.seeded?.toLocaleString?.() || 0}
            {seedResult.reached ? ' · target reached' : ' · target not yet reached'}
            {seedResult.external?.error ? ` · external import: ${seedResult.external.error}` : ''}
          </div>
        ) : null}
        <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); setCompanyPage(1); loadCompanies(1, companyQuery); }}>
          <div className="relative flex-1">
            <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
            <Input value={companyQuery} onChange={(e) => setCompanyQuery(e.target.value)} placeholder="Search company, domain, industry or career URL" className="pl-9" />
          </div>
          <Button size="sm" type="submit">Search</Button>
        </form>
        {!companies ? <Spinner /> : companies.total === 0 ? (
          <EmptyState icon={Building2} title="No company career sites stored" hint="Use Seed / refresh 1,000 to bootstrap the registry." />
        ) : (
          <>
            <div className="mb-2 text-xs text-fg-muted">
              {companies.total.toLocaleString()} companies · page {companies.page} of {companies.totalPages || 1}
            </div>
            <div className="space-y-1">
              {companies.companies.map((c) => (
                <div key={c.id} className="flex items-center gap-2 border-b border-subtle py-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-fg">{c.name}</div>
                    <div className="truncate text-fg-muted">{c.domain || c.region || 'domain not known'}{c.atsProvider ? ` · ${c.atsProvider}` : ''}{c.careerUrlStatus ? ` · ${c.careerUrlStatus}` : ''}</div>
                  </div>
                  {c.careersUrl ? (
                    <>
                      <Button variant="soft" size="sm" disabled={companyFetchBusy === c.id} onClick={() => fetchCompany(c)}>
                        <Play size={13} /> {companyFetchBusy === c.id ? 'Fetching…' : 'Fetch'}
                      </Button>
                      <a href={c.careersUrl} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm"><ExternalLink size={13} /> Careers</Button></a>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-subtle pt-3">
              <Button variant="soft" size="sm" disabled={!companies.hasPrev} onClick={() => { const p = Math.max(1, companies.page - 1); setCompanyPage(p); loadCompanies(p, companyQuery); }}>
                <ChevronLeft size={14} /> Previous
              </Button>
              <span className="text-xs text-fg-muted">Page {companies.page} / {companies.totalPages || 1}</span>
              <Button variant="soft" size="sm" disabled={!companies.hasNext} onClick={() => { const p = companies.page + 1; setCompanyPage(p); loadCompanies(p, companyQuery); }}>
                Next <ChevronRight size={14} />
              </Button>
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
