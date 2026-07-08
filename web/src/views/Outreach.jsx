import { useState } from 'react';
import { Send, Search, Mail, Building2, User, Sparkles, Copy, Check, AlertTriangle, Linkedin } from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Input, Badge, Skeleton, EmptyState, Card, Modal, Field } from '../components/ui/kit.jsx';
import { Contacts, AI } from '../lib/api.js';
import { canUse, useMeter, promptUpgrade } from '../lib/plan.js';

export default function Outreach() {
  const [company, setCompany] = useState('');
  const [domain, setDomain] = useState('');
  const [title, setTitle] = useState('Recruiter');
  const [state, setState] = useState({ status: 'idle', contacts: [], note: '', err: null });
  const [draft, setDraft] = useState({ open: false, contact: null, text: '', loading: false, copied: false });

  const find = async (e) => {
    e?.preventDefault();
    if (!company.trim() && !domain.trim()) return;
    setState({ status: 'loading', contacts: [], note: '', err: null });
    try {
      const d = await Contacts.find({ company, domain, title });
      setState({ status: 'done', contacts: d.contacts || [], note: d.note || '', err: d.ok === false ? d.error : null });
    } catch (err) { setState({ status: 'error', contacts: [], note: '', err: err.message }); }
  };

  const openDraft = async (c) => {
    if (!canUse('outreach')) { promptUpgrade('You’ve used all your AI outreach drafts this month. Upgrade for more.', 'pro'); return; }
    setDraft({ open: true, contact: c, text: '', loading: true, copied: false });
    const prompt = `Write a short, warm, personalised LinkedIn/email outreach message to ${c.name || 'a recruiter'}${c.title ? ` (${c.title})` : ''} at ${company || c.company || 'the company'}.
I'm a candidate interested in DevOps/Platform Engineering roles. Keep it under 90 words, specific, no fluff, friendly. Output the message only.`;
    try {
      const r = await AI.message({ max_tokens: 400, messages: [{ role: 'user', content: prompt }] });
      const text = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      useMeter('outreach');
      setDraft((d) => ({ ...d, text, loading: false }));
    } catch (e) { setDraft((d) => ({ ...d, text: 'Could not generate (is ANTHROPIC_API_KEY set?). ' + e.message, loading: false })); }
  };
  const copyDraft = () => { navigator.clipboard?.writeText(draft.text); setDraft((d) => ({ ...d, copied: true })); setTimeout(() => setDraft((d) => ({ ...d, copied: false })), 1500); };

  return (
    <>
      <PageIntro title="Recruiter outreach" sub="Find the right people and let AI draft a message that gets replies." />

      <form onSubmit={find} className="gradient-border mb-6 grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto]">
        <div className="relative">
          <Building2 size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company e.g. GitLab" className="pl-10" />
        </div>
        <div className="relative">
          <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Domain e.g. gitlab.com (optional)" className="pl-10" />
        </div>
        <Button type="submit" disabled={state.status === 'loading'}><Search size={16} /> Find contacts</Button>
      </form>

      {state.status === 'idle' && <EmptyState icon={Send} title="Find recruiters & hiring managers" hint="Enter a company or domain to surface verified contacts and draft outreach." />}
      {state.status === 'loading' && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-2xl" />)}</div>}
      {state.status === 'error' && <EmptyState icon={AlertTriangle} title="Lookup failed" hint={state.err} action={<Button size="sm" onClick={find}>Retry</Button>} />}
      {state.status === 'done' && state.contacts.length === 0 && (
        <EmptyState icon={User} title="No contacts found" hint={state.err || 'Add contact-provider API keys (Apollo, Hunter, etc.) in .env for richer results, or try a domain.'} />
      )}
      {state.status === 'done' && state.contacts.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {state.contacts.map((c, i) => (
            <Card key={i} hover className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-aurora-cta text-sm font-semibold text-ink-950">{(c.name || 'R')[0]}</span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{c.name || 'Contact'}</p>
                  <p className="truncate text-xs text-slate-500">{c.title || c.position || title}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {c.email && (
                  <a href={`mailto:${c.email}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                    <Badge tone="cyan"><Mail size={11} /> {c.verified ? 'Verified' : 'Email'}</Badge>
                  </a>
                )}
                {(() => {
                  const liUrl = c.linkedin || (c.name
                    ? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${c.name} ${company || c.company || ''}`.trim())}`
                    : null);
                  return liUrl ? (
                    <a href={liUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                      <Badge tone="violet"><Linkedin size={11} /> {c.linkedin ? 'LinkedIn' : 'Find on LinkedIn'}</Badge>
                    </a>
                  ) : null;
                })()}
                {c.source && <Badge>{c.source}</Badge>}
              </div>
              {c.email && (
                <a
                  href={`mailto:${c.email}`}
                  className="truncate font-mono text-xs text-aurora-cyan hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {c.email}
                </a>
              )}
              <Button size="sm" variant="soft" className="mt-auto" onClick={() => openDraft(c)}><Sparkles size={14} /> Draft outreach</Button>
            </Card>
          ))}
        </div>
      )}

      <Modal open={draft.open} onClose={() => setDraft((d) => ({ ...d, open: false }))} title={`Message to ${draft.contact?.name || 'contact'}`}>
        {draft.loading ? (
          <div className="space-y-2.5 py-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-3 w-full" />)}</div>
        ) : (
          <>
            <textarea value={draft.text} onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
              className="h-48 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-sm leading-relaxed text-slate-200 outline-none focus:border-aurora-violet/50" />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDraft((d) => ({ ...d, open: false }))}>Close</Button>
              <Button onClick={copyDraft}>{draft.copied ? <Check size={15} /> : <Copy size={15} />} {draft.copied ? 'Copied' : 'Copy message'}</Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
