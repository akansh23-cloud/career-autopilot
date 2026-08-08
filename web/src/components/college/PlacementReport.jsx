/* ============================================================
   Placement report
   ------------------------------------------------------------
   The three numbers a placement cell is judged on — placement
   percentage, median package, highest package — plus the splits a
   director and an accreditation return actually ask for.

   Two deliberate honesty rules are visible in this UI:
     1. "Placed" means the student ACCEPTED an offer. Outstanding
        offers are shown separately and never folded into the rate.
     2. Package statistics state their coverage. If nine of twelve
        placements have a recorded CTC, the median says so rather
        than implying it covers everyone.
   ============================================================ */
import { useEffect, useState } from 'react';
import {
  IndianRupee, Users, TrendingUp, Building2, AlertTriangle, Target,
  ArrowUpRight, ArrowDownRight, Minus, RefreshCw,
} from 'lucide-react';
import { SectionCard, StatCard } from '../../views/common.jsx';
import { Button, Badge, Spinner, EmptyState } from '../ui/kit.jsx';
import { College } from '../../lib/api.js';

const lpa = (n) => (Number(n) > 0 ? `₹${Number(n).toFixed(2)}L` : '—');

/** Signed delta chip. Zero renders as a dash, never as a fake "+0". */
function Delta({ value, suffix = '' }) {
  const v = Number(value);
  if (!Number.isFinite(v) || v === 0) return <span className="text-fg-muted">—</span>;
  const up = v > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-aurora-mint' : 'text-amber-glow'}`}>
      <Icon size={12} />{up ? '+' : ''}{v}{suffix}
    </span>
  );
}

function RateBar({ value }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-1">
        <div className="h-full rounded-full bg-gradient-to-r from-aurora-indigo/60 to-aurora-mint" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      <span className="w-9 text-right text-sm text-fg-secondary">{value}%</span>
    </div>
  );
}

export default function PlacementReport({ go }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { setData(await College.placement()); }
    catch (e) { setError(e?.message || 'Could not load placement data.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-muted"><Spinner /> Building placement report…</div>;
  if (error) {
    return <EmptyState icon={AlertTriangle} title="Couldn’t load the placement report" hint={error}
      action={<Button size="sm" variant="soft" onClick={load}>Retry</Button>} />;
  }

  const s = data?.summary || {};
  const noData = !s.offers && !s.placed;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard i={0} icon={Users} tone="violet" label="Placement rate" value={`${s.placementRate ?? 0}%`}
          hint={`${s.placed ?? 0} placed of ${s.students ?? 0} students`} />
        <StatCard i={1} icon={IndianRupee} tone="mint" label="Median package" value={lpa(s.medianCtc)}
          hint={s.placed ? `avg ${lpa(s.avgCtc)} · lowest ${lpa(s.lowestCtc)}` : 'no placements recorded'} />
        <StatCard i={2} icon={TrendingUp} tone="cyan" label="Highest package" value={lpa(s.highestCtc)}
          hint={`${s.offers ?? 0} offer(s) · ${s.multiOffer ?? 0} student(s) with 2+`} />
        <StatCard i={3} icon={Building2} tone="amber" label="Recruiters" value={String(s.recruiters ?? 0)}
          hint={`${s.activeDrives ?? 0} of ${s.drives ?? 0} drives open`} />
      </div>

      {noData && (
        <EmptyState
          icon={Target} title="No outcomes recorded yet"
          hint="Placement figures appear once you record what happened to students in a drive. Open a drive, select students and mark them as applied, shortlisted, offered or accepted."
          action={<Button size="sm" onClick={() => go?.('drives')}>Go to drives</Button>}
        />
      )}

      {/* Data-quality banner. A median over partial data that doesn't say so is
          how a wrong number ends up in an accreditation return. */}
      {s.placed > 0 && s.ctcCoverage < 100 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-glow/25 bg-amber-glow/[0.06] px-3 py-2.5 text-sm text-amber-glow">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            Package figures cover <b>{s.ctcCoverage}%</b> of placements — {s.offersWithoutCtc} accepted offer(s) have no
            CTC recorded. Median, average and highest are computed only over placements with a package on file.
          </span>
        </div>
      )}

      {s.placedLowReadiness > 0 && (
        <div className="rounded-xl border border-subtle bg-surface-1 px-3 py-2.5 text-sm text-fg-secondary">
          <b className="text-fg">{s.placedLowReadiness}</b> placed student(s) scored under 50 on readiness. Worth a look —
          either the readiness model needs recalibrating for your cohort, or those students have proof of work they
          haven’t recorded in the platform.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Branch-wise placement" eyebrow="Ranked by placement rate">
          {(data?.byBranch || []).length === 0 ? (
            <EmptyState icon={Users} title="No branch data" hint="Appears once students have branch filled in on their profile." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
                  <tr>
                    <th className="px-2 py-2">Branch</th>
                    <th className="px-2 py-2 text-right">Students</th>
                    <th className="px-2 py-2 text-right">Placed</th>
                    <th className="px-2 py-2">Rate</th>
                    <th className="px-2 py-2 text-right">Median</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byBranch.map((r) => (
                    <tr key={r.key} className="border-t border-subtle">
                      <td className="px-2 py-2 text-fg">{r.key}</td>
                      <td className="px-2 py-2 text-right text-fg-secondary">{r.total}</td>
                      <td className="px-2 py-2 text-right text-fg-secondary">{r.placed}</td>
                      <td className="px-2 py-2"><RateBar value={r.placementRate} /></td>
                      <td className="px-2 py-2 text-right text-fg-secondary">{lpa(r.medianCtc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Recruiters" eyebrow="Ranked by hires, then package">
          {(data?.topRecruiters || []).length === 0 ? (
            <EmptyState icon={Building2} title="No recruiters yet" hint="Companies appear here once a student accepts an offer from one of your drives." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
                  <tr>
                    <th className="px-2 py-2">Company</th>
                    <th className="px-2 py-2 text-right">Hires</th>
                    <th className="px-2 py-2 text-right">Median</th>
                    <th className="px-2 py-2 text-right">Highest</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topRecruiters.map((r) => (
                    <tr key={r.company} className="border-t border-subtle">
                      <td className="px-2 py-2 text-fg">{r.company}</td>
                      <td className="px-2 py-2 text-right"><Badge tone="mint">{r.hires}</Badge></td>
                      <td className="px-2 py-2 text-right text-fg-secondary">{lpa(r.medianCtc)}</td>
                      <td className="px-2 py-2 text-right text-fg-secondary">{lpa(r.highestCtc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Batch comparison — "is this cohort ahead of last year's?" */}
      <SectionCard title="Batch comparison" eyebrow="Each batch against the one before it">
        {(data?.batchComparison || []).length === 0 ? (
          <EmptyState icon={TrendingUp} title="No batch data" hint="Appears once students have a graduation batch on their profile." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-2 py-2">Batch</th>
                  <th className="px-2 py-2 text-right">Students</th>
                  <th className="px-2 py-2 text-right">Avg readiness</th>
                  <th className="px-2 py-2 text-right">Verified</th>
                  <th className="px-2 py-2 text-right">Ready</th>
                  <th className="px-2 py-2 text-right">Placed</th>
                  <th className="px-2 py-2">vs previous</th>
                </tr>
              </thead>
              <tbody>
                {data.batchComparison.map((r) => (
                  <tr key={r.batch} className="border-t border-subtle">
                    <td className="px-2 py-2 text-fg">{r.batch}</td>
                    <td className="px-2 py-2 text-right text-fg-secondary">{r.students}</td>
                    <td className="px-2 py-2 text-right text-fg-secondary">{r.avgReadiness}</td>
                    <td className="px-2 py-2 text-right text-fg-secondary">{r.verifiedCoverage}%</td>
                    <td className="px-2 py-2 text-right text-fg-secondary">{r.placementReadyRate}%</td>
                    <td className="px-2 py-2 text-right text-fg-secondary">{r.placementRate}%</td>
                    <td className="px-2 py-2">
                      {r.vsPrevious ? (
                        <span className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                          <span>vs {r.vsPrevious.batch}:</span>
                          <span>readiness <Delta value={r.vsPrevious.avgReadiness} /></span>
                          <span>placed <Delta value={r.vsPrevious.placementRate} suffix="%" /></span>
                        </span>
                      ) : <span className="inline-flex items-center gap-1 text-xs text-fg-muted"><Minus size={11} /> oldest batch</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* The single most actionable list in the product. */}
      <SectionCard
        title="Ready but not placed"
        eyebrow="Readiness 70+ with no accepted offer — prepared and still available"
        action={<Button size="sm" variant="soft" onClick={load}><RefreshCw size={13} /> Refresh</Button>}
      >
        {(data?.readyUnplaced || []).length === 0 ? (
          <EmptyState icon={Target} title="Nobody is waiting"
            hint="Every student scoring 70+ on readiness has accepted an offer — or no readiness data exists yet." />
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">
              <b className="text-fg">{data.readyUnplaced.length}</b> student(s). Students showing
              <span className="text-amber-glow"> 0 applications</span> are the ones to contact first — the platform says
              they’re ready and they aren’t in any drive.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
                  <tr>
                    <th className="px-2 py-2">Student</th>
                    <th className="px-2 py-2">Branch</th>
                    <th className="px-2 py-2">Batch</th>
                    <th className="px-2 py-2 text-right">Readiness</th>
                    <th className="px-2 py-2 text-right">Applications</th>
                  </tr>
                </thead>
                <tbody>
                  {data.readyUnplaced.slice(0, 60).map((r) => (
                    <tr key={r.id} className="border-t border-subtle hover:bg-surface-1">
                      <td className="px-2 py-2 text-fg">{r.name || r.email}</td>
                      <td className="px-2 py-2 text-fg-secondary">{r.branch || '—'}</td>
                      <td className="px-2 py-2 text-fg-secondary">{r.batch || '—'}</td>
                      <td className="px-2 py-2 text-right"><Badge tone="mint">{r.readinessScore}</Badge></td>
                      <td className="px-2 py-2 text-right">
                        {r.applications > 0
                          ? <span className="text-fg-secondary">{r.applications}</span>
                          : <span className="text-amber-glow">0</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.readyUnplaced.length > 60 && (
              <p className="mt-3 text-xs text-fg-muted">Showing 60 of {data.readyUnplaced.length}. The full list is in the observability CSV export.</p>
            )}
          </>
        )}
      </SectionCard>
    </div>
  );
}
