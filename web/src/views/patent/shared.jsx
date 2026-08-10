import { Badge } from '../../components/ui/kit.jsx';

export const PATENT_DISCLAIMER =
  'Patent OS provides invention research and drafting assistance only. It is not legal advice. Patentability and filing decisions should be reviewed by a qualified patent attorney.';

export const STATUS_LABELS = {
  raw_idea: 'Raw Idea', shortlisted: 'Shortlisted', refining: 'Refining', prior_art_review: 'Prior-Art Review',
  poc_planned: 'POC Planned', disclosure_drafted: 'Disclosure Drafted', attorney_ready: 'Attorney Ready',
  filed: 'Filed', published: 'Published', granted: 'Granted', abandoned: 'Abandoned',
};
export const STATUS_ORDER = ['raw_idea', 'shortlisted', 'refining', 'prior_art_review', 'poc_planned', 'disclosure_drafted', 'attorney_ready', 'filed', 'published', 'granted', 'abandoned'];
export const LOCKED_STATUSES = ['filed', 'published', 'granted'];

export const DOMAINS = ['Education', 'Healthcare', 'Fintech', 'Retail', 'Defence', 'DevOps', 'AI', 'Logistics', 'Agriculture', 'HRTech', 'Cybersecurity'];
export const TARGET_USERS = ['Student', 'College', 'Recruiter', 'Small shop owner', 'Startup founder', 'Enterprise team', 'Defence unit'];
export const TECHNOLOGIES = ['AI/ML', 'LLM', 'Computer Vision', 'IoT', 'Blockchain', 'Cloud', 'Edge Computing', 'Automation', 'Cybersecurity'];
export const GOALS = ['Reduce cost', 'Increase safety', 'Automate process', 'Detect fraud', 'Improve accuracy', 'Reduce manual work'];
export const FEEDBACK_TYPES = ['useful', 'not useful', 'too generic', 'already exists', 'technically weak', 'commercially strong', 'patent-worthy', 'needs refinement'];

export function gradeTone(score) {
  return score >= 85 ? 'mint' : score >= 70 ? 'cyan' : score >= 55 ? 'violet' : score >= 35 ? 'amber' : 'rose';
}
export function riskTone(level) {
  return level === 'Low' ? 'mint' : level === 'Medium' ? 'amber' : 'rose';
}

export function ScorePill({ score, grade }) {
  return <Badge tone={gradeTone(score)}>{score}/100{grade ? ` · ${grade}` : ''}</Badge>;
}

export function Disclaimer({ className = '' }) {
  return <p className={`text-[11px] leading-relaxed text-warn/90 ${className}`}>{PATENT_DISCLAIMER}</p>;
}
