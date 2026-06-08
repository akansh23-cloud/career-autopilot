/* Deterministic, no-AI feedback derived purely from the score breakdown.
   Used as the always-available fallback so analysis NEVER fails when AI is
   unavailable. The AI explanation (when present) is layered on top in the
   route, but it can never change the score. */
export function buildFeedback(d, scoredRole) {
  const b = d.breakdown;
  const grade = d.score >= 80 ? 'strong' : d.score >= 60 ? 'solid but improvable' : 'needs work';
  const strengths = [];
  if (b.roleKeywordMatch >= 13) strengths.push(`Good coverage of ${scoredRole} keywords — ${d.matchedKeywords.length} relevant terms detected.`);
  if (b.contactInfo >= 6) strengths.push('Contact details are complete and ATS-readable.');
  if (b.quantifiedImpact >= 6) strengths.push('Achievements are quantified with measurable impact.');
  if (b.atsParseability >= 12) strengths.push('Resume text parses cleanly for ATS systems.');
  if ((d.skillEvidence || []).some((e) => e.evidenced)) strengths.push('Key skills are backed by experience/project evidence, not just listed.');
  if (!strengths.length) strengths.push('Resume was parsed successfully; build on the structure below.');

  const improvements = [];
  if (b.roleKeywordMatch < 13) improvements.push(`Add more ${scoredRole} keywords — currently missing: ${d.missingKeywords.slice(0, 6).join(', ') || 'role-specific terms'}.`);
  if (b.quantifiedImpact < 6) improvements.push('Quantify achievements with numbers, %, time or cost saved (e.g. "reduced build time by 30%").');
  if (b.sectionCompleteness < 9) improvements.push('Add or clearly label standard sections (Summary, Skills, Experience, Projects, Education).');
  if (b.experienceRelevance < 9) improvements.push('Use stronger role-specific action verbs and describe outcomes, not just tasks.');
  if (b.readability < 4) improvements.push('Use concise bullet points; avoid long paragraphs and buzzword padding.');
  if (b.contactInfo < 6) improvements.push('Add missing contact items (email, phone, LinkedIn, GitHub/portfolio).');
  if ((b.antiKeywordStuffing || 0) < 0) improvements.push('Reduce keyword stuffing — move listed skills into bullet points that show how you used them.');
  if (!improvements.length) improvements.push('Polish wording for clarity and tailor bullets to the target role.');

  return {
    summary: `Scored ${d.score}/100 for ${scoredRole} — a ${grade} match based on keywords, skills, evidence and structure.`,
    strengths,
    improvements,
  };
}

export default { buildFeedback };
