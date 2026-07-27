/* ============================================================
   Guided Project Workspace — custom project builder.
   Normalizes the "Create Custom Project" form into the same
   project shape the rest of the app stores (projectStore /
   user-state `projects` array), so a custom project rides every
   existing surface (cards, builder, architecture) unchanged.
   Deterministic only.
   ============================================================ */
import { arr, str, obj, slug, did, pascal } from './planUtils.js';

const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced'];

const splitList = (v) => (Array.isArray(v) ? v : str(v).split(/[\n,;]+/))
  .map((s) => str(s).trim()).filter(Boolean).slice(0, 20);

export function normalizeCustomProject(input = {}, { now } = {}) {
  const i = obj(input);
  const title = str(i.title || i.projectTitle).trim().slice(0, 140) || 'Untitled custom project';
  const diffIn = str(i.difficulty).trim();
  const diffNorm = diffIn ? diffIn.charAt(0).toUpperCase() + diffIn.slice(1).toLowerCase() : '';
  const difficulty = DIFFICULTIES.includes(diffNorm) ? diffNorm : 'Intermediate';
  const f = obj(i.flags);
  const flags = {
    ai: f.ai === true || i.aiRequired === true || i.ai === true,
    auth: f.auth !== undefined ? f.auth !== false : i.authRequired !== false, // default on
    admin: f.admin === true || i.adminRequired === true,
    recruiter: f.recruiter === true || i.recruiterRequired === true,
    payment: f.payment === true || i.paymentRequired === true,
    upload: f.upload === true || i.uploadRequired === true,
    patent: f.patent === true || i.patentEvaluation === true || i.patentPotential === true,
  };
  const createdAt = (now ? new Date(now) : new Date()).toISOString();
  return {
    id: str(i.id) || `custom_${slug(title)}_${Date.now().toString(36)}`,
    isCustom: true,
    source: 'custom',
    title,
    problemStatement: str(i.problemStatement).trim().slice(0, 2000),
    useCase: str(i.problemStatement).trim().slice(0, 2000),
    targetUsers: str(i.targetUsers).trim().slice(0, 500),
    category: str(i.category).trim().slice(0, 80) || 'Web App',
    type: str(i.category).trim().slice(0, 80) || 'Web App',
    targetRole: str(i.targetRole).trim().slice(0, 120) || 'Full-Stack Developer',
    difficulty,
    techStack: splitList(i.techStack).length ? splitList(i.techStack) : ['React', 'Node.js', 'Express', 'MongoDB'],
    cloudProvider: str(i.cloudProvider || i.deploymentPreference).trim().toLowerCase().slice(0, 30) || 'generic',
    mvpFeatures: splitList(i.mvpFeatures),
    advancedFeatures: splitList(i.advancedFeatures),
    flags,
    createdAt,
    updatedAt: createdAt,
  };
}

/* Derive the project's primary domain entity ("Resume", "Listing", "Task"…)
   from the category/title/features. Used to name the sample model, route,
   upload flow and starter files consistently across the whole plan. */
const ENTITY_HINTS = [
  [/resume|cv/, 'Resume'], [/job|career/, 'Job'], [/task|todo/, 'Task'],
  [/habit|routine|streak/, 'Habit'], [/note/, 'Note'], [/recipe|meal/, 'Recipe'],
  [/listing|market/, 'Listing'], [/course|learn|quiz|flashcard/, 'Course'],
  [/event|booking|appointment/, 'Event'], [/expense|budget|finance|money|spend/, 'Expense'],
  [/post|blog|social|feed/, 'Post'], [/ticket|support|helpdesk/, 'Ticket'],
  [/order|shop|commerce|cart|store/, 'Order'], [/patient|health|clinic|fitness|workout/, 'Record'],
  [/student|attendance|grade/, 'Student'], [/inventory|stock|asset/, 'Item'],
  [/document|doc|file/, 'Document'], [/contact|crm|lead/, 'Contact'],
  [/book|library|read/, 'Book'], [/movie|film|watch/, 'Title'],
  [/habit|goal|track/, 'Entry'], [/project/, 'Project'],
];
/* Generic words that must never become the entity name — if the title/category
   reduces to one of these, we look harder for a real noun. */
const GENERIC_ENTITY = new Set(['Web', 'App', 'Application', 'Site', 'Website', 'Platform', 'System', 'Tool', 'Dashboard', 'Portal', 'Service', 'Project', 'Mobile', 'Full', 'Fullstack', 'Online', 'My', 'The', 'A']);

export function derivePrimaryEntity(project = {}) {
  const hay = [project.category, project.title, project.problemStatement, arr(project.mvpFeatures).join(' ')]
    .map((s) => str(s).toLowerCase()).join(' ');
  for (const [re, name] of ENTITY_HINTS) if (re.test(hay)) return name;
  // Fallback: pull the first meaningful word from the TITLE (what the student
  // named their thing), skipping generic app-words, before the category.
  const titleWords = str(project.title).split(/[\s\-_]+/).map((w) => pascal(w)).filter(Boolean);
  const meaningful = titleWords.find((w) => w.length > 2 && !GENERIC_ENTITY.has(w));
  if (meaningful) return meaningful.replace(/s$/, ''); // singularize a trailing plural
  const catWord = pascal(str(project.category).split(/\s+/)[0] || '');
  return catWord && !GENERIC_ENTITY.has(catWord) ? catWord : 'Item';
}

/* Stable feature descriptors from the MVP feature list (or sensible
   defaults), each with an id used to link screens/apis/tasks/files. */
export function deriveFeatures(project = {}) {
  const list = arr(project.mvpFeatures).slice(0, 8);
  const base = list.length ? list : ['Core dashboard', `${derivePrimaryEntity(project)} management`];
  return base.map((name, idx) => ({
    id: did('feat', name),
    name: str(name).slice(0, 90),
    order: idx + 1,
  }));
}
