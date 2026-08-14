import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BriefcaseBusiness, Database, DownloadCloud, Globe2,
  RefreshCw, Search, ServerCog, ShieldCheck, TimerReset,
} from 'lucide-react';
import { PageIntro, StatCard, SectionCard } from './common.jsx';
import { Badge, Button, EmptyState, Field, Input, Spinner } from '../components/ui/kit.jsx';
import { AdminJobDiscovery } from '../lib/api.js';
import { getPlan, PLAN_EVENT } from '../lib/plan.js';

function useIsAdmin() {
  const [admin, setAdmin] = useState(!!getPlan().isAdmin);
  useEffect(() => {
    const f = () => setAdmin(!!getPlan().isAdmin);
    window.addEventListener(PLAN_EVENT, f);
    return () => window.removeEventListener(PLAN_EVENT, f);
  }, []);
  return admin;
}

function fmtNum(v) { return Number(v || 0).toLocaleString(); }
function fmtTime(v) {
  if (!v) return '—';
  try { return new Date(v).toLocaleString(); } catch { return '—'; }
}

function toneForStatus(status) {
  if (status === 'ACTIVE') return 'mint';
  if (status === 'DEGRADED' || status === 'REVIEW') return 'amber';
  if (status === 'DISABLED' || status === 'NOT_CONFIGURED') return 'default';
  return 'cyan';
}

export default function AdminJobDiscoveryView() {
  const isAdmin = useIsAdmin();
  const [stats, setStats] = useState(null);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [sourceId, setSourceId] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [sourceLimit, setSourceLimit] = useState('1');
  const [maxPages, setMaxPages] = useState('1');
  const [runDiscovery, setRunDiscovery] = useState(false);
  const [runVerification, setRunVerification] = useState(false);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true); setError('');
    try {
      const [s, h] = await Promise.all([AdminJobDiscovery.stats(), AdminJobDiscovery.health()]);
      setStats(s);
      setSources(Array.isArray(h?.sources) ? h.sources : []);
    } catch (e) {
      setError(e?.status === 403 ? 'Admin access required.' : (e?.message || 'Could not load Job Discovery status.'));
    } finally { setLoading(false); }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  const activeSources = useMemo(
    () => sources.filter((s) => s.accessPolicy === 'ALLOW' && !['DISABLED', 'NOT_CONFIGURED'].includes(s.status)),
    [sources],
  );

  const runManual = async (mode) => {
    setBusy(mode); setError(''); setResult(null);
    try {
      const body = {
        sourceLimit: Number(sourceLimit) || 1,
        maxPagesPerSource: Number(maxPages) || 1,
        runDiscovery,
        runVerification,
      };
      if (mode === 'source') {
        if (!sourceId) throw new Error('Select a source first.');
        body.sourceId = sourceId;
      }
      if (mode === 'url') {
        if (!sourceUrl.trim()) throw new Error('Enter a public ATS/careers URL first.');
        body.sourceUrl = sourceUrl.trim();
        if (companyName.trim()) body.companyName = companyName.trim();
      }
      const r = await AdminJobDiscovery.manualFetch(body);
      setResult(r);
      await load();
    } catch (e) {
      setError(e?.message || 'Manual fetch failed.');
    } finally { setBusy(''); }
  };

  if (!isAdmin) {
    return <EmptyState icon={ShieldCheck} title="Admin access required" hint="Job ingestion controls are restricted to platform administrators." />;
  }

  const store = stats?.store || {};
  const crawlQueue = stats?.crawlQueue || {};
  const discoveryQueue = stats?.discoveryQueue || {};
  const healthy = sources.filter((s) => s.status === 'ACTIVE').length;

  return (
    <div>
      <PageIntro
        title="Job Discovery Control"
        sub="Monitor the canonical job index and fetch a small, safe batch manually when you need fresh jobs immediately."
        action={<Button variant="soft" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</Button>}
      />

      {error && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={15} className="mr-2 inline" />{error}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard i={0} icon={BriefcaseBusiness} tone="violet" label="Canonical jobs" value={loading ? '—' : fmtNum(store.jobs)} />
        <StatCard i={1} icon={Globe2} tone="cyan" label="Registered sources" value={loading ? '—' : fmtNum(store.sources)} />
        <StatCard i={2} icon={Activity} tone="mint" label="Active sources" value={loading ? '—' : fmtNum(healthy)} />
        <StatCard i={3} icon={Database} tone="amber" label="Store" value={loading ? '—' : (store.backend || 'unknown')} />
      </div>

      <SectionCard className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <DownloadCloud size={18} className="text-brand" />
              <h2 className="font-display text-base font-semibold text-fg">Manual job fetch</h2>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-fg-secondary">
              Runs the same source-policy, SSRF, normalization, dedupe and freshness pipeline as background ingestion. Limits are intentionally small to avoid serverless timeouts.
            </p>
          </div>
          <Badge tone="mint">Admin only</Badge>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <Field label="Sources in this fetch">
            <select value={sourceLimit} onChange={(e) => setSourceLimit(e.target.value)} className="h-11 w-full rounded-xl border border-field-border bg-field px-3 text-sm text-fg outline-none">
              <option value="1">1 source</option><option value="2">2 sources</option><option value="3">3 sources</option>
            </select>
          </Field>
          <Field label="Maximum pages per source">
            <select value={maxPages} onChange={(e) => setMaxPages(e.target.value)} className="h-11 w-full rounded-xl border border-field-border bg-field px-3 text-sm text-fg outline-none">
              <option value="1">1 page — safest</option><option value="2">2 pages</option><option value="3">3 pages</option>
            </select>
          </Field>
          <div className="flex flex-col justify-end gap-2 pb-1 text-sm text-fg-secondary">
            <label className="flex items-center gap-2"><input type="checkbox" checked={runDiscovery} onChange={(e) => setRunDiscovery(e.target.checked)} /> Discover direct sources after fetch</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={runVerification} onChange={(e) => setRunVerification(e.target.checked)} /> Verify a small due-job batch</label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => runManual('due')} disabled={!!busy}>
            {busy === 'due' ? <Spinner size="sm" /> : <DownloadCloud size={15} />} Fetch next due batch
          </Button>
        </div>

        <div className="mt-6 border-t border-subtle pt-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">Fetch a specific registered source</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="h-11 min-w-0 flex-1 rounded-xl border border-field-border bg-field px-3 text-sm text-fg outline-none">
              <option value="">Select a source…</option>
              {activeSources.map((s) => <option key={s.id} value={s.id}>{s.companyName || s.tenant || s.id} · {s.provider}</option>)}
            </select>
            <Button variant="soft" onClick={() => runManual('source')} disabled={!!busy || !sourceId}>
              {busy === 'source' ? <Spinner size="sm" /> : <ServerCog size={15} />} Fetch selected source
            </Button>
          </div>
        </div>

        <div className="mt-6 border-t border-subtle pt-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">Add a public board and fetch it</p>
          <div className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
            <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://boards.greenhouse.io/company or public careers URL" />
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name (optional)" />
            <Button variant="soft" onClick={() => runManual('url')} disabled={!!busy || !sourceUrl.trim()}>
              {busy === 'url' ? <Spinner size="sm" /> : <Search size={15} />} Register & fetch
            </Button>
          </div>
        </div>
      </SectionCard>

      {result && (
        <SectionCard className="mb-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-fg">Last manual fetch</h2>
              <p className="mt-1 text-sm text-fg-secondary">{result.ok ? 'Completed.' : 'Completed with warnings/errors.'} Duration {fmtNum(result.durationMs)} ms.</p>
            </div>
            <Badge tone={result.ok ? 'mint' : 'amber'}>{result.ok ? 'Completed' : 'Check result'}</Badge>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-subtle bg-surface-1 p-3"><p className="text-xs text-fg-muted">Jobs before</p><p className="mt-1 text-xl font-semibold text-fg">{fmtNum(result.before?.jobs)}</p></div>
            <div className="rounded-xl border border-subtle bg-surface-1 p-3"><p className="text-xs text-fg-muted">Jobs after</p><p className="mt-1 text-xl font-semibold text-fg">{fmtNum(result.after?.jobs)}</p></div>
            <div className="rounded-xl border border-subtle bg-surface-1 p-3"><p className="text-xs text-fg-muted">New canonical jobs</p><p className="mt-1 text-xl font-semibold text-fg">+{fmtNum(result.delta?.jobs)}</p></div>
            <div className="rounded-xl border border-subtle bg-surface-1 p-3"><p className="text-xs text-fg-muted">Sources added</p><p className="mt-1 text-xl font-semibold text-fg">+{fmtNum(result.delta?.sources)}</p></div>
          </div>
          <div className="mt-4 space-y-2">
            {(result.crawl?.crawled || []).map((r) => (
              <div key={`${r.sourceId}-${r.tenant || ''}`} className="rounded-xl border border-subtle bg-surface-1 px-3 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-fg">{r.companyName || r.tenant || r.sourceId} · {r.provider}</span>
                  <Badge tone={r.ok ? 'mint' : 'amber'}>{r.ok ? 'Fetched' : 'Issue'}</Badge>
                </div>
                <p className="mt-1 text-xs text-fg-secondary">Fetched {fmtNum(r.fetched)} · Created {fmtNum(r.created)} · Merged {fmtNum(r.merged)}{r.pagesFetched != null ? ` · Pages ${r.pagesFetched}` : ''}</p>
                {r.errors?.length > 0 && <p className="mt-1 text-xs text-red-600">{r.errors.map((e) => typeof e === 'string' ? e : `${e.errorClass || 'ERROR'}: ${e.message || ''}`).join(' · ')}</p>}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-semibold text-fg">Source health</h2>
            <p className="mt-1 text-sm text-fg-secondary">Manual fetch never overrides DENY/REVIEW access policy.</p>
          </div>
          <div className="flex gap-2 text-xs text-fg-muted"><TimerReset size={14} /> Queue {fmtNum(crawlQueue.total)} · Discovery {fmtNum(discoveryQueue.total)}</div>
        </div>
        {loading ? <div className="py-8 text-center"><Spinner /></div> : sources.length === 0 ? (
          <EmptyState icon={Globe2} title="No job sources registered yet" hint="Use Add a public board and fetch it above, or wait for autonomous source discovery." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="border-b border-subtle text-xs uppercase tracking-wide text-fg-muted"><tr><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">Provider</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Jobs</th><th className="py-2 pr-3">Last success</th><th className="py-2">Next crawl</th></tr></thead>
              <tbody>
                {sources.slice(0, 100).map((s) => (
                  <tr key={s.id} className="border-b border-subtle/70">
                    <td className="py-3 pr-3"><p className="font-medium text-fg">{s.companyName || s.tenant || s.id}</p><p className="max-w-[280px] truncate text-xs text-fg-muted">{s.careersUrl || s.id}</p></td>
                    <td className="py-3 pr-3 text-fg-secondary">{s.provider}</td>
                    <td className="py-3 pr-3"><Badge tone={toneForStatus(s.status)}>{s.status}</Badge>{s.accessPolicy !== 'ALLOW' && <span className="ml-1 text-[10px] text-fg-muted">{s.accessPolicy}</span>}</td>
                    <td className="py-3 pr-3 text-fg-secondary">{fmtNum(s.jobsLastSeen)}</td>
                    <td className="py-3 pr-3 text-xs text-fg-secondary">{fmtTime(s.lastSuccessAt)}</td>
                    <td className="py-3 text-xs text-fg-secondary">{fmtTime(s.nextCrawlAt)}</td>
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
