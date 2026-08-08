// ============================================================
// Guided Project Workspace v1 — main view.
// Loads/generates the deterministic workspace plan for a project,
// renders the 12-section workspace, and keeps a client-side copy of
// the plan on the project (projectStore) so everything still works
// when the backend DB is disabled.
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { PageIntro } from './common.jsx';
import { Card, Spinner, Button } from '../components/ui/kit.jsx';
import { getProject, saveProject, uid } from '../lib/projectStore.js';
import WorkspaceApi from '../lib/workspaceApi.js';
import { mergePlanIntoProject } from '../lib/workspaceSelectors.js';
import WorkspaceHeader from '../components/workspace/WorkspaceHeader.jsx';
import WorkspaceSidebar from '../components/workspace/WorkspaceSidebar.jsx';
import WorkspaceInspector from '../components/workspace/WorkspaceInspector.jsx';
import WorkspaceTaskBoard from '../components/workspace/WorkspaceTaskBoard.jsx';
import GuidedPath from '../components/workspace/GuidedPath.jsx';
import WorkspaceArchitecture from '../components/workspace/WorkspaceArchitecture.jsx';
import CustomProjectForm from '../components/workspace/CustomProjectForm.jsx';
import { CodePreviewPanel, StarterPackPreview } from '../components/workspace/CodePreviewPanel.jsx';
import { WorkspaceOverview, WorkspaceVisualPreview, WorkspaceRoadmap } from '../components/workspace/WorkspaceSections.jsx';
import {
  WorkspaceFiles, WorkspaceApis, WorkspaceDatabase, WorkspaceTests,
  WorkspaceDeployment, WorkspaceProof, WorkspacePatent,
} from '../components/workspace/WorkspaceDataSections.jsx';

export default function ProjectWorkspace({ go, projectId = '', createCustom = false, tab: initialTab = '', openPackPreview = false }) {
  const [project, setProject] = useState(() => (projectId ? getProject(projectId) : null));
  const [plan, setPlan] = useState(project?.workspacePlan || null);
  const [tab, setTab] = useState(initialTab || 'overview');
  // Build = the beginner-first Guided Path (default). Blueprint = the
  // 12-section planning workspace. Beginners live in Build; seniors and
  // demos switch to Blueprint. Persisted per project via currentTab below.
  const [mode, setMode] = useState('build');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState({});
  const [notice, setNotice] = useState('');
  const [needsGenerate, setNeedsGenerate] = useState(false);
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

  /* Initial load by projectId: stored plan -> server copy -> Generate CTA.
     Ref-guarded so the effect's deps are exactly what it uses. */
  const loadedForRef = useRef('');
  useEffect(() => {
    if (!projectId || loadedForRef.current === projectId) return undefined;
    loadedForRef.current = projectId;
    let alive = true;
    const p = getProject(projectId);
    if (p) setProject(p);
    if (p?.workspacePlan) { setPlan(p.workspacePlan); return undefined; }
    (async () => {
      setLoading(true); setError(''); setNeedsGenerate(false);
      try {
        const r = await WorkspaceApi.get(projectId).catch(() => null);
        if (!alive) return;
        if (r?.workspacePlan) {
          setPlan(r.workspacePlan);
          if (p) {
            const merged = mergePlanIntoProject(p, r.workspacePlan);
            saveProject(merged); setProject(merged);
          }
          if (r.currentTab) setTab(r.currentTab);
        } else {
          /* No workspace yet — surface an explicit Generate CTA. */
          setNeedsGenerate(true);
          if (!p) setError('We couldn’t find this project locally. Open it from Project OS, or generate a workspace if a server copy exists.');
        }
      } catch (e) {
        if (alive) setError(e?.message || 'Failed to load the workspace.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  /* Open the Starter Pack preview automatically when navigated with
     openPackPreview (e.g. from the creation success panel). */
  const packAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (openPackPreview && plan && !packAutoOpenedRef.current) {
      packAutoOpenedRef.current = true;
      previewPack();
    }
  });

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
      setNotice('Project created and workspace generated — you are in it now. Use Preview Starter Pack or the Architecture tab next.');
    } catch (e) {
      setError(e?.message || 'Failed to create the custom project.');
    } finally { setBusyKey('create', false); }
  };

  /* Explicit generation for the Generate Workspace CTA. Never silent:
     failures keep the project saved and show a Retry. */
  const generateWorkspace = async () => {
    const p = project || getProject(projectId);
    if (!p && !projectId) { setError('No project selected.'); return; }
    setBusyKey('generate', true); setError('');
    try {
      const r = await WorkspaceApi.generate({ projectId: p?.id || projectId, project: p || {}, architectureSpec: p?.architectureSpec || null });
      if (r?.workspacePlan) {
        adoptPlan(r.workspacePlan, p);
        setNeedsGenerate(false);
        setTab('overview');
      } else {
        setError('Workspace generation failed — your project is saved; retry below.');
      }
    } catch (e) {
      setError((e?.message || 'Workspace generation failed') + ' — your project is saved; retry below.');
    } finally { setBusyKey('generate', false); }
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

  /* evidence: { repoUrl, liveUrl } from the Proof panel. Omitted (header
     button) means "re-check whatever is already on file". */
  const verify = async (evidence = null) => {
    if (!project || !plan) return;
    setBusyKey('verify', true);
    setError('');
    try {
      const r = await WorkspaceApi.verify(project.id, plan, evidence);
      if (r?.updatedWorkspacePlan) adoptPlan(r.updatedWorkspacePlan);
      const s = r?.verificationSummary;
      if (s && s.mode === 'local_only') {
        setNotice('Verification ran on local rules only — attach a repository or deployed URL in the Proof tab to verify GitHub and deployment items.');
      }
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

  /* Architecture refinements flow onto the project AND back into the
     workspace plan (architecture section + stale flags), then persist. */
  const onProjectPatch = async (patch) => {
    if (!project) return;
    const merged = { ...project, ...patch };
    saveProject(merged);
    setProject(merged);
    const touchesArchitecture = patch && (patch.architectureSpec || patch.architectureValidation || patch.mermaidViews);
    if (touchesArchitecture && plan) {
      try {
        const r = await WorkspaceApi.patch(project.id, {
          workspacePlan: plan,
          architecturePatch: {
            architectureSpec: patch.architectureSpec || null,
            validation: patch.architectureValidation || null,
            mermaidViews: patch.mermaidViews || null,
          },
        });
        if (r?.workspacePlan) {
          adoptPlan(r.workspacePlan, merged);
          if (r.architectureChanged) setNotice('Workspace plan may need recalculation after architecture changes.');
        }
      } catch {
        setNotice('Architecture saved to the project, but syncing it into the workspace plan failed — use Recalculate.');
      }
    }
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
    return <div className="grid min-h-[40vh] place-items-center"><div className="flex flex-col items-center gap-3"><Spinner className="h-7 w-7" /><p className="text-[13px] text-fg-muted">Preparing your workspace…</p></div></div>;
  }

  if (!plan) {
    // A project is "in hand" when we have a projectId that resolves locally (e.g.
    // just created from a marketplace idea) or an already-loaded project object.
    // In that case the project IS saved — we only need to generate its plan — so
    // we never surface the "details were not found locally" message.
    const hasProject = !!(project || (projectId && getProject(projectId)));
    return (
      <div>
        <PageIntro
          eyebrow="Guided Workspace"
          title="Project Workspace"
          sub={hasProject || needsGenerate ? 'This project is saved — generate its guided workspace plan.' : (error || 'No workspace yet.')}
        />
        <Card className="p-8 text-center">
          {error && !hasProject && <p className="mb-3 text-[13px] text-danger">{error}</p>}
          <p className="text-[13.5px] text-fg-secondary">
            {hasProject || needsGenerate
              ? 'This project is saved. Generate a guided workspace plan to get screens, APIs, tasks, tests, deployment steps, proof checklist, and starter-pack guidance.'
              : 'Open a project from Project OS, or create a custom project to get a guided build plan.'}
          </p>
          <div className="mt-5 flex justify-center gap-2.5">
            {hasProject || needsGenerate || projectId ? (
              <Button onClick={generateWorkspace} disabled={busy.generate}>
                {busy.generate ? <Spinner className="h-4 w-4" /> : null} {error ? 'Retry Generate Workspace' : 'Generate Workspace'}
              </Button>
            ) : (
              <Button onClick={() => setShowForm(true)}>Create Custom Project</Button>
            )}
            <Button variant="ghost" onClick={() => go?.('projectstudio')}>Back to Project OS</Button>
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
        onRegenerate={regenerate} onRecalculate={recalculate} onVerify={() => verify(null)} onExport={exportPlan}
      />
      {error && <Card className="border-rose-400/30 bg-rose-500/8 p-3.5 text-[12.5px] text-danger">{error}</Card>}
      {notice && (
        <Card className="flex items-center justify-between gap-3 border-amber-glow/25 bg-amber-glow/8 p-3.5 text-[12.5px] text-warn">
          <span>{notice}</span>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setNotice(''); recalculate(); }}>Recalculate now</Button>
            <Button size="sm" variant="ghost" onClick={() => setNotice('')}>Dismiss</Button>
          </div>
        </Card>
      )}

      {mode === 'build' ? (
        <GuidedPath
          plan={plan}
          project={project}
          onTaskPatch={patchTask}
          onPreviewCode={previewCode}
          onOpenBlueprint={() => setMode('blueprint')}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <Button size="sm" variant="ghost" onClick={() => setMode('build')}>
              <ChevronLeft size={14} /> Back to guided build
            </Button>
            <span className="text-[11.5px] text-fg-muted">Blueprint — the full plan behind your build. Explore freely; nothing here is required to finish.</span>
          </div>
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
              {tab === 'proof' && <WorkspaceProof {...sectionProps} onVerify={verify} verifying={busy.verify} />}
              {tab === 'patent' && <WorkspacePatent plan={plan} />}
            </main>
            {/* The inspector used to be a permanent flex sibling from `xl` up,
                which left the main column ~700px on a 1440px screen — that is
                what squeezed the task board. It is now inline only on very
                wide screens, and a slide-over everywhere else. */}
            {tab !== 'architecture' && (
              <div className="hidden 2xl:block">
                <WorkspaceInspector plan={plan} selected={selected} onClose={() => setSelected(null)} onPreviewCode={previewCode} />
              </div>
            )}
          </div>
        </>
      )}

      {/* Slide-over inspector below 2xl — full detail without stealing width
          from the board. */}
      {mode !== 'build' && tab !== 'architecture' && selected && (
        <div className="fixed inset-0 z-40 flex justify-end 2xl:hidden">
          <button
            aria-label="Close inspector"
            className="absolute inset-0 bg-scrim backdrop-blur-sm"
            onClick={() => setSelected(null)}
          />
          <div className="relative h-full w-full max-w-[400px] overflow-y-auto border-l border-subtle bg-base p-4 shadow-2xl">
            <WorkspaceInspector plan={plan} selected={selected} onClose={() => setSelected(null)} onPreviewCode={previewCode} />
          </div>
        </div>
      )}

      <CodePreviewPanel {...codePreview} onClose={() => setCodePreview((s) => ({ ...s, open: false }))} />
      <StarterPackPreview
        {...packPreview}
        onClose={() => setPackPreview((s) => ({ ...s, open: false }))}
        onDownload={downloadPack} downloading={busy.pack}
      />
    </div>
  );
}
