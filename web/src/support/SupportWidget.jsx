import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LifeBuoy, X, Send, Search, MessageSquare, BookOpen, Ticket as TicketIcon,
  Sparkles, ThumbsUp, ThumbsDown, ChevronDown, CheckCircle2, AlertTriangle, Loader2, ArrowLeft,
} from 'lucide-react';
import { Support, Auth } from '../lib/api.js';

const CATEGORIES = ['general', 'account', 'resume', 'jobs', 'billing', 'bug', 'feature', 'privacy'];

/* ---------- small bits ---------- */
function Bubble({ from, children }) {
  const me = from === 'user';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22 }}
      className={`flex ${me ? 'justify-end' : 'justify-start'}`}
    >
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
        me
          ? 'bg-aurora-cta text-white shadow-glow'
          : 'border border-white/10 bg-white/[0.04] text-slate-200'
      }`}>
        {children}
      </div>
    </motion.div>
  );
}

function Typing() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
        {[0, 1, 2].map((i) => (
          <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-aurora-cyan"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }} />
        ))}
      </div>
    </div>
  );
}

function Chip({ children, onClick, active }) {
  return (
    <button onClick={onClick}
      className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition ${
        active
          ? 'border-aurora-violet/40 bg-aurora-violet/15 text-white'
          : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25 hover:text-white'
      }`}>
      {children}
    </button>
  );
}

/* ---------- CHAT TAB ---------- */
function ChatTab({ quickActions, onTicket, prefillUser }) {
  const [msgs, setMsgs] = useState([
    { from: 'bot', text: "Hi! 👋 I'm your Career Autopilot support assistant. Ask me anything — sign-in, resume upload, job search, deployment, privacy. Pick a topic below or type your question." },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedbackFor, setFeedbackFor] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: 9e9, behavior: 'smooth' }); }, [msgs, busy]);

  const ask = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    if (q === '__ticket__') { onTicket(); return; }
    setInput('');
    setMsgs((m) => [...m, { from: 'user', text: q }]);
    setBusy(true);
    try {
      const r = await Support.chat(q);
      setMsgs((m) => [...m, {
        from: 'bot', text: r.reply, source: r.source,
        related: r.related || [], suggestTicket: r.suggestTicket, id: Date.now(),
      }]);
    } catch {
      setMsgs((m) => [...m, { from: 'bot', text: "Something went wrong reaching support. You can still create a ticket and we'll follow up.", suggestTicket: true, id: Date.now() }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {msgs.map((m, i) => (
          <div key={i} className="space-y-2">
            <Bubble from={m.from}>
              <div className="whitespace-pre-line">{m.text}</div>
            </Bubble>
            {m.from === 'bot' && m.related?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pl-1">
                {m.related.map((r) => (
                  <Chip key={r.id} onClick={() => ask(r.q)}>{r.q}</Chip>
                ))}
              </div>
            )}
            {m.from === 'bot' && m.id && (
              <div className="flex items-center gap-2 pl-1">
                {feedbackFor === m.id ? (
                  <span className="text-[11px] text-aurora-mint">Thanks for the feedback!</span>
                ) : (
                  <>
                    <span className="text-[11px] text-slate-500">Was this helpful?</span>
                    <button onClick={() => setFeedbackFor(m.id)} className="rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-aurora-mint"><ThumbsUp size={13} /></button>
                    <button onClick={() => { setFeedbackFor(m.id); onTicket(); }} className="rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-amber-glow"><ThumbsDown size={13} /></button>
                  </>
                )}
              </div>
            )}
            {m.from === 'bot' && m.suggestTicket && (
              <div className="pl-1">
                <button onClick={onTicket}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-aurora-violet/30 bg-aurora-violet/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-aurora-violet/20">
                  <TicketIcon size={13} /> Create a support ticket
                </button>
              </div>
            )}
          </div>
        ))}
        {busy && <Typing />}
      </div>

      {/* quick actions */}
      <div className="flex gap-1.5 overflow-x-auto px-4 pb-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {quickActions.map((qa) => (
          <Chip key={qa.label} onClick={() => ask(qa.seed)}>{qa.label}</Chip>
        ))}
      </div>

      {/* composer */}
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ask()}
            placeholder="Type your question…"
            className="h-11 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm text-slate-100 outline-none focus:border-aurora-violet/50"
          />
          <button onClick={() => ask()} disabled={busy || !input.trim()}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-aurora-cta text-white shadow-glow transition disabled:opacity-40">
            {busy ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-slate-600">Answers come from our help center — not guesses.</p>
      </div>
    </div>
  );
}

/* ---------- HELP CENTER TAB ---------- */
function HelpTab({ faqs, categories, onTicket }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [open, setOpen] = useState(null);

  const filtered = faqs.filter((f) => {
    const okCat = cat === 'All' || f.category === cat;
    const okQ = !q || (f.q + ' ' + f.a).toLowerCase().includes(q.toLowerCase());
    return okCat && okQ;
  });

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-white/10 p-4">
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the help center…"
            className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-10 pr-3 text-sm text-slate-100 outline-none focus:border-aurora-violet/50" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {['All', ...categories].map((c) => <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{c}</Chip>)}
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <BookOpen size={26} className="text-slate-600" />
            <p className="text-sm text-slate-400">No articles match “{q}”.</p>
            <button onClick={onTicket} className="text-xs text-aurora-cyan hover:underline">Ask support instead →</button>
          </div>
        )}
        {filtered.map((f) => {
          const isOpen = open === f.id;
          return (
            <div key={f.id} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
              <button onClick={() => setOpen(isOpen ? null : f.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-slate-200 hover:bg-white/[0.03]">
                {f.q}
                <ChevronDown size={16} className={`shrink-0 text-slate-500 transition ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
                    <p className="whitespace-pre-line border-t border-white/8 px-4 py-3 text-[13px] leading-relaxed text-slate-400">{f.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- TICKET TAB ---------- */
function TicketTab({ draft, clearDraft, authed }) {
  const [form, setForm] = useState({
    name: '', email: '', category: 'general', subject: '', message: '', priority: 'normal',
    ...(draft || {}),
  });
  const [state, setState] = useState({ status: 'idle', result: null, err: '' });
  const [mine, setMine] = useState({ loaded: false, tickets: [] });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // prefill email/name from session
  useEffect(() => {
    Auth.me().then((d) => {
      if (d.user) setForm((f) => ({ ...f, name: f.name || d.user.name || '', email: f.email || d.user.email || '' }));
    }).catch(() => {});
  }, []);

  useEffect(() => () => clearDraft && clearDraft(), []); // clear draft on unmount

  const loadMine = async () => {
    try { const d = await Support.myTickets(); setMine({ loaded: true, tickets: d.tickets || [] }); }
    catch { setMine({ loaded: true, tickets: [] }); }
  };
  useEffect(() => { if (authed) loadMine(); }, [authed]);

  const submit = async () => {
    if (!form.email.trim() || !form.subject.trim() || !form.message.trim()) {
      setState({ status: 'idle', result: null, err: 'Email, subject and message are required.' });
      return;
    }
    setState({ status: 'loading', result: null, err: '' });
    try {
      const r = await Support.createTicket(form);
      setState({ status: 'done', result: r, err: '' });
      if (authed) loadMine();
    } catch (e) {
      setState({ status: 'error', result: null, err: e.message || 'Could not create ticket.' });
    }
  };

  if (state.status === 'done') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}
          className="grid h-16 w-16 place-items-center rounded-full bg-aurora-mint/15 ring-1 ring-aurora-mint/30">
          <CheckCircle2 size={30} className="text-aurora-mint" />
        </motion.div>
        <h3 className="text-lg font-semibold text-white">Ticket created</h3>
        <p className="max-w-xs text-sm text-slate-400">{state.result?.message || "We'll get back to you by email."}</p>
        {state.result?.ticket?.id && <p className="text-xs text-slate-500">Ref: {state.result.ticket.id}</p>}
        {!state.result?.stored && (
          <p className="rounded-lg border border-amber-glow/25 bg-amber-glow/10 px-3 py-2 text-[11px] text-amber-glow">
            Database not configured — connect MONGODB_URI to persist tickets.
          </p>
        )}
        <button onClick={() => setState({ status: 'idle', result: null, err: '' })}
          className="mt-2 rounded-xl border border-white/12 px-4 py-2 text-sm text-slate-200 hover:bg-white/5">Create another</button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <p className="mb-3 text-sm text-slate-400">Couldn’t find your answer? Send us the details and we’ll follow up.</p>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <input value={form.name} onChange={set('name')} placeholder="Name"
            className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm text-slate-100 outline-none focus:border-aurora-violet/50" />
          <input value={form.email} onChange={set('email')} placeholder="Email *" type="email"
            className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm text-slate-100 outline-none focus:border-aurora-violet/50" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="relative">
            <select value={form.category} onChange={set('category')}
              className="h-11 w-full appearance-none rounded-xl border border-white/10 bg-white/[0.03] px-3.5 pr-9 text-sm capitalize text-slate-200 outline-none focus:border-aurora-violet/50">
              {CATEGORIES.map((c) => <option key={c} value={c} className="bg-ink-900 capitalize">{c}</option>)}
            </select>
            <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
          </div>
          <div className="relative">
            <select value={form.priority} onChange={set('priority')}
              className="h-11 w-full appearance-none rounded-xl border border-white/10 bg-white/[0.03] px-3.5 pr-9 text-sm capitalize text-slate-200 outline-none focus:border-aurora-violet/50">
              {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p} className="bg-ink-900 capitalize">{p}</option>)}
            </select>
            <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
          </div>
        </div>
        <input value={form.subject} onChange={set('subject')} placeholder="Subject *"
          className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm text-slate-100 outline-none focus:border-aurora-violet/50" />
        <textarea value={form.message} onChange={set('message')} placeholder="Describe the issue — steps, what you expected, what happened. *"
          className="h-32 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-sm text-slate-100 outline-none focus:border-aurora-violet/50" />
        {state.err && <p className="flex items-center gap-1.5 text-xs text-amber-glow"><AlertTriangle size={13} /> {state.err}</p>}
        <button onClick={submit} disabled={state.status === 'loading'}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-aurora-cta font-medium text-white shadow-glow transition disabled:opacity-50">
          {state.status === 'loading' ? <><Loader2 size={16} className="animate-spin" /> Submitting…</> : <><TicketIcon size={16} /> Submit ticket</>}
        </button>
      </div>

      {authed && (
        <div className="mt-6 border-t border-white/10 pt-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">My tickets</h4>
          {!mine.loaded ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : mine.tickets.length === 0 ? (
            <p className="text-xs text-slate-500">No tickets yet.</p>
          ) : (
            <div className="space-y-2">
              {mine.tickets.map((t) => (
                <div key={t.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-slate-200">{t.subject}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] capitalize ${
                      t.status === 'open' ? 'bg-aurora-cyan/15 text-aurora-cyan' :
                      t.status === 'resolved' ? 'bg-aurora-mint/15 text-aurora-mint' : 'bg-white/10 text-slate-300'
                    }`}>{t.status}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] capitalize text-slate-500">{t.category} · {t.priority}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- MAIN WIDGET ---------- */
const TABS = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'help', label: 'Help Center', icon: BookOpen },
  { id: 'ticket', label: 'Ticket', icon: TicketIcon },
];

export default function SupportWidget({ open, setOpen, tab, setTab, draft, clearDraft }) {
  const [kb, setKb] = useState({ faqs: [], quickActions: [], categories: [], loaded: false, err: false });
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    if (open && !kb.loaded) {
      Support.faqs()
        .then((d) => setKb({ faqs: d.faqs || [], quickActions: d.quickActions || [], categories: d.categories || [], loaded: true, err: false }))
        .catch(() => setKb((k) => ({ ...k, loaded: true, err: true })));
      Auth.me().then((d) => setAuthed(!!d.user)).catch(() => setAuthed(false));
    }
  }, [open]);

  return (
    <>
      {/* Floating orb */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.07 }} whileTap={{ scale: 0.94 }}
            onClick={() => setOpen(true)}
            aria-label="Open support"
            className="group fixed bottom-5 right-5 z-[60] grid h-14 w-14 place-items-center rounded-full bg-aurora-cta shadow-glow"
          >
            <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-aurora-violet/40 [animation-duration:2.5s]" />
            <LifeBuoy size={24} className="text-white transition group-hover:rotate-45" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Drawer */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className="fixed z-[61] flex flex-col overflow-hidden border border-white/12 bg-ink-900/85 backdrop-blur-2xl
                         inset-x-0 bottom-0 h-[88vh] rounded-t-3xl
                         sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[640px] sm:max-h-[85vh] sm:w-[420px] sm:rounded-3xl
                         shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
            >
              {/* header */}
              <div className="relative shrink-0 overflow-hidden border-b border-white/10 px-4 pb-3 pt-4">
                <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-aurora-violet/20 blur-3xl" />
                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="grid h-9 w-9 place-items-center rounded-xl bg-aurora-cta shadow-glow">
                      <Sparkles size={17} className="text-white" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white">Support</h3>
                      <p className="flex items-center gap-1 text-[11px] text-aurora-mint">
                        <span className="h-1.5 w-1.5 rounded-full bg-aurora-mint" /> Usually replies in minutes
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white">
                    <X size={18} />
                  </button>
                </div>
                {/* tabs */}
                <div className="relative mt-3 flex gap-1 rounded-xl bg-white/[0.04] p-1">
                  {TABS.map((t) => (
                    <button key={t.id} onClick={() => setTab(t.id)}
                      className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition ${
                        tab === t.id ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}>
                      {tab === t.id && <motion.span layoutId="supTab" className="absolute inset-0 -z-0 rounded-lg bg-aurora-violet/20 ring-1 ring-aurora-violet/30" />}
                      <t.icon size={13} className="relative z-10" />
                      <span className="relative z-10">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* body */}
              <div className="min-h-0 flex-1">
                {!kb.loaded ? (
                  <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-aurora-cyan" /></div>
                ) : kb.err ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                    <AlertTriangle className="text-amber-glow" />
                    <p className="text-sm text-slate-400">Couldn’t load help content. You can still create a ticket.</p>
                    <button onClick={() => setTab('ticket')} className="text-xs text-aurora-cyan hover:underline">Open ticket form →</button>
                  </div>
                ) : tab === 'chat' ? (
                  <ChatTab quickActions={kb.quickActions} onTicket={() => setTab('ticket')} />
                ) : tab === 'help' ? (
                  <HelpTab faqs={kb.faqs} categories={kb.categories} onTicket={() => setTab('ticket')} />
                ) : (
                  <TicketTab draft={draft} clearDraft={clearDraft} authed={authed} />
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
