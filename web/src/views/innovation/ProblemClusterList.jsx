import { Card, Badge, EmptyState } from '../../components/ui/kit.jsx';
import { Layers, ArrowRight } from 'lucide-react';
import { RouteBadge, SourceBadge, scoreTone } from './shared.jsx';

function Mini({ label, value }) {
  return (
    <div className="text-center">
      <div className="text-sm font-semibold text-fg"><Badge tone={scoreTone(value)}>{value}</Badge></div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-fg-muted">{label}</div>
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
            <h3 className="font-display text-[15px] font-semibold leading-snug text-fg">{c.title}</h3>
            <ArrowRight size={16} className="mt-1 shrink-0 text-fg-muted" />
          </div>
          <p className="mt-1.5 line-clamp-2 text-[13px] text-fg-secondary">{c.summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SourceBadge sourceBacked={c.sourceBacked} sourcesUsed={c.signalCount} />
            <RouteBadge route={c.recommendedRoute} />
            {c.domain && <Badge tone="default">{c.domain}</Badge>}
            {c.communitySignalCount > 0 && <Badge tone="amber">{c.communitySignalCount} community</Badge>}
            {c.corroborated
              ? <Badge tone="mint">Corroborated</Badge>
              : (c.validationNeeded && <Badge tone="amber">Validation needed</Badge>)}
            {c.privacySafe && <Badge tone="default">Privacy-safe</Badge>}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-subtle pt-3">
            <Mini label="Evidence" value={c.evidenceStrengthScore} />
            <Mini label="Severity" value={c.severityScore} />
            <Mini label="Feasibility" value={c.buildFeasibilityScore} />
          </div>
        </Card>
      ))}
    </div>
  );
}
