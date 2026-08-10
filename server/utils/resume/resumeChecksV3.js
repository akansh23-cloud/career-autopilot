/* ============================================================
   RESUME CHECKS V3 — the deterministic Fix Center library
   ------------------------------------------------------------
   50+ named checks over the canonical ResumeDocument. Every
   finding: { id, severity, category, message, reason,
   recommendedAction, scoreImpact, fieldReference }.
   severity: critical | high | medium | low
   category: CONTACT | STRUCTURE | CONTENT | DATES | FORMATTING
             | TARGETING | PROJECT
   scoreImpact: estimated ATS-V3 points recoverable by fixing —
   derived from the same scoring rules, never invented.
   ============================================================ */
import { normalizeResumeDocument, collectBullets } from './resumeDocument.js';
import { validateDateRange, analyzeChronology } from './dateEngine.js';
import { findDuplicateBullets, techRepetition, readabilityIssuesForBullet } from './textQualityEngines.js';
import { detectVerbRepetition, detectTenseIssues } from './grammarLibrary.js';
import { canonicalSkill, toCanonicalSet } from './skillOntology.js';
import { skillPresent } from './skillMatcher.js';
import { resolveDictionary } from './roleDictionaries.js';

export const CHECKS_VERSION = 'resume-checks-v3';

const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const PHONE_DIGITS = (s) => String(s || '').replace(/\D/g, '');
const URLish = /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i;

function F(id, severity, category, message, reason, recommendedAction, scoreImpact = 0, fieldReference = null) {
  return { id, severity, category, message, reason, recommendedAction, scoreImpact, fieldReference };
}

export function runResumeChecks(doc, {
  targetRole = '', roleDict = null, experienceLevel = 'unknown',
  verifiedSkills = [], jdRequirements = null,
} = {}) {
  const d = normalizeResumeDocument(doc);
  const out = [];
  const bullets = collectBullets(d).filter((b) => b.enabled && b.text);
  const c = d.contact;

  /* ================= CONTACT ================= */
  if (!c.name) out.push(F('contact_missing_name', 'critical', 'CONTACT', 'No name on the resume.', 'ATS parsers key every application on the candidate name.', 'Add your full name in Contact.', 4, { section: 'contact', field: 'name' }));
  if (!c.email) out.push(F('contact_missing_email', 'critical', 'CONTACT', 'No email address.', 'Recruiters cannot respond without one.', 'Add a professional email.', 3, { section: 'contact', field: 'email' }));
  else if (!EMAIL_RE.test(c.email)) out.push(F('contact_malformed_email', 'high', 'CONTACT', `Email "${c.email}" is malformed.`, 'A typo here silently kills replies.', 'Fix the email format.', 3, { section: 'contact', field: 'email' }));
  if (c.phone && (PHONE_DIGITS(c.phone).length < 8 || PHONE_DIGITS(c.phone).length > 15)) out.push(F('contact_malformed_phone', 'medium', 'CONTACT', 'Phone number looks malformed.', 'Parsers expect 8–15 digits.', 'Use a standard format like +91 98765 43210.', 1, { section: 'contact', field: 'phone' }));
  if (c.linkedin && !/linkedin\.com\//i.test(c.linkedin)) out.push(F('contact_broken_linkedin', 'medium', 'CONTACT', 'LinkedIn value is not a linkedin.com URL.', 'Broken links waste a recruiter click.', 'Paste your full LinkedIn profile URL.', 1, { section: 'contact', field: 'linkedin' }));
  if (c.github && !/github\.com\//i.test(c.github)) out.push(F('contact_broken_github', 'medium', 'CONTACT', 'GitHub value is not a github.com URL.', 'Technical reviewers will try to open it.', 'Paste your full GitHub profile URL.', 1, { section: 'contact', field: 'github' }));
  if (c.portfolio && !URLish.test(c.portfolio)) out.push(F('contact_broken_portfolio', 'low', 'CONTACT', 'Portfolio link does not look like a URL.', 'Unclickable links are dead weight.', 'Use a full URL (https://…).', 0, { section: 'contact', field: 'portfolio' }));
  if (/\d{1,4}[,/].*(street|road|lane|nagar|colony|apartment|flat|house no)/i.test(c.location)) out.push(F('contact_excessive_address', 'low', 'CONTACT', 'Location contains a full street address.', 'City + region is the norm; full addresses add privacy risk, not signal.', 'Shorten to "City, State".', 0, { section: 'contact', field: 'location' }));

  /* ================= STRUCTURE ================= */
  const isStudent = ['fresher', 'junior', 'student'].includes(experienceLevel);
  const enabledExp = d.experience.filter((e) => e.enabled);
  const enabledProj = d.projects.filter((p) => p.enabled);
  if (!enabledExp.length && !isStudent) out.push(F('structure_missing_experience', 'high', 'STRUCTURE', 'No experience entries.', 'For experienced profiles this is the first section recruiters read.', 'Add your employment history.', 5, { section: 'experience' }));
  if (!enabledProj.length && isStudent) out.push(F('structure_missing_projects_student', 'high', 'STRUCTURE', 'No projects listed.', 'For students, projects ARE the evidence.', 'Add 2–3 projects — verified ones score highest.', 5, { section: 'projects' }));
  if (!d.education.some((e) => e.enabled)) out.push(F('structure_missing_education', isStudent ? 'high' : 'medium', 'STRUCTURE', 'No education section.', 'ATS parsers and campus filters expect it.', 'Add your degree and institution.', 3, { section: 'education' }));
  if (!d.skills.some((s) => s.enabled)) out.push(F('structure_missing_skills', 'high', 'STRUCTURE', 'No skills section.', 'Keyword matching starts here.', 'Add your core skills.', 4, { section: 'skills' }));
  if (!d.summary && !isStudent) out.push(F('structure_missing_summary', 'low', 'STRUCTURE', 'No professional summary.', 'A 2–3 line summary frames the whole document for a 6-second scan.', 'Add a short summary targeting your role.', 1, { section: 'summary' }));
  const orderIdx = (k) => d.sectionOrder.indexOf(k);
  if (isStudent && orderIdx('experience') >= 0 && orderIdx('education') > orderIdx('experience') && !enabledExp.length) {
    out.push(F('structure_order_student', 'low', 'STRUCTURE', 'Education sits below an empty Experience section.', 'Students lead with education and projects.', 'Move Education and Projects up.', 1, { section: 'sectionOrder' }));
  }
  const seen = new Set(); let dup = false;
  for (const k of d.sectionOrder) { if (seen.has(k)) dup = true; seen.add(k); }
  if (dup) out.push(F('structure_duplicate_sections', 'medium', 'STRUCTURE', 'Duplicate entries in section order.', 'Duplicated headings confuse parsers.', 'Remove the duplicate section.', 1, { section: 'sectionOrder' }));
  const enabledCustom = d.customSections.filter((s) => s.enabled).length;
  if (d.sectionOrder.length + enabledCustom > 11) out.push(F('structure_excessive_sections', 'low', 'STRUCTURE', 'More than 11 sections.', 'Fragmented resumes bury the strong content.', 'Merge or drop low-value sections.', 1, { section: 'sectionOrder' }));

  /* ================= CONTENT ================= */
  for (const b of bullets) {
    for (const iss of readabilityIssuesForBullet(b)) {
      const map = {
        bullet_too_long: ['content_bullet_too_long', 'medium', 1],
        bullet_too_short: ['content_bullet_too_short', 'low', 0],
        excessive_clauses: ['content_excessive_clauses', 'low', 0],
        first_person: ['content_first_person', 'medium', 1],
        weak_opener: ['content_weak_opener', 'medium', 1],
        filler_phrase: ['content_filler', 'low', 0],
        passive_voice: ['content_passive', 'low', 0],
        unexplained_acronyms: ['content_acronyms', 'low', 0],
        exclamation: ['content_exclamation', 'low', 0],
      };
      const m = map[iss.code];
      if (m) out.push(F(m[0], m[1], 'CONTENT', `${iss.detail}`, 'Deterministic readability rule.', 'Edit the bullet.', m[2], { section: b.section, itemId: b.itemId, bulletId: b.id }));
    }
  }
  const verbs = detectVerbRepetition(bullets, 3);
  for (const r of verbs.repeated.slice(0, 4)) {
    out.push(F('content_repeated_verb', 'medium', 'CONTENT', `"${r.verb}" opens ${r.count} bullets.`, 'Repeated openers read templated.', r.alternatives.length ? `Vary with: ${r.alternatives.slice(0, 3).join(', ')}.` : 'Vary the opening verbs.', 1, { section: 'content', verb: r.base }));
  }
  const dups = findDuplicateBullets(bullets);
  for (const e of dups.exact.slice(0, 5)) out.push(F('content_duplicate_bullet', 'high', 'CONTENT', `Duplicate bullet: "${String(e.b.text).slice(0, 70)}…"`, 'Identical bullets waste space and look careless.', 'Delete or differentiate one of them.', 2, { section: e.b.section, itemId: e.b.itemId, bulletId: e.b.id }));
  for (const n of dups.near.slice(0, 5)) out.push(F('content_near_duplicate_bullet', 'medium', 'CONTENT', `Two bullets are ${Math.round(n.similarity * 100)}% similar.`, 'Near-duplicates dilute impact.', 'Merge them into one stronger bullet.', 1, { section: n.b.section, itemId: n.b.itemId, bulletId: n.b.id }));
  const noMetric = bullets.filter((b) => !/\d/.test(b.text));
  if (bullets.length >= 3 && noMetric.length === bullets.length) out.push(F('content_no_metrics', 'high', 'CONTENT', 'No bullet carries a number.', 'Unquantified claims are unverifiable claims.', 'Open the Quantify prompts — never invent numbers.', 4, { section: 'content' }));
  else if (bullets.length >= 4 && noMetric.length / bullets.length > 0.75) out.push(F('content_few_metrics', 'medium', 'CONTENT', `Only ${bullets.length - noMetric.length} of ${bullets.length} bullets are quantified.`, 'Numbers are what recruiters remember.', 'Quantify the strongest bullets first.', 2, { section: 'content' }));
  for (const t of techRepetition(bullets)) out.push(F('content_tech_repetition', 'low', 'CONTENT', `"${t.tech}" appears ${t.count} times in bullets.`, 'Over-repeating one technology reads as stuffing.', 'Keep the strongest mentions.', 0, { section: 'content', tech: t.tech }));
  const enabledSkills = d.skills.filter((s) => s.enabled);
  if (enabledSkills.length > 35) out.push(F('content_excessive_skills', 'medium', 'CONTENT', `${enabledSkills.length} skills listed.`, 'A wall of skills signals none are deep.', 'Trim to the 15–25 that match your target.', 1, { section: 'skills' }));
  const skillNames = new Map();
  for (const s of enabledSkills) {
    const cn = canonicalSkill(s.name);
    if (skillNames.has(cn)) out.push(F('content_repeated_skill', 'low', 'CONTENT', `"${s.name}" duplicates "${skillNames.get(cn)}".`, 'Aliases of the same skill listed twice.', 'Keep one canonical entry.', 0, { section: 'skills', itemId: s.id }));
    else skillNames.set(cn, s.name);
  }
  for (const t of detectTenseIssues(bullets).slice(0, 5)) {
    out.push(F('content_tense_mismatch', 'low', 'CONTENT', `Tense mismatch: "${t.text.slice(0, 60)}" (${t.actual} in a ${t.expected === 'past' ? 'completed' : 'current'} role).`, 'Past roles use past tense; current roles present.', `Suggested: "${t.suggestion.slice(0, 70)}".`, 0, { section: t.section, itemId: t.itemId, bulletId: t.bulletId }));
  }

  /* ================= DATES ================= */
  const dated = [
    ...d.experience.filter((e) => e.enabled).map((e) => ({ id: e.id, label: e.role || e.company, startDate: e.startDate, endDate: e.endDate, current: e.current })),
    ...d.education.filter((e) => e.enabled).map((e) => ({ id: e.id, label: e.school, startDate: e.startDate, endDate: e.endDate })),
  ];
  const chrono = analyzeChronology(dated);
  const dateSeverity = { malformed_start: 'medium', malformed_end: 'medium', end_before_start: 'high', implausible_start_year: 'medium', implausible_end_year: 'medium', chronology_order: 'medium', overlapping_roles: 'low', inconsistent_date_format: 'low' };
  for (const iss of chrono.issues) {
    out.push(F(`dates_${iss.code}`, dateSeverity[iss.code] || 'low', 'DATES', iss.message, 'Deterministic date validation.', 'Correct the date.', iss.code === 'end_before_start' ? 2 : 1, iss.itemId ? { itemId: iss.itemId } : { section: 'dates' }));
  }
  for (const e of d.experience.filter((x) => x.enabled)) {
    if (!e.startDate && !e.dates) out.push(F('dates_missing_experience_dates', 'medium', 'DATES', `"${e.role || e.company}" has no dates.`, 'Undated roles look like gaps being hidden.', 'Add start and end dates.', 1, { section: 'experience', itemId: e.id }));
  }

  /* ================= FORMATTING (document-level flags) ============ */
  if (d.density === 'tight') out.push(F('formatting_tight_density', 'low', 'FORMATTING', 'Density is at the tightest setting.', 'Tight line spacing hurts skim-reading.', 'Use Compact unless content truly requires Tight.', 0, { section: 'styling' }));
  const totalBullets = bullets.length;
  if (totalBullets > 45) out.push(F('formatting_excessive_line_density', 'medium', 'FORMATTING', `${totalBullets} bullets in total.`, 'Beyond ~40 bullets nothing stands out.', 'Prune to the strongest evidence per role.', 1, { section: 'content' }));

  /* ================= TARGETING ================= */
  const vSet = toCanonicalSet(verifiedSkills);
  const dictResolved = roleDict || (targetRole ? resolveDictionary(targetRole).dict : null);
  const targetDocText = bullets.map((b) => b.text).join('\n') + '\n' + enabledSkills.map((s) => s.name).join(', ');
  /* FREE WINS: ANY verified skill absent from the resume — verified evidence
     the platform holds that the resume never uses. Scanned independently of
     the role dictionary so a verified Terraform never goes unnoticed on a
     data-engineer resume. */
  const flaggedFreeWin = new Set();
  for (const raw of verifiedSkills) {
    const k = String(raw || '').trim();
    if (!k || skillPresent(targetDocText, k)) continue;
    const cn = canonicalSkill(k);
    if (flaggedFreeWin.has(cn)) continue;
    flaggedFreeWin.add(cn);
    out.push(F('targeting_verified_skill_absent', 'high', 'TARGETING',
      `${k} is VERIFIED but nowhere on this resume.`,
      'You already hold proof — this is a free win.',
      `Add your verified ${k} evidence to a project or bullet.`,
      3, { section: 'targeting', skill: k }));
    if (flaggedFreeWin.size >= 5) break;
  }
  if (targetRole && dictResolved) {
    const docText = targetDocText;
    const must = (dictResolved.mustHave || []).filter((k) => !flaggedFreeWin.has(canonicalSkill(k)));
    const missingMust = must.filter((k) => !skillPresent(docText, k));
    for (const k of missingMust.slice(0, 5)) {
      out.push(F(
        'targeting_critical_skill_missing', 'medium', 'TARGETING',
        `${targetRole} requires ${k}; the resume never mentions it.`,
        'Missing must-have keywords sink role matching.',
        `If you have real ${k} experience add it; otherwise build evidence via Project OS.`,
        2, { section: 'targeting', skill: k },
      ));
    }
    const declaredOnly = enabledSkills.filter((s) => {
      const cn = canonicalSkill(s.name);
      return must.some((k) => canonicalSkill(k) === cn) && s.status !== 'VERIFIED' &&
        !bullets.some((b) => skillPresent(b.text, s.name));
    });
    for (const s of declaredOnly.slice(0, 3)) out.push(F('targeting_skill_only_declared', 'medium', 'TARGETING', `${s.name} is required by ${targetRole} but only listed, never evidenced.`, 'Declared-only must-haves get discounted by evidence-aware screens.', `Show ${s.name} in use inside a project or role bullet, or build verified evidence.`, 2, { section: 'skills', itemId: s.id }));
  }
  if (jdRequirements && Array.isArray(jdRequirements.required)) {
    const docText = bullets.map((b) => b.text).join('\n') + '\n' + enabledSkills.map((s) => s.name).join(', ');
    const missing = jdRequirements.required.filter((k) => !skillPresent(docText, k)).slice(0, 4);
    for (const k of missing) out.push(F('targeting_jd_skill_missing', 'high', 'TARGETING', `The job description requires ${k}.`, 'Required-JD keywords carry the most match weight.', vSet.has(canonicalSkill(k)) ? `You have verified ${k} — add it.` : `Add real ${k} experience or build evidence first.`, 3, { section: 'targeting', skill: k }));
  }

  /* ================= PROJECT QUALITY ================= */
  for (const p of enabledProj) {
    if (!p.bullets.some((b) => b.enabled && b.text)) out.push(F('project_missing_description', 'medium', 'PROJECT', `Project "${p.name}" has no bullets.`, 'A bare project name proves nothing.', 'Add 2–3 outcome bullets.', 1, { section: 'projects', itemId: p.id }));
    if (!p.techStack) out.push(F('project_missing_technologies', 'medium', 'PROJECT', `Project "${p.name}" lists no technologies.`, 'Tech stack is the first thing screeners scan on a project.', 'Add the stack used.', 1, { section: 'projects', itemId: p.id }));
    const hasOutcome = p.bullets.some((b) => /\d|reduc|improv|increas|launch|deploy|deliver|serv/i.test(b.text));
    if (p.bullets.length && !hasOutcome) out.push(F('project_missing_outcome', 'low', 'PROJECT', `Project "${p.name}" describes activity but no outcome.`, 'Outcomes separate projects from tutorials.', 'State what the project achieved or handles.', 1, { section: 'projects', itemId: p.id }));
    if (!p.verified && !p.evidenceIds.length && isStudent) out.push(F('project_missing_evidence', 'low', 'PROJECT', `Project "${p.name}" carries no verified evidence.`, 'Verified projects rank above claims everywhere in Career Autopilot.', 'Submit it for verification in Project OS.', 1, { section: 'projects', itemId: p.id }));
  }

  return { version: CHECKS_VERSION, checks: out };
}

/* Fix Center grouping — Critical / High Impact / Improvement / Formatting. */
export function groupChecksForFixCenter(checks = []) {
  const groups = { critical: [], highImpact: [], improvement: [], formatting: [] };
  for (const ch of checks) {
    if (ch.severity === 'critical') groups.critical.push(ch);
    else if (ch.severity === 'high') groups.highImpact.push(ch);
    else if (ch.category === 'FORMATTING') groups.formatting.push(ch);
    else groups.improvement.push(ch);
  }
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => (b.scoreImpact - a.scoreImpact) || a.id.localeCompare(b.id));
  return groups;
}

export default { CHECKS_VERSION, runResumeChecks, groupChecksForFixCenter };
