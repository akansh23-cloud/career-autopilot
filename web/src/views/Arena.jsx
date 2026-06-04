import { useEffect, useState } from 'react';
import { Trophy, Search, ExternalLink, MapPin, Award, Zap, Calendar } from 'lucide-react';
import { PageIntro } from './common.jsx';
import { Button, Input, Badge, Skeleton, EmptyState, Card } from '../components/ui/kit.jsx';
import { Opportunities } from '../lib/api.js';

const FILTERS = ['All', 'Hackathon', 'Hiring challenge', 'Coding contest'];

function opportunityUrl(o) {
  const u = o.registrationUrl || o.url || o.sourceUrl || '';
  if (!u) return '';
  const q = encodeURIComponent(o.title || o.platform || 'competition');
  if (/^https?:\/\/[^/]+\/?$/i.test(u)) return `https://www.google.com/search?q=${q}+${encodeURIComponent(o.platform || 'competition')}`;
  if (/unstop\.com\/competitions\/?$/i.test(u)) return `${u}?search=${q}`;
  if (/hackerearth\.com\/challenges\/?$/i.test(u)) return `https://www.hackerearth.com/challenges/?search=${q}`;
  if (/kaggle\.com\/competitions\/?$/i.test(u)) return `${u}?search=${q}`;
  if (/topcoder\.com\/challenges\/?$/i.test(u)) return `${u}?search=${q}`;
  return u;
}

export default function Arena() {
  const [kw, setKw] = useState('');
  const [filter, setFilter] = useState('All');
  const [state, setState] = useState({ status: 'loading', items: [], err: null });

  const load = async (keyword = '') => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const d = await Opportunities.search(keyword ? { keyword } : {});
      setState({ status: 'done', items: d.opportunities || [], err: d.ok === false ? d.error : null });
    } catch (e) { setState({ status: 'error', items: [], err: e.message }); }
  };
  useEffect(() => { load(); }, []);

  const items = state.items.filter((o) => filter === 'All' || (o.type || '').toLowerCase().includes(filter.toLowerCase().split(' ')[0]));

  return (
    <>
      <PageIntro title="Opportunity Arena" sub="Hackathons, hiring challenges & contests that turn into real offers." />

      <form onSubmit={(e) => { e.preventDefault(); load(kw); }} className="gradient-border mb-6 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="Search e.g. AI, DevOps, data science" className="pl-10" />
          </div>
          <Button type="submit" disabled={state.status === 'loading'}><Search size={16} /> Search</Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1 text-xs transition ${filter === f ? 'bg-aurora-violet/15 text-white ring-1 ring-aurora-violet/30' : 'text-slate-400 hover:bg-white/5'}`}>{f}</button>
          ))}
        </div>
      </form>

      {state.status === 'loading' && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-2xl" />)}</div>}
      {state.status === 'error' && <EmptyState icon={Trophy} title="Couldn’t load" hint={state.err} action={<Button size="sm" onClick={() => load()}>Retry</Button>} />}
      {state.status === 'done' && items.length === 0 && <EmptyState icon={Trophy} title="No opportunities" hint="Try a different keyword or filter." />}
      {state.status === 'done' && items.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((o, i) => (
            <Card key={i} hover className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[15px] font-semibold leading-snug text-white">{o.title}</h3>
                {o.hiringOpportunity && <Badge tone="mint"><Zap size={11} /> Hiring</Badge>}
              </div>
              <p className="flex items-center gap-1.5 text-xs text-slate-500">{o.organizer || o.platform || o.source}</p>
              {o.description && <p className="line-clamp-3 text-[13px] leading-relaxed text-slate-400">{o.description}</p>}
              <div className="flex flex-wrap gap-2">
                {o.mode && <Badge tone="violet">{o.mode}</Badge>}
                {o.location && <Badge><MapPin size={11} /> {o.location}</Badge>}
                {o.prize && <Badge tone="amber"><Award size={11} /> {String(o.prize).slice(0, 22)}</Badge>}
                {o.deadline && <Badge tone="cyan"><Calendar size={11} /> {o.deadline}</Badge>}
              </div>
              {o.skills?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">{o.skills.slice(0, 4).map((s) => <span key={s} className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">{s}</span>)}</div>
              )}
              <a href={opportunityUrl(o)} target="_blank" rel="noreferrer" className="mt-auto">
                <Button size="sm" variant="soft" className="w-full">Open registration <ExternalLink size={14} /></Button>
              </a>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
