// Architecture Diagram OS — view tab strip.
import {
  Users, Boxes, Cloud, Workflow, ShieldCheck, GitBranch, Activity, TrendingUp, FileText,
} from 'lucide-react';
import { VIEW_LABELS } from '../../lib/architectureSpec.js';

const VIEW_ICONS = {
  systemContext: Users,
  container: Boxes,
  deployment: Cloud,
  dataFlow: Workflow,
  security: ShieldCheck,
  cicd: GitBranch,
  observability: Activity,
  scalingFailure: TrendingUp,
  patentFigure: FileText,
};

export default function ArchitectureTabs({ views = [], activeId, onSelect }) {
  if (!views.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {views.map((v) => {
        const Icon = VIEW_ICONS[v.type] || Boxes;
        const active = activeId === v.id || activeId === v.type;
        return (
          <button
            key={v.id || v.type}
            onClick={() => onSelect?.(v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
              active
                ? 'border-aurora-violet/60 bg-aurora-violet/10 text-fg'
                : 'border-subtle bg-surface-1 text-fg-secondary hover:border-strong'
            }`}
          >
            <Icon size={13} /> {VIEW_LABELS[v.type] || v.title || v.type}
          </button>
        );
      })}
    </div>
  );
}
