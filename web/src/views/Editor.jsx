import { useEffect, useMemo, useState } from 'react';
import { Wand2, Copy, Check, PenLine, AlertTriangle, Download, FileText, Briefcase, Star } from 'lucide-react';
import { PageIntro, SectionCard } from './common.jsx';
import { Button, Badge, Field } from '../components/ui/kit.jsx';
import { AI } from '../lib/api.js';
import { getSelectedJob, getStoredResume } from '../lib/resumeStore.js';

/* ------------------------------------------------------------------ */
/* Mini SVG layout previews for each template                           */
/* ------------------------------------------------------------------ */
function TemplatePreview({ id }) {
  if (id === 'jake-tech') return (
    <svg viewBox="0 0 64 82" className="w-full h-full">
      <rect x="5" y="5" width="36" height="4" rx="1" fill="#e2e8f0" opacity="0.9"/>
      <rect x="5" y="12" width="26" height="2.5" rx="0.8" fill="#94a3b8" opacity="0.7"/>
      <rect x="5" y="17" width="48" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.4"/>
      <line x1="5" y1="21" x2="59" y2="21" stroke="#334155" strokeWidth="0.6"/>
      <rect x="5" y="24" width="22" height="2.5" rx="0.8" fill="#22d3ee" opacity="0.9"/>
      <rect x="5" y="29" width="48" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.6"/>
      <rect x="5" y="33" width="38" height="1.5" rx="0.5" fill="#64748b" opacity="0.55"/>
      <rect x="5" y="37" width="44" height="1.5" rx="0.5" fill="#64748b" opacity="0.5"/>
      <rect x="5" y="42" width="20" height="2.5" rx="0.8" fill="#22d3ee" opacity="0.9"/>
      <rect x="5" y="47" width="14" height="4" rx="1.5" fill="#0e7490" opacity="0.85"/>
      <rect x="22" y="47" width="14" height="4" rx="1.5" fill="#0e7490" opacity="0.85"/>
      <rect x="39" y="47" width="14" height="4" rx="1.5" fill="#0e7490" opacity="0.75"/>
      <rect x="5" y="54" width="14" height="4" rx="1.5" fill="#0891b2" opacity="0.7"/>
      <rect x="22" y="54" width="14" height="4" rx="1.5" fill="#0891b2" opacity="0.7"/>
      <rect x="5" y="62" width="24" height="2.5" rx="0.8" fill="#22d3ee" opacity="0.9"/>
      <rect x="5" y="67" width="44" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.55"/>
      <rect x="5" y="71" width="36" height="1.5" rx="0.5" fill="#64748b" opacity="0.5"/>
      <rect x="5" y="75" width="40" height="1.5" rx="0.5" fill="#64748b" opacity="0.45"/>
    </svg>
  );

  if (id === 'modern-dark') return (
    <svg viewBox="0 0 64 82" className="w-full h-full">
      <rect x="0" y="0" width="64" height="24" fill="#1e1b4b" opacity="0.9"/>
      <rect x="5" y="5" width="32" height="4" rx="1" fill="#f1f5f9" opacity="0.95"/>
      <rect x="5" y="12" width="22" height="2.5" rx="0.8" fill="#a78bfa" opacity="0.9"/>
      <rect x="44" y="6" width="14" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.6"/>
      <rect x="44" y="10" width="11" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.55"/>
      <rect x="44" y="14" width="12" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.55"/>
      <rect x="5" y="29" width="22" height="2.5" rx="0.8" fill="#a78bfa" opacity="0.9"/>
      <rect x="5" y="34" width="48" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.6"/>
      <rect x="5" y="38" width="40" height="1.5" rx="0.5" fill="#64748b" opacity="0.5"/>
      <rect x="5" y="42" width="44" height="1.5" rx="0.5" fill="#64748b" opacity="0.5"/>
      <rect x="5" y="48" width="22" height="2.5" rx="0.8" fill="#a78bfa" opacity="0.9"/>
      <rect x="5" y="54" width="48" height="3" rx="1" fill="#2e1065" opacity="0.6"/>
      <rect x="5" y="54" width="36" height="3" rx="1" fill="#7c3aed" opacity="0.7"/>
      <rect x="5" y="60" width="48" height="3" rx="1" fill="#2e1065" opacity="0.6"/>
      <rect x="5" y="60" width="28" height="3" rx="1" fill="#7c3aed" opacity="0.65"/>
      <rect x="5" y="66" width="48" height="3" rx="1" fill="#2e1065" opacity="0.6"/>
      <rect x="5" y="66" width="42" height="3" rx="1" fill="#7c3aed" opacity="0.7"/>
      <rect x="5" y="73" width="40" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.45"/>
      <rect x="5" y="77" width="34" height="1.5" rx="0.5" fill="#64748b" opacity="0.4"/>
    </svg>
  );

  if (id === 'ats-minimal') return (
    <svg viewBox="0 0 64 82" className="w-full h-full">
      <rect x="5" y="5" width="36" height="4.5" rx="1" fill="#f1f5f9" opacity="0.9"/>
      <rect x="5" y="12" width="48" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.6"/>
      <line x1="5" y1="16" x2="59" y2="16" stroke="#e2e8f0" strokeWidth="0.4" opacity="0.4"/>
      <rect x="5" y="19" width="24" height="2" rx="0.6" fill="#e2e8f0" opacity="0.8"/>
      <line x1="5" y1="23" x2="59" y2="23" stroke="#64748b" strokeWidth="0.3" opacity="0.3"/>
      <rect x="5" y="26" width="48" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.55"/>
      <rect x="5" y="30" width="40" height="1.5" rx="0.5" fill="#64748b" opacity="0.5"/>
      <rect x="5" y="34" width="44" height="1.5" rx="0.5" fill="#64748b" opacity="0.5"/>
      <rect x="5" y="39" width="22" height="2" rx="0.6" fill="#e2e8f0" opacity="0.8"/>
      <line x1="5" y1="43" x2="59" y2="43" stroke="#64748b" strokeWidth="0.3" opacity="0.3"/>
      <rect x="5" y="46" width="48" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.55"/>
      <rect x="5" y="50" width="36" height="1.5" rx="0.5" fill="#64748b" opacity="0.5"/>
      <rect x="5" y="54" width="42" height="1.5" rx="0.5" fill="#64748b" opacity="0.45"/>
      <rect x="5" y="58" width="32" height="1.5" rx="0.5" fill="#64748b" opacity="0.45"/>
      <rect x="5" y="63" width="20" height="2" rx="0.6" fill="#e2e8f0" opacity="0.8"/>
      <line x1="5" y1="67" x2="59" y2="67" stroke="#64748b" strokeWidth="0.3" opacity="0.3"/>
      <rect x="5" y="70" width="44" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.5"/>
      <rect x="5" y="74" width="36" height="1.5" rx="0.5" fill="#64748b" opacity="0.45"/>
      <rect x="5" y="78" width="40" height="1.5" rx="0.5" fill="#64748b" opacity="0.4"/>
    </svg>
  );

  if (id === 'executive') return (
    <svg viewBox="0 0 64 82" className="w-full h-full">
      <rect x="5" y="5" width="42" height="5.5" rx="1" fill="#f1f5f9" opacity="0.95"/>
      <rect x="5" y="14" width="28" height="3" rx="0.8" fill="#fbbf24" opacity="0.9"/>
      <rect x="5" y="19" width="14" height="1.5" rx="0.5" fill="#64748b" opacity="0.6"/>
      <rect x="22" y="19" width="14" height="1.5" rx="0.5" fill="#64748b" opacity="0.6"/>
      <rect x="39" y="19" width="14" height="1.5" rx="0.5" fill="#64748b" opacity="0.6"/>
      <rect x="5" y="23" width="54" height="1.5" rx="0.5" fill="#d97706" opacity="0.8"/>
      <rect x="5" y="28" width="22" height="2.5" rx="0.8" fill="#fcd34d" opacity="0.85"/>
      <rect x="5" y="33" width="50" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.6"/>
      <rect x="5" y="37" width="42" height="1.5" rx="0.5" fill="#64748b" opacity="0.55"/>
      <rect x="5" y="43" width="18" height="2.5" rx="0.8" fill="#fcd34d" opacity="0.85"/>
      <rect x="5" y="48" width="26" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.55"/>
      <rect x="5" y="52" width="22" height="1.5" rx="0.5" fill="#64748b" opacity="0.5"/>
      <rect x="5" y="56" width="24" height="1.5" rx="0.5" fill="#64748b" opacity="0.5"/>
      <rect x="38" y="43" width="18" height="2.5" rx="0.8" fill="#fcd34d" opacity="0.85"/>
      <rect x="38" y="48" width="18" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.5"/>
      <rect x="38" y="52" width="14" height="1.5" rx="0.5" fill="#64748b" opacity="0.45"/>
      <rect x="5" y="63" width="22" height="2.5" rx="0.8" fill="#fcd34d" opacity="0.8"/>
      <rect x="5" y="69" width="48" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.5"/>
      <rect x="5" y="73" width="40" height="1.5" rx="0.5" fill="#64748b" opacity="0.45"/>
      <rect x="5" y="77" width="44" height="1.5" rx="0.5" fill="#64748b" opacity="0.4"/>
    </svg>
  );

  if (id === 'cloud-pro') return (
    <svg viewBox="0 0 64 82" className="w-full h-full">
      <rect x="5" y="5" width="34" height="4" rx="1" fill="#e2e8f0" opacity="0.9"/>
      <rect x="5" y="12" width="24" height="2.5" rx="0.8" fill="#94a3b8" opacity="0.65"/>
      <line x1="5" y1="17" x2="59" y2="17" stroke="#334155" strokeWidth="0.6"/>
      <rect x="5" y="20" width="30" height="2.5" rx="0.8" fill="#22d3ee" opacity="0.9"/>
      <rect x="5" y="25" width="12" height="4" rx="1.5" fill="#0e7490" opacity="0.9"/>
      <rect x="20" y="25" width="12" height="4" rx="1.5" fill="#0891b2" opacity="0.85"/>
      <rect x="35" y="25" width="12" height="4" rx="1.5" fill="#0e7490" opacity="0.9"/>
      <rect x="50" y="25" width="9" height="4" rx="1.5" fill="#0891b2" opacity="0.8"/>
      <rect x="5" y="32" width="12" height="4" rx="1.5" fill="#0891b2" opacity="0.75"/>
      <rect x="20" y="32" width="12" height="4" rx="1.5" fill="#0e7490" opacity="0.85"/>
      <rect x="35" y="32" width="16" height="4" rx="1.5" fill="#0891b2" opacity="0.75"/>
      <rect x="5" y="41" width="22" height="2.5" rx="0.8" fill="#22d3ee" opacity="0.9"/>
      <rect x="5" y="46" width="48" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.6"/>
      <rect x="5" y="50" width="40" height="1.5" rx="0.5" fill="#64748b" opacity="0.5"/>
      <rect x="5" y="54" width="44" height="1.5" rx="0.5" fill="#64748b" opacity="0.5"/>
      <rect x="5" y="59" width="20" height="2.5" rx="0.8" fill="#22d3ee" opacity="0.9"/>
      <rect x="5" y="64" width="48" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.55"/>
      <rect x="5" y="68" width="36" height="1.5" rx="0.5" fill="#64748b" opacity="0.5"/>
      <rect x="5" y="72" width="42" height="1.5" rx="0.5" fill="#64748b" opacity="0.45"/>
      <rect x="5" y="77" width="32" height="1.5" rx="0.5" fill="#64748b" opacity="0.4"/>
    </svg>
  );

  if (id === 'fresher') return (
    <svg viewBox="0 0 64 82" className="w-full h-full">
      <rect x="5" y="5" width="32" height="4" rx="1" fill="#e2e8f0" opacity="0.9"/>
      <rect x="5" y="12" width="48" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.6"/>
      <line x1="5" y1="16" x2="59" y2="16" stroke="#334155" strokeWidth="0.6"/>
      <rect x="5" y="19" width="22" height="2.5" rx="0.8" fill="#c084fc" opacity="0.9"/>
      <rect x="5" y="24" width="44" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.55"/>
      <rect x="5" y="28" width="34" height="1.5" rx="0.5" fill="#64748b" opacity="0.5"/>
      <rect x="5" y="33" width="20" height="2.5" rx="0.8" fill="#c084fc" opacity="0.9"/>
      <rect x="5" y="38" width="54" height="13" rx="2" fill="#3b0764" opacity="0.25"/>
      <rect x="5" y="38" width="54" height="13" rx="2" fill="none" stroke="#7c3aed" strokeWidth="0.4" opacity="0.5"/>
      <rect x="8" y="41" width="28" height="2" rx="0.6" fill="#e2e8f0" opacity="0.7"/>
      <rect x="8" y="45" width="44" height="1.3" rx="0.5" fill="#64748b" opacity="0.5"/>
      <rect x="8" y="48" width="36" height="1.3" rx="0.5" fill="#64748b" opacity="0.45"/>
      <rect x="5" y="54" width="54" height="13" rx="2" fill="#3b0764" opacity="0.2"/>
      <rect x="5" y="54" width="54" height="13" rx="2" fill="none" stroke="#7c3aed" strokeWidth="0.4" opacity="0.4"/>
      <rect x="8" y="57" width="24" height="2" rx="0.6" fill="#e2e8f0" opacity="0.65"/>
      <rect x="8" y="61" width="42" height="1.3" rx="0.5" fill="#64748b" opacity="0.45"/>
      <rect x="8" y="64" width="34" height="1.3" rx="0.5" fill="#64748b" opacity="0.4"/>
      <rect x="5" y="70" width="12" height="3.5" rx="1.5" fill="#7c3aed" opacity="0.65"/>
      <rect x="20" y="70" width="12" height="3.5" rx="1.5" fill="#7c3aed" opacity="0.65"/>
      <rect x="35" y="70" width="12" height="3.5" rx="1.5" fill="#7c3aed" opacity="0.55"/>
      <rect x="5" y="76" width="12" height="3.5" rx="1.5" fill="#7c3aed" opacity="0.5"/>
      <rect x="20" y="76" width="14" height="3.5" rx="1.5" fill="#7c3aed" opacity="0.5"/>
    </svg>
  );

  if (id === 'product-analyst') return (
    <svg viewBox="0 0 64 82" className="w-full h-full">
      <rect x="5" y="5" width="34" height="4" rx="1" fill="#e2e8f0" opacity="0.9"/>
      <rect x="5" y="12" width="24" height="3" rx="0.8" fill="#34d399" opacity="0.85"/>
      <line x1="5" y1="17" x2="59" y2="17" stroke="#334155" strokeWidth="0.6"/>
      <rect x="5" y="20" width="22" height="2.5" rx="0.8" fill="#6ee7b7" opacity="0.9"/>
      <rect x="5" y="25" width="15" height="10" rx="2" fill="#064e3b" opacity="0.4"/>
      <rect x="5" y="25" width="15" height="10" rx="2" fill="none" stroke="#34d399" strokeWidth="0.4" opacity="0.6"/>
      <rect x="7" y="28" width="9" height="3" rx="0.8" fill="#34d399" opacity="0.75"/>
      <rect x="25" y="25" width="15" height="10" rx="2" fill="#064e3b" opacity="0.4"/>
      <rect x="25" y="25" width="15" height="10" rx="2" fill="none" stroke="#34d399" strokeWidth="0.4" opacity="0.6"/>
      <rect x="27" y="28" width="9" height="3" rx="0.8" fill="#34d399" opacity="0.75"/>
      <rect x="45" y="25" width="14" height="10" rx="2" fill="#064e3b" opacity="0.4"/>
      <rect x="45" y="25" width="14" height="10" rx="2" fill="none" stroke="#34d399" strokeWidth="0.4" opacity="0.6"/>
      <rect x="47" y="28" width="9" height="3" rx="0.8" fill="#34d399" opacity="0.75"/>
      <rect x="5" y="40" width="24" height="2.5" rx="0.8" fill="#6ee7b7" opacity="0.9"/>
      <rect x="5" y="45" width="50" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.6"/>
      <rect x="5" y="49" width="42" height="1.5" rx="0.5" fill="#64748b" opacity="0.5"/>
      <rect x="5" y="53" width="46" height="1.5" rx="0.5" fill="#64748b" opacity="0.5"/>
      <rect x="5" y="59" width="18" height="2.5" rx="0.8" fill="#6ee7b7" opacity="0.9"/>
      <rect x="5" y="64" width="12" height="3.5" rx="1.5" fill="#065f46" opacity="0.8"/>
      <rect x="20" y="64" width="12" height="3.5" rx="1.5" fill="#065f46" opacity="0.8"/>
      <rect x="35" y="64" width="12" height="3.5" rx="1.5" fill="#065f46" opacity="0.75"/>
      <rect x="5" y="71" width="12" height="3.5" rx="1.5" fill="#065f46" opacity="0.7"/>
      <rect x="20" y="71" width="12" height="3.5" rx="1.5" fill="#065f46" opacity="0.7"/>
      <rect x="5" y="77" width="44" height="1.5" rx="0.5" fill="#94a3b8" opacity="0.45"/>
    </svg>
  );

  if (id === 'two-page') return (
    <svg viewBox="0 0 64 82" className="w-full h-full">
      <rect x="4" y="3" width="56" height="36" rx="1.5" fill="none" stroke="#475569" strokeWidth="0.5" opacity="0.6"/>
      <rect x="8" y="7" width="32" height="3.5" rx="1" fill="#e2e8f0" opacity="0.9"/>
      <rect x="8" y="13" width="22" height="2" rx="0.6" fill="#fbbf24" opacity="0.8"/>
      <rect x="8" y="17" width="44" height="0.8" rx="0.3" fill="#d97706" opacity="0.6"/>
      <rect x="8" y="21" width="18" height="2" rx="0.6" fill="#fcd34d" opacity="0.8"/>
      <rect x="8" y="25" width="44" height="1.3" rx="0.5" fill="#94a3b8" opacity="0.55"/>
      <rect x="8" y="29" width="36" height="1.3" rx="0.5" fill="#64748b" opacity="0.5"/>
      <rect x="8" y="33" width="40" height="1.3" rx="0.5" fill="#64748b" opacity="0.45"/>
      <rect x="28" y="37.5" width="8" height="1" rx="0.3" fill="#475569" opacity="0.4"/>
      <rect x="4" y="43" width="56" height="36" rx="1.5" fill="none" stroke="#334155" strokeWidth="0.5" opacity="0.4"/>
      <rect x="8" y="47" width="16" height="2" rx="0.6" fill="#fcd34d" opacity="0.7"/>
      <rect x="8" y="51" width="44" height="1.3" rx="0.5" fill="#94a3b8" opacity="0.5"/>
      <rect x="8" y="55" width="38" height="1.3" rx="0.5" fill="#64748b" opacity="0.45"/>
      <rect x="8" y="59" width="40" height="1.3" rx="0.5" fill="#64748b" opacity="0.4"/>
      <rect x="8" y="64" width="16" height="2" rx="0.6" fill="#fcd34d" opacity="0.65"/>
      <rect x="8" y="68" width="44" height="1.3" rx="0.5" fill="#94a3b8" opacity="0.45"/>
      <rect x="8" y="72" width="36" height="1.3" rx="0.5" fill="#64748b" opacity="0.4"/>
      <rect x="28" y="77.5" width="8" height="1" rx="0.3" fill="#475569" opacity="0.3"/>
    </svg>
  );

  return null;
}

/* ------------------------------------------------------------------ */
/* Role → recommended template mapping                                  */
/* ------------------------------------------------------------------ */
function getRecommendedTemplate(role) {
  if (!role) return null;
  const r = role.toLowerCase();
  if (/cloud engineer/i.test(r)) return 'Cloud Engineer Pro';
  if (/intern|fresher|student|entry.level|junior/i.test(r)) return 'Fresher Project Focus';
  if (/devops|sre|site.reliability|platform.engineer/i.test(r)) return 'Jake Tech Compact';
  if (/data.analyst|business.analyst|product.analyst/i.test(r)) return 'Product Analyst Clean';
  if (/data.scien|machine.learning|ml.engineer/i.test(r)) return 'Jake Tech Compact';
  if (/product.manager|program.manager|project.manager/i.test(r)) return 'Executive Clean';
  if (/director|head of|principal|vp |senior.*manager/i.test(r)) return 'Two Page Detailed';
  if (/consultant|operations.manager|management/i.test(r)) return 'Executive Clean';
  if (/frontend|full.stack|mobile|react|ui.engineer/i.test(r)) return 'Modern Dark Header';
  if (/software|backend|engineer|sde|swe|developer/i.test(r)) return 'Jake Tech Compact';
  if (/analyst|operations|marketing|sales|finance|hr/i.test(r)) return 'ATS Minimal One Page';
  return null;
}

/* ------------------------------------------------------------------ */
/* Template definitions                                                 */
/* ------------------------------------------------------------------ */
const TEMPLATES = [
  { id: 'jake-tech',       name: 'Jake Tech Compact',    fit: 'DevOps · SRE · SDE · Platform',      ats: 'High',      tone: 'cyan',   desc: 'Single-column Overleaf-style. ATS-optimized, dense skills chips.' },
  { id: 'modern-dark',     name: 'Modern Dark Header',   fit: 'Startups · Frontend · Full Stack',    ats: 'High',      tone: 'violet', desc: 'Premium dark header with skill progress bars.' },
  { id: 'ats-minimal',     name: 'ATS Minimal One Page', fit: 'Portal submissions · Any role',       ats: 'Very high', tone: 'mint',   desc: 'No graphics, dense text — best recruiter-portal pass rate.' },
  { id: 'executive',       name: 'Executive Clean',      fit: 'Senior · Leadership · Management',    ats: 'High',      tone: 'amber',  desc: 'Bold impact profile, gold divider, two-area layout.' },
  { id: 'cloud-pro',       name: 'Cloud Engineer Pro',   fit: 'AWS · Azure · GCP · Infra',           ats: 'High',      tone: 'cyan',   desc: 'Cloud & CI/CD chip grid upfront, then experience.' },
  { id: 'fresher',         name: 'Fresher Project Focus',fit: 'Students · Interns · 0–2 yrs exp',    ats: 'High',      tone: 'violet', desc: 'Projects and hackathons front-and-center, education near top.' },
  { id: 'product-analyst', name: 'Product Analyst Clean',fit: 'Data Analyst · PM · BI roles',        ats: 'High',      tone: 'mint',   desc: 'KPI metric boxes, tools grid, business-impact bullets.' },
  { id: 'two-page',        name: 'Two Page Detailed',    fit: 'Deep experience · 10+ yrs',           ats: 'Medium-high',tone: 'amber', desc: 'Keeps full context intact — no splitting, no cutting.' },
];

const LENGTHS = ['Auto', 'Single page', 'Multi page'];
const OUT_KEY = 'careerAutopilot.editor.lastTailor.v1';

function safeRead() {
  try { return JSON.parse(localStorage.getItem(OUT_KEY) || '{}'); } catch { return {}; }
}
function safeWrite(v) {
  try { localStorage.setItem(OUT_KEY, JSON.stringify(v)); } catch {}
}
function downloadText(name, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function Editor() {
  const storedResume = getStoredResume();
  const selectedJob = getSelectedJob();
  const last = safeRead();

  const activeRole = storedResume.targetRole || storedResume.analysis?.recommendedRole || '';
  const recommendedName = getRecommendedTemplate(activeRole);

  const [resume, setResume] = useState(last.out || last.resume || storedResume.text || '');
  const [jd, setJd] = useState(selectedJob ? [selectedJob.title, selectedJob.company, selectedJob.location, selectedJob.summary, (selectedJob.requiredSkills || []).join(', ')].filter(Boolean).join('\n') : last.jd || '');
  const [tpl, setTpl] = useState(last.tpl || (recommendedName || TEMPLATES[0].name));
  const [len, setLen] = useState(last.len || 'Auto');
  const [out, setOut] = useState(last.out || '');
  const [status, setStatus] = useState('idle');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const sync = () => {
      const r = getStoredResume();
      const j = getSelectedJob();
      if (r.text) setResume(r.text);
      if (j) setJd([j.title, j.company, j.location, j.summary, (j.requiredSkills || []).join(', ')].filter(Boolean).join('\n'));
    };
    window.addEventListener('career-resume-updated', sync);
    window.addEventListener('career-selected-job-updated', sync);
    return () => {
      window.removeEventListener('career-resume-updated', sync);
      window.removeEventListener('career-selected-job-updated', sync);
    };
  }, []);

  const selectedTemplate = useMemo(() => TEMPLATES.find((t) => t.name === tpl) || TEMPLATES[0], [tpl]);

  const tailor = async () => {
    if (resume.trim().length < 40 || jd.trim().length < 20) { setErr('Add both your resume and the job description.'); return; }
    setStatus('loading'); setErr(''); setOut('');
    const prompt = `Rewrite and tailor the resume below to the job description. Keep it truthful — never invent experience, companies, dates, certifications, metrics or tools.
Use template style: ${tpl}. Length preference: ${len}. If Single page, compress bullets and remove weaker content. If Multi page, keep sections complete and do not split section content.
Optimise for ATS, lead with quantified impact, mirror the JD language, and output clean plain-text resume only.
JOB DESCRIPTION:\n"""${jd.slice(0, 5000)}"""\nRESUME:\n"""${resume.slice(0, 8000)}"""`;
    try {
      const d = await AI.message({ model: 'claude-sonnet-4-20250514', max_tokens: 2600, messages: [{ role: 'user', content: prompt }] });
      const text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const next = text.trim();
      setOut(next); setStatus('done');
      safeWrite({ resume, jd, tpl, len, out: next, updatedAt: new Date().toISOString() });
    } catch (e) { setErr(e.message || 'Tailoring failed.'); setStatus('error'); }
  };

  const copy = () => { navigator.clipboard?.writeText(out); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return (
    <>
      <PageIntro title="Resume editor" sub="Pick a template matched to your role, paste the job description, and let AI tailor your resume." />

      {selectedJob && (
        <div className="mb-4 rounded-2xl border border-aurora-cyan/20 bg-aurora-cyan/10 px-4 py-3 text-sm text-slate-200">
          <Briefcase size={15} className="mr-1.5 inline text-aurora-cyan" /> Editing package for <span className="font-medium text-white">{selectedJob.title}</span> at <span className="font-medium text-white">{selectedJob.company}</span>.
          {last.out && <span className="ml-1 text-slate-300">Tailored resume loaded from Jobs.</span>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.05fr]">
        <div className="space-y-4">
          <SectionCard title={last.out ? 'Editable tailored resume' : 'Base resume'} action={storedResume.fileName && <Badge tone="mint"><FileText size={11} /> {storedResume.fileName}</Badge>}>
            {last.out && <div className="mb-3 rounded-xl border border-aurora-mint/25 bg-aurora-mint/10 p-3 text-xs text-slate-200">This is the job-specific resume generated from the Jobs screen. Edit it here, then export.</div>}
            <textarea value={resume} onChange={(e) => { setResume(e.target.value); if (last.out) setOut(e.target.value); }} placeholder="Paste your current resume…"
              className="h-44 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-aurora-violet/50" />
          </SectionCard>

          <SectionCard title="Target job description">
            <textarea value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the job description or choose Tailor from a job card…"
              className="h-44 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-aurora-violet/50" />
          </SectionCard>

          <SectionCard title="Resume length">
            <div className="flex flex-wrap items-center gap-2">
              {LENGTHS.map((l) => (
                <button key={l} onClick={() => setLen(l)} className={`rounded-lg px-3 py-1.5 text-xs transition ${len === l ? 'bg-aurora-cyan/15 text-white ring-1 ring-aurora-cyan/30' : 'text-slate-400 hover:bg-white/5'}`}>{l}</button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">Single page compresses weak content. Multi page keeps sections intact instead of splitting content awkwardly.</p>
          </SectionCard>

          {/* ── Template gallery ── */}
          <SectionCard
            title="Resume template"
            action={
              recommendedName && activeRole ? (
                <span className="flex items-center gap-1.5 text-[11px] text-aurora-mint">
                  <Star size={11} className="fill-aurora-mint" /> Smart pick for <span className="font-semibold">{activeRole}</span>
                </span>
              ) : null
            }
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {TEMPLATES.map((t) => {
                const isSelected = tpl === t.name;
                const isRec = recommendedName === t.name;
                return (
                  <button
                    key={t.name}
                    onClick={() => setTpl(t.name)}
                    className={`flex items-stretch gap-3 rounded-xl border p-3 text-left transition ${
                      isSelected
                        ? 'border-aurora-violet/50 bg-aurora-violet/12 ring-1 ring-aurora-violet/20'
                        : 'border-white/10 bg-white/[0.025] hover:border-white/22 hover:bg-white/[0.04]'
                    }`}
                  >
                    {/* Mini preview thumbnail */}
                    <div className="h-[82px] w-[64px] shrink-0 overflow-hidden rounded-lg bg-slate-950/70 ring-1 ring-white/6">
                      <TemplatePreview id={t.id} />
                    </div>

                    {/* Template info */}
                    <div className="flex min-w-0 flex-1 flex-col justify-between">
                      <div>
                        <div className="flex items-start justify-between gap-1.5">
                          <p className="text-[13px] font-semibold leading-tight text-white">{t.name}</p>
                          {isRec && (
                            <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-aurora-mint/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-aurora-mint ring-1 ring-aurora-mint/25">
                              <Star size={8} className="fill-aurora-mint" /> Pick
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{t.fit}</p>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{t.desc}</p>
                      </div>
                      <div className="mt-2">
                        <Badge tone={t.tone} className="text-[9px]">ATS: {t.ats}</Badge>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {err && <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-glow"><AlertTriangle size={13} /> {err}</p>}
            <Button className="mt-4 w-full" onClick={tailor} disabled={status === 'loading'}>
              <Wand2 size={16} /> {status === 'loading' ? 'Tailoring…' : 'Tailor with AI'}
            </Button>
          </SectionCard>
        </div>

        <SectionCard title="Tailored result" action={out && <div className="flex gap-2"><Button size="sm" variant="soft" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}</Button><Button size="sm" onClick={() => downloadText('tailored-resume.txt', out)}><Download size={14} /> TXT</Button></div>}>
          {!out && status !== 'loading' && (
            <div className="grid place-items-center rounded-xl border border-dashed border-white/10 py-20 text-center">
              <PenLine size={26} className="mb-3 text-aurora-cyan" />
              <p className="text-sm text-slate-300">Your tailored resume will appear here</p>
              <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-500">Using <span className="text-slate-300">{selectedTemplate.name}</span>. {selectedTemplate.desc}</p>
              <p className="mt-2 text-xs text-slate-500">Template: <Badge tone={selectedTemplate.tone}>{selectedTemplate.name}</Badge></p>
            </div>
          )}
          {status === 'loading' && (
            <div className="space-y-2.5 py-2">
              {Array.from({ length: 10 }).map((_, i) => <div key={i} className="h-3 animate-pulse rounded bg-white/5" style={{ width: `${55 + (i % 5) * 9}%` }} />)}
            </div>
          )}
          {out && <textarea value={out} onChange={(e) => setOut(e.target.value)} className="min-h-[720px] w-full resize-y rounded-xl border border-white/8 bg-ink-950/60 p-4 font-mono text-[12.5px] leading-relaxed text-slate-200 outline-none focus:border-aurora-violet/50" />}
        </SectionCard>
      </div>
    </>
  );
}
