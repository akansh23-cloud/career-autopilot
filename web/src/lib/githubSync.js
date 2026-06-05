// Part 1 + 2 — client helpers for GitHub repo analysis and live-link
// verification. Both call the same-origin backend; both fail gracefully so the
// workspace UI never crashes. Results are merged onto the project object and
// persisted by the caller via saveProject().

import { api } from './api.js';

/* Accepts the three input forms and normalises to a canonical repo URL. */
export function normalizeRepoUrl(raw = '') {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/\.git$/, '').replace(/\/+$/, '');
  if (/^https?:\/\//i.test(s)) return s;
  if (/^github\.com\//i.test(s)) return 'https://' + s;
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return 'https://github.com/' + s;
  return s;
}

export async function analyzeGithub({ repoUrl, projectId, expectedSkills = [], expectedTechStack = [], targetRole = '' }) {
  const url = normalizeRepoUrl(repoUrl);
  try {
    const r = await api.post('/api/projects/analyze-github', { repoUrl: url, projectId, expectedSkills, expectedTechStack, targetRole });
    return r;
  } catch (e) {
    return { ok: false, success: false, error: 'network', message: 'GitHub analysis is temporarily unavailable. Add proof manually or try again later.' };
  }
}

export async function verifyLiveLink({ liveUrl, projectId }) {
  try {
    const r = await api.post('/api/projects/verify-live-link', { liveUrl, projectId });
    return r;
  } catch (e) {
    return { ok: false, success: false, reachable: false, warnings: ['Verification is temporarily unavailable. Needs manual review.'] };
  }
}

/* Merge a github analysis result onto a project (stored under p.github). */
export function applyGithubAnalysis(project, result) {
  if (!result || !result.success) return { ...project };
  const next = {
    ...project,
    githubUrl: result.repo?.url || project.githubUrl,
    github: {
      success: true,
      repo: result.repo,
      languages: result.languages || {},
      detectedTechStack: result.detectedTechStack || [],
      detectedSkills: result.detectedSkills || [],
      readme: result.readme || { exists: false },
      files: result.files || {},
      structure: result.structure || [],
      evidence: result.evidence || [],
      warnings: result.warnings || [],
      recommendations: result.recommendations || [],
      githubScore: result.githubScore || 0,
      lastSyncedAt: result.lastSyncedAt || new Date().toISOString(),
    },
  };
  // enrich skillsCovered with detected skills (deduped) so badges can map them
  const merged = new Set([...(project.skillsCovered || []), ...(result.detectedSkills || [])]);
  next.skillsCovered = Array.from(merged).slice(0, 16);
  return next;
}

export function applyLiveVerification(project, result) {
  if (!result) return { ...project };
  return {
    ...project,
    liveVerification: {
      reachable: !!result.reachable,
      statusCode: result.statusCode || 0,
      finalUrl: result.finalUrl || project.liveDemoUrl || '',
      responseTimeMs: result.responseTimeMs || 0,
      title: result.title || '',
      contentType: result.contentType || '',
      looksLikeApp: !!result.looksLikeApp,
      checkedAt: result.checkedAt || new Date().toISOString(),
      warnings: result.warnings || [],
    },
  };
}

/* Recruiter summary string (also used as the recruiterSummary proof signal). */
export function buildRecruiterSummary(p = {}, userName = 'Candidate') {
  const top = (p.skillsCovered || []).slice(0, 4).join(', ') || (p.techStack || []).slice(0, 4).join(', ');
  const score = p.proofScore || 0;
  const gh = p.github?.success ? `verified GitHub (${p.github.githubScore}/100)` : (p.githubUrl ? 'public code' : 'code pending');
  const live = p.liveVerification?.reachable ? 'a verified live demo' : (p.liveDemoUrl ? 'a live demo' : 'demo pending');
  return `${userName} — ${p.targetRole || 'Engineer'} candidate with a ${p.type || 'software'} project proving ${top}. Proof score ${score}/100, with ${gh} and ${live}.`;
}
