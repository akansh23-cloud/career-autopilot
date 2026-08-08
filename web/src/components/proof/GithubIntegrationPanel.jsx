import { useEffect, useState, useCallback } from 'react';
import {
  Github, ShieldCheck, Lock, Globe, RefreshCw, Plug, PlugZap, Link2, Eye, EyeOff,
  CheckCircle2, AlertTriangle, Loader2, Star, GitFork, Boxes, FileCode2, FlaskConical,
  Cloud, Container, Workflow, Unlink, Upload, ChevronDown, ChevronRight, Info, Brain,
} from 'lucide-react';
import { SectionCard } from '../../views/common.jsx';
import { Badge, Button, EmptyState, Modal, Spinner } from '../ui/kit.jsx';
import { GithubIntegration, consumeGithubReturnFlags, GH_ERROR_LABELS } from '../../lib/githubIntegration.js';
import { VivaSession } from './VivaSession.jsx';

function scoreTone(score) {
  return score >= 85 ? 'mint' : score >= 70 ? 'cyan' : score >= 50 ? 'amber' : 'default';
}
function statusLabel(s) {
  return { none: 'Not analyzed', partial: 'Partial proof', complete: 'Analyzed', error: 'Analysis failed' }[s] || s;
}

/* The private-repo explanation shown before installing the GitHub App. */
const PRIVATE_EXPLAINER =
  'Career Autopilot can verify private repositories only if you explicitly select them during GitHub App installation. We request read-only access and analyze only proof-related files such as README, dependency files, CI/CD files, Docker/Kubernetes/Terraform files, and project structure. Private repository details are hidden from public and recruiter profiles unless you choose to publish a safe proof summary.';

export default function GithubIntegrationPanel({ projects = [], onProofChanged }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [repos, setRepos] = useState([]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [installExplainerOpen, setInstallExplainerOpen] = useState(false);
  const [confirmPrivate, setConfirmPrivate] = useState(null); // repoId pending confirm
  const [visibilityRepo, setVisibilityRepo] = useState(null);
  const [linkRepo, setLinkRepo] = useState(null);
  const [analysisDetail, setAnalysisDetail] = useState(null);
  const [vivaRepo, setVivaRepo] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [status, repoList] = await Promise.all([
        GithubIntegration.status(),
        GithubIntegration.repositories().catch(() => ({ repositories: [] })),
      ]);
      setData(status);
      setRepos(repoList.repositories || []);
    } catch {
      setData({ ok: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const flags = consumeGithubReturnFlags();
    if (flags.error) setNotice({ type: 'error', text: GH_ERROR_LABELS[flags.error] || 'GitHub action could not be completed.' });
    else if (flags.connected) setNotice({ type: 'ok', text: 'GitHub identity connected.' });
    else if (flags.appInstalled) setNotice({ type: 'ok', text: 'GitHub App installed. Your selected repositories are ready to analyze.' });
    refresh();
  }, [refresh]);

  if (loading) {
    return <SectionCard title="GitHub verification"><div className="grid place-items-center py-10"><Spinner /></div></SectionCard>;
  }

  const oauthEnabled = data?.oauthEnabled;
  const appEnabled = data?.appEnabled;
  const conn = data?.connection;
  const installations = (data?.installations || []).filter((i) => i.status !== 'disconnected');
  const summary = data?.summary || {};
  const connected = conn?.connected;

  const notConfigured = !oauthEnabled && !appEnabled;

  const doSync = async () => {
    setBusy('sync');
    try { const r = await GithubIntegration.sync(); if (!r.ok) setNotice({ type: 'error', text: r.message || 'Sync failed.' }); await refresh(); onProofChanged?.(); }
    finally { setBusy(''); }
  };
  const doDisconnect = async () => {
    setBusy('disconnect');
    try { await GithubIntegration.disconnect(); await refresh(); onProofChanged?.(); }
    finally { setBusy(''); }
  };
  const doSyncRepos = async () => {
    setBusy('syncrepos');
    try { const r = await GithubIntegration.syncRepos(); setRepos(r.repositories || []); await refresh(); }
    finally { setBusy(''); }
  };
  const runAnalyze = async (repo, withConfirm = false) => {
    setBusy('analyze:' + repo.repoId);
    try {
      const r = await GithubIntegration.analyze(repo.repoId, { confirmPrivate: withConfirm });
      if (!r.ok) {
        if (r.error === 'confirm_private_required') { setConfirmPrivate(repo); return; }
        setNotice({ type: 'error', text: r.message || 'Analysis failed.' });
      } else {
        setAnalysisDetail({ repo: r.repo, analysis: r.analysis });
        await refresh();
        onProofChanged?.();
      }
    } finally { setBusy(''); setConfirmPrivate(null); }
  };

  return (
    <SectionCard
      title="GitHub verification"
      action={connected ? <Badge tone="mint"><ShieldCheck size={11} /> Connected via GitHub</Badge> : <Badge tone="default">Not connected</Badge>}
    >
      {notice && (
        <div className={`mb-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-[13px] ${notice.type === 'error' ? 'border-rose-400/30 bg-rose-400/10 text-rose-100' : 'border-aurora-mint/30 bg-aurora-mint/10 text-emerald-100'}`}>
          {notice.type === 'error' ? <AlertTriangle size={15} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={15} className="mt-0.5 shrink-0" />}
          <span>{notice.text}</span>
        </div>
      )}

      {notConfigured ? (
        <EmptyState icon={Github} title="GitHub integration is not configured" hint="This server does not have GitHub OAuth / GitHub App credentials set. You can still add a manual GitHub URL in Edit profile." />
      ) : (
        <div className="space-y-4">
          {/* ---- Identity connection state ---- */}
          {!connected ? (
            <div className="rounded-2xl border border-subtle bg-surface-1 p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-surface-1 text-fg ring-1 ring-white/10"><Github size={20} /></span>
                <div className="min-w-0">
                  <p className="font-medium text-fg">GitHub identity</p>
                  <p className="text-[12px] text-fg-secondary">Connect to verify ownership and sync public stats. Minimal scopes only (read:user, user:email) — no repo access.</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {oauthEnabled
                  ? <a href={GithubIntegration.connectUrl()}><Button size="sm"><Plug size={14} /> Connect GitHub</Button></a>
                  : <Badge tone="default">GitHub sign-in not configured</Badge>}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-aurora-mint/25 bg-aurora-mint/[0.04] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  {conn.avatarUrl
                    ? <img src={conn.avatarUrl} alt="" className="h-11 w-11 rounded-2xl ring-1 ring-white/10" />
                    : <span className="grid h-11 w-11 place-items-center rounded-2xl bg-surface-1 text-fg ring-1 ring-white/10"><Github size={20} /></span>}
                  <div>
                    <p className="font-medium text-fg">@{conn.handle}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone="mint"><ShieldCheck size={11} /> Connected via GitHub</Badge>
                      {conn.stats?.publicRepoCount != null && <Badge tone="cyan"><Boxes size={11} /> {conn.stats.publicRepoCount} repos</Badge>}
                      {conn.stats?.followers != null && <Badge tone="default"><Star size={11} /> {conn.stats.followers} followers</Badge>}
                    </div>
                  </div>
                </div>
              </div>
              {(conn.stats?.topLanguages || []).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {conn.stats.topLanguages.slice(0, 6).map((l) => <Badge key={l.name} tone="violet">{l.name}</Badge>)}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2 border-t border-subtle pt-3">
                <Button size="sm" variant="soft" onClick={doSync} disabled={busy === 'sync'}>{busy === 'sync' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync profile</Button>
                {conn.url && <a href={conn.url} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Globe size={14} /> Open GitHub</Button></a>}
                <Button size="sm" variant="soft" onClick={doDisconnect} disabled={busy === 'disconnect'}><Unlink size={14} /> Disconnect</Button>
              </div>
              {conn.lastSyncedAt && <p className="mt-2 text-[11px] text-fg-muted">Last synced {new Date(conn.lastSyncedAt).toLocaleString()}</p>}
            </div>
          )}

          {/* ---- GitHub App (repository verification) ---- */}
          <div className="rounded-2xl border border-subtle bg-surface-1 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-aurora-violet/15 text-aurora-cyan ring-1 ring-white/10"><PlugZap size={20} /></span>
                <div className="min-w-0">
                  <p className="font-medium text-fg">Repository verification (GitHub App)</p>
                  <p className="text-[12px] text-fg-secondary">Read-only access to the repositories you choose — public or private. Used to verify real proof-of-work.</p>
                </div>
              </div>
            </div>

            {installations.length === 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {appEnabled
                  ? <Button size="sm" onClick={() => setInstallExplainerOpen(true)}><Boxes size={14} /> Install GitHub App & choose repositories</Button>
                  : <Badge tone="default">GitHub App not configured</Badge>}
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-secondary">
                  {installations.map((i) => (
                    <Badge key={i.installationId} tone="cyan"><Boxes size={11} /> {i.accountLogin || 'installation'} · {i.repositorySelection === 'all' ? 'all repos' : 'selected repos'}</Badge>
                  ))}
                  <Badge tone="default">{summary.repositoriesAccessible || 0} accessible</Badge>
                  <Badge tone="default"><Globe size={11} /> {summary.publicReposAccessible || 0} public</Badge>
                  <Badge tone="amber"><Lock size={11} /> {summary.privateReposAccessible || 0} private</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={GithubIntegration.installUrl()}><Button size="sm" variant="soft"><Boxes size={14} /> Manage repositories</Button></a>
                  <Button size="sm" variant="soft" onClick={doSyncRepos} disabled={busy === 'syncrepos'}>{busy === 'syncrepos' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync repositories</Button>
                  {installations.map((i) => (
                    <Button key={i.installationId} size="sm" variant="soft" onClick={async () => { await GithubIntegration.disconnectInstallation(i.installationId); await refresh(); }}><Unlink size={14} /> Disconnect</Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ---- Repository verification panel ---- */}
          {repos.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-semibold uppercase tracking-widest text-fg-muted">Repositories</p>
                <Badge tone="violet">{summary.repositoriesAnalyzed || 0} analyzed</Badge>
              </div>
              {repos.map((r) => (
                <RepoRow
                  key={r.repoId}
                  repo={r}
                  busy={busy === 'analyze:' + r.repoId}
                  onAnalyze={() => runAnalyze(r, false)}
                  onVisibility={() => setVisibilityRepo(r)}
                  onLink={() => setLinkRepo(r)}
                  onImport={async () => { const res = await GithubIntegration.importProject(r.repoId); if (res.ok) setNotice({ type: 'ok', text: 'Project draft created from repository analysis.' }); else setNotice({ type: 'error', text: res.message || 'Analyze the repository first.' }); }}
                  onViva={() => setVivaRepo(r)}
                />
              ))}
            </div>
          )}

          <p className="rounded-xl border border-subtle bg-surface-1 px-3 py-2 text-[11px] leading-relaxed text-fg-muted">
            <Info size={12} className="-mt-0.5 mr-1 inline" />
            Private repositories are never exposed on your public or recruiter profile unless you opt in to a safe proof summary. Career Autopilot only ever reads proof files (README, dependency, CI/CD, Docker/Kubernetes/Terraform) — never secrets like .env or keys.
          </p>
        </div>
      )}

      {/* ---- Install explainer modal (private-repo safety) ---- */}
      <Modal open={installExplainerOpen} onClose={() => setInstallExplainerOpen(false)} title="Verify repositories with the GitHub App" width="max-w-xl">
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-fg-secondary">{PRIVATE_EXPLAINER}</p>
          <ul className="space-y-1.5 text-[13px] text-fg-secondary">
            <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-aurora-mint" /> Read-only access to only the repos you select</li>
            <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-aurora-mint" /> Private repos stay private by default</li>
            <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-aurora-mint" /> No write, admin, secret or delete permissions</li>
            <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-aurora-mint" /> Revoke anytime from GitHub settings</li>
          </ul>
          <div className="flex items-center justify-end gap-2 border-t border-subtle pt-4">
            <Button variant="soft" onClick={() => setInstallExplainerOpen(false)}>Cancel</Button>
            <a href={GithubIntegration.installUrl()}><Button><Boxes size={15} /> Install GitHub App and choose repositories</Button></a>
          </div>
        </div>
      </Modal>

      {/* ---- Private analyze confirmation ---- */}
      <Modal open={!!confirmPrivate} onClose={() => setConfirmPrivate(null)} title="Analyze a private repository?" width="max-w-md">
        {confirmPrivate && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-xl border border-amber-glow/30 bg-amber-glow/10 px-3 py-2.5 text-[13px] text-amber-100">
              <Lock size={15} className="mt-0.5 shrink-0" />
              <span>You are about to analyze a private repository. The analysis will remain private by default and will never appear on your public profile unless you explicitly enable a safe proof summary. Continue?</span>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="soft" onClick={() => setConfirmPrivate(null)}>Cancel</Button>
              <Button onClick={() => runAnalyze(confirmPrivate, true)}>Analyze privately</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ---- Visibility settings ---- */}
      <VisibilityModal repo={visibilityRepo} onClose={() => setVisibilityRepo(null)} onSaved={async () => { setVisibilityRepo(null); await refresh(); onProofChanged?.(); }} />

      {/* ---- Link to project ---- */}
      <LinkProjectModal repo={linkRepo} projects={projects} onClose={() => setLinkRepo(null)} onSaved={async () => { setLinkRepo(null); await refresh(); onProofChanged?.(); }} />

      {/* ---- Analysis detail ---- */}
      <AnalysisDetailModal data={analysisDetail} onClose={() => setAnalysisDetail(null)} />
      <VivaSession
        open={!!vivaRepo}
        onClose={() => setVivaRepo(null)}
        repoFullName={vivaRepo?.fullName || vivaRepo?.name || ''}
        skills={vivaRepo?.detectedSkills || []}
      />
    </SectionCard>
  );
}

const SKILL_ICONS = { Docker: Container, Kubernetes: Cloud, Terraform: Cloud, 'GitHub Actions': Workflow, Testing: FlaskConical };

function RepoRow({ repo, busy, onAnalyze, onVisibility, onLink, onImport, onViva }) {
  const [open, setOpen] = useState(false);
  const analyzed = repo.analysisStatus === 'complete' || repo.analysisStatus === 'partial';
  return (
    <div className={`rounded-2xl border bg-surface-1 p-3.5 ${repo.private ? 'border-amber-glow/20' : 'border-subtle'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FileCode2 size={15} className="shrink-0 text-fg-secondary" />
            <p className="truncate font-medium text-fg">{repo.fullName || repo.name}</p>
            {repo.private ? <Badge tone="amber"><Lock size={11} /> Private</Badge> : <Badge tone="cyan"><Globe size={11} /> Public</Badge>}
            {!repo.accessible && <Badge tone="default">No longer accessible</Badge>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-secondary">
            {repo.language && <Badge tone="default">{repo.language}</Badge>}
            {repo.pushedAt && <span>Updated {new Date(repo.pushedAt).toLocaleDateString()}</span>}
            {repo.linkedProjectId && <Badge tone="violet"><Link2 size={10} /> Linked</Badge>}
          </div>
          {repo.private && (
            <p className="mt-1.5 text-[11px] text-amber-100/80">Private repository. Hidden from public profile by default.</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {analyzed && <Badge tone={scoreTone(repo.proofScore)}>{repo.proofScore}/100</Badge>}
          <Badge tone="default">{statusLabel(repo.analysisStatus)}</Badge>
        </div>
      </div>

      {analyzed && (repo.detectedSkills || []).length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {repo.detectedSkills.slice(0, 8).map((s) => {
            const Icon = SKILL_ICONS[s];
            return <Badge key={s} tone="cyan">{Icon && <Icon size={10} />} {s}</Badge>;
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-subtle pt-3">
        <Button size="sm" variant={analyzed ? 'soft' : 'primary'} onClick={onAnalyze} disabled={busy || !repo.accessible}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} {analyzed ? 'Re-analyze' : 'Analyze'}
        </Button>
        {analyzed && <Button size="sm" variant="soft" onClick={onLink}><Link2 size={14} /> Link to project</Button>}
        {analyzed && <Button size="sm" variant="soft" onClick={onImport}><Upload size={14} /> Import as project</Button>}
        {analyzed && <Button size="sm" onClick={onViva}><Brain size={14} /> Take viva</Button>}
        {analyzed && <Button size="sm" variant="soft" onClick={onVisibility}><Eye size={14} /> Visibility</Button>}
        {(repo.evidence || []).length > 0 && (
          <Button size="sm" variant="soft" onClick={() => setOpen((o) => !o)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Evidence</Button>
        )}
      </div>

      {open && (repo.evidence || []).length > 0 && (
        <div className="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {repo.evidence.map((e) => (
            <div key={e.key} className="flex items-center gap-2 text-[12px]">
              {e.present ? <CheckCircle2 size={13} className="text-aurora-mint" /> : <AlertTriangle size={13} className="text-fg-muted" />}
              <span className={e.present ? 'text-fg' : 'text-fg-muted'}>{e.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VisibilityModal({ repo, onClose, onSaved }) {
  const [pub, setPub] = useState(false);
  const [priv, setPriv] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (repo) { setPub(!!repo.publicProofVisible); setPriv(!!repo.privateProofSummaryVisible); } }, [repo]);
  if (!repo) return null;
  const save = async () => {
    setSaving(true);
    try {
      await GithubIntegration.setVisibility(repo.repoId, repo.private ? { privateProofSummaryVisible: priv } : { publicProofVisible: pub });
      onSaved?.();
    } finally { setSaving(false); }
  };
  return (
    <Modal open={!!repo} onClose={onClose} title="Proof visibility" width="max-w-md">
      <div className="space-y-4">
        <p className="text-[13px] text-fg-secondary">{repo.fullName || repo.name}</p>
        {repo.private ? (
          <div className="space-y-2">
            <p className="text-[12px] text-fg-secondary">Private repositories are hidden by default. You can choose to publish a safe proof summary only (skills + evidence categories + score). Raw file names and content are never shared.</p>
            <Choice active={!priv} label="Keep fully private" hint="No proof appears on your public or recruiter profile." onClick={() => setPriv(false)} icon={EyeOff} />
            <Choice active={priv} label="Show safe proof summary only" hint="Verified skills, evidence categories and proof score — no repo name, URL or files." onClick={() => setPriv(true)} icon={ShieldCheck} />
          </div>
        ) : (
          <div className="space-y-2">
            <Choice active={!pub} label="Hidden from public profile" hint="Proof stays private to you." onClick={() => setPub(false)} icon={EyeOff} />
            <Choice active={pub} label="Show on public profile" hint="Repo name, proof score and detected skills are shown to recruiters." onClick={() => setPub(true)} icon={Eye} />
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-subtle pt-4">
          <Button variant="soft" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Save</Button>
        </div>
      </div>
    </Modal>
  );
}

function Choice({ active, label, hint, onClick, icon: Icon }) {
  return (
    <button onClick={onClick} className={`flex w-full items-start gap-2.5 rounded-xl border p-3 text-left transition ${active ? 'border-aurora-violet/50 bg-aurora-violet/[0.08]' : 'border-subtle bg-surface-1 hover:border-strong'}`}>
      <Icon size={16} className={`mt-0.5 shrink-0 ${active ? 'text-aurora-cyan' : 'text-fg-secondary'}`} />
      <span><span className="block text-sm font-medium text-fg">{label}</span><span className="block text-xs text-fg-secondary">{hint}</span></span>
    </button>
  );
}

function LinkProjectModal({ repo, projects, onClose, onSaved }) {
  const [sel, setSel] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (repo) setSel(repo.linkedProjectId || ''); }, [repo]);
  if (!repo) return null;
  const save = async () => {
    if (!sel) return;
    setSaving(true);
    try { await GithubIntegration.linkProject(repo.repoId, sel); onSaved?.(); } finally { setSaving(false); }
  };
  return (
    <Modal open={!!repo} onClose={onClose} title="Link repository to a project" width="max-w-md">
      <div className="space-y-3">
        <p className="text-[13px] text-fg-secondary">Linking adds this repository's verified evidence to a Career Autopilot project. Submit the project for verification to turn evidence into verified skills.</p>
        {projects.length ? (
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {projects.map((p) => (
              <button key={p.id} onClick={() => setSel(p.id)} className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition ${sel === p.id ? 'border-aurora-violet/50 bg-aurora-violet/[0.08] text-fg' : 'border-subtle bg-surface-1 text-fg-secondary hover:border-strong'}`}>
                <span className="truncate">{p.title || 'Untitled project'}</span>
                {sel === p.id && <CheckCircle2 size={15} className="text-aurora-cyan" />}
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-subtle bg-surface-1 px-3 py-2 text-[12px] text-fg-secondary">No projects yet — use "Import as project" to create one from this repo.</p>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-subtle pt-4">
          <Button variant="soft" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!sel || saving}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} Link</Button>
        </div>
      </div>
    </Modal>
  );
}

function AnalysisDetailModal({ data, onClose }) {
  if (!data) return null;
  const a = data.analysis || {};
  return (
    <Modal open={!!data} onClose={onClose} title="Repository analysis" width="max-w-lg">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Badge tone={scoreTone(a.score)}>{a.score}/100 · {a.level}</Badge>
          <Badge tone={a.visibility === 'private' ? 'amber' : 'cyan'}>{a.visibility === 'private' ? <Lock size={11} /> : <Globe size={11} />} {a.visibility}</Badge>
        </div>
        {(a.detectedStack || []).length > 0 && (
          <div><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted">Detected stack</p><div className="flex flex-wrap gap-1.5">{a.detectedStack.map((s) => <Badge key={s} tone="violet">{s}</Badge>)}</div></div>
        )}
        {(a.detectedSkills || []).length > 0 && (
          <div><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted">Detected skills (evidence)</p><div className="flex flex-wrap gap-1.5">{a.detectedSkills.map((s) => <Badge key={s} tone="cyan">{s}</Badge>)}</div></div>
        )}
        {(a.evidence || []).length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted">Evidence checklist</p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {a.evidence.map((e) => (
                <div key={e.key} className="flex items-center gap-2 text-[12px]">
                  {e.present ? <CheckCircle2 size={13} className="text-aurora-mint" /> : <AlertTriangle size={13} className="text-fg-muted" />}
                  <span className={e.present ? 'text-fg' : 'text-fg-muted'}>{e.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {a.truncated && <p className="rounded-xl border border-amber-glow/30 bg-amber-glow/10 px-3 py-2 text-[12px] text-amber-100">Repository too large for full analysis. Partial proof analysis completed.</p>}
        {(a.recommendations || []).length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted">Recommended improvements</p>
            <ul className="space-y-1 text-[12px] text-fg-secondary">{a.recommendations.map((r, i) => <li key={i} className="flex gap-2"><span className="text-aurora-cyan">›</span> {r}</li>)}</ul>
          </div>
        )}
        {a.verificationSummary && <p className="text-[12px] leading-relaxed text-fg-secondary">{a.verificationSummary}</p>}
        <div className="flex justify-end border-t border-subtle pt-4"><Button variant="soft" onClick={onClose}>Close</Button></div>
      </div>
    </Modal>
  );
}
