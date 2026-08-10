/* ============================================================================
   ResumeStudio.jsx — Resume OS V3 canonical workspace
   ----------------------------------------------------------------------------
   One deterministic engine end to end:
     document (canonical model) → server compile (truth + ATS V3 + checks +
     JD match + ranking + NBA) → live paginated preview (same renderer as
     export) → local ATS parse round-trip → explainable Health rail.

   Design rules enforced here:
     • No AI anywhere in scoring/matching — every number is server-computed
       and every point carries a reason string.
     • Verification annotates, never gates: skills show ✓ VERIFIED / DECLARED.
     • Tailoring proposes a diff; the user Accepts/Rejects — never silent.
     • Content is never silently cut: fit engine reports, user decides.
   ========================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FileText, Plus, Sparkles, Target, ShieldCheck, Wrench, Palette, ChevronLeft,
  Download, Save, History, Trash2, ArrowUp, ArrowDown, Eye, EyeOff, CheckCircle2,
  AlertTriangle, XCircle, Info, Layers, FileType2, FileJson, FileDown,
  BadgeCheck, Hammer, ChevronRight, X, ListChecks, Printer,
} from 'lucide-react';
import { Button, Card, Badge, Spinner, Modal, Input, Field, EmptyState } from '../components/ui/kit.jsx';
import { PageIntro, SectionCard } from './common.jsx';
import {
  ResumeOsApi, setResumeOsUser, getCachedResumeOs, cacheResumeOs,
  normalizeResumeDocument, toRendererStructured, toPlainText, makeId,
  updateItemInSection, removeItemFromSection, moveItemInSection, moveSectionOrder,
  dismissCheck, isCheckDismissed, simulateAtsParse,
} from '../lib/resumeOs.js';
import {
  paginateResume, composePagedDocumentHTML, exportResumePDF, exportResumeDOCX,
  triggerDownload, canExportLayout,
} from '../lib/resumeRenderer.js';
import { RESUME_TEMPLATES, V3_TEMPLATES, getResumeTemplate } from '../lib/resumeTemplateRegistry.js';
import { ROLE_DICTIONARIES } from '../../../server/utils/resume/roleDictionaries.js';

/* ------------------------------------------------------------------ utils -- */
const cls = (...xs) => xs.filter(Boolean).join(' ');
function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
const SEV_META = {
  critical: { icon: XCircle, tone: 'text-rose-600', chip: 'bg-rose-50 text-rose-700 border-rose-200' },
  high: { icon: AlertTriangle, tone: 'text-amber-600', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  medium: { icon: Info, tone: 'text-sky-600', chip: 'bg-sky-50 text-sky-700 border-sky-200' },
  low: { icon: Info, tone: 'text-slate-500', chip: 'bg-slate-50 text-slate-600 border-slate-200' },
};
function ScoreRing({ score, size = 64, label = 'Score' }) {
  const s = Number.isFinite(score) ? score : 0;
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const tone = s >= 80 ? '#059669' : s >= 60 ? '#d97706' : '#e11d48';
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} title={`${label}: ${s}/100`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth="7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * s) / 100} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="absolute text-sm font-bold" style={{ color: tone }}>{Number.isFinite(score) ? s : '—'}</span>
    </div>
  );
}

/* =================================================================== WIZARD */
const ROLE_OPTIONS = Object.keys(ROLE_DICTIONARIES);
function CreateWizard({ onCreated, onCancel, hasDocs }) {
  const [step, setStep] = useState(0);
  const [source, setSource] = useState('profile');
  const [targetRole, setTargetRole] = useState('');
  const [templateId, setTemplateId] = useState('atlas');
  const [importText, setImportText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const create = async () => {
    setBusy(true); setErr('');
    try {
      const r = await ResumeOsApi.create({ source, targetRole, templateId, importText: source === 'import' ? importText : '' });
      onCreated(r.doc, r.importReview || null);
    } catch (e) { setErr(e.message || 'Create failed'); }
    setBusy(false);
  };

  const steps = ['Source', 'Target role', 'Template'];
  return (
    <div className="mx-auto max-w-2xl">
      <PageIntro eyebrow="Resume OS" title="Create a resume" sub="Seeded from what the platform already knows about you — with honest provenance on every line. Nothing is ever invented." />
      <Card className="p-6">
        <div className="mb-5 flex items-center gap-2 text-xs font-semibold text-muted">
          {steps.map((s, i) => (
            <span key={s} className={cls('rounded-full border px-3 py-1', i === step ? 'border-aurora-violet/50 bg-aurora-violet/10 text-aurora-violet' : 'border-subtle')}>{i + 1}. {s}</span>
          ))}
        </div>

        {step === 0 && (
          <div className="grid gap-3">
            {[
              { id: 'profile', title: 'From my Master Career Profile', sub: 'Verified projects and skills flow in with their real verification status. Recommended.', icon: BadgeCheck },
              { id: 'import', title: 'Import existing resume text', sub: 'Paste your current resume — extraction is shown for confirmation, never silently trusted.', icon: FileText },
              { id: 'blank', title: 'Start blank', sub: 'An empty canonical document you fill section by section.', icon: Plus },
            ].map((o) => (
              <button key={o.id} type="button" onClick={() => setSource(o.id)}
                className={cls('flex items-start gap-3 rounded-2xl border p-4 text-left transition', source === o.id ? 'border-aurora-violet/60 bg-aurora-violet/5 ring-1 ring-aurora-violet/30' : 'border-subtle hover:border-strong')}>
                <o.icon size={18} className="mt-0.5 text-aurora-violet" />
                <span><span className="block text-sm font-semibold text-ink-950">{o.title}</span><span className="block text-xs text-muted">{o.sub}</span></span>
              </button>
            ))}
            {source === 'import' && (
              <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={8}
                placeholder="Paste your full resume text here…"
                className="w-full rounded-xl border border-subtle bg-surface-1 p-3 text-sm outline-none focus:border-aurora-violet/50" />
            )}
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-3">
            <Field label="Target role" hint="Drives role-fit scoring, skill targeting and template recommendation. You can change it anytime.">
              <Input list="studio-roles" value={targetRole} onChange={(e) => setTargetRole(e.target.value)} placeholder="e.g. Data Engineer" />
              <datalist id="studio-roles">{ROLE_OPTIONS.map((r) => <option key={r} value={r} />)}</datalist>
            </Field>
            <div className="flex flex-wrap gap-2">
              {ROLE_OPTIONS.slice(0, 8).map((r) => (
                <button key={r} type="button" onClick={() => setTargetRole(r)} className="rounded-full border border-subtle px-3 py-1 text-xs capitalize text-muted hover:border-aurora-violet/50 hover:text-aurora-violet">{r}</button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {V3_TEMPLATES.map((t) => (
              <button key={t.id} type="button" onClick={() => setTemplateId(t.id)}
                className={cls('rounded-xl border p-3 text-left transition', templateId === t.id ? 'border-aurora-violet/60 bg-aurora-violet/5' : 'border-subtle hover:border-strong')}>
                <span className="block text-sm font-semibold text-ink-950">{t.name}</span>
                <span className="block text-[11px] capitalize text-muted">{t.category.replace('-', ' ')}</span>
                {t.strictAts && <span className="mt-1 inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">ATS Strict</span>}
              </button>
            ))}
          </div>
        )}

        {err && <p className="mt-3 text-sm text-rose-600">{err}</p>}
        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" onClick={step === 0 ? onCancel : () => setStep(step - 1)}>{step === 0 ? (hasDocs ? 'Cancel' : 'Back') : 'Back'}</Button>
          {step < 2
            ? <Button onClick={() => setStep(step + 1)} disabled={source === 'import' && step === 0 && importText.trim().length < 40}>Continue <ChevronRight size={14} /></Button>
            : <Button onClick={create} disabled={busy}>{busy ? <Spinner className="h-4 w-4" /> : <Sparkles size={14} />} Generate first draft</Button>}
        </div>
      </Card>
    </div>
  );
}

/* ================================================================ EDITOR UI */
function BulletRow({ bullet, onChange, onRemove, onQuantify }) {
  return (
    <div className="group flex items-start gap-2">
      <button type="button" title={bullet.enabled ? 'Hide from this resume' : 'Include'} onClick={() => onChange({ enabled: !bullet.enabled })} className="mt-2 text-muted hover:text-ink-950">
        {bullet.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
      </button>
      <div className="flex-1">
        <textarea value={bullet.text} rows={Math.min(4, Math.max(1, Math.ceil(bullet.text.length / 90)))}
          onChange={(e) => onChange({ text: e.target.value })}
          className={cls('w-full resize-none rounded-lg border bg-surface-1 px-2 py-1.5 text-[13px] leading-snug outline-none focus:border-aurora-violet/50', bullet.enabled ? 'border-subtle' : 'border-dashed border-subtle opacity-50')} />
        <div className="flex items-center gap-2 text-[10px] text-muted">
          {bullet.verified && <span className="inline-flex items-center gap-0.5 font-semibold text-emerald-600"><BadgeCheck size={10} /> Verified source</span>}
          {!/\d/.test(bullet.text) && bullet.text.length > 20 && (
            <button type="button" onClick={onQuantify} className="text-aurora-violet hover:underline">Add a number?</button>
          )}
        </div>
      </div>
      <button type="button" onClick={onRemove} className="mt-2 text-muted opacity-0 transition group-hover:opacity-100 hover:text-rose-600"><Trash2 size={13} /></button>
    </div>
  );
}

function ItemCard({ item, section, title, sub, onPatch, onRemove, onMove, children }) {
  return (
    <div className={cls('rounded-xl border p-3', item.enabled ? 'border-subtle bg-surface-1' : 'border-dashed border-subtle opacity-60')}>
      <div className="mb-2 flex items-center gap-2">
        <button type="button" onClick={() => onPatch({ enabled: !item.enabled })} title={item.enabled ? 'Hide from this resume' : 'Include'} className="text-muted hover:text-ink-950">
          {item.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-950">{title || `New ${section}`}</p>
          {sub && <p className="truncate text-[11px] text-muted">{sub}</p>}
        </div>
        {item.verified && <Badge tone="mint"><BadgeCheck size={10} /> Verified</Badge>}
        <button type="button" onClick={() => onMove(-1)} className="text-muted hover:text-ink-950"><ArrowUp size={13} /></button>
        <button type="button" onClick={() => onMove(1)} className="text-muted hover:text-ink-950"><ArrowDown size={13} /></button>
        <button type="button" onClick={onRemove} className="text-muted hover:text-rose-600"><Trash2 size={13} /></button>
      </div>
      {children}
    </div>
  );
}

const TXT = 'w-full rounded-lg border border-subtle bg-surface-1 px-2 py-1.5 text-[13px] outline-none focus:border-aurora-violet/50';

function ContentTab({ doc, setDoc, onQuantify }) {
  const patchContact = (k, v) => setDoc({ ...doc, contact: { ...doc.contact, [k]: v } });
  const patchItem = (section, id, patch) => setDoc(updateItemInSection(doc, section, id, patch));
  const patchBullet = (section, itemId, bulletId, patch) => {
    const item = doc[section].find((x) => x.id === itemId);
    const bullets = item.bullets.map((b) => (b.id === bulletId ? { ...b, ...patch, ...(patch.text != null && patch.text !== b.text ? { userConfirmed: true } : {}) } : b));
    patchItem(section, itemId, { bullets });
  };
  const addBullet = (section, itemId) => {
    const item = doc[section].find((x) => x.id === itemId);
    patchItem(section, itemId, { bullets: [...item.bullets, { id: makeId('b'), text: '', enabled: true, sourceType: 'user', provenance: 'USER_ENTERED', userConfirmed: true, evidenceIds: [], verified: false }] });
  };
  const addItem = (section, seed) => setDoc({ ...doc, [section]: [...doc[section], normalizeResumeDocument({ ...doc, [section]: [seed] })[section][0]] });

  return (
    <div className="grid gap-4">
      <SectionCard title="Contact">
        <div className="grid grid-cols-2 gap-2">
          {[['name', 'Full name'], ['title', 'Headline / title'], ['email', 'Email'], ['phone', 'Phone'], ['location', 'Location'], ['linkedin', 'LinkedIn'], ['github', 'GitHub'], ['portfolio', 'Portfolio']].map(([k, label]) => (
            <input key={k} className={TXT} placeholder={label} value={doc.contact[k] || ''} onChange={(e) => patchContact(k, e.target.value)} />
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Summary">
        <textarea rows={3} className={TXT} placeholder="2–3 lines. Facts you can stand behind — the Truth Engine reads this too."
          value={doc.summary} onChange={(e) => setDoc({ ...doc, summary: e.target.value })} />
      </SectionCard>

      <SectionCard title="Experience" action={<Button size="sm" variant="soft" onClick={() => addItem('experience', { company: '', role: '', enabled: true })}><Plus size={13} /> Add</Button>}>
        <div className="grid gap-2">
          {doc.experience.map((e2) => (
            <ItemCard key={e2.id} item={e2} section="experience" title={e2.role || e2.company} sub={[e2.company, e2.dates || [e2.startDate, e2.current ? 'Present' : e2.endDate].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}
              onPatch={(p) => patchItem('experience', e2.id, p)} onRemove={() => setDoc(removeItemFromSection(doc, 'experience', e2.id))} onMove={(d) => setDoc(moveItemInSection(doc, 'experience', e2.id, d))}>
              <div className="mb-2 grid grid-cols-2 gap-2">
                <input className={TXT} placeholder="Role / title" value={e2.role} onChange={(ev) => patchItem('experience', e2.id, { role: ev.target.value })} />
                <input className={TXT} placeholder="Company" value={e2.company} onChange={(ev) => patchItem('experience', e2.id, { company: ev.target.value })} />
                <input className={TXT} placeholder="Start (e.g. Jun 2023)" value={e2.startDate} onChange={(ev) => patchItem('experience', e2.id, { startDate: ev.target.value })} />
                <div className="flex items-center gap-2">
                  <input className={TXT} placeholder="End (e.g. May 2025)" disabled={e2.current} value={e2.current ? 'Present' : e2.endDate} onChange={(ev) => patchItem('experience', e2.id, { endDate: ev.target.value })} />
                  <label className="flex items-center gap-1 text-[11px] text-muted"><input type="checkbox" checked={e2.current} onChange={(ev) => patchItem('experience', e2.id, { current: ev.target.checked })} /> Now</label>
                </div>
              </div>
              <div className="grid gap-1.5">
                {e2.bullets.map((b) => (
                  <BulletRow key={b.id} bullet={b} onChange={(p) => patchBullet('experience', e2.id, b.id, p)}
                    onRemove={() => patchItem('experience', e2.id, { bullets: e2.bullets.filter((x) => x.id !== b.id) })}
                    onQuantify={() => onQuantify(b.text)} />
                ))}
                <button type="button" onClick={() => addBullet('experience', e2.id)} className="self-start text-xs font-semibold text-aurora-violet hover:underline">+ bullet</button>
              </div>
            </ItemCard>
          ))}
          {!doc.experience.length && <p className="text-xs text-muted">No experience yet — students lead with verified projects instead.</p>}
        </div>
      </SectionCard>

      <SectionCard title="Projects" action={<Button size="sm" variant="soft" onClick={() => addItem('projects', { name: '', enabled: true })}><Plus size={13} /> Add</Button>}>
        <div className="grid gap-2">
          {doc.projects.map((p) => (
            <ItemCard key={p.id} item={p} section="projects" title={p.name} sub={p.techStack}
              onPatch={(x) => patchItem('projects', p.id, x)} onRemove={() => setDoc(removeItemFromSection(doc, 'projects', p.id))} onMove={(d) => setDoc(moveItemInSection(doc, 'projects', p.id, d))}>
              <div className="mb-2 grid grid-cols-2 gap-2">
                <input className={TXT} placeholder="Project name" value={p.name} onChange={(ev) => patchItem('projects', p.id, { name: ev.target.value })} />
                <input className={TXT} placeholder="Tech stack (comma separated)" value={p.techStack} onChange={(ev) => patchItem('projects', p.id, { techStack: ev.target.value })} />
                <input className={cls(TXT, 'col-span-2')} placeholder="Link (GitHub / live demo)" value={p.link} onChange={(ev) => patchItem('projects', p.id, { link: ev.target.value })} />
              </div>
              <div className="grid gap-1.5">
                {p.bullets.map((b) => (
                  <BulletRow key={b.id} bullet={b} onChange={(x) => patchBullet('projects', p.id, b.id, x)}
                    onRemove={() => patchItem('projects', p.id, { bullets: p.bullets.filter((y) => y.id !== b.id) })}
                    onQuantify={() => onQuantify(b.text)} />
                ))}
                <button type="button" onClick={() => addBullet('projects', p.id)} className="self-start text-xs font-semibold text-aurora-violet hover:underline">+ bullet</button>
              </div>
            </ItemCard>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Skills" action={null}>
        <p className="mb-2 text-[11px] text-muted">✓ VERIFIED comes from platform verification and cannot be self-assigned. DECLARED skills may be listed — bullets should never imply unverified hands-on use (the Truth Engine flags it).</p>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {doc.skills.map((s) => (
            <span key={s.id} className={cls('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', !s.enabled ? 'border-dashed opacity-50' : s.status === 'VERIFIED' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-subtle bg-surface-1 text-ink-950')}>
              {s.status === 'VERIFIED' && <BadgeCheck size={10} />}{s.name}
              <button type="button" title={s.enabled ? 'Hide' : 'Include'} onClick={() => patchItem('skills', s.id, { enabled: !s.enabled })} className="text-muted hover:text-ink-950">{s.enabled ? <EyeOff size={9} /> : <Eye size={9} />}</button>
              <button type="button" onClick={() => setDoc(removeItemFromSection(doc, 'skills', s.id))} className="text-muted hover:text-rose-600"><X size={9} /></button>
            </span>
          ))}
        </div>
        <SkillAdder onAdd={(name) => setDoc({ ...doc, skills: [...doc.skills, { id: makeId('sk'), name, status: 'DECLARED', enabled: true, group: '' }] })} />
      </SectionCard>

      <SectionCard title="Education" action={<Button size="sm" variant="soft" onClick={() => addItem('education', { school: '', enabled: true })}><Plus size={13} /> Add</Button>}>
        <div className="grid gap-2">
          {doc.education.map((e3) => (
            <ItemCard key={e3.id} item={e3} section="education" title={e3.school} sub={e3.degree}
              onPatch={(p) => patchItem('education', e3.id, p)} onRemove={() => setDoc(removeItemFromSection(doc, 'education', e3.id))} onMove={(d) => setDoc(moveItemInSection(doc, 'education', e3.id, d))}>
              <div className="grid grid-cols-2 gap-2">
                <input className={TXT} placeholder="School" value={e3.school} onChange={(ev) => patchItem('education', e3.id, { school: ev.target.value })} />
                <input className={TXT} placeholder="Degree" value={e3.degree} onChange={(ev) => patchItem('education', e3.id, { degree: ev.target.value })} />
                <input className={cls(TXT, 'col-span-2')} placeholder="Dates (e.g. 2022 – 2026)" value={e3.dates} onChange={(ev) => patchItem('education', e3.id, { dates: ev.target.value })} />
              </div>
            </ItemCard>
          ))}
        </div>
      </SectionCard>

      <SimpleListSection doc={doc} setDoc={setDoc} section="certifications" title="Certifications" />
      <SimpleListSection doc={doc} setDoc={setDoc} section="achievements" title="Achievements" />

      <SectionCard title="Section order">
        <div className="grid gap-1">
          {doc.sectionOrder.map((k) => (
            <div key={k} className="flex items-center justify-between rounded-lg border border-subtle bg-surface-1 px-2 py-1 text-xs capitalize">
              <span>{k}</span>
              <span className="flex gap-1">
                <button type="button" onClick={() => setDoc(moveSectionOrder(doc, k, -1))} className="text-muted hover:text-ink-950"><ArrowUp size={12} /></button>
                <button type="button" onClick={() => setDoc(moveSectionOrder(doc, k, 1))} className="text-muted hover:text-ink-950"><ArrowDown size={12} /></button>
              </span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

function SkillAdder({ onAdd }) {
  const [v, setV] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(''); } }} className="flex gap-2">
      <input className={TXT} placeholder="Add a skill…" value={v} onChange={(e) => setV(e.target.value)} />
      <Button size="sm" type="submit" variant="soft"><Plus size={13} /></Button>
    </form>
  );
}

function SimpleListSection({ doc, setDoc, section, title }) {
  const items = doc[section];
  return (
    <SectionCard title={title} action={<Button size="sm" variant="soft" onClick={() => setDoc({ ...doc, [section]: [...items, { id: makeId('x'), text: '', enabled: true }] })}><Plus size={13} /> Add</Button>}>
      <div className="grid gap-1.5">
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-2">
            <button type="button" onClick={() => setDoc(updateItemInSection(doc, section, it.id, { enabled: !it.enabled }))} className="text-muted hover:text-ink-950">{it.enabled ? <Eye size={13} /> : <EyeOff size={13} />}</button>
            <input className={cls(TXT, !it.enabled && 'opacity-50')} value={it.text} onChange={(e) => setDoc(updateItemInSection(doc, section, it.id, { text: e.target.value }))} />
            <button type="button" onClick={() => setDoc(removeItemFromSection(doc, section, it.id))} className="text-muted hover:text-rose-600"><Trash2 size={13} /></button>
          </div>
        ))}
        {!items.length && <p className="text-xs text-muted">None yet.</p>}
      </div>
    </SectionCard>
  );
}

/* ---------------------------------------------------------------- Target -- */
function TargetTab({ doc, setDoc, compile, tailorState, onRunTailor, onApplyProposal, go }) {
  const match = compile?.match;
  return (
    <div className="grid gap-4">
      <SectionCard title="Target role">
        <Input list="studio-roles-2" value={doc.targetRole} onChange={(e) => setDoc({ ...doc, targetRole: e.target.value })} placeholder="e.g. Data Engineer" />
        <datalist id="studio-roles-2">{ROLE_OPTIONS.map((r) => <option key={r} value={r} />)}</datalist>
      </SectionCard>
      <SectionCard title="Job description" action={doc.targetJobDescription?.trim().length >= 40 ? <Button size="sm" variant="soft" onClick={onRunTailor} disabled={tailorState.busy}>{tailorState.busy ? <Spinner className="h-3.5 w-3.5" /> : <Hammer size={13} />} Tailor</Button> : null}>
        <textarea rows={7} className={TXT} placeholder="Paste the full job description to unlock weighted JD matching (must-have skills weigh 3×) and tailoring."
          value={doc.targetJobDescription} onChange={(e) => setDoc({ ...doc, targetJobDescription: e.target.value })} />
      </SectionCard>

      {match && (
        <SectionCard title={`Job match — ${match.overall}%`} eyebrow={match.jobTitle || undefined}>
          <div className="mb-3 grid gap-1.5">
            {Object.entries({ requiredSkills: 'Required skills', verifiedEvidence: 'Verified evidence', experienceAlignment: 'Experience alignment', preferredSkills: 'Preferred skills', education: 'Education' }).map(([k, label]) => (
              <div key={k}>
                <div className="mb-0.5 flex justify-between text-[11px]"><span className="text-muted">{label}</span><span className="font-semibold text-ink-950">{match.breakdown[k]}%</span></div>
                <div className="h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-aurora-violet" style={{ width: `${match.breakdown[k]}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="grid gap-2 text-[12px]">
            {match.strong.length > 0 && (
              <div><p className="mb-1 font-semibold text-emerald-700">Strong</p><div className="flex flex-wrap gap-1">{match.strong.map((s) => <span key={s.skill + s.tier} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">{s.status === 'VERIFIED' ? <BadgeCheck size={10} /> : <CheckCircle2 size={10} />}{s.skill}<span className="text-[9px] uppercase opacity-70">{s.status}</span></span>)}</div></div>
            )}
            {match.weak.length > 0 && (
              <div><p className="mb-1 font-semibold text-amber-700">Listed but never shown in use</p><div className="flex flex-wrap gap-1">{match.weak.map((s) => <span key={s.skill + s.tier} className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">○ {s.skill}</span>)}</div></div>
            )}
            {match.missing.length > 0 && (
              <div><p className="mb-1 font-semibold text-rose-700">Missing</p><div className="flex flex-wrap gap-1">{match.missing.map((s) => <span key={s.skill + s.tier} className={cls('rounded-full px-2 py-0.5', s.provable ? 'bg-sky-50 text-sky-700' : 'bg-rose-50 text-rose-700')}>✕ {s.skill}{s.provable && ' (verified evidence exists!)'}</span>)}</div></div>
            )}
          </div>
          {match.actions.length > 0 && (
            <div className="mt-3 grid gap-1.5">
              {match.actions.slice(0, 3).map((a, i) => (
                <button key={i} type="button"
                  onClick={() => { if (a.cta?.view === 'projectstudio') go('projectstudio', { intent: a.cta.context }); }}
                  className="rounded-lg border border-subtle bg-surface-1 px-2.5 py-1.5 text-left text-[12px] hover:border-aurora-violet/40">
                  <span className="font-semibold text-ink-950">{a.label}</span>
                  {a.cta?.view === 'projectstudio' && <span className="ml-1 text-aurora-violet">Build it →</span>}
                </button>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {tailorState.proposal && (
        <SectionCard title="Tailoring proposal" eyebrow="You decide — nothing is applied silently">
          <div className="grid max-h-72 gap-1.5 overflow-auto pr-1">
            {tailorState.proposal.decisions.map((d, i) => (
              <div key={i} className="rounded-lg border border-subtle bg-surface-1 px-2.5 py-1.5 text-[12px]">
                <span className={cls('mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', d.action === 'keep_project' ? 'bg-emerald-50 text-emerald-700' : d.action === 'hide_project' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700')}>{d.action.replace('_', ' ')}</span>
                <span className="text-muted">{d.reason}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={onApplyProposal}><CheckCircle2 size={13} /> Accept selection</Button>
            <Button size="sm" variant="ghost" onClick={() => tailorState.clear()}>Reject</Button>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- Evidence -- */
function EvidenceTab({ compile, doc, setDoc, go }) {
  const truth = compile?.truth;
  const opps = compile?.opportunities || [];
  const addVerifiedSkill = (name) => setDoc({ ...doc, skills: [...doc.skills, { id: makeId('sk'), name, status: 'VERIFIED', enabled: true, group: '' }] });
  return (
    <div className="grid gap-4">
      <SectionCard title="Truth Engine" eyebrow={truth ? `${truth.summary.totalClaims} claims audited` : undefined}>
        {!truth ? <p className="text-xs text-muted">Compile runs automatically as you edit.</p> : (
          <>
            <div className="mb-3 grid grid-cols-3 gap-2 text-center">
              {[['VERIFIED', truth.summary.counts.VERIFIED || 0, 'text-emerald-700 bg-emerald-50'], ['DECLARED', (truth.summary.counts.PROFILE_CONFIRMED || 0) + (truth.summary.counts.USER_ENTERED || 0), 'text-slate-700 bg-slate-50'], ['UNSUPPORTED', truth.summary.unsupported, 'text-rose-700 bg-rose-50']].map(([label, n, tone]) => (
                <div key={label} className={cls('rounded-xl p-2', tone)}><p className="text-lg font-bold">{n}</p><p className="text-[10px] font-semibold uppercase">{label}</p></div>
              ))}
            </div>
            <div className="grid gap-1.5">
              {truth.findings.length === 0 && <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700"><ShieldCheck size={13} /> Every claim is supported. This resume can survive an interview.</p>}
              {truth.findings.slice(0, 8).map((f, i) => {
                const M = SEV_META[f.severity] || SEV_META.medium;
                return (
                  <div key={i} className="rounded-lg border border-subtle bg-surface-1 p-2 text-[12px]">
                    <p className="flex items-start gap-1.5 font-semibold text-ink-950"><M.icon size={13} className={cls('mt-0.5 shrink-0', M.tone)} />{f.message}</p>
                    <p className="ml-5 text-muted">{f.recommendedAction}</p>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard title="Evidence opportunities" eyebrow="Verified work not yet on this resume">
        {!opps.length ? <p className="text-xs text-muted">Nothing pending — all verified skills and projects are represented.</p> : (
          <div className="grid gap-1.5">
            {opps.map((o, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-1.5 text-[12px]">
                <span className="flex items-center gap-1.5 text-emerald-800"><BadgeCheck size={13} />{o.label}</span>
                {o.type === 'verified_skill_absent' && <Button size="sm" variant="soft" onClick={() => addVerifiedSkill(o.skill)}>Add</Button>}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Close a gap with proof">
        <p className="mb-2 text-xs text-muted">Missing a skill this resume needs? Don't write it — build it. Project OS creates a scoped project whose verification feeds straight back here.</p>
        <Button size="sm" variant="soft" onClick={() => go('projectstudio', { intent: { targetRole: doc.targetRole, reason: 'resume_gap' } })}><Hammer size={13} /> Build evidence in Project OS</Button>
      </SectionCard>
    </div>
  );
}

/* ----------------------------------------------------------------- Fixes -- */
function FixesTab({ compile, doc, setDoc }) {
  const fc = compile?.health?.fixCenter;
  const groups = [['critical', 'Critical', 'Blockers that can cost the interview'], ['highImpact', 'High impact', 'Biggest score gains'], ['improvement', 'Improvements', 'Polish'], ['formatting', 'Formatting', 'Layout & consistency']];
  if (!fc) return <p className="text-xs text-muted">Checks run automatically as you edit.</p>;
  const visible = (list) => list.filter((c) => !isCheckDismissed(doc, c.id));
  return (
    <div className="grid gap-4">
      {groups.map(([key, title, sub]) => {
        const list = visible(fc[key] || []);
        return (
          <SectionCard key={key} title={`${title} (${list.length})`} eyebrow={sub}>
            {!list.length ? <p className="text-xs font-medium text-emerald-700">Clear ✓</p> : (
              <div className="grid gap-1.5">
                {list.map((c) => {
                  const M = SEV_META[c.severity] || SEV_META.medium;
                  return (
                    <div key={c.id} className="rounded-lg border border-subtle bg-surface-1 p-2 text-[12px]">
                      <div className="flex items-start justify-between gap-2">
                        <p className="flex items-start gap-1.5 font-semibold text-ink-950"><M.icon size={13} className={cls('mt-0.5 shrink-0', M.tone)} />{c.message}</p>
                        {c.scoreImpact > 0 && <span className="shrink-0 rounded bg-aurora-violet/10 px-1.5 py-0.5 text-[10px] font-bold text-aurora-violet">+{c.scoreImpact}</span>}
                      </div>
                      <p className="ml-5 text-muted">{c.reason}</p>
                      <p className="ml-5 font-medium text-ink-950">→ {c.recommendedAction}</p>
                      <div className="ml-5 mt-1 flex gap-2 text-[10px] font-semibold">
                        <button type="button" className="text-muted hover:text-ink-950" onClick={() => setDoc(dismissCheck(doc, c.id, 'ignored'))}>Ignore</button>
                        <button type="button" className="text-muted hover:text-ink-950" onClick={() => setDoc(dismissCheck(doc, c.id, 'intentional'))}>Mark intentional</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        );
      })}
      {Object.keys(doc.metadata?.dismissedChecks || {}).length > 0 && (
        <button type="button" className="text-left text-[11px] font-semibold text-muted hover:text-ink-950"
          onClick={() => setDoc({ ...doc, metadata: { ...doc.metadata, dismissedChecks: {} } })}>
          Restore {Object.keys(doc.metadata.dismissedChecks).length} dismissed check(s)
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Design -- */
const ACCENTS = ['#1f2937', '#1e3a5f', '#14532d', '#7f1d1d', '#334155', '#4338ca', '#0f766e', '#1d4ed8', '#111827', '#374151'];
function DesignTab({ doc, setDoc, certification }) {
  const certified = new Set(certification?.certified || []);
  const groups = [['ats-strict', 'ATS Strict'], ['professional', 'Professional'], ['tech', 'Tech'], ['student', 'Student'], ['executive', 'Executive'], ['legacy', 'Classic library']];
  const byGroup = (g) => (g === 'legacy' ? RESUME_TEMPLATES.filter((t) => t.set !== 'v3') : V3_TEMPLATES.filter((t) => t.category === g));
  return (
    <div className="grid gap-4">
      {groups.map(([g, label]) => {
        const list = byGroup(g);
        if (!list.length) return null;
        return (
          <SectionCard key={g} title={label}>
            <div className="grid grid-cols-2 gap-2">
              {list.map((t) => (
                <button key={t.id} type="button" onClick={() => setDoc({ ...doc, templateId: t.id })}
                  className={cls('rounded-xl border p-2.5 text-left transition', doc.templateId === t.id ? 'border-aurora-violet/60 bg-aurora-violet/5 ring-1 ring-aurora-violet/30' : 'border-subtle hover:border-strong')}>
                  <span className="block text-[13px] font-semibold text-ink-950">{t.name}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {certified.has(t.id) && <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 py-0.5 text-[9px] font-bold text-emerald-700"><ShieldCheck size={9} /> ATS Checked</span>}
                    {t.strictAts && <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] font-bold text-slate-600">STRICT</span>}
                    {t.atsSafe === false && <span className="rounded bg-amber-50 px-1 py-0.5 text-[9px] font-bold text-amber-700">VISUAL — not ATS-first</span>}
                  </span>
                </button>
              ))}
            </div>
          </SectionCard>
        );
      })}
      <SectionCard title="Layout">
        <div className="grid gap-3">
          <Field label="Page size"><div className="flex gap-2">{['a4', 'letter'].map((s) => <Button key={s} size="sm" variant={doc.pageSize === s ? 'primary' : 'soft'} onClick={() => setDoc({ ...doc, pageSize: s })}>{s.toUpperCase()}</Button>)}</div></Field>
          <Field label="Density" hint="Auto-fit steps density before anything else — the body font never drops below 9.5px and content is never silently cut.">
            <div className="flex gap-2">{['comfortable', 'compact', 'tight'].map((d) => <Button key={d} size="sm" variant={doc.density === d ? 'primary' : 'soft'} onClick={() => setDoc({ ...doc, density: d })}>{d}</Button>)}</div>
          </Field>
          <Field label="Accent" hint="Curated palette — recruiter-safe, print-safe.">
            <div className="flex flex-wrap gap-1.5">
              {ACCENTS.map((a) => (
                <button key={a} type="button" onClick={() => setDoc({ ...doc, styling: { ...doc.styling, accent: a } })}
                  className={cls('h-6 w-6 rounded-full border-2', (doc.styling.accent || '') === a ? 'border-aurora-violet' : 'border-transparent')} style={{ background: a }} title={a} />
              ))}
              <button type="button" onClick={() => setDoc({ ...doc, styling: { ...doc.styling, accent: '' } })} className={cls('h-6 w-6 rounded-full border-2 bg-white text-[9px] font-bold', !doc.styling.accent ? 'border-aurora-violet' : 'border-subtle')} title="Template default">×</button>
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink-950">
            <input type="checkbox" checked={doc.atsStrict} onChange={(e) => setDoc({ ...doc, atsStrict: e.target.checked })} />
            <span><span className="font-semibold">ATS Strict mode</span> <span className="text-xs text-muted">— forces disc bullets, standard headings and single-column flow regardless of template.</span></span>
          </label>
        </div>
      </SectionCard>
    </div>
  );
}

/* ---------------------------------------------------------- Health rail --- */
function HealthRail({ compile, compiling, sim, onOpenFixes }) {
  const h = compile?.health;
  const nba = compile?.nextBestAction;
  const [openDim, setOpenDim] = useState('');
  return (
    <div className="grid gap-3">
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <ScoreRing score={h?.score} size={70} />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Resume health</p>
            {h ? (
              <>
                <p className="text-sm font-bold text-ink-950">{h.score}/100 {compiling && <Spinner className="ml-1 inline h-3 w-3" />}</p>
                {h.potential > h.score && <p className="text-[11px] text-emerald-700">→ {h.potential} after listed fixes (sum of their score impacts)</p>}
              </>
            ) : <p className="text-sm text-muted">{compiling ? 'Scoring…' : 'Edit to score'}</p>}
          </div>
        </div>
        {h && (
          <div className="mt-3 grid gap-1">
            {Object.entries(h.dimensions).map(([k, d]) => (
              <div key={k}>
                <button type="button" onClick={() => setOpenDim(openDim === k ? '' : k)} className="w-full">
                  <div className="mb-0.5 flex justify-between text-[11px]">
                    <span className="capitalize text-muted">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                    <span className="font-semibold text-ink-950">{d.points}/{d.max}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100"><div className={cls('h-1.5 rounded-full', d.points / d.max >= 0.75 ? 'bg-emerald-500' : d.points / d.max >= 0.45 ? 'bg-amber-500' : 'bg-rose-500')} style={{ width: `${(d.points / d.max) * 100}%` }} /></div>
                </button>
                {openDim === k && (
                  <ul className="mt-1 grid gap-0.5 rounded-lg bg-surface-1 p-2 text-[11px] text-muted">
                    {d.reasons.map((r, i) => <li key={i} className="flex gap-1"><span className={r.startsWith('+') ? 'text-emerald-600' : 'text-rose-500'}>{r.startsWith('+') ? '+' : '–'}</span><span>{r.replace(/^[+–-]\s*/, '')}</span></li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {sim && (
        <Card className="p-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><ListChecks size={13} /> ATS parse round-trip</p>
          <p className="text-sm font-bold text-ink-950">{sim.integrity}% content recovered <span className="text-[11px] font-normal text-muted">({sim.fieldsRecovered}/{sim.fieldsChecked} fields)</span></p>
          {sim.criticalLoss.length > 0
            ? <p className="text-[11px] text-rose-600">Critical loss: {sim.criticalLoss.map((c) => c.label).join(', ')}</p>
            : <p className="text-[11px] text-emerald-700">Name, email, companies and titles all survive parsing.</p>}
        </Card>
      )}

      {nba && (
        <Card className="border-aurora-violet/30 bg-aurora-violet/5 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-aurora-violet">Next best action</p>
          <p className="text-[13px] font-semibold text-ink-950">{nba.label}</p>
          <p className="text-[12px] text-muted">{nba.action}</p>
          {nba.cta?.panel === 'fixes' && <Button size="sm" variant="soft" className="mt-2" onClick={onOpenFixes}><Wrench size={12} /> Open Fix Center</Button>}
        </Card>
      )}

      {h?.topImprovements?.length > 0 && (
        <Card className="p-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Top improvements</p>
          <div className="grid gap-1">
            {h.topImprovements.map((t) => (
              <p key={t.id} className="text-[12px] text-ink-950"><span className="mr-1 rounded bg-aurora-violet/10 px-1 py-0.5 text-[10px] font-bold text-aurora-violet">+{t.scoreImpact}</span>{t.message}</p>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ================================================================== STUDIO */
const TABS = [
  { id: 'content', label: 'Content', icon: FileText },
  { id: 'target', label: 'Target', icon: Target },
  { id: 'evidence', label: 'Evidence', icon: ShieldCheck },
  { id: 'fixes', label: 'Fixes', icon: Wrench },
  { id: 'design', label: 'Design', icon: Palette },
];

export default function ResumeStudio({ go }) {
  const [mode, setMode] = useState('loading'); // loading | list | wizard | studio
  const [docs, setDocs] = useState([]);
  const [doc, setDocRaw] = useState(null);
  const [tab, setTab] = useState('content');
  const [compile, setCompile] = useState(null);
  const [compiling, setCompiling] = useState(false);
  const [preview, setPreview] = useState(null); // {html, pageCount, fit}
  const [sim, setSim] = useState(null);
  const [layoutReport, setLayoutReport] = useState(null);
  const [certification, setCertification] = useState(null);
  const [saveState, setSaveState] = useState('');
  const [importReview, setImportReview] = useState(null);
  const [quantifyText, setQuantifyText] = useState('');
  const [quantifyPrompts, setQuantifyPrompts] = useState(null);
  const [tailorBusy, setTailorBusy] = useState(false);
  const [tailorProposal, setTailorProposal] = useState(null);
  const [tailorRanking, setTailorRanking] = useState(null);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const dirtyRef = useRef(false);

  const setDoc = useCallback((next) => { dirtyRef.current = true; setDocRaw(next); }, []);
  const debouncedDoc = useDebounced(doc, 700);

  /* boot: user scope + doc list + certification (cached) */
  useEffect(() => {
    let alive = true;
    (async () => {
      try { const me = await fetch('/auth/me', { credentials: 'include' }).then((r) => r.json()).catch(() => null); setResumeOsUser(me?.user || null); } catch { setResumeOsUser(null); }
      try {
        const r = await ResumeOsApi.list();
        if (!alive) return;
        const cached = getCachedResumeOs();
        setDocs(r.documents || []);
        if (r.documents?.length) setMode('list');
        else if (cached?.doc) { setDocRaw(normalizeResumeDocument(cached.doc)); setMode('studio'); }
        else setMode('wizard');
      } catch { if (alive) setMode(getCachedResumeOs()?.doc ? 'studio' : 'wizard'); const c = getCachedResumeOs(); if (c?.doc) setDocRaw(normalizeResumeDocument(c.doc)); }
      try { const c = await ResumeOsApi.certification(); if (alive) setCertification(c.certification); } catch { /* non-blocking */ }
    })();
    return () => { alive = false; };
  }, []);

  /* live preview: paginate with the SAME renderer as export */
  useEffect(() => {
    if (!debouncedDoc) return;
    let alive = true;
    (async () => {
      try {
        const structured = toRendererStructured(debouncedDoc);
        const tpl = getResumeTemplate(debouncedDoc.templateId);
        const theme = { ...tpl.theme };
        if (debouncedDoc.styling?.accent) theme.accent = debouncedDoc.styling.accent;
        if (debouncedDoc.atsStrict) { theme.skillsStyle = 'grouped-lines'; theme.bulletChar = 'disc'; theme.headerBand = false; }
        const paged = await paginateResume(structured, { ...tpl, theme }, { size: debouncedDoc.pageSize, density: debouncedDoc.density });
        if (!alive) return;
        setPreview({ html: composePagedDocumentHTML(paged), pageCount: paged.pageCount, fit: paged.fit, paged });
        const s = simulateAtsParse(debouncedDoc, paged.pages);
        setSim(s);
        try {
          const { validateResumeLayout } = await import('../lib/resumeLayoutValidator.js');
          const host = document.createElement('div');
          host.setAttribute('aria-hidden', 'true');
          host.style.cssText = 'position:fixed;left:-14000px;top:0;z-index:-1;opacity:0;pointer-events:none;background:#fff;';
          const style = document.createElement('style'); style.textContent = paged.css; host.appendChild(style);
          const wrap = document.createElement('div');
          wrap.innerHTML = paged.pages.map((inner) => `<div class="rp-page"><div class="rp-root">${inner}</div></div>`).join('');
          host.appendChild(wrap); document.body.appendChild(host);
          try { setLayoutReport(validateResumeLayout(wrap, { expectedPageMode: 'auto', overflowBlocks: paged.overflowBlocks, fit: paged.fit, template: paged.template })); }
          finally { document.body.removeChild(host); }
        } catch { setLayoutReport(null); }
      } catch { /* preview failure never blocks editing */ }
    })();
    return () => { alive = false; };
  }, [debouncedDoc]);

  /* compile: server-owned deterministic pipeline */
  useEffect(() => {
    if (!debouncedDoc) return;
    let alive = true;
    setCompiling(true);
    (async () => {
      try {
        const r = await ResumeOsApi.compile({ doc: debouncedDoc, atsSimulation: sim ? { integrity: sim.integrity, headingRecovery: sim.headingRecovery } : null, persist: dirtyRef.current });
        if (alive) setCompile(r);
      } catch { /* keep last good compile */ }
      if (alive) setCompiling(false);
      cacheResumeOs({ doc: debouncedDoc });
    })();
    return () => { alive = false; };
  }, [debouncedDoc]);

  const openDoc = async (docId) => {
    setMode('loading');
    try { const r = await ResumeOsApi.get(docId); setDocRaw(normalizeResumeDocument(r.doc)); setMode('studio'); }
    catch { setMode('list'); }
  };
  const saveNow = async () => {
    if (!doc) return;
    setSaveState('saving');
    try { await ResumeOsApi.save(doc); dirtyRef.current = false; setSaveState('saved'); setTimeout(() => setSaveState(''), 1500); }
    catch { setSaveState('local'); cacheResumeOs({ doc }); setTimeout(() => setSaveState(''), 2000); }
  };
  const takeSnapshot = async (trigger = 'manual', note = '') => {
    try { await ResumeOsApi.save(doc); await ResumeOsApi.snapshot({ docId: doc.id, trigger, note, score: compile?.health?.score ?? null }); } catch { /* db-off */ }
  };

  const runTailor = async () => {
    setTailorBusy(true);
    try {
      const r = await ResumeOsApi.tailor({ doc, jobDescription: doc.targetJobDescription });
      setTailorProposal(r.proposal); setTailorRanking(r.ranking);
    } catch { /* surfaced via missing proposal */ }
    setTailorBusy(false);
  };
  const applyProposal = async () => {
    if (!tailorProposal) return;
    await takeSnapshot('tailor', 'Before tailored selection');
    setDoc({ ...doc, overrides: { ...tailorProposal.overrides, disabled: tailorProposal.overrides.disabled || [] } });
    setTailorProposal(null);
  };

  const doExport = async (kind) => {
    setExportOpen(false);
    const structured = toRendererStructured(doc);
    const gate = canExportLayout(layoutReport);
    if ((kind === 'pdf') && !gate.allowed) { alert(gate.reason); return; }
    if (kind === 'pdf') { await exportResumePDF(structured, getResumeTemplate(doc.templateId), { size: doc.pageSize, density: doc.density, paged: preview?.paged }); }
    if (kind === 'docx') { await exportResumeDOCX(structured, getResumeTemplate(doc.templateId), { fileName: `${doc.title || 'resume'}.docx` }); }
    if (kind === 'txt') { triggerDownload(new Blob([toPlainText(doc)], { type: 'text/plain' }), `${doc.title || 'resume'}.txt`); }
    if (kind === 'json') { triggerDownload(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), `${doc.title || 'resume'}.json`); }
    await takeSnapshot('export', `Exported ${kind.toUpperCase()}`);
  };

  const onQuantify = async (text) => {
    setQuantifyText(text); setQuantifyPrompts(null);
    try { const r = await ResumeOsApi.quantify(text); setQuantifyPrompts(r.prompts); } catch { setQuantifyPrompts({ needed: false }); }
  };

  /* ------------------------------------------------------------ renders -- */
  if (mode === 'loading') return <div className="grid min-h-[50vh] place-items-center"><Spinner /></div>;

  if (mode === 'wizard') {
    return <CreateWizard hasDocs={docs.length > 0} onCancel={() => setMode(docs.length ? 'list' : 'wizard')}
      onCreated={(d, review) => { setDocRaw(normalizeResumeDocument(d)); setImportReview(review); setMode('studio'); }} />;
  }

  if (mode === 'list') {
    return (
      <div className="mx-auto max-w-3xl">
        <PageIntro eyebrow="Resume OS" title="Your resumes" sub="One master resume, tailored variants per job — content is selected, never retyped." action={<Button onClick={() => setMode('wizard')}><Plus size={14} /> New resume</Button>} />
        <div className="grid gap-2">
          {docs.map((d) => (
            <Card key={d.id} hover className="flex cursor-pointer items-center gap-3 p-4" onClick={() => openDoc(d.id)}>
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-aurora-violet/10 text-aurora-violet">{d.kind === 'variant' ? <Layers size={17} /> : <FileText size={17} />}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-950">{d.title}</p>
                <p className="truncate text-xs text-muted">{[d.kind === 'variant' ? 'Variant' : 'Master', d.targetRole, d.templateId].filter(Boolean).join(' · ')}</p>
              </div>
              {Number.isFinite(d.lastScore) && d.lastScore != null && <ScoreRing score={d.lastScore} size={44} />}
              <ChevronRight size={16} className="text-muted" />
            </Card>
          ))}
          {!docs.length && <EmptyState icon={FileText} title="No resumes yet" hint="Create your first — seeded from your verified profile." action={<Button onClick={() => setMode('wizard')}><Plus size={14} /> Create</Button>} />}
        </div>
      </div>
    );
  }

  const fitMsg = preview?.fit?.message || '';
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={async () => { try { const r = await ResumeOsApi.list(); setDocs(r.documents || []); } catch { /* keep */ } setMode('list'); }}><ChevronLeft size={14} /> Resumes</Button>
        <input value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })}
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-base font-bold text-ink-950 outline-none hover:border-subtle focus:border-aurora-violet/50" />
        {doc.kind === 'variant' && <Badge tone="violet"><Layers size={10} /> Variant</Badge>}
        <Badge tone={saveState === 'saved' ? 'mint' : 'default'}>{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'local' ? 'Saved locally' : `v${doc.version || 1}`}</Badge>
        <Button size="sm" variant="soft" onClick={saveNow}><Save size={13} /> Save</Button>
        <Button size="sm" variant="soft" onClick={() => setSnapshotsOpen(true)}><History size={13} /> Versions</Button>
        <div className="relative">
          <Button size="sm" onClick={() => setExportOpen(!exportOpen)}><Download size={13} /> Export</Button>
          {exportOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-xl border border-subtle bg-elevated p-1 shadow-lg">
              {[['pdf', Printer, 'PDF (print — selectable text)'], ['docx', FileType2, 'DOCX (semantic Word)'], ['txt', FileDown, 'Plain text (ATS-canonical)'], ['json', FileJson, 'JSON (full document)']].map(([k, I, label]) => (
                <button key={k} type="button" onClick={() => doExport(k)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-1"><I size={14} className="text-muted" />{label}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {importReview && (
        <Card className="mb-3 border-amber-200 bg-amber-50/60 p-3 text-[13px]">
          <p className="font-semibold text-amber-900">Confirm imported content</p>
          <p className="text-amber-800">{importReview.note} Detected: {importReview.detected.experience.length} roles, {importReview.detected.projects.length} projects, {importReview.detected.skills} skills{importReview.detected.name ? `, contact for ${importReview.detected.name}` : ''}. Review each section, then dismiss this notice.</p>
          <Button size="sm" variant="soft" className="mt-2" onClick={() => setImportReview(null)}>Reviewed — looks right</Button>
        </Card>
      )}
      {fitMsg && <Card className="mb-3 border-amber-200 bg-amber-50/60 p-2.5 text-[12px] text-amber-900">{fitMsg}</Card>}
      {layoutReport && !layoutReport.valid && <Card className="mb-3 border-rose-200 bg-rose-50/70 p-2.5 text-[12px] text-rose-800">Layout validation failed — PDF export is blocked until fixed. {layoutReport.errors?.[0]?.message || ''}</Card>}

      {/* body: left tabs | preview | health */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)_290px]">
        <div className="min-h-0 overflow-y-auto pr-1">
          <div className="mb-3 flex gap-1 rounded-xl border border-subtle bg-surface-1 p-1">
            {TABS.map((t) => {
              const badge = t.id === 'fixes' ? (compile?.health?.fixCenter ? Object.values(compile.health.fixCenter).flat().filter((c) => !isCheckDismissed(doc, c.id)).length : 0)
                : t.id === 'evidence' ? (compile?.truth?.findings?.length || 0) + (compile?.opportunities?.length || 0) : 0;
              return (
                <button key={t.id} type="button" onClick={() => setTab(t.id)}
                  className={cls('relative flex flex-1 items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-semibold transition', tab === t.id ? 'bg-elevated text-ink-950 shadow-sm' : 'text-muted hover:text-ink-950')}>
                  <t.icon size={13} />{t.label}
                  {badge > 0 && <span className="absolute -right-0.5 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-aurora-violet px-1 text-[9px] font-bold text-white">{badge}</span>}
                </button>
              );
            })}
          </div>
          {tab === 'content' && <ContentTab doc={doc} setDoc={setDoc} onQuantify={onQuantify} />}
          {tab === 'target' && <TargetTab doc={doc} setDoc={setDoc} compile={compile} go={go}
            tailorState={{ busy: tailorBusy, proposal: tailorProposal, ranking: tailorRanking, clear: () => setTailorProposal(null) }}
            onRunTailor={runTailor} onApplyProposal={applyProposal} />}
          {tab === 'evidence' && <EvidenceTab compile={compile} doc={doc} setDoc={setDoc} go={go} />}
          {tab === 'fixes' && <FixesTab compile={compile} doc={doc} setDoc={setDoc} />}
          {tab === 'design' && <DesignTab doc={doc} setDoc={setDoc} certification={certification} />}
        </div>

        <div className="relative hidden min-h-0 overflow-hidden rounded-2xl border border-subtle bg-[#e9edf5] md:block">
          {preview
            ? <iframe title="Live preview" srcDoc={preview.html} className="h-full w-full border-0" />
            : <div className="grid h-full place-items-center"><Spinner /></div>}
          {preview && <span className="absolute bottom-2 right-3 rounded-full border border-subtle bg-elevated px-2 py-0.5 text-[10px] font-semibold text-muted shadow">{preview.pageCount} page{preview.pageCount > 1 ? 's' : ''} · {doc.pageSize.toUpperCase()} · {doc.density}</span>}
        </div>

        <div className="min-h-0 overflow-y-auto pr-1">
          <HealthRail compile={compile} compiling={compiling} sim={sim} onOpenFixes={() => setTab('fixes')} />
        </div>
      </div>

      {/* quantification prompts modal */}
      <Modal open={!!quantifyText} onClose={() => { setQuantifyText(''); setQuantifyPrompts(null); }} title="Make this bullet measurable">
        <p className="mb-2 text-[13px] text-muted">“{quantifyText}”</p>
        {!quantifyPrompts ? <Spinner /> : quantifyPrompts.needed === false ? (
          <p className="text-sm text-ink-950">This bullet already carries a number — nothing to add.</p>
        ) : (
          <>
            <p className="mb-2 text-sm font-semibold text-ink-950">Answer any of these from memory — real numbers only. The engine will never invent one for you:</p>
            <ul className="grid gap-1.5">
              {quantifyPrompts.questions.map((q, i) => <li key={i} className="rounded-lg border border-subtle bg-surface-1 px-2.5 py-1.5 text-[13px] text-ink-950">{q.question}</li>)}
            </ul>
            <p className="mt-3 text-[11px] text-muted">Edit the bullet with your answer — an honest estimate ("~40%", "3 services") beats a fabricated precise one.</p>
          </>
        )}
      </Modal>

      {/* snapshots modal */}
      <SnapshotsModal open={snapshotsOpen} onClose={() => setSnapshotsOpen(false)} doc={doc}
        onRestore={(restored) => { setDocRaw(normalizeResumeDocument(restored)); setSnapshotsOpen(false); }}
        onTake={() => takeSnapshot('manual', 'Manual snapshot')} />
    </div>
  );
}

function SnapshotsModal({ open, onClose, doc, onRestore, onTake }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !doc?.id) return;
    setList(null);
    ResumeOsApi.get(doc.id).then((r) => setList(r.doc?.snapshots || [])).catch(() => setList([]));
  }, [open, doc?.id]);
  return (
    <Modal open={open} onClose={onClose} title="Version history">
      <p className="mb-2 text-[12px] text-muted">Snapshots are taken at meaningful moments — manual saves, exports, tailoring, template changes. Restore never deletes newer work (a restore point is implied).</p>
      <Button size="sm" variant="soft" className="mb-3" disabled={busy} onClick={async () => { setBusy(true); await onTake(); const r = await ResumeOsApi.get(doc.id).catch(() => null); setList(r?.doc?.snapshots || list || []); setBusy(false); }}>
        <History size={13} /> Snapshot now
      </Button>
      {!list ? <Spinner /> : !list.length ? <p className="text-sm text-muted">No versions yet (versions persist when you're signed in with the database enabled).</p> : (
        <div className="grid max-h-72 gap-1.5 overflow-auto">
          {list.map((s, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border border-subtle bg-surface-1 px-2.5 py-1.5 text-[12px]">
              <span>
                <span className="font-semibold capitalize text-ink-950">{s.trigger.replace('_', ' ')}</span>
                {s.score != null && <span className="ml-1.5 rounded bg-aurora-violet/10 px-1 py-0.5 text-[10px] font-bold text-aurora-violet">{s.score}</span>}
                <span className="block text-muted">{s.note || new Date(s.at).toLocaleString()}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={async () => { const r = await ResumeOsApi.restore(doc.id, i).catch(() => null); if (r?.doc) onRestore(r.doc); }}>Restore</Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
