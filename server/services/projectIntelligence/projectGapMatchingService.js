/* ============================================================
   Task 1 — Project Gap Matching Engine
   ------------------------------------------------------------
   Deterministic, AI-optional. Analyses the user's profile and
   recommends projects that close REAL gaps:
     • target-role skill gaps
     • resume gaps
     • verified-vs-claimed skill gaps (claimed but unproven)
     • GitHub proof gaps
     • saved/applied job requirement gaps
   It explains WHY each project is the best next move, which gap
   it fixes, which role it supports and what proof it creates.
   Existing projects + innovation clusters are used to avoid
   recommending duplicates and to surface innovation-grade work.
   ============================================================ */
import { asList, lc, uniq, clamp, fingerprint, textSimilarity } from './util.js';
import { roleFamilyFor, GENERIC_FAMILY } from './config.js';

const norm = (s) => lc(s).trim();
const overlaps = (a, b) => { const x = norm(a), y = norm(b); return x === y || (x.length > 2 && (x.includes(y) || y.includes(x))); };
const inList = (skill, list) => (list || []).some((s) => overlaps(skill, s));

/* Normalise the many possible input shapes into clean signal sets. */
export function normalizeProfileSignals(input = {}) {
  const targetRole = String(input.targetRole || input.userProfile?.targetRole || '').trim() || 'Software Engineer';
  const verifiedSkills = uniq(asList(input.verifiedSkills).concat(asList(input.userProfile?.verifiedSkills)));
  const claimedSkills = uniq(
    asList(input.claimedSkills)
      .concat(asList(input.userProfile?.skills))
      .concat(asList(input.resumeAnalysis?.matchedSkills))
      .concat(asList(input.resumeAnalysis?.presentSkills)),
  );
  const resumeGaps = uniq(
    asList(input.resumeAnalysis?.missingSkills)
      .concat(asList(input.resumeAnalysis?.gaps))
      .concat(asList(input.resumeAnalysis?.skillGaps)),
  );
  const savedJobs = (Array.isArray(input.savedJobs) ? input.savedJobs : [input.savedJobs]).filter(Boolean).map((j) => ({
    title: j.title || '', company: j.company || '', text: `${j.title || ''} ${j.description || j.snippet || ''}`.trim(),
    skills: uniq(asList(j.requiredSkills).concat(extractJobSkills(`${j.title || ''} ${j.description || j.snippet || ''}`))),
  }));
  const githubProof = {
    repoCount: Number(input.githubProof?.repoCount || 0),
    provenSkills: uniq(asList(input.githubProof?.provenSkills)),
    hasCI: !!input.githubProof?.hasCI,
    hasTests: !!input.githubProof?.hasTests,
    hasDeployment: !!input.githubProof?.hasDeployment,
  };
  const existingProjects = (input.existingProjects || []).map((p) => ({
    title: p.title || '', skills: uniq(asList(p.skillsCovered).concat(asList(p.skills))),
    problem: p.problemStatement || p.summary || '', techStack: asList(p.techStack),
  }));
  const patentInnovationClusters = (input.patentInnovationClusters || []).map((c) => ({
    id: c.id || c.clusterId || fingerprint(c.title || ''),
    title: c.title || '', summary: c.summary || c.painPoint || '',
    skills: uniq(asList(c.keywords).concat(asList(c.skills))),
    patentPotentialScore: Number(c.patentPotentialScore || c.ipReadiness?.overall || c.score || 0),
  }));
  return { targetRole, verifiedSkills, claimedSkills, resumeGaps, savedJobs, githubProof, existingProjects, patentInnovationClusters };
}

/* Deterministic skill extraction from free job text. */
const KNOWN_SKILLS = ['React', 'Node.js', 'Express', 'TypeScript', 'JavaScript', 'Python', 'Java', 'Go', 'AWS', 'Azure', 'GCP',
  'Docker', 'Kubernetes', 'Terraform', 'CI/CD', 'Jenkins', 'PostgreSQL', 'MongoDB', 'Redis', 'GraphQL', 'REST', 'Spark', 'Hadoop',
  'Airflow', 'Snowflake', 'Kafka', 'TensorFlow', 'PyTorch', 'dbt', 'Iceberg', 'Helm', 'Prometheus', 'Grafana', 'SQL', 'MLOps',
  'LLM', 'Vector DB', 'Accessibility', 'Testing', 'System Design', 'Data Modeling', 'Linux', 'CSS', 'Performance'];
export function extractJobSkills(text = '') {
  const hay = lc(text);
  return KNOWN_SKILLS.filter((k) => hay.includes(lc(k))).slice(0, 14);
}

/* Compute the gap sets the engine reasons about. */
export function computeGaps(sig) {
  const fam = roleFamilyFor(sig.targetRole);
  const roleSkills = fam.coreSkills || GENERIC_FAMILY.coreSkills;

  // Role gaps: role-core skills the user neither verified nor claimed.
  const roleSkillGaps = roleSkills.filter((s) => !inList(s, sig.verifiedSkills) && !inList(s, sig.claimedSkills));
  // Unproven claims: claimed (or role) skills with no verification + no GitHub proof.
  const unverifiedClaims = uniq(sig.claimedSkills.filter((s) =>
    !inList(s, sig.verifiedSkills) && !inList(s, sig.githubProof.provenSkills)));
  // Job requirement gaps across saved jobs.
  const jobReqGaps = uniq(sig.savedJobs.flatMap((j) => j.skills)).filter((s) =>
    !inList(s, sig.verifiedSkills) && !inList(s, sig.githubProof.provenSkills));
  // Proof gaps — capability-level proof the profile is missing.
  const proofGaps = [];
  if (sig.githubProof.repoCount === 0) proofGaps.push('No GitHub repo proof yet');
  if (!sig.githubProof.hasTests) proofGaps.push('No automated tests as proof');
  if (!sig.githubProof.hasCI) proofGaps.push('No CI/CD proof');
  if (!sig.githubProof.hasDeployment) proofGaps.push('No deployment / live-demo proof');

  return { family: fam, roleSkills, roleSkillGaps, unverifiedClaims, jobReqGaps, resumeGaps: sig.resumeGaps, proofGaps };
}

/* Has the user already built something very similar? */
function duplicateOf(title, problem, skills, existingProjects, threshold = 0.6) {
  for (const p of existingProjects) {
    const titleSim = textSimilarity(title, p.title);
    const probSim = textSimilarity(problem, p.problem);
    const skillSet = new Set(skills.map(norm));
    const pSkillSet = new Set(p.skills.map(norm));
    let skillOverlap = 0;
    for (const s of skillSet) if (pSkillSet.has(s)) skillOverlap++;
    const skillSim = skillSet.size ? skillOverlap / skillSet.size : 0;
    const combined = Math.max(titleSim, probSim) * 0.6 + skillSim * 0.4;
    if (titleSim > 0.7 || combined >= threshold) return p;
  }
  return null;
}

/* Build one recommendation object from an archetype + gap context. */
function buildRecommendation(arch, sig, gaps) {
  const skillGapsFixed = arch.skills.filter((s) =>
    inList(s, gaps.roleSkillGaps) || inList(s, gaps.unverifiedClaims) || inList(s, gaps.jobReqGaps) || inList(s, gaps.resumeGaps));
  const jobMatched = uniq(sig.savedJobs.filter((j) => arch.skills.some((s) => inList(s, j.skills))).map((j) => j.title).filter(Boolean));
  const proofGapsFixed = [];
  if (gaps.proofGaps.includes('No GitHub repo proof yet')) proofGapsFixed.push('Creates a public GitHub repo');
  if (gaps.proofGaps.includes('No deployment / live-demo proof')) proofGapsFixed.push('Produces a deployable live demo');
  if (gaps.proofGaps.includes('No automated tests as proof')) proofGapsFixed.push('Adds a test suite as proof');
  if (gaps.proofGaps.includes('No CI/CD proof')) proofGapsFixed.push('Adds a CI/CD workflow');

  // Scoring (transparent): reward gap coverage, job match, proof creation, role fit.
  const roleFit = gaps.family.name !== 'generic' ? 1 : 0.55;
  const gapScore = clamp(skillGapsFixed.length / Math.max(2, arch.skills.length), 0, 1);
  const jobScore = clamp(jobMatched.length ? 1 : (sig.savedJobs.length ? 0.4 : 0.5), 0, 1);
  const proofScore = clamp(proofGapsFixed.length / 4, 0, 1);
  const readinessImpact = Math.round((gapScore * 38 + proofScore * 30 + jobScore * 18 + roleFit * 14));
  const score = Math.round(gapScore * 40 + proofScore * 22 + jobScore * 20 + roleFit * 18);

  const dup = duplicateOf(arch.title, arch.problem, arch.skills, sig.existingProjects);

  // Why: a specific, signal-grounded sentence (the spec's headline feature).
  const claimedButUnproven = arch.skills.filter((s) => inList(s, gaps.unverifiedClaims));
  let why = `Your target role is ${sig.targetRole}. `;
  if (claimedButUnproven.length) {
    why += `Your resume claims ${claimedButUnproven.slice(0, 3).join(', ')}, but your profile has no verified proof for ${claimedButUnproven[0]}. `;
  } else if (skillGapsFixed.length) {
    why += `It closes role gaps in ${skillGapsFixed.slice(0, 3).join(', ')}. `;
  }
  why += `This project creates GitHub-verifiable proof for ${arch.proof.slice(0, 3).join(', ')}.`;
  if (jobMatched.length) why += ` It also matches a saved job: "${jobMatched[0]}".`;

  return {
    id: fingerprint(arch.key, sig.targetRole),
    archetypeKey: arch.key,
    title: arch.title,
    targetRole: sig.targetRole,
    whyRecommended: why,
    skillGapsFixed: uniq(skillGapsFixed),
    proofGapsFixed: uniq(proofGapsFixed),
    jobRequirementsMatched: jobMatched,
    careerReadinessImpact: clamp(readinessImpact, 5, 100),
    difficulty: arch.difficulty,
    estimatedTime: estimateTime(arch.difficulty),
    evidenceNeeded: arch.proof,
    skills: arch.skills,
    problemStatement: arch.problem,
    sourceContext: buildSourceContext(sig, skillGapsFixed, jobMatched),
    duplicateWarning: dup ? `You already have a similar project ("${dup.title}"). Consider a different proof gap before duplicating.` : '',
    isInnovationGrade: false,
    recommendationConfidence: score >= 70 ? 'High' : score >= 45 ? 'Medium' : 'Low',
    _score: score,
  };
}

function estimateTime(difficulty) {
  return ({ beginner: '1–2 weeks', intermediate: '2–4 weeks', advanced: '4–8 weeks', 'research-grade': '8–12 weeks' })[difficulty] || '2–4 weeks';
}

function buildSourceContext(sig, skillGapsFixed, jobMatched) {
  const parts = [];
  if (skillGapsFixed.length) parts.push('target-role + resume skill gaps');
  if (sig.githubProof.repoCount === 0) parts.push('GitHub proof gap');
  if (jobMatched.length) parts.push(`saved job: ${jobMatched[0]}`);
  if (!parts.length) parts.push('target-role fit');
  return parts.join(' · ');
}

/* Innovation-grade recommendations bridged from Patent/Innovation OS clusters. */
function innovationRecommendations(sig, gaps) {
  return sig.patentInnovationClusters
    .filter((c) => c.title && c.patentPotentialScore >= 40)
    .slice(0, 3)
    .map((c) => {
      const skillGapsFixed = c.skills.filter((s) => inList(s, gaps.roleSkillGaps) || inList(s, gaps.unverifiedClaims));
      const dup = duplicateOf(c.title, c.summary, c.skills, sig.existingProjects);
      return {
        id: fingerprint('innovation', c.id),
        archetypeKey: 'innovation:' + c.id,
        title: c.title,
        targetRole: sig.targetRole,
        whyRecommended: `Innovation-grade: this came from a source-backed problem cluster in your Patent/Innovation OS (potential ${c.patentPotentialScore}/100). Building it creates portfolio proof AND a patent-readiness trail.`,
        skillGapsFixed: uniq(skillGapsFixed),
        proofGapsFixed: ['Creates a public GitHub repo', 'Builds a prototype-evidence trail'],
        jobRequirementsMatched: [],
        careerReadinessImpact: clamp(60 + Math.round(c.patentPotentialScore / 5), 5, 100),
        difficulty: c.patentPotentialScore >= 60 ? 'research-grade' : 'advanced',
        estimatedTime: estimateTime(c.patentPotentialScore >= 60 ? 'research-grade' : 'advanced'),
        evidenceNeeded: ['working prototype', 'dated invention log', 'architecture + data-flow diagrams', 'prior-art notes', 'demo video'],
        skills: c.skills.length ? c.skills : gaps.roleSkills.slice(0, 4),
        problemStatement: c.summary || c.title,
        sourceContext: 'Patent/Innovation OS cluster',
        duplicateWarning: dup ? `Already imported as "${dup.title}".` : '',
        isInnovationGrade: true,
        innovationClusterId: c.id,
        recommendationConfidence: c.patentPotentialScore >= 60 ? 'High' : 'Medium',
        _score: 65 + Math.round(c.patentPotentialScore / 4),
      };
    });
}

/* ------------------------------------------------------------------ */
/* Public entrypoint                                                   */
/* ------------------------------------------------------------------ */
export function matchProjects(input = {}, opts = {}) {
  const sig = normalizeProfileSignals(input);
  const gaps = computeGaps(sig);
  const max = opts.max || 6;

  const archetypeRecs = (gaps.family.archetypes || GENERIC_FAMILY.archetypes)
    .map((arch) => buildRecommendation(arch, sig, gaps));
  // Always ensure at least one generic option if the role is well covered.
  if (!archetypeRecs.length) archetypeRecs.push(...GENERIC_FAMILY.archetypes.map((a) => buildRecommendation(a, sig, gaps)));

  const innovationRecs = innovationRecommendations(sig, gaps);

  const all = [...innovationRecs, ...archetypeRecs]
    // de-prioritise (don't drop) duplicates so the user still sees the warning
    .sort((a, b) => (b._score - (b.duplicateWarning ? 20 : 0)) - (a._score - (a.duplicateWarning ? 20 : 0)))
    .slice(0, max)
    .map(({ _score, ...rest }) => rest);

  return {
    recommendedProjects: all,
    gapSummary: {
      targetRole: sig.targetRole,
      roleFamily: gaps.family.name,
      roleSkillGaps: gaps.roleSkillGaps,
      unverifiedClaims: gaps.unverifiedClaims,
      resumeGaps: gaps.resumeGaps,
      jobRequirementGaps: gaps.jobReqGaps,
      proofGaps: gaps.proofGaps,
    },
    signalsUsed: {
      hasResume: gaps.resumeGaps.length > 0 || sig.claimedSkills.length > 0,
      verifiedSkillCount: sig.verifiedSkills.length,
      claimedSkillCount: sig.claimedSkills.length,
      githubRepoCount: sig.githubProof.repoCount,
      savedJobCount: sig.savedJobs.length,
      existingProjectCount: sig.existingProjects.length,
      innovationClusterCount: sig.patentInnovationClusters.length,
    },
  };
}
