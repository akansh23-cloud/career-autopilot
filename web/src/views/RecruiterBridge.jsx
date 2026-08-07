/* ============================================================
   Recruiter ↔ Campus Bridge
   ------------------------------------------------------------
   The panels that turn the recruiter console from a candidate
   search box into a hiring workspace connected to a campus.

   Five surfaces, each answering a question a recruiter actually
   asks:
     Overview      — what needs me today?
     Campus        — which colleges are we connected to, and what
                     can their cohort actually prove?
     Requisitions  — which of my roles can this campus fill?
     Pipeline      — where is everyone in the funnel?
     Skill gap     — what should the campus teach next semester?

   The last one is the reason this is a bridge and not a portal.
   It is the only view where the recruiter's demand and the
   college's supply are put in the same table, and it is directly
   actionable on both sides.
   ============================================================ */

import { useMemo, useState } from 'react';
import {
  Building2, Users, Briefcase, Target, TrendingUp, TrendingDown, AlertTriangle,
  CalendarClock, GraduationCap, Mail, ArrowRight, ShieldCheck, Layers,
  CheckCircle2, Clock, Send, MapPin, Award,
} from 'lucide-react';
import { SectionCard, StatCard } from './common.jsx';
import { Button, Badge, EmptyState, Modal } from '../components/ui/kit.jsx';
import {
  STAGE_TONE, PARTNER_TONE, PARTNER_LABEL, REQ_TYPE_LABEL,
  relativeDay, daysUntil, groupByStage, funnelConversion,
} from '../lib/recruiterBridge.js';

/* ---------------- small shared pieces ---------------- */

function Meter({ value, max, tone = 'violet' }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const bar = {
    violet: 'bg-aurora-violet', cyan: 'bg-aurora-cyan',
    mint: 'bg-aurora-mint', amber: 'bg-amber-glow', rose: 'bg-rose-400',
  }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
      <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Row({ label, value, hint }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[12px] text-slate-400">{label}</span>
      <span className="text-right">
        <span className="font-display text-[15px] font-semibold text-white">{value}</span>
        {hint && <span className="ml-1.5 text-[11px] text-slate-500">{hint}</span>}
      </span>
    </div>
  );
}

/* ============================================================
   OVERVIEW
   ============================================================ */

export function BridgeOverview({ summary, partners, interviews, onGoto }) {
  if (!summary) {
    return (
      <SectionCard title="Hiring overview">
        <EmptyState
          icon={Briefcase}
          title="No hiring activity yet"
          hint="Once your organisation has open requisitions and candidates in pipeline, your funnel, time-to-hire and campus performance appear here."
        />
      </SectionCard>
    );
  }

  const k = summary.kpis || {};
  const conv = funnelConversion(summary.funnel || []);
  const connected = (partners || []).filter((p) => p.status === 'connected');
  const upcoming = (interviews || [])
    .filter((i) => i.status === 'scheduled')
    .slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          i={0} icon={Briefcase} tone="violet" label="Open requisitions" value={k.openRequisitions}
          hint={`${k.openSeats} seats to fill · ${k.seatsFilledPct}% filled so far`}
        />
        <StatCard
          i={1} icon={Users} tone="cyan" label="Verified talent pool" value={k.talentPool}
          hint={`Avg trust ${k.avgTrustScore} · every profile has openable proof`}
        />
        <StatCard
          i={2} icon={Target} tone="amber" label="Active pipeline" value={k.activePipeline}
          hint={`${k.offersOut} offers out · ${k.offerAcceptRate}% accept rate`}
        />
        <StatCard
          i={3} icon={GraduationCap} tone="mint" label="Hires" value={k.hires}
          hint={`${k.campusHireShare}% from campus · ${k.connectedCampuses} campus connected`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SectionCard
            title="Hiring funnel"
            eyebrow="Conversion between stages"
            action={<Badge tone="cyan">{k.medianDaysToOffer}d median to offer</Badge>}
          >
            {conv.every((s) => !s.count) ? (
              <EmptyState icon={Layers} title="Funnel is empty" hint="Candidates appear here as they enter your requisitions." />
            ) : (
              <div className="space-y-3">
                {conv.map((s, i) => (
                  <div key={s.id}>
                    <div className="mb-1 flex items-center justify-between text-[12px]">
                      <span className="font-medium text-slate-200">{s.label}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-slate-400">{s.reached}</span>
                        {i > 0 && (
                          <Badge tone={s.conversion >= 60 ? 'mint' : s.conversion >= 35 ? 'amber' : 'rose'}>
                            {s.conversion}%
                          </Badge>
                        )}
                      </span>
                    </div>
                    <Meter value={s.reached} max={conv[0].reached} tone={i >= 3 ? 'mint' : i >= 2 ? 'amber' : 'violet'} />
                  </div>
                ))}
                <p className="pt-1 text-[11px] leading-relaxed text-slate-500">
                  Each bar is candidates who reached that stage or beyond, so the percentages read as
                  stage-to-stage conversion. Rejections are excluded — they are an outcome, not a step.
                </p>
              </div>
            )}
          </SectionCard>
        </div>

        <div className="lg:col-span-2">
          <SectionCard
            title="Needs attention"
            eyebrow="Requisitions at risk"
            action={<Badge tone={(summary.atRisk || []).length ? 'amber' : 'mint'}>{(summary.atRisk || []).length}</Badge>}
          >
            {!(summary.atRisk || []).length ? (
              <EmptyState icon={CheckCircle2} title="Nothing at risk" hint="Every open requisition is on track against its target close date." />
            ) : (
              <div className="space-y-2.5">
                {summary.atRisk.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => onGoto?.('requisitions')}
                    className="w-full rounded-xl border border-amber-300/20 bg-amber-400/[0.06] p-3 text-left transition hover:border-amber-300/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13px] font-medium text-white">{r.title}</span>
                      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-glow" />
                    </div>
                    <p className="mt-1 text-[11px] text-amber-100/70">{r.reasons.join(' · ')}</p>
                    <div className="mt-2"><Meter value={r.hired} max={r.openings} tone="amber" /></div>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Speed" eyebrow="Median time in funnel">
          <Row label="Sourced → shortlisted" value={`${k.medianDaysToShortlist} days`} />
          <Row label="Sourced → offer" value={`${k.medianDaysToOffer} days`} />
          <Row label="Offer acceptance" value={`${k.offerAcceptRate}%`} />
          <Row label="Average match score" value={k.avgMatchScore} hint="/ 100" />
          <p className="mt-3 border-t border-white/8 pt-3 text-[11px] leading-relaxed text-slate-500">
            Medians, not averages — one stalled candidate should not move the number that tells you
            how fast you actually hire.
          </p>
        </SectionCard>

        <SectionCard
          title="Upcoming interviews"
          eyebrow="Next five"
          action={<Badge tone="cyan">{(interviews || []).filter((i) => i.status === 'scheduled').length} scheduled</Badge>}
        >
          {!upcoming.length ? (
            <EmptyState icon={CalendarClock} title="Nothing scheduled" hint="Interviews appear here once shortlisted candidates have slots booked." />
          ) : (
            <div className="space-y-2">
              {upcoming.map((iv) => (
                <div key={iv.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-white">{iv.candidateName}</p>
                    <p className="truncate text-[11px] text-slate-500">{iv.round} · {iv.panel} · {iv.mode}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge tone="cyan"><Clock size={10} /> {relativeDay(iv.scheduledAt)}</Badge>
                    <p className="mt-1 text-[10px] text-slate-500">{iv.durationMins} min</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {connected.length > 0 && (
        <SectionCard title="Campus contribution" eyebrow="Where your hires come from">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="font-display text-[26px] font-extrabold text-white">{k.campusHireShare}%</p>
              <p className="mt-1 text-[11px] text-slate-500">of hires came through a connected campus</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="font-display text-[26px] font-extrabold text-white">{connected.reduce((s, c) => s + c.recruiterReadyCount, 0)}</p>
              <p className="mt-1 text-[11px] text-slate-500">students with verified, openable proof</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="font-display text-[26px] font-extrabold text-white">{connected.reduce((s, c) => s + c.inPipeline, 0)}</p>
              <p className="mt-1 text-[11px] text-slate-500">campus candidates in your pipeline</p>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

/* ============================================================
   CAMPUS PARTNERS
   ============================================================ */

export function CampusPartners({ partners = [], onGoto }) {
  const [detail, setDetail] = useState(null);

  if (!partners.length) {
    return (
      <SectionCard title="Campus partners">
        <EmptyState
          icon={Building2}
          title="No campus connections yet"
          hint="Connect a college's placement cell to see their cohort's verified skills, run requisitions against their students, and share drive outcomes both ways."
        />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="Campus partners"
        eyebrow="Your campus programme"
        action={<Badge tone="mint">{partners.filter((p) => p.status === 'connected').length} connected</Badge>}
      >
        <p className="mb-4 text-[12px] leading-relaxed text-slate-400">
          A connected campus shares live cohort signal — verified skills, readiness and project proof —
          with your requisitions. Nothing is shared about a student who has not made their proof visible
          to recruiters.
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          {partners.map((c) => {
            const live = c.status === 'connected';
            return (
              <div
                key={c.id}
                className={`rounded-2xl border p-4 transition ${live ? 'border-aurora-mint/25 bg-aurora-mint/[0.04] hover:border-aurora-mint/45' : 'border-white/10 bg-white/[0.02] hover:border-white/25'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-[15px] font-bold text-white">{c.name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                      <MapPin size={10} /> {c.city} · {c.tier}
                    </p>
                  </div>
                  <Badge tone={PARTNER_TONE[c.status] || 'default'}>{PARTNER_LABEL[c.status] || c.status}</Badge>
                </div>

                {live ? (
                  <>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl border border-white/10 bg-ink-950/40 p-2">
                        <p className="font-display text-[18px] font-bold text-white">{c.recruiterReadyCount}</p>
                        <p className="text-[10px] text-slate-500">proof-ready</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-ink-950/40 p-2">
                        <p className="font-display text-[18px] font-bold text-white">{c.avgReadiness}</p>
                        <p className="text-[10px] text-slate-500">avg readiness</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-ink-950/40 p-2">
                        <p className="font-display text-[18px] font-bold text-white">{c.offersAccepted}</p>
                        <p className="text-[10px] text-slate-500">hires</p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                        <span>Proof-ready share of cohort</span>
                        <span className="font-mono">{c.recruiterReadyCount}/{c.cohortSize}</span>
                      </div>
                      <Meter value={c.recruiterReadyCount} max={c.cohortSize} tone="mint" />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(c.topSkills || []).slice(0, 5).map((s) => (
                        <Badge key={s.skill} tone="cyan">{s.skill} · {s.count}</Badge>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                      <span className="text-[11px] text-slate-500">
                        Next drive {c.nextDriveAt ? relativeDay(c.nextDriveAt) : '—'}
                      </span>
                      <div className="ml-auto flex gap-2">
                        <Button size="sm" variant="soft" onClick={() => setDetail(c)}>
                          <Building2 size={13} /> Campus detail
                        </Button>
                        <Button size="sm" onClick={() => onGoto?.('requisitions')}>
                          Match roles <ArrowRight size={13} />
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-3 text-[12px] leading-relaxed text-slate-400">{c.note}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                      <span className="text-[11px] text-slate-500">
                        {c.invitedAt ? `Invited ${relativeDay(c.invitedAt)}` : 'Not yet contacted'}
                      </span>
                      <div className="ml-auto">
                        <Button size="sm" variant="soft" disabled title="Available once campus outreach is enabled for your org">
                          <Send size={13} /> {c.status === 'prospect' ? 'Invite campus' : 'Follow up'}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name || ''} width="max-w-2xl">
        {detail && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Cohort</p>
                <Row label="Total students" value={detail.cohortSize} />
                <Row label="Graduating batch" value={detail.graduatingCount} />
                <Row label="Proof-ready" value={detail.recruiterReadyCount} />
                <Row label="Proof-ready, graduating" value={detail.graduatingReadyCount} />
                <Row label="With a verified project" value={detail.verifiedProjectStudents} />
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Quality</p>
                <Row label="Avg readiness" value={detail.avgReadiness} hint="/ 100" />
                <Row label="Avg resume score" value={detail.avgResume} hint="/ 100" />
                <Row label="Avg CGPA" value={detail.avgCgpa} hint="/ 10" />
                <Row label="Offer acceptance" value={`${detail.acceptanceRate}%`} />
                <Row label="Avg accepted CTC" value={detail.avgOfferCtc ? `${detail.avgOfferCtc} LPA` : '—'} />
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Specialisations</p>
              <div className="flex flex-wrap gap-1.5">
                {(detail.branches || []).map((b) => <Badge key={b} tone="violet">{b}</Badge>)}
              </div>
              <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Most-proven skills in the pool
              </p>
              <div className="space-y-1.5">
                {(detail.topSkills || []).map((s) => (
                  <div key={s.skill} className="flex items-center gap-2 text-[12px]">
                    <span className="w-32 shrink-0 truncate text-slate-300">{s.skill}</span>
                    <div className="flex-1"><Meter value={s.count} max={detail.topSkills[0]?.count || 1} tone="cyan" /></div>
                    <span className="w-8 text-right font-mono text-[11px] text-slate-400">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Placement cell</p>
              <div className="flex flex-wrap items-center gap-2">
                <Mail size={13} className="text-aurora-cyan" />
                <span className="text-[13px] text-slate-200">{detail.placementCellName}</span>
                <span className="font-mono text-[12px] text-slate-500">{detail.placementCellEmail}</span>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                Counts here are computed from the cohort the placement cell maintains. Only students who
                made their proof visible to recruiters are included in the proof-ready figures.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ============================================================
   REQUISITIONS
   ============================================================ */

export function Requisitions({ requisitions = [], pipeline = [], onOpenMatches }) {
  if (!requisitions.length) {
    return (
      <SectionCard title="Requisitions">
        <EmptyState icon={Briefcase} title="No requisitions yet" hint="Your open roles appear here with live match counts against every connected campus." />
      </SectionCard>
    );
  }

  const countFor = (id) => pipeline.filter((p) => p.requisitionId === id).length;
  const hiredFor = (id) => pipeline.filter((p) => p.requisitionId === id && p.stage === 'accepted').length;

  const statusTone = { open: 'mint', on_hold: 'amber', closed: 'default' };
  const priorityTone = { high: 'rose', medium: 'amber', low: 'default' };

  return (
    <SectionCard
      title="Requisitions"
      eyebrow="Your open roles"
      action={<Badge tone="mint">{requisitions.filter((r) => r.status === 'open').length} open</Badge>}
    >
      <div className="space-y-3">
        {requisitions.map((r) => {
          const inPipe = countFor(r.id);
          const hired = hiredFor(r.id);
          const left = daysUntil(r.targetCloseAt);
          return (
            <div key={r.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/25">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-[15px] font-bold text-white">{r.title}</p>
                    <Badge tone={statusTone[r.status] || 'default'}>{r.status.replace('_', ' ')}</Badge>
                    <Badge tone={priorityTone[r.priority] || 'default'}>{r.priority}</Badge>
                    <Badge tone="violet">{REQ_TYPE_LABEL[r.type] || r.type}</Badge>
                  </div>
                  <p className="mt-1 text-[12px] text-slate-400">
                    {r.department} · {r.location} · {r.workMode} · {r.ctcLpa} LPA · {r.openings} opening{r.openings === 1 ? '' : 's'}
                  </p>
                  {r.collegeName && (
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-aurora-mint/80">
                      <GraduationCap size={11} /> Running against {r.collegeName}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-display text-[22px] font-extrabold text-white">{hired}<span className="text-slate-600">/{r.openings}</span></p>
                  <p className="text-[10px] text-slate-500">seats filled</p>
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Must have</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(r.mustHaveSkills || []).map((s) => <Badge key={s} tone="cyan">{s}</Badge>)}
                  </div>
                  {(r.niceToHaveSkills || []).length > 0 && (
                    <>
                      <p className="mb-1.5 mt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Nice to have</p>
                      <div className="flex flex-wrap gap-1.5">
                        {r.niceToHaveSkills.map((s) => <Badge key={s}>{s}</Badge>)}
                      </div>
                    </>
                  )}
                </div>
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Eligibility gate</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(r.eligibility?.branches || []).map((b) => <Badge key={b} tone="violet">{b}</Badge>)}
                    {(r.eligibility?.batches || []).map((b) => <Badge key={b} tone="violet">Batch {b}</Badge>)}
                    {r.eligibility?.minResume != null && <Badge tone="amber">Resume ≥ {r.eligibility.minResume}</Badge>}
                    {r.eligibility?.minCgpa != null && <Badge tone="amber">CGPA ≥ {r.eligibility.minCgpa}</Badge>}
                    {r.eligibility?.maxBacklogs != null && <Badge tone="amber">Backlogs ≤ {r.eligibility.maxBacklogs}</Badge>}
                    {r.eligibility?.minVerifiedProjects != null && <Badge tone="mint">Verified projects ≥ {r.eligibility.minVerifiedProjects}</Badge>}
                    {r.eligibility?.minExperienceYears != null && <Badge tone="rose">{r.eligibility.minExperienceYears}+ yrs experience</Badge>}
                  </div>
                  <div className="mt-3"><Meter value={hired} max={r.openings} tone={hired >= r.openings ? 'mint' : left != null && left < 7 ? 'amber' : 'violet'} /></div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                <Badge tone="cyan"><Users size={11} /> {inPipe} in pipeline</Badge>
                <Badge tone={left != null && left < 7 ? 'amber' : 'default'}>
                  <CalendarClock size={11} /> target close {relativeDay(r.targetCloseAt)}
                </Badge>
                <span className="text-[11px] text-slate-500">HM: {r.hiringManager}</span>
                <div className="ml-auto">
                  <Button size="sm" onClick={() => onOpenMatches?.(r)}>
                    <Target size={13} /> See campus matches
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

/* Modal: ranked, explained matches for one requisition. */
export function MatchesModal({ open, onClose, requisition, matches = [], loading }) {
  return (
    <Modal open={open} onClose={onClose} title={requisition ? `Campus matches — ${requisition.title}` : ''} width="max-w-3xl">
      {loading ? (
        <p className="py-6 text-center text-sm text-slate-400">Matching against the campus cohort…</p>
      ) : !matches.length ? (
        <EmptyState
          icon={AlertTriangle}
          title="No eligible candidates on this campus"
          hint={
            requisition?.eligibility?.minExperienceYears
              ? 'This role requires prior industry experience, which a graduating cohort cannot satisfy. Source it off-campus instead.'
              : 'No student currently clears this requisition\u2019s eligibility gate. Relaxing CGPA, resume or batch criteria would widen the pool.'
          }
        />
      ) : (
        <div className="space-y-3">
          <p className="text-[12px] leading-relaxed text-slate-400">
            Every candidate below clears the hard eligibility gate. The score is the soft ranking on top of
            it, and each part is shown so you can see exactly why someone ranked where they did.
          </p>
          {matches.map(({ profile, match }, i) => (
            <div key={profile.userId} className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-aurora-violet/15 font-display text-[12px] font-bold text-aurora-cyan">#{i + 1}</span>
                  <div>
                    <p className="text-[13px] font-medium text-white">{profile.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {profile.campus?.branchShort} · Batch {profile.campus?.batch} · CGPA {profile.campus?.cgpa} · {profile.targetRole}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="mint"><ShieldCheck size={10} /> {profile.trustScore}</Badge>
                  <Badge tone={match.score >= 70 ? 'mint' : match.score >= 50 ? 'cyan' : 'amber'}>
                    <Award size={10} /> {match.score}
                  </Badge>
                </div>
              </div>

              <div className="mt-2.5 grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  {Object.entries(match.parts).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 text-[11px]">
                      <span className="w-28 shrink-0 text-slate-400">{k}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                        <div className="h-full rounded-full bg-aurora-cta" style={{ width: `${Math.min(100, v * 2.5)}%` }} />
                      </div>
                      <span className="w-5 text-right font-mono text-slate-300">{v}</span>
                    </div>
                  ))}
                </div>
                <div>
                  {match.mustHaveMatched.length > 0 && (
                    <>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Proven against must-haves</p>
                      <div className="flex flex-wrap gap-1.5">
                        {match.mustHaveMatched.map((s) => <Badge key={s} tone="mint"><CheckCircle2 size={10} /> {s}</Badge>)}
                      </div>
                    </>
                  )}
                  {match.mustHaveMissing.length > 0 && (
                    <>
                      <p className="mb-1 mt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Not yet proven</p>
                      <div className="flex flex-wrap gap-1.5">
                        {match.mustHaveMissing.map((s) => <Badge key={s} tone="rose">{s}</Badge>)}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ============================================================
   PIPELINE BOARD
   ============================================================ */

export function PipelineBoard({ pipeline = [], stages = [], requisitions = [] }) {
  const [reqFilter, setReqFilter] = useState('');

  const filtered = useMemo(
    () => (reqFilter ? pipeline.filter((p) => p.requisitionId === reqFilter) : pipeline),
    [pipeline, reqFilter],
  );
  const grouped = useMemo(() => groupByStage(filtered, stages), [filtered, stages]);

  if (!pipeline.length) {
    return (
      <SectionCard title="Pipeline">
        <EmptyState icon={Layers} title="Pipeline is empty" hint="Candidates you source against a requisition appear here, grouped by stage." />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Pipeline"
      eyebrow="Every candidate, by stage"
      action={
        <select
          value={reqFilter}
          onChange={(e) => setReqFilter(e.target.value)}
          className="h-9 rounded-xl border border-white/10 bg-ink-950 px-2.5 text-[12px] text-slate-100"
        >
          <option value="">All requisitions</option>
          {requisitions.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
      }
    >
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {stages.map((s) => {
          const list = grouped[s.id] || [];
          return (
            <div key={s.id} className="w-[228px] shrink-0">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] font-semibold text-slate-200">{s.label}</span>
                <Badge tone={STAGE_TONE[s.id] || 'default'}>{list.length}</Badge>
              </div>
              <div className="space-y-2">
                {!list.length && (
                  <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-[11px] text-slate-600">
                    Empty
                  </div>
                )}
                {list.map((p) => (
                  <div key={p.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-[12px] font-medium text-white">{p.candidateName}</p>
                      <span className="shrink-0 font-mono text-[11px] text-aurora-cyan">{p.matchScore}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-slate-500">{p.branch || p.source} · {p.batch}</p>
                    <p className="mt-1 truncate text-[10px] text-slate-600">{p.requisitionTitle}</p>
                    {p.ctcLpa && <div className="mt-1.5"><Badge tone="mint">{p.ctcLpa} LPA</Badge></div>}
                    {p.stage === 'sourced' && p.mustHaveMissing?.length > 0 && (
                      <p className="mt-1.5 truncate text-[10px] text-rose-300/70">missing: {p.mustHaveMissing.join(', ')}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

/* ============================================================
   SKILL SUPPLY vs DEMAND
   ============================================================ */

export function SkillGap({ gaps = [], partners = [] }) {
  const connected = partners.find((p) => p.status === 'connected');

  if (!gaps.length) {
    return (
      <SectionCard title="Skill supply vs demand">
        <EmptyState icon={TrendingUp} title="Nothing to compare yet" hint="Once you have open requisitions and a connected campus, this compares what your roles need against what the cohort can prove." />
      </SectionCard>
    );
  }

  const shortfalls = gaps.filter((g) => g.gap > 0);
  const covered = gaps.filter((g) => g.gap <= 0);
  const maxScale = Math.max(...gaps.map((g) => Math.max(g.demand, g.claimedSupply)), 1);

  const GapRow = ({ g }) => (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-white">{g.skill}</span>
        <Badge tone={g.coverage >= 100 ? 'mint' : g.coverage >= 50 ? 'amber' : 'rose'}>
          {g.coverage >= 100 ? <TrendingUp size={10} /> : <TrendingDown size={10} />} {g.coverage}% covered
        </Badge>
      </div>
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-16 shrink-0 text-slate-500">Demand</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
            <div className="h-full rounded-full bg-amber-glow" style={{ width: `${(g.demand / maxScale) * 100}%` }} />
          </div>
          <span className="w-7 text-right font-mono text-slate-300">{g.demand}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-16 shrink-0 text-slate-500">Proven</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
            <div className="h-full rounded-full bg-aurora-mint" style={{ width: `${(g.provenSupply / maxScale) * 100}%` }} />
          </div>
          <span className="w-7 text-right font-mono text-slate-300">{g.provenSupply}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-16 shrink-0 text-slate-500">Claimed</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
            <div className="h-full rounded-full bg-aurora-cyan/60" style={{ width: `${(g.claimedSupply / maxScale) * 100}%` }} />
          </div>
          <span className="w-7 text-right font-mono text-slate-300">{g.claimedSupply}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <SectionCard
        title="Skill supply vs demand"
        eyebrow={connected ? `Your open roles against ${connected.name}` : 'Your open roles against the connected cohort'}
        action={<Badge tone={shortfalls.length ? 'amber' : 'mint'}>{shortfalls.length} shortfall{shortfalls.length === 1 ? '' : 's'}</Badge>}
      >
        <p className="mb-4 text-[12px] leading-relaxed text-slate-400">
          <span className="text-slate-300">Demand</span> is seats across your open requisitions weighted by
          whether a skill is required or preferred. <span className="text-slate-300">Proven</span> counts students
          whose work was actually verified for that skill; <span className="text-slate-300">claimed</span> counts
          everyone who lists it. The distance between those two lines is the one number worth sending to a
          placement cell.
        </p>

        {shortfalls.length > 0 && (
          <>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-amber-glow/80">
              Campus cannot currently fill
            </p>
            <div className="grid gap-2.5 md:grid-cols-2">
              {shortfalls.map((g) => <GapRow key={g.skill} g={g} />)}
            </div>
          </>
        )}

        {covered.length > 0 && (
          <>
            <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-widest text-aurora-mint/80">
              Fully covered by the cohort
            </p>
            <div className="grid gap-2.5 md:grid-cols-2">
              {covered.map((g) => <GapRow key={g.skill} g={g} />)}
            </div>
          </>
        )}
      </SectionCard>

      {shortfalls.length > 0 && (
        <SectionCard title="What to send the placement cell" eyebrow="Actionable on both sides">
          <div className="space-y-2">
            {shortfalls.slice(0, 4).map((g) => (
              <div key={g.skill} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[12px] leading-relaxed text-slate-300">
                <span className="font-medium text-white">{g.skill}</span> — {g.demand} seat{g.demand === 1 ? '' : 's'} need it,
                {' '}{g.provenSupply} student{g.provenSupply === 1 ? '' : 's'} can prove it
                {g.claimedSupply > g.provenSupply && (
                  <>, and {g.claimedSupply - g.provenSupply} more list it without verified work behind it</>
                )}.
                {g.claimedSupply > g.provenSupply
                  ? ' Getting those existing claims verified would close most of this gap without teaching anything new.'
                  : ' This one needs new coursework or a project track, not just verification.'}
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
