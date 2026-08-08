import { useState } from 'react';
import {
  FileStack, Sparkles, Loader2, AlertTriangle, ShieldCheck, ShieldAlert, Copy, Check,
  Mail, Linkedin, Handshake, Clock, MessageCircle, Target,
} from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Field } from '../components/ui/kit.jsx';
import { Applications } from '../lib/api.js';
import { getStoredResume } from '../lib/resumeStore.js';

const DOC_META = [
  ['coverLetter', 'Cover letter', Mail],
  ['recruiterEmail', 'Recruiter email', Mail],
  ['linkedinMessage', 'LinkedIn message', Linkedin],
  ['referralRequest', 'Referral request', Handshake],
  ['followUp', 'Follow-up', Clock],
  ['interviewTalkingPoints', 'Interview talking points', MessageCircle],
];

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-400 hover:text-white">
      {done ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
    </button>
  );
}

function DocCard({ icon: Icon, title, body }) {
  const isEmail = typeof body === 'object' && body.subject != null;
  const isList = Array.isArray(body);
  const copyText = isEmail ? `Subject: ${body.subject}\n\n${body.body}` : isList ? body.join('\n') : String(body);
  return (
    <SectionCard title={title} action={<CopyBtn text={copyText} />}>
      <div className="mb-1 text-[11px] text-aurora-violet/70"><Icon size={13} className="mb-0.5 inline" /></div>
      {isEmail && <div className="mb-2 text-[12px] text-slate-400">Subject: <span className="text-slate-200">{body.subject}</span></div>}
      {isList
        ? <ul className="space-y-1.5">{body.map((s, i) => <li key={i} className="text-[13px] text-slate-300">• {s}</li>)}</ul>
        : <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-slate-300">{isEmail ? body.body : body}</pre>}
    </SectionCard>
  );
}

export default function ApplicationsView() {
  const stored = getStoredResume();
  const [resumeText, setResumeText] = useState(stored.text || '');
  const [jd, setJd] = useState('');
  const [role, setRole] = useState(stored.targetRole || '');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pkg, setPkg] = useState(null);

  const generate = async () => {
    if (resumeText.trim().length < 40) { setErr('Add your resume text (or analyze one on the Resume page first).'); return; }
    if (jd.trim().length < 30) { setErr('Paste the job description.'); return; }
    setBusy(true); setErr(''); setPkg(null);
    try {
      const data = await Applications.generate({ resumeText, jobDescription: jd, targetRole: role, applicantName: name, enrich: true });
      setPkg(data.package);
    } catch (e) { setErr(e?.message || 'Generation failed.'); } finally { setBusy(false); }
  };

  return (
    <>
      <PageIntro title="Application package" sub="Generate a tailored resume, cover letter, recruiter email, LinkedIn message, referral request, follow-up and interview talking points for one job — using only your real, verified skills. No fake claims." />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <SectionCard title="Inputs">
          <Field label="Your name (optional)"><input value={name} onChange={(e) => setName(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm text-slate-100 outline-none focus:border-aurora-violet/50" placeholder="Jane Smith" /></Field>
          <div className="mt-3"><Field label="Target role (optional)"><input value={role} onChange={(e) => setRole(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm text-slate-100 outline-none focus:border-aurora-violet/50" placeholder="DevOps Engineer" /></Field></div>
          <div className="mt-3"><Field label="Resume text">
            <textarea value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="Paste your resume (auto-filled if you analyzed one on the Resume page)…" className="h-40 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200 outline-none focus:border-aurora-violet/50" />
          </Field></div>
          <div className="mt-3"><Field label="Job description">
            <textarea value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full job description…" className="h-40 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200 outline-none focus:border-aurora-violet/50" />
          </Field></div>
          {err && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-glow"><AlertTriangle size={13} /> {err}</p>}
          <Button className="mt-3" onClick={generate} disabled={busy}>{busy ? <><Loader2 size={16} className="animate-spin" /> Generating…</> : <><Sparkles size={16} /> Generate package</>}</Button>
        </SectionCard>

        <div className="space-y-4">
          {!pkg ? (
            <SectionCard><div className="py-10 text-center text-sm text-slate-500"><FileStack size={28} className="mx-auto mb-2 text-slate-600" /> Your complete application package appears here.</div></SectionCard>
          ) : (
            <>
              <SectionCard title="Summary">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="cyan"><Target size={11} /> {pkg.role}</Badge>
                  <Badge tone={pkg.jobFitScore >= 70 ? 'mint' : pkg.jobFitScore >= 50 ? 'cyan' : 'amber'}>Job fit {pkg.jobFitScore}/100</Badge>
                  {pkg.fabricationSafe
                    ? <Badge tone="mint"><ShieldCheck size={11} /> No fabricated claims</Badge>
                    : <Badge tone="rose"><ShieldAlert size={11} /> {pkg.fabricationRisks.length} risk(s)</Badge>}
                  {pkg.toneEnrichedBy === 'ai' && <Badge tone="violet"><Sparkles size={11} /> Tone polished</Badge>}
                </div>
                {pkg.usedVerifiedSkills?.length > 0 && (
                  <div className="mt-3"><div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Verified skills used</div>
                    <div className="flex flex-wrap gap-1.5">{pkg.usedVerifiedSkills.map((s) => <Badge key={s} tone="mint"><ShieldCheck size={10} /> {s}</Badge>)}</div></div>
                )}
                {pkg.missingRequiredSkills?.length > 0 && (
                  <div className="mt-3"><div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">JD skills not in your resume (not claimed)</div>
                    <div className="flex flex-wrap gap-1.5">{pkg.missingRequiredSkills.map((s) => <Badge key={s} tone="violet">{s}</Badge>)}</div></div>
                )}
                {!pkg.fabricationSafe && (
                  <ul className="mt-3 space-y-1 border-t border-white/8 pt-3">{pkg.fabricationRisks.map((r, i) => <li key={i} className="text-[12px] text-rose-300">• {r.type?.replace(/_/g, ' ')}: {r.detail}</li>)}</ul>
                )}
              </SectionCard>

              {DOC_META.map(([key, title, Icon]) => (
                <DocCard key={key} icon={Icon} title={title} body={pkg.documents[key]} />
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
