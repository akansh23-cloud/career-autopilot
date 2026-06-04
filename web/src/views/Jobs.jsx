import { useEffect, useState } from 'react';
import { Search, MapPin, Clock, ExternalLink, Briefcase, Building2, Filter, Bookmark, ChevronDown, Users, Linkedin, FileText, Mail, Sparkles, Copy, Check, AlertTriangle } from 'lucide-react';
import { PageIntro } from './common.jsx';
import { Button, Input, Badge, Skeleton, EmptyState, Card, Modal } from '../components/ui/kit.jsx';
import { Jobs, Contacts, AI } from '../lib/api.js';
import { ROLE_GROUPS } from '../lib/roles.js';
import { consumeQueuedResumeJobSearch, getResumeSearchRole, getStoredResume, getStoredJobResults, saveStoredJobResults, saveSelectedJob } from '../lib/resumeStore.js';

const FRESH = [['24h', '1d'], ['3 days', '3d'], ['Week', '7d'], ['Month', '30d']];
const MODES = ['Any', 'Remote', 'On-site/Hybrid'];

function domainFromUrl(url = '') {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    const parts = h.split('.');
    return parts.length > 2 ? parts.slice(-2).join('.') : h;
  } catch { return ''; }
}

function jobDescription(j) {
  return [j.title, j.company, j.location, j.summary, (j.requiredSkills || []).join(', ')].filter(Boolean).join('\n');
}

function JobCard({ j, saved, onSave, onAction }) {
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
      <div className="grid grid-cols-2 gap-2 border-t border-white/8 pt-3">
        <Button size="sm" variant="soft" onClick={() => onAction('tailor', j)}><FileText size={14} /> Tailor</Button>
        <Button size="sm" variant="soft" onClick={() => onAction('contacts', j)}><Mail size={14} /> Contacts</Button>
        <Button size="sm" variant="soft" onClick={() => onAction('referrals', j)}><Users size={14} /> Referrals</Button>
        <Button size="sm" variant="soft" onClick={() => onAction('linkedin', j)}><Linkedin size={14} /> LinkedIn</Button>
      </div>
      <div className="flex items-center justify-between pt-1">
        {j.salary ? <span className="text-sm font-medium text-aurora-mint">{j.salary}</span> : <span className="text-xs text-slate-600">Salary undisclosed</span>}
        <a href={j.url} target="_blank" rel="noreferrer">
          <Button size="sm">Apply <ExternalLink size={14} /></Button>
        </a>
      </div>
    </Card>
  );
}

export default function JobsView({ go }) {
  const stored = getStoredJobResults();
  const storedResume = getStoredResume();
  const initialRole = stored.role || getResumeSearchRole();
  const [role, setRole] = useState(initialRole || '');
  const [loc, setLoc] = useState(stored.location || '');
  const [mode, setMode] = useState(stored.mode || 'Any');
  const [fresh, setFresh] = useState(stored.freshness || '7d');
  const [state, setState] = useState({ status: stored.status || 'idle', jobs: stored.jobs || [], err: null });
  const [saved, setSaved] = useState(stored.saved || {});
  const [resumeHint, setResumeHint] = useState(Boolean(storedResume.text));
  const [people, setPeople] = useState({ open: false, title: '', status: 'idle', contacts: [], err: '', note: '', job: null, draft: '', copied: false });

  const persist = (patch) => saveStoredJobResults({ role, location: loc, mode, freshness: fresh, saved, ...patch });

  const run = async (e, override = {}) => {
    e?.preventDefault();
    const searchRole = (override.role ?? role).trim();
    if (!searchRole) return;
    const nextLoc = override.location ?? loc;
    const nextMode = override.mode ?? mode;
    const nextFresh = override.freshness ?? fresh;
    setRole(searchRole);
    setState({ status: 'loading', jobs: [], err: null });
    persist({ status: 'loading', jobs: [], role: searchRole, location: nextLoc, mode: nextMode, freshness: nextFresh });
    try {
      const d = await Jobs.search({ role: searchRole, location: nextLoc, mode: nextMode, freshness: nextFresh, verify: '0', limit: '18' });
      const jobs = d.jobs || [];
      setState({ status: 'done', jobs, err: null });
      saveStoredJobResults({ status: 'done', jobs, role: searchRole, location: nextLoc, mode: nextMode, freshness: nextFresh, saved });
    } catch (err) {
      setState({ status: 'error', jobs: [], err: err.message });
      saveStoredJobResults({ status: 'error', jobs: [], role: searchRole, location: nextLoc, mode: nextMode, freshness: nextFresh, saved, err: err.message });
    }
  };

  useEffect(() => {
    const queued = consumeQueuedResumeJobSearch();
    if (queued?.role) {
      setResumeHint(true);
      run(null, { role: queued.role });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onResumeUpdate = () => {
      const r = getStoredResume();
      setResumeHint(Boolean(r.text));
      if (!role && (r.targetRole || getResumeSearchRole())) setRole(r.targetRole || getResumeSearchRole());
    };
    window.addEventListener('career-resume-updated', onResumeUpdate);
    return () => window.removeEventListener('career-resume-updated', onResumeUpdate);
  }, [role]);

  const toggleSave = (j) => {
    const key = j.url || j.title;
    const next = { ...saved, [key]: !saved[key] };
    setSaved(next);
    saveStoredJobResults({ ...getStoredJobResults(), saved: next });
  };

  const openPeople = async (type, j) => {
    const title = type === 'referrals' ? 'Referral paths' : type === 'linkedin' ? 'Public LinkedIn profiles' : 'Hiring contacts';
    setPeople({ open: true, title, status: 'loading', contacts: [], err: '', note: '', job: j, draft: '', copied: false });
    const domain = j.companyDomain || j.domain || domainFromUrl(j.url);
    const payload = { company: j.company, domain, title: type === 'referrals' ? role || j.title : 'Recruiter OR Talent Acquisition OR Hiring Manager', jobId: j.id || j.url };
    try {
      const d = type === 'referrals' ? await Contacts.referrals(payload) : await Contacts.find(payload);
      const contacts = d.contacts || [];
      setPeople((p) => ({ ...p, status: 'done', contacts, note: d.note || '', err: d.ok === false ? d.error : '' }));
    } catch (err) {
      setPeople((p) => ({ ...p, status: 'error', err: err.message || 'Lookup failed.' }));
    }
  };

  const makeDraft = async (c) => {
    setPeople((p) => ({ ...p, draft: 'Generating…', copied: false }));
    const resume = getStoredResume();
    const prompt = `Write a short LinkedIn/email outreach note under 90 words. Candidate resume summary: ${resume.analysis?.summary || resume.text.slice(0, 700)}\nTarget person: ${c.name || 'contact'}, ${c.title || c.position || ''} at ${c.company || people.job?.company || ''}.\nTarget job: ${people.job?.title || role}. Make it specific, polite and non-spammy. Output message only.`;
    try {
      const r = await AI.message({ model: 'claude-sonnet-4-20250514', max_tokens: 350, messages: [{ role: 'user', content: prompt }] });
      const text = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      setPeople((p) => ({ ...p, draft: text }));
    } catch (e) {
      setPeople((p) => ({ ...p, draft: `Could not generate outreach: ${e.message}` }));
    }
  };

  const copyDraft = () => {
    navigator.clipboard?.writeText(people.draft || '');
    setPeople((p) => ({ ...p, copied: true }));
    setTimeout(() => setPeople((p) => ({ ...p, copied: false })), 1500);
  };

  const action = (type, j) => {
    saveSelectedJob(j);
    if (type === 'tailor') { go?.('editor'); return; }
    openPeople(type, j);
  };

  return (
    <>
      <PageIntro title="Find verified jobs" sub="Real listings from LinkedIn, Indeed, Naukri, Wellfound & more — with resume-aware actions after every result." />
      {resumeHint && (
        <div className="mb-4 rounded-2xl border border-aurora-mint/20 bg-aurora-mint/10 px-4 py-3 text-sm text-slate-200">
          Resume is saved. Jobs and actions stay here even when you move to another section.
          <span className="ml-1 font-medium text-white">Current role: {role || 'select a role'}</span>
        </div>
      )}

      <form onSubmit={run} className="gradient-border mb-6 p-4">
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role e.g. DevOps Engineer, Platform Engineer" className="pl-10" />
          </div>
          <div className="relative md:w-56">
            <select
              value={Object.values(ROLE_GROUPS).flat().includes(role) ? role : ''}
              onChange={(e) => e.target.value && setRole(e.target.value)}
              className="h-11 w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-white/[0.03] pl-3.5 pr-9 text-sm text-slate-100 outline-none focus:border-aurora-violet/50"
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
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-2xl" />)}
        </div>
      )}
      {state.status === 'error' && (
        <EmptyState icon={Briefcase} title="Search failed" hint={state.err} action={<Button size="sm" onClick={run}>Retry</Button>} />
      )}
      {state.status === 'idle' && (
        <EmptyState icon={Search} title="Search for your next role" hint="Analyze your resume first for best matching, or manually search a role here." />
      )}
      {state.status === 'done' && state.jobs.length === 0 && (
        <EmptyState icon={Briefcase} title="No jobs found" hint="Try a broader role, clear the location, or widen the time window." />
      )}
      {state.status === 'done' && state.jobs.length > 0 && (
        <>
          <p className="mb-4 text-sm text-muted">{state.jobs.length} verified roles • results persist locally</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {state.jobs.map((j, i) => (
              <JobCard key={(j.url || j.title) + i} j={j} saved={!!saved[j.url || j.title]} onSave={toggleSave} onAction={action} />
            ))}
          </div>
        </>
      )}

      <Modal open={people.open} onClose={() => setPeople((p) => ({ ...p, open: false }))} title={people.title} width="max-w-3xl">
        {people.status === 'loading' && <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>}
        {people.status === 'error' && <EmptyState icon={AlertTriangle} title="Lookup failed" hint={people.err} />}
        {people.status === 'done' && people.contacts.length === 0 && <EmptyState icon={Users} title="No people found" hint={people.err || 'Add Hunter/PDL/SerpAPI keys for richer contact and referral results.'} />}
        {people.status === 'done' && people.contacts.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {people.contacts.map((c, i) => (
              <Card key={i} className="flex flex-col gap-2 p-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-aurora-cta text-sm font-semibold text-white">{(c.name || 'P')[0]}</span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{c.name || 'Public profile'}</p>
                    <p className="truncate text-xs text-slate-500">{c.title || c.position || c.contactType || 'Contact'} {c.company ? `• ${c.company}` : ''}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {c.email && <Badge tone="cyan"><Mail size={11} /> email</Badge>}
                  {(c.linkedin || c.url) && <Badge tone="violet"><Linkedin size={11} /> profile</Badge>}
                  {c.source && <Badge>{c.source}</Badge>}
                </div>
                {c.email && <p className="truncate font-mono text-xs text-slate-400">{c.email}</p>}
                <div className="mt-auto flex gap-2">
                  {(c.linkedin || c.url) && <a href={c.linkedin || c.url} target="_blank" rel="noreferrer"><Button size="sm" variant="soft">Open <ExternalLink size={13} /></Button></a>}
                  <Button size="sm" onClick={() => makeDraft(c)}><Sparkles size={13} /> Draft</Button>
                </div>
              </Card>
            ))}
          </div>
        )}
        {people.draft && (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-white">Outreach draft</p>
              <Button size="sm" variant="soft" onClick={copyDraft}>{people.copied ? <Check size={13} /> : <Copy size={13} />} {people.copied ? 'Copied' : 'Copy'}</Button>
            </div>
            <textarea value={people.draft} onChange={(e) => setPeople((p) => ({ ...p, draft: e.target.value }))} className="h-32 w-full resize-none rounded-lg border border-white/10 bg-ink-950/70 p-3 text-sm text-slate-200 outline-none" />
          </div>
        )}
      </Modal>
    </>
  );
}
