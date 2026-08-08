import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useSpring, useTransform, useMotionValue } from 'framer-motion';
import {
  Zap, ArrowRight, Check, GraduationCap, Briefcase, Building2, Sparkles,
  Trophy, ShieldCheck, Github, Linkedin, Twitter, Menu, X, FileText,
  KanbanSquare, Send, Radar, Target, Gauge, Star,
  GitBranch, Activity, Wand2,
} from 'lucide-react';
import { Button } from '../ui/kit.jsx';
import Atmosphere from '../Atmosphere.jsx';
import NetworkSphere from './NetworkSphere.jsx';

const cx = (...a) => a.filter(Boolean).join(' ');

/* ============================================================
   LANDING — "Solar Flight Deck" (v2, high-craft)
   Cursor-reactive, kinetic, tactile. Built on the app's own
   design tokens so it stays continuous with every screen.
   CTAs call onSignIn (provided by App.jsx).
   ============================================================ */

function useReduced() {
  const [r, setR] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    setR(m.matches);
    const f = () => setR(m.matches);
    m.addEventListener?.('change', f);
    return () => m.removeEventListener?.('change', f);
  }, []);
  return r;
}

const reveal = {
  hidden: { opacity: 0, y: 28 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.7, delay: i * 0.07, ease: [0.2, 0.7, 0.2, 1] } }),
};
const V = ({ children, i = 0, className }) => (
  <motion.div variants={reveal} custom={i} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-70px' }} className={className}>
    {children}
  </motion.div>
);

const Tele = ({ children, className = '' }) => (
  <span className={cx('font-mono text-[10px] uppercase tracking-[0.3em] text-aurora-violet/75', className)}>{children}</span>
);

/* 3D tilt + spotlight wrapper */
function Tilt({ children, className = '', max = 9 }) {
  const reduce = useReduced();
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rotX = useSpring(useTransform(my, [0, 1], [max, -max]), { stiffness: 150, damping: 16 });
  const rotY = useSpring(useTransform(mx, [0, 1], [-max, max]), { stiffness: 150, damping: 16 });
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width);
    my.set((e.clientY - r.top) / r.height);
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  const onLeave = () => { mx.set(0.5); my.set(0.5); };
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      onMouseMove={onMove} onMouseLeave={onLeave}
      style={{ rotateX: rotX, rotateY: rotY, transformPerspective: 1000 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* Magnetic hover wrapper */
function Magnetic({ children, className = '', strength = 0.3 }) {
  const reduce = useReduced();
  const x = useSpring(useMotionValue(0), { stiffness: 220, damping: 12 });
  const y = useSpring(useMotionValue(0), { stiffness: 220, damping: 12 });
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const onLeave = () => { x.set(0); y.set(0); };
  if (reduce) return <span className={cx('inline-block', className)}>{children}</span>;
  return (
    <motion.span onMouseMove={onMove} onMouseLeave={onLeave} style={{ x, y }} className={cx('inline-block', className)}>
      {children}
    </motion.span>
  );
}

/* Decode/scramble text */
function Decode({ text, className = '' }) {
  const reduce = useReduced();
  const [out, setOut] = useState(text);
  useEffect(() => {
    if (reduce) { setOut(text); return undefined; }
    const chars = '01<>/{}[]#*+=λ';
    let frame = 0;
    const total = text.length;
    const id = setInterval(() => {
      frame += 1;
      const revealed = Math.floor(frame / 2);
      let s = '';
      for (let i = 0; i < total; i += 1) {
        if (text[i] === ' ') { s += ' '; continue; }
        s += i < revealed ? text[i] : chars[Math.floor(Math.random() * chars.length)];
      }
      setOut(s);
      if (revealed >= total) clearInterval(id);
    }, 42);
    return () => clearInterval(id);
  }, [text, reduce]);
  return <span className={className}>{out}</span>;
}

function Stat({ value, suffix = '', label }) {
  const ref = useRef(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      if (reduce) { setN(value); return; }
      const dur = 1500, start = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - start) / dur);
        setN(value * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick); else setN(value);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, [value]);
  const fmt = (x) => (value >= 10000 ? Math.round(x).toLocaleString('en-IN') : (Number.isInteger(value) ? String(Math.round(x)) : x.toFixed(0)));
  return (
    <div ref={ref}>
      <div className="font-display text-3xl font-extrabold drop-shadow-[0_0_24px_rgba(188,168,255,0.25)] sm:text-4xl">
        <span className="text-aurora">{fmt(n)}{suffix}</span>
      </div>
      <div className="mt-1.5 text-[13px] text-muted">{label}</div>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-full btn-primary shadow-glow ring-1 ring-strong">
        <ShieldCheck size={17} strokeWidth={2.5} className="relative z-[2] text-ink-950" />
      </span>
      <span className="font-display text-[17px] font-extrabold tracking-tight text-fg">Career&nbsp;Autopilot</span>
    </div>
  );
}

function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const w = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });
  return <motion.div style={{ scaleX: w }} className="fixed inset-x-0 top-0 z-[60] h-[3px] origin-left bg-aurora-cta" />;
}

function Nav({ onSignIn }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 24);
    f();
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);
  const links = [['Systems', '#systems'], ['Sequence', '#sequence'], ['Deck', '#deck'], ['Numbers', '#numbers']];
  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3">
      <div className={cx(
        'mx-auto flex max-w-7xl items-center justify-between rounded-2xl border px-4 transition-all duration-300 sm:px-5',
        scrolled ? 'mt-2 border-subtle bg-base/80 py-2 shadow-lift backdrop-blur-xl' : 'mt-4 border-transparent bg-transparent py-3'
      )}>
        <Logo />
        <nav className="hidden items-center gap-7 md:flex">
          {links.map(([l, h]) => (
            <a key={l} href={h} className="group relative text-sm text-fg-secondary transition hover:text-fg">
              {l}
              <span className="absolute -bottom-1 left-0 h-px w-0 bg-aurora-violet transition-all duration-300 group-hover:w-full" />
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onSignIn} className="hidden sm:inline-flex">Sign in</Button>
          <Button size="sm" onClick={onSignIn}>Get started <ArrowRight size={15} /></Button>
          <button onClick={() => setOpen((v) => !v)} className="grid h-9 w-9 place-items-center rounded-xl border border-subtle text-fg md:hidden">{open ? <X size={18} /> : <Menu size={18} />}</button>
        </div>
      </div>
      {open && (
        <div className="mx-auto mt-2 max-w-7xl rounded-2xl border border-subtle bg-menu p-4 backdrop-blur-xl md:hidden">
          {links.map(([l, h]) => (
            <a key={l} href={h} onClick={() => setOpen(false)} className="block border-b border-subtle py-3 font-display text-xl text-fg">{l}</a>
          ))}
          <Button className="mt-4 w-full justify-center" onClick={() => { setOpen(false); onSignIn(); }}>Get started <ArrowRight size={15} /></Button>
        </div>
      )}
    </header>
  );
}

function FloatCard({ className, icon: Icon, tone, title, sub, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.7 }}
      className={cx('absolute z-20 flex items-center gap-2.5 rounded-2xl border border-subtle bg-menu px-3.5 py-2.5 shadow-lift backdrop-blur-xl', className)}
    >
      <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-lg', tone)}><Icon size={15} /></span>
      <div className="leading-tight">
        <div className="text-[13px] font-semibold text-fg">{title}</div>
        <div className="text-[11px] text-muted">{sub}</div>
      </div>
    </motion.div>
  );
}

function Hero({ onSignIn }) {
  return (
    <section className="relative px-4 pt-32 sm:px-6 sm:pt-40">
      {/* editorial ghost word */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-24 select-none text-center">
        <span className="outline-text font-display text-[clamp(80px,20vw,300px)] font-extrabold leading-none tracking-tighter">AUTOPILOT</span>
      </div>

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <motion.span
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 rounded-full border border-aurora-violet/30 bg-aurora-violet/10 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-brand"
          >
            <span className="h-1.5 w-1.5 animate-ticker rounded-full bg-aurora-mint shadow-[0_0_8px_rgba(87,230,168,0.9)]" />
            Your career, on autopilot
          </motion.span>

          <h1 className="mt-5 font-display text-[clamp(42px,6.6vw,84px)] font-extrabold leading-[0.94] text-fg">
            <motion.span initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.06 }} className="block">From résumé to</motion.span>
            <motion.span initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.14 }} className="block">
              <span className="text-flow"><Decode text="offer letter" /></span>,
            </motion.span>
            <motion.span initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.22 }} className="block">automated.</motion.span>
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.3 }}
            className="mt-6 max-w-xl text-[17px] leading-relaxed text-fg-secondary/90"
          >
            One flight deck that screens roles, tailors your résumé, builds proof-of-work projects, and reaches out — so you land the role faster, with less guesswork.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.38 }}
            className="mt-8 flex flex-wrap items-center gap-4"
          >
            <Magnetic>
              <Button size="lg" onClick={onSignIn} className="glow-ring">Launch your deck — free <ArrowRight size={16} /></Button>
            </Magnetic>
            <Button size="lg" variant="outline" onClick={onSignIn}>See it fly</Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7, delay: 0.5 }}
            className="mt-7 flex items-center gap-3 text-sm text-fg-secondary"
          >
            <div className="flex -space-x-2">
              {['#BCA8FF', '#6EE0F2', '#57E6A8', '#7C6BF2'].map((c) => (
                <span key={c} className="h-7 w-7 rounded-full border-2 border-base" style={{ background: c }} />
              ))}
            </div>
            <span className="flex items-center gap-1 text-amber-glow">{[0, 1, 2, 3, 4].map((i) => <Star key={i} size={13} fill="currentColor" />)}</span>
            <span>loved by <b className="text-fg">12,000+</b> job-seekers</span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7, delay: 0.58 }}
            className="mt-9 grid max-w-md grid-cols-3 gap-6 border-t border-subtle pt-6"
          >
            <Stat value={18} suffix=" days" label="Avg. time to offer" />
            <Stat value={96} suffix="%" label="Match precision" />
            <Stat value={40000} label="Roles tracked" />
          </motion.div>
        </div>

        <div className="relative mx-auto flex h-[440px] w-full max-w-[540px] items-center justify-center sm:h-[500px]">
          {/* orbital rings */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="h-[380px] w-[380px] animate-spin-slow rounded-full border border-aurora-violet/15" />
            <div className="absolute h-[300px] w-[300px] rounded-full border border-dashed border-subtle" />
          </div>
          <div className="absolute inset-0 grid place-items-center"><NetworkSphere /></div>
          <FloatCard className="left-0 top-6" icon={ShieldCheck} tone="bg-aurora-mint/15 text-aurora-mint" title="Profile verified" sub="Proof-of-work confirmed" delay={0.6} />
          <FloatCard className="right-0 top-1/3" icon={Target} tone="bg-aurora-violet/15 text-aurora-violet" title="96% match" sub="Cloud Engineer · Pune" delay={0.8} />
          <FloatCard className="bottom-6 left-4" icon={Trophy} tone="bg-amber-glow/15 text-amber-glow" title="Offer received 🎉" sub="Hired in 18 days" delay={1.0} />
        </div>
      </div>
    </section>
  );
}

function Marquee() {
  const items = ['Résumé Studio', 'Verified Jobs', 'Proof-of-Work', 'GitHub Sync', 'Smart Outreach', 'Skill Badges', 'Referral Exchange', 'Leaderboards'];
  const row = [...items, ...items];
  return (
    <div className="relative mt-24 space-y-3 overflow-hidden border-y border-subtle py-6 pause-on-hover">
      <div className="mask-fade-x flex w-max animate-marquee gap-10">
        {row.map((t, i) => (
          <span key={`a${i}`} className="flex items-center gap-10 whitespace-nowrap font-display text-lg font-semibold text-fg-secondary/55">{t}<span className="text-aurora-violet/50">◆</span></span>
        ))}
      </div>
      <div className="mask-fade-x flex w-max animate-marquee-rev gap-10 opacity-60">
        {row.map((t, i) => (
          <span key={`b${i}`} className="flex items-center gap-10 whitespace-nowrap font-display text-lg font-medium text-fg-muted/50">{t}<span className="text-aurora-cyan/40">◆</span></span>
        ))}
      </div>
    </div>
  );
}

function SectionHead({ kicker, title, sub, id }) {
  return (
    <div id={id} className="mx-auto max-w-2xl text-center">
      <V><Tele>{kicker}</Tele></V>
      <V i={1}><h2 className="mt-3 font-display text-[clamp(30px,4.4vw,54px)] font-extrabold leading-[1.02] text-fg">{title}</h2></V>
      {sub && <V i={2}><p className="mt-4 text-[16px] text-fg-secondary">{sub}</p></V>}
    </div>
  );
}

function MatchRing({ pct = 96 }) {
  const r = 34, c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-28 w-28 place-items-center">
      <svg viewBox="0 0 80 80" className="h-28 w-28 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
        <motion.circle
          cx="40" cy="40" r={r} fill="none" stroke="url(#mg)" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          whileInView={{ strokeDashoffset: c - (c * pct) / 100 }}
          viewport={{ once: true }}
          transition={{ duration: 1.4, ease: [0.2, 0.7, 0.2, 1] }}
        />
        <defs>
          <linearGradient id="mg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#EAC97C" /><stop offset="55%" stopColor="#BCA8FF" /><stop offset="100%" stopColor="#7C6BF2" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-2xl font-extrabold text-fg">{pct}%</div>
        <div className="font-mono text-[9px] uppercase tracking-widest text-fg-muted">match</div>
      </div>
    </div>
  );
}

function Bento() {
  return (
    <section className="px-4 py-28 sm:px-6">
      <SectionHead id="systems" kicker="Onboard systems" title="Three engines. One trajectory." sub="Every part of the job hunt, instrumented and working together." />
      <div className="mx-auto mt-14 grid max-w-6xl auto-rows-[1fr] gap-5 lg:grid-cols-3">
        {/* Big — Résumé Studio */}
        <V className="lg:col-span-2 lg:row-span-2">
          <Tilt className="h-full">
            <div className="gradient-border spotlight ticks lift relative flex h-full flex-col overflow-hidden p-7 hover:border-aurora-violet/35 hover:shadow-lift">
              <div className="flex items-center justify-between">
                <span className="grid h-12 w-12 place-items-center rounded-2xl border border-aurora-violet/25 bg-aurora-violet/10 text-aurora-violet"><FileText size={22} /></span>
                <span className="font-mono text-xs text-fg-muted">01</span>
              </div>
              <h3 className="mt-5 font-display text-[26px] font-extrabold text-fg">Résumé Studio</h3>
              <p className="mt-2 max-w-md text-[15px] leading-relaxed text-fg-secondary">AI rewrites every bullet against the live job description, tunes for ATS, and exports a recruiter-ready PDF in seconds.</p>
              {/* mini before/after */}
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-subtle bg-surface-1 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">Before</div>
                  <p className="mt-2 text-sm leading-relaxed text-fg-muted line-through decoration-rose-400/40">Worked on the backend and helped the team ship features.</p>
                </div>
                <div className="rounded-2xl border border-aurora-mint/25 bg-aurora-mint/[0.06] p-4">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-ok"><Sparkles size={11} /> Tailored</div>
                  <p className="mt-2 text-sm leading-relaxed text-fg">Shipped 6 Go microservices cutting p95 latency 38%, unblocking 4 product launches.</p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {['ATS-tuned', 'Per-role tailoring', 'PDF export', 'Keyword gaps'].map((c) => (
                  <span key={c} className="rounded-full border border-subtle bg-surface-1 px-3 py-1 text-xs font-medium text-fg-secondary">{c}</span>
                ))}
              </div>
            </div>
          </Tilt>
        </V>

        {/* Job Engine */}
        <V i={1}>
          <Tilt className="h-full">
            <div className="gradient-border spotlight lift flex h-full items-center gap-5 overflow-hidden p-6 hover:border-aurora-violet/35 hover:shadow-lift">
              <MatchRing pct={96} />
              <div>
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-aurora-cyan"><Radar size={11} /> Job Engine</span>
                <h3 className="mt-1.5 font-display text-[20px] font-extrabold text-fg">Verified roles, ranked.</h3>
                <p className="mt-1.5 text-sm text-fg-secondary">Real match scores, tracked from applied to offer.</p>
              </div>
            </div>
          </Tilt>
        </V>

        {/* Project Studio */}
        <V i={2}>
          <Tilt className="h-full">
            <div className="gradient-border spotlight lift flex h-full flex-col overflow-hidden p-6 hover:border-aurora-violet/35 hover:shadow-lift">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-aurora-violet"><Wand2 size={11} /> Project Studio</span>
                <span className="inline-flex items-center gap-1 text-[11px] text-fg-muted"><GitBranch size={12} /> synced</span>
              </div>
              <h3 className="mt-2 font-display text-[20px] font-extrabold text-fg">Proof recruiters trust.</h3>
              <p className="mt-1.5 text-sm text-fg-secondary">Generate projects, sync GitHub, earn evidence-based badges.</p>
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                {['React', 'Node', 'Docker', '+ badge'].map((c) => (
                  <span key={c} className="rounded-full border border-aurora-mint/25 bg-aurora-mint/10 px-2.5 py-1 text-[11px] font-medium text-ok">{c}</span>
                ))}
              </div>
            </div>
          </Tilt>
        </V>

        {/* metric strip */}
        <V i={1} className="lg:col-span-3">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-subtle bg-surface-1 sm:grid-cols-4">
            {[['Bullets rewritten', '2.4M'], ['Verified roles', '40K'], ['Avg. ATS lift', '+34%'], ['Offers landed', '12K']].map(([k, v]) => (
              <div key={k} className="bg-base/80 p-5">
                <div className="font-display text-2xl font-extrabold text-aurora">{v}</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-fg-muted">{k}</div>
              </div>
            ))}
          </div>
        </V>
      </div>
    </section>
  );
}

function Sequence() {
  const steps = [
    { icon: GraduationCap, t: 'Set your heading', d: 'Tell the deck your role, level and targets. Pick a persona — student, professional or recruiter.' },
    { icon: Gauge, t: 'Run the systems', d: 'Tailor résumés, scan verified roles, and spin up proof-of-work projects from one workspace.' },
    { icon: Send, t: 'Reach out smart', d: 'Generate warm outreach, request referrals, and let the tracker keep every thread on course.' },
    { icon: Trophy, t: 'Touch down', d: 'Climb the leaderboard, collect verified badges, and land the offer with evidence on your side.' },
  ];
  return (
    <section className="px-4 py-28 sm:px-6">
      <SectionHead id="sequence" kicker="Boarding sequence" title="Four steps to liftoff." />
      <div className="relative mx-auto mt-14 max-w-6xl">
        <div className="pointer-events-none absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-aurora-violet/30 to-transparent lg:block" />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <V key={s.t} i={i}>
              <Tilt className="h-full" max={6}>
                <div className="panel spotlight relative h-full p-6">
                  <div className="flex items-center justify-between">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl border border-subtle bg-gradient-to-b from-ink-800 to-ink-900 text-aurora-violet shadow-glow"><s.icon size={20} /></span>
                    <span className="font-display text-3xl font-extrabold text-fg/[0.08]">0{i + 1}</span>
                  </div>
                  <h3 className="mt-4 font-display text-[18px] font-extrabold text-fg">{s.t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{s.d}</p>
                </div>
              </Tilt>
            </V>
          ))}
        </div>
      </div>
    </section>
  );
}

function Bar({ label, pct, color }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs"><span className="text-fg-secondary">{label}</span><span className="text-fg-muted">{pct}%</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-1">
        <motion.div className={cx('h-full rounded-full', color)} initial={{ width: 0 }} whileInView={{ width: `${pct}%` }} viewport={{ once: true }} transition={{ duration: 1.2, ease: [0.2, 0.7, 0.2, 1] }} />
      </div>
    </div>
  );
}

function Deck() {
  const metrics = [['Applications', '34', 'text-aurora-violet'], ['Interviews', '7', 'text-aurora-cyan'], ['Match avg.', '92%', 'text-aurora-mint'], ['Streak', '12d', 'text-amber-glow']];
  return (
    <section className="px-4 py-28 sm:px-6">
      <SectionHead id="deck" kicker="Mission control" title="Your whole hunt, on one deck." sub="No more scattered spreadsheets and forgotten tabs — just a live readout of where you stand." />
      <V i={2}>
        <Tilt max={4}>
          <div className="mx-auto mt-14 max-w-5xl">
            <div className="gradient-border spotlight ticks relative overflow-hidden p-2 shadow-lift">
              <div className="rounded-[14px] border border-subtle bg-base/85 p-5 sm:p-7">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle pb-5">
                  <div>
                    <Tele>Workspace · Live</Tele>
                    <div className="mt-1 font-display text-xl font-extrabold text-fg">Good evening, Kamal</div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-aurora-mint/30 bg-aurora-mint/12 px-2.5 py-1 text-[11px] font-medium text-ok">
                    <span className="h-1.5 w-1.5 rounded-full bg-aurora-mint" style={{ animation: 'blink 1.6s ease-in-out infinite' }} /> All systems go
                  </span>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {metrics.map(([k, v, c]) => (
                    <div key={k} className="rounded-2xl border border-subtle bg-surface-1 p-4">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-muted">{k}</div>
                      <div className={cx('mt-1 font-display text-2xl font-extrabold', c)}>{v}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-3">
                  <div className="rounded-2xl border border-subtle bg-surface-1 p-4 lg:col-span-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-semibold text-fg"><KanbanSquare size={15} className="text-aurora-violet" /> Pipeline</div>
                      <Activity size={14} className="text-fg-muted" />
                    </div>
                    <div className="mt-3 space-y-2.5">
                      <Bar label="Cloud Engineer · Acme" pct={96} color="bg-aurora-cta" />
                      <Bar label="Backend Dev · Nimbus" pct={88} color="bg-aurora-cta" />
                      <Bar label="Platform · Orbit" pct={74} color="bg-aurora-cta" />
                    </div>
                    {/* sparkline */}
                    <svg viewBox="0 0 300 48" className="mt-4 h-12 w-full" preserveAspectRatio="none">
                      <polyline fill="none" stroke="#6EE0F2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points="0,38 40,30 80,33 120,20 160,24 200,12 240,16 300,6" opacity="0.9" />
                      <polyline fill="url(#spk)" stroke="none" points="0,38 40,30 80,33 120,20 160,24 200,12 240,16 300,6 300,48 0,48" opacity="0.18" />
                      <defs><linearGradient id="spk" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6EE0F2" /><stop offset="100%" stopColor="#6EE0F2" stopOpacity="0" /></linearGradient></defs>
                    </svg>
                  </div>
                  <div className="rounded-2xl border border-aurora-violet/20 bg-aurora-violet/[0.06] p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-fg"><Sparkles size={15} className="text-aurora-violet" /> Next best move</div>
                    <p className="mt-2 text-sm text-fg-secondary">Tailor your résumé for the Acme role — 4 keywords missing.</p>
                    <button className="btn-primary mt-4 w-full rounded-lg py-2 text-xs font-bold">Tailor now</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Tilt>
      </V>
    </section>
  );
}

function Personas() {
  const p = [
    { icon: GraduationCap, t: 'Students', d: 'Build proof-of-work, find project partners, and climb the campus leaderboard.' },
    { icon: Briefcase, t: 'Professionals', d: 'Tailor fast, track everything, and reach the right people with warm intros.' },
    { icon: Building2, t: 'Recruiters', d: 'Scan verified profiles with real evidence — no résumé guesswork.' },
  ];
  return (
    <section className="px-4 py-16 sm:px-6">
      <SectionHead kicker="Flies for everyone" title="Built for your seat." />
      <div className="mx-auto mt-12 grid max-w-5xl gap-5 md:grid-cols-3">
        {p.map((x, i) => (
          <V key={x.t} i={i}>
            <Tilt className="h-full" max={7}>
              <div className="panel spotlight h-full p-6 text-center">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-aurora-violet/25 bg-aurora-violet/10 text-aurora-violet"><x.icon size={24} /></span>
                <h3 className="mt-4 font-display text-[20px] font-extrabold text-fg">{x.t}</h3>
                <p className="mt-2 text-sm text-fg-secondary">{x.d}</p>
              </div>
            </Tilt>
          </V>
        ))}
      </div>
    </section>
  );
}

function Numbers() {
  return (
    <section id="numbers" className="px-4 py-24 sm:px-6">
      <V>
        <div className="relative mx-auto grid max-w-5xl grid-cols-2 gap-8 overflow-hidden rounded-3xl border border-subtle bg-base/50 p-10 sm:grid-cols-4">
          <div className="pointer-events-none absolute inset-0 dotgrid opacity-30" />
          <div className="relative"><Stat value={40000} label="Verified roles tracked" /></div>
          <div className="relative"><Stat value={96} suffix="%" label="Match precision" /></div>
          <div className="relative"><Stat value={18} suffix=" days" label="Avg. time to offer" /></div>
          <div className="relative"><Stat value={12000} label="Offers landed" /></div>
        </div>
      </V>
    </section>
  );
}

function Quote() {
  return (
    <section className="px-4 py-24 sm:px-6">
      <V>
        <div className="mx-auto max-w-3xl text-center">
          <span className="block font-display text-7xl leading-[0.4] text-aurora-violet/45">“</span>
          <p className="font-display text-[clamp(22px,2.7vw,36px)] font-bold leading-snug text-fg">
            I went from scattered tabs to a single deck that told me exactly what to do next. Offer in <span className="text-aurora">eighteen days</span>.
          </p>
          <div className="mt-7 flex items-center justify-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-full btn-primary font-bold"><span className="relative z-[2]">AK</span></span>
            <div className="text-left"><b className="font-semibold text-fg">Ananya K.</b><small className="block text-muted">Final-year CS student → Cloud Engineer</small></div>
          </div>
        </div>
      </V>
    </section>
  );
}

function FinalCTA({ onSignIn }) {
  return (
    <section className="px-4 pb-28 sm:px-6">
      <V>
        <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[28px] border border-aurora-violet/20 p-10 text-center sm:p-16">
          <div className="absolute inset-0 -z-10 bg-gradient-to-br from-aurora-violet/14 via-transparent to-aurora-indigo/14" />
          <div className="absolute inset-0 -z-10 bg-grid opacity-60" />
          <div aria-hidden className="pointer-events-none absolute -bottom-10 left-1/2 -translate-x-1/2 select-none">
            <span className="outline-text font-display text-[clamp(60px,14vw,180px)] font-extrabold leading-none">LIFTOFF</span>
          </div>
          <Tele>Cleared for departure</Tele>
          <h2 className="mt-4 font-display text-[clamp(30px,4.8vw,56px)] font-extrabold leading-[1.02] text-fg">Your career, on autopilot.</h2>
          <p className="mx-auto mt-4 max-w-xl text-[16px] text-fg-secondary">Free to start. No card. Land your next role with a full flight deck behind you.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Magnetic>
              <Button size="lg" onClick={onSignIn} className="glow-ring">Get started free <ArrowRight size={16} /></Button>
            </Magnetic>
            <Button size="lg" variant="outline" onClick={onSignIn}>Talk to sales</Button>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-fg-muted">
            {['No credit card', 'Cancel anytime', 'Verified jobs only'].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5"><Check size={13} className="text-aurora-mint" /> {t}</span>
            ))}
          </div>
        </div>
      </V>
    </section>
  );
}

function Footer() {
  const cols = [
    ['Product', [['Systems', '#'], ['Sequence', '#'], ['For placement cells', '#colleges'], ['Pricing', '#']]],
    ['Company', [['About', '#'], ['Contact', '#/legal/contact'], ['Blog', '#'], ['Careers', '#']]],
    ['Legal', [['Privacy', '#/legal/privacy'], ['Terms', '#/legal/terms'], ['Refunds & Cancellation', '#/legal/refunds'], ['Grievance', '#/legal/contact']]],
  ];
  return (
    <footer className="border-t border-subtle px-4 py-14 sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-fg-muted">The AI flight deck for your career — from résumé to offer letter.</p>
          <div className="mt-5 flex gap-3">
            {[Github, Linkedin, Twitter].map((I, i) => (
              <a key={i} href="#" className="grid h-9 w-9 place-items-center rounded-xl border border-subtle text-fg-secondary transition hover:border-aurora-violet/40 hover:text-fg"><I size={16} /></a>
            ))}
          </div>
        </div>
        {cols.map(([h, items]) => (
          <div key={h}>
            <h4 className="mb-3.5 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-secondary">{h}</h4>
            <ul className="space-y-2.5">
              {items.map(([label, href]) => <li key={label}><a href={href} className="text-sm text-fg-muted transition hover:text-fg">{label}</a></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-12 max-w-7xl border-t border-subtle pt-6 text-center text-xs text-fg-muted">
        © {new Date().getFullYear()} Career Autopilot. Cleared for takeoff.
      </div>
    </footer>
  );
}

/* ---- For placement cells: the TPO-facing pitch, anchor #colleges.
        Cold-outreach links land here instead of a student-only page. ---- */
function CollegesSection({ onSignIn }) {
  const props = [
    ['Live readiness command center', 'Funnel, at-risk register, branch/batch matrices and skill coverage across your whole cohort — in August, not December.'],
    ['Verified, not self-claimed', 'Projects are GitHub-linked and viva-checked; resume scores are deterministic. Your recruiters see proof, and your NAAC Criterion 5 export writes itself.'],
    ['Onboard a batch in an afternoon', 'Import your roster CSV, share one join code, or verify your email domain — students link automatically, with DPDP-compliant consent built in.'],
  ];
  return (
    <section id="colleges" className="relative px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-aurora-cyan">For placement cells</p>
        <h2 className="mt-3 max-w-2xl font-display text-3xl font-semibold text-fg sm:text-4xl">
          Find out who isn't ready in week 4 — not in placement week.
        </h2>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-fg-secondary">
          Career Autopilot gives Training &amp; Placement teams a live, consent-gated view of every student's verified readiness, with nudges and task assignments that actually reach them.
        </p>
        <div className="mt-9 grid gap-4 md:grid-cols-3">
          {props.map(([h, p]) => (
            <div key={h} className="rounded-2xl border border-subtle bg-surface-1 p-5 transition hover:border-aurora-violet/30">
              <h3 className="font-display text-[15px] font-semibold text-fg">{h}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-fg-secondary">{p}</p>
            </div>
          ))}
        </div>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <button onClick={onSignIn} className="rounded-xl btn-primary px-5 py-2.5 text-sm font-semibold text-ink-950">
            Register your college — free pilot
          </button>
          <a href="#/legal/contact" className="rounded-xl border border-subtle px-5 py-2.5 text-sm text-fg-secondary transition hover:border-strong hover:text-fg">
            Talk to us first
          </a>
          <span className="text-[12px] text-fg-muted">8-week pilot · one branch · written success criteria · no payment details.</span>
        </div>
      </div>
    </section>
  );
}

export default function Landing({ onSignIn }) {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <ScrollProgress />
      <Atmosphere variant="landing" />
      <Nav onSignIn={onSignIn} />
      <Hero onSignIn={onSignIn} />
      <Marquee />
      <Bento />
      <Sequence />
      <Deck />
      <Personas />
      <CollegesSection onSignIn={onSignIn} />
      <Numbers />
      <Quote />
      <FinalCTA onSignIn={onSignIn} />
      <Footer />
    </div>
  );
}
