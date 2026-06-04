import { motion } from 'framer-motion';
import {
  Sparkles, ArrowRight, FileText, Wand2, Target, ListChecks, Send, ShieldCheck,
  Trophy, TrendingUp, Github, Twitter, Linkedin, Zap, Brain, Workflow, CheckCircle2,
} from 'lucide-react';
import { Button, Badge } from '../ui/kit.jsx';
import Atmosphere from '../Atmosphere.jsx';

const reveal = {
  hidden: { opacity: 0, y: 28 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.6, delay: i * 0.08, ease: [0.2, 0.7, 0.2, 1] } }),
};
const V = ({ children, i = 0, className }) => (
  <motion.div variants={reveal} custom={i} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }} className={className}>
    {children}
  </motion.div>
);

function Logo({ size = 'md' }) {
  const s = size === 'lg' ? 'text-xl' : 'text-[17px]';
  return (
    <a href="#top" className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl btn-primary text-white shadow-glow">
        <Zap size={18} strokeWidth={2.5} />
      </span>
      <span className={`font-display ${s} font-semibold tracking-tight text-white`}>Career&nbsp;Autopilot</span>
    </a>
  );
}

function Nav({ onSignIn }) {
  const links = [['Workflow', '#workflow'], ['Pipeline', '#pipeline'], ['Matching', '#matching'], ['Tracker', '#tracker'], ['Why us', '#why']];
  return (
    <header className="fixed inset-x-0 top-0 z-40">
      <div className="mx-auto mt-3 flex max-w-6xl items-center justify-between gap-4 rounded-2xl border border-white/8 bg-ink-900/60 px-4 py-2.5 backdrop-blur-xl sm:px-5">
        <Logo />
        <nav className="hidden items-center gap-1 lg:flex">
          {links.map(([l, h]) => (
            <a key={h} href={h} className="rounded-lg px-3 py-1.5 text-sm text-slate-300/80 transition hover:bg-white/5 hover:text-white">{l}</a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onSignIn} className="hidden sm:inline-flex">Sign in</Button>
          <Button size="sm" onClick={onSignIn}>Get started <ArrowRight size={15} /></Button>
        </div>
      </div>
    </header>
  );
}

/* Floating product preview — a faux dashboard frame */
function ProductPreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50, rotateX: 12 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ duration: 1, delay: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
      style={{ perspective: 1200 }}
      className="relative mx-auto mt-16 max-w-5xl"
    >
      <div className="gradient-border overflow-hidden shadow-lift">
        <div className="flex items-center gap-2 border-b border-white/8 bg-ink-900/80 px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-rose-400/70" />
          <span className="h-3 w-3 rounded-full bg-amber-glow/70" />
          <span className="h-3 w-3 rounded-full bg-aurora-mint/70" />
          <span className="ml-3 rounded-md bg-white/5 px-3 py-1 text-xs text-slate-400">app.careerautopilot.ai/dashboard</span>
        </div>
        <div className="grid grid-cols-[170px_1fr] bg-ink-950/80">
          <div className="hidden flex-col gap-1 border-r border-white/6 p-3 sm:flex">
            {['Dashboard', 'Resume', 'Jobs', 'Tracker', 'Outreach', 'Arena'].map((n, i) => (
              <div key={n} className={`rounded-lg px-3 py-2 text-[13px] ${i === 0 ? 'bg-aurora-violet/15 text-white' : 'text-slate-400'}`}>{n}</div>
            ))}
          </div>
          <div className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="font-display text-lg text-white">Good evening, Lavesh</div>
                <div className="text-xs text-slate-500">3 interviews · 12 applications live</div>
              </div>
              <Badge tone="mint"><CheckCircle2 size={12} /> On track</Badge>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[['Resume score', '92', 'cyan'], ['Matches today', '18', 'violet'], ['Responses', '6', 'mint']].map(([l, v, t]) => (
                <div key={l} className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                  <div className="text-[11px] text-slate-500">{l}</div>
                  <div className={`mt-1 font-display text-2xl ${t === 'cyan' ? 'text-aurora-cyan' : t === 'violet' ? 'text-aurora-violet' : 'text-aurora-mint'}`}>{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                <div className="mb-2 text-[11px] text-slate-500">Application funnel</div>
                <div className="flex items-end gap-1.5 h-16">
                  {[30, 55, 40, 70, 50, 85, 65].map((h, i) => (
                    <div key={i} style={{ height: `${h}%` }} className="flex-1 rounded-t bg-gradient-to-t from-aurora-violet/40 to-aurora-cyan/80" />
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 space-y-2">
                <div className="text-[11px] text-slate-500">Top matches</div>
                {['Senior DevOps · 96%', 'Platform Eng · 91%', 'SRE · 88%'].map((m) => (
                  <div key={m} className="flex items-center justify-between rounded-lg bg-white/4 px-2.5 py-1.5 text-[12px] text-slate-300">
                    {m.split(' · ')[0]} <span className="text-aurora-mint">{m.split(' · ')[1]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="glow-blob absolute -inset-x-10 -bottom-10 top-1/2 -z-10 bg-aurora-violet/20" />
    </motion.div>
  );
}

function SectionHead({ tag, title, sub }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <Badge tone="violet" className="mb-4">{tag}</Badge>
      <h2 className="font-display text-3xl font-semibold text-white sm:text-[42px] sm:leading-[1.1]">{title}</h2>
      {sub && <p className="mt-4 text-[15px] leading-relaxed text-muted">{sub}</p>}
    </div>
  );
}

function FeatureCard({ icon: Icon, title, body, tone = 'violet', i }) {
  const ring = { violet: 'text-aurora-violet', cyan: 'text-aurora-cyan', mint: 'text-aurora-mint', amber: 'text-amber-glow' }[tone];
  return (
    <V i={i}>
      <div className="gradient-border lift h-full p-6 hover:shadow-glow">
        <div className={`mb-4 grid h-11 w-11 place-items-center rounded-xl bg-white/[0.04] ring-1 ring-white/10 ${ring}`}>
          <Icon size={20} />
        </div>
        <h3 className="font-display text-lg font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
      </div>
    </V>
  );
}

export default function Landing({ onSignIn }) {
  return (
    <div id="top" className="relative">
      <Atmosphere variant="landing" />
      <Nav onSignIn={onSignIn} />

      {/* HERO */}
      <section className="px-5 pt-36 pb-10 sm:pt-44">
        <div className="mx-auto max-w-4xl text-center">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <Badge tone="cyan" className="mb-6"><Sparkles size={12} /> Your AI career operating system</Badge>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.05 }}
            className="font-display text-5xl font-semibold leading-[1.04] tracking-tight text-white sm:text-7xl"
          >
            From resume to interview,<br /><span className="text-aurora">fully on autopilot.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }}
            className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted"
          >
            Career Autopilot screens and tailors your resume, matches verified jobs, tracks every application
            and drafts recruiter outreach — one calm workspace doing the work of a whole career team.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.25 }}
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Button size="lg" onClick={onSignIn}>Start free <ArrowRight size={17} /></Button>
            <Button size="lg" variant="outline" onClick={() => document.getElementById('workflow')?.scrollIntoView()}>See the workflow</Button>
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-500">
            <ShieldCheck size={14} /> Real, verified jobs only · no AI-fabricated listings
          </motion.div>
        </div>
        <ProductPreview />
      </section>

      {/* WORKFLOW */}
      <section id="workflow" className="px-5 py-24">
        <SectionHead
          tag="AI Career Workflow"
          title="One loop that runs your whole search"
          sub="Every stage feeds the next. The AI learns what works for you and compounds it across applications."
        />
        <div className="mx-auto mt-14 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard i={0} icon={Brain} tone="violet" title="Understand you" body="Parse your resume, skills and target roles into a structured profile the AI reasons over." />
          <FeatureCard i={1} icon={Wand2} tone="cyan" title="Tailor instantly" body="Rewrite and re-score your resume per job — ATS-aware, achievement-first, eight clean templates." />
          <FeatureCard i={2} icon={Target} tone="mint" title="Match & rank" body="Pull verified roles from real boards and rank them by genuine fit, not keyword soup." />
          <FeatureCard i={3} icon={Send} tone="amber" title="Reach out" body="Find recruiters and draft warm, personalised outreach and referral notes in your voice." />
        </div>
      </section>

      {/* PIPELINE */}
      <section id="pipeline" className="px-5 py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
          <V>
            <Badge tone="cyan" className="mb-4"><Workflow size={12} /> Resume → Interview Pipeline</Badge>
            <h2 className="font-display text-3xl font-semibold text-white sm:text-[40px] sm:leading-[1.1]">
              A pipeline that ends in <span className="text-aurora">interviews</span>, not dead ends.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-muted">
              Upload once. Career Autopilot scores your resume, fixes the gaps, tailors it to each role,
              and preps you with role-specific interview questions — so each application moves you forward.
            </p>
            <ul className="mt-6 space-y-3">
              {['Live ATS & impact scoring with fix suggestions', 'Per-job tailoring with 8 distinct templates', 'Auto / single / multi-page length intelligence', 'Role-aware interview prep plans'].map((t) => (
                <li key={t} className="flex items-start gap-3 text-sm text-slate-300">
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-aurora-mint" /> {t}
                </li>
              ))}
            </ul>
          </V>
          <V i={1}>
            <div className="gradient-border p-6 shadow-card">
              {[['Resume parsed', 'done'], ['ATS score · 92/100', 'done'], ['Tailored to “Senior DevOps”', 'done'], ['Interview prep generated', 'active'], ['Mock round scheduled', 'idle']].map(([label, state], idx) => (
                <div key={label} className="flex items-center gap-4 py-3">
                  <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold ${state === 'done' ? 'bg-aurora-mint/15 text-aurora-mint' : state === 'active' ? 'btn-primary text-white' : 'bg-white/5 text-slate-500'}`}>
                    {state === 'done' ? <CheckCircle2 size={16} /> : idx + 1}
                  </div>
                  <div className={`flex-1 text-sm ${state === 'idle' ? 'text-slate-500' : 'text-slate-200'}`}>{label}</div>
                  {state === 'active' && <Badge tone="violet">running</Badge>}
                </div>
              ))}
            </div>
          </V>
        </div>
      </section>

      {/* MATCHING + TRACKER + OUTREACH grid */}
      <section id="matching" className="px-5 py-12">
        <SectionHead tag="Built for the whole search" title="Job matching, tracking & outreach in one place" />
        <div className="mx-auto mt-14 grid max-w-6xl gap-4 lg:grid-cols-3" id="tracker">
          <FeatureCard i={0} icon={Target} tone="cyan" title="Job Matching" body="Verified roles from LinkedIn, Indeed, Naukri, Wellfound and more — ranked by real fit and freshness." />
          <FeatureCard i={1} icon={ListChecks} tone="violet" title="Application Tracker" body="A clean board from saved → applied → interview → offer, with reminders so nothing slips." />
          <FeatureCard i={2} icon={Send} tone="mint" title="Recruiter Outreach" body="Surface the right contacts and generate referral + cold-outreach messages that actually get replies." />
        </div>
      </section>

      {/* WHY */}
      <section id="why" className="px-5 py-24">
        <SectionHead tag="Why Career Autopilot" title="Honest by design, premium by default" sub="No fabricated jobs, no spray-and-pray. Just a focused workspace that respects your time and your data." />
        <div className="mx-auto mt-14 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [ShieldCheck, 'Verified jobs only', 'Every listing is pulled from a real source and URL-verified server-side.'],
            [Brain, 'Structured AI', 'AI returns clean structured data — templates render real content, never hallucinated layouts.'],
            [Trophy, 'Opportunity Arena', 'Hackathons, hiring challenges and contests that turn into real offers.'],
            [TrendingUp, 'Growth insights', 'See what’s working across your funnel and double down on it.'],
            [Zap, 'Fast & calm', 'A smooth, single-scroll workspace — no clutter, no friction.'],
            [FileText, 'Eight resume templates', 'Single & multi-page designs tuned by role and length.'],
          ].map(([Icon, t, b], i) => (
            <FeatureCard key={t} i={i} icon={Icon} tone={['violet', 'cyan', 'mint', 'amber', 'cyan', 'violet'][i]} title={t} body={b} />
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 py-16">
        <V>
          <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-white/10 px-8 py-16 text-center shadow-lift">
            <div className="glow-blob absolute -left-10 -top-10 h-72 w-72 bg-aurora-violet/40" />
            <div className="glow-blob absolute -right-10 -bottom-10 h-72 w-72 bg-aurora-cyan/30" />
            <div className="relative">
              <h2 className="font-display text-4xl font-semibold text-white sm:text-5xl">Put your career on autopilot.</h2>
              <p className="mx-auto mt-4 max-w-xl text-[15px] text-muted">Sign in with Google and launch your AI workspace in seconds. Free to start.</p>
              <Button size="lg" className="mt-8" onClick={onSignIn}>Get started free <ArrowRight size={17} /></Button>
            </div>
          </div>
        </V>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/8 px-5 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
          <Logo />
          <p className="text-sm text-slate-500">© {new Date().getFullYear()} Career Autopilot. Crafted for ambitious job-seekers.</p>
          <div className="flex items-center gap-3 text-slate-400">
            {[Github, Twitter, Linkedin].map((I, i) => (
              <a key={i} href="#top" className="rounded-lg p-2 transition hover:bg-white/6 hover:text-white"><I size={18} /></a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
