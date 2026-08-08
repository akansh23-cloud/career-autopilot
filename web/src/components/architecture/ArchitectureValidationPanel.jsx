// Architecture Diagram OS — validation & quality score panel.
import { CheckCircle2, AlertTriangle, Gauge } from 'lucide-react';
import { Badge } from '../ui/kit.jsx';
import { SCORE_CATEGORIES, scoreTone, checkTone } from '../../lib/architectureSpec.js';

function ScoreBar({ label, value }) {
  const pct = Math.max(0, Math.min(100, Math.round(value || 0)));
  const tone = pct >= 75 ? '#57E6A8' : pct >= 50 ? '#6EE0F2' : '#EAC97C';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-fg-secondary">{label}</span>
        <span className="tabular-nums text-fg-secondary">{pct}/100</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-1">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone, transition: 'width .6s ease' }} />
      </div>
    </div>
  );
}

export default function ArchitectureValidationPanel({ validation }) {
  if (!validation?.score) return null;
  const { score, checks = [], missingCriticalItems = [], recommendations = [] } = validation;
  const failing = checks.filter((c) => c.status === 'fail');
  const passing = checks.filter((c) => c.status === 'pass');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={scoreTone(score.overallScore)}>
          <Gauge size={11} /> Architecture quality {score.overallScore}/100
        </Badge>
        <Badge tone="default">{passing.length}/{checks.length} checks passing</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {SCORE_CATEGORIES.map(([k, label]) => (
          <ScoreBar key={k} label={label} value={score[k]} />
        ))}
      </div>

      {missingCriticalItems.length > 0 && (
        <div className="rounded-xl border border-amber-glow/25 bg-amber-glow/5 p-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-amber-glow">Missing production-readiness items</p>
          <ul className="space-y-1.5">
            {missingCriticalItems.map((m, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-fg-secondary">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-glow" /> {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      {failing.length > 0 && (
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-fg-muted">Failed checks</p>
          <ul className="space-y-2">
            {failing.map((c) => (
              <li key={c.id} className="rounded-lg border border-subtle bg-surface-1 p-2.5">
                <div className="flex items-center gap-2">
                  <Badge tone={checkTone(c.severity)}>{c.severity}</Badge>
                  <span className="text-[13px] text-fg">{c.message}</span>
                </div>
                {c.recommendation && <p className="mt-1.5 text-[12px] text-fg-secondary">{c.recommendation}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {failing.length === 0 && checks.length > 0 && (
        <p className="flex items-center gap-1.5 text-[13px] text-aurora-mint">
          <CheckCircle2 size={15} /> All best-practice checks pass for this maturity level.
        </p>
      )}

      {recommendations.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[12px] text-fg-secondary">Recommendations ({recommendations.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {recommendations.map((r, i) => (
              <li key={i} className="text-[13px] text-fg-secondary">• {r}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
