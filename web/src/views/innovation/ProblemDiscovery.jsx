import { useState } from 'react';
import { Search, Loader2, Plus, X, AlertTriangle } from 'lucide-react';
import { Button, Field, Input, Badge } from '../../components/ui/kit.jsx';
import { SectionCard } from '../common.jsx';
import { DOMAINS, TARGET_USERS, TECHNOLOGIES, GOALS } from '../patent/shared.jsx';
import { PURPOSES, SOURCES, DIFFICULTIES, COMMUNITY_SOURCE_LIST, COMMUNITY_WARNING, TIME_RANGES } from './shared.jsx';

const selCls = 'h-11 w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm text-slate-100 outline-none focus:border-aurora-violet/50';

function Select({ label, value, onChange, options, placeholder }) {
  return (
    <Field label={label}>
      <select value={value} onChange={onChange} className={selCls}>
        <option value="">{placeholder || 'Any'}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </Field>
  );
}

// `config` is optional; when provided it reflects which community sources are
// actually enabled server-side so we can show accurate disabled notes.
export default function ProblemDiscovery({ onDiscover, busy, config = {} }) {
  const [form, setForm] = useState({ domain: '', targetUser: '', technology: '', goal: '', difficulty: '', purpose: 'portfolio', timeRange: '' });
  const [skills, setSkills] = useState([]);
  const [skillInput, setSkillInput] = useState('');
  const [sources, setSources] = useState(['github', 'stackexchange', 'arxiv']);
  const [manual, setManual] = useState([]);
  const [manualInput, setManualInput] = useState('');
  const [comm, setComm] = useState({ redditSubreddits: '', discourseForums: '', specializedForums: '', devtoTags: '', hashnodeTags: '', hackerNewsQuery: '' });
  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const cs = config.communitySources || {};

  const toggleSource = (id) => setSources((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const addSkill = () => { const v = skillInput.trim(); if (v && !skills.includes(v)) setSkills([...skills, v]); setSkillInput(''); };
  const addManual = () => { const v = manualInput.trim(); if (v) setManual([...manual, { title: v }]); setManualInput(''); };
  const csv = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

  const communitySelected = sources.some((s) => COMMUNITY_SOURCE_LIST.some((c) => c.id === s));

  const run = () => onDiscover({
    ...form, skills, sources,
    manualProblems: sources.includes('manual') ? manual : [],
    communities: {
      redditSubreddits: csv(comm.redditSubreddits), discourseForums: csv(comm.discourseForums),
      specializedForums: csv(comm.specializedForums), devtoTags: csv(comm.devtoTags),
      hashnodeTags: csv(comm.hashnodeTags), hackerNewsQuery: comm.hackerNewsQuery.trim(),
    },
    limit: 24,
  });

  return (
    <SectionCard title="Discover real problems" eyebrow="Source-backed discovery">
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        <Select label="Domain / industry" value={form.domain} onChange={f('domain')} options={DOMAINS} />
        <Select label="Target user" value={form.targetUser} onChange={f('targetUser')} options={TARGET_USERS} />
        <Select label="Technology" value={form.technology} onChange={f('technology')} options={TECHNOLOGIES} />
        <Select label="Goal" value={form.goal} onChange={f('goal')} options={GOALS} />
        <Select label="Difficulty" value={form.difficulty} onChange={f('difficulty')} options={DIFFICULTIES} />
        <Field label="Purpose">
          <select value={form.purpose} onChange={f('purpose')} className={selCls}>
            {PURPOSES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Your skills (optional — shapes feasibility & generated project)">
          <div className="flex gap-2">
            <Input value={skillInput} onChange={(e) => setSkillInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSkill())} placeholder="e.g. React, Python…" />
            <Button variant="soft" size="sm" onClick={addSkill}><Plus size={14} /></Button>
          </div>
        </Field>
        {skills.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {skills.map((s) => <button key={s} onClick={() => setSkills(skills.filter((x) => x !== s))} className="group"><Badge tone="cyan">{s} <X size={11} className="opacity-60 group-hover:opacity-100" /></Badge></button>)}
          </div>
        )}
      </div>

      {/* Core sources */}
      <div className="mt-4">
        <span className="mb-1.5 block text-[13px] font-medium text-slate-300">Core sources</span>
        <div className="flex flex-wrap gap-2">
          {SOURCES.map((s) => (
            <button key={s.id} onClick={() => toggleSource(s.id)}>
              <Badge tone={sources.includes(s.id) ? 'violet' : 'default'}>{s.label}</Badge>
            </button>
          ))}
        </div>
      </div>

      {/* Community sources */}
      <div className="mt-4">
        <span className="mb-1.5 block text-[13px] font-medium text-slate-300">Community sources</span>
        <div className="flex flex-wrap gap-2">
          {COMMUNITY_SOURCE_LIST.map((s) => (
            <button key={s.id} onClick={() => toggleSource(s.id)} title={s.note}>
              <Badge tone={sources.includes(s.id) ? 'amber' : 'default'}>{s.label}</Badge>
            </button>
          ))}
        </div>
        {communitySelected && (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-glow/30 bg-amber-glow/[0.06] p-2.5 text-[12px] text-[#FFE0A0]">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{COMMUNITY_WARNING}</span>
          </div>
        )}
        {sources.includes('reddit') && cs.reddit && !cs.reddit.enabled && (
          <p className="mt-1.5 text-[12px] text-rose-300">{cs.reddit.note || 'Reddit source is disabled. Add official Reddit API credentials and enable REDDIT_DISCOVERY_ENABLED=1.'}</p>
        )}
        {sources.includes('specialized_forum') && (
          <p className="mt-1.5 text-[12px] text-slate-400">Specialized forums must be allowlisted via SPECIALIZED_FORUM_ALLOWED_SOURCES.</p>
        )}
      </div>

      {/* Community sub-inputs (progressive disclosure) */}
      {communitySelected && (
        <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
          {sources.includes('reddit') && <Field label="Subreddits (comma-separated, optional)"><Input value={comm.redditSubreddits} onChange={(e) => setComm({ ...comm, redditSubreddits: e.target.value })} placeholder="devops, kubernetes" /></Field>}
          {sources.includes('hackernews') && <Field label="Hacker News query (optional)"><Input value={comm.hackerNewsQuery} onChange={(e) => setComm({ ...comm, hackerNewsQuery: e.target.value })} placeholder="deployment debugging" /></Field>}
          {sources.includes('discourse') && <Field label="Discourse forums (allowlisted URLs)"><Input value={comm.discourseForums} onChange={(e) => setComm({ ...comm, discourseForums: e.target.value })} placeholder="https://forum.example.com" /></Field>}
          {sources.includes('devto') && <Field label="Dev.to tags (optional)"><Input value={comm.devtoTags} onChange={(e) => setComm({ ...comm, devtoTags: e.target.value })} placeholder="devops, webdev" /></Field>}
          {sources.includes('hashnode') && <Field label="Hashnode tags (optional)"><Input value={comm.hashnodeTags} onChange={(e) => setComm({ ...comm, hashnodeTags: e.target.value })} placeholder="kubernetes" /></Field>}
          {sources.includes('specialized_forum') && <Field label="Specialized forums (allowlisted)"><Input value={comm.specializedForums} onChange={(e) => setComm({ ...comm, specializedForums: e.target.value })} placeholder="agriculture-forum" /></Field>}
        </div>
      )}

      <div className="mt-4 max-w-xs">
        <Field label="Time range">
          <select value={form.timeRange} onChange={f('timeRange')} className={selCls}>
            {TIME_RANGES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
      </div>

      {sources.includes('manual') && (
        <div className="mt-4">
          <Field label="Manual problem statements (fallback)">
            <div className="flex gap-2">
              <Input value={manualInput} onChange={(e) => setManualInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addManual())} placeholder="Describe a real problem you've seen…" />
              <Button variant="soft" size="sm" onClick={addManual}><Plus size={14} /></Button>
            </div>
          </Field>
          {manual.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{manual.map((m, i) => <button key={i} onClick={() => setManual(manual.filter((_, j) => j !== i))}><Badge tone="mint">{m.title} <X size={11} /></Badge></button>)}</div>}
        </div>
      )}

      <div className="mt-5">
        <Button onClick={run} disabled={busy || sources.length === 0}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          Discover problems
        </Button>
      </div>
    </SectionCard>
  );
}
