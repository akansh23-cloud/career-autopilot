// Guided Project Workspace — left section navigation.
import { LayoutDashboard, Eye, Network, Map, KanbanSquare, FolderTree, Plug, Database, FlaskConical, Rocket, BadgeCheck, Lightbulb } from 'lucide-react';
import { WORKSPACE_SECTIONS } from '../../lib/workspaceSelectors.js';

const ICONS = {
  overview: LayoutDashboard, visual: Eye, architecture: Network, roadmap: Map,
  tasks: KanbanSquare, files: FolderTree, apis: Plug, database: Database,
  tests: FlaskConical, deployment: Rocket, proof: BadgeCheck, patent: Lightbulb,
};

export default function WorkspaceSidebar({ active, onSelect, counts = {} }) {
  return (
    <nav className="flex shrink-0 gap-1 overflow-x-auto lg:w-52 lg:flex-col lg:overflow-visible">
      {WORKSPACE_SECTIONS.map((s) => {
        const Icon = ICONS[s.id] || LayoutDashboard;
        const isActive = active === s.id;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[13px] font-medium transition
              ${isActive ? 'bg-aurora-violet/14 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
          >
            <Icon size={16} className={isActive ? 'text-[#FFD49A]' : 'text-slate-500'} />
            <span className="whitespace-nowrap">{s.label}</span>
            {counts[s.id] != null && (
              <span className="ml-auto rounded-full bg-white/8 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{counts[s.id]}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
