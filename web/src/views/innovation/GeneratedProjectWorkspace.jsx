import { useState } from 'react';
import {
  ArrowLeft, Boxes, IndianRupee, ScrollText, Search, FileStack,
  Lightbulb, Database, Users, Brain, ShieldAlert, FlaskConical, Image, GitCompare, Gavel,
} from 'lucide-react';
import { Badge } from '../../components/ui/kit.jsx';
import { SectionCard, PageIntro } from '../common.jsx';
import { SourceBadge, ScoreBar } from './shared.jsx';
import {
  BuildBlueprintPanel, FeasibilityCostPanel, IPReadinessPanel,
  PriorArtWorkspace, DisclosurePackagePanel, ConvertButtons,
  SimpleExplanationPanel, IndiaCriPanel, PriorArtSearchPlanPanel, ClaimDirectionsPanel,
  PrototypeEvidencePanel, ConfidentialityPanel, DiagramPlanPanel, ExperimentPlanPanel, SimilarMemoryPanel,
} from './panels.jsx';

const COMMUNITY = ['reddit', 'hackernews', 'discourse', 'devto', 'hashnode', 'specialized_forum'];

const TABS = [
  { id: 'simple', label: 'Simple explanation', Icon: Lightbulb },
  { id: 'evidence', label: 'Problem evidence', Icon: Database },
  { id: 'community', label: 'Community signals', Icon: Users },
  { id: 'similar', label: 'Similar memory', Icon: Brain },
  { id: 'blueprint', label: 'Build blueprint', Icon: Boxes },
  { id: 'cost', label: 'Cost & team', Icon: IndianRupee },
  { id: 'ip', label: 'IP readiness', Icon: ScrollText },
  { id: 'cri', label: 'India CRI / 3(k)', Icon: Gavel },
  { id: 'priorart', label: 'Prior art', Icon: Search },
  { id: 'searchplan', label: 'Prior-art search plan', Icon: GitCompare },
  { id: 'claims', label: 'Claim directions', Icon: ScrollText },
  { id: 'proto', label: 'Prototype evidence', Icon: FileStack },
  { id: 'confidential', label: 'Confidentiality', Icon: ShieldAlert },
  { id: 'diagrams', label: 'Diagrams', Icon: Image },
  { id: 'experiments', label: 'Experiments', Icon: FlaskConical },
  { id: 'disclosure', label: 'Disclosure', Icon: FileStack },
];

function FramingRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="border-t border-white/6 py-2.5 first:border-t-0 first:pt-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</div>
      <p className="mt-1 text-[13px] leading-relaxed text-fg-secondary">{value}</p>
    </div>
  );
}

function SourceMix({ citations = [] }) {
  const counts = {};
  for (const c of citations) counts[c.source] = (counts[c.source] || 0) + 1;
  const keys = Object.keys(counts);
  if (!keys.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {keys.map((k) => <Badge key={k} tone={COMMUNITY.includes(k) ? 'amber' : 'cyan'}>{k}: {counts[k]}</Badge>)}
    </div>
  );
}

export default function GeneratedProjectWorkspace({ project, projectId, persisted, dbOn, onBack, go }) {
  const [tab, setTab] = useState('simple');
  const [ipRefresh, setIpRefresh] = useState(0);
  const fr = project.framing || {};
  const cites = project.sourceCitations || [];
  const communityCites = cites.filter((c) => COMMUNITY.includes(c.source));
  const communityOnly = cites.length > 0 && cites.every((c) => COMMUNITY.includes(c.source));
  const distinctTypes = new Set(cites.map((c) => c.source)).size;
  const buildClarity = project.simplified?.clarityScores?.buildClarity;
  const ip = project.ipReadiness;

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] text-fg-secondary hover:text-fg"><ArrowLeft size={15} /> Back</button>

      <PageIntro eyebrow="Generated project" title={project.title} sub={project.simplified?.oneLineSummary || project.proposedSolution} />

      {/* Top summary */}
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge sourceBacked={project.sourceBacked} sourcesUsed={project.sourcesUsed} />
        {project.domain && <Badge tone="default">{project.domain}</Badge>}
        {project.difficulty && <Badge tone="violet">{project.difficulty}</Badge>}
        {ip?.label && <Badge tone={ip.overall >= 60 ? 'mint' : ip.overall >= 45 ? 'amber' : 'rose'}>{ip.label}{typeof ip.overall === 'number' ? ` · ${ip.overall}` : ''}</Badge>}
        {ip?.recommendedIPRoute && <Badge tone="cyan">Route: {ip.recommendedIPRoute}</Badge>}
        {project.confidence === 'low' && <Badge tone="amber">Low-confidence draft</Badge>}
        {!persisted && <Badge tone="amber">Not saved (DB off)</Badge>}
      </div>

      {(communityOnly || distinctTypes >= 2 || cites.length > 0) && (
        <div className="rounded-2xl border border-subtle bg-surface-1 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SourceMix citations={cites} />
            {communityOnly
              ? <Badge tone="amber">Early community signal — needs validation</Badge>
              : distinctTypes >= 2 ? <Badge tone="mint">Corroborated across sources</Badge> : null}
          </div>
          {communityOnly && (
            <p className="mt-2 text-[12px] text-[#F3E3B2]">Community discussions are early signals, not verified evidence. Validate with technical sources, a prior-art search, and prototype evidence before treating this as IP-worthy. IP-readiness is capped at 55 while evidence is community-only.</p>
          )}
          {typeof buildClarity === 'number' && (
            <div className="mt-3 max-w-xs"><ScoreBar label="Build clarity" value={buildClarity} /></div>
          )}
        </div>
      )}

      <SectionCard title="Why this is worth building" eyebrow="Framing & curiosity">
        <div className="divide-y divide-white/6">
          <FramingRow label="The pain" value={fr.painPoint || project.painPoint} />
          <FramingRow label="Who faces it" value={fr.whoFacesIt || project.affectedUsers} />
          <FramingRow label="Today's broken workaround" value={fr.brokenWorkaround || project.currentWorkaround} />
          <FramingRow label="Why existing tools fall short" value={fr.whyExistingNotEnough || project.whyExistingSolutionsFail} />
          <FramingRow label="Why it matters now" value={fr.whyItMattersNow || project.whyNow} />
          <FramingRow label="What to build" value={fr.whatToBuild || project.proposedSolution} />
          <FramingRow label="The technical challenge" value={fr.technicalChallenge || project.noveltyAngle} />
        </div>
        {project.mvpScope?.length > 0 && (
          <div className="mt-4">
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">MVP scope</h4>
            <ul className="space-y-1 text-[13px] text-fg-secondary">{project.mvpScope.map((m, i) => <li key={i} className="flex gap-2"><span className="text-fg-muted">•</span>{m}</li>)}</ul>
          </div>
        )}
      </SectionCard>

      <ConvertButtons project={project} projectId={projectId} persisted={persisted} go={go} />

      {/* Scrollable tab bar (progressive disclosure) */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.Icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12.5px] font-medium transition ${tab === t.id ? 'border-aurora-violet/45 bg-aurora-violet/12 text-fg' : 'border-subtle text-fg-secondary hover:bg-surface-1'}`}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'simple' && <SimpleExplanationPanel project={project} projectId={projectId} persisted={persisted} />}
      {tab === 'evidence' && <ProblemEvidence cites={cites} project={project} />}
      {tab === 'community' && <CommunitySignals cites={communityCites} />}
      {tab === 'similar' && <SimilarMemoryPanel projectId={projectId} />}
      {tab === 'blueprint' && <BuildBlueprintPanel project={project} projectId={projectId} persisted={persisted} />}
      {tab === 'cost' && <FeasibilityCostPanel project={project} projectId={projectId} persisted={persisted} />}
      {tab === 'ip' && <IPReadinessPanel project={project} projectId={projectId} persisted={persisted} refreshKey={ipRefresh} />}
      {tab === 'cri' && <IndiaCriPanel project={project} projectId={projectId} persisted={persisted} />}
      {tab === 'priorart' && <PriorArtWorkspace project={project} projectId={projectId} persisted={persisted} onChange={() => setIpRefresh((n) => n + 1)} />}
      {tab === 'searchplan' && <PriorArtSearchPlanPanel project={project} projectId={projectId} persisted={persisted} />}
      {tab === 'claims' && <ClaimDirectionsPanel project={project} projectId={projectId} persisted={persisted} />}
      {tab === 'proto' && <PrototypeEvidencePanel project={project} projectId={projectId} persisted={persisted} onChange={() => setIpRefresh((n) => n + 1)} />}
      {tab === 'confidential' && <ConfidentialityPanel project={project} projectId={projectId} persisted={persisted} />}
      {tab === 'diagrams' && <DiagramPlanPanel project={project} projectId={projectId} persisted={persisted} />}
      {tab === 'experiments' && <ExperimentPlanPanel project={project} projectId={projectId} persisted={persisted} />}
      {tab === 'disclosure' && <DisclosurePackagePanel project={project} projectId={projectId} persisted={persisted} />}
    </div>
  );
}

function ProblemEvidence({ cites = [], project }) {
  return (
    <SectionCard title="Problem evidence" eyebrow={`${cites.length} source citation(s)`}>
      {cites.length === 0
        ? <p className="text-[13px] text-fg-muted">No source citations captured (fallback draft or DB off).</p>
        : (
          <ul className="space-y-2">
            {cites.map((s, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border border-subtle bg-surface-1 p-2.5">
                <Badge tone={COMMUNITY.includes(s.source) ? 'amber' : 'cyan'}>{s.source}</Badge>
                <span className="flex-1 text-[13px] text-fg-secondary">{s.title}</span>
                {s.url && <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-aurora-cyan hover:text-fg">↗</a>}
              </li>
            ))}
          </ul>
        )}
    </SectionCard>
  );
}

function CommunitySignals({ cites = [] }) {
  return (
    <SectionCard title="Community signals" eyebrow="Early signals — not verified facts">
      <div className="mb-3 rounded-xl border border-amber-glow/30 bg-amber-glow/[0.06] p-2.5 text-[12px] text-[#F3E3B2]">
        Community discussions are early pain signals, never verified market proof. Usernames are never stored or shown. Strong recommendations require corroboration from technical sources.
      </div>
      {cites.length === 0
        ? <p className="text-[13px] text-fg-muted">No community signals contributed to this project.</p>
        : (
          <ul className="space-y-2">
            {cites.map((s, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border border-subtle bg-surface-1 p-2.5">
                <Badge tone="amber">{s.source}</Badge>
                <span className="flex-1 text-[13px] text-fg-secondary">{s.title}</span>
                {s.url && <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-aurora-cyan hover:text-fg">↗</a>}
              </li>
            ))}
          </ul>
        )}
    </SectionCard>
  );
}
