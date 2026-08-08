// Guided Project Workspace — Overview, Visual Preview, Roadmap sections.
import { Card, Badge } from '../ui/kit.jsx';
import { StatusBadge, KeyVal, ChipList, ItemRow, SectionTitle, NoticeBar } from './workspaceBits.jsx';
import { progressOf } from '../../lib/workspaceSelectors.js';

export function WorkspaceOverview({ plan }) {
  const s = plan?.projectSummary || {};
  const m = plan?.mvpScope || {};
  const prog = progressOf(plan);
  const risks = plan?.risks || [];
  const next = plan?.nextAction || plan?.nextBestAction;
  const pack = plan?.starterPack || {};
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <SectionTitle>Project summary</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KeyVal label="Problem">{s.problemStatement}</KeyVal>
          <KeyVal label="Target users">{s.targetUsers}</KeyVal>
          <KeyVal label="Category">{s.category}</KeyVal>
          <KeyVal label="Target role">{s.targetRole}</KeyVal>
          <KeyVal label="Difficulty">{s.difficulty}</KeyVal>
          <KeyVal label="Cloud">{s.cloudProvider}</KeyVal>
          <div className="sm:col-span-2 lg:col-span-3"><KeyVal label="Tech stack"><ChipList items={s.techStack} /></KeyVal></div>
        </div>
        {s.shortDescription && <p className="mt-4 text-[13px] leading-relaxed text-slate-400">{s.shortDescription}</p>}
      </Card>

      {next && (
        <Card className="p-5">
          <SectionTitle>Next best action</SectionTitle>
          <p className="text-[14px] font-semibold text-white">{next.title || String(next)}</p>
          {next.reason && <p className="mt-1.5 text-[12.5px] text-slate-500">{next.reason}</p>}
        </Card>
      )}

      <Card className="p-5">
        <SectionTitle>MVP scope</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          {[['Must have', m.mustHave], ['Should have', m.shouldHave], ['Later', m.later], ['Excluded from MVP', m.excluded]].map(([label, items]) => (
            <div key={label}>
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
              <ul className="space-y-1">
                {(items || []).map((x, i) => <li key={i} className="text-[13px] text-slate-300">• {typeof x === 'string' ? x : x.title || x.name}</li>)}
                {!(items || []).length && <li className="text-[12px] text-slate-600">—</li>}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle>Progress</SectionTitle>
        <div className="flex flex-wrap gap-x-8 gap-y-3 text-[13px] text-slate-300">
          <span>{prog.percentDone}% done</span>
          <span className="text-[#C9B8FF]">{prog.percentVerified}% verified</span>
          <span>{prog.doneTasks} done / {prog.verifiedTasks} verified / {prog.blockedTasks} blocked of {prog.totalTasks} tasks</span>
        </div>
        <p className="mt-2 text-[11.5px] text-slate-600">Done = you marked it complete. Verified = the system confirmed evidence. They are tracked separately.</p>
      </Card>

      {risks.length > 0 && (
        <Card className="p-5">
          <SectionTitle>Risks & missing items</SectionTitle>
          <div className="space-y-2">
            {risks.map((r, i) => <NoticeBar key={i} tone="warn">{r.message || r.title || String(r)}</NoticeBar>)}
          </div>
        </Card>
      )}

      <Card className="p-5">
        <SectionTitle>Starter pack</SectionTitle>
        {pack.stale && <div className="mb-2"><NoticeBar tone="warn">Architecture changed since this pack was generated — regenerate it for an up-to-date skeleton.</NoticeBar></div>}
        {pack.available
          ? <p className="text-[13px] text-slate-300">Generated {pack.lastGeneratedAt ? new Date(pack.lastGeneratedAt).toLocaleString() : ''} — {pack.includedFiles?.length || 0} files. <span className="text-slate-500">A starter skeleton, not a completed project; downloading it does not mark anything done or verified.</span></p>
          : <p className="text-[13px] text-slate-500">Not generated yet. Use “Preview Starter Pack” or “Download Starter Pack” in the header.</p>}
      </Card>
    </div>
  );
}

export function WorkspaceVisualPreview({ plan, selected, onSelect }) {
  const screens = plan?.visualPreview?.screens || [];
  const journeys = plan?.visualPreview?.userJourneys || [];
  return (
    <div className="space-y-5">
      <div>
        <SectionTitle hint="Wireframe-style cards — click a screen to inspect its linked APIs, models and tasks.">Screens</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {screens.map((sc) => (
            <button
              key={sc.id}
              onClick={() => onSelect({ type: 'screen', id: sc.id })}
              className={`rounded-2xl border p-4 text-left transition ${selected?.id === sc.id ? 'border-aurora-violet/40 bg-aurora-violet/10' : 'border-white/8 bg-white/[0.03] hover:border-white/15'}`}
            >
              <div className="mb-3 space-y-1.5 rounded-lg border border-dashed border-white/12 bg-black/20 p-3">
                <div className="h-2 w-3/4 rounded bg-white/12" />
                <div className="h-2 w-1/2 rounded bg-white/8" />
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {(sc.components || []).slice(0, 3).map((c, i) => <div key={i} className="h-8 rounded bg-white/6" />)}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-semibold text-white">{sc.name}</span>
                <StatusBadge status={sc.status || 'planned'} />
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-slate-500">{sc.route} · {sc.userRole}</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <SectionTitle>User journeys</SectionTitle>
        <div className="space-y-3">
          {journeys.map((j) => (
            <Card key={j.id} className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[13px] font-semibold text-white">{j.name}</span>
                <Badge tone="cyan">{j.actor}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-400">
                {(j.steps || []).map((st, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1">{typeof st === 'string' ? st : st.label || st.name}</span>
                    {i < j.steps.length - 1 && <span className="text-slate-600">→</span>}
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export function WorkspaceRoadmap({ plan, selected, onSelect }) {
  const roadmap = plan?.roadmap || [];
  const tasks = plan?.tasks || [];
  const current = plan?.currentPhase?.id || plan?.currentPhase;
  return (
    <div className="space-y-3">
      <SectionTitle hint="Phases are derived from the task board — statuses update as you progress.">Roadmap</SectionTitle>
      {roadmap.map((ph) => {
        const phTasks = tasks.filter((t) => t.phase === ph.phase || (ph.tasks || []).includes(t.id));
        const done = phTasks.filter((t) => t.status === 'done' || t.status === 'verified').length;
        const blocked = phTasks.filter((t) => t.status === 'blocked').length;
        const isCurrent = current === ph.id || current === ph.phase;
        return (
          <ItemRow
            key={ph.id}
            title={`${ph.order != null ? ph.order + '. ' : ''}${ph.title}`}
            sub={`${ph.description || ''} — ${done}/${phTasks.length} tasks done${blocked ? `, ${blocked} blocked` : ''}`}
            badge={<StatusBadge status={ph.status || 'planned'} />}
            right={isCurrent ? <Badge tone="amber">Current phase</Badge> : null}
            selected={selected?.type === 'phase' && selected?.id === ph.id}
            onClick={() => onSelect({ type: 'phase', id: ph.id })}
          />
        );
      })}
    </div>
  );
}
