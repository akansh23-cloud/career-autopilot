import { useEffect, useState } from 'react';
import {
  Gauge, ShieldCheck, Loader2, Users, ClipboardCheck, Flame, Target, Search, ChevronDown, AlertTriangle,
} from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, EmptyState } from '../components/ui/kit.jsx';
import { Readiness } from '../lib/api.js';
import { getPlan, PLAN_EVENT } from '../lib/plan.js';

const CAT_TONE = { 'Placement Ready': 'mint', 'Interview Ready': 'cyan', 'Apply Ready': 'violet', 'Needs Improvement': 'amber', 'Not Ready': 'default' };

function Bar({ label, value }) {
  const tone = value >= 80 ? '#46E6A6' : value >= 50 ? '#37D6C4' : '#FFC85A';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]"><span className="text-slate-300">{label}</span><span className="tabular-nums text-slate-400">{value}</span></div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full" style={{ width: `${value}%`, background: tone }} /></div>
    </div>
  );
}

function useIsAdmin() {
  const [admin, setAdmin] = useState(!!getPlan().isAdmin);
  useEffect(() => { const f = () => setAdmin(!!getPlan().isAdmin); window.addEventListener(PLAN_EVENT, f); return () => window.removeEventListener(PLAN_EVENT, f); }, []);
  return admin;
}

export default function ReadinessView() {
  const isAdmin = useIsAdmin();
  const [mine, setMine] = useState(null);
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState([]);
  const [skill, setSkill] = useState('');
  const [category, setCategory] = useState('');
  const [overview, setOverview] = useState(null);
  const [queue, setQueue] = useState([]);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await Readiness.mine(); setMine(r.readiness); setCategories(r.categories || []);
        if (isAdmin) {
          const [ov, q, cands] = await Promise.all([Readiness.overview(), Readiness.queue(), Readiness.candidates()]);
          setOverview(ov); setQueue(q.queue || []); setCandidates(cands.candidates || []);
        } else {
          setCandidates([]); setOverview(null); setQueue([]);
        }
      } catch { /* */ } finally { setLoading(false); }
    })();
  }, [isAdmin]);

  const searchCandidates = async () => {
    if (!isAdmin) return;
    try { const c = await Readiness.candidates({ skill, category }); setCandidates(c.candidates || []); } catch { /* */ }
  };

  return (
    <>
      <PageIntro title="Placement readiness" sub="Readiness, recruiter shortlists and admin analytics are computed from VERIFIED skills and verified projects only — pending work never counts." />

      {loading ? (
        <SectionCard><div className="flex items-center gap-2 py-8 text-slate-400"><Loader2 size={16} className="animate-spin" /> Loading readiness…</div></SectionCard>
      ) : (
        <div className="space-y-4">
          {mine && (
            <SectionCard title="My readiness">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge tone={CAT_TONE[mine.category]}><Gauge size={11} /> {mine.score}/100</Badge>
                <Badge tone={CAT_TONE[mine.category]}>{mine.category}</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Bar label="Verified skills" value={mine.components.skillsScore} />
                <Bar label="Verified XP" value={mine.components.xpScore} />
                <Bar label="Verified projects" value={mine.components.projectScore} />
                <Bar label="Recruiter-ready" value={mine.components.recruiterScore} />
                {mine.components.resumeScore != null && <Bar label="Resume score" value={mine.components.resumeScore} />}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500">
                <span><ShieldCheck size={11} className="mb-0.5 inline text-aurora-mint" /> {mine.counts.verifiedSkills} verified skills</span>
                <span>{mine.counts.verifiedProjectCount} verified projects</span>
                <span>{mine.counts.totalVerifiedXp} verified XP</span>
              </div>
              {mine.gaps?.length > 0 && (
                <div className="mt-3 border-t border-white/8 pt-3">
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">To level up</div>
                  <ul className="space-y-1">{mine.gaps.map((g, i) => <li key={i} className="text-[13px] text-slate-300">• {g}</li>)}</ul>
                </div>
              )}
            </SectionCard>
          )}

          {isAdmin && overview && (
            <>
              <SectionCard title="Readiness overview (admin)">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {(categories.length ? categories : Object.keys(overview.buckets)).map((c) => (
                    <div key={c} className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-center">
                      <div className="font-display text-xl text-white">{overview.buckets[c] || 0}</div>
                      <div className="text-[10px] text-slate-500">{c}</div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              {overview.heatmap?.length > 0 && (
                <SectionCard title="Verified skill heatmap (admin)">
                  <div className="flex flex-wrap gap-2">
                    {overview.heatmap.map((h) => (
                      <span key={h.skill} className="inline-flex items-center gap-1 rounded-md border border-white/8 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-300">
                        <Flame size={11} className="text-amber-glow" /> {h.skill} <span className="text-slate-500">×{h.count}</span>
                      </span>
                    ))}
                  </div>
                </SectionCard>
              )}

              <SectionCard title={`Project verification queue (${queue.length})`}>
                {queue.length === 0 ? <EmptyState icon={ClipboardCheck} title="Queue empty" hint="No projects awaiting verification." /> : (
                  <div className="space-y-2">
                    {queue.map((q) => (
                      <div key={q.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
                        <div className="min-w-0"><div className="truncate text-sm text-slate-200">{q.title}</div><div className="text-[11px] text-slate-500">{q.email} · {(q.claimedSkills || []).slice(0, 4).join(', ')}</div></div>
                        <Badge tone={q.verificationStatus === 'needs_review' ? 'amber' : 'cyan'}>{String(q.verificationStatus).replace('_', ' ')}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </>
          )}

          {isAdmin && <SectionCard title="Candidate shortlist" eyebrow="Admin / Recruiter-safe">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[160px]">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="Filter by verified skill…" className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] pl-9 pr-3 text-xs text-slate-100 outline-none" />
              </div>
              <div className="relative">
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 cursor-pointer appearance-none rounded-lg border border-white/10 bg-white/[0.03] pl-3 pr-8 text-xs text-slate-100 outline-none">
                  <option value="">Any readiness</option>
                  {(categories.length ? categories : []).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              </div>
              <Button size="sm" variant="soft" onClick={searchCandidates}>Search</Button>
            </div>
            {candidates.length === 0 ? (
              <EmptyState icon={Users} title="No candidates yet" hint="Candidates appear here once people earn verified skills." />
            ) : (
              <div className="space-y-2">
                {candidates.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm text-slate-200">
                        <span className="truncate">{c.name || c.email || 'Candidate'}</span>
                        {c.targetRole && <Badge tone="default"><Target size={10} /> {c.targetRole}</Badge>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-1.5">{c.verifiedSkills.slice(0, 6).map((s) => <span key={s} className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">{s}</span>)}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={CAT_TONE[c.readinessCategory]}>{c.readinessScore}/100</Badge>
                      <span className="text-[10px] text-slate-500">{c.readinessCategory}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>}
        </div>
      )}
    </>
  );
}
