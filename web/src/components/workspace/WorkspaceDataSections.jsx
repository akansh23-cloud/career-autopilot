// Guided Project Workspace — Files / APIs / Database / Tests / Deployment /
// Proof / Patent sections.
import { useState } from 'react';
import { Github, Globe, ShieldCheck, Loader2, Info } from 'lucide-react';
import { Card, Badge, Button } from '../ui/kit.jsx';
import { StatusBadge, KeyVal, ChipList, ItemRow, SectionTitle, NoticeBar } from './workspaceBits.jsx';
import { fileBadge, asList } from '../../lib/workspaceSelectors.js';

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

/* How verification actually works — stated plainly. The old placeholder copy
   told students nothing about what to attach or what would be checked. */
function VerificationExplainer() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="mt-4 p-5">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2.5 text-left">
        <Info size={15} className="shrink-0 text-aurora-cyan" />
        <span className="text-[13.5px] font-semibold text-white">How verification works</span>
        <span className="ml-auto text-[12px] text-slate-500">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-4 text-[13px] leading-relaxed text-slate-300">
          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-500">GitHub proof</div>
            <p>We read your <strong>public</strong> repository from GitHub&rsquo;s API — no token, no write access. We confirm the repo exists and has commits, that a README exists in the root and is substantial enough to explain the project, and whether a CI workflow lives under <span className="font-mono text-[12px]">.github/workflows</span>. A private repo cannot be read this way; connect the GitHub App in Career Profile to verify private work with your permission.</p>
          </div>
          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-500">Deployment proof</div>
            <p>We request your deployed URL server-side and record the HTTP status, response time, page title and whether the response is a real rendered page rather than an empty shell or a parked domain. A page that loads but renders nothing stays pending.</p>
          </div>
          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-500">What never happens</div>
            <p>Nothing passes because you clicked a button, downloaded a starter pack or marked a task Done. If a check cannot run — timeout, rate limit, network block — the item stays <strong>pending</strong>. We never fail you for our outage and we never fake a pass.</p>
          </div>
        </div>
      )}
    </Card>
  );
}

export function WorkspaceProof({ plan, selected, onSelect, onVerify, verifying }) {
  const proofs = plan?.proofRequirements || [];
  const saved = plan?.proofEvidence || {};
  const summary = plan?.verificationSummary || null;
  const [repoUrl, setRepoUrl] = useState(saved.repoUrl || '');
  const [liveUrl, setLiveUrl] = useState(saved.liveUrl || '');

  const run = () => onVerify?.({ repoUrl: repoUrl.trim(), liveUrl: liveUrl.trim() });
  const canRun = !!onVerify && !verifying;

  return (
    <div>
      <SectionTitle hint="Implementation proof is separate from the architecture design score.">Proof requirements</SectionTitle>

      <Card className="mt-3 p-5">
        <div className="mb-1 text-[13.5px] font-semibold text-white">Attach your evidence</div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-slate-400">
          Paste what you have. We check it server-side and mark only what we can actually observe. Anything we cannot reach stays pending with a reason.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-500"><Github size={12} /> Public repository URL</span>
            <input
              value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/you/your-project"
              className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-[13px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-aurora-violet/50"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-500"><Globe size={12} /> Deployed URL</span>
            <input
              value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)}
              placeholder="https://your-project.vercel.app"
              className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-[13px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-aurora-violet/50"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={run} disabled={!canRun}>
            {verifying ? <><Loader2 size={15} className="animate-spin" /> Checking…</> : <><ShieldCheck size={15} /> Run verification</>}
          </Button>
          {summary?.ranAt && (
            <span className="text-[11.5px] text-slate-500">
              Last run {new Date(summary.ranAt).toLocaleString()} · {summary.verifiedItems} verified, {summary.pendingItems} pending
            </span>
          )}
        </div>
      </Card>

      <div className="mt-4 space-y-1.5">
        {proofs.map((p) => (
          <ItemRow
            key={p.id}
            title={p.title}
            sub={p.verificationNote || `${p.description || ''} · via ${p.verificationMethod}`}
            badge={<StatusBadge status={p.status || 'pending'} />}
            right={p.required ? <Badge tone="amber">Required</Badge> : <Badge>Optional</Badge>}
            selected={selected?.type === 'proof' && selected?.id === p.id}
            onClick={() => onSelect({ type: 'proof', id: p.id })}
          />
        ))}
      </div>

      <VerificationExplainer />
    </div>
  );
}

export function WorkspacePatent({ plan }) {
  const pa = plan?.patentAssets || {};
  const noveltyAngles = asList(pa.noveltyAngles);
  const claimElements = asList(pa.claimElementCandidates);
  const methodFlow = asList(pa.methodFlow);
  const notes = asList(pa.notes);
  const figures = asList(pa.figures || pa.patentFigure);
  if (!pa.enabled) {
    return <NoticeBar>Patent evaluation was not enabled for this project. Enable “patent potential evaluation” when creating/regenerating to populate this tab.</NoticeBar>;
  }
  return (
    <div className="space-y-4">
      <SectionTitle>Patent assets</SectionTitle>
      {pa.stale && <NoticeBar tone="warn">Architecture changed since these patent assets were generated — Regenerate to refresh them.</NoticeBar>}
      <NoticeBar tone="warn">These are candidate angles to discuss with a patent professional — the workspace does not claim your idea is patentable.</NoticeBar>
      {figures.length > 0 && (
        <Card className="p-5">
          <SectionTitle>Patent figures (from Architecture OS)</SectionTitle>
          {figures.map((fig, i) => (
            <pre key={i} className="mb-2 overflow-x-auto rounded-xl bg-black/30 p-3 font-mono text-[11px] text-slate-300">{typeof fig === 'string' ? fig : JSON.stringify(fig, null, 2)}</pre>
          ))}
        </Card>
      )}
      <Card className="p-5">
        <SectionTitle>Novelty angles</SectionTitle>
        <ul className="space-y-1.5">{noveltyAngles.map((x, i) => <li key={i} className="text-[13px] text-slate-300">• {x}</li>)}</ul>
      </Card>
      <Card className="p-5">
        <SectionTitle>Claim element candidates</SectionTitle>
        <ul className="space-y-1.5">{claimElements.map((x, i) => <li key={i} className="text-[13px] text-slate-300">• {x}</li>)}</ul>
      </Card>
      <Card className="p-5">
        <SectionTitle>Method flow</SectionTitle>
        <ol className="space-y-1.5">{methodFlow.map((x, i) => <li key={i} className="text-[13px] text-slate-300">{i + 1}. {x}</li>)}</ol>
      </Card>
      {notes.length > 0 && (
        <Card className="p-5">
          <SectionTitle>Notes</SectionTitle>
          <ul className="space-y-1.5">{notes.map((x, i) => <li key={i} className="text-[12.5px] text-slate-400">{typeof x === 'string' ? x : JSON.stringify(x)}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
