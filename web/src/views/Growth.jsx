import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, Target, Eye, MessageSquare, Award, Briefcase } from 'lucide-react';
import { PageIntro, StatCard, SectionCard, BarChart } from './common.jsx';
import { Badge, EmptyState, Button } from '../components/ui/kit.jsx';
import { getTrackerBoard, TRACKER_EVENT } from '../lib/trackerStore.js';

const JOB_RESULTS_KEY = 'careerAutopilot.jobResults.v1';
const KIT_KEY = 'careerAutopilot.tailoredKits.v1';
const emptyBoard = { saved: [], applied: [], interview: [], offer: [] };
function readJSON(k, f) { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(f)); } catch { return f; } }
function readBoard() { return { ...emptyBoard, ...getTrackerBoard() }; }
function weekLabel(d) { const x = new Date(d || Date.now()); const n = Math.ceil((((x - new Date(x.getFullYear(),0,1)) / 86400000) + new Date(x.getFullYear(),0,1).getDay()+1)/7); return `W${n}`; }

export default function Growth({ go }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const h = () => setTick((x) => x + 1); window.addEventListener(TRACKER_EVENT, h); window.addEventListener('storage', h); return () => { window.removeEventListener(TRACKER_EVENT, h); window.removeEventListener('storage', h); }; }, []);

  const data = useMemo(() => {
    const board = readBoard();
    const jobs = readJSON(JOB_RESULTS_KEY, { jobs: [] });
    const kits = readJSON(KIT_KEY, {});
    const all = Object.values(board).flat();
    const applied = board.applied.length + board.interview.length + board.offer.length;
    const interviews = board.interview.length + board.offer.length;
    const offers = board.offer.length;
    const avgMatch = (jobs.jobs || []).length ? Math.round((jobs.jobs || []).reduce((s, j) => s + Number(j.matchScore || j.match || 0), 0) / (jobs.jobs || []).length) : 0;
    const labels = [];
    const counts = [];
    const byWeek = {};
    all.forEach((x) => { const w = weekLabel(x.addedAt || x.movedAt); byWeek[w] = (byWeek[w] || 0) + 1; });
    Object.entries(byWeek).slice(-8).forEach(([k, v]) => { labels.push(k); counts.push(v); });
    const skills = {};
    (jobs.jobs || []).forEach((j) => (j.requiredSkills || []).forEach((s) => { skills[s] = (skills[s] || 0) + 1; }));
    return { board, all, saved: board.saved.length, applied, interviews, offers, avgMatch, kits: Object.keys(kits).length, labels, counts, skills: Object.entries(skills).sort((a,b)=>b[1]-a[1]).slice(0, 10) };
  }, [tick]);

  const total = data.all.length || data.kits || (data.avgMatch ? 1 : 0);
  return (
    <>
      <PageIntro title="Growth insights" sub="Real metrics from your saved jobs, tracker movement, tailored kits, and latest job search. No static demo data." />
      {!total && <EmptyState icon={Briefcase} title="No growth data yet" hint="Search jobs, tailor a resume, or add applications to the tracker to generate insights." action={<Button size="sm" onClick={() => go?.('jobs')}>Find jobs</Button>} />}
      {!!total && <>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard i={0} icon={Eye} tone="cyan" label="Saved jobs" value={String(data.saved)} hint="Jobs currently in Saved" />
          <StatCard i={1} icon={Target} tone="violet" label="Avg match" value={data.avgMatch ? `${data.avgMatch}%` : '—'} hint="From latest job results" />
          <StatCard i={2} icon={MessageSquare} tone="mint" label="Tailored kits" value={String(data.kits)} hint="Generated application kits" />
          <StatCard i={3} icon={Award} tone="amber" label="Interviews / offers" value={`${data.interviews}/${data.offers}`} hint="Moved in tracker" />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <SectionCard title="Applications added over time" className="lg:col-span-2" action={<Badge tone="cyan">Tracker data</Badge>}>
            {data.counts.length ? <BarChart data={data.counts} labels={data.labels} /> : <p className="py-14 text-center text-sm text-muted">Add applications to the tracker to see the timeline.</p>}
          </SectionCard>
          <SectionCard title="Conversion">
            <div className="space-y-4">
              {[
                ['Saved → Applied', data.saved + data.applied ? Math.round((data.applied / Math.max(1, data.saved + data.applied)) * 100) : 0, 'cyan'],
                ['Applied → Interview', data.applied ? Math.round((data.interviews / Math.max(1, data.applied)) * 100) : 0, 'violet'],
                ['Interview → Offer', data.interviews ? Math.round((data.offers / Math.max(1, data.interviews)) * 100) : 0, 'mint'],
              ].map(([l, v, t]) => (
                <div key={l}>
                  <div className="mb-1.5 flex justify-between text-xs"><span className="text-fg-secondary">{l}</span><span className="text-fg">{v}%</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/6"><div className={`h-full rounded-full bg-aurora-${t}`} style={{ width: `${v}%` }} /></div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <SectionCard title="Skills appearing in matched jobs">
            {data.skills.length ? <div className="flex flex-wrap gap-2">{data.skills.map(([s], i) => <Badge key={s} tone={['violet', 'cyan', 'mint', 'amber'][i % 4]}>{s}</Badge>)}</div> : <p className="text-sm text-muted">Run a job search to populate skill trends.</p>}
          </SectionCard>
          <SectionCard title="Next best actions">
            <ul className="space-y-3">
              {[
                data.kits === 0 && 'Tailor one resume for the highest-match job',
                data.saved > 0 && data.applied === 0 && 'Move saved jobs to applied after submitting applications',
                data.applied > 0 && data.interviews === 0 && 'Generate outreach and follow up for applied roles',
                data.skills.length > 0 && `Strengthen top skill: ${data.skills[0]?.[0]}`,
              ].filter(Boolean).map((t, i) => (
                <li key={i} className="flex items-center gap-3 rounded-xl border border-subtle bg-surface-1 px-3 py-2.5">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-aurora-cyan/12 text-aurora-cyan"><TrendingUp size={14} /></span>
                  <span className="text-sm text-fg">{t}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </>}
    </>
  );
}
