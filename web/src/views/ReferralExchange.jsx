import { useEffect, useMemo, useState } from 'react';
import {
  Handshake, Plus, Trash2, Eye, Flag, Bookmark, Send, UserPlus, Users, Megaphone,
  Briefcase, Lightbulb, Rocket, MessageSquare, AlertTriangle, ShieldCheck, Building2, Check,
} from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Badge, Button, EmptyState, Modal, Input, Field, Spinner } from '../components/ui/kit.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { getAccessForUser } from '../lib/access.js';
import {
  POST_TYPES, POST_TYPE_LABEL, fetchPosts, createPost, deletePost, reportPost,
  findMutualMatches, assembleMyProfile, currentUserId, sendReferralRequest,
  recentRequestCount, referralLimitFor,
} from '../lib/network.js';

const TABS = [
  { id: 'referrals', label: 'Referrals', types: ['need_referral', 'offering_referral', 'mutual'], icon: Handshake },
  { id: 'help', label: 'Project Help', types: ['collab'], icon: Users },
  { id: 'showcase', label: 'Project Showcase', types: ['showcase'], icon: Rocket },
  { id: 'startup', label: 'Startup Ideas', types: ['startup_idea'], icon: Lightbulb },
  { id: 'interview', label: 'Interview Experiences', types: ['interview_exp'], icon: MessageSquare },
  { id: 'hiring', label: 'Hiring Alerts', types: ['hiring_alert'], icon: Megaphone },
];

/* Structured fields per post type. */
const FIELD_SCHEMA = {
  need_referral: [
    ['currentCompany', 'Current company', 'text'], ['targetCompany', 'Target company', 'text'],
    ['targetRole', 'Target role', 'text'], ['experience', 'Years of experience', 'text'],
    ['skills', 'Skills (comma separated)', 'text'], ['profileLink', 'Resume / profile link (optional)', 'text'],
    ['whyFit', 'Why I am a fit', 'area'], ['openToMutual', 'Open to mutual referral', 'bool'],
    ['canReferAtMyCompany', 'I can refer at my company', 'bool'], ['contact', 'Preferred contact method', 'text'],
    ['message', 'Message', 'area'],
  ],
  offering_referral: [
    ['company', 'Company', 'text'], ['rolesCanRefer', 'Roles I can refer for', 'text'],
    ['minRequirements', 'Minimum requirements', 'area'], ['location', 'Location', 'text'],
    ['experienceLevel', 'Experience level', 'text'], ['skillsRequired', 'Skills required (comma separated)', 'text'],
    ['instructions', 'Referral instructions / disclaimer', 'area'], ['contact', 'Contact preference', 'text'],
  ],
  mutual: [
    ['currentCompany', 'I work at (Company A)', 'text'], ['targetCompany', 'I want a referral at (Company B)', 'text'],
    ['rolesCanRefer', 'Roles I can refer for at Company A', 'text'], ['targetRole', 'Target role at Company B', 'text'],
    ['skills', 'Skills (comma separated)', 'text'], ['experience', 'Experience', 'text'], ['message', 'Message', 'area'],
  ],
  interview_exp: [
    ['company', 'Company', 'text'], ['targetRole', 'Role', 'text'], ['outcome', 'Outcome', 'text'],
    ['rounds', 'Rounds', 'text'], ['skills', 'Topics / skills (comma separated)', 'text'], ['message', 'Your experience', 'area'],
  ],
  hiring_alert: [
    ['company', 'Company', 'text'], ['targetRole', 'Role', 'text'], ['location', 'Location', 'text'],
    ['experienceLevel', 'Experience level', 'text'], ['skills', 'Skills (comma separated)', 'text'],
    ['applyLink', 'Apply link', 'text'], ['message', 'Details', 'area'],
  ],
  collab: [
    ['projectTitle', 'Project title', 'text'], ['lookingFor', 'Looking for (skills/roles)', 'text'],
    ['skillsHave', 'Skills I bring (comma separated)', 'text'], ['targetRole', 'Project type / target role', 'text'], ['message', 'Details', 'area'],
  ],
  showcase: [
    ['projectTitle', 'Project title', 'text'], ['github', 'GitHub link', 'text'], ['live', 'Live demo link', 'text'],
    ['skills', 'Skills (comma separated)', 'text'], ['message', 'What it does', 'area'],
  ],
  startup_idea: [
    ['idea', 'Idea', 'text'], ['domain', 'Domain', 'text'], ['lookingFor', 'Looking for (cofounder/skills)', 'text'], ['message', 'Pitch', 'area'],
  ],
};

const TYPE_ICON = {
  need_referral: Handshake, offering_referral: UserPlus, mutual: Users, interview_exp: MessageSquare,
  hiring_alert: Megaphone, collab: Users, showcase: Rocket, startup_idea: Lightbulb,
};
function typeTone(t) {
  return { need_referral: 'cyan', offering_referral: 'mint', mutual: 'violet', interview_exp: 'amber', hiring_alert: 'amber', collab: 'cyan', showcase: 'mint', startup_idea: 'violet' }[t] || 'default';
}
function trustTone(level) { return { 'New': 'default', 'Building Trust': 'cyan', 'Trusted': 'violet', 'Highly Trusted': 'mint' }[level] || 'default'; }
const fmtDate = (d) => { try { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; } };
const splitSkills = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

function PostCard({ post, onView, onRequest, onReport, onSave, onDelete, saved, mine }) {
  const Icon = TYPE_ICON[post.type] || Handshake;
  const f = post.fields || {};
  const skills = splitSkills(f.skills || f.skillsRequired || f.skillsHave);
  const company = f.company || f.currentCompany || f.targetCompany || '';
  return (
    <div className="rounded-2xl border border-subtle bg-surface-1 p-4 transition hover:border-strong">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge tone={typeTone(post.type)}><Icon size={11} /> {POST_TYPE_LABEL[post.type]}</Badge>
          {company && <Badge tone="default"><Building2 size={11} /> {company}</Badge>}
          {(f.targetRole) && <Badge tone="cyan">{f.targetRole}</Badge>}
        </div>
        <span className="text-[11px] text-fg-muted">{fmtDate(post.createdAt)}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-sm font-medium text-fg">{post.authorName}</span>
        <Badge tone={trustTone(post.authorTrustLevel)}><ShieldCheck size={10} /> Trust {post.authorTrust ?? 0}</Badge>
      </div>
      {(f.projectTitle || f.idea) && <p className="mt-1.5 text-sm font-medium text-fg">{f.projectTitle || f.idea}</p>}
      {(f.message || f.whyFit || f.instructions || f.minRequirements) && (
        <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-fg-secondary">{f.message || f.whyFit || f.instructions || f.minRequirements}</p>
      )}
      {(f.lookingFor || f.rolesCanRefer) && <p className="mt-1.5 text-[12px] text-fg-secondary">Looking for / can refer: {f.lookingFor || f.rolesCanRefer}</p>}
      {skills.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{skills.slice(0, 6).map((s, i) => <Badge key={i} tone="cyan">{s}</Badge>)}</div>}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-subtle pt-3">
        <Button size="sm" variant="soft" onClick={() => onView(post.authorUserId)}><Eye size={13} /> View profile</Button>
        {post.type === 'collab'
          ? <Button size="sm" variant="soft" onClick={() => onRequest(post, 'request')}><UserPlus size={13} /> Request collaboration</Button>
          : (post.type === 'need_referral' || post.type === 'mutual')
            ? <Button size="sm" variant="soft" onClick={() => onRequest(post, 'offer')}><Handshake size={13} /> Offer referral</Button>
            : <Button size="sm" variant="soft" onClick={() => onRequest(post, 'request')}><Send size={13} /> Request referral</Button>}
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => onSave(post)}><Bookmark size={13} className={saved ? 'fill-aurora-cyan text-aurora-cyan' : ''} /></Button>
          {mine
            ? <Button size="sm" variant="ghost" onClick={() => onDelete(post)}><Trash2 size={13} /></Button>
            : <Button size="sm" variant="ghost" onClick={() => onReport(post)}><Flag size={13} /></Button>}
        </div>
      </div>
    </div>
  );
}

export default function ReferralExchange({ go }) {
  const { user } = useAuth();
  const access = getAccessForUser(user);
  const [tab, setTab] = useState(TABS[0].id);
  const [posts, setPosts] = useState(null);
  const [createType, setCreateType] = useState(null);
  const [requestPost, setRequestPost] = useState(null);
  const [reqMsg, setReqMsg] = useState('');
  const [saved, setSaved] = useState({});
  const [notice, setNotice] = useState('');

  const me = useMemo(() => assembleMyProfile(), [posts]);
  const limit = referralLimitFor(access.effectivePlan);
  const used = recentRequestCount();

  const load = () => fetchPosts().then(setPosts);
  useEffect(() => {
    load();
    const sync = () => load();
    window.addEventListener('career-network-updated', sync);
    return () => window.removeEventListener('career-network-updated', sync);
  }, []);

  const tabDef = TABS.find((t) => t.id === tab);
  const visible = (posts || []).filter((p) => tabDef.types.includes(p.type));
  const mutualMatches = useMemo(() => (posts ? findMutualMatches(posts, me) : []), [posts, me]);

  const view = (userId) => { if (typeof window !== 'undefined') window.location.hash = `#/profile/${encodeURIComponent(userId)}`; };
  const doDelete = async (post) => { await deletePost(post.id); load(); };
  const doReport = async (post) => { await reportPost(post.id); setNotice('Post reported. Thank you for keeping the community safe.'); setTimeout(() => setNotice(''), 2500); };
  const doSave = (post) => setSaved((s) => ({ ...s, [post.id]: !s[post.id] }));

  const submitRequest = async () => {
    const r = await sendReferralRequest({
      toUserId: requestPost.authorUserId, postId: requestPost.id, kind: requestPost._kind,
      message: reqMsg, effectivePlan: access.effectivePlan, isAdmin: access.isAdmin,
    });
    setRequestPost(null); setReqMsg('');
    if (!r.ok) setNotice(`Weekly referral limit reached (${r.limit}). Upgrade for more.`);
    else setNotice('Request sent. Referrals are voluntary — the platform does not guarantee a referral or job.');
    setTimeout(() => setNotice(''), 3500);
  };

  return (
    <>
      <PageIntro
        title="Referral Exchange"
        sub="Structured, proof-based referral and community posts for professionals and students."
        action={<Button onClick={() => setCreateType('need_referral')}><Plus size={16} /> New post</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-subtle bg-surface-1 px-4 py-3 text-[13px]">
        <ShieldCheck size={16} className="text-aurora-mint" />
        <span className="text-fg-secondary">Referral requests this week: <span className="font-semibold text-fg">{used}{access.isAdmin ? '' : ` / ${limit}`}</span></span>
        {!access.isAdmin && access.effectivePlan === 'free' && <button onClick={() => go?.('settings')} className="text-aurora-cyan hover:underline">Upgrade for more</button>}
      </div>

      {notice && <div className="mb-4 rounded-xl border border-aurora-cyan/30 bg-aurora-cyan/10 px-4 py-2.5 text-[13px] text-[#C3F0FA]">{notice}</div>}

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-3.5 py-2 text-[13px] transition ${tab === t.id ? 'border-aurora-violet/50 bg-aurora-violet/15 text-fg' : 'border-subtle bg-surface-1 text-fg-secondary hover:border-strong'}`}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'referrals' && mutualMatches.length > 0 && (
        <SectionCard title="Mutual referral matches" className="mb-4" action={<Badge tone="violet">{mutualMatches.length}</Badge>}>
          <div className="space-y-3">
            {mutualMatches.slice(0, 5).map((mm, i) => (
              <div key={i} className="rounded-xl border border-aurora-violet/30 bg-aurora-violet/[0.06] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge tone={mm.mutual ? 'mint' : 'cyan'}><Handshake size={11} /> {mm.mutual ? 'Mutual Referral Match' : 'Possible match'}</Badge>
                  <Badge tone="violet">{mm.score}% fit</Badge>
                </div>
                <p className="mt-2 text-[13px] text-fg-secondary">
                  {mm.other.authorName} can refer at <span className="text-fg">{mm.other.fields.currentCompany || mm.other.fields.company || '—'}</span>
                  {mm.mutual && <> · you can refer at <span className="text-fg">{mm.mine.fields.currentCompany || '—'}</span></>}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="soft" onClick={() => view(mm.other.authorUserId)}><Eye size={13} /> View profile</Button>
                  <Button size="sm" variant="soft" onClick={() => { setRequestPost({ ...mm.other, _kind: 'request' }); }}><Send size={13} /> Request referral</Button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title={tabDef.label}
        action={<Button size="sm" variant="soft" onClick={() => setCreateType(tabDef.types[0])}><Plus size={14} /> Post</Button>}
      >
        {posts === null ? (
          <div className="grid place-items-center py-16"><Spinner /></div>
        ) : visible.length === 0 ? (
          <EmptyState icon={Handshake} title="No posts yet" hint="Create a referral request, showcase a project, or ask for project help. No placeholder posts are shown." action={<Button size="sm" onClick={() => setCreateType(tabDef.types[0])}>Create the first post</Button>} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {visible.map((p) => (
              <PostCard key={p.id} post={p} saved={!!saved[p.id]} mine={String(p.authorUserId) === String(currentUserId())}
                onView={view} onReport={doReport} onSave={doSave} onDelete={doDelete}
                onRequest={(post, kind) => setRequestPost({ ...post, _kind: kind })} />
            ))}
          </div>
        )}
      </SectionCard>

      <div className="mt-4 rounded-2xl border border-amber-glow/25 bg-amber-glow/[0.06] p-4 text-[12px] leading-relaxed text-amber-100/90">
        <p className="flex items-center gap-2 font-medium text-amber-100"><AlertTriangle size={14} /> Please note</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Referrals are voluntary. The platform does not guarantee a referral or a job.</li>
          <li>Do not share confidential company information.</li>
          <li>Follow your employer's referral policies.</li>
          <li>Spammy or mass referral requests are limited and may reduce your visibility.</li>
        </ul>
      </div>

      <CreatePostModal open={!!createType} type={createType} onClose={() => setCreateType(null)} onCreated={() => { setCreateType(null); load(); }} />

      <Modal open={!!requestPost} onClose={() => setRequestPost(null)} title={requestPost ? `Message ${requestPost.authorName}` : ''} width="max-w-md">
        {requestPost && (
          <div className="space-y-4">
            <p className="text-[13px] text-fg-secondary">A short, specific message gets better responses. Referrals are voluntary.</p>
            <Field label="Your message">
              <textarea value={reqMsg} onChange={(e) => setReqMsg(e.target.value)} rows={5}
                className="w-full rounded-xl border border-subtle bg-surface-1 px-3 py-2.5 text-sm text-fg placeholder:text-fg-muted outline-none focus:border-aurora-violet/50"
                placeholder="Hi! I'm targeting … Here's my proof profile and why I'd be a strong fit…" />
            </Field>
            <div className="flex justify-end gap-2 border-t border-subtle pt-4">
              <Button variant="soft" onClick={() => setRequestPost(null)}>Cancel</Button>
              <Button onClick={submitRequest}><Send size={15} /> Send</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function CreatePostModal({ open, type, onClose, onCreated }) {
  const [t, setT] = useState(type || 'need_referral');
  const [vals, setVals] = useState({});
  useEffect(() => { if (open) { setT(type || 'need_referral'); setVals({}); } }, [open, type]);
  const schema = FIELD_SCHEMA[t] || [];
  const submit = async () => { await createPost(t, vals); onCreated?.(); };
  const set = (k, v) => setVals((s) => ({ ...s, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title="New post" width="max-w-xl">
      <div className="space-y-4">
        <Field label="Post type">
          <select value={t} onChange={(e) => { setT(e.target.value); setVals({}); }} className="h-11 w-full rounded-xl border border-subtle bg-base px-3 text-sm text-fg">
            {POST_TYPES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {schema.map(([k, label, kind]) => (
            <div key={k} className={kind === 'area' ? 'sm:col-span-2' : ''}>
              {kind === 'bool' ? (
                <button onClick={() => set(k, !vals[k])} className={`flex h-11 w-full items-center justify-between rounded-xl border px-3 text-sm transition ${vals[k] ? 'border-aurora-mint/40 bg-aurora-mint/10 text-fg' : 'border-subtle bg-surface-1 text-fg-secondary hover:border-strong'}`}>
                  <span>{label}</span>{vals[k] && <Check size={15} className="text-aurora-mint" />}
                </button>
              ) : kind === 'area' ? (
                <Field label={label}>
                  <textarea value={vals[k] || ''} onChange={(e) => set(k, e.target.value)} rows={3}
                    className="w-full rounded-xl border border-subtle bg-surface-1 px-3 py-2.5 text-sm text-fg placeholder:text-fg-muted outline-none focus:border-aurora-violet/50" />
                </Field>
              ) : (
                <Field label={label}><Input value={vals[k] || ''} onChange={(e) => set(k, e.target.value)} /></Field>
              )}
            </div>
          ))}
        </div>
        <p className="rounded-xl border border-subtle bg-surface-1 px-3 py-2 text-[11px] text-fg-muted">
          Do not share confidential company information. Referrals are voluntary and not guaranteed.
        </p>
        <div className="flex justify-end gap-2 border-t border-subtle pt-4">
          <Button variant="soft" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}><Plus size={15} /> Publish post</Button>
        </div>
      </div>
    </Modal>
  );
}
