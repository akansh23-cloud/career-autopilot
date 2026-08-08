// Architecture Diagram OS — embeddable Project OS panel.
// One component gives any project surface (Project Studio workspace, Project
// Creator) the full Diagram OS: generate/regenerate via the backend engine,
// view tabs, professional canvas, validation score, instruction-based refine,
// and JSON/Mermaid/SVG export. The spec is patched back onto the project via
// onPatch so it persists through the app's existing project-store mechanism.
//
// Backward compatible by design: when the project has no architectureSpec
// (old saved projects, offline fallback), the legacy Mermaid renderer shows
// the existing diagram and a single button upgrades it.
import { useState } from 'react';
import { Loader2, Sparkles, Wand2, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button, Input, Badge } from '../ui/kit.jsx';
import { ArchitectureDiagram as LegacyMermaidDiagram } from '../proof/ProofViews.jsx';
import ArchitectureCanvas from './ArchitectureCanvas.jsx';
import ArchitectureTabs from './ArchitectureTabs.jsx';
import ArchitectureValidationPanel from './ArchitectureValidationPanel.jsx';
import ArchitectureExportPanel from './ArchitectureExportPanel.jsx';
import { isArchitectureSpec, orderedViews, scoreTone } from '../../lib/architectureSpec.js';
import { Architecture } from '../../lib/api.js';

export default function ArchitectureStudioPanel({ project, legacyMermaid = '', onPatch, height = 420 }) {
  const p = project || {};
  const spec = isArchitectureSpec(p.architectureSpec) ? p.architectureSpec : null;
  const validation = p.architectureValidation || null;
  const views = spec ? orderedViews(spec) : [];

  const [activeType, setActiveType] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [refineText, setRefineText] = useState('');
  const [showValidation, setShowValidation] = useState(false);

  const activeView = views.find((v) => v.type === activeType) || views[0] || null;

  const adopt = (architectureSpec, architectureValidation, note = '') => {
    if (!isArchitectureSpec(architectureSpec)) return;
    onPatch?.({
      architectureSpec,
      architectureValidation: architectureValidation || null,
      // keep the legacy field in sync so every old surface (cards, exports,
      // build guide) renders the same architecture
      architectureDiagram: p.architectureDiagram || legacyMermaid || '',
    });
    if (note) setMsg(note);
  };

  const generate = async () => {
    setBusy('generate'); setMsg('');
    try {
      const data = await Architecture.spec({
        projectId: p.id || '',
        title: p.title || p.projectTitle || 'Project',
        description: [p.problemStatement, p.useCase, p.summary, p.architecture].filter(Boolean).join(' ').slice(0, 4000),
        techStack: Array.isArray(p.techStack) ? p.techStack : [],
        targetRole: p.targetRole || '',
        projectType: p.type || '',
        targetLevel: 'production',
      });
      adopt(data.architectureSpec, data.validation, 'Professional architecture generated from this project.');
    } catch (e) {
      setMsg(e?.message || 'Generation failed — the legacy diagram below still works.');
    } finally { setBusy(''); }
  };

  const refine = async () => {
    if (!spec || refineText.trim().length < 3) return;
    setBusy('refine'); setMsg('');
    try {
      const data = await Architecture.refine(spec, refineText.trim());
      const d = data.diffSummary || {};
      adopt(data.architectureSpec, data.validation,
        d.recognized
          ? `Applied — added: ${d.added?.join(', ') || 'none'}${d.removed?.length ? ` · removed: ${d.removed.join(', ')}` : ''}.`
          : (d.notes || 'No known components recognized.'));
      setRefineText('');
    } catch (e) { setMsg(e?.message || 'Refine failed.'); } finally { setBusy(''); }
  };

  /* ---- No spec yet: legacy diagram + upgrade button (old data never breaks) ---- */
  if (!spec) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] text-slate-500">Basic diagram (legacy). Generate the professional multi-view architecture for this project:</p>
          <Button size="sm" onClick={generate} disabled={busy === 'generate'}>
            {busy === 'generate' ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : <><Sparkles size={14} /> Generate professional architecture</>}
          </Button>
        </div>
        {msg && <p className="flex items-center gap-1.5 text-[12px] text-amber-glow"><AlertTriangle size={12} /> {msg}</p>}
        <LegacyMermaidDiagram mermaid={legacyMermaid} height={300} />
      </div>
    );
  }

  /* ---- Full Diagram OS panel ---- */
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {spec.pattern && <Badge tone="cyan">{spec.pattern.name}</Badge>}
          {validation?.score && <Badge tone={scoreTone(validation.score.overallScore)}>Quality {validation.score.overallScore}/100</Badge>}
          <Badge tone="default">v{spec.version || 1}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {validation && (
            <Button size="sm" variant="ghost" onClick={() => setShowValidation((s) => !s)}>
              {showValidation ? 'Hide checks' : `Checks (${(validation.checks || []).filter((c) => c.status === 'fail').length} open)`}
            </Button>
          )}
          <Button size="sm" variant="soft" onClick={generate} disabled={!!busy}>
            {busy === 'generate' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Regenerate
          </Button>
        </div>
      </div>

      <ArchitectureTabs views={views} activeId={activeView?.id || activeView?.type} onSelect={(v) => setActiveType(v.type)} />

      {activeView && (
        <>
          {activeView.description && <p className="text-[12px] text-slate-500">{activeView.description}</p>}
          <ArchitectureCanvas view={activeView} height={height} />
          <ArchitectureExportPanel spec={spec} view={activeView} />
        </>
      )}

      <div className="border-t border-white/8 pt-3">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate-500">Refine this architecture</p>
        <div className="flex gap-2">
          <Input value={refineText} onChange={(e) => setRefineText(e.target.value)} placeholder='e.g. "Add Redis cache, Kafka, worker service, monitoring and CI/CD"' onKeyDown={(e) => { if (e.key === 'Enter') refine(); }} />
          <Button size="sm" variant="soft" onClick={refine} disabled={!!busy || refineText.trim().length < 3}>
            {busy === 'refine' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Refine
          </Button>
        </div>
        {msg && <p className="mt-2 text-[12px] text-slate-400">{msg}</p>}
      </div>

      {showValidation && validation && (
        <div className="border-t border-white/8 pt-3">
          <ArchitectureValidationPanel validation={validation} />
        </div>
      )}
    </div>
  );
}
