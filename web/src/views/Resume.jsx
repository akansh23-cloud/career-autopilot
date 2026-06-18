import { useEffect, useRef, useState } from 'react';
import { Briefcase, ChevronDown, FileText, Sparkles, AlertTriangle, CheckCircle2, Gauge, Upload, Loader2, X, Target, ShieldCheck } from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Skeleton, EmptyState, Field } from '../components/ui/kit.jsx';
import ResumeTailor from './ResumeTailor.jsx';
import { ResumeApi } from '../lib/api.js';
import { extractResumeText, ACCEPT } from '../lib/resume.js';
import { ROLE_GROUPS } from '../lib/roles.js';
import { clearStoredResume, getStoredResume, queueResumeJobSearch, saveResumeAnalysis, saveStoredResume } from '../lib/resumeStore.js';
import { getProfile } from '../lib/userProfile.js';

// Human-readable labels + max points for each deterministic scoring category.
const BREAKDOWN_LABELS = {
  atsParseability: ['ATS parseability', 15],
  contactInfo: ['Contact information', 8],
  sectionCompleteness: ['Section completeness', 12],
  roleKeywordMatch: ['Role keyword match', 18],
  skillsRelevance: ['Skills relevance', 15],
  experienceRelevance: ['Experience / projects', 15],
  quantifiedImpact: ['Quantified impact', 10],
  readability: ['Readability / clarity', 5],
  antiKeywordStuffing: ['Anti keyword-stuffing', 0],
};
const BREAKDOWN_ORDER = ['atsParseability', 'contactInfo', 'sectionCompleteness', 'roleKeywordMatch', 'skillsRelevance', 'experienceRelevance', 'quantifiedImpact', 'readability', 'antiKeywordStuffing'];

function Ring({ value }) {
  const r = 52, c = 2 * Math.PI * r, off = c - (value / 100) * c;
  const tone = value >= 80 ? '#46E6A6' : value >= 60 ? '#37D6C4' : '#FFC85A';
  return (
    <div className="relative grid h-36 w-36 place-items-center">
      <svg width="136" height="136" className="-rotate-90">
        <circle cx="68" cy="68" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" />
        <circle cx="68" cy="68" r={r} fill="none" stroke={tone} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset 1s ease' }} />
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-3xl font-semibold text-white">{value}</div>
        <div className="text-[11px] text-slate-500">/ 100</div>
      </div>
    </div>
  );
}

function BreakdownBar({ label, value, max }) {
  // Penalty rows (max 0) render as a deduction, not a progress bar.
  if (!max) {
    if (!value) return null;
    return (
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-slate-300">{label}</span>
        <span className="tabular-nums text-rose-300">{value}</span>
      </div>
    );
  }
  const pct = Math.round((value / max) * 100);
  const tone = pct >= 80 ? '#46E6A6' : pct >= 50 ? '#37D6C4' : '#FFC85A';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-slate-300">{label}</span>
        <span className="tabular-nums text-slate-400">{value}/{max}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone, transition: 'width .8s ease' }} />
      </div>
    </div>
  );
}

export default function Resume({ go }) {
  const stored = getStoredResume();
  const [resume, setResume] = useState(stored.text || '');
  const [role, setRole] = useState(stored.targetRole || '');
  const [status, setStatus] = useState(stored.analysis ? 'done' : 'idle');
  const [result, setResult] = useState(stored.analysis || null);
  const [err, setErr] = useState('');
  const [fileName, setFileName] = useState(stored.fileName || '');
  const [parsing, setParsing] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    const onResumeUpdate = (e) => {
      const next = e.detail || getStoredResume();
      setResume(next.text || '');
      setRole(next.targetRole || '');
      setFileName(next.fileName || '');
    };
    window.addEventListener('career-resume-updated', onResumeUpdate);
    return () => window.removeEventListener('career-resume-updated', onResumeUpdate);
  }, []);

  const updateRole = (value) => {
    setRole(value);
    saveStoredResume({ targetRole: value, analysis: null, analysedAt: '' });
    setResult(null);
    setStatus('idle');
  };

  const updateResumeText = (value, nextFileName = fileName) => {
    setResume(value);
    setFileName(nextFileName);
    saveStoredResume({ text: value, fileName: nextFileName, targetRole: role, analysis: null, analysedAt: '' });
    setResult(null);
    setStatus('idle');
  };

  const findMatchingJobs = () => {
    if (resume.trim().length < 40) { setErr('Upload or paste your resume first.'); return; }
    if (!result) { setErr('Analyze the resume first. Matching jobs unlock after ATS analysis.'); return; }
    // Use the role the resume was actually scored for; fall back to the AI suggestion.
    const searchRole = result.scoredRole && result.scoredRole !== 'General'
      ? result.scoredRole
      : (role || result.recommendedRole);
    const payload = queueResumeJobSearch(searchRole);
    if (!payload.role) { setErr('Select a target role first so matching jobs can be searched.'); return; }
    saveStoredResume({ text: resume, fileName, targetRole: payload.role, analysis: result });
    go?.('jobs');
  };

  const ingestFile = async (file) => {
    if (!file) return;
    setParsing(true); setErr('');
    try {
      const txt = await extractResumeText(file);
      if (!txt || txt.length < 20) throw new Error('Could not read text from that file. Try a text-based PDF or DOCX.');
      updateResumeText(txt, file.name);
    } catch (e) {
      setErr(e.message || 'Failed to read file.');
    } finally {
      setParsing(false);
    }
  };

  const onPick = (e) => { const f = e.target.files?.[0]; ingestFile(f); e.target.value = ''; };
  const onDrop = (e) => { e.preventDefault(); setDrag(false); ingestFile(e.dataTransfer.files?.[0]); };
  const clearFile = () => { setFileName(''); setResume(''); clearStoredResume(); };

  // The score now comes from the deterministic backend engine — never from the
  // browser. The frontend only sends text + file name + target role and renders
  // the response. Same resume + same role always returns the same score.
  const analyze = async () => {
    if (resume.trim().length < 40) { setErr('Paste a bit more of your resume to analyze.'); return; }
    setStatus('loading'); setErr(''); setResult(null);
    try {
      const data = await ResumeApi.analyze({
        resumeText: resume,
        fileName,
        targetRole: role, // empty => backend scores for "General"; AI never silently changes it
      });
      setResult(data);
      // Persist the analysis snapshot for cross-device hydration. The target
      // role stored is the one the resume was SCORED for (never the AI's
      // recommendation), so future scores stay consistent.
      saveResumeAnalysis(data);
      setStatus('done');
    } catch (e) {
      setErr(e?.message || 'Analysis failed. Please try again.');
      setStatus('error');
    }
  };

  const scoredRole = result?.scoredRole || result?.targetRole || (role || 'General');
  const showRecommendation = result?.recommendedRole && result.recommendedRole !== scoredRole;

  // Advisory only — a sparse profile means weaker role/keyword recommendations,
  // but it must NEVER block resume analysis or tailoring. Purely informational.
  const profile = getProfile();
  const profileIncomplete = !(
    (profile.targetRole && String(profile.targetRole).trim()) ||
    (profile.skills && String(profile.skills).trim()) ||
    (role && role.trim())
  );

  return (
    <>
      <PageIntro title="Resume intelligence" sub="Upload a PDF/DOCX or paste your resume to get a deterministic ATS score with a full breakdown and concrete fixes." />

      {profileIncomplete && (
        <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-aurora-violet/25 bg-aurora-violet/[0.07] p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-slate-200">
            <Target size={15} className="text-aurora-violet" /> Complete your profile for better recommendations.
          </p>
          {go && <Button size="sm" variant="soft" onClick={() => go('careerprofile')}>Update profile</Button>}
        </div>
      )}


      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <SectionCard title="Your resume">
          <Field label="Target role (optional)">
            <div className="relative">
              <select
                value={role}
                onChange={(e) => updateRole(e.target.value)}
                className="h-11 w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-white/[0.03] px-3.5 pr-10 text-sm text-slate-100 outline-none focus:border-aurora-violet/50"
              >
                <option value="">General (no specific role)</option>
                {Object.entries(ROLE_GROUPS).map(([grp, roles]) => (
                  <optgroup key={grp} label={grp}>
                    {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                  </optgroup>
                ))}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            </div>
          </Field>

          {/* Upload dropzone */}
          <input ref={fileRef} type="file" accept={ACCEPT} onChange={onPick} className="hidden" />
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            className={`mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition ${
              drag ? 'border-aurora-violet/60 bg-aurora-violet/10' : 'border-white/12 bg-white/[0.02] hover:border-white/25'
            }`}
          >
            {parsing ? (
              <><Loader2 size={20} className="animate-spin text-aurora-cyan" /><span className="text-sm text-muted">Reading file…</span></>
            ) : fileName ? (
              <div className="flex items-center gap-2 text-sm text-slate-200">
                <FileText size={16} className="text-aurora-mint" /> {fileName}
                <button onClick={(e) => { e.stopPropagation(); clearFile(); }} className="rounded-md p-1 text-slate-500 hover:text-white"><X size={14} /></button>
              </div>
            ) : (
              <>
                <Upload size={20} className="text-slate-400" />
                <span className="text-sm font-medium text-slate-200">Drop resume or click to upload</span>
                <span className="text-[11px] text-slate-500">PDF, DOCX, TXT — parsed in your browser</span>
              </>
            )}
          </div>

          <textarea
            value={resume} onChange={(e) => updateResumeText(e.target.value, '')}
            placeholder="…or paste your resume text here"
            className="mt-3 h-56 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-relaxed text-slate-200 outline-none placeholder:text-slate-600 focus:border-aurora-violet/50"
          />
          {err && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-glow"><AlertTriangle size={13} /> {err}</p>}
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-slate-500">{resume.length} chars{fileName ? ` • saved: ${fileName}` : resume ? ' • saved locally' : ''}</span>
            <div className="flex flex-wrap gap-2">
              {result && (
                <Button variant="soft" onClick={findMatchingJobs} disabled={parsing || resume.trim().length < 40}>
                  <Briefcase size={16} /> Find matching jobs
                </Button>
              )}
              <Button onClick={analyze} disabled={status === 'loading'}>
                <Sparkles size={16} /> {status === 'loading' ? 'Analyzing…' : result ? 'Re-analyze resume' : 'Analyze resume'}
              </Button>
            </div>
          </div>
        </SectionCard>

        <div className="space-y-4">
          {status === 'idle' && <EmptyState icon={Gauge} title="Score appears here" hint="Run an analysis to see your deterministic ATS score, full breakdown, strengths and fixes." />}
          {status === 'error' && <EmptyState icon={AlertTriangle} title="Couldn’t analyze" hint={err} action={<Button size="sm" onClick={analyze}>Retry</Button>} />}
          {status === 'loading' && (
            <SectionCard><div className="flex flex-col items-center gap-4 py-6">
              <Skeleton className="h-36 w-36 rounded-full" />
              <Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" />
            </div></SectionCard>
          )}
          {status === 'done' && result && (
            <>
              <SectionCard>
                <div className="flex flex-col items-center gap-3">
                  <Ring value={Number(result.score) || 0} />
                  <p className="text-center text-sm text-muted">{result.summary}</p>

                  {/* Scored-for vs recommended role — kept distinct so the AI
                      suggestion never silently changes what was scored. */}
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Badge tone="cyan"><Target size={12} /> Scored for: {scoredRole}</Badge>
                    {showRecommendation && <Badge tone="violet">Recommended role: {result.recommendedRole}</Badge>}
                  </div>

                  {result.cached && (
                    <p className="flex items-center gap-1.5 text-[11px] text-aurora-mint">
                      <ShieldCheck size={12} /> Consistent result — same resume &amp; role returns the same score.
                    </p>
                  )}

                  <Button className="mt-1" variant="soft" onClick={findMatchingJobs}><Briefcase size={16} /> Find matching jobs</Button>

                  <div className="grid w-full grid-cols-3 gap-2 border-t border-white/8 pt-3">
                    {[['ATS', result.ats], ['Impact', result.impact], ['Clarity', result.clarity]].map(([l, v]) => (
                      <div key={l} className="text-center">
                        <div className="font-display text-lg text-white">{v ?? '—'}</div>
                        <div className="text-[11px] text-slate-500">{l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </SectionCard>

              {result.breakdown && (
                <SectionCard title="Score breakdown">
                  <div className="space-y-3">
                    {BREAKDOWN_ORDER.filter((k) => result.breakdown[k] != null).map((k) => {
                      const [label, max] = BREAKDOWN_LABELS[k];
                      return <BreakdownBar key={k} label={label} value={result.breakdown[k]} max={max} />;
                    })}
                  </div>
                </SectionCard>
              )}

              {result.strengths?.length > 0 && (
                <SectionCard title="Strengths">
                  <ul className="space-y-2">
                    {result.strengths.map((s, i) => <li key={i} className="flex gap-2 text-sm text-slate-300"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-aurora-mint" /> {s}</li>)}
                  </ul>
                </SectionCard>
              )}
              {result.improvements?.length > 0 && (
                <SectionCard title="Fix these">
                  <ul className="space-y-2">
                    {result.improvements.map((s, i) => <li key={i} className="flex gap-2 text-sm text-slate-300"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-glow" /> {s}</li>)}
                  </ul>
                </SectionCard>
              )}
              {result.matchedKeywords?.length > 0 && (
                <SectionCard title={`Matched keywords (${result.matchedKeywords.length})`}>
                  <div className="flex flex-wrap gap-2">
                    {result.matchedKeywords.map((k) => <Badge key={k} tone="mint">{k}</Badge>)}
                  </div>
                </SectionCard>
              )}
              {result.missingKeywords?.length > 0 && (
                <SectionCard title="Missing keywords">
                  <div className="flex flex-wrap gap-2">
                    {result.missingKeywords.map((k) => <Badge key={k} tone="violet">{k}</Badge>)}
                  </div>
                </SectionCard>
              )}
              {result.skillEvidence?.length > 0 && (
                <SectionCard title="Skill evidence">
                  <div className="flex flex-wrap gap-2">
                    {result.skillEvidence.map((e) => (
                      <Badge key={e.skill} tone={e.evidenced ? 'mint' : 'default'}>
                        {e.skill}{e.evidenced ? ' • proven' : ' • listed'}
                      </Badge>
                    ))}
                  </div>
                </SectionCard>
              )}
            </>
          )}
        </div>
      </div>

      {resume.trim().length >= 40 && (
        <ResumeTailor
          resumeText={resume}
          fileName={fileName}
          targetRole={scoredRole !== 'General' ? scoredRole : role}
          resumeScore={result?.score ?? null}
        />
      )}
    </>
  );
}
