import { useEffect, useState } from 'react';
import {
  Lightbulb, RefreshCw, Github, ExternalLink, Bookmark, Hammer, TrendingUp, Gauge, Sparkles,
  Loader2, Target, Clock, ListChecks, ShieldCheck, X, Newspaper, Rocket,
} from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Modal, EmptyState } from '../components/ui/kit.jsx';
import { Inspirations } from '../lib/api.js';

const SOURCE_LABEL = { github: 'GitHub', producthunt: 'Product Hunt', hackernews: 'Hacker News', seed: 'Curated' };
const SOURCE_TONE = { github: 'default', producthunt: 'amber', hackernews: 'violet', seed: 'cyan' };

function Meter({ icon: Icon, label, value }) {
  const tone = value >= 75 ? '#46E6A6' : value >= 50 ? '#37D6C4' : '#FFC85A';
  return (
    <div className="flex-1">
      <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500"><span className="inline-flex items-center gap-1"><Icon size={10} /> {label}</span><span>{value}</span></div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full" style={{ width: `${value}%`, background: tone }} /></div>
    </div>
  );
}

function InspirationCard({ it, onBuild, onSave, onSource }) {
  return (
    <div className="flex flex-col rounded-2xl border border-white/8 bg-white/[0.02] p-4 transition hover:border-white/20">
      <div className="flex items-start justify-between gap-2">
        <Badge tone={SOURCE_TONE[it.source] || 'default'}>
          {it.source === 'github' ? <Github size={11} /> : it.source === 'hackernews' ? <Newspaper size={11} /> : <Sparkles size={11} />} {SOURCE_LABEL[it.source] || it.source}
        </Badge>
        <Badge tone="mint"><Sparkles size={11} /> {it.marketplaceScore}</Badge>
      </div>
      <h3 className="mt-2 text-sm font-semibold text-white">{it.title}</h3>
      <p className="mt-1 line-clamp-3 text-[13px] text-slate-400">{it.problemStatement}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><Target size={11} /> {it.targetRoles?.[0] || 'Any role'}</span>
        <span>· {it.difficulty}</span>
        <span className="inline-flex items-center gap-1"><Clock size={11} /> {it.estimatedDuration}</span>
      </div>
      {it.tags?.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{it.tags.slice(0, 5).map((t) => <span key={t} className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">{t}</span>)}</div>}
      <div className="mt-3 flex gap-2">
        <Meter icon={TrendingUp} label="Trend" value={it.trendScore} />
        <Meter icon={Gauge} label="Buildable" value={it.buildabilityScore} />
        <Meter icon={Sparkles} label="Resume" value={it.resumeImpactScore} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-white/8 pt-3">
        <Button size="sm" onClick={() => onBuild(it)}><Hammer size={14} /> Build this</Button>
        <Button size="sm" variant="soft" onClick={() => onSave(it)}><Bookmark size={14} /> Save</Button>
        {it.sourceUrl && <Button size="sm" variant="soft" onClick={() => onSource(it)}><ExternalLink size={14} /> Source</Button>}
      </div>
    </div>
  );
}

export default function InspirationsView({ go }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [meta, setMeta] = useState({});
  const [roadmap, setRoadmap] = useState(null);
  const [building, setBuilding] = useState(false);
  const [toast, setToast] = useState('');

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  const load = async () => {
    setLoading(true);
    try { const d = await Inspirations.list(); setItems(d.inspirations || []); setMeta({ sources: d.sources, usedFallback: d.usedFallback }); }
    catch { setItems([]); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const refresh = async () => {
    setRefreshing(true);
    try { const d = await Inspirations.refresh(); setItems(d.inspirations || []); setMeta({ sources: d.sources, usedFallback: d.usedFallback }); flash('Refreshed'); }
    catch { flash('Refresh failed'); } finally { setRefreshing(false); }
  };

  const build = async (it) => {
    setBuilding(true); setRoadmap(null);
    try { const d = await Inspirations.build(it.id || it.sourceId, it); setRoadmap(d.roadmap); }
    catch { flash('Could not build roadmap'); } finally { setBuilding(false); }
  };
  const save = async (it) => { try { await Inspirations.save(it.id || it.sourceId, it); flash('Saved to your roadmaps'); } catch { flash('Save failed (DB off?)'); } };
  const openSource = (it) => { if (it.sourceUrl) window.open(it.sourceUrl, '_blank'); };

  const sourceTags = meta.sources ? Object.entries(meta.sources).filter(([, v]) => v).map(([k]) => SOURCE_LABEL[k] || k) : [];

  return (
    <>
      <PageIntro title="Live inspiration engine" sub="Trending, buildable project ideas sourced from GitHub, Hacker News and Product Hunt — turned into roadmaps with proof requirements. Falls back to curated ideas if live sources are unavailable." action={<Button onClick={refresh} disabled={refreshing}>{refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Refresh</Button>} />

      {sourceTags.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span>Sources:</span>{sourceTags.map((s) => <Badge key={s} tone="default">{s}</Badge>)}
          {meta.usedFallback && <Badge tone="cyan">Curated fallback</Badge>}
        </div>
      )}

      {toast && <div className="mb-3 rounded-lg border border-aurora-mint/30 bg-aurora-mint/10 px-3 py-2 text-xs text-aurora-mint">{toast}</div>}

      {loading ? (
        <SectionCard><div className="flex items-center gap-2 py-8 text-slate-400"><Loader2 size={16} className="animate-spin" /> Loading inspirations…</div></SectionCard>
      ) : items.length === 0 ? (
        <EmptyState icon={Lightbulb} title="No inspirations yet" hint="Hit refresh to pull the latest trending, buildable ideas." action={<Button size="sm" onClick={refresh}><RefreshCw size={14} /> Refresh</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((it) => <InspirationCard key={it.id || it.sourceId} it={it} onBuild={build} onSave={save} onSource={openSource} />)}
        </div>
      )}

      {(building || roadmap) && (
        <Modal open onClose={() => { setRoadmap(null); setBuilding(false); }} title={roadmap ? roadmap.title : 'Building roadmap…'} width="max-w-2xl">
          {!roadmap ? <div className="flex items-center gap-2 py-8 text-slate-400"><Loader2 size={16} className="animate-spin" /> Generating your build roadmap…</div> : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="cyan"><Target size={11} /> {roadmap.targetRole}</Badge>
                <Badge tone="violet">{roadmap.difficulty}</Badge>
                <Badge tone="default"><Clock size={11} /> {roadmap.estimatedDuration}</Badge>
                <Badge tone="amber"><Rocket size={11} /> {String(roadmap.status).replace(/_/g, ' ')}</Badge>
              </div>
              <p className="text-sm text-slate-300">{roadmap.problemStatement}</p>
              {roadmap.architecturePreview && <div><div className="text-[11px] uppercase tracking-wide text-slate-500">Architecture</div><p className="text-sm text-slate-300">{roadmap.architecturePreview}</p></div>}
              {roadmap.techStack?.length > 0 && <div className="flex flex-wrap gap-1.5">{roadmap.techStack.map((t) => <span key={t} className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">{t}</span>)}</div>}

              <div>
                <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500"><ListChecks size={12} /> Milestones</div>
                <ol className="space-y-2">
                  {roadmap.milestones.map((m, i) => (
                    <li key={i} className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-sm">
                      <span className="font-medium text-white">{i + 1}. {m.phase}</span>
                      <div className="text-[13px] text-slate-400">{m.detail}</div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Proof requirements</div>
                  <ul className="space-y-1">{roadmap.proofRequirements.map((p, i) => <li key={i} className="text-[13px] text-slate-300">• {p}</li>)}</ul>
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500"><ShieldCheck size={12} /> Verification checklist</div>
                  <ul className="space-y-1">{roadmap.verificationChecklist.map((c, i) => <li key={i} className="text-[13px] text-slate-300">{c.required ? '◆' : '◇'} {c.item}</li>)}</ul>
                </div>
              </div>

              {roadmap.resumeBullets?.length > 0 && (
                <div><div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Expected resume bullets</div>
                  <ul className="space-y-1">{roadmap.resumeBullets.map((b, i) => <li key={i} className="text-[13px] text-slate-300">• {b}</li>)}</ul></div>
              )}
              {roadmap.interviewTalkingPoints?.length > 0 && (
                <div><div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Interview talking points</div>
                  <ul className="space-y-1">{roadmap.interviewTalkingPoints.map((b, i) => <li key={i} className="text-[13px] text-slate-300">• {b}</li>)}</ul></div>
              )}

              <div className="flex flex-wrap gap-2 border-t border-white/8 pt-3">
                <Button size="sm" onClick={() => { go?.('skillsxp'); }}><ShieldCheck size={14} /> Submit for verification</Button>
                <Button size="sm" variant="soft" onClick={() => { go?.('marketplace'); }}><Rocket size={14} /> Open marketplace</Button>
                <Button size="sm" variant="soft" onClick={() => { setRoadmap(null); }}>Close</Button>
              </div>
              <p className="text-[11px] text-slate-500">When you've built it, submit the project with GitHub/live proof in Skills &amp; XP to earn verified XP.</p>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
