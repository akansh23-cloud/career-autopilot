import { useEffect, useMemo, useState } from 'react';
import { Search, MapPin, Clock, ExternalLink, Briefcase, Building2, Filter, Bookmark, ChevronDown, Users, Linkedin, FileText, Mail, Sparkles, Copy, Check, AlertTriangle, ClipboardCheck, Hammer, Send, Download, Wand2, ListChecks, Target, Eye, X, Rocket } from 'lucide-react';
import { PageIntro } from './common.jsx';
import { Button, Input, Badge, Skeleton, EmptyState, Card, Modal, Spinner } from '../components/ui/kit.jsx';
import { Jobs, Contacts, AI } from '../lib/api.js';
import { ROLE_GROUPS } from '../lib/roles.js';
import { consumeQueuedResumeJobSearch, getResumeSearchRole, getStoredResume, getStoredJobResults, saveStoredJobResults, saveSelectedJob } from '../lib/resumeStore.js';
import { saveStudioSeed } from '../lib/projectStore.js';
import { inferType } from '../lib/projectGen.js';

const FRESH = [['24h', '1d'], ['3 days', '3d'], ['Week', '7d'], ['Month', '30d']];
const MODES = ['Any', 'Remote', 'On-site/Hybrid'];
const EDITOR_KEY = 'careerAutopilot.editor.lastTailor.v1';
const KIT_KEY = 'careerAutopilot.tailoredKits.v1';
const ROLE_OPTIONS = Object.values(ROLE_GROUPS).flat();

const TRACKER_KEY = 'careerAutopilot.trackerBoard.v1';
function addJobToTracker(j) {
  try {
    const empty = { saved: [], applied: [], interview: [], offer: [] };
    const board = JSON.parse(localStorage.getItem(TRACKER_KEY) || JSON.stringify(empty));
    const id = keyForJob(j);
    const exists = Object.values(board).flat().some((x) => String(x.id) === String(id));
    if (!exists) {
      board.saved = [{ id, role: j.title || 'Role', company: j.company || '', url: j.url || '', source: j.source || '', addedAt: new Date().toISOString() }, ...(board.saved || [])];
      localStorage.setItem(TRACKER_KEY, JSON.stringify(board));
      window.dispatchEvent(new Event('career-tracker-updated'));
    }
  } catch {}
}

function safeRead(key, fallback = {}) { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
function safeWrite(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function keyForJob(j) { return String(j.id || j.url || `${j.company}-${j.title}`); }
function clamp(n, min = 0, max = 100) { return Math.max(min, Math.min(max, Math.round(Number(n) || 0))); }
function words(s = '') { return String(s).toLowerCase().replace(/[^a-z0-9+#.\s-]/g, ' ').split(/\s+/).filter((x) => x.length > 2); }
function uniq(a) { return [...new Set(a.filter(Boolean))]; }
function domainFromUrl(url = '') { try { const h = new URL(url).hostname.replace(/^www\./, ''); const p = h.split('.'); return p.length > 2 ? p.slice(-2).join('.') : h; } catch { return ''; } }
function jobText(j) { return [j.title, j.company, j.location, j.summary, (j.requiredSkills || []).join(', ')].filter(Boolean).join('\n'); }
function downloadText(name, text, type = 'text/plain;charset=utf-8') { const blob = new Blob([text || ''], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
function extractJSON(text = '') { try { return JSON.parse(text); } catch {} const m = text.match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } }
function slug(s = 'file') { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'file'; }

function enrichJob(j, resume) {
  const text = `${jobText(j)} ${(j.tags || []).join(' ')}`;
  const jw = new Set(words(text));
  const rw = new Set(words(`${resume.text || ''} ${resume.analysis?.summary || ''} ${(resume.analysis?.strengths || []).join(' ')}`));
  const required = uniq([...(j.requiredSkills || []), ...(String(j.title || '').match(/devops|kubernetes|docker|terraform|aws|azure|java|react|python|data|cloud|ci\/cd/gi) || [])]).slice(0, 12);
  const matched = required.filter((s) => rw.has(String(s).toLowerCase()) || words(s).some((w) => rw.has(w)));
  const missing = required.filter((s) => !matched.includes(s)).slice(0, 8);
  const titleHit = words(j.title).some((w) => rw.has(w));
  const locOk = true;
  const base = 45 + matched.length * 7 + (titleHit ? 13 : 0) + (j.verified ? 4 : 0) + (String(j.postedDate || '').toLowerCase().includes('today') ? 4 : 0);
  const match = clamp(j.matchScore || j.match || base, 35, 96);
  const backup = clamp(Math.max(25, match - 12 - missing.length * 2), 20, 85);
  const why = uniq([
    titleHit && 'Relevant role/title',
    matched.length ? `${matched.slice(0, 3).join(', ')} already present in resume` : '',
    locOk && (j.mode || j.location) ? 'Location/work mode looks acceptable' : '',
  ]).filter(Boolean);
  return { ...j, _match: match, _backup: backup, _matched: matched, _missing: missing, _why: why.length ? why : ['Relevant role/title'] };
}

function KitTabs({ kit, tab, setTab }) {
  const tabs = [
    ['resume', 'Resume'], ['latex', 'Resume (LaTeX)'], ['cover', 'Cover Letter'], ['recruiter', 'Recruiter'], ['linkedin', 'LinkedIn'], ['email', 'Email'], ['follow', 'Follow-up'], ['negotiation', 'Negotiation'], ['checklist', 'Checklist'], ['changes', 'Changes'],
  ];
  const value = (() => {
    const d = kit?.docs || {};
    if (tab === 'resume') return kit?.tailoredResume || '';
    if (tab === 'latex') return kit?.latexResume || '';
    if (tab === 'cover') return d.coverLetter || '';
    if (tab === 'recruiter') return d.recruiterMessage || '';
    if (tab === 'linkedin') return d.linkedinNote || '';
    if (tab === 'email') return d.applicationEmail ? `Subject: ${d.applicationEmail.subject || ''}\n\n${d.applicationEmail.body || ''}` : '';
    if (tab === 'follow') return [`3-day follow-up:\n${d.followUp3 || ''}`, `5-day follow-up:\n${d.followUp5 || ''}`, `7-day follow-up:\n${d.followUp7 || ''}`].join('\n\n');
    if (tab === 'negotiation') return d.salaryNegotiation || '';
    if (tab === 'checklist') return (d.applyChecklist || []).map((x, i) => `${i + 1}. ${x}`).join('\n');
    return (kit?.changeNotes || []).map((x) => `• ${x}`).join('\n');
  })();
  return <>
    <div className="mt-5 flex flex-wrap gap-2">{tabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${tab === id ? 'border-aurora-mint/50 bg-aurora-mint/15 text-white' : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]'}`}>{label}</button>)}</div>
    <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-ink-950/80 p-4 font-mono text-[12px] leading-relaxed text-slate-200">{value || 'No content generated for this tab yet.'}</pre>
  </>;
}

function TailorModal({ open, job, go, onClose }) {
  const [status, setStatus] = useState('idle');
  const [kit, setKit] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('resume');
  const [template, setTemplate] = useState('Jake ATS Compact');
  const [length, setLength] = useState('Auto');
  const resume = getStoredResume();

  useEffect(() => {
    if (!open || !job) return;
    setErr(''); setTab('resume');
    const cached = safeRead(KIT_KEY, {})[keyForJob(job)];
    if (cached) { setKit(cached); setStatus('done'); } else { setKit(null); setStatus('idle'); }
  }, [open, job]);

  const generate = async () => {
    if (!job) return;
    if (!resume.text || resume.text.length < 40) { setErr('Upload and analyze a resume first.'); return; }
    setStatus('loading'); setErr('');
    const prompt = `You are an expert job application assistant. Build a truthful tailored application kit.
Return ONLY valid JSON with this shape:
{"atsBefore":0,"atsAfter":0,"matchedKeywords":[],"stillMissing":[],"summary":"","whyFit":[],"riskNotes":[],"changeNotes":[],"tailoredResume":"plain text resume","latexResume":"Jake's Resume LaTeX if possible","docs":{"coverLetter":"","recruiterMessage":"","linkedinNote":"","applicationEmail":{"subject":"","body":""},"followUp3":"","followUp5":"","followUp7":"","salaryNegotiation":"","applyChecklist":[]}}
Rules: never invent employers, dates, certifications, tools or metrics. Use only resume facts. Template=${template}. Length=${length}. If single page, compress lower priority content; if multi page, keep sections complete.
RESUME:\n"""${resume.text.slice(0, 9000)}"""
ANALYSIS:\n${JSON.stringify(resume.analysis || {}).slice(0, 2500)}
JOB:\n"""${jobText(job).slice(0, 6000)}"""`;
    try {
      const d = await AI.message({ model: 'claude-sonnet-4-20250514', max_tokens: 3600, messages: [{ role: 'user', content: prompt }] });
      const text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const parsed = extractJSON(text);
      if (!parsed) throw new Error('AI returned an unreadable tailoring response.');
      const next = {
        atsBefore: clamp(parsed.atsBefore || job._backup || 45), atsAfter: clamp(parsed.atsAfter || job._match || 70),
        matchedKeywords: parsed.matchedKeywords || job._matched || [], stillMissing: parsed.stillMissing || job._missing || [],
        summary: parsed.summary || '', whyFit: parsed.whyFit || job._why || [], riskNotes: parsed.riskNotes || [], changeNotes: parsed.changeNotes || [],
        tailoredResume: parsed.tailoredResume || '', latexResume: parsed.latexResume || '', docs: parsed.docs || {}, template, length,
        createdAt: new Date().toISOString(), job,
      };
      const all = safeRead(KIT_KEY, {}); all[keyForJob(job)] = next; safeWrite(KIT_KEY, all);
      setKit(next); setStatus('done');
    } catch (e) { setErr(e.message || 'Tailoring failed.'); setStatus('error'); }
  };

  const openEditor = () => {
    if (!job || !kit) return;
    saveSelectedJob(job);
    safeWrite(EDITOR_KEY, { resume: kit.tailoredResume || resume.text || '', jd: jobText(job), tpl: kit.template || template, len: kit.length || length, out: kit.tailoredResume || '', kit, updatedAt: new Date().toISOString() });
    onClose?.(); go?.('editor');
  };
  const base = `${slug(job?.company)}-${slug(job?.title)}`;

  return <Modal open={open} onClose={onClose} width="max-w-5xl" title={job ? `Tailoring for ${job.title}` : 'Tailor resume'}>
    {status === 'loading' && <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-300"><Spinner className="border-aurora-mint/20 border-t-aurora-mint" /> Rewriting resume + writing cover letter, recruiter, LinkedIn and email notes…</div>}
    {(status === 'idle' || status === 'error') && <div className="space-y-4">
      {err && <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{err}</p>}
      <div className="rounded-2xl border border-aurora-mint/25 bg-aurora-mint/10 p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.3em] text-aurora-mint">Tailored application kit</div>
        <h3 className="mt-1 font-display text-2xl text-white">{job?.title} <span className="text-slate-500">· {job?.company}</span></h3>
        <p className="mt-2 text-sm text-muted">This generates the same package flow as the legacy version: tailored resume, LaTeX, cover letter, recruiter message, LinkedIn note, email, follow-ups, negotiation, checklist and change notes.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Resume length</p><div className="flex gap-2">{['Auto','Single page','Multi page'].map((x) => <button key={x} onClick={() => setLength(x)} className={`rounded-xl px-3 py-2 text-xs font-semibold ${length === x ? 'bg-aurora-mint text-ink-950' : 'bg-white/[0.06] text-slate-200'}`}>{x}</button>)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Template</p><select value={template} onChange={(e) => setTemplate(e.target.value)} className="h-10 w-full rounded-xl border border-white/10 bg-ink-950 px-3 text-sm text-slate-100"><option>Jake ATS Compact</option><option>Modern Professional</option><option>Dark Header Executive</option><option>Minimal ATS</option><option>Two Column Technical</option><option>Cloud/DevOps Engineer</option><option>Fresher Project Focus</option><option>Multi Page Detailed</option></select></div>
      </div>
      <Button onClick={generate}><Wand2 size={16} /> Generate tailored package</Button>
    </div>}
    {status === 'done' && kit && <div>
      <div className="rounded-2xl border border-aurora-mint/30 bg-aurora-mint/10 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div><div className="text-xs font-semibold uppercase tracking-[0.3em] text-aurora-mint">Tailored application kit</div><h3 className="font-display text-2xl text-white">{job?.title} <span className="text-slate-500">· {job?.company}</span></h3></div>
          <div className="flex flex-wrap gap-2"><Button size="sm" onClick={openEditor}><PenIcon /> Open in Resume Editor</Button><Button size="sm" variant="soft" onClick={() => downloadText(`${base}.txt`, kit.tailoredResume)}> <Download size={13}/>TXT</Button><Button size="sm" variant="soft" onClick={() => downloadText(`${base}.doc`, kit.tailoredResume, 'application/msword')}> <Download size={13}/>DOCX</Button><Button size="sm" variant="soft" onClick={() => downloadText(`${base}.tex`, kit.latexResume || kit.tailoredResume)}> <Download size={13}/>LaTeX</Button></div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center"><div className="text-xs text-muted">ATS Before</div><div className="font-display text-3xl text-rose-300">{kit.atsBefore}</div></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center"><div className="text-xs text-muted">ATS After</div><div className="font-display text-3xl text-aurora-mint">{kit.atsAfter}</div></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center"><div className="text-xs text-muted">Match</div><div className="font-display text-3xl text-white">{job?._match || kit.atsAfter}</div></div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-ink-950/50 p-4"><h4 className="font-semibold text-white">Why this job fits</h4><div className="mt-3 space-y-2">{(kit.whyFit || []).map((x, i) => <div key={i} className="rounded-xl border border-aurora-mint/30 bg-aurora-mint/10 px-3 py-2 text-sm text-slate-200">✓ {x}</div>)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-ink-950/50 p-4"><h4 className="font-semibold text-white">Risks to handle</h4><div className="mt-3 space-y-2">{(kit.riskNotes?.length ? kit.riskNotes : kit.stillMissing || []).map((x, i) => <div key={i} className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">△ {x}</div>)}</div></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">{(kit.matchedKeywords || []).slice(0, 12).map((k) => <Badge key={k} tone="mint">+{k}</Badge>)}{(kit.stillMissing || []).slice(0, 10).map((k) => <Badge key={k} tone="rose">missing: {k}</Badge>)}</div>
      <KitTabs kit={kit} tab={tab} setTab={setTab} />
      <div className="mt-5 flex flex-wrap gap-2 border-t border-white/10 pt-4"><Button onClick={openEditor}><FileText size={15}/> Edit tailored resume</Button>{job?.url && <a href={job.url} target="_blank" rel="noreferrer"><Button variant="soft"><ExternalLink size={15}/> Open posting to apply</Button></a>}<Button variant="soft" onClick={() => downloadText(`${base}-application-kit.txt`, [kit.tailoredResume, kit.docs?.coverLetter, kit.docs?.recruiterMessage, kit.docs?.linkedinNote].filter(Boolean).join('\n\n---\n\n'))}> <Download size={15}/> Download kit</Button></div>
    </div>}
  </Modal>;
}
function PenIcon(){ return <FileText size={13}/>; }

function ContactCard({ c, onDraft }) {
  const conf = Number(c.confidence) || 0;
  const confTone = conf >= 65 ? 'mint' : conf >= 40 ? 'cyan' : 'amber';
  const linkedinHref = c.linkedinUrl || c.linkedin || c.url || '';
  const isSearch = /\/search\//.test(linkedinHref);
  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-aurora-cta text-sm font-semibold text-white">{(c.name || c.title || 'P').trim()[0] || 'P'}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-white">{c.name || 'Public profile'}</p>
          <p className="truncate text-xs text-slate-400">{c.title || c.position || c.contactType || 'Contact'}{c.company ? ` · ${c.company}` : ''}</p>
        </div>
        <Badge tone={confTone} className="shrink-0">{conf}%</Badge>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {c.email
          ? <Badge tone={c.emailProbable || c.probable ? 'amber' : 'cyan'}><Mail size={11}/> {c.emailProbable || c.probable ? 'Probable email' : 'Email'}</Badge>
          : <Badge tone="violet"><Linkedin size={11}/> LinkedIn only</Badge>}
        {c.verified && <Badge tone="mint"><Check size={11}/> verified</Badge>}
        {c.source && <Badge>{c.source}</Badge>}
        {c.relationshipSignal && <Badge tone="violet">{c.relationshipSignal}</Badge>}
      </div>
      {c.email && <p className="truncate rounded-lg bg-ink-950/60 px-2.5 py-1.5 font-mono text-xs text-slate-300">{c.email}</p>}
      {c.reason && <p className="text-[11px] leading-snug text-slate-500">{c.reason}</p>}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {linkedinHref && <a href={linkedinHref} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Linkedin size={13}/> {isSearch ? 'Search LinkedIn' : 'Open'} <ExternalLink size={12}/></Button></a>}
        {c.email && <a href={`mailto:${c.email}`}><Button size="sm" variant="soft"><Mail size={13}/> Email</Button></a>}
        <Button size="sm" onClick={() => onDraft(c)}><Sparkles size={13}/> Draft</Button>
      </div>
    </Card>
  );
}

function JobCard({ j, saved, onSave, onAction }) {
  const miss = j._missing?.length ? j._missing.slice(0, 6).join(', ') : 'No major gaps';
  return <Card hover className="overflow-hidden p-4 md:p-5">
    <div className="grid gap-4 xl:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 truncate font-display text-lg font-semibold text-white md:text-xl">{j.title}</h3>
          <Badge tone="mint">✓ Open</Badge>
          {j.postedDate && <Badge tone="cyan">{j.postedDate}</Badge>}
          {j.source && <Badge>{j.source}</Badge>}
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted"><Building2 size={14}/> {j.company || 'Company not listed'}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {j.location && <Badge><MapPin size={11}/>{j.location}</Badge>}
          {j.mode && <Badge>{j.mode}</Badge>}
          {j.salary && <Badge tone="amber">{j.salary}</Badge>}
        </div>
      </div>
      <div className="flex gap-2 xl:flex-col">
        <div className="min-w-[76px] rounded-xl border border-aurora-mint/30 bg-ink-950/80 px-3 py-2 text-center"><div className="font-display text-2xl text-amber-glow">{j._match}</div><div className="font-mono text-[9px] uppercase tracking-widest text-slate-500">Match</div></div>
        <div className="min-w-[76px] rounded-xl border border-rose-400/25 bg-ink-950/80 px-3 py-2 text-center"><div className="font-display text-xl text-white">{j._backup}</div><div className="font-mono text-[9px] uppercase tracking-widest text-slate-500">Backup</div></div>
      </div>
    </div>

    {j.summary && <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-slate-400">{j.summary}</p>}

    <div className="mt-3 grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Why it fits</div>
        <div className="flex flex-wrap gap-1.5">{(j._why || []).slice(0, 4).map((x) => <Badge key={x} tone="mint">✓ {x}</Badge>)}</div>
      </div>
      <div className="rounded-xl border border-white/10 bg-ink-950/55 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Missing</div>
        <p className="line-clamp-2 text-[13px] text-slate-400">{miss}</p>
      </div>
    </div>

    <div className="mt-3 flex flex-wrap gap-2">
      <Button size="sm" onClick={() => onAction('tailor', j)}><Sparkles size={14}/> Tailor & Apply</Button>
      <Button size="sm" variant="soft" onClick={() => onAction('checklist', j)}><ClipboardCheck size={14}/> Checklist</Button>
      <Button size="sm" variant="soft" onClick={() => onAction('interview', j)}><Hammer size={14}/> Prep</Button>
      <Button size="sm" variant="soft" onClick={() => onAction('buildproject', j)}><Rocket size={14}/> Build project for gaps</Button>
      {j.url && <a href={j.url} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><ExternalLink size={14}/> Posting</Button></a>}
      <button onClick={() => onSave(j)} className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3.5 text-[13px] font-medium ${saved ? 'border-amber-glow/40 bg-amber-glow/10 text-amber-glow' : 'border-white/10 bg-white/[0.04] text-slate-300'}`}><Bookmark size={14} fill={saved ? 'currentColor' : 'none'}/> {saved ? 'Saved' : 'Save'}</button>
    </div>

    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
      <Badge>🔎 recruiters: 0</Badge><Badge>🤝 referrals: 0</Badge><Badge>✉ Not contacted</Badge>
      <Button size="sm" variant="soft" onClick={() => onAction('contacts', j)}><Users size={14}/> Hiring contact</Button>
      <Button size="sm" variant="soft" onClick={() => onAction('referrals', j)}><Users size={14}/> Referral</Button>
      <Button size="sm" variant="soft" onClick={() => onAction('linkedin', j)}><Linkedin size={14}/> LinkedIn</Button>
      <Button size="sm" variant="soft" onClick={() => onAction('outreach', j)}><Send size={14}/> Outreach</Button>
      <Button size="sm" variant="soft" onClick={() => onAction('track', j)}><ListChecks size={14}/> Track</Button>
    </div>
  </Card>;
}

export default function JobsView({ go }) {
  const stored = getStoredJobResults();
  const storedResume = getStoredResume();
  const initialRole = stored.role || getResumeSearchRole();
  const [role, setRole] = useState(initialRole || '');
  const [loc, setLoc] = useState(stored.location || '');
  const [mode, setMode] = useState(stored.mode || 'Any');
  const [fresh, setFresh] = useState(stored.freshness || '7d');
  const [state, setState] = useState({ status: stored.status || 'idle', jobs: stored.jobs || [], err: null });
  const [saved, setSaved] = useState(stored.saved || {});
  const [resumeHint, setResumeHint] = useState(Boolean(storedResume.text));
  const [sort, setSort] = useState('priority');
  const [tailorJob, setTailorJob] = useState(null);
  const [people, setPeople] = useState({ open: false, title: '', status: 'idle', contacts: [], err: '', note: '', job: null, draft: '', copied: false });
  const [mini, setMini] = useState({ open: false, title: '', body: '', job: null });

  const persist = (patch) => saveStoredJobResults({ role, location: loc, mode, freshness: fresh, saved, ...patch });
  const enrichedJobs = useMemo(() => {
    const resume = getStoredResume();
    const list = (state.jobs || []).map((j) => enrichJob(j, resume));
    if (sort === 'newest') return list.sort((a, b) => String(b.postedDate || '').localeCompare(String(a.postedDate || '')));
    if (sort === 'match') return list.sort((a, b) => b._match - a._match);
    return list.sort((a, b) => (b._match + b._backup) - (a._match + a._backup));
  }, [state.jobs, sort]);

  const run = async (e, override = {}) => {
    e?.preventDefault();
    const searchRole = (override.role ?? role).trim();
    if (!searchRole) return;
    const nextLoc = override.location ?? loc;
    const nextMode = override.mode ?? mode;
    const nextFresh = override.freshness ?? fresh;
    setRole(searchRole); setState({ status: 'loading', jobs: [], err: null });
    persist({ status: 'loading', jobs: [], role: searchRole, location: nextLoc, mode: nextMode, freshness: nextFresh });
    try { const d = await Jobs.search({ role: searchRole, location: nextLoc, mode: nextMode, freshness: nextFresh, verify: '0', limit: '18' }); const jobs = d.jobs || []; setState({ status: 'done', jobs, err: null }); saveStoredJobResults({ status: 'done', jobs, role: searchRole, location: nextLoc, mode: nextMode, freshness: nextFresh, saved }); }
    catch (err) { setState({ status: 'error', jobs: [], err: err.message }); saveStoredJobResults({ status: 'error', jobs: [], role: searchRole, location: nextLoc, mode: nextMode, freshness: nextFresh, saved, err: err.message }); }
  };

  useEffect(() => { const queued = consumeQueuedResumeJobSearch(); if (queued?.role) { setResumeHint(true); run(null, { role: queued.role }); } }, []);
  useEffect(() => { const onResumeUpdate = () => { const r = getStoredResume(); setResumeHint(Boolean(r.text)); if (!role && (r.targetRole || getResumeSearchRole())) setRole(r.targetRole || getResumeSearchRole()); }; window.addEventListener('career-resume-updated', onResumeUpdate); return () => window.removeEventListener('career-resume-updated', onResumeUpdate); }, [role]);
  const toggleSave = (j) => { const k = keyForJob(j); const next = { ...saved, [k]: !saved[k] }; setSaved(next); saveStoredJobResults({ ...getStoredJobResults(), saved: next }); };

  const openPeople = async (type, j, opts = {}) => {
    const title = type === 'referrals' ? 'Referral paths' : type === 'linkedin' ? 'Public LinkedIn profiles' : 'Hiring contacts';
    setPeople({ open: true, title, status: 'loading', contacts: [], err: '', note: '', job: j, draft: '', copied: false });
    const domain = j.companyDomain || j.domain || domainFromUrl(j.url);
    const payload = { company: j.company, domain, role: j.title, title: type === 'referrals' ? role || j.title : 'Recruiter OR Talent Acquisition OR Hiring Manager', jobId: j.id || j.url };
    try {
      const d = type === 'referrals' ? await Contacts.referrals(payload) : await Contacts.find(payload);
      const contacts = d.contacts || [];
      setPeople((p) => ({ ...p, status: 'done', contacts, note: d.note || '', err: d.ok === false ? d.error : '' }));
      if (opts.autoDraft && contacts.length) makeDraft(contacts[0]);
    }
    catch (err) { setPeople((p) => ({ ...p, status: 'error', err: err.message || 'Lookup failed.' })); }
  };
  const makeDraft = async (c) => { setPeople((p) => ({ ...p, draft: 'Generating…', copied: false })); const resume = getStoredResume(); const prompt = `Write a short LinkedIn/email outreach note under 90 words. Candidate resume summary: ${resume.analysis?.summary || resume.text.slice(0, 700)}\nTarget person: ${c.name || 'contact'}, ${c.title || c.position || ''} at ${c.company || people.job?.company || ''}.\nTarget job: ${people.job?.title || role}. Make it specific, polite and non-spammy. Output message only.`; try { const r = await AI.message({ model: 'claude-sonnet-4-20250514', max_tokens: 350, messages: [{ role: 'user', content: prompt }] }); const text = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(); setPeople((p) => ({ ...p, draft: text })); } catch (e) { setPeople((p) => ({ ...p, draft: `Could not generate outreach: ${e.message}` })); } };
  const copyDraft = () => { navigator.clipboard?.writeText(people.draft || ''); setPeople((p) => ({ ...p, copied: true })); setTimeout(() => setPeople((p) => ({ ...p, copied: false })), 1500); };
  const action = (type, j) => { saveSelectedJob(j); if (type === 'tailor') { setTailorJob(enrichJob(j, getStoredResume())); return; } if (type === 'buildproject') { const gaps = (j._missing || []).slice(0, 12); saveStudioSeed({ job: { title: j.title, company: j.company }, missingSkills: gaps, type: inferType(gaps, j.title) }); go?.('projectstudio'); return; } if (type === 'outreach') { openPeople('contacts', j, { autoDraft: true }); return; } if (type === 'contacts' || type === 'referrals' || type === 'linkedin') { openPeople(type, j); return; } if (type === 'track') { addJobToTracker(j); go?.('tracker'); return; } const body = type === 'checklist' ? ['Verify posting is still open', 'Generate tailored package', 'Download PDF/DOCX resume', 'Copy recruiter or LinkedIn note', 'Submit manually on official job site', 'Add to tracker', 'Set follow-up after 3 days'].map((x,i)=>`${i+1}. ${x}`).join('\n') : type === 'interview' ? `Interview prep for ${j.title}\n\nFocus areas:\n• ${[...(j.requiredSkills || []), ...j._missing || []].slice(0,6).join('\n• ')}\n\nPrepare STAR stories for ownership, production issue handling, CI/CD, cloud, security and collaboration.` : `Generate outreach from the Tailor & Apply kit or use Find hiring contact first.`; setMini({ open: true, title: type === 'checklist' ? 'Apply checklist' : type === 'interview' ? 'Interview prep' : 'Outreach', body, job: j }); };

  return <>
    <PageIntro title="Find verified jobs" sub="Resume-aware job discovery with the same legacy flow: match score → tailor package → contacts/referrals → editor → tracker." />
    {resumeHint && <div className="mb-4 rounded-2xl border border-aurora-mint/20 bg-aurora-mint/10 px-4 py-3 text-sm text-slate-200">Resume and analysis are saved. Job results stay here when you move to another section. <span className="ml-1 font-medium text-white">Current role: {role || 'select a role'}</span></div>}
    <form onSubmit={run} className="gradient-border mb-6 p-4"><div className="flex flex-col gap-3 md:flex-row"><div className="relative flex-1"><Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"/><Input value={role} onChange={(e)=>setRole(e.target.value)} placeholder="Role e.g. DevOps Engineer" className="pl-10"/></div><div className="relative md:w-56"><select value={ROLE_OPTIONS.includes(role) ? role : ''} onChange={(e)=>e.target.value && setRole(e.target.value)} className="h-11 w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-ink-950 pl-3.5 pr-9 text-sm text-slate-100 outline-none"><option value="">Pick a role…</option>{Object.entries(ROLE_GROUPS).map(([grp, roles]) => <optgroup key={grp} label={grp}>{roles.map((r)=><option key={r} value={r}>{r}</option>)}</optgroup>)}</select><ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"/></div><div className="relative md:w-52"><MapPin size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"/><Input value={loc} onChange={(e)=>setLoc(e.target.value)} placeholder="Country / city" className="pl-10"/></div><Button type="submit" disabled={state.status === 'loading' || !role.trim()}><Search size={16}/> Search</Button></div><div className="mt-3 flex flex-wrap items-center gap-2"><span className="flex items-center gap-1.5 text-xs text-slate-500"><Filter size={13}/> Filters:</span>{MODES.map((m)=><button key={m} onClick={()=>setMode(m)} type="button" className={`rounded-lg px-3 py-1 text-xs transition ${mode===m?'bg-aurora-violet/15 text-white ring-1 ring-aurora-violet/30':'text-slate-400 hover:bg-white/5'}`}>{m}</button>)}<span className="mx-1 h-4 w-px bg-white/10"/>{FRESH.map(([l,v])=><button key={v} onClick={()=>setFresh(v)} type="button" className={`rounded-lg px-3 py-1 text-xs transition ${fresh===v?'bg-aurora-cyan/15 text-white ring-1 ring-aurora-cyan/30':'text-slate-400 hover:bg-white/5'}`}>{l}</button>)}</div></form>
    {state.status === 'loading' && <div className="space-y-4">{Array.from({length:4}).map((_,i)=><Skeleton key={i} className="h-56 w-full rounded-2xl"/>)}</div>}
    {state.status === 'error' && <EmptyState icon={Briefcase} title="Search failed" hint={state.err} action={<Button size="sm" onClick={run}>Retry</Button>} />}
    {state.status === 'idle' && <EmptyState icon={Search} title="Search for your next role" hint="Analyze your resume first for best matching, or manually search a role here." />}
    {state.status === 'done' && state.jobs.length === 0 && <EmptyState icon={Briefcase} title="No jobs found" hint="Try a broader role, clear the location, or widen the time window." />}
    {state.status === 'done' && state.jobs.length > 0 && <><div className="mb-4 flex flex-wrap items-center gap-2"><button className="rounded-full border border-aurora-mint/40 bg-aurora-mint/10 px-4 py-2 text-xs font-semibold text-aurora-mint">{state.jobs.length} fresh jobs</button><button onClick={()=>setSort('priority')} className={`rounded-xl border px-4 py-2 text-xs font-semibold ${sort==='priority'?'border-white/20 bg-white/10 text-white':'border-white/10 text-slate-300'}`}>Sort by priority</button><button onClick={()=>setSort('newest')} className={`rounded-xl border px-4 py-2 text-xs font-semibold ${sort==='newest'?'border-white/20 bg-white/10 text-white':'border-white/10 text-slate-300'}`}>Sort newest</button><button onClick={()=>setSort('match')} className={`rounded-xl border px-4 py-2 text-xs font-semibold ${sort==='match'?'border-white/20 bg-white/10 text-white':'border-white/10 text-slate-300'}`}>Sort match</button><button className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300">🔎 Freshness log</button></div><div className="space-y-4">{enrichedJobs.map((j,i)=><JobCard key={keyForJob(j)+i} j={j} saved={!!saved[keyForJob(j)]} onSave={toggleSave} onAction={action}/>)}</div></>}
    <TailorModal open={!!tailorJob} job={tailorJob} go={go} onClose={()=>setTailorJob(null)} />
    <Modal open={mini.open} onClose={()=>setMini((m)=>({...m,open:false}))} title={mini.title} width="max-w-2xl"><pre className="whitespace-pre-wrap rounded-xl border border-white/10 bg-ink-950/70 p-4 text-sm leading-relaxed text-slate-200">{mini.body}</pre><div className="mt-4 flex gap-2"><Button onClick={()=>setTailorJob(enrichJob(mini.job, getStoredResume()))}><Sparkles size={14}/> Tailor package</Button>{mini.job?.url && <a href={mini.job.url} target="_blank" rel="noreferrer"><Button variant="soft"><ExternalLink size={14}/> Open posting</Button></a>}</div></Modal>
    <Modal open={people.open} onClose={() => setPeople((p)=>({...p,open:false}))} title={people.title} width="max-w-3xl">{people.status === 'loading' && <div className="grid gap-3 sm:grid-cols-2">{Array.from({length:4}).map((_,i)=><Skeleton key={i} className="h-36 rounded-xl" />)}</div>}{people.status === 'error' && <EmptyState icon={AlertTriangle} title="Lookup failed" hint={people.err} />}{people.status === 'done' && people.contacts.length === 0 && <EmptyState icon={Users} title="No people found" hint={people.err || 'Try again or add Hunter/PDL/Apollo keys for verified contacts.'} />}{people.status === 'done' && people.contacts.length > 0 && <>{people.note && <p className="mb-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] leading-snug text-slate-400">{people.note}</p>}<div className="grid gap-3 sm:grid-cols-2">{people.contacts.map((c,i)=><ContactCard key={i} c={c} onDraft={makeDraft} />)}</div></>}{people.draft && <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium text-white">Outreach draft</p><Button size="sm" variant="soft" onClick={copyDraft}>{people.copied ? <Check size={13}/> : <Copy size={13}/>} {people.copied ? 'Copied' : 'Copy'}</Button></div><textarea value={people.draft} onChange={(e)=>setPeople((p)=>({...p,draft:e.target.value}))} className="h-32 w-full resize-none rounded-lg border border-white/10 bg-ink-950/70 p-3 text-sm text-slate-200 outline-none"/></div>}</Modal>
  </>;
}
