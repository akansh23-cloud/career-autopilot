/* Guided Project Workspace — screen + user journey planner (deterministic).
   Screens are wireframe-level descriptors only — no image generation. */
import { did, pascal, slug } from './planUtils.js';

export function planScreens(project = {}, stack = {}, features = [], entity = 'Item') {
  const f = stack.features || {};
  const screens = [];
  const add = (name, purpose, route, userRole = 'user', components = []) => {
    screens.push({
      id: did('scr', name),
      name, purpose, route,
      userRole,
      components,
      linkedApis: [], linkedModels: [], linkedTasks: [],
      status: 'planned',
    });
  };

  if (f.auth) add('Sign In', 'Authenticate the user before any data is shown.', '/login', 'guest', ['AuthForm', 'OAuthButtons (TODO)']);
  add('Dashboard', `Landing surface after sign-in: ${entity.toLowerCase()} summary, recent activity, next actions.`, '/', 'user', ['StatCards', `${pascal(entity)}List`, 'EmptyState']);
  add(`${entity} Detail`, `Create/view/edit a single ${entity.toLowerCase()}.`, `/${slug(entity)}/:id`, 'user', [`${pascal(entity)}Form`, `${pascal(entity)}Card`]);
  if (f.upload) add(`Upload ${entity}`, `Upload a ${entity.toLowerCase()} file and see it stored.`, '/upload', 'user', ['FileUploadBox', 'UploadList']);
  if (f.ai) add('Score Result', 'Show the deterministic/AI score output with a breakdown.', '/score', 'user', ['ScoreCard', 'BreakdownList']);
  for (const feat of features.slice(0, 5)) {
    const nm = pascal(feat.name).slice(0, 40);
    if (screens.some((s) => s.name.toLowerCase() === feat.name.toLowerCase())) continue;
    add(feat.name, `Screen for the MVP feature “${feat.name}”.`, `/${slug(feat.name)}`, 'user', [`${nm}Panel`]);
  }
  if (f.admin) add('Admin Dashboard', 'Admin-only view of users and records (read-only first).', '/admin', 'admin', ['UsersTable', 'RecordsTable']);
  if (f.recruiter) add('Recruiter Console', 'Recruiter-role view of candidates/records.', '/recruiter', 'recruiter', ['CandidateList', 'Filters']);

  const journeys = [
    {
      id: did('jrn', 'first run'),
      name: 'First successful run',
      actor: 'New user',
      steps: [
        ...(f.auth ? ['Open app → Sign In'] : ['Open app']),
        'Land on Dashboard (empty state)',
        f.upload ? `Upload first ${entity.toLowerCase()}` : `Create first ${entity.toLowerCase()}`,
        f.ai ? 'View score result' : `See ${entity.toLowerCase()} in the list`,
        'Refresh — data persists',
      ],
    },
    {
      id: did('jrn', 'daily use'),
      name: `Manage ${entity.toLowerCase()}s`,
      actor: 'Returning user',
      steps: ['Sign in', `Open ${entity} Detail`, 'Edit and save', 'Confirm update on Dashboard'],
    },
  ];
  if (f.admin) journeys.push({ id: did('jrn', 'admin review'), name: 'Admin review', actor: 'Admin', steps: ['Sign in as admin', 'Open Admin Dashboard', 'Review users/records'] });

  return { screens: screens.slice(0, 14), userJourneys: journeys };
}
