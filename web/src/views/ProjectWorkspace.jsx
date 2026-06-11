// ============================================================
// Guided Project Workspace v1 — main view.
// Loads/generates the deterministic workspace plan for a project,
// renders the 12-section workspace, and keeps a client-side copy of
// the plan on the project (projectStore) so everything still works
// when the backend DB is disabled.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageIntro } from './common.jsx';
import { Card, Spinner, Button } from '../components/ui/kit.jsx';
import { getProject, saveProject, uid } from '../lib/projectStore.js';
import WorkspaceApi from '../lib/workspaceApi.js';
import { mergePlanIntoProject } from '../lib/workspaceSelectors.js';
import WorkspaceHeader from '../components/workspace/WorkspaceHeader.jsx';
import WorkspaceSidebar from '../components/workspace/WorkspaceSidebar.jsx';
import WorkspaceInspector from '../components/workspace/WorkspaceInspector.jsx';
import WorkspaceTaskBoard from '../components/workspace/WorkspaceTaskBoard.jsx';
import WorkspaceArchitecture from '../components/workspace/WorkspaceArchitecture.jsx';
import CustomProjectForm from '../components/workspace/CustomProjectForm.jsx';
import { CodePreviewPanel, StarterPackPreview } from '../components/workspace/CodePreviewPanel.jsx';
import { WorkspaceOverview, WorkspaceVisualPreview, WorkspaceRoadmap } from '../components/workspace/WorkspaceSections.jsx';
import {
  WorkspaceFiles, WorkspaceApis, WorkspaceDatabase, WorkspaceTests,
  WorkspaceDeployment, WorkspaceProof, WorkspacePatent,
} from '../components/workspace/WorkspaceDataSections.jsx';

export default function ProjectWorkspace({ go, projectId = '', createCustom = false }) {
  const [project, setProject] = useState(() => (projectId ? getProject(projectId) : null));
  const [plan, setPlan] = useState(project?.workspacePlan || null);
  const [tab, setTab] = useState('overview');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState({});
  const [showForm, setShowForm] = useState(createCustom && !projectId);

  const [codePreview, setCodePreview] = useState({ open: false, loading: false, generatedFiles: [], warnings: [] });
  const [packPreview, setPackPreview] = useState({ open: false, loading: false, files: [], setupCommands: [], warnings: [] });

  const setBusyKey = (k, v) => setBusy((b) => ({ ...b, [k]: v }));

  /* Persist the plan both server-side (route does it) and client-side. */
  const adoptPlan = useCallback((nextPlan, nextProject) => {
    setPlan(nextPlan);
    const proj = nextProject || project;
    if (proj?.id && nextPlan) {
      const merged = mergePlanIntoProject(proj, nextPlan);
      saveProject(merged);
      setProject(merged);
    }
  }, [project]);

  /* Initial load: stored plan → server copy → generate. */
  useEffect(() => {
    let alive = true;
    if (!projectId || plan) return undefined;
    const p = getProject(projectId);
    if (p?.workspacePlan) { setProject(p); setPlan(p.workspacePlan); return undefined; }
    (async () => {
      setLoading(true); setError('');
      try {
        const r = await WorkspaceApi.get(projectId).catch(() => null);
        if (!alive) return;
        if (r?.workspacePlan) { adoptPlan(r.workspacePlan, p); if (r.currentTab) setTab(r.currentTab); return; }
        if (p) {
          const gen = await WorkspaceApi.generate({ projectId, project: p, architectureSpec: p.architectureSpec || null });
          if (!alive) return;
          if (gen?.workspacePlan) adoptPlan(gen.workspacePlan, p);
          else setError('Could not generate a workspace plan for this project.');
        } else {
          setError('Project not found. Open a project from Project Studio, or create a custom project.');
        }
      } catch (e) {
        if (alive) setError(e?.message || 'Failed to load the workspace.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /* -------- actions -------- */
  const createFromCustom = async (customInput) => {
    setBusyKey('create', true); setError('');
    try {
      const id = uid('custom');
      const r = await WorkspaceApi.generate({ projectId: id, customInput });
      const proj = { ...(r.project || {}), id: r.project?.id || id };
      saveProject(mergePlanIntoProject(proj, r.workspacePlan));
      setProject(getProject(proj.id) || proj);
      setPlan(r.workspacePlan);
      setShowForm(false);
      setTab('overview');
    } catch (e) {
      setError(e?.message || 'Failed to create the custom project.');
    } finally { setBusyKey('create', false); }
  };

  const regenerate = async () => {
    if (!project) return;
    setBusyKey('regen', true);
    try {
      const r = await WorkspaceApi.generate({
        projectId: project.id, project, architectureSpec: project.architectureSpec || null,
        existingPlan: plan, regenerate: true,
      });
      if (r?.workspacePlan) adoptPlan(r.workspacePlan);
    } catch (e) { setError(e?.message || 'Regenerate failed.'); }
    finally { setBusyKey('regen', false); }
  };

  const recalculate = async () => {
    if (!project || !plan) return;
    setBusyKey('recalc', true);
    try {
      const r = await WorkspaceApi.recalculate(project.id, plan);
      if (r?.workspacePlan) adoptPlan(r.workspacePlan);
    } catch (e) { setError(e?.message || 'Recalculate failed.'); }
    finally { setBusyKey('recalc', false); }
  };

  const verify = async () => {
    if (!project || !plan) return;
    setBusyKey('verify', true);
    try {
      const r = await WorkspaceApi.verify(project.id, plan);
      if (r?.updatedWorkspacePlan) adoptPlan(r.updatedWorkspacePlan);
    } catch (e) { setError(e?.message || 'Verification failed.'); }
    finally { setBusyKey('verify', false); }
  };

  const patchTask = async (taskId, patch) => {
    if (!project || !plan) return;
    /* Optimistic update so the board feels instant. */
    const optimistic = { ...plan, tasks: plan.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) };
    setPlan(optimistic);
    try {
      const r = await WorkspaceApi.patchTask(project.id, taskId, { workspacePlan: plan, ...patch });
      if (r?.workspacePlan) adoptPlan(r.workspacePlan);
    } catch (e) {
      setPlan(plan); // roll back
      setError(e?.message || 'Task update failed.');
    }
  };

  const previewCode = async ({ taskId, filePath, templateKey } = {}) => {
    if (!project || !plan) return;
    setCodePreview({ open: true, loading: true, generatedFiles: [], warnings: [] });
    try {
      const r = await WorkspaceApi.codegenPreview(project.id, { workspacePlan: plan, taskId, filePath, templateKey });
      setCodePreview({ open: true, loading: false, generatedFiles: r.generatedFiles || [], warnings: r.warnings || [] });
    } catch (e) {
      setCodePreview({ open: true, loading: false, generatedFiles: [], warnings: [e?.message || 'Preview failed.'] });
    }
  };

  const previewPack = async () => {
    if (!project || !plan) return;
    setPackPreview({ open: true, loading: true, files: [], setupCommands: [], warnings: [] });
    try {
      const r = await WorkspaceApi.starterPackPreview(project.id, plan);
      setPackPreview({ open: true, loading: false, files: r.files || [], setupCommands: r.setupCommands || [], warnings: r.warnings || [] });
    } catch (e) {
      setPackPreview({ open: true, loading: false, files: [], setupCommands: [], warnings: [e?.message || 'Preview failed.'] });
    }
  };

  const downloadPack = async () => {
    if (!project || !plan) return;
    setBusyKey('pack', true);
    try {
      const r = await WorkspaceApi.starterPackGenerate(project.id, plan);
      if (r?.starterPack) adoptPlan({ ...plan, starterPack: r.starterPack });
      if (r?.downloadUrl) {
        const a = document.createElement('a');
        a.href = r.downloadUrl;
        a.click();
      }
    } catch (e) { setError(e?.message || 'Starter pack generation failed.'); }
    finally { setBusyKey('pack', false); }
  };

  const exportPlan = () => {
    if (!plan) return;
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(plan.title || 'workspace-plan').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.workspace.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const changeTab = (id) => {
    setTab(id);
    if (project?.id) WorkspaceApi.patch(project.id, { currentTab: id }).catch(() => {});
  };

  /* Architecture panel patches (spec refinements) flow back onto the project. */
  const onProjectPatch = (patch) => {
    if (!project) return;
    const merged = { ...project, ...patch };
    saveProject(merged);
    setProject(merged);
  };

  const counts = useMemo(() => plan ? {
    tasks: plan.tasks?.length, files: plan.fileTree?.length, apis: plan.apiPlan?.length,
    database: plan.databaseModels?.length, tests: plan.testPlan?.length, proof: plan.proofRequirements?.length,
  } : {}, [plan]);

  /* -------- render -------- */
  if (showForm) {
    return (
      <div>
        <PageIntro eyebrow="Guided Workspace" title="Create Custom Project" sub="Describe your idea — get a complete, deterministic build plan: screens, APIs, models, tasks, tests and a starter pack." />
        <CustomProjectForm onSubmit={createFromCustom} busy={busy.create} onCancel={() => (projectId ? setShowForm(false) : go?.('projectstudio'))} />
      </div>
    );
  }

  if (loading) {
    return <div className="grid min-h-[40vh] place-items-center"><div className="flex flex-col items-center gap-3"><Spinner className="h-7 w-7" /><p className="text-[13px] text-slate-500">Preparing your workspace…</p></div></div>;
  }

  if (!plan) {
    return (
      <div>
        <PageIntro eyebrow="Guided Workspace" title="Project Workspace" sub={error || 'No workspace yet.'} />
        <Card className="p-8 text-center">
          <p className="text-[13.5px] text-slate-400">{error || 'Open a project from Project Studio, or create a custom project to get a guided build plan.'}</p>
          <div className="mt-5 flex justify-center gap-2.5">
            <Button variant="ghost" onClick={() => go?.('projectstudio')}>Open Project Studio</Button>
            <Button onClick={() => setShowForm(true)}>Create Custom Project</Button>
          </div>
        </Card>
      </div>
    );
  }

  const sectionProps = { plan, selected, onSelect: setSelected };

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        plan={plan} busy={busy}
        onPreviewPack={previewPack} onDownloadPack={downloadPack}
        onRegenerate={regenerate} onRecalculate={recalculate} onVerify={verify} onExport={exportPlan}
      />
      {error && <Card className="border-rose-400/30 bg-rose-500/8 p-3.5 text-[12.5px] text-rose-200">{error}</Card>}

      <div className="flex flex-col gap-5 lg:flex-row">
        <WorkspaceSidebar active={tab} onSelect={changeTab} counts={counts} />
        <main className="min-w-0 flex-1">
          {tab === 'overview' && <WorkspaceOverview plan={plan} />}
          {tab === 'visual' && <WorkspaceVisualPreview {...sectionProps} />}
          {tab === 'architecture' && <WorkspaceArchitecture plan={plan} project={project} onProjectPatch={onProjectPatch} />}
          {tab === 'roadmap' && <WorkspaceRoadmap {...sectionProps} />}
          {tab === 'tasks' && <WorkspaceTaskBoard {...sectionProps} onTaskPatch={patchTask} onPreviewCode={previewCode} />}
          {tab === 'files' && <WorkspaceFiles {...sectionProps} onPreviewCode={previewCode} />}
          {tab === 'apis' && <WorkspaceApis {...sectionProps} />}
          {tab === 'database' && <WorkspaceDatabase {...sectionProps} />}
          {tab === 'tests' && <WorkspaceTests {...sectionProps} />}
          {tab === 'deployment' && <WorkspaceDeployment plan={plan} />}
          {tab === 'proof' && <WorkspaceProof {...sectionProps} />}
          {tab === 'patent' && <WorkspacePatent plan={plan} />}
        </main>
        {tab !== 'architecture' && (
          <WorkspaceInspector plan={plan} selected={selected} onClose={() => setSelected(null)} onPreviewCode={previewCode} />
        )}
      </div>

      <CodePreviewPanel {...codePreview} onClose={() => setCodePreview((s) => ({ ...s, open: false }))} />
      <StarterPackPreview
        {...packPreview}
        onClose={() => setPackPreview((s) => ({ ...s, open: false }))}
        onDownload={downloadPack} downloading={busy.pack}
      />
    </div>
  );
}
