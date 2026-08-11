/* ============================================================
   TEMPLATE RECOMMENDER — Resume OS V4
   ------------------------------------------------------------
   Ranks templates for a specific document + target with an
   explainable, deterministic score (0–100). Content Engine
   decides WHAT goes on the resume; this only decides HOW it
   is presented. Never filters by license here beyond
   productionEnabled — legal state lives in metadata.
   ============================================================ */
import { normalizeResumeDocument, collectBullets } from './resumeDocument.js';
import { resolveDictionary } from './roleDictionaries.js';
import { detectCareerStage as detectCareerStageCanonical, normalizeCareerStages, careerStageDistance } from './careerStage.js';

export const TEMPLATE_RECOMMENDER_VERSION = 'template-recommender-v2-career-stage';

const ROLE_TO_CATEGORY = [
  [/devops|sre|platform|cloud|infra/i, ['tech', 'ats-strict']],
  [/data engineer|etl|analytics engineer|data platform/i, ['tech', 'ats-strict']],
  [/data scientist|ml|machine learning/i, ['tech', 'professional']],
  [/security|cyber/i, ['tech', 'ats-strict']],
  [/frontend|backend|full ?stack|software|developer|engineer/i, ['tech', 'ats-strict']],
  [/manager|director|vp|head|lead|executive|cto|cio/i, ['executive', 'professional']],
  [/consult|finance|analyst|product manager|operations|sales|marketing|business/i, ['professional']],
  [/student|intern|fresher|graduate|campus/i, ['student']],
];

export function detectCareerStage(doc, opts = {}) {
  return detectCareerStageCanonical(doc, opts);
}

export function contentShape(doc) {
  const d = normalizeResumeDocument(doc);
  const bullets = collectBullets(d).filter((b) => b.enabled && b.text);
  return {
    bulletCount: bullets.length,
    skillCount: d.skills.filter((s) => s.enabled).length,
    projectCount: d.projects.filter((p) => p.enabled).length,
    certCount: d.certifications.filter((c) => c.enabled).length,
    experienceCount: d.experience.filter((e) => e.enabled).length,
    dense: bullets.length >= 18 || d.skills.filter((s) => s.enabled).length >= 20,
  };
}

export function rankTemplates(templates, doc, {
  targetRole = '', atsPreference = 'high', pageTarget = 1,
} = {}) {
  const d = normalizeResumeDocument(doc);
  const role = targetRole || d.targetRole || '';
  const { name: roleName } = resolveDictionary(role);
  const stage = detectCareerStage(d, { targetRole: role });
  const shape = contentShape(d);
  const preferredCats = ROLE_TO_CATEGORY.find(([re]) => re.test(role))?.[1]
    || (stage === 'student' ? ['student', 'ats-strict'] : ['professional', 'ats-strict']);

  const ranked = templates
    .filter((t) => t.license?.productionEnabled !== false)
    .map((t) => {
      let score = 50;
      const reasons = [];
      const add = (n, why) => { score += n; reasons.push(`${n > 0 ? '+' : ''}${n} ${why}`); };

      /* role / category fit */
      const catIdx = preferredCats.indexOf(t.category);
      if (catIdx === 0) add(22, `${t.category} templates fit ${roleName || 'this role'} best`);
      else if (catIdx > 0) add(14, `${t.category} is a strong secondary fit for ${roleName || 'the role'}`);
      else if (t.category === 'ats-strict') add(8, 'ATS-strict is a safe fit for any role');
      else add(-6, `${t.category} styling is aimed at a different audience`);
      if (Array.isArray(t.supportedRoles) && t.supportedRoles.some((r) => role.toLowerCase().includes(r))) {
        add(8, 'template explicitly targets this role family');
      }

      /* career stage — historical labels such as `professional` normalize to
         the same canonical vocabulary used by Template OS. Adjacent stages are
         still viable; distant mismatches are penalized instead of treated as
         an unexplained exact miss. */
      const templateStages = normalizeCareerStages(t.careerStages || []);
      if (templateStages.length) {
        const distance = Math.min(...templateStages.map((x) => careerStageDistance(x, stage)));
        if (distance === 0) add(8, `designed for ${stage} candidates`);
        else if (distance === 1) add(3, `adjacent career-stage fit (${templateStages.join('/')})`);
        else add(-6, `career-stage fit is distant from ${stage}`);
      }
      if (stage === 'student' && t.category === 'executive') add(-18, 'executive layout on a student profile reads as padding');
      if ((stage === 'senior' || stage === 'executive') && t.category === 'student') add(-14, 'student layout under-sells senior experience');
      if (stage === 'executive' && t.category === 'executive') add(5, 'leadership layout matches executive-level positioning');

      /* ATS preference */
      if (atsPreference === 'very-high') {
        if (t.strictAts) add(12, 'strict-ATS layout matches the requested safety level');
        else if (t.atsSafe === false) add(-20, 'design-forward layout conflicts with a very-high ATS preference');
      } else if (atsPreference === 'high') {
        if (t.atsSafe !== false) add(6, 'ATS-safe single-flow layout');
        else add(-10, 'visual layout carries parse risk');
      }
      if (t.certification?.certified) add(6, 'earned ATS-Checked certification (render→parse round-trip)');

      /* content volume vs layout */
      if (shape.dense && t.category === 'executive') add(-4, 'dense technical content crowds an executive layout');
      if (shape.projectCount >= 3 && (t.category === 'student' || t.category === 'tech')) add(4, 'project-forward layout suits the project count');
      if (shape.certCount >= 4 && t.category !== 'executive') add(2, 'room for the certification list');
      if (pageTarget === 1 && shape.dense && t.category === 'executive') add(-3, 'unlikely to hold this volume on one page');

      return { id: t.id, name: t.name, category: t.category, templateVersion: Number(t.templateVersion || t.definition?.version || 1), score: Math.max(0, Math.min(100, Math.round(score))), reasons, strictAts: !!t.strictAts };
    })
    .sort((a, b) => b.score - a.score);

  return {
    version: TEMPLATE_RECOMMENDER_VERSION,
    stage, roleName: roleName || role, shape,
    ranked,
    best: ranked[0] || null,
  };
}

export default { TEMPLATE_RECOMMENDER_VERSION, rankTemplates, detectCareerStage, contentShape };
