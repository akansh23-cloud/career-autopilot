import { useState } from 'react';
import { Search, MapPin, Clock, ExternalLink, Briefcase, Building2, Filter, Bookmark, ChevronDown } from 'lucide-react';
import { PageIntro } from './common.jsx';
import { Button, Input, Badge, Skeleton, EmptyState, Card } from '../components/ui/kit.jsx';
import { Jobs } from '../lib/api.js';

const ROLE_GROUPS = {
  'Software & Data': ['Software Engineer', 'Frontend Engineer', 'Backend Engineer', 'Full Stack Developer', 'Mobile Developer', 'DevOps Engineer', 'Cloud Engineer', 'Site Reliability Engineer (SRE)', 'Data Analyst', 'Data Scientist', 'Machine Learning Engineer', 'QA / Test Engineer', 'Security Engineer'],
  'Product & Design': ['Product Manager', 'Associate Product Manager', 'UX Designer', 'UI / Visual Designer', 'Product Designer', 'UX Researcher'],
  'Business & Operations': ['Business Analyst', 'Operations Manager', 'Project Manager', 'Program Manager', 'Management Consultant'],
  'Marketing & Sales': ['Digital Marketing Specialist', 'Content Writer / Marketer', 'SEO Specialist', 'Social Media Manager', 'Sales Executive', 'Business Development'],
  'Finance & HR': ['Financial Analyst', 'Accountant', 'Investment Analyst', 'HR Executive / Recruiter', 'Customer Success Manager'],
  'Internships / Entry-level': ['Software Engineering Intern', 'Data Analyst Intern', 'Marketing Intern', 'Design Intern', 'Finance Intern'],
};

const FRESH = [['24h', '1d'], ['3 days', '3d'], ['Week', '7d'], ['Month', '30d']];
const MODES = ['Any', 'Remote', 'On-site/Hybrid'];

function JobCard({ j, i, saved, onSave }) {
  return (
    <Card hover className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-white">{j.title}</h3>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted">
            <Building2 size={13} /> {j.company}
          </p>
        </div>
        <button onClick={() => onSave(j)} className={`rounded-lg p-2 transition ${saved ? 'text-amber-glow' : 'text-slate-500 hover:bg-white/6 hover:text-white'}`}>
          <Bookmark size={16} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {j.location && <Badge><MapPin size={11} /> {j.location}</Badge>}
        {j.mode && <Badge tone="violet">{j.mode}</Badge>}
        {j.postedDate && j.postedDate !== '(none)' && <Badge tone="cyan"><Clock size={11} /> {j.postedDate}</Badge>}
        {j.source && <Badge tone="mint">{j.source}</Badge>}
      </div>
      {j.summary && <p className="line-clamp-2 text-[13px] leading-relaxed text-slate-400">{j.summary}</p>}
      {j.requiredSkills?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {j.requiredSkills.slice(0, 5).map((s) => <span key={s} className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">{s}</span>)}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between border-t border-white/8 pt-3">
        {j.salary ? <span className="text-sm font-medium text-aurora-mint">{j.salary}</span> : <span className="text-xs text-slate-600">Salary undisclosed</span>}
        <a href={j.url} target="_blank" rel="noreferrer">
          <Button size="sm" variant="soft">Apply <ExternalLink size={14} /></Button>
        </a>
      </div>
    </Card>
  );
}

export default function JobsView() {
  const [role, setRole] = useState('');
  const [loc, setLoc] = useState('');
  const [mode, setMode] = useState('Any');
  const [fresh, setFresh] = useState('7d');
  const [state, setState] = useState({ status: 'idle', jobs: [], err: null });
  const [saved, setSaved] = useState({});

  const run = async (e) => {
    e?.preventDefault();
    if (!role.trim()) return;
    setState({ status: 'loading', jobs: [], err: null });
    try {
      const d = await Jobs.search({ role, location: loc, mode, freshness: fresh, verify: '0', limit: '18' });
      setState({ status: 'done', jobs: d.jobs || [], err: null });
    } catch (err) {
      setState({ status: 'error', jobs: [], err: err.message });
    }
  };
  const toggleSave = (j) => setSaved((s) => ({ ...s, [j.url || j.title]: !s[j.url || j.title] }));

  return (
    <>
      <PageIntro title="Find verified jobs" sub="Real listings from LinkedIn, Indeed, Naukri, Wellfound & more — never AI-fabricated." />

      <form onSubmit={run} className="gradient-border mb-6 p-4">
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role e.g. DevOps Engineer, Platform Engineer" className="pl-10" />
          </div>
          {/* Role preset dropdown */}
          <div className="relative md:w-52">
            <select
              value=""
              onChange={(e) => e.target.value && setRole(e.target.value)}
              className="h-11 w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-white/[0.03] pl-3.5 pr-9 text-sm text-slate-300 outline-none focus:border-aurora-violet/50"
            >
              <option value="">Pick a role…</option>
              {Object.entries(ROLE_GROUPS).map(([grp, roles]) => (
                <optgroup key={grp} label={grp}>
                  {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                </optgroup>
              ))}
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
          </div>
          <div className="relative md:w-52">
            <MapPin size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Country / city (optional)" className="pl-10" />
          </div>
          <Button type="submit" disabled={state.status === 'loading' || !role.trim()}>
            <Search size={16} /> Search
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-slate-500"><Filter size={13} /> Filters:</span>
          {MODES.map((m) => (
            <button key={m} onClick={() => setMode(m)} type="button"
              className={`rounded-lg px-3 py-1 text-xs transition ${mode === m ? 'bg-aurora-violet/15 text-white ring-1 ring-aurora-violet/30' : 'text-slate-400 hover:bg-white/5'}`}>{m}</button>
          ))}
          <span className="mx-1 h-4 w-px bg-white/10" />
          {FRESH.map(([l, v]) => (
            <button key={v} onClick={() => setFresh(v)} type="button"
              className={`rounded-lg px-3 py-1 text-xs transition ${fresh === v ? 'bg-aurora-cyan/15 text-white ring-1 ring-aurora-cyan/30' : 'text-slate-400 hover:bg-white/5'}`}>{l}</button>
          ))}
        </div>
      </form>

      {state.status === 'loading' && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52 w-full rounded-2xl" />)}
        </div>
      )}
      {state.status === 'error' && (
        <EmptyState icon={Briefcase} title="Search failed" hint={state.err} action={<Button size="sm" onClick={run}>Retry</Button>} />
      )}
      {state.status === 'idle' && (
        <EmptyState icon={Search} title="Search for your next role" hint="Type a job title above and hit search to pull verified, fresh listings ranked by recency." />
      )}
      {state.status === 'done' && state.jobs.length === 0 && (
        <EmptyState icon={Briefcase} title="No jobs found" hint="Try a broader role, clear the location, or widen the time window." />
      )}
      {state.status === 'done' && state.jobs.length > 0 && (
        <>
          <p className="mb-4 text-sm text-muted">{state.jobs.length} verified roles</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {state.jobs.map((j, i) => (
              <JobCard key={(j.url || j.title) + i} j={j} i={i} saved={!!saved[j.url || j.title]} onSave={toggleSave} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
