import { useState } from 'react';
import { ArrowLeft, Boxes, IndianRupee, ScrollText, Search, FileStack } from 'lucide-react';
import { Badge } from '../../components/ui/kit.jsx';
import { SectionCard, PageIntro } from '../common.jsx';
import { SourceBadge } from './shared.jsx';
import {
  BuildBlueprintPanel, FeasibilityCostPanel, IPReadinessPanel,
  PriorArtWorkspace, DisclosurePackagePanel, ConvertButtons,
} from './panels.jsx';

const TABS = [
  { id: 'blueprint', label: 'Build blueprint', Icon: Boxes },
  { id: 'cost', label: 'Feasibility & cost', Icon: IndianRupee },
  { id: 'ip', label: 'IP readiness', Icon: ScrollText },
  { id: 'priorart', label: 'Prior-art', Icon: Search },
  { id: 'disclosure', label: 'Disclosure', Icon: FileStack },
];

function FramingRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="border-t border-white/6 py-2.5 first:border-t-0 first:pt-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-300">{value}</p>
    </div>
  );
}

export default function GeneratedProjectWorkspace({ project, projectId, persisted, dbOn, onBack, go }) {
  const [tab, setTab] = useState('blueprint');
  const [ipRefresh, setIpRefresh] = useState(0);
  const fr = project.framing || {};

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] text-slate-400 hover:text-white"><ArrowLeft size={15} /> Back</button>

      <PageIntro eyebrow="Generated project" title={project.title} sub={project.proposedSolution} />
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge sourceBacked={project.sourceBacked} sourcesUsed={project.sourcesUsed} />
        {project.domain && <Badge tone="default">{project.domain}</Badge>}
        {project.difficulty && <Badge tone="violet">{project.difficulty}</Badge>}
        {project.confidence === 'low' && <Badge tone="amber">Low-confidence draft</Badge>}
        {!persisted && <Badge tone="amber">Not saved (DB off)</Badge>}
      </div>

      <SectionCard title="Why this is worth building" eyebrow="Framing & curiosity">
        <div className="divide-y divide-white/6">
          <FramingRow label="The pain" value={fr.painPoint || project.painPoint} />
          <FramingRow label="Who faces it" value={fr.whoFacesIt || project.affectedUsers} />
          <FramingRow label="Today's broken workaround" value={fr.brokenWorkaround || project.currentWorkaround} />
          <FramingRow label="Why existing tools fall short" value={fr.whyExistingNotEnough || project.whyExistingSolutionsFail} />
          <FramingRow label="Why it matters now" value={fr.whyItMattersNow || project.whyNow} />
          <FramingRow label="What to build" value={fr.whatToBuild || project.proposedSolution} />
          <FramingRow label="Why it's technically interesting" value={fr.whyInteresting} />
          <FramingRow label="The technical challenge" value={fr.technicalChallenge || project.noveltyAngle} />
          <FramingRow label="The demo moment" value={fr.demoMoment} />
          <FramingRow label="Possible IP angle" value={fr.ipAngle} />
        </div>
        {project.mvpScope?.length > 0 && (
          <div className="mt-4">
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">MVP scope</h4>
            <ul className="space-y-1 text-[13px] text-slate-300">{project.mvpScope.map((m, i) => <li key={i} className="flex gap-2"><span className="text-slate-600">•</span>{m}</li>)}</ul>
          </div>
        )}
        {project.sourceCitations?.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {project.sourceCitations.map((s, i) => <Badge key={i} tone="cyan">{s.source}: {s.title?.slice(0, 40)}</Badge>)}
          </div>
        )}
      </SectionCard>

      <ConvertButtons project={project} projectId={projectId} persisted={persisted} go={go} />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.Icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[13px] font-medium transition ${tab === t.id ? 'border-aurora-violet/45 bg-aurora-violet/12 text-white' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'blueprint' && <BuildBlueprintPanel project={project} projectId={projectId} persisted={persisted} />}
      {tab === 'cost' && <FeasibilityCostPanel project={project} projectId={projectId} persisted={persisted} />}
      {tab === 'ip' && <IPReadinessPanel project={project} projectId={projectId} persisted={persisted} refreshKey={ipRefresh} />}
      {tab === 'priorart' && <PriorArtWorkspace project={project} projectId={projectId} persisted={persisted} onChange={() => setIpRefresh((n) => n + 1)} />}
      {tab === 'disclosure' && <DisclosurePackagePanel project={project} projectId={projectId} persisted={persisted} />}
    </div>
  );
}
