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
  const [companyFilters, setCompanyFilters] = useState({
    companyType: '', industry: '', region: '', indiaRelevance: '', provider: '', hasSource: '', hasAvailableJobs: '',
  });
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [companyJobs, setCompanyJobs] = useState(null);
  const [companyJobsPage, setCompanyJobsPage] = useState(1);
  const [companyJobsQuery, setCompanyJobsQuery] = useState('');
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedResult, setSeedResult] = useState(null);
  const [queueBusy, setQueueBusy] = useState(null);
  const [queueResult, setQueueResult] = useState(null);
  const [companyFetchBusy, setCompanyFetchBusy] = useState(null);
  const [runtimeStats, setRuntimeStats] = useState(null);
  const [approvalBusy, setApprovalBusy] = useState(null);

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

  const loadCompanies = useCallback(async (page = companyPage, q = companyQuery, filters = companyFilters) => {
    try {
      const data = await AdminJobDiscovery.companies({ page, q, ...filters });
      setCompanies(data);
      setCompanyPage(data.page || page);
    } catch { /* non-fatal */ }
  }, [companyPage, companyQuery, companyFilters]);

  const loadCompanyJobs = useCallback(async (company, page = 1, q = companyJobsQuery) => {
    if (!company?.id) return;
    try {
      const data = await AdminJobDiscovery.companyJobs(company.id, { page, q });
      setSelectedCompany(data.company || company);
      setCompanyJobs(data);
      setCompanyJobsPage(data.page || page);
    } catch (e) {
      setError(e?.message || 'company job drill-down failed');
    }
  }, [companyJobsQuery]);

  const loadStats = useCallback(async () => {
    try {
      setRuntimeStats(await AdminJobDiscovery.stats());
    } catch { /* the rest of the operator dashboard can still function */ }
  }, []);

  useEffect(() => { loadRuns(); loadStored(1, ''); loadCompanies(1, ''); loadStats(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        await Promise.all([loadRuns(), loadStored(1, storedQuery), loadCompanies(companyPage, companyQuery), loadStats()]);
      }
    } catch (e) {
      setError(e?.message || 'fetch failed');
    } finally {
      setBusy(false);
    }
  }, [targetList, mode, reason, loadRuns, loadStored, loadCompanies, storedQuery, companyPage, companyQuery, loadStats]);

  const approveAndRetry = useCallback(async (row) => {
    if (!row?.sourceId) return;
    setApprovalBusy(row.sourceId);
    setError(null);
    try {
      await AdminJobDiscovery.setSourceAccess(row.sourceId, {
        policy: 'ALLOW',
        reason: reason || `Manual admin approval for ${row.input || row.sourceId}`,
      });
      const retry = await AdminJobDiscovery.fetch([row.sourceId], {
        mode: 'INLINE',
        reason: reason || `Approved REVIEW source and retried ${row.input || row.sourceId}`,
      });
      setResult(retry);
      await Promise.all([loadRuns(), loadStored(1, storedQuery), loadCompanies(companyPage, companyQuery), loadStats()]);
    } catch (e) {
      setError(e?.message || 'source approval/retry failed');
    } finally {
      setApprovalBusy(null);
    }
  }, [reason, loadRuns, loadStored, loadCompanies, storedQuery, companyPage, companyQuery, loadStats]);

  const seedCompanies = useCallback(async () => {
    setSeedBusy(true);
    setError(null);
    try {
      const r = await AdminJobDiscovery.seedCompanies({ minimum: 1000, includeRemote: true });
      setSeedResult(r);
      setCompanyPage(1);
      await Promise.all([loadCompanies(1, companyQuery), loadStats()]);
    } catch (e) {
      setError(e?.message || 'company seed import failed');
    } finally {
      setSeedBusy(false);
    }
  }, [companyQuery, loadCompanies, loadStats]);

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
      await Promise.all([loadRuns(), loadStored(1, storedQuery), loadCompanies(companyPage, companyQuery), loadStats()]);
    } catch (e) {
      setError(e?.message || 'company fetch failed');
    } finally {
      setCompanyFetchBusy(null);
    }
  }, [loadRuns, loadStored, loadCompanies, storedQuery, companyPage, companyQuery, loadStats]);

  const processQueue = useCallback(async (phase) => {
    setQueueBusy(phase);
    setError(null);
    try {
      const r = await AdminJobDiscovery.processQueue({ phase });
      setQueueResult({ phase, ...r });
      await Promise.all([loadRuns(), loadStored(1, storedQuery), loadCompanies(companyPage, companyQuery), loadStats()]);
    } catch (e) {
      setError(e?.message || `${phase} queue processing failed`);
    } finally {
      setQueueBusy(null);
    }
  }, [loadRuns, loadStored, loadCompanies, storedQuery, companyPage, companyQuery, loadStats]);

  const applyCompanyFilter = useCallback((patch) => {
    const next = { ...companyFilters, ...patch };
    setCompanyFilters(next);
    setCompanyPage(1);
    loadCompanies(1, companyQuery, next);
  }, [companyFilters, companyQuery, loadCompanies]);

  const resetCompanyFilters = useCallback(() => {
    const next = { companyType: '', industry: '', region: '', indiaRelevance: '', provider: '', hasSource: '', hasAvailableJobs: '' };
    setCompanyFilters(next);
    setCompanyPage(1);
    loadCompanies(1, companyQuery, next);
  }, [companyQuery, loadCompanies]);

  const totals = result?.run?.totals;

  return (
    <div className="space-y-4">
      <SectionCard
        eyebrow="Live canonical inventory"
        title="Jobs currently available"
        action={<Button variant="ghost" size="sm" onClick={loadStats}><RefreshCw size={13} />Refresh count</Button>}
      >
        {!runtimeStats ? <Spinner /> : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Stat
                label="AVAILABLE NOW"
                value={(runtimeStats.inventory?.currentlyAvailable ?? 0).toLocaleString()}
                hint="NEW + ACTIVE + LIKELY_ACTIVE"
              />
              <Stat label="Canonical total" value={(runtimeStats.inventory?.canonicalTotal ?? 0).toLocaleString()} hint="Includes stale/closed history" />
              <Stat label="New" value={(runtimeStats.inventory?.new ?? 0).toLocaleString()} />
              <Stat label="Active" value={(runtimeStats.inventory?.active ?? 0).toLocaleString()} />
              <Stat label="Likely active" value={(runtimeStats.inventory?.likelyActive ?? 0).toLocaleString()} />
              <Stat label="Stale / removed" value={((runtimeStats.inventory?.stale ?? 0) + (runtimeStats.inventory?.removed ?? 0)).toLocaleString()} />
            </div>
            <p className="mt-2 text-[11px] text-fg-muted">
              This is an exact database count at {runtimeStats.inventory?.countedAt ? new Date(runtimeStats.inventory.countedAt).toLocaleString() : 'the last refresh'}, not the number of rows on the current 20-job page.
            </p>
          </>
        )}
      </SectionCard>

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
            REVIEW sources can be explicitly approved by an administrator and retried from the result row.
            An explicit robots DENY is never overridden; provider credentials and the source-health guard still
            apply, and a broken fetch can never close jobs it failed to see.
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
                {r.stage === 'ACCESS' && r.sourceId && /REVIEW/i.test(r.reason || '') ? (
                  <Button
                    variant="soft"
                    size="sm"
                    disabled={approvalBusy === r.sourceId}
                    onClick={() => approveAndRetry(r)}
                    title="Approve only this REVIEW source, then retry. An explicit robots DENY is never overridden."
                  >
                    {approvalBusy === r.sourceId ? 'Approving…' : 'Approve & retry'}
                  </Button>
                ) : null}
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
          Company-centric administration: search and filter persisted direct employers, then open one company to inspect only its currently available canonical jobs. Results stay server-paginated 20 at a time for both companies and company jobs.
        </p>
        {seedResult ? (
          <div className="mb-3 rounded-lg border border-subtle bg-sunken px-3 py-2 text-xs text-fg-secondary">
            Seed target: {seedResult.target?.toLocaleString?.() || 1000} · stored: {seedResult.summary?.seeded?.toLocaleString?.() || 0}
            {seedResult.reached ? ' · target reached' : ' · target not yet reached'}
            {seedResult.external?.error ? ` · external import: ${seedResult.external.error}` : ''}
          </div>
        ) : null}
        <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Companies stored" value={(runtimeStats?.companySeeds?.total ?? companies?.total ?? 0).toLocaleString()} />
          <Stat label="Startup / scale-up" value={(runtimeStats?.companySeeds?.byCompanyType?.STARTUP_SCALEUP ?? 0).toLocaleString()} />
          <Stat label="MNC / enterprise" value={(runtimeStats?.companySeeds?.byCompanyType?.MNC_ENTERPRISE ?? 0).toLocaleString()} />
          <Stat label="Unclassified" value={(runtimeStats?.companySeeds?.byCompanyType?.UNKNOWN ?? 0).toLocaleString()} hint="Not guessed without reliable evidence" />
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" variant={!companyFilters.companyType && !companyFilters.indiaRelevance && !companyFilters.hasAvailableJobs ? 'primary' : 'soft'} onClick={() => applyCompanyFilter({ companyType: '', indiaRelevance: '', hasAvailableJobs: '' })}>All companies</Button>
          <Button size="sm" variant={companyFilters.companyType === 'STARTUP_SCALEUP' ? 'primary' : 'soft'} onClick={() => applyCompanyFilter({ companyType: 'STARTUP_SCALEUP' })}>Startup & scale-up</Button>
          <Button size="sm" variant={companyFilters.companyType === 'MNC_ENTERPRISE' ? 'primary' : 'soft'} onClick={() => applyCompanyFilter({ companyType: 'MNC_ENTERPRISE' })}>MNC & enterprise</Button>
          <Button size="sm" variant={companyFilters.indiaRelevance === 'High' ? 'primary' : 'soft'} onClick={() => applyCompanyFilter({ indiaRelevance: 'High' })}>India relevant</Button>
          <Button size="sm" variant={companyFilters.hasAvailableJobs === 'true' ? 'primary' : 'soft'} onClick={() => applyCompanyFilter({ hasAvailableJobs: 'true' })}>Has available jobs</Button>
        </div>
        <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); setCompanyPage(1); loadCompanies(1, companyQuery, companyFilters); }}>
          <div className="relative flex-1">
            <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
            <Input value={companyQuery} onChange={(e) => setCompanyQuery(e.target.value)} placeholder="Search company, domain, industry or career URL" className="pl-9" />
          </div>
          <Button size="sm" type="submit">Search</Button>
        </form>
        <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          <select value={companyFilters.companyType} onChange={(e) => setCompanyFilters((f) => ({ ...f, companyType: e.target.value }))} className="h-9 rounded-lg border border-field-border bg-field px-3 text-xs text-fg outline-none">
            <option value="">Company type: all</option><option value="STARTUP_SCALEUP">Startup / scale-up</option><option value="MNC_ENTERPRISE">MNC / enterprise</option><option value="OTHER">Other</option><option value="UNKNOWN">Unclassified</option>
          </select>
          <select value={companyFilters.indiaRelevance} onChange={(e) => setCompanyFilters((f) => ({ ...f, indiaRelevance: e.target.value }))} className="h-9 rounded-lg border border-field-border bg-field px-3 text-xs text-fg outline-none">
            <option value="">India relevance: all</option><option value="High">High</option>
          </select>
          <select value={companyFilters.provider} onChange={(e) => setCompanyFilters((f) => ({ ...f, provider: e.target.value }))} className="h-9 rounded-lg border border-field-border bg-field px-3 text-xs text-fg outline-none">
            <option value="">ATS/provider: all</option>{['GREENHOUSE','LEVER','ASHBY','WORKDAY','SMARTRECRUITERS','WORKABLE','ICIMS','SUCCESSFACTORS','TALEO','TEAMTAILOR','RECRUITEE','PERSONIO','GENERIC'].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={companyFilters.hasSource} onChange={(e) => setCompanyFilters((f) => ({ ...f, hasSource: e.target.value }))} className="h-9 rounded-lg border border-field-border bg-field px-3 text-xs text-fg outline-none">
            <option value="">Discovery state: all</option><option value="true">Source resolved</option><option value="false">Needs discovery</option>
          </select>
          <select value={companyFilters.hasAvailableJobs} onChange={(e) => setCompanyFilters((f) => ({ ...f, hasAvailableJobs: e.target.value }))} className="h-9 rounded-lg border border-field-border bg-field px-3 text-xs text-fg outline-none">
            <option value="">Available jobs: all</option><option value="true">Has available jobs</option><option value="false">No available jobs</option>
          </select>
          <Input value={companyFilters.industry} onChange={(e) => setCompanyFilters((f) => ({ ...f, industry: e.target.value }))} placeholder="Industry contains…" />
          <Input value={companyFilters.region} onChange={(e) => setCompanyFilters((f) => ({ ...f, region: e.target.value }))} placeholder="Region contains…" />
          <div className="flex gap-2"><Button size="sm" onClick={() => { setCompanyPage(1); loadCompanies(1, companyQuery, companyFilters); }}>Apply filters</Button><Button variant="ghost" size="sm" onClick={resetCompanyFilters}>Clear</Button></div>
        </div>
        <p className="mb-3 text-[11px] text-fg-muted">Startup/MNC grouping is only asserted for Career Autopilot-curated employers. External seed rows stay Unclassified unless a reliable company-type source is available; the dashboard does not guess funding stage or employee count.</p>
        {!companies ? <Spinner /> : companies.total === 0 ? (
          <EmptyState icon={Building2} title="No companies match" hint="If the registry is empty, use Seed / refresh 1,000. Otherwise clear one or more filters." />
        ) : (
          <>
            <div className="mb-2 text-xs text-fg-muted">{companies.total.toLocaleString()} companies · page {companies.page} of {companies.totalPages || 1} · 20 per page</div>
            <div className="space-y-1">
              {companies.companies.map((c) => (
                <div key={c.id} className="flex items-center gap-2 border-b border-subtle py-2 text-xs">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => loadCompanyJobs(c, 1, '')}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-fg">{c.name}</span>
                      <Badge tone={c.companyType === 'STARTUP_SCALEUP' ? 'cyan' : c.companyType === 'MNC_ENTERPRISE' ? 'mint' : 'default'}>{c.companyType === 'STARTUP_SCALEUP' ? 'STARTUP / SCALE-UP' : c.companyType === 'MNC_ENTERPRISE' ? 'MNC / ENTERPRISE' : 'UNCLASSIFIED'}</Badge>
                      <Badge tone={c.availableJobCount > 0 ? 'mint' : 'default'}>{c.availableJobCount || 0} available jobs</Badge>
                    </div>
                    <div className="mt-0.5 truncate text-fg-muted">{c.domain || c.region || 'domain not known'}{c.industry ? ` · ${c.industry}` : ''}{c.region ? ` · ${c.region}` : ''}{c.atsProvider ? ` · ${c.atsProvider}` : ''}{c.indiaRelevance === 'High' ? ' · India relevant' : ''}</div>
                  </button>
                  <Button variant="soft" size="sm" onClick={() => loadCompanyJobs(c, 1, '')}><Eye size={13} /> View jobs</Button>
                  {c.careersUrl ? <><Button variant="soft" size="sm" disabled={companyFetchBusy === c.id} onClick={() => fetchCompany(c)}><Play size={13} /> {companyFetchBusy === c.id ? 'Fetching…' : 'Fetch'}</Button><a href={c.careersUrl} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm"><ExternalLink size={13} /> Careers</Button></a></> : null}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-subtle pt-3">
              <Button variant="soft" size="sm" disabled={!companies.hasPrev} onClick={() => { const p = Math.max(1, companies.page - 1); setCompanyPage(p); loadCompanies(p, companyQuery, companyFilters); }}><ChevronLeft size={14} /> Previous</Button>
              <span className="text-xs text-fg-muted">Page {companies.page} / {companies.totalPages || 1}</span>
              <Button variant="soft" size="sm" disabled={!companies.hasNext} onClick={() => { const p = companies.page + 1; setCompanyPage(p); loadCompanies(p, companyQuery, companyFilters); }}>Next <ChevronRight size={14} /></Button>
            </div>
          </>
        )}
        {selectedCompany ? (
          <div className="mt-5 rounded-xl border border-subtle bg-sunken p-4">
            <div className="mb-3 flex items-start justify-between gap-3"><div><div className="text-sm font-semibold text-fg">{selectedCompany.name}</div><div className="mt-0.5 text-xs text-fg-muted">{companyJobs?.availableJobs?.toLocaleString?.() || 0} currently available jobs{selectedCompany.industry ? ` · ${selectedCompany.industry}` : ''}{selectedCompany.region ? ` · ${selectedCompany.region}` : ''}</div></div><Button variant="ghost" size="sm" onClick={() => { setSelectedCompany(null); setCompanyJobs(null); }}>Close</Button></div>
            <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); setCompanyJobsPage(1); loadCompanyJobs(selectedCompany, 1, companyJobsQuery); }}><div className="relative flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" /><Input value={companyJobsQuery} onChange={(e) => setCompanyJobsQuery(e.target.value)} placeholder={`Search jobs at ${selectedCompany.name}`} className="pl-9" /></div><Button size="sm" type="submit">Search jobs</Button></form>
            {!companyJobs ? <Spinner /> : companyJobs.availableJobs === 0 ? (
              <EmptyState icon={Database} title="No currently available jobs" hint="The company stays in the registry even when its current canonical inventory is empty." />
            ) : (
              <><div className="space-y-1">{companyJobs.jobs.map((j) => (<div key={j.id} className="flex items-center gap-2 border-b border-subtle py-2 text-xs"><div className="min-w-0 flex-1"><div className="truncate font-medium text-fg">{j.title}</div><div className="truncate text-fg-muted">{j.locations?.length ? j.locations.join(', ') : 'Location not stated'}{j.providers?.length ? ` · ${j.providers.join(', ')}` : ''}</div></div>{j.directApply ? <Badge tone="mint">direct</Badge> : null}<Badge>{j.status}</Badge>{j.applyUrl ? <a href={j.applyUrl} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm"><ExternalLink size={13} /> Apply</Button></a> : null}</div>))}</div><div className="mt-3 flex items-center justify-between border-t border-subtle pt-3"><Button variant="soft" size="sm" disabled={!companyJobs.hasPrev} onClick={() => { const p = Math.max(1, companyJobsPage - 1); setCompanyJobsPage(p); loadCompanyJobs(selectedCompany, p, companyJobsQuery); }}><ChevronLeft size={14} /> Previous</Button><span className="text-xs text-fg-muted">Page {companyJobs.page} / {companyJobs.totalPages || 1}</span><Button variant="soft" size="sm" disabled={!companyJobs.hasNext} onClick={() => { const p = companyJobsPage + 1; setCompanyJobsPage(p); loadCompanyJobs(selectedCompany, p, companyJobsQuery); }}>Next <ChevronRight size={14} /></Button></div></>
            )}
          </div>
        ) : null}
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
