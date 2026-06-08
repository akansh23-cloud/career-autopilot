/* ============================================================
   APPLICATION PACKAGE GENERATOR  (deterministic-first)
   ------------------------------------------------------------
   For a matched job, assemble a complete application package:
   tailored resume, cover letter, recruiter email, LinkedIn message,
   referral request, follow-up, and interview talking points.

   Uses resume facts + parsed JD + the user's VERIFIED skills/projects only.
   Never fabricates: missing skills are surfaced as suggestions, the resume
   tailoring goes through the existing fabrication checker, and the written
   pieces only reference skills the resume actually proves. No AI required
   (AI in the route may enrich tone only; it can never invent facts).
   ============================================================ */
import { parseJD } from './resume/jdParser.js';
import { computeJobFit } from './resume/jobFitEngine.js';
import { tailorResume } from './resume/tailoringEngine.js';
import { checkFabrication } from './resume/fabricationChecker.js';
import { normalizeResumeText } from './resume/normalizeResumeText.js';
import { presentSkills } from './resume/skillMatcher.js';

export const PACKAGE_VERSION = 'app-package-v1';

function pick(arr, n) { return (arr || []).slice(0, n); }
function nameFrom(resumeText) {
  const first = String(resumeText || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  // Use the first non-empty line as a likely name if it's short and word-like.
  return /^[a-z .'-]{2,40}$/i.test(first) && first.split(/\s+/).length <= 4 ? first : 'Candidate';
}

export function generateApplicationPackage({ resumeText = '', jobDescription = '', targetRole = '', verifiedSkills = [], verifiedProjects = [], applicantName = '' } = {}) {
  const jd = parseJD({ jobDescription, targetRole });
  const role = jd.jobTitle || targetRole || 'the role';
  const company = jd.company || 'your company';
  const name = applicantName || nameFrom(resumeText);

  // Tailor resume (safe, fact-preserving) + verify no fabrication.
  const tailored = tailorResume({ resumeText, jd, targetRole, mode: 'balanced' });
  const fit = computeJobFit({ resumeText: tailored.tailoredResume.text, jd });
  const fabrication = checkFabrication({ originalResume: resumeText, tailoredResume: tailored.tailoredResume.text });

  // Only reference skills the resume actually proves AND that match the JD.
  const norm = normalizeResumeText(resumeText);
  const jdSkills = Array.from(new Set([...(jd.requiredSkills || []), ...(jd.preferredSkills || [])]));
  const provenJdSkills = presentSkills(norm, jdSkills);
  // Prefer verified skills among those.
  const vset = new Set((verifiedSkills || []).map((s) => String(s).toLowerCase()));
  const verifiedMatched = provenJdSkills.filter((s) => vset.has(String(s).toLowerCase()));
  const highlightSkills = pick(verifiedMatched.length ? verifiedMatched : provenJdSkills, 5);
  const projectNames = pick((verifiedProjects || []).map((p) => (typeof p === 'string' ? p : (p.title || p.patentTitle))).filter(Boolean), 3);

  const skillsLine = highlightSkills.length ? highlightSkills.join(', ') : (jd.requiredSkills || []).slice(0, 3).join(', ') || 'the core requirements';
  const projLine = projectNames.length ? ` I've shipped verified work including ${projectNames.join(', ')}.` : '';
  const missingNote = (jd.requiredSkills || []).filter((s) => !provenJdSkills.includes(s));

  const coverLetter =
`Dear Hiring Team at ${company},

I'm excited to apply for the ${role} position. My background lines up closely with what you're looking for, particularly in ${skillsLine}.${projLine}

I focus on shipping real, measurable outcomes and documenting them so the impact is verifiable. I'd welcome the chance to bring that same rigor to ${company} and contribute to your team's goals.

Thank you for your consideration — I'd love to discuss how I can help.

Best regards,
${name}`;

  const recruiterEmail = {
    subject: `Application: ${role}${company !== 'your company' ? ` at ${company}` : ''}`,
    body:
`Hi,

I'd like to apply for the ${role} role. My strongest, evidence-backed strengths for this position are ${skillsLine}.${projLine}

I've attached a tailored resume. I'd be glad to walk through specific examples on a quick call.

Thanks for your time,
${name}`,
  };

  const linkedinMessage =
`Hi — I noticed the ${role} opening${company !== 'your company' ? ` at ${company}` : ''} and I'm genuinely interested. My background in ${skillsLine} maps well to it.${projLine} Would you be open to a short chat about the role?`;

  const referralRequest =
`Hi [Name],

I'm applying for the ${role} role${company !== 'your company' ? ` at ${company}` : ''} and saw you're connected there. My most relevant, proven strengths are ${skillsLine}.${projLine} If you feel comfortable, a referral would mean a lot — happy to send my resume and a short blurb to make it easy. No worries either way!

Thanks,
${name}`;

  const followUp =
`Hi,

Following up on my application for the ${role} role. I remain very interested and would welcome the chance to discuss how my experience in ${skillsLine} could help your team. Happy to share more detail or examples at your convenience.

Thank you,
${name}`;

  const interviewTalkingPoints = [
    `Why you're a fit: connect ${skillsLine} directly to the role's responsibilities.`,
    projectNames.length ? `Walk through ${projectNames[0]}: problem, your contribution, and the measurable result.` : 'Have one project ready: problem, your contribution, and the measurable result.',
    'A hard technical problem you solved — symptom, diagnosis, fix, verification.',
    'A question that shows you understand the company/role context.',
    ...(missingNote.length ? [`Be ready to address gaps honestly: ${missingNote.slice(0, 3).join(', ')} — show how you'd ramp quickly.`] : []),
  ];

  return {
    packageVersion: PACKAGE_VERSION,
    jd,
    role,
    company,
    jobFitScore: fit.score,
    jobFitBreakdown: fit.breakdown,
    tailoredResume: tailored.tailoredResume,
    tailoringChangeLog: tailored.changeLog,
    fabricationSafe: fabrication.safe,
    fabricationRisks: fabrication.risks,
    integrityScore: fabrication.integrityScore,
    highlightSkills,
    usedVerifiedSkills: verifiedMatched,
    missingRequiredSkills: missingNote,
    documents: {
      coverLetter,
      recruiterEmail,
      linkedinMessage,
      referralRequest,
      followUp,
      interviewTalkingPoints,
    },
  };
}

export default { generateApplicationPackage, PACKAGE_VERSION };
