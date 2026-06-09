import { useState, useEffect } from 'react';
import { Lightbulb } from 'lucide-react';
import { PageIntro, SectionCard, StatCard } from '../common.jsx';
import { Spinner } from '../../components/ui/kit.jsx';
import { Innovation } from '../../lib/innovation.js';
import { ModeBanner, NotLegalAdvice } from './shared.jsx';
import ProblemDiscovery from './ProblemDiscovery.jsx';
import ProblemClusterList from './ProblemClusterList.jsx';
import ProblemClusterDetail from './ProblemClusterDetail.jsx';
import GeneratedProjectWorkspace from './GeneratedProjectWorkspace.jsx';

export default function InnovationOS({ go }) {
  const [cfg, setCfg] = useState(null);
  const [cfgErr, setCfgErr] = useState('');
  const [step, setStep] = useState('discover'); // discover | detail | workspace
  const [busy, setBusy] = useState(false);

  const [discovery, setDiscovery] = useState(null); // { clusters, mode, warnings, aiProvider, db, signalsCount }
  const [activeCluster, setActiveCluster] = useState(null);
  const [project, setProject] = useState(null);
  const [projectMeta, setProjectMeta] = useState({ id: '', persisted: false });
  const [lastInput, setLastInput] = useState({ purpose: 'portfolio', skills: [], difficulty: '' });

  useEffect(() => {
    let alive = true;
    Innovation.config()
      .then((c) => { if (alive) setCfg(c); })
      .catch((e) => { if (alive) setCfgErr(e?.message || 'Innovation OS is unavailable.'); });
    return () => { alive = false; };
  }, []);

  const dbOn = !!(discovery?.db ?? cfg?.db);

  const runDiscover = async (input) => {
    setBusy(true);
    setLastInput({ purpose: input.purpose, skills: input.skills, difficulty: input.difficulty });
    try {
      const d = await Innovation.discover(input);
      setDiscovery(d);
    } catch (e) {
      setDiscovery({ clusters: [], warnings: [e?.message || 'Discovery failed.'], mode: 'error' });
    } finally { setBusy(false); }
  };

  const openCluster = (c) => { setActiveCluster(c); setStep('detail'); };
  const onGenerated = (p, persisted) => {
    setProject(p);
    setProjectMeta({ id: p.id || p.fingerprint, persisted: !!persisted });
    setStep('workspace');
  };

  if (cfgErr) {
    return (
      <div className="space-y-5">
        <PageIntro eyebrow="Innovation OS" title="Innovation & Patent Intelligence" />
        <SectionCard title="Unavailable"><p className="text-[13px] text-rose-300">{cfgErr}</p></SectionCard>
      </div>
    );
  }
  if (!cfg) {
    return <div className="flex items-center justify-center py-24"><Spinner className="h-6 w-6" /></div>;
  }

  return (
    <div className="space-y-6">
      <PageIntro
        eyebrow="Innovation OS"
        title="Innovation & Patent Intelligence"
        sub="Discover real, source-backed problems, turn them into buildable projects, and triage genuine patent potential — with honest scoring, never inflated."
      />

      {step === 'discover' && (
        <>
          <ModeBanner mode={discovery?.mode || cfg.mode} aiProvider={discovery?.aiProvider || cfg.aiProvider} warnings={discovery?.warnings || cfg.warnings} />

          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="AI mode" value={cfg.mode === 'full' ? 'Full' : 'Limited'} hint={cfg.aiProvider} />
            <StatCard label="Persistence" value={cfg.db ? 'Database on' : 'Limited (no DB)'} hint={cfg.db ? 'Clusters & projects saved' : 'State held in-session'} />
            <StatCard label="Signals last run" value={discovery ? String(discovery.signalsCount ?? 0) : '—'} hint={discovery ? `${(discovery.clusters || []).length} clusters` : 'Not run yet'} />
          </div>

          <ProblemDiscovery onDiscover={runDiscover} busy={busy} config={cfg} />

          {discovery && (
            <SectionCard title="Problem clusters" eyebrow={`${(discovery.clusters || []).length} found${discovery.communitySignalsCount ? ` · ${discovery.communitySignalsCount} community` : ''}`}>
              {(discovery.rag && discovery.rag.duplicateWarnings && discovery.rag.duplicateWarnings.length > 0) && (
                <div className="mb-3 rounded-xl border border-amber-glow/30 bg-amber-glow/[0.06] p-2.5 text-[12px] text-[#FFE0A0]">{discovery.rag.duplicateWarnings.join(' ')}</div>
              )}
              <ProblemClusterList clusters={discovery.clusters || []} onOpen={openCluster} />
            </SectionCard>
          )}

          <NotLegalAdvice />
        </>
      )}

      {step === 'detail' && activeCluster && (
        <ProblemClusterDetail
          cluster={activeCluster}
          dbOn={dbOn}
          purpose={lastInput.purpose}
          skills={lastInput.skills}
          difficulty={lastInput.difficulty}
          onBack={() => setStep('discover')}
          onGenerated={onGenerated}
        />
      )}

      {step === 'workspace' && project && (
        <GeneratedProjectWorkspace
          project={project}
          projectId={projectMeta.id}
          persisted={projectMeta.persisted}
          dbOn={dbOn}
          onBack={() => setStep(activeCluster ? 'detail' : 'discover')}
          go={go}
        />
      )}
    </div>
  );
}

InnovationOS.navIcon = Lightbulb;
