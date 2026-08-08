import { useEffect, useMemo, useState } from 'react';
import {
  Store, Plus, Search, Filter, Github, Globe, ShieldCheck, Star, Users, Copy, Eye,
  Bookmark, BookmarkCheck, Flag, Mail, UserCheck, Loader2, AlertTriangle, X, ChevronDown, Sparkles, Target,
} from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Modal, EmptyState, Input, Field } from '../components/ui/kit.jsx';
import { Marketplace } from '../lib/api.js';
import { ROLE_GROUPS } from '../lib/roles.js';

const SECTIONS = [
  ['explore', 'Explore', {}],
  ['ideas', 'Ideas', { listingType: 'project_idea' }],
  ['roadmaps', 'Build Roadmaps', { listingType: 'build_roadmap' }],
  ['collaboration', 'Collaboration', { listingType: 'collaboration_request' }],
  ['verified', 'Verified Projects', { verificationStatus: 'verified' }],
  ['recruiter', 'Recruiter Ready', { recruiterReady: true }],
  ['mine', 'My Listings', { mine: true }],
  ['saved', 'Saved', { saved: true }],
];

const SORTS = [
  ['trending', 'Trending'],
  ['highest_proof', 'Highest proof'],
  ['most_cloned', 'Most cloned'],
  ['recently_published', 'Recently published'],
  ['best_for_role', 'Best for my role'],
  ['recruiter_interest', 'Most recruiter interest'],
];

const TYPE_LABELS = {
  published_project: 'Published Project', project_idea: 'Project Idea', build_roadmap: 'Build Roadmap',
  collaboration_request: 'Collaboration', mentor_reviewed: 'Mentor Reviewed', recruiter_ready: 'Recruiter Ready',
  template_starter: 'Template / Starter', hackathon_team: 'Hackathon Team', college_capstone: 'College Capstone',
};
const CTA_LABELS = {
  build_this: 'Build this', clone_roadmap: 'Clone roadmap', apply_collaborate: 'Apply to collaborate',
  submit_proof: 'Submit proof', request_review: 'Request review', view_proof: 'View proof',
  shortlist_candidate: 'Shortlist', contact_candidate: 'Contact', save: 'Save', report: 'Report',
};
const PUBLISH_TYPES = Object.keys(TYPE_LABELS);

function ScorePill({ score }) {
  const tone = score >= 75 ? 'mint' : score >= 50 ? 'cyan' : 'default';
  return <Badge tone={tone}><Sparkles size={11} /> {score}</Badge>;
}

function ListingCard({ l, onOpen, onSave, onClone }) {
  return (
    <div className="flex flex-col rounded-2xl border border-subtle bg-surface-1 p-4 transition hover:border-strong">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="violet">{TYPE_LABELS[l.listingType] || l.listingType}</Badge>
            {l.verificationStatus === 'verified' && <Badge tone="mint"><ShieldCheck size={11} /> Verified</Badge>}
            {l.isRecruiterReady && <Badge tone="cyan"><UserCheck size={11} /> Recruiter ready</Badge>}
            {l.isFeatured && <Badge tone="amber"><Star size={11} /> Featured</Badge>}
          </div>
          <button onClick={() => onOpen(l)} className="mt-2 block text-left text-sm font-semibold text-fg hover:text-aurora-cyan">{l.title}</button>
        </div>
        <ScorePill score={l.marketplaceScore || 0} />
      </div>
      {l.summary && <p className="mt-1.5 line-clamp-2 text-[13px] text-fg-secondary">{l.summary}</p>}
      {l.targetRole && <div className="mt-2 flex items-center gap-1 text-[11px] text-fg-muted"><Target size={11} /> {l.targetRole}</div>}
      {l.tags?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">{l.tags.slice(0, 5).map((t) => <span key={t} className="rounded-md bg-surface-1 px-2 py-0.5 text-[10px] text-fg-secondary">{t}</span>)}</div>
      )}
      <div className="mt-3 flex items-center gap-3 text-[11px] text-fg-muted">
        <span className="inline-flex items-center gap-1"><Eye size={11} /> {l.viewCount || 0}</span>
        <span className="inline-flex items-center gap-1"><Copy size={11} /> {l.cloneCount || 0}</span>
        <span className="inline-flex items-center gap-1"><Users size={11} /> {l.applicationCount || 0}</span>
        {l.githubUrl && <Github size={11} />} {l.liveDemoUrl && <Globe size={11} />}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-subtle pt-3">
        <Button size="sm" onClick={() => onOpen(l)}>Open</Button>
        {(l.ctas || []).includes('clone_roadmap') && <Button size="sm" variant="soft" onClick={() => onClone(l)}><Copy size={14} /> Clone</Button>}
        <Button size="sm" variant="soft" onClick={() => onSave(l)}>{l.saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}</Button>
      </div>
    </div>
  );
}

export default function MarketplaceView() {
  const [section, setSection] = useState('explore');
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('trending');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [hasGithub, setHasGithub] = useState(false);
  const [hasLiveDemo, setHasLiveDemo] = useState(false);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [showPublish, setShowPublish] = useState(false);
  const [toast, setToast] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const sectionFilters = (SECTIONS.find((s) => s[0] === section) || [])[2] || {};
      if (section === 'saved') {
        const d = await Marketplace.saved();
        setListings(d.listings || []);
      } else {
        const params = { ...sectionFilters, sort, targetRole: roleFilter, hasGithub, hasLiveDemo };
        const d = await Marketplace.list(params);
        setListings(d.listings || []);
      }
    } catch { setListings([]); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [section, sort, roleFilter, hasGithub, hasLiveDemo]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter((l) => `${l.title} ${l.summary} ${(l.tags || []).join(' ')}`.toLowerCase().includes(q));
  }, [listings, search]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  const openDetail = async (l) => {
    setOpen(l); setDetail(null); setReviews([]);
    try { const d = await Marketplace.get(l.id); setDetail(d.listing); setReviews(d.reviews || []); } catch { setDetail(l); }
  };
  const doSave = async (l) => { try { const r = await Marketplace.toggleSave(l.id); flash(r.saved ? 'Saved' : 'Removed'); load(); } catch { flash('Could not save (DB off?)'); } };
  const doClone = async (l) => { try { await Marketplace.clone(l.id); flash('Roadmap cloned'); } catch { flash('Clone failed'); } };
  const doApply = async (l) => { try { await Marketplace.apply(l.id, { roleApplied: l.targetRole, message: 'Interested in collaborating.' }); flash('Application sent'); } catch { flash('Apply failed'); } };
  const doShortlist = async (l) => { try { await Marketplace.shortlist(l.id); flash('Shortlisted'); } catch { flash('Failed'); } };
  const doContact = async (l) => { try { await Marketplace.contact(l.id); flash('Contact recorded'); } catch { flash('Failed'); } };
  const doReport = async (l) => { try { await Marketplace.report(l.id); flash('Reported for review'); } catch { flash('Failed'); } };

  const runCta = (cta, l) => {
    if (cta === 'save') return doSave(l);
    if (cta === 'clone_roadmap' || cta === 'build_this') return doClone(l);
    if (cta === 'apply_collaborate') return doApply(l);
    if (cta === 'shortlist_candidate') return doShortlist(l);
    if (cta === 'contact_candidate') return doContact(l);
    if (cta === 'report') return doReport(l);
    if (cta === 'view_proof') { if (l.githubUrl) window.open(l.githubUrl, '_blank'); else if (l.liveDemoUrl) window.open(l.liveDemoUrl, '_blank'); else flash('No proof link attached'); return; }
    if (cta === 'request_review') return flash('Review requested');
  };

  return (
    <>
      <PageIntro title="Project Marketplace" sub="Discover buildable ideas and verified proof-of-work. Ranking, verification and recruiter-ready status are computed by the backend from real proof — not self-claimed." action={<Button onClick={() => setShowPublish(true)}><Plus size={16} /> Publish a listing</Button>} />

      {/* Section tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {SECTIONS.map(([id, label]) => (
          <button key={id} onClick={() => setSection(id)}
            className={`rounded-xl border px-3 py-1.5 text-xs transition ${section === id ? 'border-aurora-violet/60 bg-aurora-violet/10 text-fg' : 'border-subtle bg-surface-1 text-fg-secondary hover:border-strong'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search listings…"
            className="h-10 w-full rounded-xl border border-field-border bg-field pl-9 pr-3 text-sm text-fg outline-none focus:border-aurora-violet/50" />
        </div>
        <div className="relative">
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-10 cursor-pointer appearance-none rounded-xl border border-field-border bg-field pl-3 pr-9 text-sm text-fg outline-none focus:border-aurora-violet/50">
            {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted" />
        </div>
        <Button variant="soft" onClick={() => setShowFilters((v) => !v)}><Filter size={15} /> Filters</Button>
      </div>

      {showFilters && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-subtle bg-surface-1 p-3">
          <div className="relative">
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="h-9 cursor-pointer appearance-none rounded-lg border border-field-border bg-field pl-3 pr-8 text-xs text-fg outline-none">
              <option value="">Any role</option>
              {Object.values(ROLE_GROUPS).flat().map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-fg-secondary"><input type="checkbox" checked={hasGithub} onChange={(e) => setHasGithub(e.target.checked)} /> Has GitHub</label>
          <label className="flex items-center gap-1.5 text-xs text-fg-secondary"><input type="checkbox" checked={hasLiveDemo} onChange={(e) => setHasLiveDemo(e.target.checked)} /> Has live demo</label>
        </div>
      )}

      {toast && <div className="mb-3 rounded-lg border border-aurora-mint/30 bg-aurora-mint/10 px-3 py-2 text-xs text-aurora-mint">{toast}</div>}

      {loading ? (
        <SectionCard><div className="flex items-center gap-2 py-8 text-fg-secondary"><Loader2 size={16} className="animate-spin" /> Loading marketplace…</div></SectionCard>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Store} title="Nothing here yet" hint={section === 'mine' ? 'Publish your first listing to share your work.' : 'Be the first to publish in this section.'} action={<Button size="sm" onClick={() => setShowPublish(true)}><Plus size={14} /> Publish a listing</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((l) => <ListingCard key={l.id} l={l} onOpen={openDetail} onSave={doSave} onClone={doClone} />)}
        </div>
      )}

      {/* Detail modal */}
      {open && (
        <Modal open onClose={() => setOpen(null)} title={open.title}>
          {!detail ? <div className="flex items-center gap-2 py-6 text-fg-secondary"><Loader2 size={16} className="animate-spin" /> Loading…</div> : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="violet">{TYPE_LABELS[detail.listingType] || detail.listingType}</Badge>
                {detail.verificationStatus === 'verified' && <Badge tone="mint"><ShieldCheck size={11} /> Verified</Badge>}
                {detail.isRecruiterReady && <Badge tone="cyan"><UserCheck size={11} /> Recruiter ready</Badge>}
                <ScorePill score={detail.marketplaceScore || 0} />
              </div>
              {detail.summary && <p className="text-sm text-fg-secondary">{detail.summary}</p>}
              {detail.problemStatement && <div><div className="text-[11px] uppercase tracking-wide text-fg-muted">Problem</div><p className="text-sm text-fg-secondary">{detail.problemStatement}</p></div>}
              {detail.description && <div><div className="text-[11px] uppercase tracking-wide text-fg-muted">Details</div><p className="whitespace-pre-wrap text-sm text-fg-secondary">{detail.description}</p></div>}
              {detail.techStack?.length > 0 && <div className="flex flex-wrap gap-1.5">{detail.techStack.map((t) => <span key={t} className="rounded-md bg-surface-1 px-2 py-0.5 text-[11px] text-fg-secondary">{t}</span>)}</div>}
              {detail.verifiedSkills?.length > 0 && <div><div className="mb-1 text-[11px] uppercase tracking-wide text-fg-muted">Verified skills</div><div className="flex flex-wrap gap-1.5">{detail.verifiedSkills.map((s) => <Badge key={s} tone="mint">{s}</Badge>)}</div></div>}
              {detail.milestones?.length > 0 && (
                <div><div className="mb-1 text-[11px] uppercase tracking-wide text-fg-muted">Milestones</div>
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-secondary">{detail.milestones.slice(0, 8).map((m, i) => <li key={i}>{typeof m === 'string' ? m : (m.phase || m.title || JSON.stringify(m))}</li>)}</ol></div>
              )}
              <div className="flex flex-wrap gap-2">
                {detail.githubUrl && <a href={detail.githubUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Github size={14} /> Repo</Button></a>}
                {detail.liveDemoUrl && <a href={detail.liveDemoUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="soft"><Globe size={14} /> Live</Button></a>}
              </div>
              {/* CTAs from backend */}
              <div className="flex flex-wrap gap-2 border-t border-subtle pt-3">
                {(detail.ctas || []).map((cta) => (
                  <Button key={cta} size="sm" variant={cta === 'report' ? 'soft' : undefined} onClick={() => runCta(cta, detail)}>
                    {cta === 'shortlist_candidate' && <UserCheck size={14} />} {cta === 'contact_candidate' && <Mail size={14} />}
                    {cta === 'apply_collaborate' && <Users size={14} />} {cta === 'clone_roadmap' && <Copy size={14} />}
                    {cta === 'report' && <Flag size={14} />} {CTA_LABELS[cta] || cta}
                  </Button>
                ))}
              </div>
              {reviews.length > 0 && (
                <div className="border-t border-subtle pt-3">
                  <div className="mb-2 text-[11px] uppercase tracking-wide text-fg-muted">Reviews</div>
                  {reviews.map((r) => (
                    <div key={r.id} className="mb-2 text-sm text-fg-secondary">
                      <span className="text-aurora-mint">{'★'.repeat(r.rating || 0)}</span> <span className="text-fg-secondary">{r.reviewerName}</span>
                      {r.comment && <div className="text-[13px] text-fg-secondary">{r.comment}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {showPublish && <PublishModal onClose={() => setShowPublish(false)} onPublished={() => { setShowPublish(false); setSection('mine'); flash('Listing published'); load(); }} />}
    </>
  );
}

function PublishModal({ onClose, onPublished }) {
  const [form, setForm] = useState({ listingType: 'project_idea', title: '', summary: '', problemStatement: '', description: '', targetRole: '', difficulty: 'Intermediate', tags: '', techStack: '', githubUrl: '', liveDemoUrl: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    if (form.title.trim().length < 2) { setErr('Add a title.'); return; }
    setBusy(true); setErr('');
    try {
      await Marketplace.publish({
        ...form,
        tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean),
        techStack: form.techStack.split(',').map((s) => s.trim()).filter(Boolean),
      });
      onPublished();
    } catch (e) { setErr(e?.message || 'Publish failed.'); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Publish a marketplace listing">
      <div className="space-y-3">
        <Field label="Listing type">
          <div className="relative">
            <select value={form.listingType} onChange={f('listingType')} className="h-11 w-full cursor-pointer appearance-none rounded-xl border border-field-border bg-field px-3.5 pr-10 text-sm text-fg outline-none focus:border-aurora-violet/50">
              {PUBLISH_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          </div>
        </Field>
        <Field label="Title"><Input value={form.title} onChange={f('title')} placeholder="e.g. Real-time CI/CD dashboard" /></Field>
        <Field label="One-line summary"><Input value={form.summary} onChange={f('summary')} placeholder="What is it, in one line?" /></Field>
        <Field label="Problem statement">
          <textarea value={form.problemStatement} onChange={f('problemStatement')} className="h-20 w-full resize-none rounded-xl border border-field-border bg-field p-3 text-sm text-fg outline-none focus:border-aurora-violet/50" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Target role">
            <div className="relative">
              <select value={form.targetRole} onChange={f('targetRole')} className="h-11 w-full cursor-pointer appearance-none rounded-xl border border-field-border bg-field px-3.5 pr-10 text-sm text-fg outline-none focus:border-aurora-violet/50">
                <option value="">Any</option>
                {Object.values(ROLE_GROUPS).flat().map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            </div>
          </Field>
          <Field label="Difficulty">
            <div className="relative">
              <select value={form.difficulty} onChange={f('difficulty')} className="h-11 w-full cursor-pointer appearance-none rounded-xl border border-field-border bg-field px-3.5 pr-10 text-sm text-fg outline-none focus:border-aurora-violet/50">
                {['Beginner', 'Intermediate', 'Advanced'].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            </div>
          </Field>
        </div>
        <Field label="Tags (comma-separated)"><Input value={form.tags} onChange={f('tags')} placeholder="react, node.js, docker" /></Field>
        <Field label="Tech stack (comma-separated)"><Input value={form.techStack} onChange={f('techStack')} placeholder="React, Express, MongoDB" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="GitHub URL (proof)"><Input value={form.githubUrl} onChange={f('githubUrl')} placeholder="https://github.com/…" /></Field>
          <Field label="Live demo URL (proof)"><Input value={form.liveDemoUrl} onChange={f('liveDemoUrl')} placeholder="https://…" /></Field>
        </div>
        {err && <p className="flex items-center gap-1.5 text-xs text-amber-glow"><AlertTriangle size={13} /> {err}</p>}
        <div className="flex gap-2">
          <Button onClick={submit} disabled={busy}>{busy ? <><Loader2 size={16} className="animate-spin" /> Publishing…</> : <><Plus size={16} /> Publish</>}</Button>
          <Button variant="soft" onClick={onClose}>Cancel</Button>
        </div>
        <p className="text-[11px] text-fg-muted">Verification &amp; ranking are decided by the backend from attached proof. Adding a real GitHub/live link raises your marketplace score.</p>
      </div>
    </Modal>
  );
}
