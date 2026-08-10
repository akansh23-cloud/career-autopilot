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
            <h1 className="truncate font-display text-2xl font-extrabold text-fg">{plan?.title || 'Project Workspace'}</h1>
            <Badge tone="cyan">Phase: {phase}</Badge>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px]">
            <span className="text-fg-secondary" title="Effort-weighted: bigger tasks move this more than small ones.">
              <span className="font-semibold text-fg">{prog.builtPercent}%</span> built ({prog.doneTasks + prog.verifiedTasks}/{prog.totalTasks} tasks)
            </span>
            <span className="text-fg-secondary" title="Only evidence the system verified counts here. Built is not Verified.">
              <span className="font-semibold text-ok">{prog.verifiedPercent}%</span> verified
            </span>
            {prog.blockedTasks > 0 && <span className="text-danger">{prog.blockedTasks} blocked</span>}
            {score != null && (
              <span className="text-fg-secondary" title="Quality of the proposed architecture — not implementation proof.">
                Architecture design score: <span className="font-semibold text-fg">{score}</span>
              </span>
            )}
          </div>
          {/* Two truths, one bar: indigo = built (self-marked), green = verified
              (evidence-backed). The gap between them is exactly the work a
              recruiter cannot yet trust. */}
          <div className="relative mt-3 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-surface-1">
            <div className="absolute inset-y-0 left-0 rounded-full bg-aurora-cta transition-all" style={{ width: `${prog.builtPercent}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-aurora-mint transition-all" style={{ width: `${prog.verifiedPercent}%` }} />
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
