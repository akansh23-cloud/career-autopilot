import { useState } from 'react';
import { ArrowLeft, Sparkles, Loader2 } from 'lucide-react';
import { Button, Badge } from '../../components/ui/kit.jsx';
import { SectionCard, PageIntro } from '../common.jsx';
import { Innovation } from '../../lib/innovation.js';
import { SourceEvidencePanel } from './panels.jsx';
import { ScoreBar, RouteBadge, SourceBadge } from './shared.jsx';

export default function ProblemClusterDetail({ cluster, dbOn, onBack, onGenerated, purpose, skills, difficulty }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [duplicateBlocked, setDuplicateBlocked] = useState(false);

  const generate = async () => {
    setBusy(true); setErr('');
    try {
      // Pass the cluster in the body so this works whether or not the DB persisted it.
      const clusterId = cluster.id || cluster.dedupeFingerprint || cluster.fingerprint || 'unsaved-cluster';
      const body = dbOn
        ? { purpose, skills, difficulty, allowDuplicate: duplicateBlocked }
        : { cluster, purpose, skills, difficulty, allowDuplicate: duplicateBlocked };
      const d = await Innovation.generateProject(clusterId, body);
      if (!d?.project) {
        setDuplicateBlocked(!!(d?.duplicate || d?.skipped));
        setErr(d?.message || 'A similar project already exists. Click Generate anyway to create another version.');
        return;
      }
      setDuplicateBlocked(false);
      onGenerated(d.project, d.persisted);
    } catch (e) { setErr(e?.message || 'Could not generate a project from this cluster.'); }
    finally { setBusy(false); }
  };

  const scores = [
    ['Evidence strength', cluster.evidenceStrengthScore],
    ['Severity', cluster.severityScore],
    ['Trend', cluster.trendScore],
    ['Build feasibility', cluster.buildFeasibilityScore],
    ['Portfolio value', cluster.portfolioValueScore],
    ['Research potential', cluster.researchPotentialScore],
    ['Patent potential', cluster.patentPotentialScore],
  ];

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] text-fg-secondary hover:text-fg"><ArrowLeft size={15} /> Back to clusters</button>

      <PageIntro
        eyebrow="Problem cluster"
        title={cluster.title}
        sub={cluster.summary}
        action={<Button onClick={generate} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}{duplicateBlocked ? 'Generate anyway' : 'Generate source-backed project'}</Button>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge sourceBacked={cluster.sourceBacked} sourcesUsed={cluster.signalCount} />
        <RouteBadge route={cluster.recommendedRoute} />
        {cluster.domain && <Badge tone="default">{cluster.domain}</Badge>}
        {cluster.technology && <Badge tone="default">{cluster.technology}</Badge>}
        {cluster.targetUser && <Badge tone="default">{cluster.targetUser}</Badge>}
      </div>

      {err && <p className="text-[13px] text-rose-300">{err}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Opportunity scores" eyebrow="Deterministic · backend-owned">
          <div className="grid gap-2.5">
            {scores.map(([l, v]) => <ScoreBar key={l} label={l} value={v} />)}
          </div>
          {cluster.keywords?.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Signal keywords</h4>
              <div className="flex flex-wrap gap-1.5">{cluster.keywords.slice(0, 12).map((k) => <Badge key={k} tone="default">{k}</Badge>)}</div>
            </div>
          )}
        </SectionCard>

        <SourceEvidencePanel cluster={cluster} />
      </div>
    </div>
  );
}
