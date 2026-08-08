import { useState } from 'react';
import { BookOpen, ChevronDown, AlertTriangle, Target, Wrench, ListChecks, CircleHelp } from 'lucide-react';

/* ============================================================
   Project Brief panel — "what am I actually building?"
   ------------------------------------------------------------
   Rendered ABOVE the build artifacts everywhere a project lands
   (patent → POC, project workspace, marketplace import). The
   complaint this answers: students opened a generated project and
   saw APIs, tasks and a file tree with no explanation of what the
   thing is.

   The panel is honest about provenance: when no AI provider is
   configured the brief is templated, and the footer says so
   instead of implying it was written for this specific project.
   ============================================================ */

const PROVIDER_LABELS = {
  gemini: 'Gemini',
  anthropic: 'Claude',
  openai: 'GPT',
  deterministic: 'template',
  fallback: 'template',
};

function Section({ icon: Icon, title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-white/[0.06] pt-3 first:border-0 first:pt-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left text-[11px] uppercase tracking-wide text-slate-500 hover:text-slate-300"
      >
        <Icon size={13} />
        <span className="flex-1">{title}</span>
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

const Bullets = ({ items, ordered }) => (
  <ol className="space-y-1.5">
    {(items || []).map((it, i) => (
      <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-slate-300">
        <span className="shrink-0 text-slate-600">{ordered ? `${i + 1}.` : '•'}</span>
        <span>{it}</span>
      </li>
    ))}
  </ol>
);

export default function ProjectBriefPanel({ brief, compact = false }) {
  if (!brief) return null;
  const provider = PROVIDER_LABELS[brief.generatedBy] || brief.generatedBy || 'template';
  const templated = brief.generatedBy === 'deterministic' || brief.generatedBy === 'fallback';

  return (
    <div className="rounded-2xl border border-aurora-violet/25 bg-aurora-violet/[0.04] p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-aurora-violet/40 bg-aurora-violet/10 px-2 py-1 text-[11px] font-semibold text-[#E4DCFF]">
          <BookOpen size={12} /> What you&apos;re building
        </span>
        {brief.disciplineLabel && (
          <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-300">
            {brief.disciplineLabel}
          </span>
        )}
      </div>

      <p className="text-[15px] font-medium leading-snug text-white">{brief.oneLine}</p>
      {brief.note && (
        <p className="mt-2 flex gap-2 rounded-lg border border-aurora-amber/30 bg-aurora-amber/[0.06] px-3 py-2 text-[12px] text-[#EAC97C]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{brief.note}</span>
        </p>
      )}
      <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-300">{brief.inPlainEnglish}</p>

      {!compact && (
        <div className="mt-4 space-y-3">
          {brief.howItWorks?.length > 0 && (
            <Section icon={Target} title="How it works, end to end">
              <div className="space-y-2">
                {brief.howItWorks.map((s, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="mt-0.5 shrink-0 rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{s.stage}</span>
                    <p className="text-[13px] leading-relaxed text-slate-300">{s.what}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {brief.whatSuccessLooksLike && (
            <Section icon={ListChecks} title="What finished looks like">
              <p className="text-[13px] leading-relaxed text-slate-300">{brief.whatSuccessLooksLike}</p>
              {brief.howYouKnowItWorks && (
                <p className="mt-2 text-[13px] leading-relaxed text-slate-400"><span className="text-slate-500">How you prove it: </span>{brief.howYouKnowItWorks}</p>
              )}
            </Section>
          )}

          {brief.firstWeek?.length > 0 && (
            <Section icon={Wrench} title="Your first week">
              <Bullets items={brief.firstWeek} ordered />
              {brief.toolchain?.length > 0 && (
                <p className="mt-2 text-[12px] text-slate-500">Tools: {brief.toolchain.join(' · ')}</p>
              )}
            </Section>
          )}

          {brief.notBuildingYet?.length > 0 && (
            <Section icon={AlertTriangle} title="Deliberately not building yet" defaultOpen={false}>
              <Bullets items={brief.notBuildingYet} />
              {brief.commonFailureMode && (
                <p className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[12px] leading-relaxed text-slate-400">
                  <span className="text-slate-500">Where this usually goes wrong: </span>{brief.commonFailureMode}
                </p>
              )}
            </Section>
          )}

          {brief.glossary?.length > 0 && (
            <Section icon={CircleHelp} title="Terms you'll hit" defaultOpen={false}>
              <dl className="space-y-2">
                {brief.glossary.map((g, i) => (
                  <div key={i}>
                    <dt className="text-[12px] font-semibold text-slate-200">{g.term}</dt>
                    <dd className="text-[12px] leading-relaxed text-slate-400">{g.meaning}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}
        </div>
      )}

      <p className="mt-4 border-t border-white/[0.06] pt-2.5 text-[11px] text-slate-600">
        {templated
          ? 'Written from a template — no AI provider is configured, so this is generic guidance shaped by the project type rather than a reading of your specific idea.'
          : `Prose written by ${provider} over a deterministic outline. Treat it as a starting explanation, not a verified plan.`}
      </p>
    </div>
  );
}
