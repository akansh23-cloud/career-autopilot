/* ============================================================================
   TemplateBuilder.jsx — Template OS admin designer
   ----------------------------------------------------------------------------
   Builds TemplateDefinitions from approved primitives — never freeform
   positioning, never generated code. Everything on this screen is the same
   deterministic engine the runtime uses:

     controls → TemplateDefinition → layout compiler → live preview
              → DSL validation → real-PDF certification → store → publish

   Publishing is gated on measured certification AND a cleared license, both
   enforced server-side; this screen can request, not grant.
   ========================================================================== */
import { useEffect, useMemo, useState } from 'react';
import {
  Layers, ShieldCheck, AlertTriangle, Sparkles, Save, Upload, FileJson,
  CheckCircle2, RefreshCw, Wand2, ArrowUp, ArrowDown, PackageOpen,
} from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Spinner, Field, Input, EmptyState } from '../components/ui/kit.jsx';
import { useAuth } from '../hooks/useAuth.jsx';

import {
  PRIMITIVES, validateTemplateDefinition, compileTemplate, buildLayoutHTML,
  estimateGeometry, TEMPLATE_FIXTURES, thumbnailDataUri, cachedTemplatePreviewUrl, fallbackPreviewOnError, TEMPLATE_OS_BUILTINS,
  TEMPLATE_DSL_VERSION, READABILITY_FLOORS, TEMPLATE_PRIMARY_LIFECYCLE,
  templateDefinitionFingerprint, templateLifecycleSummary,
} from '../lib/templateOs/index.js';
import { TemplateOsApi } from '../lib/templateOsApi.js';

const cls = (...xs) => xs.filter(Boolean).join(' ');

const SECTIONS = ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements'];
const CAREER_STAGE_OPTIONS = [['student', 'Student'], ['early', 'Early'], ['mid', 'Mid'], ['senior', 'Senior'], ['executive', 'Executive']];

const LAYOUTS = [
  ['single-column', 'Single column'],
  ['sidebar-left', 'Sidebar left'],
  ['sidebar-right', 'Sidebar right'],
  ['two-column', 'Two column'],
];

const emptyDraft = () => ({
  dslVersion: TEMPLATE_DSL_VERSION,
  id: 'new-template',
  name: 'New Template',
  version: 1,
  status: 'DRAFT',
  category: 'professional',
  description: '',
  supportedRoles: [],
  careerStages: ['mid'],
  layout: { type: 'single-column' },
  sectionPlacement: {},
  sectionOrder: [...SECTIONS],
  headerStyle: { primitive: 'minimal' },
  skillStyle: { primitive: 'categorized' },
  experienceStyle: { primitive: 'classic' },
  projectStyle: { primitive: 'evidence' },
  sectionStyles: { divider: 'hairline' },
  typography: { preset: 'system-sans' },
  spacing: { preset: 'balanced' },
  colors: { preset: 'slate' },
  contentBudget: {},
  exports: { pdf: true, html: true, txt: true, docx: true, docxProfile: 'native' },
  license: { licenseStatus: 'INTERNAL_ORIGINAL', source: 'Career Autopilot design team', licenseName: '', licenseNotice: '', productionEnabled: true },
});

function Picker({ label, value, options, onChange, hint }) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([val, text]) => (
          <button key={val} type="button" onClick={() => onChange(val)}
            className={cls('rounded-lg border px-2 py-1 text-[11px] font-semibold transition',
              value === val ? 'border-aurora-violet/60 bg-aurora-violet/10 text-aurora-violet' : 'border-subtle text-muted hover:text-ink-950')}>
            {text}
          </button>
        ))}
      </div>
    </Field>
  );
}

const keysOf = (obj) => Object.keys(obj).map((k) => [k, k.replace(/-/g, ' ')]);

export default function TemplateBuilder() {
  const { user, loading: authLoading } = useAuth();
  const [adminGate, setAdminGate] = useState('checking');
  const [adminCapabilities, setAdminCapabilities] = useState([]);
  const isAdmin = adminGate === 'allowed';
  const [draft, setDraft] = useState(emptyDraft);
  const [fixtureId, setFixtureId] = useState('senior-technical');
  const [sizeId, setSizeId] = useState('a4');
  const [cert, setCert] = useState(null);
  const [certBusy, setCertBusy] = useState(false);
  const [saveState, setSaveState] = useState(null);
  const [stored, setStored] = useState([]);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [pkgReport, setPkgReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [activeVersion, setActiveVersion] = useState(null);
  const [savedFingerprint, setSavedFingerprint] = useState('');
  const [certifiedFingerprint, setCertifiedFingerprint] = useState('');
  const [activeStatus, setActiveStatus] = useState('DRAFT');
  const [versionHistory, setVersionHistory] = useState([]);
  const [historyFor, setHistoryFor] = useState('');
  const [generatorGoal, setGeneratorGoal] = useState({ targetRoles: 'devops', visualStyle: 'premium technical', atsPriority: 'high', layoutPreference: '', careerStage: 'mid', density: 'balanced', limit: 6 });
  const [generatorResult, setGeneratorResult] = useState(null);
  const [generatorBusy, setGeneratorBusy] = useState(false);

  const draftFingerprint = useMemo(() => templateDefinitionFingerprint(draft), [draft]);
  const fixture = useMemo(() => TEMPLATE_FIXTURES.find((f) => f.id === fixtureId) || TEMPLATE_FIXTURES[0], [fixtureId]);
  const validation = useMemo(() => validateTemplateDefinition(draft, { primitives: PRIMITIVES }), [draft]);
  const compiled = useMemo(() => (validation.ok ? compileTemplate(draft) : null), [draft, validation.ok]);
  const preview = useMemo(() => {
    if (!compiled?.ok) return null;
    try {
      return {
        html: buildLayoutHTML(compiled, fixture.structured, { sizeId }),
        geometry: estimateGeometry(compiled, fixture.structured, { sizeId }),
      };
    } catch { return null; }
  }, [compiled, fixture, sizeId]);

  const refreshStored = async () => {
    try { const r = await TemplateOsApi.list(); setStored(r.templates || []); } catch { /* offline */ }
  };
  const refreshHistory = async (templateId = draft.id) => {
    if (!templateId) return;
    try { const r = await TemplateOsApi.history(templateId); setVersionHistory(r.versions || []); setHistoryFor(templateId); } catch { setVersionHistory([]); setHistoryFor(templateId); }
  };
  useEffect(() => {
    let cancelled = false;
    if (authLoading) return () => { cancelled = true; };
    if (!user) { setAdminGate('denied'); return () => { cancelled = true; }; }
    setAdminGate('checking');
    TemplateOsApi.adminAccess()
      .then((r) => { if (!cancelled) { setAdminGate(r?.admin ? 'allowed' : 'denied'); setAdminCapabilities(r?.capabilities || []); } })
      .catch(() => { if (!cancelled) setAdminGate('denied'); });
    return () => { cancelled = true; };
  }, [user?.id, authLoading]);
  useEffect(() => { if (isAdmin) refreshStored(); }, [isAdmin]);

  if (authLoading || adminGate === 'checking') {
    return (
      <>
        <PageIntro eyebrow="Template OS" title="Template Builder" sub="Verifying server-side admin access." />
        <div className="flex min-h-48 items-center justify-center"><Spinner /></div>
      </>
    );
  }

  if (!isAdmin) {
    return (
      <>
        <PageIntro eyebrow="Template OS" title="Template Builder" sub="Internal design tool." />
        <EmptyState icon={ShieldCheck} title="Admins only" hint="Access is verified by the server before any draft, import, certification or publish operation is exposed." />
      </>
    );
  }

  const patch = (fn) => setDraft((d) => { const next = JSON.parse(JSON.stringify(d)); fn(next); return next; });
  const savedCurrent = !!activeVersion && savedFingerprint === draftFingerprint;
  const certifiedCurrent = !!cert?.certified && cert?.evidence === 'real-pdf-text-layer' && certifiedFingerprint === draftFingerprint && savedCurrent;
  const licenseCleared = !!draft.license?.productionEnabled && ['INTERNAL_ORIGINAL', 'OWNED', 'OPEN_SOURCE', 'LICENSED'].includes(String(draft.license?.licenseStatus || ''));
  const lifecycle = templateLifecycleSummary({ status: activeStatus, definition: draft, certification: cert });

  const setLayout = (type) => patch((d) => {
    d.layout = type === 'single-column' ? { type }
      : type === 'two-column' ? { type, columns: [{ id: 'left', width: 0.42 }, { id: 'right', width: 0.58 }] }
        : type === 'sidebar-left' ? { type, columns: [{ id: 'sidebar', width: 0.3 }, { id: 'main', width: 0.7 }] }
          : { type, columns: [{ id: 'main', width: 0.7 }, { id: 'sidebar', width: 0.3 }] };
    if (type === 'single-column') d.sectionPlacement = {};
    else {
      const railId = type === 'two-column' ? 'left' : 'sidebar';
      const mainId = type === 'two-column' ? 'right' : 'main';
      d.sectionPlacement = {
        skills: { region: railId, fallback: mainId },
        certifications: { region: railId, fallback: mainId },
        education: { region: railId, fallback: mainId },
        summary: mainId, experience: mainId, projects: mainId, achievements: mainId,
      };
    }
    d.exports = { ...d.exports, docxProfile: type === 'single-column' ? 'native' : 'simplified-single-column' };
  });

  const setRatio = (railWidth) => patch((d) => {
    if (!d.layout.columns) return;
    const railIdx = d.layout.columns.findIndex((c) => c.id === 'sidebar' || c.id === 'left');
    if (railIdx < 0) return;
    d.layout.columns[railIdx].width = railWidth;
    d.layout.columns[1 - railIdx].width = Number((1 - railWidth).toFixed(2));
  });

  const moveSection = (key, dir) => patch((d) => {
    const order = d.sectionOrder ? [...d.sectionOrder] : [...SECTIONS];
    const i = order.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    d.sectionOrder = order;
  });

  const setRegion = (key, region) => patch((d) => {
    if (d.layout.type === 'single-column') return;
    const rail = d.layout.columns.find((c) => c.id === 'sidebar' || c.id === 'left').id;
    const main = d.layout.columns.find((c) => c.id !== rail).id;
    d.sectionPlacement[key] = region === rail ? { region: rail, fallback: main } : { region: main, fallback: rail };
  });

  const runGenerator = async () => {
    setGeneratorBusy(true);
    setGeneratorResult(null);
    try {
      const payload = {
        targetRoles: String(generatorGoal.targetRoles || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 6),
        visualStyle: generatorGoal.visualStyle || '',
        atsPriority: generatorGoal.atsPriority,
        layoutPreference: generatorGoal.layoutPreference || null,
        careerStage: generatorGoal.careerStage,
        density: generatorGoal.density,
        limit: Number(generatorGoal.limit) || 6,
        persist: false,
      };
      const out = await TemplateOsApi.generate(payload);
      setGeneratorResult(out);
    } catch (e) {
      setGeneratorResult({ ok: false, error: e.message || 'Generation failed' });
    } finally { setGeneratorBusy(false); }
  };

  const loadGeneratedCandidate = (candidate) => {
    const def = candidate?.definition || candidate?.def;
    if (!def) return;
    const generated = JSON.parse(JSON.stringify(def));
    setDraft({
      ...emptyDraft(), ...generated, status: 'DRAFT',
      license: { ...(generated.license || {}), productionEnabled: false },
    });
    setActiveVersion(null); setSavedFingerprint(''); setCertifiedFingerprint(''); setCert(null); setActiveStatus('DRAFT');
    setVersionHistory([]); setHistoryFor('');
    setSaveState({ ok: true, message: `Loaded generated ${candidate.archetype || 'template'} candidate. Save creates the first immutable Builder version.` });
  };

  const runCertify = async () => {
    if (!savedCurrent) {
      setCert({ ok: false, error: 'Save this exact draft version before running production certification.' });
      return;
    }
    setCertBusy(true); setCert(null); setCertifiedFingerprint('');
    try {
      const r = await TemplateOsApi.certify({ definition: draft, templateId: draft.id, version: activeVersion, sizeIds: [sizeId] });
      setCert(r.certification);
      setActiveStatus(r.status || (r.certification?.certified ? 'CERTIFIED' : 'DRAFT'));
      if (r.certification?.certified && r.certification?.evidence === 'real-pdf-text-layer' && r.boundTo?.version === activeVersion) setCertifiedFingerprint(draftFingerprint);
      await refreshHistory(draft.id);
    } catch (e) { setCert({ ok: false, error: e.message }); }
    setCertBusy(false);
  };

  const saveDraft = async () => {
    setBusy(true); setSaveState(null); setCert(null); setCertifiedFingerprint('');
    try {
      const r = await TemplateOsApi.saveDefinition({ definition: draft, baseVersion: activeVersion || null, changeNote: activeVersion ? `Builder edit from v${activeVersion}` : 'Builder draft' });
      const version = r.saved?.version ?? 1;
      const next = { ...emptyDraft(), ...(r.definition || draft), version, status: 'DRAFT' };
      const fingerprint = templateDefinitionFingerprint(next);
      setDraft(next);
      setActiveVersion(version);
      setSavedFingerprint(fingerprint);
      setActiveStatus('DRAFT');
      setSaveState({ ok: true, message: `Saved immutable draft v${version}${r.forkedFrom ? ` from v${r.forkedFrom.version}` : ''}. Deep-certify this exact version next.` });
      await Promise.all([refreshStored(), refreshHistory(draft.id)]);
    } catch (e) { setSaveState({ ok: false, message: e.message }); }
    setBusy(false);
  };

  const approve = async () => {
    if (!certifiedCurrent || activeStatus !== 'CERTIFIED' || !licenseCleared) {
      setSaveState({ ok: false, message: 'Approval requires this exact saved version to be deep-certified and license-cleared.' });
      return;
    }
    setBusy(true); setSaveState(null);
    try {
      const r = await TemplateOsApi.setStatus({ templateId: draft.id, version: activeVersion, status: 'APPROVED', reason: 'builder_release_approval' });
      if (r.ok) setActiveStatus('APPROVED');
      setSaveState({ ok: r.ok, message: r.ok ? `Approved v${activeVersion}. It is not public yet.` : 'Approval rejected by the server.' });
      await Promise.all([refreshStored(), refreshHistory(draft.id)]);
    } catch (e) { setSaveState({ ok: false, message: `${e.message} — approval requires deep certification and cleared production rights.` }); }
    setBusy(false);
  };

  const publish = async () => {
    if (!certifiedCurrent || activeStatus !== 'APPROVED' || !licenseCleared) {
      setSaveState({ ok: false, message: 'Publish requires the exact version to be APPROVED, deep-certified, and license-cleared.' });
      return;
    }
    setBusy(true); setSaveState(null);
    try {
      const r = await TemplateOsApi.setStatus({ templateId: draft.id, version: activeVersion, status: 'PUBLISHED', reason: 'builder_production_publish' });
      if (r.ok) setActiveStatus('PUBLISHED');
      setSaveState({ ok: r.ok, message: r.ok ? `Published v${activeVersion}. Future content edits must fork a new version.` : 'Publish rejected by the server.' });
      await Promise.all([refreshStored(), refreshHistory(draft.id)]);
    } catch (e) { setSaveState({ ok: false, message: `${e.message} — publication cannot skip approval or lifecycle gates.` }); }
    setBusy(false);
  };

  const disableVersion = async () => {
    if (!activeVersion || activeStatus === 'DISABLED') return;
    setBusy(true); setSaveState(null);
    try {
      const r = await TemplateOsApi.setStatus({ templateId: draft.id, version: activeVersion, status: 'DISABLED', reason: 'builder_disable' });
      if (r.ok) setActiveStatus('DISABLED');
      setSaveState({ ok: r.ok, message: r.ok ? `Disabled v${activeVersion}. Saved documents retain their pinned version metadata; the runtime catalog no longer advertises this revision.` : 'Disable rejected.' });
      await Promise.all([refreshStored(), refreshHistory(draft.id)]);
    } catch (e) { setSaveState({ ok: false, message: e.message }); }
    setBusy(false);
  };



  const openStoredVersion = async (item) => {
    try {
      const r = await TemplateOsApi.get(item.templateId, item.version);
      const row = r.template;
      const next = { ...emptyDraft(), ...row.definition };
      const fingerprint = templateDefinitionFingerprint(next);
      const mustFork = ['PUBLISHED', 'DISABLED', 'GENERATED', 'LICENSE_PENDING'].includes(String(row.status || ''));
      setDraft(next);
      setActiveVersion(row.version);
      setActiveStatus(row.status || 'DRAFT');
      setSavedFingerprint(mustFork ? '' : fingerprint);
      setCert(row.certification || null);
      setCertifiedFingerprint(!mustFork && row.certification?.certified && row.certification?.evidence === 'real-pdf-text-layer' ? fingerprint : '');
      setSaveState(mustFork ? { ok: true, message: `${row.status} v${row.version} loaded as an edit source. Save creates a new DRAFT version; the source version stays immutable.` } : null);
      await refreshHistory(item.templateId);
    } catch (e) { setSaveState({ ok: false, message: e.message }); }
  };

  const loadPackage = async (file) => {
    if (!file) return;
    setBusy(true); setPkgReport(null);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read the file'));
        reader.readAsDataURL(file);
      });
      const r = await TemplateOsApi.importPackage({ packageBase64: base64 });
      setPkgReport(r);
      await refreshStored();
    } catch (e) { setPkgReport({ ok: false, error: e.message }); }
    setBusy(false);
  };

  const loadJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setDraft({ ...emptyDraft(), ...parsed });
      setActiveVersion(null); setActiveStatus('DRAFT'); setSavedFingerprint(''); setCertifiedFingerprint(''); setCert(null);
      setJsonOpen(false);
    } catch { setSaveState({ ok: false, message: 'That is not valid JSON.' }); }
  };

  const rail = draft.layout.columns?.find((c) => c.id === 'sidebar' || c.id === 'left');
  const order = draft.sectionOrder || SECTIONS;

  return (
    <>
      <PageIntro eyebrow="Template OS" title="Template Builder"
        sub={`Server-verified admin workspace · ${adminCapabilities.length} privileged capabilities · immutable versions with Draft → Certified → Approved → Published release gates.`}
        action={(
          <div className="flex flex-wrap gap-2">
            <Button variant="soft" onClick={() => { setDraft(emptyDraft()); setActiveVersion(null); setSavedFingerprint(''); setCertifiedFingerprint(''); setCert(null); setActiveStatus('DRAFT'); setVersionHistory([]); setHistoryFor(''); }}><RefreshCw size={14} /> Reset</Button>
            <Button variant="soft" onClick={() => { setJsonText(JSON.stringify(draft, null, 2)); setJsonOpen((v) => !v); }}><FileJson size={14} /> JSON</Button>
          </div>
        )} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* ---------------------------------------------------------- controls */}
        <div className="grid gap-4">
          <SectionCard title="Identity">
            <div className="grid gap-2">
              <Field label="Template id" hint="kebab-case, stable forever — versions change, ids don't">
                <Input value={draft.id} onChange={(e) => patch((d) => { d.id = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'); })} />
              </Field>
              <Field label="Name"><Input value={draft.name} onChange={(e) => patch((d) => { d.name = e.target.value; })} /></Field>
              <Field label="Description"><Input value={draft.description || ''} onChange={(e) => patch((d) => { d.description = e.target.value; })} /></Field>
              <Picker label="Category" value={draft.category} onChange={(v) => patch((d) => { d.category = v; })}
                options={[['technical', 'Technical'], ['professional', 'Professional'], ['student', 'Student'], ['executive', 'Executive'], ['ats-strict', 'ATS strict']]} />
              <Field label="Supported roles" hint="comma separated — drives recommendation">
                <Input value={(draft.supportedRoles || []).join(', ')}
                  onChange={(e) => patch((d) => { d.supportedRoles = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); })} />
              </Field>
              <Field label="Career stages" hint="Canonical Resume OS levels — select every stage this layout genuinely supports">
                <div className="flex flex-wrap gap-1.5">
                  {CAREER_STAGE_OPTIONS.map(([stage, label]) => {
                    const active = (draft.careerStages || []).includes(stage);
                    return (
                      <button key={stage} type="button" onClick={() => patch((d) => {
                        const current = new Set(d.careerStages || []);
                        if (current.has(stage)) current.delete(stage); else current.add(stage);
                        d.careerStages = CAREER_STAGE_OPTIONS.map(([x]) => x).filter((x) => current.has(x));
                      })}
                        className={cls('rounded-lg border px-2 py-1 text-[11px] font-semibold transition', active ? 'border-aurora-violet/60 bg-aurora-violet/10 text-aurora-violet' : 'border-subtle text-muted hover:text-ink-950')}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="Geometry">
            <div className="grid gap-2">
              <Picker label="Layout" value={draft.layout.type} onChange={setLayout} options={LAYOUTS} />
              {rail && (
                <Field label={`Rail width — ${Math.round(rail.width * 100)}% / ${Math.round((1 - rail.width) * 100)}%`}
                  hint={`Readable range ${READABILITY_FLOORS.minSidebarRatio * 100}–${READABILITY_FLOORS.maxSidebarRatio * 100}%`}>
                  <input type="range" min={READABILITY_FLOORS.minSidebarRatio * 100} max={READABILITY_FLOORS.maxSidebarRatio * 100}
                    value={Math.round(rail.width * 100)} onChange={(e) => setRatio(Number(e.target.value) / 100)} className="w-full" />
                </Field>
              )}
              <Picker label="Header" value={draft.headerStyle.primitive} options={keysOf(PRIMITIVES.headers)} onChange={(v) => patch((d) => { d.headerStyle.primitive = v; })} />
              <Picker label="Divider" value={draft.sectionStyles.divider} options={keysOf(PRIMITIVES.dividers)} onChange={(v) => patch((d) => { d.sectionStyles.divider = v; })} />
            </div>
          </SectionCard>

          <SectionCard title="Style">
            <div className="grid gap-2">
              <Picker label="Typography" value={draft.typography.preset} options={keysOf(PRIMITIVES.typography)} onChange={(v) => patch((d) => { d.typography = { preset: v }; })} />
              <Picker label="Spacing" value={draft.spacing.preset} options={keysOf(PRIMITIVES.spacing)} onChange={(v) => patch((d) => { d.spacing = { preset: v }; })} />
              <Picker label="Palette" value={draft.colors.preset} options={keysOf(PRIMITIVES.colors)} onChange={(v) => patch((d) => { d.colors = { preset: v }; })} />
              <Picker label="Skills" value={draft.skillStyle.primitive} options={keysOf(PRIMITIVES.skills)} onChange={(v) => patch((d) => { d.skillStyle.primitive = v; })} />
              <Picker label="Experience" value={draft.experienceStyle.primitive} options={keysOf(PRIMITIVES.experience)} onChange={(v) => patch((d) => { d.experienceStyle.primitive = v; })} />
              <Picker label="Projects" value={draft.projectStyle.primitive} options={keysOf(PRIMITIVES.projects)} onChange={(v) => patch((d) => { d.projectStyle.primitive = v; })} />
            </div>
          </SectionCard>

          <SectionCard title="Sections" eyebrow="Order is reading order — the DOM and the PDF follow it">
            <div className="grid gap-1">
              {order.map((key, i) => {
                const placed = draft.sectionPlacement?.[key];
                const region = typeof placed === 'string' ? placed : placed?.region;
                const railId = rail?.id;
                return (
                  <div key={key} className="flex items-center gap-1.5 rounded-lg border border-subtle px-2 py-1 text-[12px]">
                    <span className="w-5 text-muted">{i + 1}</span>
                    <span className="flex-1 font-semibold capitalize text-ink-950">{key}</span>
                    {railId && (
                      <span className="flex gap-1">
                        {[[railId, railId === 'left' ? 'Left' : 'Rail'], [draft.layout.columns.find((c) => c.id !== railId).id, 'Main']].map(([r, text]) => (
                          <button key={r} type="button" onClick={() => setRegion(key, r)}
                            className={cls('rounded px-1.5 py-0.5 text-[10px] font-bold', (region || 'main') === r ? 'bg-aurora-violet/15 text-aurora-violet' : 'text-muted hover:text-ink-950')}>{text}</button>
                        ))}
                      </span>
                    )}
                    <button type="button" onClick={() => moveSection(key, -1)} className="text-muted hover:text-ink-950" aria-label={`Move ${key} up`}><ArrowUp size={13} /></button>
                    <button type="button" onClick={() => moveSection(key, 1)} className="text-muted hover:text-ink-950" aria-label={`Move ${key} down`}><ArrowDown size={13} /></button>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard title="Content budget" eyebrow="How much this layout can hold before auto-fit intervenes">
            <div className="grid grid-cols-2 gap-2">
              {[['skills', 'preferredCount', 'Skills'], ['certifications', 'preferredCount', 'Certifications'], ['currentExperience', 'preferredBullets', 'Bullets (current role)'], ['projects', 'preferredCount', 'Projects']].map(([group, field, label]) => (
                <Field key={group} label={label}>
                  <Input type="number" min={0} value={draft.contentBudget?.[group]?.[field] ?? ''}
                    placeholder="default"
                    onChange={(e) => patch((d) => {
                      const v = e.target.value === '' ? undefined : Number(e.target.value);
                      d.contentBudget = d.contentBudget || {};
                      d.contentBudget[group] = { ...(d.contentBudget[group] || {}) };
                      if (v === undefined) delete d.contentBudget[group][field]; else d.contentBudget[group][field] = v;
                      if (!Object.keys(d.contentBudget[group]).length) delete d.contentBudget[group];
                    })} />
                </Field>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="License" eyebrow="Production rights are data, not code">
            <div className="grid gap-2">
              <Picker label="Status" value={draft.license.licenseStatus} onChange={(v) => patch((d) => { d.license.licenseStatus = v; })}
                options={[['INTERNAL_ORIGINAL', 'Internal original'], ['OWNED', 'Owned'], ['OPEN_SOURCE', 'Open source'], ['LICENSED', 'Licensed'], ['LICENSE_PENDING', 'Pending'], ['DEVELOPMENT_REFERENCE', 'Dev reference']]} />
              <label className="flex items-center gap-2 text-[12px] font-semibold text-ink-950">
                <input type="checkbox" checked={draft.license.productionEnabled}
                  onChange={(e) => patch((d) => { d.license.productionEnabled = e.target.checked; })} />
                Production enabled
              </label>
              <Field label="Source"><Input value={draft.license.source || ''} onChange={(e) => patch((d) => { d.license.source = e.target.value; })} /></Field>
            </div>
          </SectionCard>
        </div>

        {/* ----------------------------------------------------------- preview */}
        <div className="grid content-start gap-4">
          <SectionCard title="Live preview" action={(
            <div className="flex flex-wrap gap-1.5">
              {['a4', 'letter'].map((s) => <Button key={s} size="sm" variant={sizeId === s ? 'primary' : 'soft'} onClick={() => setSizeId(s)}>{s.toUpperCase()}</Button>)}
            </div>
          )}>
            <Field label="Fixture profile">
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_FIXTURES.map((f) => (
                  <button key={f.id} type="button" onClick={() => setFixtureId(f.id)}
                    className={cls('rounded-lg border px-2 py-1 text-[11px] font-semibold', fixtureId === f.id ? 'border-aurora-violet/60 bg-aurora-violet/10 text-aurora-violet' : 'border-subtle text-muted hover:text-ink-950')}>
                    {f.id.replace(/-/g, ' ')}
                  </button>
                ))}
              </div>
            </Field>
            {!validation.ok ? (
              <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-[12px]">
                <p className="flex items-center gap-1.5 font-semibold text-rose-700"><AlertTriangle size={13} /> This definition will not render</p>
                <ul className="ml-4 mt-1 list-disc text-rose-700">{validation.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            ) : preview ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                  <Badge tone="default">{preview.geometry.pageCount} page(s) est.</Badge>
                  <Badge tone={preview.geometry.overflowLines ? 'amber' : 'mint'}>{preview.geometry.overflowLines ? `${preview.geometry.overflowLines} lines over` : 'Fits'}</Badge>
                  <Badge tone="default">{Math.round(preview.geometry.utilization * 100)}% of page used</Badge>
                  <img src={thumbnailDataUri(draft, { width: 40, height: 56 })} alt="" className="ml-auto rounded border border-subtle" />
                </div>
                <div className="mt-2 h-[560px] overflow-hidden rounded-xl border border-subtle bg-surface-1">
                  <iframe title="Template preview" srcDoc={preview.html} sandbox=""
                    className="h-[1160px] w-[794px] origin-top-left border-0" style={{ transform: 'scale(0.72)' }} />
                </div>
              </>
            ) : <Spinner />}
          </SectionCard>

          <SectionCard title="Deterministic Generator" eyebrow="Phase 26 — structurally diverse candidates from approved primitives; no AI or generated code">
            <div className="grid gap-2 md:grid-cols-2">
              <Field label="Target roles" hint="Comma-separated; used only to choose role-family structures.">
                <Input value={generatorGoal.targetRoles} onChange={(e) => setGeneratorGoal((g) => ({ ...g, targetRoles: e.target.value }))} placeholder="DevOps Engineer, Platform Engineer" />
              </Field>
              <Field label="Visual direction"><Input value={generatorGoal.visualStyle} onChange={(e) => setGeneratorGoal((g) => ({ ...g, visualStyle: e.target.value }))} placeholder="premium technical / editorial / minimal" /></Field>
              <Picker label="Career stage" value={generatorGoal.careerStage} options={CAREER_STAGE_OPTIONS} onChange={(v) => setGeneratorGoal((g) => ({ ...g, careerStage: v }))} />
              <Picker label="Density" value={generatorGoal.density} options={[["compact","Compact"],["balanced","Balanced"],["spacious","Spacious"]]} onChange={(v) => setGeneratorGoal((g) => ({ ...g, density: v }))} />
              <Picker label="ATS priority" value={generatorGoal.atsPriority} options={[["high","High"],["balanced","Balanced"],["design","Design-forward"]]} onChange={(v) => setGeneratorGoal((g) => ({ ...g, atsPriority: v }))} />
              <Picker label="Layout preference" value={generatorGoal.layoutPreference} options={[["","Auto diversity"],["sidebar","Sidebar"],["single-column","Single column"],["two-column","Two column"]]} onChange={(v) => setGeneratorGoal((g) => ({ ...g, layoutPreference: v }))} />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button onClick={runGenerator} disabled={generatorBusy}>{generatorBusy ? <Spinner /> : <Wand2 size={14} />} Generate diverse candidates</Button>
              <span className="text-[11px] text-muted">Candidates are preview-only until explicitly loaded and saved.</span>
            </div>
            {generatorResult?.diversity && (
              <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px] md:grid-cols-5">
                <div className="rounded-lg border border-subtle px-2 py-1"><b>{generatorResult.diversity.uniqueArchetypes}</b><br /><span className="text-muted">archetypes</span></div>
                <div className="rounded-lg border border-subtle px-2 py-1"><b>{generatorResult.diversity.uniqueLayouts}</b><br /><span className="text-muted">layouts</span></div>
                <div className="rounded-lg border border-subtle px-2 py-1"><b>{Math.round((generatorResult.diversity.avgPairDistance || 0) * 100)}%</b><br /><span className="text-muted">avg structural distance</span></div>
                <div className="rounded-lg border border-subtle px-2 py-1"><b>{Math.round((generatorResult.diversity.minPairDistance || 0) * 100)}%</b><br /><span className="text-muted">minimum distance</span></div>
                <div className="rounded-lg border border-subtle px-2 py-1"><b>{generatorResult.kept || 0}</b><br /><span className="text-muted">survivors</span></div>
              </div>
            )}
            {generatorResult?.candidates?.length > 0 && (
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {generatorResult.candidates.map((c, i) => {
                  const def = c.definition || c.def;
                  return (
                    <div key={`${def?.id || i}`} className="rounded-xl border border-subtle p-2">
                      <div className="flex items-start gap-2">
                        <img src={thumbnailDataUri(def, { width: 86, height: 122 })} alt="Generated structural preview" className="w-[72px] rounded border border-subtle bg-white" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5"><b className="truncate text-[12px] text-ink-950">{def?.name}</b><Badge>{c.score}</Badge></div>
                          <p className="mt-0.5 text-[10px] text-muted">{c.rationale || `${def?.layout?.type} · ${def?.headerStyle?.primitive}`}</p>
                          <p className="mt-1 text-[10px] text-muted">ATS {c.certification?.atsLevel || def?.atsLevel || '—'} · diversity {c.diversityScore ?? '—'}%</p>
                          <Button size="sm" variant="soft" className="mt-1.5" onClick={() => loadGeneratedCandidate(c)}><Wand2 size={12} /> Load candidate</Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {generatorResult?.error && <p className="mt-2 text-[11px] font-semibold text-rose-600">{generatorResult.error}</p>}
          </SectionCard>

          <SectionCard title="Certification" eyebrow="Measured on real generated PDFs, across all fixtures"
            action={<Button size="sm" onClick={runCertify} disabled={!validation.ok || certBusy || !savedCurrent || activeStatus !== 'DRAFT'}>{certBusy ? <Spinner className="h-3.5 w-3.5" /> : <ShieldCheck size={13} />} Run parse checks</Button>}>
            {!cert ? <p className="text-[12px] text-muted">Generates a PDF per fixture, extracts its text layer, and measures field recovery and reading order. Slower than the preview — that is the point.</p> : (
              <div className="grid gap-1.5 text-[12px]">
                <p className={cls('flex items-center gap-1.5 font-semibold', cert.certified ? 'text-emerald-700' : 'text-amber-700')}>
                  {cert.certified ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {cert.label || 'Not certified'}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {[['Parse level (1 page)', cert.atsLevel?.replace('_', ' ')], ['Parse level (2 pages)', cert.atsLevelMultiPage?.replace('_', ' ') || '—'],
                    ['Field recovery', `${cert.minIntegrity}%`], ['Reading order', `${cert.minOrderScore}%`],
                    ['Max pages', cert.maxPages], ['Evidence', cert.evidence || 'html']].map(([k, v]) => (
                      <div key={k} className="rounded-lg border border-subtle px-2 py-1">
                        <span className="block text-[10px] uppercase tracking-wide text-muted">{k}</span>
                        <span className="font-semibold text-ink-950">{v}</span>
                      </div>
                  ))}
                </div>
                {cert.scorecard && (
                  <div className="mt-1 grid gap-0.5">
                    {Object.entries(cert.scorecard).filter(([, v]) => typeof v === 'number').map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2 text-[11px]">
                        <span className="w-44 shrink-0 text-muted">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded bg-surface-2"><span className="block h-full rounded bg-aurora-violet" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} /></span>
                        <span className="w-8 text-right font-semibold text-ink-950">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Lifecycle & release" eyebrow="Immutable version workflow — content edits always fork a new draft">
            <div className="mb-2 grid grid-cols-5 gap-1">
              {TEMPLATE_PRIMARY_LIFECYCLE.map((stage, i) => {
                const currentIndex = TEMPLATE_PRIMARY_LIFECYCLE.indexOf(activeStatus);
                const complete = currentIndex >= i && currentIndex >= 0;
                const current = activeStatus === stage;
                return (
                  <div key={stage} className={cls('rounded-lg border px-1.5 py-1 text-center text-[9px] font-bold tracking-wide',
                    current ? 'border-aurora-violet/60 bg-aurora-violet/10 text-aurora-violet'
                      : complete ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-subtle text-muted')}>
                    {stage}
                  </div>
                );
              })}
            </div>
            {!TEMPLATE_PRIMARY_LIFECYCLE.includes(activeStatus) && (
              <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-700">Current state: {activeStatus}</div>
            )}
            <div className="mb-2 grid grid-cols-2 gap-1.5 text-[10px]">
              <div className={cls('rounded-lg border px-2 py-1', savedCurrent ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-subtle text-muted')}>Exact version saved: {savedCurrent ? `v${activeVersion}` : 'No'}</div>
              <div className={cls('rounded-lg border px-2 py-1', certifiedCurrent ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-subtle text-muted')}>Deep PDF certified: {certifiedCurrent ? 'Yes' : 'No'}</div>
              <div className={cls('rounded-lg border px-2 py-1', licenseCleared ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700')}>License cleared: {licenseCleared ? 'Yes' : 'No'}</div>
              <div className="rounded-lg border border-subtle px-2 py-1 text-muted">Definition content: immutable after save</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={saveDraft} disabled={!validation.ok || busy || savedCurrent}><Save size={14} /> {activeVersion && !savedCurrent ? `Save as new version` : 'Save draft'}</Button>
              <Button variant="soft" onClick={approve} disabled={busy || activeStatus !== 'CERTIFIED' || !certifiedCurrent || !licenseCleared}><ShieldCheck size={14} /> Approve v{activeVersion || '—'}</Button>
              <Button variant="soft" onClick={publish} disabled={busy || activeStatus !== 'APPROVED' || !certifiedCurrent || !licenseCleared}><Sparkles size={14} /> Publish v{activeVersion || '—'}</Button>
              {activeVersion && activeStatus !== 'DISABLED' && <Button variant="ghost" onClick={disableVersion} disabled={busy}><AlertTriangle size={14} /> Disable</Button>}
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-subtle px-3 py-1.5 text-[13px] font-semibold text-ink-950 hover:border-strong">
                <PackageOpen size={14} /> Import .zip package
                <input type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => loadPackage(e.target.files?.[0])} />
              </label>
            </div>
            <p className="mt-1.5 text-[11px] text-muted">Release order is enforced by the server: save DRAFT → deep certification owns VALIDATING/CERTIFIED → explicit APPROVED → PUBLISHED. A published version is never edited in place; loading it for editing creates an unsaved fork that must become a new version.</p>
            {activeStatus === 'PUBLISHED' && <p className="mt-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">v{activeVersion} is live. Change any design field and Save will create a new DRAFT version; this published version stays unchanged.</p>}
            {lifecycle?.gates?.forkToEdit && !savedCurrent && activeVersion && <p className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">Editing from immutable v{activeVersion}. Saving will fork a new version before certification or release.</p>}
            {saveState && <p className={cls('mt-1.5 text-[12px] font-semibold', saveState.ok ? 'text-emerald-700' : 'text-rose-600')}>{saveState.message}</p>}
            {pkgReport && (
              <div className="mt-2 rounded-xl border border-subtle p-2 text-[11px]">
                <p className={cls('font-semibold', pkgReport.ok ? 'text-emerald-700' : 'text-rose-600')}>
                  {pkgReport.ok ? `Package imported as a draft — ${pkgReport.certification?.label}` : `Package rejected: ${pkgReport.error}`}
                </p>
                {pkgReport.note && <p className="text-muted">{pkgReport.note}</p>}
                {(pkgReport.package?.rejected || []).length > 0 && (
                  <ul className="ml-4 mt-1 list-disc text-muted">
                    {pkgReport.package.rejected.map((r, i) => <li key={i}>{r.name}: {r.reason}</li>)}
                  </ul>
                )}
                {(pkgReport.package?.css?.rejected || []).length > 0 && (
                  <p className="mt-1 text-muted">{pkgReport.package.css.rejected.length} CSS declaration(s) ignored — packages may only set approved palette variables.</p>
                )}
              </div>
            )}
          </SectionCard>

          {jsonOpen && (
            <SectionCard title="Definition JSON" action={<Button size="sm" variant="soft" onClick={loadJson}><Upload size={13} /> Load into builder</Button>}>
              <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} spellCheck={false}
                className="h-64 w-full rounded-xl border border-subtle bg-surface-1 p-2 font-mono text-[11px] text-ink-950" />
            </SectionCard>
          )}

          <SectionCard title="Stored templates" action={<Button size="sm" variant="ghost" onClick={refreshStored}><RefreshCw size={13} /> Refresh</Button>}>
            {!stored.length ? <p className="text-[12px] text-muted">Nothing stored yet — builtins live in code, drafts appear here.</p> : (
              <div className="grid gap-1">
                {stored.map((t) => (
                  <div key={`${t.templateId}:${t.version}`} className="flex items-center gap-2 rounded-lg border border-subtle px-2 py-1 text-[12px]">
                    <Layers size={13} className="text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink-950">{t.name || t.templateId}</span>
                      <span className="block truncate text-[10px] text-muted">{t.baseVersion ? `fork of v${t.baseVersion} · ` : ''}{t.lifecycleSummary?.deepCertified ? 'PDF certified' : 'not deep-certified'} · {t.license?.licenseStatus || 'license unknown'}</span>
                    </span>
                    <Badge tone={t.status === 'PUBLISHED' ? 'mint' : t.status === 'APPROVED' || t.status === 'CERTIFIED' ? 'default' : 'default'}>{t.status}</Badge>
                    <span className="text-muted">v{t.version}</span>
                    <Button size="sm" variant="ghost" onClick={() => refreshHistory(t.templateId)}><Layers size={12} /> History</Button>
                    <Button size="sm" variant="ghost" onClick={() => openStoredVersion(t)}><Wand2 size={12} /> {['PUBLISHED', 'DISABLED', 'GENERATED', 'LICENSE_PENDING'].includes(t.status) ? 'Fork' : 'Open'}</Button>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {historyFor && (
            <SectionCard title={`Version history — ${historyFor}`} eyebrow="Every content save is immutable; release state advances on that exact version">
              {!versionHistory.length ? <p className="text-[12px] text-muted">No stored version history is available.</p> : (
                <div className="grid gap-1.5">
                  {versionHistory.map((v) => (
                    <div key={`${v.templateId}:${v.version}`} className="rounded-lg border border-subtle px-2 py-1.5 text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-ink-950">v{v.version}</span>
                        <Badge tone={v.status === 'PUBLISHED' ? 'mint' : 'default'}>{v.status}</Badge>
                        {v.baseVersion && <span className="text-muted">from v{v.baseVersion}</span>}
                        <span className="ml-auto text-muted">{v.certification?.evidence === 'real-pdf-text-layer' ? 'deep certified' : 'not deep certified'}</span>
                        <Button size="sm" variant="ghost" onClick={() => openStoredVersion(v)}>{['PUBLISHED', 'DISABLED', 'GENERATED', 'LICENSE_PENDING'].includes(v.status) ? 'Fork' : 'Open'}</Button>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted">
                        <span>{v.license?.licenseStatus || 'license unknown'}</span>
                        {v.createdBy && <span>by {v.createdBy}</span>}
                        {v.lifecycle?.approvedAt && <span>approved {new Date(v.lifecycle.approvedAt).toLocaleString()}</span>}
                        {v.lifecycle?.publishedAt && <span>published {new Date(v.lifecycle.publishedAt).toLocaleString()}</span>}
                        {v.changeNote && <span>{v.changeNote}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          )}

          <SectionCard title="Shipped builtins" eyebrow="Start from a proven geometry instead of a blank page">
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATE_OS_BUILTINS.map((b) => (
                <button key={b.id} type="button" onClick={() => { setDraft({ ...emptyDraft(), ...JSON.parse(JSON.stringify(b)), id: `${b.id}-copy`, name: `${b.name} copy`, status: 'DRAFT' }); setActiveVersion(null); setSavedFingerprint(''); setCertifiedFingerprint(''); setCert(null); setActiveStatus('DRAFT'); setVersionHistory([]); setHistoryFor(''); }}
                  className="rounded-xl border border-subtle p-1.5 text-left transition hover:border-strong">
                  <img src={cachedTemplatePreviewUrl(b.id, { surface: 'resume-studio', templateVersion: b.version || 1 })}
                    onError={(event) => fallbackPreviewOnError(event, thumbnailDataUri(b, { width: 92, height: 130 }))}
                    alt={`${b.name} rendered template preview`} loading="lazy" decoding="async" className="mb-1 w-full rounded border border-subtle bg-white" />
                  <span className="block truncate text-[11px] font-semibold text-ink-950">{b.name}</span>
                </button>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
