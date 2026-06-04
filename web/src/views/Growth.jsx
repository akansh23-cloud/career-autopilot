import { TrendingUp, Target, Eye, MessageSquare, Award } from 'lucide-react';
import { PageIntro, StatCard, SectionCard, BarChart } from './common.jsx';
import { Badge } from '../components/ui/kit.jsx';

export default function Growth() {
  return (
    <>
      <PageIntro title="Growth insights" sub="See what’s working across your funnel and double down on it." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard i={0} icon={Eye} tone="cyan" label="Profile views" value="148" delta="+22%" />
        <StatCard i={1} icon={Target} tone="violet" label="Match rate" value="71%" delta="+5%" />
        <StatCard i={2} icon={MessageSquare} tone="mint" label="Reply rate" value="34%" delta="+8%" />
        <StatCard i={3} icon={Award} tone="amber" label="Interviews" value="9" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SectionCard title="Applications over time" className="lg:col-span-2" action={<Badge tone="cyan">Last 8 weeks</Badge>}>
          <BarChart data={[5, 9, 7, 14, 11, 18, 16, 22]} labels={['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8']} />
        </SectionCard>

        <SectionCard title="Conversion">
          <div className="space-y-4">
            {[['Applied → Reply', 34, 'cyan'], ['Reply → Interview', 52, 'violet'], ['Interview → Offer', 28, 'mint']].map(([l, v, t]) => (
              <div key={l}>
                <div className="mb-1.5 flex justify-between text-xs"><span className="text-slate-400">{l}</span><span className="text-white">{v}%</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-white/6">
                  <div className={`h-full rounded-full bg-aurora-${t}`} style={{ width: `${v}%` }} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Top performing skills">
          <div className="flex flex-wrap gap-2">
            {['Kubernetes', 'Terraform', 'AWS', 'CI/CD', 'Docker', 'Python', 'GCP', 'Linux'].map((s, i) => (
              <Badge key={s} tone={['violet', 'cyan', 'mint', 'amber'][i % 4]}>{s}</Badge>
            ))}
          </div>
          <p className="mt-4 text-sm text-muted">Roles mentioning <span className="text-white">Kubernetes</span> & <span className="text-white">Terraform</span> reply 2.1× more often. Keep these front-and-centre.</p>
        </SectionCard>

        <SectionCard title="This week’s focus">
          <ul className="space-y-3">
            {[['Add 2 quantified achievements to resume', 'cyan'], ['Reach out to 5 platform-eng recruiters', 'violet'], ['Complete 1 Opportunity Arena challenge', 'mint']].map(([t, tone], i) => (
              <li key={i} className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
                <span className={`grid h-7 w-7 place-items-center rounded-lg bg-aurora-${tone}/12 text-aurora-${tone}`}><TrendingUp size={14} /></span>
                <span className="text-sm text-slate-200">{t}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </>
  );
}
