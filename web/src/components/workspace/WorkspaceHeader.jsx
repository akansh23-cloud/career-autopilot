// Guided Project Workspace — top header: progress, phase, and actions.
// Beginner-first: the Starter Kit download is the hero; advanced plan
// actions live in an overflow menu so the header isn't a wall of buttons.
import { Download, Eye, RefreshCw, Calculator, ShieldCheck, FileDown, MoreHorizontal, Package } from 'lucide-react';
import { Button, Badge, Spinner, Dropdown, MenuItem } from '../ui/kit.jsx';
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
          {/* Hero: the guided starter kit — the thing a student actually needs. */}
          <Button size="sm" onClick={onDownloadPack} disabled={busy.pack} title="A ready-to-run repo with a step-by-step guide, AI-tutor prompts, and a progress checker inside.">
            {busy.pack ? <Spinner className="h-4 w-4" /> : <Package size={15} />} Download Starter Kit
          </Button>
          <Button variant="ghost" size="sm" onClick={onPreviewPack} disabled={busy.pack}>
            <Eye size={15} /> Preview
          </Button>
          {/* Everything power-usery folds away so beginners aren't overwhelmed. */}
          <Dropdown align="right" trigger={
            <Button variant="ghost" size="sm" title="More plan actions"><MoreHorizontal size={16} /></Button>
          }>
            <MenuItem icon={RefreshCw} onClick={onRegenerate} disabled={busy.regen}>Regenerate plan</MenuItem>
            <MenuItem icon={Calculator} onClick={onRecalculate} disabled={busy.recalc}>Recalculate progress</MenuItem>
            <MenuItem icon={ShieldCheck} onClick={onVerify} disabled={busy.verify}>Run verification</MenuItem>
            <MenuItem icon={FileDown} onClick={onExport}>Export plan (JSON)</MenuItem>
          </Dropdown>
        </div>
      </div>
    </div>
  );
}
