/* ============================================================
   PLACEMENT-CELL: STUDENT RESUME + PER-ASSIGNEE TASK PROGRESS
   ------------------------------------------------------------
   Two gaps this covers:
   1. The resume snapshot was stored on UserState.resume and
      already SELECTed by the detail query — then discarded. The
      cell saw a resume SCORE for every student and could never
      read the resume.
   2. /api/college/tasks returned COUNTS only. "4 assigned, 0
      done" with no way to learn which four students.

   Runs in DEMO_MODE against the real routes (no database), which
   is also how the demo deployment in the screenshots runs.
   ============================================================ */
process.env.DEMO_MODE = '1';
process.env.ADMIN_EMAILS = 'college-admin@careerautopilot.local';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeClient } from './helpers.js';
import * as demo from '../server/utils/demoCollegeData.js';

let server, base, tpo;
const ADMIN = 'college-admin@careerautopilot.local';

before(async () => {
  ({ server, base } = await startServer());
  tpo = makeClient(base);
  await tpo.devLogin('Placement Officer', ADMIN);
});
after(async () => { await stopServer(server); });

const anyStudentId = () => demo.demoStudents({})[0].id;

/* ---------------- student profile shape ---------------- */

test('the student profile returns a usable identity (demo shape matched the DB shape)', async () => {
  // Regression: demoStudentDetail returned { student: {...}, ... } while the DB
  // path returns those fields FLAT. The route spreads whatever it gets, so the
  // drill-down header rendered a blank name and a blank email in demo mode.
  const r = await tpo.get(`/api/college/students/${anyStudentId()}/detail`);
  assert.equal(r.status, 200);
  const s = r.json.student;
  assert.ok(s.name && s.name.length > 0, 'name must be present at the top level');
  assert.ok(s.email && s.email.includes('@'), 'email must be present at the top level');
  assert.ok(Array.isArray(s.projects) && Array.isArray(s.skillLedger));
  // Field-name contract: the UI reads r.skill and a.text / a.at.
  if (s.skillLedger.length) assert.ok('skill' in s.skillLedger[0], 'skill ledger rows must expose `skill`');
  if (s.activity.length) {
    assert.ok(typeof s.activity[0].text === 'string' && s.activity[0].text.length > 0, 'activity rows must expose `text`');
    assert.ok(s.activity[0].at, 'activity rows must expose `at`');
  }
  if (s.resumeHistory.length) assert.ok(s.resumeHistory[0].at, 'resume history rows must expose `at`');
});

test('the student profile carries resume metadata', async () => {
  const r = await tpo.get(`/api/college/students/${anyStudentId()}/detail`);
  const resume = r.json.student.resume;
  assert.ok(resume, 'resume metadata must be present (it was previously dropped)');
  assert.equal(typeof resume.available, 'boolean');
  assert.ok('score' in resume && 'fileName' in resume && 'characters' in resume);
  // Metadata only — the full text belongs to the dedicated endpoint so a
  // drill-down does not ship an entire resume on every click.
  assert.ok(!('text' in resume), 'the detail payload must not embed the full resume text');
});

/* ---------------- resume read + download ---------------- */

test('a placement officer can read a student resume', async () => {
  const r = await tpo.get(`/api/college/students/${anyStudentId()}/resume`);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  const resume = r.json.resume;
  assert.ok(resume.studentName && resume.studentEmail);
  if (resume.available) {
    assert.ok(resume.text.length > 0, 'an available resume must carry text');
    assert.equal(resume.characters, resume.text.length);
  }
});

test('the resume downloads as an attachment with a safe filename and real content', async () => {
  const id = demo.demoStudents({}).find((s) => s.resumeScore != null).id;
  // Uses the cookie-jar client so the session is genuinely carried — an
  // unauthenticated fetch would 401 and silently prove nothing.
  const res = await tpo.get(`/api/college/students/${id}/resume?download=1`);
  assert.equal(res.status, 200, 'the authenticated officer must get the file');
  assert.match(res.headers.get('content-type') || '', /text\/plain/);
  assert.equal(res.headers.get('cache-control'), 'no-store', 'a resume must not be cached by intermediaries');

  const disposition = res.headers.get('content-disposition') || '';
  assert.match(disposition, /attachment; filename="/, 'must download, not render inline');
  const name = disposition.match(/filename="([^"]+)"/)[1];
  assert.match(name, /\.txt$/, 'served as .txt — the original PDF is never stored server-side');
  assert.ok(!/[/\\"\r\n]/.test(name), 'filename must not contain path or header-breaking characters');

  // The body must be the actual resume, with the provenance header attached.
  assert.ok(res.text.length > 100, 'the download must carry real content');
  assert.match(res.text, /Extracted text as submitted by the student/, 'provenance must be stated in the artefact');
  const source = demo.demoStudentResume(id);
  assert.ok(res.text.includes(source.text.split('\n')[0]), 'the body must contain the student resume text');
});

test('a resume filename built from a hostile student name cannot break the header', async () => {
  // The filename is derived from attacker-controlled input (the student's own
  // name / uploaded filename), so the sanitiser is asserted directly.
  const sanitise = (raw) => String(raw || 'student-resume')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^\w.\- ]+/g, '_')
    .slice(0, 80)
    .trim() || 'student-resume';
  for (const hostile of [
    'evil"; filename="passwd',
    '../../../etc/passwd.pdf',
    'name\r\nSet-Cookie: admin=1',
    '<script>alert(1)</script>.docx',
  ]) {
    const out = sanitise(hostile);
    assert.ok(!/["\r\n]/.test(out), `quote/CRLF survived sanitising: ${out}`);
    assert.ok(!out.includes('/') && !out.includes('\\'), `path separator survived: ${out}`);
  }
});

test('a student with no resume returns a clear 404, not an empty file', async () => {
  const none = demo.demoStudents({}).find((s) => s.resumeScore == null);
  if (!none) return; // cohort happens to have full coverage
  const r = await tpo.get(`/api/college/students/${none.id}/resume?download=1`);
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'no_resume_on_file');
  assert.ok(r.json.message.length > 0, 'must say why, not just 404');
});

test('resume access is refused for a student outside the caller college', async () => {
  const r = await tpo.get('/api/college/students/000000000000000000000000/resume');
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'not_found_or_out_of_scope');
});

test('an ordinary student cannot read another student resume', async () => {
  const student = makeClient(base);
  await student.devLogin('Regular Student', 'plain-student@example.com');
  const r = await student.get(`/api/college/students/${anyStudentId()}/resume`);
  assert.ok(r.status === 401 || r.status === 403, `expected auth rejection, got ${r.status}`);
});

/* ---------------- per-assignee task progress ---------------- */

test('a task reports WHO it was assigned to, not just how many', async () => {
  const list = await tpo.get('/api/college/tasks');
  assert.equal(list.status, 200);
  const task = list.json.tasks[0];
  assert.ok(task, 'demo mode must expose at least one task');

  const r = await tpo.get(`/api/college/tasks/${task.id}/assignees`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.assignees) && r.json.assignees.length > 0);
  const a = r.json.assignees[0];
  for (const field of ['studentId', 'name', 'email', 'status', 'done', 'overdue']) {
    assert.ok(field in a, `assignee rows must expose ${field}`);
  }
});

test('assignee counts reconcile exactly with the task roll-up', async () => {
  // A detail view that disagrees with the summary above it destroys trust in
  // both numbers, so this is asserted rather than assumed.
  const list = await tpo.get('/api/college/tasks');
  for (const task of list.json.tasks) {
    const r = await tpo.get(`/api/college/tasks/${task.id}/assignees`);
    assert.equal(r.json.assigned, task.assigned, `${task.title}: assigned count mismatch`);
    assert.equal(r.json.done, task.done, `${task.title}: done count mismatch`);
    assert.equal(r.json.assignees.filter((a) => a.done).length, task.done, `${task.title}: done rows mismatch`);
    assert.equal(r.json.assignees.length, task.assigned, `${task.title}: row count mismatch`);
  }
});

test('pending assignees sort first so the chase list is on top', async () => {
  const list = await tpo.get('/api/college/tasks');
  const partial = list.json.tasks.find((t) => t.done > 0 && t.done < t.assigned);
  assert.ok(partial, 'need a partially-complete task for this check');
  const r = await tpo.get(`/api/college/tasks/${partial.id}/assignees`);
  const firstDoneIndex = r.json.assignees.findIndex((a) => a.done);
  const lastPendingIndex = r.json.assignees.map((a) => a.done).lastIndexOf(false);
  assert.ok(firstDoneIndex > lastPendingIndex, 'all pending students must sort above completed ones');
});

test('a student profile lists that student own assigned work with per-task status', async () => {
  const list = await tpo.get('/api/college/tasks');
  const roster = await tpo.get(`/api/college/tasks/${list.json.tasks[0].id}/assignees`);
  const target = roster.json.assignees[0];

  const r = await tpo.get(`/api/college/students/${target.studentId}/detail`);
  assert.equal(r.status, 200);
  const tasks = r.json.student.assignedTasks;
  assert.ok(Array.isArray(tasks) && tasks.length > 0, 'the profile must list assigned work');
  assert.ok(tasks.some((t) => t.id === list.json.tasks[0].id), 'the task we came from must appear');

  const summary = r.json.student.taskSummary;
  assert.equal(summary.assigned, tasks.length);
  assert.equal(summary.done, tasks.filter((t) => t.done).length);
  assert.equal(summary.overdue, tasks.filter((t) => t.overdue).length);
  assert.equal(summary.completionRate, Math.round((summary.done / summary.assigned) * 100));
});

test('per-student task status agrees with the task roster it came from', async () => {
  const list = await tpo.get('/api/college/tasks');
  const task = list.json.tasks.find((t) => t.done > 0 && t.done < t.assigned);
  const roster = await tpo.get(`/api/college/tasks/${task.id}/assignees`);
  const done = roster.json.assignees.find((a) => a.done);
  const pending = roster.json.assignees.find((a) => !a.done);

  for (const [who, expectDone] of [[done, true], [pending, false]]) {
    const d = await tpo.get(`/api/college/students/${who.studentId}/detail`);
    const mine = d.json.student.assignedTasks.find((t) => t.id === task.id);
    assert.ok(mine, `${who.name} should see task ${task.title} on their profile`);
    assert.equal(mine.done, expectDone, `${who.name}: status must match the roster`);
  }
});

test('a task outside the caller college does not resolve', async () => {
  const r = await tpo.get('/api/college/tasks/000000000000000000000000/assignees');
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'not_found_or_out_of_scope');
});

test('an ordinary student cannot list a task roster', async () => {
  const student = makeClient(base);
  await student.devLogin('Nosy Student', 'nosy-student@example.com');
  const r = await student.get('/api/college/tasks/demo_task_1/assignees');
  assert.ok(r.status === 401 || r.status === 403, `expected auth rejection, got ${r.status}`);
});
