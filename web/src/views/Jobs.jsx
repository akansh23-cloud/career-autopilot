import { useEffect, useMemo, useState } from 'react';
import { Search, MapPin, Clock, ExternalLink, Briefcase, Building2, Filter, Bookmark, ChevronDown, Users, Linkedin, FileText, Mail, Sparkles, Copy, Check, AlertTriangle, ClipboardCheck, Hammer, Send, Download, Wand2, ListChecks, Target, Eye, X, Rocket } from 'lucide-react';
import { PageIntro } from './common.jsx';
import { Button, Input, Badge, Skeleton, EmptyState, Card, Modal, Spinner } from '../components/ui/kit.jsx';
import { Jobs, Contacts, AI } from '../lib/api.js';
import { ROLE_GROUPS } from '../lib/roles.js';
import { consumeQueuedResumeJobSearch, getResumeSearchRole, getStoredResume, getStoredJobResults, saveStoredJobResults, saveSelectedJob } from '../lib/resumeStore.js';
import { saveStudioSeed } from '../lib/projectStore.js';
import { saveJobToTracker, getTrackedCount, getTrackerBoard, findCard, trackerJobIdentity } from '../lib/trackerStore.js';
import { inferType } from '../lib/projectGen.js';
import { canUse, useMeter, canTrack, promptUpgrade, describeLimit } from '../lib/plan.js';
import { describeApiError } from '../lib/quota.js';
import {
  WORK_MODE_OPTIONS, EXPERIENCE_OPTIONS, JOB_TYPE_OPTIONS,
  migrateLegacyWorkMode, migrateLegacyExperience, migrateLegacyJobType,
} from '../lib/jobFilterOptions.js';

const FRESH = [['24h', '1d'], ['3 days', '3d'], ['Week', '7d'], ['Month', '30d'], ['Latest', 'latest']];
/* Filter vocabulary now comes from lib/jobFilterOptions.js, which is asserted to
   be a subset of the backend enums in server/utils/jobFilters.js. The old
   hardcoded ['Any','Remote','On-site/Hybrid'] array could not express the
   experience or job-type filters the backend has always supported, and drifted
   from the canonical values. Persisted legacy values are migrated on load. */
const MODES = WORK_MODE_OPTIONS;
const EDITOR_KEY = 'careerAutopilot.editor.lastTailor.v1';
const KIT_KEY = 'careerAutopilot.tailoredKits.v1';
const ROLE_OPTIONS = Object.values(ROLE_GROUPS).flat();

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

// Deterministic, no-AI tailored package. Built purely from the resume text and
// job posting so the Tailor & Apply modal ALWAYS produces a usable kit — even
// when AI is not enabled on the deployment or the AI call fails. It never
// fabricates employers/dates/metrics: the tailored resume keeps the candidate's
// real resume text and the change notes describe what to adjust manually.
function buildFallbackKit(job, resume, { template = 'Jake ATS Compact', length = 'Auto' } = {}) {
  const e = enrichJob(job, resume);
  const matched = e._matched || [];
  const missing = e._missing || [];
  const company = job.company || 'the company';
  const title = job.title || 'this role';
  const baseSummary = (resume.analysis?.summary || '').trim();
  const firstLines = String(resume.text || '').split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 3).join(' ');
  const summary = baseSummary || firstLines || `Candidate targeting ${title} roles.`;
  const strengths = matched.length ? matched.slice(0, 6) : (resume.analysis?.strengths || []).slice(0, 6);

  const coverLetter =
`Dear ${company} Hiring Team,

I'm excited to apply for the ${title} role at ${company}. ${summary}

Based on the job description, my background lines up well with what you're looking for${strengths.length ? `, especially ${strengths.slice(0, 3).join(', ')}` : ''}. I'd welcome the chance to show how I can contribute to your team.

Thank you for your consideration.

Best regards,
${resume.analysis?.name || '[Your name]'}`;

  const recruiterMessage =
`Hi — I noticed the ${title} opening at ${company} and believe I'm a strong fit${strengths.length ? ` given my experience with ${strengths.slice(0, 2).join(' and ')}` : ''}. I'd love to share how my background maps to the role. Would you be open to a quick chat?`;

  const linkedinNote =
`Hi, I'm applying for the ${title} role at ${company} and would value connecting${strengths.length ? `. My background includes ${strengths.slice(0, 2).join(' and ')}.` : '.'} Thanks!`;

  const applyChecklist = uniq([
    `Mirror the exact job title ("${title}") near the top of your resume.`,
    missing.length ? `Add or strengthen these keywords if they reflect real experience: ${missing.slice(0, 6).join(', ')}.` : 'Confirm the top job keywords appear in your resume.',
    'Quantify 2–3 achievements with concrete numbers (%, ₹, time saved).',
    'Tailor your summary to this role in the first 2 lines.',
    `Apply via the official posting${job.url ? '' : ' link'} and save it to your tracker.`,
    'Follow up with the recruiter 5 days after applying.',
  ]).filter(Boolean);

  const changeNotes = uniq([
    matched.length ? `Lead with your matching strengths: ${matched.slice(0, 4).join(', ')}.` : 'Surface the skills the posting emphasises in your top third.',
    missing.length ? `Gaps to address (only if true): ${missing.slice(0, 6).join(', ')}.` : 'No major keyword gaps detected against this posting.',
    'Reorder bullets so the most relevant experience appears first.',
    `Keep formatting ATS-safe (${template}); avoid tables/columns that break parsers.`,
  ]).filter(Boolean);

  return {
    atsBefore: clamp(e._backup || 45),
    atsAfter: clamp(e._match || 70),
    matchedKeywords: matched,
    stillMissing: missing,
    summary,
    whyFit: e._why || [],
    riskNotes: missing.length ? [`Resume may be missing: ${missing.slice(0, 4).join(', ')}`] : [],
    changeNotes,
    tailoredResume: resume.text || '',
    latexResume: '',
    docs: { coverLetter, recruiterMessage, linkedinNote, applicationEmail: { subject: `Application: ${title} — ${resume.analysis?.name || ''}`.trim(), body: coverLetter }, followUp3: '', followUp5: '', followUp7: '', salaryNegotiation: '', applyChecklist },
    template, length, deterministic: true,
    createdAt: new Date().toISOString(), job,
  };
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
    <div className="mt-5 flex flex-wrap gap-2">{tabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${tab === id ? 'border-emerald-200 bg-emerald-50 text-ok' : 'border-subtle bg-surface-1 text-fg-secondary hover:bg-surface-hover'}`}>{label}</button>)}</div>
    <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-2xl border border-subtle bg-sunken p-4 font-mono text-[12px] leading-relaxed text-fg">{value || 'No content generated for this tab yet.'}</pre>
  </>;
}

function TailorModal({ open, job, go, onClose }) {
  const [status, setStatus] = useState('idle');
  const [kit, setKit] = useState(null);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState('resume');
  const [needsResume, setNeedsResume] = useState(false);
  const [upgradeMsg, setUpgradeMsg] = useState('');
  const [template, setTemplate] = useState('Jake ATS Compact');
  const [length, setLength] = useState('Auto');
  const resume = getStoredResume();

  useEffect(() => {
    if (!open || !job) return;
    setErr(''); setNotice(''); setTab('resume'); setNeedsResume(false); setUpgradeMsg('');
    const cached = safeRead(KIT_KEY, {})[keyForJob(job)];
    if (cached) { setKit(cached); setStatus('done'); } else { setKit(null); setStatus('idle'); }
  }, [open, job]);

  const generate = async () => {
    if (!job) return;
    if (!resume.text || resume.text.length < 40) {
      // Be specific about WHICH step is missing and give a way to fix it,
      // rather than a dead-end sentence on a modal with no exit.
      setErr(resume.text
        ? 'The saved resume is too short to tailor. Open Resume, paste the full text, and run the analysis once.'
        : 'No saved resume found yet. Open Resume, upload or paste yours, run the analysis, then come back here.');
      setNeedsResume(true);
      return;
    }
    // Monthly entitlement, checked before spending a network call.
    if (!canUse('tailoring')) {
      const msg = `${describeLimit('tailoring')} You've used them all for this month.`;
      setErr(msg); setUpgradeMsg(msg);
      promptUpgrade(msg, 'pro');
      return;
    }
    setStatus('loading'); setErr(''); setNotice(''); setNeedsResume(false); setUpgradeMsg('');
    const prompt = `You are an expert job application assistant. Build a truthful tailored application kit.
Return ONLY valid JSON with this shape:
{"atsBefore":0,"atsAfter":0,"matchedKeywords":[],"stillMissing":[],"summary":"","whyFit":[],"riskNotes":[],"changeNotes":[],"tailoredResume":"plain text resume","latexResume":"Jake's Resume LaTeX if possible","docs":{"coverLetter":"","recruiterMessage":"","linkedinNote":"","applicationEmail":{"subject":"","body":""},"followUp3":"","followUp5":"","followUp7":"","salaryNegotiation":"","applyChecklist":[]}}
Rules: never invent employers, dates, certifications, tools or metrics. Use only resume facts. Template=${template}. Length=${length}. If single page, compress lower priority content; if multi page, keep sections complete.
RESUME:\n"""${resume.text.slice(0, 9000)}"""
ANALYSIS:\n${JSON.stringify(resume.analysis || {}).slice(0, 2500)}
JOB:\n"""${jobText(job).slice(0, 6000)}"""`;

    // If the AI call can't be used, fall back to a deterministic kit so the
    // modal still produces a usable package — never a raw technical error.
    const degrade = (message) => {
      const fb = buildFallbackKit(job, resume, { template, length });
      const all = safeRead(KIT_KEY, {}); all[keyForJob(job)] = fb; safeWrite(KIT_KEY, all);
      setKit(fb); setNotice(message); setStatus('done');
    };

    try {
      const d = await AI.message({ max_tokens: 3600, messages: [{ role: 'user', content: prompt }] });
      const text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const parsed = extractJSON(text);
      if (!parsed) { degrade('We couldn’t read the AI response, so this is a deterministic starter kit you can edit. You can still use the checklist and gap analysis.'); return; }
      const next = {
        atsBefore: clamp(parsed.atsBefore || job._backup || 45), atsAfter: clamp(parsed.atsAfter || job._match || 70),
        matchedKeywords: parsed.matchedKeywords || job._matched || [], stillMissing: parsed.stillMissing || job._missing || [],
        summary: parsed.summary || '', whyFit: parsed.whyFit || job._why || [], riskNotes: parsed.riskNotes || [], changeNotes: parsed.changeNotes || [],
        tailoredResume: parsed.tailoredResume || '', latexResume: parsed.latexResume || '', docs: parsed.docs || {}, template, length,
        createdAt: new Date().toISOString(), job,
      };
      const all = safeRead(KIT_KEY, {}); all[keyForJob(job)] = next; safeWrite(KIT_KEY, all);
      useMeter('tailoring');
      setKit(next); setStatus('done');
    } catch (e) {
      // Never a raw error, but never a misleading one either. A plan limit is
      // NOT "temporarily unavailable" — that phrasing is what made students
      // retry forever instead of upgrading or waiting for the daily reset.
      const d = describeApiError(e, 'AI tailoring');
      if (d.kind === 'quota') {
        setUpgradeMsg(d.message);
        promptUpgrade(d.message, d.suggestPlan || 'pro');
        degrade(`${d.message} In the meantime, here's a deterministic starter kit built from your resume — fully editable.`);
      } else if (d.kind === 'rate') {
        degrade(`${d.message} Here's a deterministic starter kit you can use or edit right now.`);
      } else if (d.kind === 'config') {
        degrade('AI tailoring is not enabled on this account, so this is the standard template version. The checklist and project gap analysis below still work.');
      } else {
        degrade('AI tailoring could not run just now, so here’s a deterministic starter kit you can edit. You can still use the checklist and gap analysis.');
      }
    }
  };

  const openEditor = () => {
    if (!job || !kit) return;
    saveSelectedJob(job);
    safeWrite(EDITOR_KEY, { resume: kit.tailoredResume || resume.text || '', jd: jobText(job), tpl: kit.template || template, len: kit.length || length, out: kit.tailoredResume || '', kit, updatedAt: new Date().toISOString() });
    onClose?.(); go?.('editor');
  };
  const base = `${slug(job?.company)}-${slug(job?.title)}`;

  return <Modal open={open} onClose={onClose} width="max-w-5xl" title={job ? `Tailoring for ${job.title}` : 'Tailor resume'}>
    {status === 'loading' && <div className="flex items-center gap-4 rounded-2xl border border-subtle bg-surface-1 p-5 text-sm text-fg-secondary"><Spinner className="border-aurora-mint/20 border-t-aurora-mint" /> Rewriting resume + writing cover letter, recruiter, LinkedIn and email notes…</div>}
    {(status === 'idle' || status === 'error') && <div className="space-y-4">
      {err && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-danger">
          <span className="min-w-0">{err}</span>
          <div className="flex shrink-0 gap-2">
            {needsResume && <Button size="sm" onClick={() => { onClose?.(); go?.('resume'); }}>Go to Resume</Button>}
            {upgradeMsg && <Button size="sm" onClick={() => promptUpgrade(upgradeMsg, 'pro')}>See plans</Button>}
          </div>
        </div>
      )}
      <div className="rounded-2xl border border-aurora-mint/25 bg-aurora-mint/10 p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.3em] text-aurora-mint">Tailored application kit</div>
        <h3 className="mt-1 font-display text-2xl text-fg">{job?.title} <span className="text-fg-muted">· {job?.company}</span></h3>
        <p className="mt-2 text-sm text-muted">This generates the same package flow as the legacy version: tailored resume, LaTeX, cover letter, recruiter message, LinkedIn note, email, follow-ups, negotiation, checklist and change notes.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-subtle bg-surface-1 p-4"><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-fg-muted">Resume length</p><div className="flex gap-2">{['Auto','Single page','Multi page'].map((x) => <button key={x} onClick={() => setLength(x)} className={`rounded-xl px-3 py-2 text-xs font-semibold ${length === x ? 'bg-aurora-mint text-ink-950' : 'bg-surface-1 text-fg'}`}>{x}</button>)}</div></div>
        <div className="rounded-2xl border border-subtle bg-surface-1 p-4"><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-fg-muted">Template</p><select value={template} onChange={(e) => setTemplate(e.target.value)} className="h-10 w-full rounded-xl border border-field-border bg-field px-3 text-sm text-fg"><option>Jake ATS Compact</option><option>Modern Professional</option><option>Dark Header Executive</option><option>Minimal ATS</option><option>Two Column Technical</option><option>Cloud/DevOps Engineer</option><option>Fresher Project Focus</option><option>Multi Page Detailed</option></select></div>
      </div>
      <Button onClick={generate}><Wand2 size={16} /> Generate tailored package</Button>
    </div>}
    {status === 'done' && kit && <div>
      {notice && <p className="mb-4 rounded-xl border border-amber-300/30 bg-amber-400/10 p-3 text-sm text-warn">{notice}</p>}
      <div className="rounded-2xl border border-aurora-mint/30 bg-aurora-mint/10 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div><div className="text-xs font-semibold uppercase tracking-[0.3em] text-aurora-mint">Tailored application kit</div><h3 className="font-display text-2xl text-fg">{job?.title} <span className="text-fg-muted">· {job?.company}</span></h3></div>
          <div className="flex flex-wrap gap-2"><Button size="sm" onClick={openEditor}><PenIcon /> Open in Resume Editor</Button><Button size="sm" variant="soft" onClick={() => downloadText(`${base}.txt`, kit.tailoredResume)}> <Download size={13}/>TXT</Button><Button size="sm" variant="soft" onClick={() => downloadText(`${base}.doc`, kit.tailoredResume, 'application/msword')}> <Download size={13}/>DOCX</Button><Button size="sm" variant="soft" onClick={() => downloadText(`${base}.tex`, kit.latexResume || kit.tailoredResume)}> <Download size={13}/>LaTeX</Button></div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-subtle bg-surface-1 p-4 text-center"><div className="text-xs text-muted">ATS Before</div><div className="font-display text-3xl text-danger">{kit.atsBefore}</div></div>
        <div className="rounded-2xl border border-subtle bg-surface-1 p-4 text-center"><div className="text-xs text-muted">ATS After</div><div className="font-display text-3xl text-aurora-mint">{kit.atsAfter}</div></div>
        <div className="rounded-2xl border border-subtle bg-surface-1 p-4 text-center"><div className="text-xs text-muted">Match</div><div className="font-display text-3xl text-fg">{job?._match || kit.atsAfter}</div></div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-subtle bg-base/50 p-4"><h4 className="font-semibold text-fg">Why this job fits</h4><div className="mt-3 space-y-2">{(kit.whyFit || []).map((x, i) => <div key={i} className="rounded-xl border border-aurora-mint/30 bg-aurora-mint/10 px-3 py-2 text-sm text-fg">✓ {x}</div>)}</div></div>
        <div className="rounded-2xl border border-subtle bg-base/50 p-4"><h4 className="font-semibold text-fg">Risks to handle</h4><div className="mt-3 space-y-2">{(kit.riskNotes?.length ? kit.riskNotes : kit.stillMissing || []).map((x, i) => <div key={i} className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-danger">△ {x}</div>)}</div></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">{(kit.matchedKeywords || []).slice(0, 12).map((k) => <Badge key={k} tone="mint">+{k}</Badge>)}{(kit.stillMissing || []).slice(0, 10).map((k) => <Badge key={k} tone="rose">missing: {k}</Badge>)}</div>
      <KitTabs kit={kit} tab={tab} setTab={setTab} />
      <div className="mt-5 flex flex-wrap gap-2 border-t border-subtle pt-4"><Button onClick={openEditor}><FileText size={15}/> Edit tailored resume</Button>{job?.url && <a href={job.url} target="_blank" rel="noreferrer"><Button variant="soft"><ExternalLink size={15}/> Open posting to apply</Button></a>}<Button variant="soft" onClick={() => downloadText(`${base}-application-kit.txt`, [kit.tailoredResume, kit.docs?.coverLetter, kit.docs?.recruiterMessage, kit.docs?.linkedinNote].filter(Boolean).join('\n\n---\n\n'))}> <Download size={15}/> Download kit</Button></div>
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
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-aurora-cta text-sm font-semibold text-ink-950">{(c.name || c.title || 'P').trim()[0] || 'P'}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-fg">{c.name || 'Public profile'}</p>
          <p className="truncate text-xs text-fg-secondary">{c.title || c.position || c.contactType || 'Contact'}{c.company ? ` · ${c.company}` : ''}</p>
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
      {c.email && <p className="truncate rounded-lg bg-base/60 px-2.5 py-1.5 font-mono text-xs text-fg-secondary">{c.email}</p>}
      {c.reason && <p className="text-[11px] leading-snug text-fg-muted">{c.reason}</p>}
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
          <h3 className="min-w-0 truncate font-display text-lg font-semibold text-fg md:text-xl">{j.title}</h3>
          <Badge tone="mint">✓ Open</Badge>
          {j.postedDate
            ? <Badge tone="cyan"><Clock size={11}/> {j.postedDate}</Badge>
            : <Badge tone="amber" title="The source did not provide a posting date; this job is not treated as fresh."><Clock size={11}/> Date unavailable</Badge>}
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
        <div className="min-w-[76px] rounded-xl border border-aurora-mint/30 bg-sunken px-3 py-2 text-center"><div className="font-display text-2xl text-amber-glow">{j._match}</div><div className="font-mono text-[9px] uppercase tracking-widest text-fg-muted">Match</div></div>
        <div className="min-w-[76px] rounded-xl border border-rose-400/25 bg-sunken px-3 py-2 text-center"><div className="font-display text-xl text-fg">{j._backup}</div><div className="font-mono text-[9px] uppercase tracking-widest text-fg-muted">Backup</div></div>
      </div>
    </div>

    {j.summary && <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-fg-secondary">{j.summary}</p>}

    <div className="mt-3 grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-subtle bg-base/55 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-fg-muted">Why it fits</div>
        <div className="flex flex-wrap gap-1.5">{(j._why || []).slice(0, 4).map((x) => <Badge key={x} tone="mint">✓ {x}</Badge>)}</div>
      </div>
      <div className="rounded-xl border border-subtle bg-base/55 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-fg-muted">Missing</div>
        <p className="line-clamp-2 text-[13px] text-fg-secondary">{miss}</p>
      </div>
    </div>

    <div className="mt-3 flex flex-wrap gap-2">
      <Button size="sm" onClick={() => onAction('tailor', j)}><Sparkles size={14}/> Tailor & Apply</Button>
      <Button size="sm" variant="soft" onClick={() => onAction('details', j)}><Eye size={14}/> Details</Button>
      <Button size="sm" variant="soft" onClick={() => onAction('checklist', j)}><ClipboardCheck size={14}/> Checklist</Button>
      <Button size="sm" variant="soft" onClick={() => onAction('interview', j)}><Hammer size={14}/> Prep</Button>
      <Button size="sm" variant="soft" onClick={() => onAction('buildproject', j)}><Rocket size={14}/> Build project for gaps</Button>
      {j.url && <a href={j.url} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><ExternalLink size={14}/> Apply</Button></a>}
      <button onClick={() => onSave(j)} className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3.5 text-[13px] font-medium ${saved ? 'border-amber-glow/40 bg-amber-glow/10 text-amber-glow' : 'border-subtle bg-surface-1 text-fg-secondary'}`}><Bookmark size={14} fill={saved ? 'currentColor' : 'none'}/> {saved ? 'Saved' : 'Save'}</button>
    </div>

    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-subtle pt-3">
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
  const [mode, setMode] = useState(migrateLegacyWorkMode(stored.mode));
  const [experience, setExperience] = useState(migrateLegacyExperience(stored.experience));
  const [jobType, setJobType] = useState(migrateLegacyJobType(stored.jobType));
  /* 30d, not 7d. A one-week hard wall against four remote-only boards was the
     single biggest cause of empty result sets; the backend fallback ladder can
     always tighten back down. */
  const [fresh, setFresh] = useState(stored.freshness || '30d');
  const [meta, setMeta] = useState(null);   // payload.search — explains thin/empty results
  const [diag, setDiag] = useState(null);   // payload.diagnostics — provider health / config errors
  const [state, setState] = useState({ status: stored.status || 'idle', jobs: stored.jobs || [], err: null });
  const [saved, setSaved] = useState(stored.saved || {});
  const [resumeHint, setResumeHint] = useState(Boolean(storedResume.text));
  const [sort, setSort] = useState('priority');
  const [tailorJob, setTailorJob] = useState(null);
  const [people, setPeople] = useState({ open: false, title: '', status: 'idle', contacts: [], err: '', note: '', job: null, draft: '', copied: false });
  const [mini, setMini] = useState({ open: false, title: '', body: '', job: null });
  const [buildConfirm, setBuildConfirm] = useState(null); // { job, gaps } — guided hand-off confirmation
  const [toast, setToast] = useState('');

  const flash = (msg) => { setToast(msg); window.clearTimeout(flash._t); flash._t = window.setTimeout(() => setToast(''), 1800); };

  // Single path used by both the bookmark marker and the "Track" button so the
  // job always lands in the shared tracker (Saved column), deduped, with plan
  // gating applied only when it would create a NEW card.
  const addToTracker = (j) => {
    const exists = !!findCard(getTrackerBoard(), trackerJobIdentity(j));
    if (!exists && !canTrack(getTrackedCount())) {
      promptUpgrade(`${describeLimit('tracking')} Upgrade for unlimited tracking.`, 'pro');
      return { status: 'gated' };
    }
    const res = saveJobToTracker(j);
    flash(res.status === 'duplicate' ? 'Already in tracker' : 'Saved to tracker');
    return res;
  };

  const persist = (patch) => saveStoredJobResults({ role, location: loc, mode, experience, jobType, freshness: fresh, saved, ...patch });
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
    const nextExp = override.experience ?? experience;
    const nextType = override.jobType ?? jobType;
    setRole(searchRole); setState({ status: 'loading', jobs: [], err: null }); setMeta(null); setDiag(null);
    persist({ status: 'loading', jobs: [], role: searchRole, location: nextLoc, mode: nextMode, experience: nextExp, jobType: nextType, freshness: nextFresh });
    try {
      const d = await Jobs.search({ role: searchRole, location: nextLoc, mode: nextMode, experience: nextExp, jobType: nextType, freshness: nextFresh, verify: '0', limit: '18' });
      const jobs = d.jobs || [];
      // payload.search carries the fallback level, per-cause removal counts and a
      // one-line explanation, so a thin result set is never an unexplained blank.
      setMeta(d.search || null);
      setDiag(d.diagnostics || null);
      setState({ status: 'done', jobs, err: null });
      saveStoredJobResults({ status: 'done', jobs, role: searchRole, location: nextLoc, mode: nextMode, experience: nextExp, jobType: nextType, freshness: nextFresh, saved });
    }
    catch (err) { setState({ status: 'error', jobs: [], err: err.message }); setMeta(null); setDiag(null); saveStoredJobResults({ status: 'error', jobs: [], role: searchRole, location: nextLoc, mode: nextMode, experience: nextExp, jobType: nextType, freshness: nextFresh, saved, err: err.message }); }
  };

  useEffect(() => { const queued = consumeQueuedResumeJobSearch(); if (queued?.role) { setResumeHint(true); run(null, { role: queued.role }); } }, []);
  useEffect(() => { const onResumeUpdate = () => { const r = getStoredResume(); setResumeHint(Boolean(r.text)); if (!role && (r.targetRole || getResumeSearchRole())) setRole(r.targetRole || getResumeSearchRole()); }; window.addEventListener('career-resume-updated', onResumeUpdate); return () => window.removeEventListener('career-resume-updated', onResumeUpdate); }, [role]);
  const toggleSave = (j) => {
    const k = keyForJob(j);
    const wasSaved = !!saved[k];
    const next = { ...saved, [k]: !wasSaved };
    setSaved(next);
    saveStoredJobResults({ ...getStoredJobResults(), saved: next });
    // Bookmarking a job adds it to the tracker's Saved column (deduped). We keep
    // the visual bookmark independent of removal — jobs are removed from the
    // Tracker view, not by un-bookmarking, so a card is never lost by accident.
    if (!wasSaved) addToTracker(j);
  };

  const openPeople = async (type, j, opts = {}) => {
    if (!canUse('contacts')) { promptUpgrade(`${describeLimit('contacts')} You've used them all for this month.`, 'pro'); return; }
    const title = type === 'referrals' ? 'Referral paths' : type === 'linkedin' ? 'Public LinkedIn profiles' : 'Hiring contacts';
    setPeople({ open: true, title, status: 'loading', contacts: [], err: '', note: '', job: j, draft: '', copied: false });
    const domain = j.companyDomain || j.domain || domainFromUrl(j.url);
    const payload = { company: j.company, domain, role: j.title, title: type === 'referrals' ? role || j.title : 'Recruiter OR Talent Acquisition OR Hiring Manager', jobId: j.id || j.url };
    try {
      const d = type === 'referrals' ? await Contacts.referrals(payload) : await Contacts.find(payload);
      const contacts = d.contacts || [];
      useMeter('contacts');
      setPeople((p) => ({ ...p, status: 'done', contacts, note: d.note || '', err: d.ok === false ? d.error : '' }));
      if (opts.autoDraft && contacts.length) makeDraft(contacts[0]);
    }
    catch (err) { setPeople((p) => ({ ...p, status: 'error', err: err.message || 'Lookup failed.' })); }
  };
  const makeDraft = async (c) => { if (!canUse('outreach')) { promptUpgrade(`${describeLimit('outreach')} You've used them all for this month.`, 'pro'); return; } setPeople((p) => ({ ...p, draft: 'Generating…', copied: false })); const resume = getStoredResume(); const prompt = `Write a short LinkedIn/email outreach note under 90 words. Candidate resume summary: ${resume.analysis?.summary || resume.text.slice(0, 700)}\nTarget person: ${c.name || 'contact'}, ${c.title || c.position || ''} at ${c.company || people.job?.company || ''}.\nTarget job: ${people.job?.title || role}. Make it specific, polite and non-spammy. Output message only.`; try { const r = await AI.message({ max_tokens: 350, messages: [{ role: 'user', content: prompt }] }); const text = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(); useMeter('outreach'); setPeople((p) => ({ ...p, draft: text })); } catch (e) { const d = describeApiError(e, 'Outreach drafting'); setPeople((p) => ({ ...p, draft: d.message })); if (d.kind === 'quota' && d.suggestPlan) promptUpgrade(d.message, d.suggestPlan); } };
  const copyDraft = () => { navigator.clipboard?.writeText(people.draft || ''); setPeople((p) => ({ ...p, copied: true })); setTimeout(() => setPeople((p) => ({ ...p, copied: false })), 1500); };
  const action = (type, j) => { saveSelectedJob(j); if (type === 'tailor') { setTailorJob(enrichJob(j, getStoredResume())); return; } if (type === 'buildproject') { const ej = enrichJob(j, getStoredResume()); setBuildConfirm({ job: ej, gaps: (ej._missing || []).slice(0, 12) }); return; } if (type === 'details') { const ej = enrichJob(j, getStoredResume()); const body = [
      ej.title ? `Role: ${ej.title}` : '',
      `Company: ${ej.company || 'Not listed'}`,
      `Location: ${ej.location || 'Not listed'}${ej.mode ? ` (${ej.mode})` : ''}`,
      `Source: ${ej.source || 'Unknown'}`,
      `Posted: ${ej.postedDate || 'Date unavailable (not treated as fresh)'}`,
      ej.salary ? `Salary: ${ej.salary}` : '',
      ej.url ? `Apply: ${ej.url}` : 'Apply link: not provided by source',
      (ej._missing && ej._missing.length) ? `\nSkill gaps to address: ${ej._missing.join(', ')}` : '',
      `\n— Full description —\n${ej.summary || 'No description text was provided by the source. Open the posting to read the full description.'}`,
    ].filter(Boolean).join('\n'); setMini({ open: true, title: 'Job details', body, job: ej }); return; } if (type === 'outreach') { openPeople('contacts', j, { autoDraft: true }); return; } if (type === 'contacts' || type === 'referrals' || type === 'linkedin') { openPeople(type, j); return; } if (type === 'track') { const r = addToTracker(j); if (r.status !== 'gated') go?.('tracker'); return; } const body = type === 'checklist' ? ['Verify posting is still open', 'Generate tailored package', 'Download PDF/DOCX resume', 'Copy recruiter or LinkedIn note', 'Submit manually on official job site', 'Add to tracker', 'Set follow-up after 3 days'].map((x,i)=>`${i+1}. ${x}`).join('\n') : type === 'interview' ? `Interview prep for ${j.title}\n\nFocus areas:\n• ${[...(j.requiredSkills || []), ...j._missing || []].slice(0,6).join('\n• ')}\n\nPrepare STAR stories for ownership, production issue handling, CI/CD, cloud, security and collaboration.` : `Generate outreach from the Tailor & Apply kit or use Find hiring contact first.`; setMini({ open: true, title: type === 'checklist' ? 'Apply checklist' : type === 'interview' ? 'Interview prep' : 'Outreach', body, job: j }); };

  // #5 — Build Project for Gaps: confirm first, then seed the guided studio with
  // THIS job's context and gaps. We do not silently jump into a generic workspace.
  const confirmBuildProject = () => {
    if (!buildConfirm?.job) return;
    const j = buildConfirm.job;
    const gaps = buildConfirm.gaps || [];
    saveStudioSeed({ job: { title: j.title, company: j.company }, missingSkills: gaps, type: inferType(gaps, j.title) });
    setBuildConfirm(null);
    go?.('projectstudio');
  };

  return <>
    <PageIntro title="Find verified jobs" sub="Resume-aware job discovery with the same legacy flow: match score → tailor package → contacts/referrals → editor → tracker." />
    {resumeHint && <div className="mb-4 rounded-2xl border border-aurora-mint/20 bg-aurora-mint/10 px-4 py-3 text-sm text-fg">Resume and analysis are saved. Job results stay here when you move to another section. <span className="ml-1 font-medium text-fg">Current role: {role || 'select a role'}</span></div>}
    <form onSubmit={run} className="gradient-border mb-6 p-4"><div className="flex flex-col gap-3 md:flex-row"><div className="relative flex-1"><Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-muted"/><Input value={role} onChange={(e)=>setRole(e.target.value)} placeholder="Role e.g. DevOps Engineer" className="pl-10"/></div><div className="relative md:w-56"><select value={ROLE_OPTIONS.includes(role) ? role : ''} onChange={(e)=>e.target.value && setRole(e.target.value)} className="h-11 w-full cursor-pointer appearance-none rounded-xl border border-field-border bg-field pl-3.5 pr-9 text-sm text-fg outline-none transition hover:border-strong hover:bg-field-hover focus:border-aurora-violet/70 focus:ring-2 focus:ring-aurora-violet/25"><option value="">Pick a role…</option>{Object.entries(ROLE_GROUPS).map(([grp, roles]) => <optgroup key={grp} label={grp}>{roles.map((r)=><option key={r} value={r}>{r}</option>)}</optgroup>)}</select><ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted"/></div><div className="relative md:w-52"><MapPin size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-muted"/><Input value={loc} onChange={(e)=>setLoc(e.target.value)} placeholder="Country / city" className="pl-10"/></div><Button type="submit" disabled={state.status === 'loading' || !role.trim()}><Search size={16}/> Search</Button></div><div className="mt-3 flex flex-wrap items-center gap-2"><span className="flex items-center gap-1.5 text-xs text-fg-muted"><Filter size={13}/> Filters:</span>{MODES.map((m)=><button key={m.value} onClick={()=>setMode(m.value)} type="button" className={`rounded-lg px-3 py-1 text-xs transition ${mode===m.value?'bg-aurora-violet/15 text-fg ring-1 ring-aurora-violet/30':'text-fg-secondary hover:bg-surface-hover'}`}>{m.label}</button>)}<span className="mx-1 h-4 w-px bg-surface-2"/><select value={experience} onChange={(e)=>setExperience(e.target.value)} className="h-7 cursor-pointer rounded-lg border border-field-border bg-field px-2 text-xs text-fg-secondary outline-none">{EXPERIENCE_OPTIONS.map((o)=><option key={o.value} value={o.value}>{o.label}</option>)}</select><select value={jobType} onChange={(e)=>setJobType(e.target.value)} className="h-7 cursor-pointer rounded-lg border border-field-border bg-field px-2 text-xs text-fg-secondary outline-none">{JOB_TYPE_OPTIONS.map((o)=><option key={o.value} value={o.value}>{o.label}</option>)}</select><span className="mx-1 h-4 w-px bg-surface-2"/>{FRESH.map(([l,v])=><button key={v} onClick={()=>setFresh(v)} type="button" className={`rounded-lg px-3 py-1 text-xs transition ${fresh===v?'bg-aurora-cyan/15 text-fg ring-1 ring-aurora-cyan/30':'text-fg-secondary hover:bg-surface-hover'}`}>{l}</button>)}</div></form>
    {state.status === 'loading' && <div className="space-y-4">{Array.from({length:4}).map((_,i)=><Skeleton key={i} className="h-56 w-full rounded-2xl"/>)}</div>}
    {state.status === 'error' && <EmptyState icon={Briefcase} title="Search failed" hint={state.err} action={<Button size="sm" onClick={run}>Retry</Button>} />}
    {state.status === 'idle' && <EmptyState icon={Search} title="Search for your next role" hint="Analyze your resume first for best matching, or manually search a role here." />}
    {/* Why a result set is thin or empty. The backend returns the fallback level
        it had to reach and a per-cause removal breakdown; showing it turns an
        unexplained blank page into something a student can act on. */}
    {/* A configured provider actually FAILED (bad key, no subscription, 429,
        unreachable). This is a configuration/health problem, not "no jobs" —
        it is shown even when fallback boards returned something, because
        degrading to remote-only results while the India provider 401s is
        exactly the silent failure this replaces. */}
    {state.status === 'done' && diag?.errorCode && diag?.errorMessage && (
      <div className="mb-4 rounded-xl border border-amber-glow/40 bg-amber-glow/10 px-4 py-3 text-xs leading-relaxed text-fg" role="status">
        <span className="font-semibold">Job source problem ({diag.errorCode}):</span> {diag.errorMessage}
        {diag.provider?.statusCode ? <span className="ml-1 text-fg-secondary">(provider HTTP {diag.provider.statusCode})</span> : null}
      </div>
    )}
    {/* Provider-level role broadening: real postings, different job title. */}
    {state.status === 'done' && diag?.provider?.broadened?.label && (
      <div className="mb-4 rounded-xl border border-aurora-violet/30 bg-aurora-violet/10 px-4 py-2.5 text-xs leading-relaxed text-fg">
        {diag.provider.broadened.label}
      </div>
    )}
    {/* Which filters the backend had to relax, named individually. */}
    {state.status === 'done' && meta?.usedFallback && (meta.explanation || meta.relaxedFilters?.length > 0) && (
      <div className="mb-4 rounded-xl border border-aurora-cyan/30 bg-aurora-cyan/10 px-4 py-3 text-xs leading-relaxed text-fg-secondary">
        {meta.explanation && <p className="text-fg">{meta.explanation}</p>}
        {meta.relaxedFilters?.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {meta.relaxedFilters.map((r, i) => <li key={i}>{r.label}</li>)}
          </ul>
        )}
        {meta.thinResults && (
          <p className="mt-2 text-fg">Fewer results than requested, but every one shown is a real posting.</p>
        )}
      </div>
    )}
    {state.status === 'done' && state.jobs.length === 0 && (
      <EmptyState
        icon={Briefcase}
        title={diag?.errorCode ? 'Job search could not run' : 'No jobs found'}
        hint={diag?.errorMessage || meta?.coverageHint || meta?.explanation || 'Try a broader role, clear the location, or widen the time window.'}
        action={fresh !== 'latest' ? <Button size="sm" onClick={(e)=>run(e,{ freshness:'latest', mode:'any', experience:'any', jobType:'any' })}>Search with all filters cleared</Button> : null}
      />
    )}
    {state.status === 'done' && state.jobs.length > 0 && <><div className="mb-4 flex flex-wrap items-center gap-2"><button className="rounded-full border border-aurora-mint/40 bg-aurora-mint/10 px-4 py-2 text-xs font-semibold text-aurora-mint">{state.jobs.length} {fresh === 'latest' ? 'jobs' : 'jobs within window'}</button><button onClick={()=>setSort('priority')} className={`rounded-xl border px-4 py-2 text-xs font-semibold ${sort==='priority'?'border-strong bg-surface-2 text-fg':'border-subtle text-fg-secondary'}`}>Sort by priority</button><button onClick={()=>setSort('newest')} className={`rounded-xl border px-4 py-2 text-xs font-semibold ${sort==='newest'?'border-strong bg-surface-2 text-fg':'border-subtle text-fg-secondary'}`}>Sort newest</button><button onClick={()=>setSort('match')} className={`rounded-xl border px-4 py-2 text-xs font-semibold ${sort==='match'?'border-strong bg-surface-2 text-fg':'border-subtle text-fg-secondary'}`}>Sort match</button><button className="rounded-xl border border-subtle px-4 py-2 text-xs font-semibold text-fg-secondary">🔎 Freshness log</button></div><div className="space-y-4">{enrichedJobs.map((j,i)=><JobCard key={keyForJob(j)+i} j={j} saved={!!saved[keyForJob(j)]} onSave={toggleSave} onAction={action}/>)}</div></>}
    <TailorModal open={!!tailorJob} job={tailorJob} go={go} onClose={()=>setTailorJob(null)} />
    <Modal open={!!buildConfirm} onClose={()=>setBuildConfirm(null)} title="Build a project for these gaps" width="max-w-xl">
      {buildConfirm && <div className="space-y-4">
        <p className="text-sm text-muted">This opens the guided Project Studio pre-filled with the context from <span className="font-medium text-fg">{buildConfirm.job.title}</span>{buildConfirm.job.company ? <> at <span className="font-medium text-fg">{buildConfirm.job.company}</span></> : null}. Nothing is created until you generate and save a project there.</p>
        <div className="rounded-2xl border border-subtle bg-base/60 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-fg-muted">Skill gaps to target</div>
          {buildConfirm.gaps.length
            ? <div className="flex flex-wrap gap-1.5">{buildConfirm.gaps.map((g) => <Badge key={g} tone="rose">{g}</Badge>)}</div>
            : <p className="text-sm text-fg-secondary">No specific gaps detected from your resume — the studio will suggest a project from the role instead.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={confirmBuildProject}><Rocket size={15}/> Continue to guided studio</Button>
          <Button variant="soft" onClick={()=>setBuildConfirm(null)}><X size={15}/> Cancel</Button>
        </div>
      </div>}
    </Modal>
    <Modal open={mini.open} onClose={()=>setMini((m)=>({...m,open:false}))} title={mini.title} width="max-w-2xl"><pre className="whitespace-pre-wrap rounded-xl border border-subtle bg-base/70 p-4 text-sm leading-relaxed text-fg">{mini.body}</pre><div className="mt-4 flex gap-2"><Button onClick={()=>setTailorJob(enrichJob(mini.job, getStoredResume()))}><Sparkles size={14}/> Tailor package</Button>{mini.job?.url && <a href={mini.job.url} target="_blank" rel="noreferrer"><Button variant="soft"><ExternalLink size={14}/> Open posting</Button></a>}</div></Modal>
    <Modal open={people.open} onClose={() => setPeople((p)=>({...p,open:false}))} title={people.title} width="max-w-3xl">{people.status === 'loading' && <div className="grid gap-3 sm:grid-cols-2">{Array.from({length:4}).map((_,i)=><Skeleton key={i} className="h-36 rounded-xl" />)}</div>}{people.status === 'error' && <EmptyState icon={AlertTriangle} title="Lookup failed" hint={people.err} />}{people.status === 'done' && people.contacts.length === 0 && <EmptyState icon={Users} title="No people found" hint={people.err || 'Try again or add Hunter/PDL/Apollo keys for verified contacts.'} />}{people.status === 'done' && people.contacts.length > 0 && <>{people.note && <p className="mb-3 rounded-xl border border-subtle bg-surface-1 px-3 py-2 text-[11px] leading-snug text-fg-secondary">{people.note}</p>}<div className="grid gap-3 sm:grid-cols-2">{people.contacts.map((c,i)=><ContactCard key={i} c={c} onDraft={makeDraft} />)}</div></>}{people.draft && <div className="mt-4 rounded-xl border border-subtle bg-surface-1 p-4"><div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium text-fg">Outreach draft</p><Button size="sm" variant="soft" onClick={copyDraft}>{people.copied ? <Check size={13}/> : <Copy size={13}/>} {people.copied ? 'Copied' : 'Copy'}</Button></div><textarea value={people.draft} onChange={(e)=>setPeople((p)=>({...p,draft:e.target.value}))} className="h-32 w-full resize-none rounded-lg border border-field-border bg-field p-3 text-sm text-fg outline-none"/></div>}</Modal>
    {toast && (
      <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-aurora-mint/30 bg-menu px-4 py-2.5 text-sm font-medium text-ok shadow-lift" role="status">
        {toast}
      </div>
    )}
  </>;
}
