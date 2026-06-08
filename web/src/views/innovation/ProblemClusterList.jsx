import { Card, Badge, EmptyState } from '../../components/ui/kit.jsx';
import { Layers, ArrowRight } from 'lucide-react';
import { RouteBadge, SourceBadge, scoreTone } from './shared.jsx';

function Mini({ label, value }) {
  return (
    <div className="text-center">
      <div className="text-sm font-semibold text-slate-100"><Badge tone={scoreTone(value)}>{value}</Badge></div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

export default function ProblemClusterList({ clusters = [], onOpen }) {
  if (!clusters.length) {
    return <EmptyState icon={Layers} title="No clusters yet" hint="Run a discovery to surface source-backed problem clusters." />;
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {clusters.map((c) => (
        <Card key={c.id} hover className="cursor-pointer" onClick={() => onOpen(c)}>
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display text-[15px] font-semibold leading-snug text-slate-100">{c.title}</h3>
            <ArrowRight size={16} className="mt-1 shrink-0 text-slate-500" />
          </div>
          <p className="mt-1.5 line-clamp-2 text-[13px] text-slate-400">{c.summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SourceBadge sourceBacked={c.sourceBacked} sourcesUsed={c.signalCount} />
            <RouteBadge route={c.recommendedRoute} />
            {c.domain && <Badge tone="default">{c.domain}</Badge>}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/8 pt-3">
            <Mini label="Evidence" value={c.evidenceStrengthScore} />
            <Mini label="Severity" value={c.severityScore} />
            <Mini label="Feasibility" value={c.buildFeasibilityScore} />
          </div>
        </Card>
      ))}
    </div>
  );
}
