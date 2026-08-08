import { useEffect, useMemo, useState } from 'react';
import { Trophy, Award, Target, Github, TrendingUp, Flame, Eye, ShieldCheck } from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Badge, Button, EmptyState, Spinner } from '../components/ui/kit.jsx';
import { ScoreRing } from '../components/proof/ProofViews.jsx';
import { fetchLeaderboardProfiles, LEADERBOARD_SEGMENTS, rankSegment, currentUserId } from '../lib/network.js';

function trustTone(level) {
  return { 'New': 'default', 'Building Trust': 'cyan', 'Trusted': 'violet', 'Highly Trusted': 'mint' }[level] || 'default';
}

function Row({ entry, idx, segment, onView }) {
  const m = entry.metrics || {};
  const isMe = String(entry.userId) === String(currentUserId());
  const headline = segment.kind === 'improved'
    ? <Badge tone="mint"><TrendingUp size={11} /> +{m.xpThisWeek} XP this week</Badge>
    : segment.kind === 'projectweek'
      ? <Badge tone="cyan"><Target size={11} /> {m.topProject?.proofScore} proof</Badge>
      : segment.kind === 'referral'
        ? <Badge tone="violet">{m.referralContributions} referrals offered</Badge>
        : <ScoreRing score={entry.score ?? m.readiness ?? 0} label="Score" />;
  return (
    <div className={`rounded-2xl border p-4 transition ${isMe ? 'border-aurora-cyan/40 bg-aurora-cyan/[0.05]' : 'border-white/10 bg-white/[0.02] hover:border-white/25'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-aurora-violet/15 font-display text-sm font-bold text-aurora-cyan">#{idx + 1}</span>
          <div>
            <p className="font-medium text-white">{entry.name}{isMe && <span className="ml-2 text-[11px] text-aurora-cyan">You</span>}</p>
            <p className="text-xs text-slate-400">{entry.targetRole || '—'} · {m.level || 'Beginner'} · {m.careerXP || 0} XP</p>
          </div>
        </div>
        {headline}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {(m.topSkills || []).slice(0, 4).map((s) => <Badge key={s.name} tone="cyan">{s.name}</Badge>)}
        <Badge tone="mint"><Award size={11} /> {m.verifiedBadges || 0}</Badge>
        <Badge tone={trustTone(entry.trustLevel)}><ShieldCheck size={11} /> {entry.trustScore}</Badge>
        {m.topProject && <Badge tone="default">Best: {m.topProject.title}</Badge>}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
        <div className="flex gap-1.5">
          {m.hasGithubVerified && <Badge tone="violet"><Github size={11} /> Verified</Badge>}
          {m.missionStreak > 0 && <Badge tone="amber"><Flame size={11} /> {m.missionStreak}w</Badge>}
        </div>
        <Button size="sm" variant="soft" onClick={() => onView(entry.userId)}><Eye size={13} /> View profile</Button>
      </div>
    </div>
  );
}

export default function Leaderboards({ go }) {
  const [profiles, setProfiles] = useState(null);
  const [seg, setSeg] = useState(LEADERBOARD_SEGMENTS[0].id);

  const load = () => fetchLeaderboardProfiles().then(setProfiles);
  useEffect(() => {
    load();
    const sync = () => load();
    ['career-network-updated', 'career-projects-updated', 'career-missions-updated'].forEach((e) => window.addEventListener(e, sync));
    return () => ['career-network-updated', 'career-projects-updated', 'career-missions-updated'].forEach((e) => window.removeEventListener(e, sync));
  }, []);

  const segment = LEADERBOARD_SEGMENTS.find((s) => s.id === seg);
  const ranked = useMemo(() => (profiles ? rankSegment(profiles, segment) : []), [profiles, segment]);

  const viewProfile = (userId) => {
    if (typeof window !== 'undefined') window.location.hash = `#/profile/${encodeURIComponent(userId)}`;
  };

  return (
    <>
      <PageIntro title="Leaderboards" sub="Ranked by real proof — verified Skill XP, project proof score, badges, GitHub/live evidence, activity, recruiter signal and trust. Not likes." />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {LEADERBOARD_SEGMENTS.map((s) => (
          <button key={s.id} onClick={() => setSeg(s.id)}
            className={`whitespace-nowrap rounded-xl border px-3.5 py-2 text-[13px] transition ${seg === s.id ? 'border-aurora-violet/50 bg-aurora-violet/15 text-white' : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20'}`}>
            {s.title}
          </button>
        ))}
      </div>

      <SectionCard title={segment.title} action={<Badge tone="mint">{ranked.length}</Badge>}>
        {profiles === null ? (
          <div className="grid place-items-center py-16"><Spinner /></div>
        ) : ranked.length === 0 ? (
          <EmptyState icon={Trophy} title="No ranked profiles yet"
            hint="Complete projects and earn verified badges to appear here. No placeholder candidates are shown."
            action={<Button size="sm" onClick={() => go?.('projectstudio')}>Build a project</Button>} />
        ) : (
          <div className="space-y-3">
            {ranked.map((entry, idx) => <Row key={entry.userId + idx} entry={entry} idx={idx} segment={segment} onView={viewProfile} />)}
          </div>
        )}
      </SectionCard>

      <p className="mt-4 text-center text-[11px] text-slate-500">
        Cross-user leaderboards populate as members make profiles public and publish verified projects. With no backend database configured, only your own eligible profile appears.
      </p>
    </>
  );
}
