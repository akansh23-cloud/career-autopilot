// Guided Project Workspace — custom project creation form.
// Collects the inputs normalizeCustomProject expects on the backend.
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Card, Button, Input, Field, Spinner } from '../ui/kit.jsx';
import { SectionTitle, NoticeBar } from './workspaceBits.jsx';
import { validCustomInput } from '../../lib/workspaceSelectors.js';

const CATEGORIES = ['SaaS', 'Marketplace', 'EdTech', 'FinTech', 'HealthTech', 'DevTool', 'Social', 'E-commerce', 'Analytics', 'Other'];
const ROLES = ['Full-stack Developer', 'Frontend Developer', 'Backend Developer', 'Data Engineer', 'ML Engineer', 'DevOps Engineer'];
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
const CLOUDS = ['generic', 'aws', 'gcp', 'azure', 'vercel', 'render'];
const FLAGS = [
  ['ai', 'AI feature'], ['auth', 'Authentication'], ['admin', 'Admin portal'],
  ['recruiter', 'Recruiter portal'], ['payment', 'Payments'], ['upload', 'File uploads'],
  ['patent', 'Patent potential evaluation'],
];

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-field-border bg-field px-3 py-2.5 text-[13px] text-fg outline-none focus:border-aurora-violet/40">
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function TextArea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows}
      className="w-full resize-y rounded-xl border border-field-border bg-field px-3 py-2.5 text-[13px] text-fg placeholder-slate-600 outline-none focus:border-aurora-violet/40" />
  );
}

export default function CustomProjectForm({ onSubmit, busy }) {
  const [form, setForm] = useState({
    title: '', problemStatement: '', targetUsers: '', category: 'SaaS',
    targetRole: 'Full-stack Developer', difficulty: 'intermediate',
    techStackText: 'React, Node.js, Express, MongoDB', cloudProvider: 'generic',
    mvpFeaturesText: '', advancedFeaturesText: '',
    flags: { ai: false, auth: true, admin: false, recruiter: false, payment: false, upload: false, patent: false },
  });
  const [errors, setErrors] = useState([]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setFlag = (k, v) => setForm((f) => ({ ...f, flags: { ...f.flags, [k]: v } }));

  const submit = () => {
    const check = validCustomInput(form);
    setErrors(check.errors);
    if (!check.ok) return;
    const lines = (t) => String(t || '').split(/\n|,/).map((s) => s.trim()).filter(Boolean);
    onSubmit({
      title: form.title.trim(),
      problemStatement: form.problemStatement.trim(),
      targetUsers: form.targetUsers.trim(),
      category: form.category,
      targetRole: form.targetRole,
      difficulty: form.difficulty,
      techStack: lines(form.techStackText),
      cloudProvider: form.cloudProvider,
      mvpFeatures: lines(form.mvpFeaturesText),
      advancedFeatures: lines(form.advancedFeaturesText),
      flags: form.flags,
    });
  };

  return (
    <Card className="mx-auto max-w-3xl p-6 sm:p-8">
      <SectionTitle hint="Describe your own project — the workspace plan (screens, APIs, models, tasks, starter code) is generated deterministically from these answers.">
        Create a custom project
      </SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Project title *"><Input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Local Tutor Marketplace" /></Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Problem statement *" hint="What real problem does it solve?">
            <TextArea value={form.problemStatement} onChange={(v) => set('problemStatement', v)} placeholder="Students in tier-2 cities struggle to find verified local tutors…" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Target users"><Input value={form.targetUsers} onChange={(e) => set('targetUsers', e.target.value)} placeholder="e.g. school students, parents, tutors" /></Field>
        </div>
        <Field label="Category"><Select value={form.category} onChange={(v) => set('category', v)} options={CATEGORIES} /></Field>
        <Field label="Target role"><Select value={form.targetRole} onChange={(v) => set('targetRole', v)} options={ROLES} /></Field>
        <Field label="Difficulty"><Select value={form.difficulty} onChange={(v) => set('difficulty', v)} options={DIFFICULTIES} /></Field>
        <Field label="Cloud provider"><Select value={form.cloudProvider} onChange={(v) => set('cloudProvider', v)} options={CLOUDS} /></Field>
        <div className="sm:col-span-2">
          <Field label="Tech stack" hint="Comma or newline separated. MERN gets the richest starter templates.">
            <TextArea rows={2} value={form.techStackText} onChange={(v) => set('techStackText', v)} />
          </Field>
        </div>
        <Field label="MVP features" hint="One per line">
          <TextArea value={form.mvpFeaturesText} onChange={(v) => set('mvpFeaturesText', v)} placeholder={'Tutor search\nBooking flow'} />
        </Field>
        <Field label="Advanced features" hint="One per line — scoped to 'Later'">
          <TextArea value={form.advancedFeaturesText} onChange={(v) => set('advancedFeaturesText', v)} placeholder={'AI tutor matching\nVideo lessons'} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Capabilities">
            <div className="flex flex-wrap gap-2">
              {FLAGS.map(([k, label]) => (
                <button key={k} onClick={() => setFlag(k, !form.flags[k])}
                  className={`rounded-full border px-3 py-1.5 text-[12px] transition ${form.flags[k] ? 'border-aurora-violet/40 bg-aurora-violet/14 text-fg' : 'border-subtle text-fg-secondary hover:bg-surface-hover'}`}>
                  {label}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </div>
      {errors.length > 0 && (
        <div className="mt-4"><NoticeBar tone="warn">{errors.join(' ')}</NoticeBar></div>
      )}
      <div className="mt-6 flex justify-end">
        <Button onClick={submit} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : <Sparkles size={15} />} Generate workspace plan
        </Button>
      </div>
    </Card>
  );
}
