// Guided Project Workspace — Architecture tab.
// Embeds the existing Architecture OS studio panel; shows the design
// score with honest labelling (design quality, not implementation proof).
import ArchitectureStudioPanel from '../architecture/ArchitectureStudioPanel.jsx';
import { Card } from '../ui/kit.jsx';
import { SectionTitle, NoticeBar } from './workspaceBits.jsx';
import { designScoreOf } from '../../lib/workspaceSelectors.js';

export default function WorkspaceArchitecture({ plan, project, onProjectPatch }) {
  const score = designScoreOf(plan);
  const arch = plan?.architecture || {};
  const archProject = {
    ...(project || {}),
    architectureSpec: project?.architectureSpec || arch.architectureSpec || null,
    architectureValidation: project?.architectureValidation || arch.validation || null,
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle hint="Embedded Architecture OS — refine and export from here.">Architecture</SectionTitle>
        {score != null && (
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-[13px] text-slate-300">
            Architecture design score: <span className="font-semibold text-white">{score}</span>
          </div>
        )}
      </div>
      <NoticeBar>The design score reflects the <strong>quality of the proposed architecture only</strong> — it is not implementation proof. Implementation is verified separately under the Proof tab.</NoticeBar>
      {archProject.architectureSpec ? (
        <ArchitectureStudioPanel project={archProject} onPatch={onProjectPatch} height={480} />
      ) : (
        <Card className="p-6 text-center text-[13px] text-slate-500">
          No architecture spec yet. Use “Regenerate” in the header to generate one with the workspace plan.
        </Card>
      )}
      {(arch.validation?.warnings || []).length > 0 && (
        <Card className="p-4">
          <SectionTitle>Warnings</SectionTitle>
          <ul className="space-y-1">{arch.validation.warnings.map((w, i) => <li key={i} className="text-[12.5px] text-amber-200/80">• {typeof w === 'string' ? w : w.message}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
