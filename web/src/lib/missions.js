// Weekly mission system — turns the app from a passive tool into a skill-building habit.
// Missions are user-scoped and mix project execution, coding practice, interview prep,
// proof-of-work, and career actions. Completion is persisted locally and can be synced later.

import { getProjects, taskProgress } from './projectStore.js';
import { getStoredResume, getStoredJobResults } from './resumeStore.js';
import { getProfile } from './userProfile.js';

const KEY = 'careerAutopilot.weeklyMissions.v1';
let currentUserKey = 'guest';

function normalizeUserKey(user) {
  const raw = user?.email || user?.id || 'guest';
  return String(raw).trim().toLowerCase().replace(/[^a-z0-9@._-]+/g, '_') || 'guest';
}
export function setMissionUser(user) { currentUserKey = normalizeUserKey(user); }
function scoped(base) { return `${base}:${currentUserKey}`; }
function weekKey(d = new Date()) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
function read() {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(window.localStorage.getItem(scoped(KEY)) || '{}') || {}; } catch { return {}; }
}
function write(v) {
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(scoped(KEY), JSON.stringify(v)); } catch {}
    window.dispatchEvent(new CustomEvent('career-missions-updated', { detail: v }));
  }
  return v;
}
function primaryProject(projects) {
  return projects.slice().sort((a, b) => taskProgress(a) - taskProgress(b))[0] || null;
}
function roleTrack(role = '') {
  const r = role.toLowerCase();
  if (/devops|cloud|sre|platform/.test(r)) return 'DevOps';
  if (/data|analytics|etl/.test(r)) return 'Data';
  if (/ai|ml|machine/.test(r)) return 'AI/ML';
  if (/frontend|react|ui/.test(r)) return 'Frontend';
  if (/backend|java|node|api/.test(r)) return 'Backend';
  return 'Full Stack';
}
function codingMissionFor(track) {
  const map = {
    DevOps: { title: 'Write one Dockerfile + local run proof', detail: 'Containerise one small app, run it locally, and save the command/output in your README.', skill: 'Docker', minutes: 45 },
    Data: { title: 'Build one data-cleaning notebook', detail: 'Load a dataset, clean missing values, create 2 insights, and document decisions.', skill: 'Python', minutes: 45 },
    'AI/ML': { title: 'Train and evaluate one baseline model', detail: 'Create a baseline model, add metrics, and write what improved/worsened results.', skill: 'Machine Learning', minutes: 60 },
    Frontend: { title: 'Build one polished responsive component', detail: 'Create a reusable component with loading, empty and error states, then test mobile width.', skill: 'React', minutes: 40 },
    Backend: { title: 'Implement one API endpoint with validation', detail: 'Create one route, validate inputs, add success/error responses, and test it with Postman/curl.', skill: 'API Design', minutes: 45 },
    'Full Stack': { title: 'Connect one UI screen to a real API', detail: 'Build one screen, one API endpoint, persistence, loading state and error handling.', skill: 'Full Stack', minutes: 60 },
  };
  return map[track] || map['Full Stack'];
}
function defaultMissions() {
  const profile = getProfile();
  const resume = getStoredResume();
  const jobs = getStoredJobResults();
  const projects = getProjects();
  const p = primaryProject(projects);
  const track = roleTrack(profile.targetRole || resume.targetRole || p?.targetRole || 'Full Stack Developer');
  const coding = codingMissionFor(track);
  const hasResume = Boolean(resume?.text || resume?.analysis);
  const hasJobs = (jobs?.jobs || []).length > 0;

  const projectTitle = p?.title || `${track} proof-of-work project`;
  return [
    {
      id: 'weekly-project-proof',
      type: 'project',
      title: p ? `Move “${projectTitle}” closer to proof` : 'Create your first proof-of-work project',
      detail: p ? 'Complete 2 pending roadmap tasks and add one visible proof item: GitHub, live demo, screenshot, README or architecture.' : 'Generate a guided project roadmap for your target role and save it as a workspace.',
      why: 'Projects are the proof layer recruiters can inspect beyond your resume.',
      xp: 60,
      minutes: 90,
      cta: p ? 'Open workspace' : 'Create project',
      route: 'projectstudio',
    },
    {
      id: 'weekly-coding-skill',
      type: 'coding',
      title: coding.title,
      detail: coding.detail,
      why: `Keeps ${coding.skill} sharp through implementation, not passive reading.`,
      xp: 45,
      minutes: coding.minutes,
      cta: 'Open project studio',
      route: 'projectstudio',
    },
    {
      id: 'weekly-interview-story',
      type: 'interview',
      title: 'Answer 3 project interview questions out loud',
      detail: 'Prepare: “Why this stack?”, “What was the hardest bug?”, and “How would you scale it?”. Record or write short answers.',
      why: 'Students often build projects but fail to explain them. This fixes that gap.',
      xp: 35,
      minutes: 30,
      cta: 'Open profile',
      route: 'profile',
    },
    {
      id: 'weekly-resume-market',
      type: 'career',
      title: hasResume ? 'Refresh resume bullets from current proof' : 'Upload and analyze your resume',
      detail: hasResume ? 'Add one measurable project bullet and remove one weak/generic line.' : 'Upload your resume so roadmap, projects and jobs can align with your actual profile.',
      why: 'Your resume should reflect fresh proof, not outdated claims.',
      xp: 30,
      minutes: 25,
      cta: hasResume ? 'Open resume' : 'Analyze resume',
      route: 'resume',
    },
    {
      id: 'weekly-opportunity',
      type: 'opportunity',
      title: hasJobs ? 'Shortlist 2 roles and identify their missing skills' : 'Find 3 matching jobs or opportunities',
      detail: hasJobs ? 'Pick two roles, compare gaps, and convert one gap into a project task.' : 'Use job matching or Opportunity Arena to find what the market is actually asking for.',
      why: 'Market feedback keeps your learning roadmap realistic.',
      xp: 30,
      minutes: 35,
      cta: hasJobs ? 'Open jobs' : 'Find opportunities',
      route: hasJobs ? 'jobs' : 'opportunities',
    },
  ];
}
export function getWeeklyMissions() {
  const wk = weekKey();
  const state = read();
  const completed = state[wk]?.completed || {};
  return defaultMissions().map((m) => ({ ...m, weekKey: wk, done: Boolean(completed[m.id]), completedAt: completed[m.id] || null }));
}
export function setMissionDone(id, done = true) {
  const wk = weekKey();
  const state = read();
  const current = state[wk] || { completed: {} };
  const completed = { ...(current.completed || {}) };
  if (done) completed[id] = new Date().toISOString(); else delete completed[id];
  state[wk] = { ...current, completed, updatedAt: new Date().toISOString() };
  write(state);
  return getWeeklyMissions();
}
export function missionStats(missions = getWeeklyMissions()) {
  const total = missions.length;
  const done = missions.filter((m) => m.done).length;
  const xpEarned = missions.filter((m) => m.done).reduce((s, m) => s + (m.xp || 0), 0);
  const xpTotal = missions.reduce((s, m) => s + (m.xp || 0), 0);
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0, xpEarned, xpTotal };
}
