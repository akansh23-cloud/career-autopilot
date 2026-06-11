// Guided Project Workspace — right inspector. Renders details for the
// selected task / file / API / model / screen / proof / test / phase.
import { Code2, X } from 'lucide-react';
import { Button } from '../ui/kit.jsx';
import { StatusBadge, KeyVal, ChipList, SectionTitle } from './workspaceBits.jsx';
import { itemForInspector, linkedEntities } from '../../lib/workspaceSelectors.js';

function Block({ label, items }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <ul className="space-y-1">{items.map((x, i) => <li key={i} className="text-[12.5px] leading-relaxed text-slate-300">• {typeof x === 'string' ? x : x.title || x.name || x.path || JSON.stringify(x)}</li>)}</ul>
    </div>
  );
}

export default function WorkspaceInspector({ plan, selected, onClose, onPreviewCode }) {
  const resolved = itemForInspector(plan, selected);
  if (!resolved?.item) {
    return (
      <aside className="hidden w-72 shrink-0 rounded-2xl border border-white/8 bg-white/[0.02] p-5 xl:block">
        <p className="text-[12.5px] leading-relaxed text-slate-500">Select a task, file, API, model, screen, test or proof item to inspect it here.</p>
      </aside>
    );
  }
  const { type, item } = resolved;

  return (
    <aside className="w-full shrink-0 rounded-2xl border border-white/8 bg-white/[0.02] p-5 xl:w-80">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">{type}</div>
          <h3 className="mt-1 break-words font-display text-[15px] font-bold leading-snug text-white">{item.title || item.name || item.path}</h3>
        </div>
        <button onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-white/5 hover:text-white"><X size={15} /></button>
      </div>
      <div className="mb-4"><StatusBadge status={item.status || item.verificationStatus || 'planned'} /></div>

      <div className="space-y-4">
        {type === 'task' && (() => {
          const linked = linkedEntities(plan, item);
          return (
            <>
              {item.description && <KeyVal label="Why it matters">{item.description}</KeyVal>}
              <div className="grid grid-cols-2 gap-3">
                <KeyVal label="Phase">{item.phase}</KeyVal>
                <KeyVal label="Priority">{item.priority}</KeyVal>
                <KeyVal label="Difficulty">{item.difficulty}</KeyVal>
                <KeyVal label="Est. hours">{item.estimatedHours}</KeyVal>
              </div>
              <KeyVal label="Skills"><ChipList items={item.skills} /></KeyVal>
              <Block label="Related files" items={linked.files.map((f) => f.path)} />
              <Block label="Related APIs" items={linked.apis.map((a) => `${a.method} ${a.path}`)} />
              <Block label="Related models" items={linked.models.map((m) => m.name)} />
              <Block label="Acceptance criteria" items={item.acceptanceCriteria} />
              <Block label="Verification rules" items={(item.verificationRules || []).map((r) => typeof r === 'string' ? r : r.description || r.type)} />
              {item.proofRequired && <p className="text-[12px] text-amber-200/80">Proof required to verify this task.</p>}
              {item.blockerReason && <KeyVal label="Blocker">{item.blockerReason}</KeyVal>}
              {item.starterCodeAvailable && onPreviewCode && (
                <Button size="sm" className="w-full" onClick={() => onPreviewCode({ taskId: item.id })}>
                  <Code2 size={14} /> Preview starter code
                </Button>
              )}
            </>
          );
        })()}

        {type === 'file' && (
          <>
            <KeyVal label="Path"><span className="break-all font-mono text-[12px]">{item.path}</span></KeyVal>
            <KeyVal label="Purpose">{item.purpose}</KeyVal>
            <KeyVal label="Template key">{item.templateKey || 'none — implement manually'}</KeyVal>
            <KeyVal label="In starter pack">{item.starterPackIncluded ? 'Yes' : 'No'}</KeyVal>
            <Block label="Related tasks" items={item.relatedTasks} />
            <Block label="Linked APIs" items={item.linkedApis} />
            <Block label="Linked models" items={item.linkedModels} />
            {item.templateKey && onPreviewCode && (
              <Button size="sm" className="w-full" onClick={() => onPreviewCode({ filePath: item.path, templateKey: item.templateKey })}>
                <Code2 size={14} /> Preview starter code
              </Button>
            )}
          </>
        )}

        {type === 'api' && (
          <>
            <KeyVal label="Endpoint"><span className="font-mono text-[12px]">{item.method} {item.path}</span></KeyVal>
            <KeyVal label="Purpose">{item.purpose}</KeyVal>
            <KeyVal label="Auth">{item.authRequired ? `Required (${(item.roles || []).join(', ') || 'any role'})` : 'Public'}</KeyVal>
            <KeyVal label="Request body"><pre className="overflow-x-auto rounded-lg bg-black/30 p-2 font-mono text-[11px] text-slate-300">{JSON.stringify(item.requestBody || {}, null, 2)}</pre></KeyVal>
            <KeyVal label="Response body"><pre className="overflow-x-auto rounded-lg bg-black/30 p-2 font-mono text-[11px] text-slate-300">{JSON.stringify(item.responseBody || {}, null, 2)}</pre></KeyVal>
            <KeyVal label="Linked screen">{item.linkedScreen}</KeyVal>
            <KeyVal label="Linked model">{item.linkedModel}</KeyVal>
            <KeyVal label="Suggested test">{item.suggestedTest || `Add an API test asserting ${item.method} ${item.path} returns the planned shape.`}</KeyVal>
          </>
        )}

        {type === 'model' && (
          <>
            <KeyVal label="Type">{item.type}</KeyVal>
            <Block label="Fields" items={(item.fields || []).map((f) => `${f.name}: ${f.type}${f.required ? ' (required)' : ''}`)} />
            <Block label="Relationships" items={(item.relationships || []).map((r) => typeof r === 'string' ? r : `${r.type || 'ref'} → ${r.target || r.model}`)} />
            <Block label="Linked APIs" items={item.linkedApis} />
            <Block label="Linked tasks" items={item.linkedTasks} />
          </>
        )}

        {type === 'screen' && (
          <>
            <KeyVal label="Purpose">{item.purpose}</KeyVal>
            <KeyVal label="Route"><span className="font-mono text-[12px]">{item.route}</span></KeyVal>
            <KeyVal label="Role">{item.userRole}</KeyVal>
            <Block label="Components" items={item.components} />
            <Block label="Linked APIs" items={item.linkedApis} />
            <Block label="Linked tasks" items={item.linkedTasks} />
          </>
        )}

        {type === 'proof' && (
          <>
            <KeyVal label="Why needed">{item.description}</KeyVal>
            <KeyVal label="Verification method">{item.verificationMethod}</KeyVal>
            <KeyVal label="Required">{item.required ? 'Yes' : 'Optional'}</KeyVal>
            {(item.verificationMethod === 'github' || item.verificationMethod === 'deployment') && (
              <p className="text-[12px] text-slate-500">Automatic verification for this proof type is coming next — it stays pending in v1.</p>
            )}
          </>
        )}

        {type === 'test' && (
          <>
            <KeyVal label="Type">{item.type}</KeyVal>
            <KeyVal label="Target"><span className="font-mono text-[12px]">{item.target}</span></KeyVal>
            <KeyVal label="Command"><span className="font-mono text-[12px]">{item.command}</span></KeyVal>
            <KeyVal label="Expected result">{item.expectedResult}</KeyVal>
            <KeyVal label="Linked task">{item.linkedTask}</KeyVal>
          </>
        )}
      </div>
    </aside>
  );
}
