import { Badge } from '../../components/ui/kit.jsx';
import { AlertTriangle, ShieldCheck, FlaskConical, Rocket, Briefcase, ScrollText } from 'lucide-react';

export const PURPOSES = [
  { id: 'portfolio', label: 'Portfolio piece' },
  { id: 'startup', label: 'Startup MVP' },
  { id: 'research', label: 'Research' },
  { id: 'patent-readiness', label: 'Patent-readiness' },
];

export const SOURCES = [
  { id: 'github', label: 'GitHub issues' },
  { id: 'github_discussions', label: 'GitHub discussions' },
  { id: 'stackexchange', label: 'Stack Exchange' },
  { id: 'arxiv', label: 'arXiv' },
  { id: 'manual', label: 'Manual problems' },
];

export const COMMUNITY_SOURCE_LIST = [
  { id: 'reddit', label: 'Reddit', note: 'Official API only. Needs REDDIT_DISCOVERY_ENABLED=1 + credentials.' },
  { id: 'hackernews', label: 'Hacker News', note: 'Public API (keyless).' },
  { id: 'discourse', label: 'Discourse forums', note: 'Only allowlisted base URLs are queried.' },
  { id: 'devto', label: 'Dev.to', note: 'Public API.' },
  { id: 'hashnode', label: 'Hashnode', note: 'Public API.' },
  { id: 'specialized_forum', label: 'Specialized forums', note: 'Allowlist required.' },
];

export const COMMUNITY_WARNING = 'Community discussions are early signals, not verified evidence. Use them for problem discovery, then validate with technical sources, prior-art search, and prototype evidence.';

export const TIME_RANGES = [
  { id: '', label: 'Any time' }, { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' }, { id: '1y', label: 'Last year' }, { id: 'all', label: 'All time' },
];

export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced', 'research-grade', 'startup-grade'];

export const ROUTE_META = {
  portfolio: { label: 'Portfolio', tone: 'cyan', Icon: Briefcase },
  startup: { label: 'Startup', tone: 'mint', Icon: Rocket },
  research: { label: 'Research', tone: 'violet', Icon: FlaskConical },
  'patent-review': { label: 'Patent review', tone: 'amber', Icon: ScrollText },
  'not-recommended': { label: 'Not recommended', tone: 'rose', Icon: AlertTriangle },
};

export function scoreTone(n) {
  return n >= 80 ? 'mint' : n >= 60 ? 'cyan' : n >= 45 ? 'violet' : n >= 30 ? 'amber' : 'rose';
}

export function RouteBadge({ route }) {
  const m = ROUTE_META[route] || ROUTE_META.portfolio;
  const Icon = m.Icon;
  return <Badge tone={m.tone}><Icon size={12} /> {m.label}</Badge>;
}

export function SourceBadge({ sourceBacked, sourcesUsed }) {
  return sourceBacked
    ? <Badge tone="mint"><ShieldCheck size={12} /> Source-backed · {sourcesUsed}</Badge>
    : <Badge tone="amber"><AlertTriangle size={12} /> Fallback draft</Badge>;
}

export function ScoreBar({ label, value, tone }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const t = tone || scoreTone(v);
  const bar = { mint: 'bg-aurora-mint', cyan: 'bg-aurora-cyan', violet: 'bg-aurora-violet', amber: 'bg-amber-glow', rose: 'bg-rose-400' }[t];
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-slate-400">{label}</span>
        <span className="font-semibold text-slate-200">{v}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

export function ModeBanner({ mode, aiProvider, warnings = [] }) {
  if (mode !== 'limited/fallback' && !warnings.length) return null;
  const limited = mode === 'limited/fallback';
  return (
    <div className={`rounded-xl border p-3 text-[12.5px] ${limited ? 'border-amber-glow/35 bg-amber-glow/[0.06] text-[#F3E3B2]' : 'border-white/10 bg-white/[0.03] text-slate-300'}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
        <div>
          {limited && <p className="font-semibold">Limited / fallback mode{aiProvider ? ` (${aiProvider})` : ''} — output is deterministic and labelled low-confidence.</p>}
          {warnings.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-400">
              {warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function NotLegalAdvice({ text }) {
  return (
    <p className="text-[11px] leading-relaxed text-amber-glow/80">
      {text || 'Not legal advice and not a final patent application — an invention disclosure draft for faculty / IP-cell / patent-agent review.'}
    </p>
  );
}
