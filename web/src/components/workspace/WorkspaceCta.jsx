// Guided Project Workspace — reusable entry-point components.
// WorkspaceCtaPanel: success/action panel shown after a project is created.
// WorkspaceOpenButton: per-card Open Workspace / Generate Workspace button.
import { useState } from 'react';
import { Map as MapIcon, Eye, Network, Layers, ArrowRight } from 'lucide-react';
import { Button, Card, Spinner } from '../ui/kit.jsx';
import { hasWorkspace, ensureWorkspaceForProject } from '../../lib/workspaceEnsure.js';
import { getProject } from '../../lib/projectStore.js';

/** Success/action panel after project creation. */
export function WorkspaceCtaPanel({ project, go, generating = false, generateError = '', onRetry }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = hasWorkspace(getProject(project?.id) || project);

  const open = async () => {
    setBusy(true); setError('');
    const r = await ensureWorkspaceForProject(project);
    setBusy(false);
    if (r.ok) go?.('projectworkspace', { projectId: project.id });
    else setError(r.error);
  };

  return (
    <Card className="border-aurora-mint/25 bg-aurora-mint/[0.05] p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-display text-[15px] font-bold text-fg">
            {project?.title ? `“${project.title}” is saved.` : 'Project saved.'}
          </p>
          <p className="mt-1 text-[12.5px] text-fg-secondary">
            {generating ? 'Generating its guided workspace…'
              : ready ? 'Its guided workspace is ready — plan, tasks, starter pack and proof tracking.'
                : 'Generate its guided workspace to get a full build plan with tasks and a starter pack.'}
          </p>
          {(error || generateError) && (
            <p className="mt-1.5 text-[12px] text-rose-300">
              {error || generateError}{' '}
              {onRetry && <button onClick={onRetry} className="underline">Retry Generate Workspace</button>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={open} disabled={busy || generating}>
            {busy || generating ? <Spinner className="h-4 w-4" /> : <MapIcon size={15} />}
            {ready ? 'Open Workspace' : 'Generate Workspace'} <ArrowRight size={14} />
          </Button>
          <Button size="sm" variant="ghost" onClick={async () => { const r = await ensureWorkspaceForProject(project); if (r.ok) go?.('projectworkspace', { projectId: project.id, openPackPreview: true }); else setError(r.error); }}>
            <Eye size={14} /> Preview Starter Pack
          </Button>
          <Button size="sm" variant="ghost" onClick={async () => { const r = await ensureWorkspaceForProject(project); if (r.ok) go?.('projectworkspace', { projectId: project.id, tab: 'architecture' }); else setError(r.error); }}>
            <Network size={14} /> View Architecture
          </Button>
          <Button size="sm" variant="ghost" onClick={() => go?.('projectstudio')}>
            <Layers size={14} /> Continue in Project Studio
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Per-card button: Open Workspace when one exists, Generate Workspace otherwise. */
export function WorkspaceOpenButton({ project, go, size = 'sm', onError }) {
  const [busy, setBusy] = useState(false);
  const ready = hasWorkspace(getProject(project?.id) || project);

  const click = async () => {
    setBusy(true);
    const r = await ensureWorkspaceForProject(project);
    setBusy(false);
    if (r.ok) go?.('projectworkspace', { projectId: project.id });
    else onError?.(r.error || 'Workspace generation failed.');
  };

  return (
    <Button size={size} variant="soft" onClick={click} disabled={busy}>
      {busy ? <Spinner className="h-3.5 w-3.5" /> : <MapIcon size={14} />}
      {ready ? 'Open Workspace' : 'Generate Workspace'}
    </Button>
  );
}
