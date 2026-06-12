/* ============================================================
   Synthesis Intelligence — Project OS adapter
   ------------------------------------------------------------
   Two jobs:
   1. buildProjectOsPayload() — produce the 12-field payload the
      task contract requires for every recommended idea.
   2. enrichWorkspacePayload() — map that payload onto the shape
      the EXISTING Project Studio workspace generator persists
      (the record produced by patentBridgeService.toProjectPayload),
      so Project OS consumes the new intelligence without any
      schema change. Adapter only ADDS/overrides fields that are
      empty or weaker; it never strips existing workspace data.
   Dependency-free (only local util import). No AI, no DB.
   ============================================================ */
import { sanitizeText } from '../problemIntelligence/util.js';

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
const txt = (v, max = 400) => sanitizeText(String(v || ''), max);

/* Role derivation: deterministic, driven by blueprint surface area
   so different project types ask for different team shapes. */
export function deriveRequiredRoles({ classification = {}, projectBlueprint = {} } = {}) {
  const roles = ['Full-stack developer (owns the end-to-end build)'];
  const stack = arr(projectBlueprint.techStack).join(' ').toLowerCase();
  const archi = arr(projectBlueprint.architecture).join(' ').toLowerCase();
  if (/(ml|model|inference|vision|tensorflow|pytorch|scikit|opencv|训练|classifier|anomaly)/.test(stack + archi)) {
    roles.push('ML/data engineer (owns the model or detection pipeline)');
  }
  if (/(sensor|mqtt|esp32|raspberry|firmware|edge|iot)/.test(stack + archi)) {
    roles.push('Embedded/IoT engineer (owns device firmware and telemetry)');
  }
  if (/(simulation|physics|3d|three\.js|unity|digital twin)/.test(stack + archi)) {
    roles.push('Simulation engineer (owns the physics/state engine)');
  }
  if (/(security|threat|cve|vulnerab|siem)/.test(stack + archi + String(classification.domain))) {
    roles.push('Security analyst (owns triage rules and severity logic)');
  }
  roles.push('QA/documentation owner (owns the proof checklist and demo evidence)');
  return roles.slice(0, 4);
}

/* The contract payload — every field present, none empty. */
export function buildProjectOsPayload({ title, classification = {}, buildBrief = {}, projectBlueprint = {}, quality = {} } = {}) {
  const warnings = [...arr(quality.warnings)];
  const payload = {
    title: txt(title || buildBrief?._meta?.title, 200),
    problemStatement: txt(buildBrief.problem, 900),
    targetUsers: arr(buildBrief.targetUsers).slice(0, 4),
    technicalMechanism: txt(buildBrief.technicalMechanism, 600),
    requiredRoles: deriveRequiredRoles({ classification, projectBlueprint }),
    requiredSkills: arr(buildBrief.skillsGained).slice(0, 8),
    difficulty: txt(classification.difficulty || 'intermediate', 40),
    milestones: arr(projectBlueprint.milestones).slice(0, 8),
    prototypeEvidenceChecklist: arr(projectBlueprint.proofChecklist).slice(0, 7),
    testingDeploymentProofChecklist: [
      ...arr(projectBlueprint.testingPlan).slice(0, 4),
      ...arr(projectBlueprint.deploymentPlan).slice(0, 3),
    ],
    ipReadinessPossibility: txt(buildBrief.ipReadinessAngle, 500),
    warnings,
  };
  return payload;
}

/* Merge the synthesis payload into an EXISTING workspace record
   (the toProjectPayload shape). Non-destructive: only fills gaps
   or appends — used by /convert-to-project. */
export function enrichWorkspacePayload(workspacePayload = {}, projectPackage = {}) {
  if (!projectPackage || !projectPackage.projectOsPayload) return workspacePayload;
  const out = { ...workspacePayload };
  const os = projectPackage.projectOsPayload;
  const bp = projectPackage.projectBlueprint || {};
  const brief = projectPackage.buildBrief || {};

  if (!out.problemStatement && os.problemStatement) out.problemStatement = os.problemStatement;
  if (!out.solution && brief.proposedSolution) out.solution = txt(brief.proposedSolution, 1200);
  out.technicalMechanism = out.technicalMechanism || os.technicalMechanism;
  out.targetUsers = arr(out.targetUsers).length ? out.targetUsers : os.targetUsers;
  out.requiredRoles = arr(out.requiredRoles).length ? out.requiredRoles : os.requiredRoles;
  out.difficulty = out.difficulty || os.difficulty;
  if (!arr(out.architecture).length && typeof out.architecture !== 'string' && arr(bp.architecture).length) {
    out.architecture = bp.architecture;
  } else if (typeof out.architecture === 'string' && (/use the architecture tab/i.test(out.architecture) || !out.architecture.trim()) && arr(bp.architecture).length) {
    // Existing record carries only the weak default — replace with the
    // domain-aware layers, joined to keep the string shape consumers expect.
    out.architecture = txt(bp.architecture.join(' → '), 1200);
  }
  out.architectureLayers = arr(out.architectureLayers).length ? out.architectureLayers : arr(bp.architecture);
  if (!arr(out.techStack).length && arr(bp.techStack).length) out.techStack = bp.techStack;
  if (!arr(out.testingPlan).length && arr(bp.testingPlan).length) out.testingPlan = bp.testingPlan;

  // Always append (deduped) proof evidence — these strengthen, never replace.
  const seen = new Set(arr(out.evidenceChecklist).map((x) => String(x).toLowerCase().trim()));
  const extra = arr(os.prototypeEvidenceChecklist).filter((x) => !seen.has(String(x).toLowerCase().trim()));
  out.evidenceChecklist = [...arr(out.evidenceChecklist), ...extra].slice(0, 12);

  out.skillsCovered = arr(out.skillsCovered).length ? out.skillsCovered : os.requiredSkills;
  out.ipReadinessPossibility = os.ipReadinessPossibility;
  out.synthesisWarnings = arr(os.warnings);
  out.synthesisQuality = projectPackage.quality || null;
  return out;
}

export default { buildProjectOsPayload, deriveRequiredRoles, enrichWorkspacePayload };
