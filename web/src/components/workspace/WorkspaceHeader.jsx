// Guided Project Workspace — top header: progress, phase, design score, actions.
import { Download, Eye, RefreshCw, Calculator, ShieldCheck, FileDown } from 'lucide-react';
import { Button, Badge, Spinner } from '../ui/kit.jsx';
import { progressOf, designScoreOf } from '../../lib/workspaceSelectors.js';

export default function WorkspaceHeader({ plan, busy = {}, onPreviewPack, onDownloadPack, onRegenerate, onRecalculate, onVerify, onExport }) {
  const prog = progressOf(plan);
  const score = designScoreOf(plan);
  const phase = plan?.currentPhase?.title || plan?.currentPhase || '—';

  return (
    <div className="gradient-border relative overflow-hidden p-5 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate font-display text-2xl font-extrabold text-white">{plan?.title || 'Project Workspace'}</h1>
            <Badge tone="cyan">Phase: {phase}</Badge>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px]">
            <span className="text-slate-400"><span className="font-semibold text-white">{prog.percentDone}%</span> done ({prog.doneTasks + prog.verifiedTasks}/{prog.totalTasks} tasks)</span>
            <span className="text-slate-400"><span className="font-semibold text-[#C9B8FF]">{prog.percentVerified}%</span> verified</span>
            {prog.blockedTasks > 0 && <span className="text-rose-300">{prog.blockedTasks} blocked</span>}
            {score != null && (
              <span className="text-slate-400" title="Quality of the proposed architecture — not implementation proof.">
                Architecture design score: <span className="font-semibold text-white">{score}</span>
              </span>
            )}
          </div>
          <div className="mt-3 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-white/8">
            <div className="h-full rounded-full bg-aurora-cta transition-all" style={{ width: `${prog.percentDone}%` }} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onPreviewPack} disabled={busy.pack}>
            {busy.pack ? <Spinner className="h-4 w-4" /> : <Eye size={15} />} Preview Starter Pack
          </Button>
          <Button size="sm" onClick={onDownloadPack} disabled={busy.pack}>
            <Download size={15} /> Download Starter Pack
          </Button>
          <Button variant="ghost" size="sm" onClick={onRegenerate} disabled={busy.regen} title="Rebuild the plan; your task progress is preserved.">
            {busy.regen ? <Spinner className="h-4 w-4" /> : <RefreshCw size={15} />} Regenerate
          </Button>
          <Button variant="ghost" size="sm" onClick={onRecalculate} disabled={busy.recalc}>
            <Calculator size={15} /> Recalculate
          </Button>
          <Button variant="ghost" size="sm" onClick={onVerify} disabled={busy.verify} title="Runs local checks only. GitHub/deployment verification coming next.">
            {busy.verify ? <Spinner className="h-4 w-4" /> : <ShieldCheck size={15} />} Verify
          </Button>
          <Button variant="ghost" size="sm" onClick={onExport}>
            <FileDown size={15} /> Export plan
          </Button>
        </div>
      </div>
    </div>
  );
}
