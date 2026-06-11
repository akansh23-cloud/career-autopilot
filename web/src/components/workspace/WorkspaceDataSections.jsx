// Guided Project Workspace — Files / APIs / Database / Tests / Deployment /
// Proof / Patent sections.
import { Card, Badge } from '../ui/kit.jsx';
import { StatusBadge, KeyVal, ChipList, ItemRow, SectionTitle, NoticeBar } from './workspaceBits.jsx';
import { fileBadge } from '../../lib/workspaceSelectors.js';

export function WorkspaceFiles({ plan, selected, onSelect, onPreviewCode }) {
  const files = plan?.fileTree || [];
  return (
    <div>
      <SectionTitle hint="Expected project file tree. Files with a template can be previewed; others you implement yourself.">Files</SectionTitle>
      <div className="space-y-1.5">
        {files.map((f) => (
          <ItemRow
            key={f.path}
            title={<span className="font-mono text-[12px]">{f.path}</span>}
            sub={f.purpose}
            badge={<Badge tone={f.templateKey ? 'cyan' : 'default'}>{fileBadge(f)}</Badge>}
            right={f.starterPackIncluded ? <Badge tone="mint">In ZIP</Badge> : null}
            selected={selected?.type === 'file' && selected?.id === f.path}
            onClick={() => onSelect({ type: 'file', id: f.path })}
          />
        ))}
      </div>
      {onPreviewCode && selected?.type === 'file' && (
        <p className="mt-3 text-[12px] text-slate-500">Tip: use the inspector’s “Preview starter code” button for the selected file.</p>
      )}
    </div>
  );
}

export function WorkspaceApis({ plan, selected, onSelect }) {
  const apis = plan?.apiPlan || [];
  const tone = { GET: 'cyan', POST: 'mint', PATCH: 'amber', PUT: 'amber', DELETE: 'rose' };
  return (
    <div>
      <SectionTitle hint="Planned endpoints — click to inspect request/response shapes.">API plan</SectionTitle>
      <div className="space-y-1.5">
        {apis.map((a) => (
          <ItemRow
            key={a.id}
            title={<span className="flex items-center gap-2"><Badge tone={tone[a.method] || 'default'}>{a.method}</Badge><span className="font-mono text-[12px]">{a.path}</span></span>}
            sub={a.purpose}
            badge={<StatusBadge status={a.status || 'planned'} />}
            right={a.authRequired ? <Badge>Auth</Badge> : null}
            selected={selected?.type === 'api' && selected?.id === a.id}
            onClick={() => onSelect({ type: 'api', id: a.id })}
          />
        ))}
      </div>
    </div>
  );
}

export function WorkspaceDatabase({ plan, selected, onSelect }) {
  const models = plan?.databaseModels || [];
  return (
    <div>
      <SectionTitle>Database models</SectionTitle>
      <div className="grid gap-3 md:grid-cols-2">
        {models.map((m) => (
          <button
            key={m.id}
            onClick={() => onSelect({ type: 'model', id: m.id })}
            className={`rounded-2xl border p-4 text-left transition ${selected?.id === m.id ? 'border-aurora-violet/40 bg-aurora-violet/10' : 'border-white/8 bg-white/[0.03] hover:border-white/15'}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-semibold text-white">{m.name}</span>
              <StatusBadge status={m.status || 'planned'} />
            </div>
            <div className="mt-2.5 space-y-1">
              {(m.fields || []).slice(0, 8).map((f, i) => (
                <div key={i} className="flex items-center justify-between font-mono text-[11.5px]">
                  <span className="text-slate-300">{f.name}</span>
                  <span className="text-slate-500">{f.type}{f.required ? ' *' : ''}</span>
                </div>
              ))}
              {(m.fields || []).length > 8 && <div className="text-[11px] text-slate-600">+{m.fields.length - 8} more fields</div>}
            </div>
            {(m.relationships || []).length > 0 && (
              <div className="mt-2.5"><ChipList items={m.relationships.map((r) => typeof r === 'string' ? r : `${r.type || 'ref'} → ${r.target || r.model}`)} /></div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WorkspaceTests({ plan, selected, onSelect }) {
  const tests = plan?.testPlan || [];
  return (
    <div>
      <SectionTitle>Test plan</SectionTitle>
      <div className="space-y-1.5">
        {tests.map((t) => (
          <ItemRow
            key={t.id}
            title={t.name}
            sub={<span className="font-mono text-[11px]">{t.command}</span>}
            badge={<StatusBadge status={t.status || 'planned'} />}
            right={<Badge>{t.type}</Badge>}
            selected={selected?.type === 'test' && selected?.id === t.id}
            onClick={() => onSelect({ type: 'test', id: t.id })}
          />
        ))}
      </div>
    </div>
  );
}

export function WorkspaceDeployment({ plan }) {
  const d = plan?.deploymentPlan || {};
  return (
    <div className="space-y-4">
      <SectionTitle>Deployment plan</SectionTitle>
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <KeyVal label="Provider">{d.provider}</KeyVal>
          <KeyVal label="Environments"><ChipList items={d.environments} /></KeyVal>
          <KeyVal label="Build command"><span className="font-mono text-[12px]">{d.buildCommand}</span></KeyVal>
          <KeyVal label="Start command"><span className="font-mono text-[12px]">{d.startCommand}</span></KeyVal>
          <KeyVal label="Health check"><span className="font-mono text-[12px]">{d.healthCheckUrl}</span></KeyVal>
          <KeyVal label="Status"><StatusBadge status={d.status || 'planned'} /></KeyVal>
        </div>
      </Card>
      <Card className="p-5">
        <SectionTitle hint="Names only — actual values stay in your local .env, never in the workspace.">Required env vars</SectionTitle>
        <ChipList items={d.requiredEnvVars} />
      </Card>
      <Card className="p-5">
        <SectionTitle>Deploy steps</SectionTitle>
        <ol className="space-y-1.5">
          {(d.deploySteps || []).map((s, i) => <li key={i} className="text-[13px] text-slate-300">{i + 1}. {typeof s === 'string' ? s : s.title}</li>)}
        </ol>
      </Card>
    </div>
  );
}

export function WorkspaceProof({ plan, selected, onSelect }) {
  const proofs = plan?.proofRequirements || [];
  return (
    <div>
      <SectionTitle hint="Implementation proof is separate from the architecture design score.">Proof requirements</SectionTitle>
      <NoticeBar>GitHub and deployment verification are <strong>coming next</strong> — in v1 only local/manual checks can be verified. Nothing here is auto-verified by downloads or clicks.</NoticeBar>
      <div className="mt-3 space-y-1.5">
        {proofs.map((p) => (
          <ItemRow
            key={p.id}
            title={p.title}
            sub={`${p.description || ''} · via ${p.verificationMethod}`}
            badge={<StatusBadge status={p.status || 'pending'} />}
            right={p.required ? <Badge tone="amber">Required</Badge> : <Badge>Optional</Badge>}
            selected={selected?.type === 'proof' && selected?.id === p.id}
            onClick={() => onSelect({ type: 'proof', id: p.id })}
          />
        ))}
      </div>
    </div>
  );
}

export function WorkspacePatent({ plan }) {
  const pa = plan?.patentAssets || {};
  if (!pa.enabled) {
    return <NoticeBar>Patent evaluation was not enabled for this project. Enable “patent potential evaluation” when creating/regenerating to populate this tab.</NoticeBar>;
  }
  return (
    <div className="space-y-4">
      <SectionTitle>Patent assets</SectionTitle>
      <NoticeBar tone="warn">These are candidate angles to discuss with a patent professional — the workspace does not claim your idea is patentable.</NoticeBar>
      {pa.patentFigure && (
        <Card className="p-5">
          <SectionTitle>Patent figure (from Architecture OS)</SectionTitle>
          <pre className="overflow-x-auto rounded-xl bg-black/30 p-3 font-mono text-[11px] text-slate-300">{typeof pa.patentFigure === 'string' ? pa.patentFigure : JSON.stringify(pa.patentFigure, null, 2)}</pre>
        </Card>
      )}
      <Card className="p-5">
        <SectionTitle>Novelty angles</SectionTitle>
        <ul className="space-y-1.5">{(pa.noveltyAngles || []).map((x, i) => <li key={i} className="text-[13px] text-slate-300">• {x}</li>)}</ul>
      </Card>
      <Card className="p-5">
        <SectionTitle>Claim element candidates</SectionTitle>
        <ul className="space-y-1.5">{(pa.claimElementCandidates || []).map((x, i) => <li key={i} className="text-[13px] text-slate-300">• {x}</li>)}</ul>
      </Card>
      <Card className="p-5">
        <SectionTitle>Method flow</SectionTitle>
        <ol className="space-y-1.5">{(pa.methodFlow || []).map((x, i) => <li key={i} className="text-[13px] text-slate-300">{i + 1}. {x}</li>)}</ol>
      </Card>
      {(pa.notes || []).length > 0 && (
        <Card className="p-5">
          <SectionTitle>Notes</SectionTitle>
          <ul className="space-y-1.5">{pa.notes.map((x, i) => <li key={i} className="text-[12.5px] text-slate-400">{x}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
